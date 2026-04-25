# Autorun Harness 测试报告

> 生成时间: 2026-04-25
> 测试框架: Vitest v4.1.5
> 覆盖率工具: @vitest/coverage-v8

---

## 一、测试概览

| 指标 | 数值 |
|------|------|
| 测试文件 | 5 个 |
| 总测试数 | 106 个 |
| 通过 | 106 个 |
| 失败 | 0 个 |
| 代码总行数 | 1,178 行 |
| 语句覆盖率 | 35.62% (430/1207) |
| 分支覆盖率 | 36.55% (231/632) |
| 函数覆盖率 | 39.90% (81/203) |
| 行覆盖率 | 35.65% (420/1178) |

---

## 二、各模块覆盖率明细

### 已充分覆盖的模块

| 模块 | 文件 | 语句 | 分支 | 函数 | 行 | 测试数 |
|------|------|------|------|------|-----|--------|
| 错误处理 | `error-handler.ts` | 95.40% | 94.73% | 100% | 95.29% | 38 |
| 消息处理 | `message-handler.ts` | 96.55% | 84.05% | 100% | 98.79% | 24 |
| 状态管理 | `state-manager.ts` | 95.50% | 86.11% | 100% | 96.42% | 20 |
| 编排器 | `orchestrator.ts` | 61.67% | 40.65% | 52.38% | 61.94% | 12 |
| 评估器 | `evaluator.ts` | 41.42% | 54.54% | 83.33% | 39.70% | 12 |

### 零覆盖的模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 初始化命令 | `commands/init.ts` | 调用 Planner Agent SDK |
| 运行命令 | `commands/run.ts` | CLI 胶水代码 |
| Provider 命令 | `commands/provider.ts` | CLI 交互 |
| 成本追踪 | `core/cost-tracker.ts` | Token 记录与预算 |
| 错误收集 | `core/failure-collector.ts` | failure.md 生成 |
| 日志系统 | `core/logger.ts` | JSON 结构化日志 |
| Playwright 测试 | `core/playwright-tester.ts` | 浏览器自动化 |
| 优雅关闭 | `core/graceful-shutdown.ts` | 信号处理 |
| 提供商管理 | `core/provider-manager.ts` | 多提供商切换 |
| Agent 加载器 | `agents/loader.ts` | Prompt 文件加载 |

---

## 三、Bug 修复回归测试覆盖

| Bug ID | 修复文件 | 测试覆盖 | 测试位置 |
|--------|----------|----------|----------|
| Bug-001 阈值逻辑错误 | `evaluator.ts` | ✅ 已覆盖 | `evaluator.test.ts` — validateReportThreshold |
| Bug-002 中断状态保存 | `orchestrator.ts` | ⚠️ 间接覆盖 | `orchestrator.test.ts` — 验证状态流转 |
| Bug-003 未知错误信息 | `message-handler.ts` | ✅ 已覆盖 | `message-handler.test.ts` — handleResult 多分支 |
| Bug-004 AC 状态未回写 | `evaluator.ts` | ✅ 已覆盖 | `evaluator.test.ts` — updateTaskAcceptanceStatus |
| Bug-005 评估器崩溃误判 | `evaluator.ts` + `orchestrator.ts` | ✅ 已覆盖 | `evaluator.test.ts` — evaluator_error 标记；`orchestrator.test.ts` — 不计重试 |
| Bug-006 下游任务阻塞 | `state-manager.ts` | ✅ 已覆盖 | `state-manager.test.ts` — outputs 备选依赖检查 |

---

## 四、Orchestrator 核心流程测试覆盖

| 流程分支 | 测试文件 | 测试名称 |
|----------|----------|----------|
| 项目已完成 → 结束循环 | `orchestrator.test.ts` | 项目已完成时应直接结束 |
| 无任务 → 结束循环 | `orchestrator.test.ts` | 没有可执行任务时应结束循环 |
| 任务成功 + 评估通过 → completed | `orchestrator.test.ts` | 任务生成成功且评估通过 |
| 评估失败 + attempts < 3 → pending | `orchestrator.test.ts` | 评估失败且 attempts < 3 |
| 评估失败 + attempts >= 3 → needs_human | `orchestrator.test.ts` | 评估失败且 attempts >= 3 |
| evaluator_error → 不计重试 | `orchestrator.test.ts` | evaluator_error=true 时不增加尝试次数 |
| rate_limit → 切换成功 → 重试 | `orchestrator.test.ts` | generator 抛 rate_limit → provider 切换成功 |
| rate_limit → 切换失败 → needs_human | `orchestrator.test.ts` | generator 抛 rate_limit → provider 切换失败 |
| 普通错误 + attempts < 3 → pending | `orchestrator.test.ts` | generator 抛普通错误且 attempts < 3 |
| 普通错误 + attempts >= 3 → needs_human | `orchestrator.test.ts` | generator 抛普通错误且 attempts >= 3 |
| Token 预算耗尽 → 提前结束 | `orchestrator.test.ts` | Token 预算耗尽时应提前结束 |

---

## 五、未覆盖的风险点

### 高风险（核心业务逻辑无测试保护）

1. **`orchestrator.ts` initialize() 方法** — 初始化阶段调用 Planner Agent 的完整流程
2. **`orchestrator.ts` runGenerator() 方法** — Generator Agent 调用、消息流处理、token 记录
3. **`commands/init.ts`** — 项目初始化命令的端到端流程
4. **`provider-manager.ts`** — 提供商切换的完整状态机

### 中风险（质量保障模块无测试）

5. **`cost-tracker.ts`** — 预算超限时应抛出错误中断执行
6. **`failure-collector.ts`** — 失败记录收集和 Markdown 生成
7. **`logger.ts`** — 日志级别过滤和文件输出

### 低风险（边缘功能）

8. **`playwright-tester.ts`** — Web 应用评估辅助
9. **`graceful-shutdown.ts`** — 信号处理（难以在单测中模拟）
10. **`commands/provider.ts`** — CLI 配置管理

---

## 六、测试执行命令

```bash
# 运行全部测试
npm test

# 监听模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

---

*本报告由 Vitest 自动生成，结合手动整理。*
