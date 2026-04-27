# Autorun Harness 测试报告

> 生成时间: 2026-04-27
> 测试框架: Vitest v4.1.5
> 覆盖率工具: @vitest/coverage-v8

---

## 一、测试概览

| 指标 | 数值 |
|------|------|
| 测试文件 | 17 个 |
| 总测试数 | 293 个 |
| 通过 | 293 个 |
| 失败 | 0 个 |
| 代码总行数 | 1,178 行 |
| 语句覆盖率 | 91.13% (1100/1207) |
| 分支覆盖率 | 81.96% (518/632) |
| 函数覆盖率 | 89.16% (181/203) |
| 行覆盖率 | 91.08% (1073/1178) |

---

## 二、各模块覆盖率明细

### 已充分覆盖的模块

| 模块 | 文件 | 语句 | 分支 | 函数 | 行 | 测试数 |
|------|------|------|------|------|-----|--------|
| 初始化命令 | `commands/init.ts` | 100% | 96.96% | 100% | 100% | 16 |
| Provider 命令 | `commands/provider.ts` | 100% | 95% | 100% | 100% | 12 |
| 运行命令 | `commands/run.ts` | 100% | 97.1% | 100% | 100% | 8 |
| 错误处理 | `error-handler.ts` | 95.40% | 94.73% | 100% | 95.29% | 38 |
| 评估器 | `evaluator.ts` | 100% | 84.84% | 100% | 100% | 19 |
| 成本追踪 | `cost-tracker.ts` | 100% | 90.9% | 100% | 100% | 13 |
| 错误收集 | `failure-collector.ts` | 98.75% | 86.11% | 100% | 98.66% | 14 |
| 优雅关闭 | `graceful-shutdown.ts` | 100% | 87.5% | 100% | 100% | 8 |
| 日志系统 | `logger.ts` | 97.87% | 91.66% | 85.71% | 97.87% | 23 |
| 消息处理 | `message-handler.ts` | 97.7% | 85.5% | 100% | 98.79% | 24 |
| 状态管理 | `state-manager.ts` | 95.5% | 86.11% | 100% | 96.42% | 20 |
| 编排器 | `orchestrator.ts` | 92.51% | 76.42% | 95.23% | 92.47% | 12 |
| 提供商管理 | `provider-manager.ts` | 94.47% | 85.54% | 100% | 94.3% | 31 |
| Agent 加载器 | `agents/loader.ts` | 84.61% | 71.42% | 83.33% | 84.61% | — |

### 零覆盖的模块

| 模块 | 文件 | 说明 |
|------|------|------|
| Playwright 测试 | `core/playwright-tester.ts` | 浏览器自动化工具类，需要真实浏览器环境 |

---

## 三、Bug 修复回归测试覆盖

| Bug ID | 修复文件 | 测试覆盖 | 测试位置 |
|--------|----------|----------|----------|
| Bug-001 阈值逻辑错误 | `evaluator.ts` | ✅ 已覆盖 | `evaluator.test.ts` — validateReportThreshold |
| Bug-002 中断状态保存 | `orchestrator.ts` | ✅ 已覆盖 | `graceful-shutdown.test.ts` + `orchestrator.test.ts` |
| Bug-003 未知错误信息 | `error-handler.ts` + `message-handler.ts` | ✅ 已覆盖 | `error-handler.test.ts` + `message-handler.test.ts` |
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

### 中风险

1. **`orchestrator.ts` initialize() 方法** — 初始化阶段调用 Planner Agent 的完整流程（依赖真实 Agent SDK 调用）
2. **`orchestrator.ts` runGenerator() 方法** — Generator Agent 调用、消息流处理（部分通过 DI mock 覆盖）
3. **`playwright-tester.ts`** — Web 应用评估辅助，需要真实浏览器环境

### 低风险

4. **`agents/loader.ts`** — Prompt 文件加载，84.61% 覆盖率

---

## 六、端到端测试

| 测试文件 | 测试数 | 说明 |
|----------|--------|------|
| `tests/e2e/provider.e2e.test.ts` | 9 | 提供商管理端到端流程 |
| `tests/e2e/init-simple.e2e.test.ts` | 6 | 简单模式初始化端到端流程 |

---

## 七、测试执行命令

```bash
# 运行全部测试
npm test

# 监听模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 交互式测试界面
npm run test:ui

# 预览覆盖率 HTML 报告
npm run test:coverage:preview
```

---

*本报告基于 Vitest 自动运行结果，结合手动整理。*
