# 改进方案

> 记录框架的 7 项改进方案，按优先级排列。
> 每项改进将独立实施，通过评估体系的前后对比验证效果。

---

## 改进 1：依赖任务文件列表注入上下文

- **对应问题**：问题 1（上下文断裂）
- **优先级**：P0
- **实现难度**：简单

### 方案

`tasks.json` 中已有 `dependencies` 字段，但 Generator 未使用。每个任务完成后，记录该任务产生或修改的文件列表及关键决策：

```json
{
  "id": "task-3",
  "title": "实现用户认证模块",
  "produced_files": ["src/auth/token.ts", "src/auth/middleware.ts", "src/types/user.ts"],
  "key_decisions": ["使用 JWT 而非 session", "token 过期时间 24h"]
}
```

Generator 启动时，根据当前任务的 `dependencies`，自动把上游任务的 `produced_files` 和 `key_decisions` 注入 prompt。

### 改动范围

- `src/types/index.ts`：Task 类型增加 `produced_files` 和 `key_decisions` 字段
- `src/core/orchestrator.ts`：Generator prompt 构建逻辑，注入依赖任务的上下文
- `prompts/generator.md`：提示词中说明如何使用注入的上下文
- `prompts/evaluator.md`：评估器在任务完成时提取 `produced_files` 和 `key_decisions`

### 预期效果

减少因不知道上游代码结构而导致的错误，提升首次通过率。

---

## 改进 2：验收标准变成可执行测试用例

- **对应问题**：问题 2（评估器可信度）、问题 4（最后 20% 瓶颈）
- **优先级**：P0
- **实现难度**：中等

### 方案

将 Planner 生成的验收标准从文字描述升级为可执行的测试代码。

**之前**（文字描述）：

```json
{
  "id": "AC-1",
  "description": "用户可以创建待办事项",
  "steps": ["打开应用", "输入待办内容", "点击添加按钮", "验证列表中出现新条目"]
}
```

**之后**（可执行测试）：

```typescript
// tests/task-3.test.ts（由 Planner 生成）
test('AC-1: 用户可以创建待办事项', async () => {
  const app = await startApp();
  await app.input('#todo-input', '买菜');
  await app.click('#add-btn');
  const items = await app.findAll('.todo-item');
  expect(items).toHaveLength(1);
  expect(items[0].text).toBe('买菜');
});
```

Evaluator 的角色从"AI 裁判"降级为"测试运行器"：`npm test` 通过即 pass，不通过即 fail。判断工作前置到 Planner 阶段，人类可提前审核测试用例的合理性。

### 改动范围

- `prompts/planner-full.md`：要求 Planner 同时生成测试用例文件
- `prompts/planner-simple.md`：同上
- `src/core/evaluator.ts`：核心逻辑从"AI 主观评估"改为"运行测试 + 分析结果"
- `src/types/index.ts`：AcceptanceCriterion 增加测试文件路径字段

### 预期效果

评估可信度质变，消除 AI 评估 AI 的主观偏差。

---

## 改进 3：周期性全量回归测试

- **对应问题**：问题 3（错误积累）
- **优先级**：P1
- **实现难度**：简单

### 方案

在 orchestrator 主循环中，每完成 N 个任务（默认 3），执行一次全量回归：

```bash
npm run build
npm test
```

如果之前通过的测试挂了，说明当前任务引入了回归。暂停任务执行，将回归信息反馈给 Generator 修复，或标记为 `needs_human`。

### 改动范围

- `src/core/orchestrator.ts`：主循环中增加计数器和回归检测逻辑
- `src/core/state-manager.ts`：记录回归检测结果

### 预期效果

错误不再积累到后期才被发现，大幅降低修复成本。

---

## 改进 4：维护活的架构摘要

- **对应问题**：问题 1（上下文断裂）
- **优先级**：P2
- **实现难度**：中等

### 方案

在 `.harness/` 下维护一份 `ARCHITECTURE.md`，每个任务完成后增量更新。内容包括：

- 当前目录结构（简洁版）
- 已实现的模块列表及职责（一两句话）
- 模块间的调用关系
- 关键接口定义（最核心的 type signature）

控制总长度在 500-800 行以内，确保可以完整放入上下文窗口。

Generator 启动时优先读取此文件，快速建立对当前代码库的认知。

### 改动范围

- `prompts/generator.md`：提示词中要求 Generator 在任务完成后更新 ARCHITECTURE.md
- `prompts/evaluator.md`：评估器检查 ARCHITECTURE.md 是否及时更新
- `src/core/state-manager.ts`：增加 ARCHITECTURE.md 的读写方法

### 预期效果

中等复杂度任务的上下文质量明显改善。

---

## 改进 5：Git diff 注入上下文

- **对应问题**：问题 1（上下文断裂）
- **优先级**：P2
- **实现难度**：简单

### 方案

Generator 启动时，通过 `git log --oneline -5` 和 `git diff HEAD~1 --stat` 获取最近的代码变更，注入 prompt。

Generator 能看到最近改了什么，避免重复劳动或与已有代码冲突。

### 改动范围

- `src/core/orchestrator.ts`：在构建 Generator prompt 前执行 git 命令获取变更信息

### 预期效果

减少因不了解近期变更而产生的重复或冲突。

---

## 改进 6：Git tag 做回滚锚点

- **对应问题**：问题 3（错误积累）
- **优先级**：P1
- **实现难度**：很简单

### 方案

```bash
# 每个任务开始前
git tag "pre-task-${taskId}"

# 任务完成后
git add -A && git commit -m "task-${taskId}: ${title}"
```

后续任务出问题时：
- `git diff pre-task-3..HEAD` 精确定位变更范围
- `git reset --soft pre-task-3` 回退到任务前状态

### 改动范围

- `src/core/orchestrator.ts`：任务开始前打 tag，完成后 commit

### 预期效果

出错可回退，降低修复成本。

---

## 改进 7：两阶段上下文加载

- **对应问题**：问题 1（上下文断裂）
- **优先级**：P3
- **实现难度**：较难

### 方案

将当前一次性注入 prompt 的方式改为两阶段：

**第一阶段（轻量探测）：** 只给任务描述 + `ARCHITECTURE.md` + 上游依赖信息，让 Agent 先决定需要读哪些文件（maxTurns: 3-5）。

**第二阶段（实际开发）：** 把第一阶段收集到的文件内容 + 原始任务一起注入，开始实际编码。

Agent 自己做一次有针对性的上下文筛选，比硬塞一堆文件效率更高。

### 改动范围

- `src/core/orchestrator.ts`：将单次 `query()` 拆分为两次调用，第二阶段注入第一阶段的结果
- 可能需要新增 `ContextScout` 概念

### 预期效果

上下文精准度最高，但实现复杂度也最高。建议在前 6 项改进验证后再考虑。
