# Orchestrator 重构说明：从硬编码依赖到依赖注入

> 日期：2026-04-25
> 背景：在修复 Bug-001 ~ Bug-006 的过程中，发现 Orchestrator 模块因架构设计导致无法有效编写单元测试

---

## 一、问题：为什么 Orchestrator 无法测试

### 1.1 架构现状

Orchestrator 是框架的**核心调度器**，负责串联所有子模块完成自动化开发流程。在其最初的实现中，构造函数内部直接创建了所有依赖：

```typescript
// 重构前的构造函数
constructor(projectDir: string) {
  this.projectDir = projectDir;
  this.harnessDir = path.join(projectDir, '.harness');
  this.stateManager = new StateManager(projectDir);     // 直接 new
  this.agentLoader = createAgentLoader();                // 直接调用工厂
  this.evaluator = createEvaluator(projectDir);          // 直接调用工厂
  this.logger = createLogger(this.harnessDir, ...);     // 直接调用工厂
  this.costTracker = createCostTracker(this.harnessDir); // 直接调用工厂
  this.failureCollector = createFailureCollector(...);   // 直接调用工厂
  this.providerManager = getProviderManager();           // 直接调用单例
  this.messageHandler = createMessageHandler();          // 直接调用工厂
}
```

这种写法的本质问题是：**类自己决定了它依赖谁、怎么创建**。这在小型脚本中很常见，但在需要测试时就成了灾难。

### 1.2 测试困境的具体表现

假设我们想测试 `Orchestrator.run()` 中最基本的一个场景：

> "当没有可执行任务时，run() 应该立即结束并输出统计信息"

测试代码需要做什么？

**方案 A：让 StateManager 真的去读写文件**

```typescript
it('没有任务时应直接结束', async () => {
  // 必须在磁盘上创建一个完整的 .harness/ 目录结构
  const tmpDir = await mkdtemp('/tmp/test-');
  await mkdir(path.join(tmpDir, '.harness'));
  await writeFile(
    path.join(tmpDir, '.harness', 'tasks.json'),
    JSON.stringify({ tasks: [], statistics: { ... } })
  );
  
  const orchestrator = new Orchestrator(tmpDir);
  await orchestrator.run();
  
  // 检查控制台输出？检查文件？都很麻烦
  // 而且 Logger、CostTracker、FailureCollector 都会真的写文件
});
```

这个测试的问题：
- 测试跑得很慢（大量文件 I/O）
- 测试结束后要清理 5+ 个文件
- 无法精确控制 `getNextTask()` 的返回值（它由 tasks.json 的内容决定）
- 无法断言 "`run()` 是否调用了 `logger.info('orchestrator', '所有任务已完成')""

**方案 B：用 vi.mock 在模块级别 mock 所有依赖**

```typescript
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('./state-manager.js', () => ({ StateManager: vi.fn() }));
vi.mock('./logger.js', () => ({ createLogger: vi.fn() }));
// ... 还要 mock 6 个模块
```

这个方案的问题：
- mock 声明放在模块顶部，所有测试共享同一套 mock
- 不同测试需要不同的 mock 行为时，必须在每个测试里重置 mock
- mock 的是模块导出，不是实例方法。比如 `StateManager` 被 mock 后，所有 `new StateManager()` 返回的都是同一个对象
- 代码和测试的耦合度极高，改一个 import 路径测试就崩

**方案 C：重构为依赖注入（本文档推荐的方案）**

见下文。

### 1.3 根本问题总结

| 问题 | 说明 |
|------|------|
| **无法隔离被测单元** | 测 Orchestrator 时，StateManager / Logger / Evaluator 都会真的运行 |
| **无法精确控制输入** | 想让 `getNextTask()` 返回 null，必须先写 tasks.json |
| **无法断言副作用** | 想知道 `run()` 是否调用了 `updateTaskStatus('T001', 'completed')`，必须去读文件验证 |
| **测试不稳定** | 文件系统操作、时间戳、随机数都会导致同样的测试有时通过有时失败 |
| **测试代码比业务代码长** | 为了准备环境写的 setup 代码，可能是被测代码的 3~5 倍 |

---

## 二、解决方案：依赖注入

### 2.1 什么是依赖注入（DI）

依赖注入的核心理念很简单：

> **类不应该自己创建依赖，而应该由外部传入。**

用一句话概括改前和改后的区别：

| | 改前（控制反转前） | 改后（依赖注入后） |
|---|---|---|
| 谁决定依赖的实现 | Orchestrator 自己 | Orchestrator 的调用方 |
| 谁创建依赖实例 | 构造函数内部 `new` / `createXxx()` | 调用方创建后传入 |
| 测试时怎么替换 | 几乎不可能 | 直接传入 mock 对象 |

这不是什么高深的设计模式，只是把 `new` 操作从类内部搬到了类外部。

### 2.2 具体改动

**只改构造函数**，不改任何业务方法。

改前：
```typescript
constructor(projectDir: string) {
  this.stateManager = new StateManager(projectDir);
  // ...
}
```

改后：
```typescript
constructor(
  projectDir: string,
  deps?: {
    stateManager?: StateManager;
    evaluator?: Evaluator;
    logger?: Logger;
    costTracker?: CostTracker;
    failureCollector?: FailureCollector;
    providerManager?: ProviderManager;
    messageHandler?: MessageHandler;
  }
) {
  this.stateManager = deps?.stateManager ?? new StateManager(projectDir);
  this.evaluator = deps?.evaluator ?? createEvaluator(projectDir);
  // ... 其余同理
}
```

**生产代码调用完全不变：**
```typescript
// commands/run.ts
const orchestrator = new Orchestrator(projectDir);
// deps 不传，走 ?? 右侧的默认创建逻辑，行为与改前完全一致
```

**测试代码可以注入 mock：**
```typescript
const mockStateManager = {
  getNextTask: vi.fn().mockResolvedValue(null),
  isProjectComplete: vi.fn().mockResolvedValue(true),
  // ...
};

const orchestrator = new Orchestrator('/tmp/test', {
  stateManager: mockStateManager as any,
});

await orchestrator.run();

expect(mockStateManager.getNextTask).toHaveBeenCalled();
```

### 2.3 为什么用 `??` 而不是强制传入所有依赖

方案有很多，最极端的是**强制构造参数**：
```typescript
// 不推荐：调用方必须传入 7 个依赖
constructor(
  projectDir: string,
  stateManager: StateManager,
  evaluator: Evaluator,
  logger: Logger,
  // ... 还有 4 个
) {}
```

这样做的问题是生产代码变得很丑：
```typescript
// commands/run.ts 被迫变成这样
const orchestrator = new Orchestrator(
  projectDir,
  new StateManager(projectDir),
  createEvaluator(projectDir),
  createLogger(harnessDir, ...),
  // ...
);
```

我们用**可选参数 + 默认创建**（`deps?.foo ?? createFoo()`）这种折中方案，兼顾了两边：

- **生产代码**：不传 `deps`，行为与改前完全一致
- **测试代码**：传入需要 mock 的依赖，其余自动走默认创建

---

## 三、重构带来的测试收益

### 3.1 可以精确控制输入

```typescript
// 测试：当 getNextTask 返回 null 时，run() 应该结束
const mockStateManager = {
  loadTasks: vi.fn(),
  getNextTask: vi.fn().mockResolvedValue(null),
  isProjectComplete: vi.fn().mockResolvedValue(false),
  getStatistics: vi.fn().mockResolvedValue({ total: 5, completed: 2, pending: 3, ... }),
};

const orchestrator = new Orchestrator('/tmp/test', {
  stateManager: mockStateManager as any,
});

await orchestrator.run();
// 断言：没有尝试处理任何任务
expect(mockStateManager.updateTaskStatus).not.toHaveBeenCalled();
```

### 3.2 可以断言方法调用顺序和参数

```typescript
// 测试：任务成功通过评估后应标记为 completed
const mockTask = { id: 'T001', title: 'Test', attempts: 0, ... };
const mockStateManager = {
  getNextTask: vi.fn().mockResolvedValue(mockTask),
  isProjectComplete: vi.fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
};

const mockEvaluator = {
  evaluate: vi.fn().mockResolvedValue({
    final_decision: 'pass',
    summary: 'Good',
  }),
};

const orchestrator = new Orchestrator('/tmp/test', {
  stateManager: mockStateManager as any,
  evaluator: mockEvaluator as any,
});

await orchestrator.run();

// 精确断言：先设为 in_progress，最后设为 completed
expect(mockStateManager.updateTaskStatus).toHaveBeenNthCalledWith(1, 'T001', 'in_progress');
expect(mockStateManager.updateTaskStatus).toHaveBeenNthCalledWith(2, 'T001', 'completed');
```

### 3.3 可以模拟错误场景

```typescript
// 测试：生成器抛 rate_limit 错误时应切换 provider
const mockProviderManager = {
  handleRateLimit: vi.fn().mockResolvedValue({ success: true, newProvider: 'backup' }),
  getCurrentProvider: vi.fn().mockReturnValue({ model: 'test' }),
};

const orchestrator = new Orchestrator('/tmp/test', {
  stateManager: mockStateManager as any,
  providerManager: mockProviderManager as any,
});

// 模拟 generator 抛错
// ...

expect(mockProviderManager.handleRateLimit).toHaveBeenCalled();
```

### 3.4 测试运行极快

全部在内存中完成，没有文件 I/O、没有网络请求、没有子进程。一个测试几十毫秒。

---

## 四、不改业务逻辑，风险为零

这个重构的范围极小：

| 改动内容 | 影响 |
|---------|------|
| 构造函数签名 | 增加可选的 `deps?` 参数 |
| 构造函数体内 | 赋值语句从 `this.x = new X()` 改为 `this.x = deps?.x ?? new X()` |
| 所有业务方法 | **零改动** |
| 所有调用方 | **零改动**（不传 `deps` 时行为完全一致） |
| 类型定义 | **零改动** |

可以通过以下方式验证重构没有破坏行为：

1. `npm run build` — TypeScript 编译通过
2. `npm test` — 已有测试全部通过
3. 生产代码调用方式不变 — `new Orchestrator(projectDir)` 仍然正常工作

---

## 五、后续工作

重构完成后，Orchestrator 的测试优先级如下：

| 优先级 | 测试场景 | 覆盖的 Bug/风险 |
|--------|---------|----------------|
| P0 | `run()` 主循环：任务成功通过评估 → completed | 验证正常流程 |
| P0 | `run()` 主循环：评估失败（attempts < 3）→ pending 重试 | Bug-001 回归 |
| P0 | `run()` 主循环：评估失败（attempts >= 3）→ needs_human | 核心状态流转 |
| P0 | `run()` 主循环：evaluator_error=true → 不计重试、回退 pending | **Bug-005** |
| P1 | 生成器抛 rate_limit → provider 切换成功 → 重试 | 提供商切换 |
| P1 | 生成器抛 rate_limit → provider 切换失败 → needs_human | 错误处理 |
| P1 | 生成器抛普通错误（attempts < 3）→ pending 重试 | Bug-003 错误信息 |
| P1 | 生成器抛普通错误（attempts >= 3）→ needs_human | 重试上限 |
| P2 | 没有可执行任务 → 结束循环 | 边界条件 |
| P2 | Token 预算耗尽 → 提前结束 | 预算控制 |
| P2 | `initialize()` 成功/失败路径 | 初始化流程 |
| P2 | `handleInterruption()` SIGINT 保存状态 | **Bug-002** |

---

## 六、教训：为什么项目初期就要考虑可测试性

这个项目的经历是一个很好的反面教材：

1. **Phase 1 时没有写测试**，Orchestrator 的依赖关系随着功能增加越来越复杂
2. **Bug 在真实项目中暴露时**（三个项目的运行日志），才发现问题不在 Agent 质量，而在 Orchestrator 的调度逻辑
3. **修复 Bug 时不敢大刀阔斧改代码**，因为没有任何测试保护，改一点怕崩一片
4. **最终不得不做一次重构**才能补测试，而重构本身在没有测试保护的情况下是有风险的

**如果项目初期就给 Orchestrator 做了依赖注入**，这些 Bug 中的大部分在开发阶段就能被单元测试拦截，不需要跑完三个真实项目才发现。

这个教训适用于所有类似的自动化/编排类项目：**调度器的逻辑复杂度会随业务规则指数增长，必须在第一天就为它预留测试接口。**
