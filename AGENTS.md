# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

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
```

**代理职责**：
| 代理 | 职责 | 输入 | 输出 |
|------|------|------|------|
| Planner | 需求分析、任务拆分 | PRD文档 | spec.md, tasks.json |
| Generator | 实现功能代码 | 任务详情 + spec.md | 代码变更 |
| Evaluator | 验收测试、评分反馈 | 任务详情 + 代码状态 | evaluator_report.json |

## 代码结构

```
src/
├── index.ts              # CLI 入口，定义 init/run 命令
├── types/index.ts        # 核心类型定义（Task, TaskList, EvaluatorReport 等）
├── core/
│   ├── orchestrator.ts   # 主控编排器，协调执行流程
│   ├── state-manager.ts  # 状态管理，读写 .harness/ 目录下的文件
│   ├── evaluator.ts      # 评估器，验收开发工作
│   └── playwright-tester.ts  # Playwright 工具类（用于 Web 应用测试）
├── agents/
│   ├── loader.ts         # 加载代理提示词
│   └── index.ts          # 导出工厂函数
└── commands/
    ├── init.ts           # init 命令实现
    └── run.ts            # run 命令实现

prompts/
├── planner.md            # 规划器提示词
├── generator.md          # 生成器提示词
└── evaluator.md          # 评估器提示词
```

## 状态文件结构

项目运行时在 `<project-dir>/.harness/` 下维护状态：

```
.harness/
├── spec.md           # 产品规格文档（规划器生成）
├── tasks.json        # 任务列表，包含状态和验收标准
├── progress.txt      # 执行进度日志
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

## 评估器评分体系

| 维度 | 权重 | 评估内容 |
|------|------|----------|
| functionality | 40% | 验收标准通过率 |
| code_quality | 25% | 代码可读性、错误处理 |
| product_depth | 20% | 边界情况、用户体验 |
| visual_design | 15% | 设计规范符合度 |

通过阈值：`total_weighted_score >= 0.75`

## 测试说明

- **CLI 应用测试**：评估器使用 Bash 命令直接运行程序验证功能
- **Web 应用测试**：评估器使用 Playwright 进行浏览器自动化测试

## 评估工具

框架评估工具已独立为 [autorun-harness-eval](https://github.com/yamsfeer/autorun-harness-eval)。它通过读取 `.harness/` 目录下的文件协议（tasks.json、costs.json、reports/*.json）对框架输出进行评分，与主项目无代码级依赖。
