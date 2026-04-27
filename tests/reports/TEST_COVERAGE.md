# Autorun Harness - 功能与测试覆盖报告

> 生成时间: 2026-04-27
> 对应提交: be7d4e5 (补充核心模块单元测试与端到端测试，提升测试覆盖率至 293 个测试)

---

## 一、项目功能概述

Autorun Harness 是一个 CLI 工具，接收用户的 PRD 文档或需求描述，通过多 Agent 协作完成从零到一的代码开发自动化。

### 核心工作流

```
PRD / 需求描述
    |
    v
[Planner Agent] --> 生成 spec.md + tasks.json
    |
    v
[Orchestrator] --> 循环调度任务
    |
    +-- [Generator Agent] --> 代码生成
    |
    +-- [Evaluator Agent] --> 验收评估
    |
    v
任务状态: completed / needs_human / pending
```

### 模块清单

| 模块 | 文件 | 职责 |
|------|------|------|
| CLI 入口 | `src/index.ts` | 命令注册、参数解析 |
| 初始化命令 | `src/commands/init.ts` | 分析 PRD，生成 spec.md / tasks.json / 文档体系 |
| 运行命令 | `src/commands/run.ts` | 启动 Orchestrator 循环 |
| Provider 命令 | `src/commands/provider.ts` | 管理 AI 提供商配置（增删查切） |
| **编排器** | `src/core/orchestrator.ts` | 核心主控：任务调度、Agent 调用、错误处理、状态管理、提供商切换、中断恢复 |
| **评估器** | `src/core/evaluator.ts` | 调用 Agent SDK 执行验收测试、读取报告、阈值校验、AC 状态回写 |
| **状态管理** | `src/core/state-manager.ts` | 持久化 tasks.json / progress.txt / spec.md、依赖检查、统计更新 |
| **错误处理** | `src/core/error-handler.ts` | 错误分类、重试机制（指数退避）、超时控制、提供商切换判断 |
| **消息处理** | `src/core/message-handler.ts` | 解析 Agent SDK 消息流、提取进度、格式化工具调用展示 |
| 提供商管理 | `src/core/provider-manager.ts` | 多提供商池化管理、静态配置与运行时状态分离、自动切换、冷却恢复 |
| 成本追踪 | `src/core/cost-tracker.ts` | Token 使用量记录、预算检查、成本报告 |
| 错误收集 | `src/core/failure-collector.ts` | 收集失败记录、生成 .harness/failure.md |
| 日志系统 | `src/core/logger.ts` | 结构化 JSON 日志、分级输出（debug/info/warn/error） |
| Playwright 测试 | `src/core/playwright-tester.ts` | 浏览器自动化测试辅助 |
| 优雅关闭 | `src/core/graceful-shutdown.ts` | SIGINT/SIGTERM 信号处理、清理回调 |
| Agent 加载器 | `src/agents/index.ts`, `loader.ts` | 加载 planner / generator / evaluator 的 prompt 定义 |
| 类型定义 | `src/types/index.ts`, `quality.ts` | 全项目 TypeScript 类型与接口 |

---

## 二、近期 Bug 修复记录

基于 `issue-bug-report.md` 中三个项目的运行结果，修复了以下问题：

| Bug ID | 问题描述 | 根因 | 修复文件 | 修复内容 |
|--------|----------|------|----------|----------|
| Bug-001 | `total_weighted_score < threshold` 但 `final_decision="pass"` | 评估器未严格校验阈值逻辑 | `evaluator.ts` | 新增 `validateReportThreshold`，强制修正不一致的决策 |
| Bug-002 | SIGINT 中断后任务状态与文件系统不同步 | 中断时未记录已生成文件清单，恢复逻辑缺失 | `orchestrator.ts` | `handleInterruption` 中确保任务状态设为 `in_progress` |
| Bug-003 | Generator/Evaluator 崩溃只返回"未知错误" | `handleResult` 丢失原始错误信息 | `message-handler.ts` | 重构错误提取逻辑，支持 `errors[]` / `error.message` / `subtype` 等多分支 |
| Bug-004 | 评估完成后 AC 状态仍为 `pending` | 评估器未回写 criteria_results 到 tasks.json | `evaluator.ts` | 新增 `updateTaskAcceptanceStatus`，在评估后同步 AC 状态 |
| Bug-005 | 评估器自身崩溃被误判为代码不合格 | 缺乏 `EVALUATOR_ERROR` 与 `CODE_ERROR` 分类 | `evaluator.ts`, `orchestrator.ts`, `error-handler.ts` | 引入 `evaluator_error` 标记；崩溃时不增加尝试次数、回退 pending |
| Bug-006 | 下游任务因错误的上游状态被阻塞 | 依赖检查过于严格，只看 `status === "completed"` | `state-manager.ts` | `areDependenciesMet` 新增 `outputs` 文件存在性备选检查 |

---

## 三、测试覆盖现状

### 已覆盖模块（17 个文件，293 个测试）

| 测试文件 | 测试数 | 覆盖的功能点 |
|----------|--------|-------------|
| `tests/core/error-handler.test.ts` | 38 | 错误创建与属性、重试逻辑（含指数退避与 maxDelay 上限）、超时、错误类型解析、格式化、退出指令、环境变量设置 |
| `tests/core/message-handler.test.ts` | 24 | 工具调用解析（Read/Write/Edit/Bash/Glob/Grep）、文本行动声明提取、Markdown 标题提取、工具错误结果展示、result 消息处理、reset 清理 |
| `tests/core/state-manager.test.ts` | 20 | 任务加载/保存、spec 读写、状态更新（含 completed_at）、尝试次数递增、备注追加、进度日志读写、依赖检查、outputs 文件存在性备选依赖检查（Bug-006）、项目完成判断、统计更新 |
| `tests/core/evaluator.test.ts` | 19 | evaluate 主方法（成功/失败/报告不存在/解析失败/外部异常全场景）、阈值验证（Bug-001）、AC 状态回写（Bug-004）、默认报告生成含 evaluator_error 标记（Bug-005）、报告保存路径 |
| `tests/core/orchestrator.test.ts` | 12 | run() 边界与正常流程（项目完成/无任务/成功/评估失败/重试/needs_human）、Generator 错误处理（rate_limit 切换成功/失败、普通错误）、Token 预算 |
| `tests/core/provider-manager.test.ts` | 31 | 提供商增删查切、状态持久化、冷却恢复（rate_limited 1小时/unavailable 24小时）、自动切换逻辑、handleRateLimit/handleUsageLimit |
| `tests/core/cost-tracker.test.ts` | 13 | Token 记录、预算检查（含 80% 预警）、成本报告生成 |
| `tests/core/failure-collector.test.ts` | 14 | 失败记录收集、failure.md 生成、模式分析 |
| `tests/core/logger.test.ts` | 23 | 日志级别过滤、控制台和文件输出、JSON 格式化 |
| `tests/core/graceful-shutdown.test.ts` | 8 | 信号处理、回调执行、双信号强制退出 |
| `tests/commands/init.test.ts` | 16 | 目录结构创建、文件生成、模式切换 |
| `tests/commands/run.test.ts` | 8 | 参数解析、Orchestrator 启动 |
| `tests/commands/provider.test.ts` | 12 | 配置增删查切、CLI 交互 |
| `tests/e2e/provider.e2e.test.ts` | 9 | 提供商管理端到端流程 |
| `tests/e2e/init-simple.e2e.test.ts` | 6 | 简单模式初始化端到端流程 |

### 零覆盖模块

| 模块 | 文件 | 未覆盖原因 |
|------|------|-----------|
| Playwright 测试 | `src/core/playwright-tester.ts` | 需要真实浏览器环境 |

---

## 四、覆盖率数据

运行 `npm run test:coverage` 可生成详细报告。当前数据（2026-04-27）：

| 指标 | 覆盖率 | 已覆盖 / 总数 |
|------|--------|---------------|
| Statements | **91.13%** | 1100 / 1207 |
| Branches | **81.96%** | 518 / 632 |
| Functions | **89.16%** | 181 / 203 |
| Lines | **91.08%** | 1073 / 1178 |

### 核心文件明细

| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 | 备注 |
|------|----------|----------|----------|------|
| `src/core/evaluator.ts` | **100%** | 84.84% | **100%** | 完整覆盖 |
| `src/core/error-handler.ts` | 95.4% | 94.73% | **100%** | 仅 4 行未覆盖 |
| `src/core/cost-tracker.ts` | **100%** | 90.9% | **100%** | 完整覆盖 |
| `src/core/state-manager.ts` | 95.5% | 86.11% | **100%** | 仅 3 行未覆盖 |
| `src/core/message-handler.ts` | 97.7% | 85.5% | **100%** | 仅 1 行未覆盖 |
| `src/core/failure-collector.ts` | 98.75% | 86.11% | **100%** | 仅 1 行未覆盖 |
| `src/core/logger.ts` | 97.87% | 91.66% | 85.71% | 高覆盖 |
| `src/core/graceful-shutdown.ts` | **100%** | 87.5% | **100%** | 完整覆盖 |
| `src/core/provider-manager.ts` | 94.47% | 85.54% | **100%** | 高覆盖 |
| `src/core/orchestrator.ts` | 92.51% | 76.42% | 95.23% | 高覆盖，DI 架构支持 mock 测试 |
| `src/commands/init.ts` | **100%** | 96.96% | **100%** | 完整覆盖 |
| `src/commands/provider.ts` | **100%** | 95% | **100%** | 完整覆盖 |
| `src/commands/run.ts` | **100%** | 97.1% | **100%** | 完整覆盖 |
| `src/agents/loader.ts` | 84.61% | 71.42% | 83.33% | 部分路径未覆盖 |
| `src/core/playwright-tester.ts` | 0% | 0% | 0% | 需要真实浏览器 |

---

*本文档与代码同步维护，后续新增测试后应更新此报告。*
