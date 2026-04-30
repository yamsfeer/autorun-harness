# Docs as Single Source of Truth

> 创建时间：2026-04-29
> 状态：讨论中

---

## 核心诉求

**用户只手动维护 `docs/` 下的文档，其他一切从文档推导，由 AI 自动对齐。**

具体来说：

- 用户**会手动修改**的：`docs/` 下的架构文档、UI/UX 设计、数据契约等
- 用户**不会手动修改**的：`tasks.json`、`src/` 代码、`.harness/` 下的文件
- 当 docs 变了，或者代码跑偏了，系统自动检测不一致，再由 AI 修正

---

## 问题背景

### 理想流程（Greenfield）

```
PRD → Planner → docs/ + tasks.json → Generator → 代码 → Evaluator
       一次搞定，一切对齐 ✅
```

### 现实中的变量

| 变量 | 场景 | 导致的漂移 |
|------|------|-----------|
| **Brownfield** | 已有项目，没有经过 Planner | 没有 docs，没有 tasks.json，一切从代码反推 |
| **执行失败** | 任务 3 次重试后 needs_human | tasks.json 状态与代码不一致 |
| **需求变更** | 中途改了功能要求 | docs 变了，tasks.json 没跟上 |
| **代码跑偏** | Generator 没按架构/契约实现 | 代码和 docs 不一致 |
| **Planner 质量问题** | 生成的 docs 不符合用户预期 | 用户要改 docs，但 tasks.json 还是按旧 docs 拆的 |

**根本矛盾：状态太多，互相影响，手动维护不现实。**

---

## 解决思路

### 核心原则

**docs/ 是唯一的事实来源（Single Source of Truth）。**

- docs 定义了"系统应该是什么样"
- tasks.json 定义了"怎么一步步做到"
- 代码是"实际做成了什么样"
- 后两者必须和前者对齐，不对齐时由 AI 修正

### 用户的工作流

```
Greenfield:
  PRD → Planner 生成 docs/ → 用户审阅修改 docs/ → 系统根据 docs 生成 tasks → 执行

Brownfield:
  已有代码 → Archaeology Agent 生成 docs/ → 用户审阅修改 docs/ → 系统根据 docs 生成 tasks → 执行

运行中需求变更:
  用户修改 docs/ → 系统检测差异 → 自动调整 tasks/代码 → 继续执行

代码跑偏:
  系统检测代码与 docs 不一致 → 自动修正或生成新任务
```

**用户只需要关心 docs/。**

---

## 三种对齐检查

### 检查 1：docs → tasks.json（任务是否覆盖了文档描述的所有功能？）

| 不一致 | 处理方式 |
|--------|---------|
| 文档描述了某功能，但 tasks.json 没有对应任务 | → 生成新任务 |
| tasks.json 有任务在做文档里不存在的东西 | → 提示用户：文档缺失还是任务多余？ |
| 任务的验收标准与文档描述不匹配 | → 按文档重写验收标准 |

**触发时机**：docs 变更后、任务执行前

### 检查 2：docs → 代码（代码实现是否符合文档描述？）

| 检查维度 | 检查方法 |
|---------|---------|
| vs ARCHITECTURE.md | 目录结构是否匹配？模块是否存在？依赖方向是否正确？ |
| vs API_CONTRACT.md | 路由定义是否匹配？请求/响应结构是否一致？ |
| vs DATA_MODEL.md | 数据库表/类型定义是否匹配？字段是否一致？ |
| vs UI_UX.md | 页面/组件是否存在？路由是否覆盖？交互逻辑是否匹配？ |

| 不一致 | 处理方式 |
|--------|---------|
| 代码缺少文档描述的功能 | → 生成新任务补充实现 |
| 代码有文档里没有的东西 | → 提示用户：代码跑偏了还是需要更新文档？ |
| 代码结构与文档不一致 | → 生成重构任务 |

**触发时机**：每个任务完成后（轻量检查）、每 N 个任务后（全量检查）

### 检查 3：docs 变更检测（文档改了什么？需要哪些后续动作？）

| 文档变更类型 | 后续动作 |
|------------|---------|
| 新增功能描述 | → 生成新任务 |
| 修改功能描述 | → 标记相关任务需要更新，已完成任务可能需要重新实现 |
| 删除功能描述 | → 标记相关任务为取消，已实现代码标记为待删除 |
| 修改技术选型/架构 | → 触发影响范围分析，标记受影响的任务和代码 |

**触发时机**：用户修改 docs/ 后主动触发（`autorun-harness sync`）

---

## 新命令设想

### `autorun-harness sync`

核心命令——检查 docs 与 tasks/代码的一致性，输出差异报告，自动修正可修正的部分。

```
$ autorun-harness sync

📋 同步检查结果：

🔴 严重不一致（需处理）：
  - API_CONTRACT.md 新增了 POST /api/orders/:id/cancel，但 tasks.json 无对应任务
  - ARCHITECTURE.md 描述了 NotificationService 模块，但 src/ 下不存在

🟡 轻微不一致（可自动修正）：
  - tasks.json 中 T006 的验收标准与 API_CONTRACT.md 不匹配 → 已自动更新
  - DATA_MODEL.md 的 Order 表新增了 cancelled_at 字段 → 已为 T003 生成补充任务

🟢 已同步：
  - UI_UX.md 描述的 6 个页面，代码中均存在
  - ARCHITECTURE.md 描述的 8 个模块，代码中均存在

💡 建议操作：
  1. autorun-harness run  ← 执行新增/更新的任务
  2. 确认 API_CONTRACT.md 新增路由是否为预期变更
```

### 流程中的自动触发

除了手动 `sync`，在以下时机自动执行轻量检查：

1. **`init` 阶段**：Planner 生成 docs 后，用户修改 docs 后，重新 sync 再生成 tasks
2. **`run` 阶段**：每个任务完成后，检查代码与 docs 的一致性
3. **需求变更**：用户修改 docs 后运行 `sync`

---

## 对现有改进计划的影响

这个方案实际上是多个 issue 的统一框架：

| 现有 issue | 在此方案中的位置 |
|-----------|----------------|
| Q-1 依赖上下文注入 | docs → tasks 对齐的副产品：Generator 拿到的上下文来自 docs，而非凭空猜测 |
| Q-4 维护活的架构摘要 | ARCHITECTURE.md 不再由 Generator 顺便更新，而是由 sync 检查后统一维护 |
| Q-5 强制质量门 | 质量门的一种：代码 vs docs 一致性检查 |
| I-1 代码库理解阶段 | Brownfield 的 Archaeology Agent 就是反向生成 docs 的过程 |
| I-2 任务模型扩展 | sync 生成的任务自然包含 create/modify/refactor/delete 类型 |
| I-4 变更影响面分析 | docs 变更检测 + 影响分析就是 sync 的核心逻辑 |

**不需要重新组织改进计划**，但实现顺序可能调整：sync 检查框架可以先做轻量版，逐步覆盖上述 issue。

---

## 开放问题

1. **sync 的实现方式**：是独立 Agent（Sync Checker Agent），还是 orchestrator 内的一个步骤？
2. **不一致时的决策权**：发现代码和 docs 不一致时，是自动修正代码，还是暂停等人确认？
   - 建议：新增功能 → 自动生成任务；跑偏/多余代码 → 暂停确认
3. **Brownfield Archaeology 的质量**：从代码反向生成 docs 的准确性如何？用户必须审阅后才作为事实来源
4. **docs 变更的 diff 方式**：如何检测用户改了 docs 的哪些部分？git diff？还是结构化解析？
5. **与 Issue as Test 的关系**：sync 检查本身是否也应该用测试来表达？（比如 `test.skip("代码目录结构应与 ARCHITECTURE.md 一致")`）

---

## 实施路线（初步）

```
Phase 1: 基础 sync 命令
  - 解析 docs/ 中的结构化文档
  - 解析 tasks.json 和代码目录结构
  - 输出差异报告
  - 自动修正验收标准等简单不一致

Phase 2: docs 变更检测
  - git diff 检测 docs 变更
  - 变更影响范围分析
  - 自动生成/更新任务

Phase 3: 代码 vs docs 一致性检查
  - API 路由对比
  - 数据模型对比
  - 目录结构对比
  - UI 页面/路由对比

Phase 4: Brownfield 支持
  - Archaeology Agent 从代码生成 docs
  - 用户审阅后成为事实来源
  - 后续走正常 sync 流程
```
