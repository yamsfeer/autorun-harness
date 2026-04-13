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

## 快速开始

### 前置条件

- Node.js 18+
- 通过环境变量设置 API 密钥：
  ```bash
  export ANTHROPIC_AUTH_TOKEN="sk-ant-..."
  # 可选：自定义 Base URL 和模型
  export ANTHROPIC_BASE_URL="https://api.anthropic.com"
  export ANTHROPIC_MODEL="claude-sonnet-4-20250514"
  ```

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
```

**管理 AI 提供商：**

```bash
# 添加提供商
node dist/index.js provider --add --name glm --token "your-token" --url "https://open.bigmodel.cn/api/anthropic" --model "GLM-4.7"

# 列出所有提供商
node dist/index.js provider --list

# 切换到指定提供商
node dist/index.js provider --switch glm
```

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
└── reports/               # 每个任务/尝试的评估报告
    └── evaluator_report_<task-id>_<attempt>.json
```

## 任务生命周期

```
pending → in_progress → completed
                  ↘ needs_human (≥ 3 次失败后)
                  ↘ pending     (评估失败，携带反馈重试)
```

## 代码结构

```
src/
├── index.ts                    # CLI 入口（init / run / provider 命令）
├── types/
│   ├── index.ts                # 核心类型（Task, TaskList, EvaluatorReport 等）
│   └── quality.ts              # 质量保障类型（Cost, Error, Provider 等）
├── core/
│   ├── orchestrator.ts         # 主控编排器 — 协调完整流水线
│   ├── state-manager.ts        # 读写 .harness/ 状态文件
│   ├── evaluator.ts            # 评估器代理封装
│   ├── error-handler.ts        # 错误分类、重试逻辑、提供商切换
│   ├── cost-tracker.ts         # Token 使用追踪和预算控制
│   ├── failure-collector.ts    # 错误收集和模式分析
│   ├── provider-manager.ts     # 多提供商池化管理
│   ├── graceful-shutdown.ts    # SIGTERM/SIGINT 处理
│   └── playwright-tester.ts    # Playwright 工具（Web 应用评估）
├── agents/
│   ├── loader.ts               # 从 Markdown 文件加载代理提示词
│   └── index.ts                # 模块导出
└── commands/
    ├── init.ts                 # init 命令实现
    ├── run.ts                  # run 命令实现
    └── provider.ts             # provider 命令实现

prompts/
├── planner-full.md             # 规划器提示词（完整模式）
├── planner-simple.md           # 规划器提示词（简单模式）
├── generator.md                # 生成器提示词
└── evaluator.md                # 评估器提示词
```

## 开发

```bash
npm run build          # 编译 TypeScript
npm run dev            # 监听模式
npm run start          # 运行 CLI
```

## 许可证

MIT
