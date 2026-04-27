# Autorun Harness 业务逻辑说明

> 日期：2026-04-25
> 说明：本文档描述框架的核心业务流程，并结合测试代码说明各模块的交互逻辑

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户输入层                                │
│  PRD 文件 / 口语化描述 / 已有文档目录                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      初始化阶段（一次性）                         │
│                                                                  │
│   CLI init 命令 → Orchestrator.initialize(prd, projectName)     │
│                          │                                       │
│                          ▼                                       │
│              ┌─────────────────────┐                            │
│              │   initializeModules  │  加载 logger/cost/provider │
│              └─────────────────────┘                            │
│                          │                                       │
│                          ▼                                       │
│              ┌─────────────────────┐                            │
│              │   Planner Agent SDK  │  分析 PRD，生成文档体系     │
│              │   (query() 异步迭代)  │                            │
│              └─────────────────────┘                            │
│                          │                                       │
│                          ▼                                       │
│              产出：CLAUDE.md / spec.md / tasks.json / docs/      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      执行阶段（循环，每任务一轮）                  │
│                                                                  │
│   CLI run 命令 → Orchestrator.run(maxTasks, maxTokens)          │
│                          │                                       │
│         ┌────────────────┴────────────────┐                     │
│         │           while 循环              │                     │
│         │  ┌─────────────────────────────┐ │                     │
│         │  │ 1. 检查项目是否已完成       │ │                     │
│         │  │    isProjectComplete()      │ │                     │
│         │  └─────────────────────────────┘ │                     │
│         │              │ yes → break        │                     │
│         │              │ no                 │                     │
│         │  ┌─────────────────────────────┐ │                     │
│         │  │ 2. 获取下一个待处理任务     │ │                     │
│         │  │    getNextTask()            │ │                     │
│         │  └─────────────────────────────┘ │                     │
│         │              │ null → break       │                     │
│         │              │ task               │                     │
│         │  ┌─────────────────────────────┐ │                     │
│         │  │ 3. 标记任务为 in_progress   │ │                     │
│         │  │    updateTaskStatus()       │ │                     │
│         │  └─────────────────────────────┘ │                     │
│         │              │                    │                     │
│         │  ┌─────────────────────────────┐ │                     │
│         │  │ 4. Generator Agent 执行     │ │                     │
│         │  │    runGenerator(task)       │ │                     │
│         │  │    → 可能抛错               │ │                     │
│         │  └─────────────────────────────┘ │                     │
│         │              │                    │                     │
│         │  ┌─────────────────────────────┐ │                     │
│         │  │ 5. Evaluator 评估           │ │                     │
│         │  │    evaluate(task, attempt)  │ │                     │
│         │  │    → 返回报告               │ │                     │
│         │  └─────────────────────────────┘ │                     │
│         │              │                    │                     │
│         │  ┌─────────────────────────────┐ │                     │
│         │  │ 6. 判断结果                 │ │                     │
│         │  │    pass → completed         │ │                     │
│         │  │    fail → 重试/needs_human  │ │                     │
│         │  │    error → catch 处理       │ │                     │
│         │  └─────────────────────────────┘ │                     │
│         │              │                    │                     │
│         │  ┌─────────────────────────────┐ │                     │
│         │  │ 7. 检查 Token 预算          │ │                     │
│         │  │    getTotalTokens()         │ │                     │
│         │  └─────────────────────────────┘ │                     │
│         │              │ over → break       │                     │
│         │              └────────────────────┘                     │
│         └───────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、初始化阶段详细流程

### 2.1 触发条件

用户执行：
```bash
autorun-harness init ./my-project --prd ./PRD.md
# 或
autorun-harness init ./my-project --text "构建一个待办应用" --mode simple
```

### 2.2 执行步骤

**步骤 1：命令层解析参数**
- `commands/init.ts` 读取 `--prd`、`--text`、`--mode`、`--docs` 等参数
- 构造 `InitializeOptions` 对象
- 实例化 `Orchestrator`，调用 `orchestrator.initialize(prdContent, projectName, options)`

**步骤 2：Orchestrator 初始化模块**
```typescript
await this.initializeModules();
```
这一行会依次：
1. `logger.initialize()` — 创建日志目录和文件
2. `costTracker.initialize()` — 加载历史成本数据
3. `failureCollector.initialize()` — 加载历史失败记录
4. `providerManager.initialize()` — 读取 `~/.config/autorun-harness/providers/*.json`
5. `applyCurrentProvider()` — 将当前 provider 配置写入 `process.env`
6. `graceful-shutdown.initialize()` — 注册 SIGINT/SIGTERM 信号处理器

**步骤 3：调用 Planner Agent**
```typescript
const queryResult = query({ prompt: userPrompt, options: { ... } });
```
- 从 `prompts/planner-full.md` 或 `prompts/planner-simple.md` 加载系统提示词
- 构造用户提示词（包含 PRD 内容、已有文档列表、输出要求）
- 调用 Anthropic Agent SDK，允许工具：`Read`、`Write`、`Edit`、`Bash`、`Glob`、`Grep`
- 监听消息流，通过 `messageHandler` 实时显示进度

**步骤 4：处理 Agent 执行结果**
- 如果 `success === true`：打印完成信息，列出生成的文件路径
- 如果 `success === false`：打印失败信息
- 如果抛错（如 rate_limit）：触发 provider 切换，不抛出错误

### 2.3 产出物

| 文件 | 说明 |
|------|------|
| `CLAUDE.md` | 文档索引（完整模式） |
| `docs/PRD.md` | 原始需求文档 |
| `docs/DESIGN.md` | 设计系统 |
| `docs/API_CONTRACT.md` | 前后端 API 契约 |
| `docs/DATA_MODEL.md` | 数据库表结构 |
| `docs/UE_FLOW.md` | 交互逻辑状态机 |
| `docs/FLOWCHART.md` | 业务流程图 |
| `.harness/spec.md` | 技术规格（简洁版） |
| `.harness/tasks.json` | 任务列表（含验收标准） |
| `.harness/progress.txt` | 执行进度日志 |
| `init.sh` | 项目初始化脚本 |

---

## 三、执行阶段详细流程

### 3.1 触发条件

用户执行：
```bash
autorun-harness run ./my-project --max-tasks 10 --max-tokens 500000
```

### 3.2 执行步骤

**步骤 1：初始化模块**
与初始化阶段相同，加载所有子模块状态。

**步骤 2：设置 Token 预算（可选）**
```typescript
if (maxTokens) {
  this.costTracker = createCostTracker(this.harnessDir, { maxTotalTokens: maxTokens });
  await this.costTracker.initialize();
}
```

**步骤 3：主循环**
```typescript
while (taskCount < maxTasks) {
  // ...
}
```

**步骤 4：检查项目完成状态**
```typescript
if (await this.stateManager.isProjectComplete()) {
  // 所有任务都是 completed 或 needs_human
  break;
}
```

**步骤 5：获取下一个任务**
```typescript
const nextTask = await this.stateManager.getNextTask();
```

`getNextTask()` 的优先级逻辑（见测试 `state-manager.test.ts`）：
1. 优先找 `in_progress` 状态的任务（上次中断恢复）
2. 然后找 `pending` 状态的任务
3. 每个任务必须通过依赖检查：`areDependenciesMet()`

依赖检查规则（Bug-006 修复后）：
- 主规则：依赖任务状态为 `completed`
- 备选规则：依赖任务定义了 `outputs` 且所有产出文件都存在

**步骤 6：标记任务为 in_progress**
```typescript
await this.stateManager.updateTaskStatus(nextTask.id, 'in_progress');
this.currentTask = nextTask;
this.currentPhase = 'generation';
```

**步骤 7：调用 Generator Agent**
```typescript
await this.runGenerator(nextTask);
```

`runGenerator()` 内部逻辑：
1. 加载 `prompts/generator.md` 作为系统提示词
2. 构造用户提示词（任务详情 + spec.md）
3. 调用 `query()` 启动 Generator Agent
4. Agent 使用 `Write`/`Edit`/`Bash` 等工具实现代码
5. 记录 token 使用量到 `costTracker`
6. 检查 Agent 执行结果，失败时抛出错误

**步骤 8：调用 Evaluator**
```typescript
const report = await this.evaluator.evaluate(nextTask, attempts + 1);
```

`evaluate()` 内部逻辑（见测试 `evaluator.test.ts`）：
1. 加载 `prompts/evaluator.md` 作为系统提示词
2. 构造用户提示词（任务详情 + spec.md + 评估要求）
3. 调用 `query()` 启动 Evaluator Agent
4. Agent 运行测试、评分、生成报告
5. 读取 `.harness/reports/evaluator_report_<task-id>_<attempt>.json`
6. **阈值校验（Bug-001 修复）**：强制修正 `final_decision`
7. **AC 状态回写（Bug-004 修复）**：将结果同步到 `tasks.json`
8. 如果报告未生成或解析失败，创建默认报告
9. 如果评估器自身崩溃，标记 `evaluator_error = true`

**步骤 9：处理评估结果**

```
if (report.final_decision === 'pass') {
  await this.handleTaskSuccess(task, report);     // → completed
} else {
  await this.handleTaskFailure(task, report, ...); // → pending / needs_human
}
```

`handleTaskSuccess()`：
1. `updateTaskStatus(task.id, 'completed')`
2. `appendProgress({ status: 'completed', ... })`
3. `logger.info('任务完成')`

`handleTaskFailure()` 的分支逻辑（见测试 `orchestrator.test.ts`）：

```
if (report.evaluator_error) {
  // Bug-005 修复：评估器自身崩溃
  addTaskNote("评估器崩溃...");
  appendProgress({ status: 'pending' });
  updateTaskStatus(task.id, 'pending');   // 不计入重试
  return;
}

// 正常评估失败
failureCollector.recordFromEvaluatorReport(...);
const newAttempts = await incrementTaskAttempts(task.id);

if (newAttempts >= 3) {
  updateTaskStatus(task.id, 'needs_human');
  appendProgress({ status: 'needs_human' });
} else {
  updateTaskStatus(task.id, 'pending');
  appendProgress({ status: 'pending' });
}
```

**步骤 10：错误处理**

如果 `runGenerator()` 或 `evaluate()` 抛错：

```
catch (error) {
  if (shouldSwitchProvider(error)) {
    // rate_limit / usage_limit
    const switched = await handleProviderSwitch(errorType);
    if (switched) {
      updateTaskStatus(task.id, 'pending');  // 重试
      continue;
    } else {
      await handleTaskError(task, error, true);  // 全耗尽
      break;
    }
  }
  await handleTaskError(task, error, false);  // 普通错误
}
```

`handleTaskError()` 逻辑：
1. `logger.error()` 记录错误
2. `failureCollector.recordFailure()` 收集错误
3. `incrementTaskAttempts(task.id)`
4. 如果 `allProvidersExhausted || attempts >= 3` → `needs_human`
5. 否则 → `pending`

**步骤 11：Token 预算检查**
```typescript
if (maxTokens) {
  const totalTokens = this.costTracker.getTotalTokens();
  if (totalTokens >= maxTokens) {
    logger.warn('Token 预算已用完');
    break;
  }
}
```

**步骤 12：输出最终统计**
```typescript
await this.printFinalStats(taskCount);
```
输出：已处理任务数、各状态任务数、Token 使用报告、提供商状态、错误记录数。

---

## 四、任务状态流转

```
                            ┌─────────────┐
                            │   pending   │
                            └──────┬──────┘
                                   │ getNextTask()
                                   ▼
                            ┌─────────────┐
                            │ in_progress │◄────┐
                            └──────┬──────┘     │
                                   │            │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       ┌─────────────┐    ┌─────────────┐     ┌─────────────┐
       │  completed  │    │ evaluator   │     │ generation  │
       │             │    │   error     │     │   error     │
       └─────────────┘    └──────┬──────┘     └──────┬──────┘
                                 │                    │
                                 │ evaluator_error    │ rate_limit
                                 │   = true           │ 切换成功
                                 ▼                    │
                            ┌─────────────┐          │
                            │   pending   │──────────┘
                            │  (不计重试) │
                            └──────┬──────┘
                                   │ 评估失败 3 次
                                   │ 或 generator 失败 3 次
                                   │ 或 provider 全耗尽
                                   ▼
                            ┌─────────────┐
                            │ needs_human │
                            └─────────────┘
```

---

## 五、通过测试验证的业务逻辑

### 5.1 error-handler.ts

| 测试 | 验证的业务逻辑 |
|------|---------------|
| `createError` | 错误对象必须包含 `type`、`retryable`、`shouldExit`、`context` |
| `shouldSwitchProvider` | 只有 `rate_limit` 和 `usage_limit` 需要切换提供商 |
| `withRetry` | 指数退避：`delay = baseDelay * 2^(attempt-1)`，受 `maxDelay` 上限约束 |
| `withTimeout` | 超时后抛出 `api_timeout` 错误 |
| `parseErrorType` | 错误消息分类规则：`429`→rate_limit，`timeout`→api_timeout，`ECONNREFUSED`→network |

### 5.2 message-handler.ts

| 测试 | 验证的业务逻辑 |
|------|---------------|
| 工具调用解析 | `Read`/`Write`/`Edit`/`Bash`/`Glob`/`Grep` 六种工具各对应一个图标和动作描述 |
| 文本提取 | 以"我需要/让我/首先"开头的中文句子，或 Markdown 标题（`## xxx`），会被提取为行动声明 |
| 工具错误展示 | `tool_result` 的 `is_error=true` 时显示 `❌ ToolName 失败` |
| `handleResult` | `success` 时 `error` 为 `undefined`；`fail` 时按 `errors[]` → `error.message` → `subtype` 的优先级提取错误信息 |

### 5.3 state-manager.ts

| 测试 | 验证的业务逻辑 |
|------|---------------|
| `updateTaskStatus('completed')` | 自动设置 `completed_at` 为当前时间 |
| `updateTaskStatus` | 自动更新 `statistics` 对象中各状态的计数 |
| `getNextTask` | 优先返回 `in_progress` 状态的任务（中断恢复） |
| `areDependenciesMet` | 依赖任务为 `completed` 时通过 |
| `areDependenciesMet` (Bug-006) | 依赖任务非 `completed` 但 `outputs` 文件都存在时，也视为通过 |
| `checkOutputsExist` | 检查的是项目根目录下的相对路径（`path.join(harnessDir, '..', outputPath)`） |

### 5.4 evaluator.ts

| 测试 | 验证的业务逻辑 |
|------|---------------|
| `validateReportThreshold` (Bug-001) | `total_weighted_score < threshold` 时，`final_decision` 强制修正为 `fail`，`overall_result` 同步修正 |
| `updateTaskAcceptanceStatus` (Bug-004) | 评估报告的 `criteria_results` 与 `tasks.json` 中的 `acceptance_criteria` 按 `criterion_id` 匹配，逐条更新 `status` |
| `createDefaultReport` (Bug-005) | `evaluatorError=true` 时报告标记 `evaluator_error: true`，且所有 AC 的 `result` 为 `fail` |
| `createDefaultReport` | `pass` 时 `total_weighted_score = 0.7`，`fail` 时 `total_weighted_score = 0.35`，`threshold = 0.75` |
| `saveReport` | 报告保存到 `.harness/reports/evaluator_report_<task-id>_<attempt>.json` |

### 5.5 orchestrator.ts

| 测试 | 验证的业务逻辑 |
|------|---------------|
| 项目已完成 | `isProjectComplete() === true` 时直接 break，不调用 `getNextTask` |
| 无任务 | `getNextTask() === null` 时 break，不更新任何任务状态 |
| 任务成功 | 状态流转：`pending` → `in_progress` → `completed`，`appendProgress` 记录 `completed` |
| 评估失败 | `incrementTaskAttempts` 增加计数，`< 3` 时回退 `pending`，`>= 3` 时标记 `needs_human` |
| evaluator_error | **不调用** `incrementTaskAttempts`，直接回退 `pending`，添加备注说明是评估器崩溃 |
| rate_limit 切换成功 | 调用 `providerManager.handleRateLimit()`，回退 `pending`，`continue` 重试同一任务 |
| rate_limit 切换失败 | 标记 `needs_human`，`break` 退出循环 |
| 普通错误 | 增加 attempts，`< 3` → `pending`，`>= 3` → `needs_human` |
| Token 预算 | `getTotalTokens() >= maxTokens` 时 `break` |
| `getStatus()` | 返回 `{ isComplete, statistics, nextTask }` |

---

## 六、关键数据流

### 6.1 一次完整任务执行的数据流

```
User: run ./my-project --max-tasks 10
  │
  ▼
commands/run.ts
  │ 构造 Orchestrator(projectDir)
  │
  ▼
Orchestrator.run(10)
  │
  ├──► StateManager.loadTasks() ──► 读取 .harness/tasks.json
  │
  ├──► StateManager.getNextTask()
  │      ├──► 遍历 tasks 找 in_progress / pending
  │      └──► areDependenciesMet() ──► 检查上游任务状态或 outputs 文件
  │
  ├──► StateManager.updateTaskStatus(task.id, 'in_progress')
  │      └──► 写回 .harness/tasks.json
  │
  ├──► Orchestrator.runGenerator(task)
  │      ├──► AgentLoader.loadGenerator() ──► 读取 prompts/generator.md
  │      ├──► StateManager.loadSpec() ──► 读取 .harness/spec.md
  │      ├──► query({ prompt, systemPrompt }) ──► 调用 Anthropic SDK
  │      ├──► MessageHandler.handleMessage() ──► 实时显示进度
  │      ├──► MessageHandler.handleResult() ──► 解析执行结果
  │      ├──► CostTracker.record() ──► 记录 token ──► 写 .harness/costs.json
  │      └──► 如果失败：抛 Error
  │
  ├──► Evaluator.evaluate(task, attempt)
  │      ├──► AgentLoader.loadEvaluator() ──► 读取 prompts/evaluator.md
  │      ├──► query({ prompt, systemPrompt }) ──► 调用 Anthropic SDK
  │      ├──► 读取 .harness/reports/evaluator_report_T001_1.json
  │      ├──► validateReportThreshold() ──► 修正阈值逻辑
  │      ├──► updateTaskAcceptanceStatus() ──► 写回 tasks.json
  │      └──► 返回 EvaluatorReport
  │
  ├──► handleTaskSuccess() 或 handleTaskFailure()
  │      ├──► StateManager.updateTaskStatus() ──► completed / pending / needs_human
  │      ├──► StateManager.appendProgress() ──► 追加到 .harness/progress.txt
  │      ├──► FailureCollector.recordFailure() ──► 追加到 .harness/failure.md
  │      └──► Logger.info/warn/error() ──► 追加到 .harness/logs/*.json
  │
  └──► CostTracker.getTotalTokens() ──► 检查预算

循环结束后：
  ├──► StateManager.getStatistics()
  ├──► CostTracker.printReport()
  ├──► ProviderManager.printStatus()
  └──► FailureCollector.getRecords()
```

### 6.2 信号中断时的数据流

```
SIGINT / SIGTERM
  │
  ▼
GracefulShutdown.handleSignal()
  │
  ▼
Orchestrator.handleInterruption()
  │
  ├──► Logger.warn('进程被中断...')
  ├──► StateManager.updateTaskStatus(task.id, 'in_progress') ──► 写 tasks.json
  ├──► StateManager.appendProgress({ status: 'interrupted' }) ──► 写 progress.txt
  └──► FailureCollector.recordFailure({ agentPhase: 'generation|evaluation' })
```

---

*本文档基于代码审查和测试用例整理，与实际运行行为一致。*
