# AGENTS.md

## 项目概述

这是一个自动化软件开发框架（长期运行代理框架），使用 Claude Agent SDK 实现三代理协作架构，能够从 PRD 文档自动生成产品规格、拆分任务并全程自动执行开发工作。

## 常用命令

```bash
# 编译 TypeScript
npm run build

# 监听模式编译
npm run dev

# 运行 CLI（需先编译）
npm run start

# 初始化新项目（从 PRD 生成规格和任务）
node dist/index.js init <project-dir> --prd <prd-file>

# 从口语化需求初始化
node dist/index.js init <project-dir> --text "描述需求"

# 执行任务循环
node dist/index.js run <project-dir> --max-tasks 10

# 继续中断的执行
node dist/index.js run <project-dir> --continue

# 同步文档与任务/代码
node dist/index.js sync <project-dir>        # 检查模式
node dist/index.js sync <project-dir> --fix  # 修复模式

# 管理提供商
node dist/index.js provider --add --name <n> --token <t> --url <u> --model <m>
node dist/index.js provider --list
node dist/index.js provider --switch <name>
node dist/index.js provider --remove <name>

# 运行测试
npm test
npm run test:coverage
```

## 核心架构

项目采用三代理架构，基于 Anthropic 的 `@anthropic-ai/claude-agent-sdk`：

```
┌─────────────────────────────────────────────────────────────┐
│                    初始化阶段（运行一次）                      │
│   PRD文档 → Planner(规划器) → spec.md + tasks.json          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   执行阶段（循环，每任务一轮）                  │
│                                                             │
│   选择任务 → Generator(生成器) → Evaluator(评估器)           │
│                    ↑              │                         │
│                    └──── 修复 ←── fail (attempts < 3)       │
│                                   │                         │
│                            needs_human (attempts >= 3)      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   同步阶段（按需触发）                          │
│                                                             │
│   docs/ → SyncEngine → 比较 tasks.json / 代码               │
│                           │                                 │
│                    差异报告 + 自动修复                        │
│                    (add_task / remove_task / update_task)    │
└─────────────────────────────────────────────────────────────┘
```

**代理职责**：
| 代理 | 职责 | 输入 | 输出 |
|------|------|------|------|
| Planner | 需求分析、任务拆分 | PRD文档 | spec.md, tasks.json |
| Generator | 实现功能代码 | 任务详情 + spec.md | 代码变更 |
| Evaluator | 验收测试、评分反馈 | 任务详情 + 代码状态 | evaluator_report.json |

**SyncEngine 概念**：docs/ 是唯一事实来源。用户手动维护 docs/ 下的 markdown 文档，SyncEngine 在运行时检查文档与 tasks.json 的一致性，自动修复偏移。适用场景：需求变更、代码跑偏、增量开发。

## 代码结构

```
src/
├── index.ts                    # CLI 入口（init / run / sync / provider 命令）
├── types/
│   ├── index.ts                # 核心类型定义（Task, TaskList, EvaluatorReport 等）
│   ├── quality.ts              # 质量保障类型（Cost, Error, Provider, Logger 等）
│   └── sync.ts                 # 同步相关类型（DocFeature, SyncReport 等）
├── core/
│   ├── orchestrator.ts         # 主控编排器，依赖注入架构，协调执行流程
│   ├── sync-engine.ts          # 同步引擎，将 docs/ 作为唯一事实来源对齐任务/代码
│   ├── state-manager.ts        # 状态管理，读写 .harness/ 目录下的文件
│   ├── evaluator.ts            # 评估器，验收开发工作
│   ├── error-handler.ts        # 错误分类、重试逻辑（指数退避）、提供商切换判断
│   ├── cost-tracker.ts         # Token 使用追踪和预算控制
│   ├── failure-collector.ts    # 错误收集和模式分析，生成 failure.md
│   ├── provider-manager.ts     # 多提供商池化管理，静态配置与运行时状态分离
│   ├── message-handler.ts      # 代理消息过滤和格式化控制台输出
│   ├── graceful-shutdown.ts    # SIGTERM/SIGINT 信号处理，保存任务状态
│   └── playwright-tester.ts    # Playwright 工具类（用于 Web 应用测试）
├── agents/
│   ├── loader.ts               # 加载代理提示词
│   └── index.ts                # 导出工厂函数
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

## 状态文件结构

项目运行时在 `<project-dir>/.harness/` 下维护状态：

```
.harness/
├── spec.md           # 产品规格文档（规划器生成）
├── tasks.json        # 任务列表，包含状态和验收标准
├── progress.txt      # 执行进度日志
├── costs.json        # Token 使用记录
├── failure.md        # 错误收集和模式分析
├── logs/             # 结构化 JSON 日志（按天分文件）
├── screenshots/      # Playwright 评估截图
└── reports/          # 评估报告目录
    └── evaluator_report_<task-id>_<attempt>.json
```

## 关键类型

**Task 状态流转**：
```
pending → in_progress → completed
                  ↘ needs_human (attempts >= 3)
                  ↘ pending (评估失败，attempts < 3)
```

**验收标准状态**：`pending | pass | fail`

**重试机制**：每个任务最多 3 次尝试，失败后标记 `needs_human`

## ES Module 注意事项

项目使用 ES Module（`"type": "module"`），注意：
- 导入必须使用 `.js` 扩展名：`import { foo } from './bar.js'`
- 使用 `fileURLToPath(import.meta.url)` 获取 `__dirname`
- 使用 `import { promisify } from 'util'` 替代 `util.promisify`

## 多提供商管理

框架支持多个 AI 服务提供商的池化管理，配置文件是唯一事实来源：

- **全局配置位置**：`~/.config/autorun-harness/providers/*.json`（每个提供商一个文件）
- **运行时状态**：`~/.config/autorun-harness/providers/.state.json`（共享状态文件）
- **环境变量传递**：ProviderManager 启动时将当前提供商配置写入 `process.env`，Claude Agent SDK 子进程继承

**提供商状态**：`active`（当前使用）→ `rate_limited`（429，1 小时冷却）→ `unavailable`（用量上限，24 小时冷却）→ `available`（冷却后恢复）

**按需恢复**：不使用定时器，在 `initialize()`、`getAvailableProviders()`、`switchToNext()` 时检查冷却期是否已过

**类型定义**：
- `ProviderStaticConfig`：name, authToken, baseUrl, model, notes
- `ProviderRuntimeState`：status, lastUsed, rateLimitedAt, unavailableAt
- `AIProvider` = ProviderStaticConfig & ProviderRuntimeState
- `ProviderStateFile`：currentProvider, totalSwitches, providers map

## Orchestrator 依赖注入

Orchestrator 采用依赖注入架构（可选 `deps` 参数），支持测试时注入 mock 对象：

```typescript
// 生产代码：不传 deps，走默认创建
const orchestrator = new Orchestrator(projectDir);

// 测试代码：注入 mock
const orchestrator = new Orchestrator('/tmp/test', {
  stateManager: mockStateManager as any,
  evaluator: mockEvaluator as any,
});
```

## 评估器评分体系

| 维度 | 权重 | 评估内容 |
|------|------|----------|
| functionality | 40% | 验收标准通过率 |
| code_quality | 25% | 代码可读性、错误处理 |
| product_depth | 20% | 边界情况、用户体验 |
| visual_design | 15% | 设计规范符合度 |

通过阈值：`total_weighted_score >= 0.75`

## 测试说明

- **框架自身测试**：314 个测试用例，覆盖所有核心模块（vitest）
- **CLI 应用测试**：评估器使用 Bash 命令直接运行程序验证功能
- **Web 应用测试**：评估器使用 Playwright 进行浏览器自动化测试
- **依赖注入测试**：Orchestrator 通过 DI 注入 mock，实现内存中的快速单元测试

## 评估工具

框架评估工具已独立为 [autorun-harness-eval](https://github.com/yamsfeer/autorun-harness-eval)。它通过读取 `.harness/` 目录下的文件协议（tasks.json、costs.json、reports/*.json）对框架输出进行评分，与主项目无代码级依赖。
