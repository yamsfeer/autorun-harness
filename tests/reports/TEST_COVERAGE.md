# Autorun Harness - 功能与测试覆盖报告

> 生成时间: 2026-04-25
> 对应提交: 基于当前工作目录的未提交修改（ evaluator / orchestrator 核心测试补充）

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
| 提供商管理 | `src/core/provider-manager.ts` | 多提供商池化管理、自动切换、状态持久化（.state.json） |
| 成本追踪 | `src/core/cost-tracker.ts` | Token 使用量记录、预算检查、成本报告 |
| 错误收集 | `src/core/failure-collector.ts` | 收集失败记录、生成 .harness/failure.md |
| 日志系统 | `src/core/logger.ts` | 结构化 JSON 日志、分级输出（debug/info/warn/error） |
| Playwright 测试 | `src/core/playwright-tester.ts` | 浏览器自动化测试辅助 |
| 优雅关闭 | `src/core/graceful-shutdown.ts` | SIGINT/SIGTERM 信号处理、清理回调 |
| Agent 加载器 | `src/agents/index.ts`, `loader.ts` | 加载 planner / generator / evaluator 的 prompt 定义 |
| 类型定义 | `src/types/index.ts`, `quality.ts` | 全项目 TypeScript 类型与接口 |

---

## 二、近期 Bug 修复记录（2026-04-25）

基于 `bug-report.md` 中三个项目的运行结果，修复了以下问题：

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

### 已覆盖模块（5 个文件，134 个测试）

| 测试文件 | 测试数 | 覆盖的功能点 |
|----------|--------|-------------|
| `src/core/error-handler.test.ts` | 38 | 错误创建与属性、重试逻辑（含指数退避与 maxDelay 上限）、超时、错误类型解析（network/rate_limit/usage_limit/api_timeout/evaluator_error 等）、格式化、退出指令、环境变量设置 |
| `src/core/message-handler.test.ts` | 24 | 工具调用解析（Read/Write/Edit/Bash/Glob/Grep）、文本行动声明提取、Markdown 标题提取、工具错误结果展示、result 消息处理（success/errors array/error.message/subtype/unknown 五种分支）、reset 清理 |
| `src/core/state-manager.test.ts` | 20 | 任务加载/保存、spec 读写、状态更新（含 completed_at）、尝试次数递增、备注追加、进度日志读写、依赖检查（completed 状态）、**outputs 文件存在性备选依赖检查（Bug-006）**、项目完成判断、统计更新 |
| `src/core/evaluator.test.ts` | 19 | **evaluate 主方法**（成功/失败/报告不存在/解析失败/外部异常全场景）、**阈值验证（Bug-001）**、**AC 状态回写（Bug-004）**、**默认报告生成含 evaluator_error 标记（Bug-005）**、报告保存路径、createEvaluator 工厂函数 |
| `src/core/orchestrator.test.ts` | 33 | **run() 边界与正常流程**（项目完成/无任务/成功/评估失败/重试/needs_human）、**Generator 错误处理**（rate_limit 切换成功/失败、普通错误）、**Token 预算**、**handleInterruption（Bug-002）**、**handleProviderSwitch**、**buildUserPrompt/formatExistingDocsInfo**、**runGenerator**、**getTaskAttempts/getSessionId/printFinalStats/getStatus** |

### Bug 修复的测试覆盖对照

| Bug | 修复位置 | 测试覆盖 | 测试方式 |
|-----|----------|----------|----------|
| Bug-001 | `evaluator.ts` `validateReportThreshold` | **是** | 直接测试私有方法：score<threshold 修正为 fail、score>=threshold 保持 pass、边界值 |
| Bug-002 | `orchestrator.ts` `handleInterruption` | **是** | 直接测试私有方法：有/无 currentTask 场景 |
| Bug-003 | `message-handler.ts` `handleResult` | **是** | 直接测试：errors array、error.message、error object、subtype、unknown 分支 |
| Bug-004 | `evaluator.ts` `updateTaskAcceptanceStatus` | **是** | 直接测试私有方法：pass/fail 回写、缺失 criteria_results、缺失 task |
| Bug-005 | `evaluator.ts` `createDefaultReport` + `orchestrator.ts` `handleTaskFailure` | **是** | Evaluator 的标记和报告生成已测试；Orchestrator 中 evaluator_error 不计入重试、回退 pending 已测试 |
| Bug-006 | `state-manager.ts` `areDependenciesMet` / `checkOutputsExist` | **是** | 通过 `getNextTask` 集成测试：outputs 存在时允许下游、outputs 缺失时阻塞 |

### 部分覆盖模块

| 模块 | 文件 | 已覆盖 | 未覆盖 | 测试难度 |
|------|------|--------|--------|----------|
| **编排器** | `src/core/orchestrator.ts` | `run()` 主循环、`handleInterruption`、`handleProviderSwitch`、`buildUserPrompt`、`runGenerator`、`getTaskAttempts` 等 | `initialize()`（Planner Agent 调用）、`applyCurrentProvider`（环境变量副作用）、`printFinalStats`（部分输出分支） | 高 |

### 未覆盖模块（10 个文件，零测试）

| 模块 | 文件 | 未覆盖原因 | 测试难度 |
|------|------|-----------|----------|
| 初始化命令 | `src/commands/init.ts` | 调用 Planner Agent SDK、文件系统操作 | 中 |
| 运行命令 | `src/commands/run.ts` | 调用 Orchestrator | 中 |
| Provider 命令 | `src/commands/provider.ts` | CLI 交互、文件系统 | 低 |
| 提供商管理 | `src/core/provider-manager.ts` | 文件系统、配置管理、状态持久化 | 中 |
| 成本追踪 | `src/core/cost-tracker.ts` | 文件系统、JSON 持久化 | 低 |
| 错误收集 | `src/core/failure-collector.ts` | 文件系统、Markdown 生成 | 低 |
| 日志系统 | `src/core/logger.ts` | 文件系统、JSON 日志 | 低 |
| Playwright 测试 | `src/core/playwright-tester.ts` | Playwright 依赖 | 中 |
| 优雅关闭 | `src/core/graceful-shutdown.ts` | 进程信号处理 | 中 |
| Agent 加载器 | `src/agents/loader.ts` | 文件读取、路径解析 | 低 |
| CLI 入口 | `src/index.ts` | 纯命令注册胶水代码 | 低 |
| 类型定义 | `src/types/*.ts` | 无运行时逻辑 | 无需测试 |

---

## 四、TODO 规划但未实现的功能

来自 `TODO.md`，以下功能尚未开发，自然不在测试范围内：

- **人工介入接口** — needs_human 时的通知（邮件/Webhook）、人工修复入口、恢复自动执行
- **Skills 库** — 按任务需求动态安装 skill（支付、认证、数据分析等）
- **Agent Browser 替代 Playwright** — 用 Agent Browser 执行验收测试
- **多账号切换** — CodeBuddy 账号池化管理、负载均衡
- **进度可视化** — Linear 看板风格 Dashboard、实时日志流
- **配置文件系统** — `.harness/config.json`（重试次数、阈值、模型、预算等）
- **多项目支持** — 并发运行多个项目、资源隔离
- **回滚机制** — Git 回滚到稳定版本、状态文件恢复
- **并发写入保护** — tasks.json 的并发写入锁机制

---

## 五、覆盖率数据

运行 `npm run test:coverage` 可生成详细报告。当前数据（2026-04-25）：

| 指标 | 覆盖率 | 已覆盖 / 总数 |
|------|--------|---------------|
| Statements | **42.33%** | 511 / 1207 |
| Branches | **42.56%** | 269 / 632 |
| Functions | **44.33%** | 90 / 203 |
| Lines | **42.35%** | 499 / 1178 |

### 核心文件明细

| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 | 备注 |
|------|----------|----------|----------|------|
| `src/core/evaluator.ts` | **100%** | 84.84% | **100%** | 完整覆盖 evaluate 主方法及所有私有方法 |
| `src/core/orchestrator.ts` | **78.85%** | 62.6% | 85.71% | 已覆盖 run()、handleInterruption、handleProviderSwitch、runGenerator 等 |
| `src/core/error-handler.ts` | 95.4% | 94.73% | **100%** | 仅 4 行未覆盖 |
| `src/core/message-handler.ts` | 97.7% | 85.5% | **100%** | 仅 1 行未覆盖 |
| `src/core/state-manager.ts` | 95.5% | 86.11% | **100%** | 仅 3 行未覆盖 |
| `src/core/cost-tracker.ts` | 0% | 0% | 0% | 未测试 |
| `src/core/failure-collector.ts` | 0% | 0% | 0% | 未测试 |
| `src/core/provider-manager.ts` | 2.01% | 0% | 0% | 未测试 |
| `src/core/logger.ts` | 0% | 0% | 0% | 未测试 |
| `src/core/graceful-shutdown.ts` | 3.84% | 0% | 0% | 未测试 |
| `src/core/playwright-tester.ts` | 0% | 0% | 0% | 未测试 |
| `src/commands/*` | 0% | 0% | 0% | 未测试 |
| `src/agents/loader.ts` | 30.76% | 28.57% | 33.33% | 部分路径未覆盖 |

---

## 六、下一步测试建议（按优先级）

### P0 — 堵住最大风险（已完成）
1. ~~**Orchestrator 单元测试** — 重点覆盖 `handleTaskFailure`（evaluator_error 分支）、`handleTaskError`、`handleInterruption`、`runGenerator` 的错误处理路径~~ ✅ 已完成
2. ~~**Evaluator evaluate() 主方法测试** — 覆盖成功/失败/报告不存在/解析失败/外部异常全场景~~ ✅ 已完成

### P1 — 质量保障模块
3. **ProviderManager 测试** — 提供商切换、rate_limit / usage_limit 处理、状态持久化
4. **CostTracker 测试** — Token 记录、预算超限检查、报告生成
5. **FailureCollector 测试** — 失败记录收集、failure.md 生成

### P2 — 命令层与辅助模块
6. **commands/init.ts 测试** — 目录结构创建、文件生成
7. **commands/provider.ts 测试** — 配置增删查切
8. **Logger 测试** — 日志级别过滤、文件输出
9. **GracefulShutdown 测试** — 信号处理、回调执行
10. **Orchestrator `initialize()` 方法** — Planner Agent 调用、模式切换、provider 应用

---

*本文档与代码同步维护，后续新增测试后应更新此报告。*
