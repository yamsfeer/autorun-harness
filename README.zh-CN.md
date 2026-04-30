# autorun-harness

[English](./README.md)

基于 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) 的长期运行代理框架，采用三代理协作架构实现软件开发自动化。

提供一份 PRD 文档（或一段口语化描述），框架会自动分析需求、生成技术规格、拆分任务，然后循环执行实现和质量验收——全程无需人工干预。

## 工作原理

```
┌──────────────────────────────────────────────────────────┐
│              初始化阶段（运行一次）                         │
│                                                          │
│   PRD / 文本描述  →  规划器 Agent  →  spec.md + tasks.json│
│                                       + 项目文档          │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│              执行阶段（每任务一轮循环）                      │
│                                                          │
│   选择下一个任务  →  生成器 Agent                          │
│                          │                               │
│                     评估器 Agent                          │
│                          │                               │
│                    ┌─────┴──────┐                        │
│                    │            │                        │
│                   通过        失败                       │
│                    │            │                        │
│              已完成      重试（≤ 3 次）                    │
│                              │                           │
│                        needs_human                       │
│                         (≥ 3 次失败)                      │
└──────────────────────────────────────────────────────────┘
```

**三个专业代理协作：**

| 代理 | 职责 | 输入 | 输出 |
|------|------|------|------|
| **Planner（规划器）** | 需求分析、任务拆分 | PRD 文档 | `spec.md`、`tasks.json`、项目文档 |
| **Generator（生成器）** | 功能代码实现 | 任务 + 规格 | 代码变更 |
| **Evaluator（评估器）** | 验收测试、质量评分 | 任务 + 代码状态 | `evaluator_report.json` |

## 功能特性

- **两种初始化模式** — `full` 模式生成完整文档体系（CLAUDE.md、DESIGN.md、API 契约、数据模型、流程图）；`simple` 模式跳过文档，专注于任务拆分
- **自动化质量评估** — 每个任务从四个维度评分（功能性 40%、代码质量 25%、产品深度 20%、视觉设计 15%），通过阈值 0.75
- **自动重试机制** — 评估失败的任务携带反馈回到生成器重试（最多 3 次，超出则标记需人工介入）
- **多服务提供商支持** — 支持配置多个 AI 提供商（Anthropic、OpenAI 兼容接口等），遇到频率限制 (429) 或用量上限时自动切换
- **成本追踪** — 按代理和任务记录 Token 使用量，支持预算限制和预警
- **错误收集分析** — 错误记录到 `failure.md`，自动分析模式并提供修复建议
- **优雅关闭** — 捕获 SIGTERM/SIGINT 信号，保存进行中的任务状态
- **文档同步** — `sync` 命令将 `docs/` 作为唯一事实来源，自动检测文档与任务/代码的不一致并修正

## 快速开始

### 前置条件

- Node.js 18+
- 通过 `provider` 命令配置 AI 服务提供商（框架统一管理 API 密钥和端点，无需手动设置环境变量）：
  ```bash
  # 添加第一个提供商
  node dist/index.js provider --add --name my-provider --token "your-token" --url "https://api.anthropic.com" --model "claude-sonnet-4-20250514"
  ```

  详见下方[多服务提供商支持](#多服务提供商支持)，了解如何添加不同 AI 厂商（Anthropic、智谱 GLM、字节 ARK、OpenAI 兼容接口等）的提供商，以及在达到频率限制时自动切换。

### 安装

```bash
git clone https://github.com/yamsfeer/autorun-harness.git
cd autorun-harness
npm install
npm run build
```

### 使用

**从 PRD 初始化项目：**

```bash
# 完整模式 — 生成文档 + 规格 + 任务
node dist/index.js init ./my-project --prd ./PRD.md

# 完整模式 + 已有文档目录
node dist/index.js init ./my-project --prd ./PRD.md --docs ./my-project/docs

# 简单模式 — 仅生成规格 + 任务
node dist/index.js init ./my-project --text "构建一个带增删改查功能的待办应用" --mode simple
```

**执行任务循环：**

```bash
# 最多处理 10 个任务（默认）
node dist/index.js run ./my-project

# 限制 5 个任务 + Token 预算
node dist/index.js run ./my-project --max-tasks 5 --max-tokens 500000

# 继续之前中断的执行
node dist/index.js run ./my-project --continue
```

**同步文档与任务/代码：**

```bash
# 仅检查，输出差异报告
node dist/index.js sync ./my-project

# 自动修复可处理的问题
node dist/index.js sync ./my-project --fix

# 指定自定义文档目录
node dist/index.js sync ./my-project --docs ./custom-docs
```

**管理 AI 提供商：**

```bash
# 添加提供商
node dist/index.js provider --add --name glm --token "your-token" --url "https://open.bigmodel.cn/api/anthropic" --model "GLM-4.7"

# 列出所有提供商及其状态
node dist/index.js provider --list

# 切换到指定提供商
node dist/index.js provider --switch glm

# 删除提供商
node dist/index.js provider --remove glm
```

### 多服务提供商支持

框架支持任何 Anthropic 兼容的 API 端点。提供商配置全局存储在 `~/.config/autorun-harness/providers/`，作为唯一事实来源。

**支持的提供商包括：**
- **Anthropic** — 默认 API
- **智谱 GLM** — 通过 `https://open.bigmodel.cn/api/anthropic`
- **字节跳动 ARK** — 通过 `https://ark.cn-beijing.volces.com/api/coding`
- **OpenAI 兼容接口** — 任何提供 Anthropic 兼容 API 的服务

**自动切换：** 当提供商遇到频率限制（429）或用量上限时，框架自动切换到下一个可用提供商。频率限制的提供商 1 小时后恢复（冷却期），用量达上限的提供商 24 小时后恢复——均为按需检查而非定时器。

**Provider 切换的三层防护机制：**

每个 provider 由 **model** + **baseUrl** + **authToken** 三个参数组成一个完整套件，切换时必须同时替换。只改 model 而沿用旧的 baseUrl 会导致 API 请求发到错误的端点。

框架切换 provider 时通过三层配置确保正确生效：

1. **`process.env`** — 设置当前进程的 `ANTHROPIC_MODEL`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`。
2. **项目级 `.claude/settings.local.json`** — 将 provider 的 env 配置写入项目目录。这是**关键层**：Claude Code CLI 加载 settings 的优先级为 **项目级 > 用户级**，因此会覆盖 `~/.claude/settings.json` 中的全局默认值。
3. **SDK `options.env`** — 每次 `query()` 调用时通过 `env` 选项传入完整环境变量（含 provider 覆盖），并用 `...process.env` 保留所有系统变量。

> **注意：** 如果 `~/.claude/settings.json` 中有 `env` 配置（如设定了默认 provider），harness 生成的项目级 `.claude/settings.local.json` 会在执行期间自动覆盖它，无需手动修改全局配置。

## 项目状态

运行时状态保存在 `<project-dir>/.harness/` 下：

```
.harness/
├── spec.md                # 技术规格（规划器生成）
├── tasks.json             # 任务列表，包含状态和验收标准
├── progress.txt           # 执行进度日志
├── costs.json             # Token 使用记录
├── failure.md             # 错误收集和模式分析
├── logs/                  # 结构化 JSON 日志
├── screenshots/           # Playwright 评估截图
└── reports/               # 每个任务/尝试的评估报告
    └── evaluator_report_<task-id>_<attempt>.json
```

## 任务生命周期

```
pending → in_progress → completed
                  ↘ needs_human (≥ 3 次失败后)
                  ↘ pending     (评估失败，携带反馈重试)
```

## 文档同步（`sync`）

**核心理念：`docs/` 是唯一的事实来源（Single Source of Truth）。** 用户手动维护 `docs/` 下的文档，系统自动将 `tasks.json` 和代码与之对齐。

### 适用场景

| 场景 | 说明 |
|------|------|
| **需求变更** | 中途改了功能要求 → `docs/` 变了，`tasks.json` 没跟上 → 运行 `sync` 自动更新任务 |
| **执行跑偏** | Generator 生成的代码与文档不一致 → `sync` 检测并标记为需要修复 |
| **Brownfield** | 已有项目通过 Archaeology Agent 生成了 `docs/` → 用 `sync` 验证任务/代码是否对齐 |
| **增量开发** | 新增功能、删除旧功能 → 更新 `docs/` 后运行 `sync`，系统自动生成/移除对应任务 |

### 检测能力

`sync` 检查三种对齐关系：

| 检查 | 不一致 | 处理方式 |
|------|--------|---------|
| docs → tasks | 文档描述了某功能，但 tasks.json 无对应任务 | → 自动生成新任务 |
| tasks → docs | tasks.json 有已完成任务在文档中找不到依据 | → 自动移除任务 |
| code → tasks | 已完成任务的关键产出文件缺失 | → 生成补充任务 |

### 使用流程

```
用户修改 docs/ → sync --check 查看差异 → sync --fix 自动修正 → run 执行新任务
```

## 代码结构

```
src/
├── index.ts                    # CLI 入口（init / run / sync / provider 命令）
├── types/
│   ├── index.ts                # 核心类型（Task, TaskList, EvaluatorReport 等）
│   ├── quality.ts              # 质量保障类型（Cost, Error, Provider 等）
│   └── sync.ts                 # 同步相关类型（DocFeature, SyncReport 等）
├── core/
│   ├── orchestrator.ts         # 主控编排器 — 协调完整流水线
│   ├── sync-engine.ts          # 同步引擎 — 文档与任务/代码的对齐检查与修复
│   ├── state-manager.ts        # 读写 .harness/ 状态文件
│   ├── evaluator.ts            # 评估器代理封装
│   ├── error-handler.ts        # 错误分类、重试逻辑、提供商切换
│   ├── cost-tracker.ts         # Token 使用追踪和预算控制
│   ├── failure-collector.ts    # 错误收集和模式分析
│   ├── provider-manager.ts     # 多提供商池化管理
│   ├── message-handler.ts      # 代理消息过滤和格式化输出
│   ├── graceful-shutdown.ts    # SIGTERM/SIGINT 处理
│   └── playwright-tester.ts    # Playwright 工具（Web 应用评估）
├── agents/
│   ├── loader.ts               # 从 Markdown 文件加载代理提示词
│   └── index.ts                # 模块导出
└── commands/
    ├── init.ts                 # init 命令实现
    ├── run.ts                  # run 命令实现
    ├── sync.ts                 # sync 命令实现
    └── provider.ts             # provider 命令实现

prompts/
├── planner-full.md             # 规划器提示词（完整模式）
├── planner-simple.md           # 规划器提示词（简单模式）
├── generator.md                # 生成器提示词
└── evaluator.md                # 评估器提示词
```

## 评估工具

评估工具已独立为单独项目：[autorun-harness-eval](https://github.com/yamsfeer/autorun-harness-eval)

它读取 `.harness/` 状态文件并执行自动化检查（构建、测试、lint、运行时），对框架输出进行评分。详见评估项目 README。

## 开发

```bash
npm run build          # 编译 TypeScript
npm run dev            # 监听模式
npm run start          # 运行 CLI
npm test               # 运行所有测试（vitest）
npm run test:coverage  # 运行测试并生成覆盖率报告
```

## 许可证

MIT
