# Autorun Harness Bug Report

> 生成时间: 2026-04-24
> 来源项目: 维修派单管家 (repair-dispatch)
> 项目路径: `/home/yams/autorun-tmp-dir/s1-admin-system/`
> Harness 版本: 基于 `dist/core/orchestrator.js` 的构建版本

---

## 1. 项目上下文

### 1.1 项目信息

| 属性 | 值 |
|------|-----|
| 项目名称 | 维修派单管家 |
| 项目路径 | `/home/yams/autorun-tmp-dir/s1-admin-system/` |
| 任务定义文件 | `.harness/tasks.json` |
| 执行日志 | `.harness/logs/run-2026-04-23.log` |
| 评估报告目录 | `.harness/reports/` |
| 规格文件 | `.harness/spec.md` |

### 1.2 任务执行结果概览

| 状态 | 任务 ID | 数量 |
|------|---------|------|
| `completed` | T001 ~ T011 | 11 |
| `needs_human` | T012 ~ T017 | 6 |
| `pending` | T018 ~ T020 | 3 |
| **总计** | T001 ~ T020 | **20** |

---

## 2. 发现的 Bug 列表

### Bug-001: 评估器通过阈值逻辑错误

**严重程度**: 🔴 Critical

**现象**:
多个已完成任务的评估报告中，`total_weighted_score` 低于 `threshold`，但 `final_decision` 仍为 `"pass"`。

**具体证据** (以 T001 为例):
```json
{
  "total_weighted_score": 0.7,
  "threshold": 0.75,
  "final_decision": "pass"
}
```

0.7 < 0.75，按规则应为 **fail**，但被判定为 **pass**。

**影响**:
- 质量不合格的任务被错误标记为 `completed`
- 下游任务基于错误的完成状态继续执行，可能引入连锁质量问题

**根因推测**:
评估器在计算最终决策时，可能未严格比较 `total_weighted_score >= threshold`，或者在某些分支中忽略了阈值检查，直接根据其他条件（如是否有严重错误）判定通过。

**相关文件**:
- `.harness/reports/evaluator_report_T001_1.json`
- `.harness/reports/evaluator_report_T011_1.json`

---

### Bug-002: 进程中断导致任务状态与文件系统不一致

**严重程度**: 🔴 Critical

**现象**:
任务 T012 在 generation 阶段被 `SIGINT` 信号中断。进程在退出前尝试"保存当前状态"，但重启后：
1. `tasks.json` 中 T012 的状态仍显示为未开始（后续重试时 attempt=1）
2. 但 **文件系统上 `client/src/views/OrderList.vue` 已存在**（说明中断前 generator 已写入部分/全部代码）
3. 后续所有重试（attempt 1~3）的 generator 都抛出"未知错误"

**时间线**:
```
11:09:56  T012 attempt=1 开始（generation 阶段）
11:11:03  收到 SIGINT 信号，进程中断
11:11:03  Orchestrator 记录："进程被中断，保存当前状态"，phase=generation
12:00:05  Harness 重启，T012 再次 attempt=1 开始
12:06:33  Generator 抛出"未知错误"
```

**影响**:
- 任务状态（`tasks.json`）与实际文件系统不同步
- Generator 在文件已存在的情况下可能因冲突而崩溃
- T012 被标记为 `needs_human`，但其代码文件实际已生成
- 下游 T018、T019 因 T012 状态错误而被阻塞

**根因推测**:
1. **状态保存不完整**：中断时只保存了"任务正在执行"的状态，但没有记录"已产生哪些文件/副作用"
2. **恢复逻辑缺失**：重启后没有检查文件系统是否已有部分产出，也没有清理或复用这些产出
3. **Generator 幂等性不足**：重新执行时未处理"目标文件已存在"的情况

**相关文件**:
- `.harness/logs/run-2026-04-23.log` (T012 相关行)
- `client/src/views/OrderList.vue`（实际存在但任务未完成）

---

### Bug-003: Generator 隐藏异常（"未知错误"）

**严重程度**: 🔴 Critical

**现象**:
T012 ~ T017 共 6 个任务，每个任务 3 次重试，**全部 18 次执行**在 `runGenerator` 的 **第 578 行** 抛出完全相同的错误：

```
Error: 未知错误
    at Orchestrator.runGenerator (file:///home/yams/autorun-harness/dist/core/orchestrator.js:578:19)
    at async Orchestrator.run (file:///home/yams/autorun-harness/dist/core/orchestrator.js:297:17)
```

**关键问题**:
- 错误信息只有 `"未知错误"` 四个字，没有任何上下文
- 没有记录 generator 的输入、输出或中间状态
- 无法判断是 LLM 调用失败、文件写入失败、还是其他原因

**影响**:
- 完全无法诊断和修复问题
- 用户只能人工介入，失去自动化意义

**根因推测**:
1. `runGenerator` 方法中存在 `try-catch`，但 catch 块中丢失了原始错误信息，用 `"未知错误"` 替换
2. 或者某处抛出的 Error 对象本身就没有有用的 message
3. 缺乏对 LLM API 调用、文件系统操作、子进程执行的细粒度错误包装

**相关文件**:
- `autorun-harness/dist/core/orchestrator.js:578`
- `.harness/logs/run-2026-04-23.log` (T012~T017 错误行)
- `.harness/failure.md`

---

### Bug-004: 评估器未更新 Acceptance Criteria 状态

**严重程度**: 🟡 Medium

**现象**:
T001 ~ T011 这 11 个标记为 `completed` 的任务，在 `tasks.json` 中它们的 `acceptance_criteria[*].status` **全部为 `"pending"`**。

**证据**:
```json
{
  "id": "T001",
  "status": "completed",
  "acceptance_criteria": [
    { "id": "AC001", "status": "pending" },
    { "id": "AC002", "status": "pending" }
  ]
}
```

**影响**:
- 无法从 `tasks.json` 中判断哪些 AC 已经通过、哪些未通过
- 外部工具或人工检查时需要同时读取 `tasks.json` 和评估报告 JSON，增加了复杂度
- 如果评估报告丢失，将完全无法追溯验收情况

**根因推测**:
评估器在完成评估后，只向 orchestrator 返回了总体 `pass/fail` 结果，但没有逐条回写每个 AC 的状态到 `tasks.json`。

**相关文件**:
- `.harness/tasks.json` (T001~T011 的 acceptance_criteria 字段)

---

### Bug-005: 评估器自身崩溃被误判为代码不合格

**严重程度**: 🟠 High

**现象**:
T013 第 2 次尝试的评估报告中，所有 AC 的评估结果都是 `fail`，但原因不是代码问题，而是 **"评估过程出错: 未知错误"**。

```json
{
  "overall_result": "fail",
  "summary": "评估过程出错: 未知错误",
  "criteria_results": [
    {
      "criterion_id": "AC001",
      "result": "fail",
      "details": [
        { "step": 1, "status": "fail" },
        ...
      ]
    }
  ]
}
```

**关键问题**:
- 评估器在尝试访问页面或执行测试时自身崩溃
- 崩溃原因（浏览器未启动、页面加载超时等）被当作"代码功能失败"
- 没有区分 **"代码不满足要求"** 和 **"评估器无法执行验证"**

**影响**:
- 代码实际上可能已经正确，但被误判为失败
- 触发不必要的重试，浪费资源
- 最终任务被标记为 `needs_human`，但问题其实在评估器

**根因推测**:
评估器缺少错误分类机制：
1. 应区分 `EVALUATOR_ERROR`（浏览器打不开、网络问题等）和 `CODE_ERROR`（功能不符合预期）
2. 遇到 `EVALUATOR_ERROR` 时应标记评估无效，而不是标记代码 fail

**相关文件**:
- `.harness/reports/evaluator_report_T013_2.json`

---

### Bug-006: 下游任务因错误的上游状态被阻塞

**严重程度**: 🟡 Medium

**现象**:
T018、T019、T020 因为上游依赖任务状态为 `needs_human` 而保持 `pending`，无法开始执行。

| 任务 | 依赖 | 实际上游状态 | 实际上游代码 | 是否应该阻塞 |
|------|------|------------|------------|------------|
| T018 | T012 | `needs_human` | ✅ 文件已存在 | ❌ 不应阻塞 |
| T019 | T012 | `needs_human` | ✅ 文件已存在 | ❌ 不应阻塞 |
| T020 | T015, T016 | `needs_human` | ✅ 文件已存在 | ❌ 不应阻塞 |

**影响**:
- 整个项目进度停滞，3 个任务本可以继续执行
- 即使上游任务有轻微缺陷，下游任务可能仍可部分推进

**根因推测**:
依赖解析逻辑过于严格，只检查 `status === "completed"`，没有考虑：
1. 检查上游任务的代码产出是否已存在
2. 允许在配置中设置"宽松依赖检查"模式
3. 区分"代码未生成"和"评估未通过"两种 needs_human 情况

**相关文件**:
- `.harness/tasks.json` (T018~T020 的 dependencies 字段)

---

## 3. 连锁反应分析

```
SIGINT 中断 T012 generation
    │
    ▼
T012 状态未正确保存，文件已写入但任务未标记完成
    │
    ▼
T012 重启后重试，Generator 因文件已存在/状态不一致崩溃
    │
    ▼
T012 被标记为 needs_human
    │
    ├──► T018 被阻塞（依赖 T012）
    ├──► T019 被阻塞（依赖 T012）
    │
T015, T016 同样因 Generator 崩溃变为 needs_human
    │
    └──► T020 被阻塞（依赖 T015, T016）
```

**最终结果**: 6 个任务代码已存在但被标记失败，3 个任务被阻塞无法执行。项目实际完成度约 85%，但 Harness 显示仅 55%。

---

## 4. 修复建议（按优先级）

### P0 - 立即修复

1. **修复评估器阈值逻辑**
   - 确保 `final_decision = "pass"` 当且仅当 `total_weighted_score >= threshold`
   - 添加断言检查，防止逻辑短路

2. **修复 Generator 错误信息**
   - 在 `orchestrator.js:578` 附近添加详细的错误上下文
   - 记录：LLM 响应状态、文件操作目标路径、当前任务阶段等
   - 区分 LLM 错误、文件系统错误、网络错误、解析错误

### P1 - 高优先级

3. **修复进程中断恢复逻辑**
   - 中断时记录已生成的文件清单到 `tasks.json`
   - 重启后检查文件系统，如果产出已存在则跳过 generation 直接进入评估
   - 或提供 `--clean` 选项让用户选择是否清理后重来

4. **评估器增加错误分类**
   - 引入 `EVALUATOR_ERROR` vs `CODE_ERROR` 分类
   - 评估器崩溃时返回 `result: "invalid"` 而非 `"fail"`
   - Orchestrator 对 `invalid` 结果进行重试或人工提醒，而非算入任务失败次数

### P2 - 中优先级

5. **回写 AC 状态到 tasks.json**
   - 评估完成后，将每个 AC 的 `result` 同步更新到 `tasks.json`
   - 方便外部工具和人工程序读取

6. **优化依赖检查逻辑**
   - 增加"检查代码产出是否存在"的备选依赖验证方式
   - 允许配置 `strictDependencies: false` 用于恢复模式

---

---

# 项目二：洁邻管家 (wechat-miniapp)

> 记录时间: 2026-04-24
> 来源项目: 洁邻管家 — 同城家政预约小程序
> 项目路径: `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/`

---

## 1. 项目上下文

### 1.1 项目信息

| 属性 | 值 |
|------|-----|
| 项目名称 | 洁邻管家 |
| 项目路径 | `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/` |
| 任务定义文件 | `.harness/tasks.json` |
| 执行日志 | `.harness/logs/` |
| 评估报告目录 | `.harness/reports/` |
| 规格文件 | `.harness/spec.md` |

### 1.2 任务执行结果概览

| 状态 | 任务 ID | 数量 |
|------|---------|------|
| `completed` | T001 ~ T005 | 5 |
| `needs_human` | T006 ~ T009, T011 | 5 |
| `pending` | T010, T012 ~ T020 | 10 |
| **总计** | T001 ~ T020 | **20** |

---

## 2. 发现的 Bug 列表

### Bug-007: 评估器崩溃导致已完成的 API 任务被错误标记为 needs_human

**严重程度**: 🔴 Critical

**现象**:
T006 ~ T009 共 4 个后端 API 任务，代码已在 `server/routes/` 目录下完整实现，但因评估阶段持续报"未知错误"而被标记为 `needs_human`。

**具体证据**:

| 任务 | 标题 | 代码位置 | 实现情况 |
|------|------|----------|----------|
| T006 | 订单列表 API | `server/routes/orders.js:102-176` | GET `/api/orders` 完整实现：分页、状态筛选、关联查询、仅当前用户 |
| T007 | 订单详情 API | `server/routes/orders.js:256-308` | GET `/api/orders/:id` 完整实现：关联 category_name/price_desc、404/403 校验 |
| T008 | 订单状态更新 API | `server/routes/orders.js:186-249` | PUT `/api/orders/:id/status` 完整实现：状态流转校验(0→1, 0→3, 1→2)、终态保护 |
| T009 | 地址管理 API | `server/routes/addresses.js` | 完整 CRUD + 默认地址：GET/POST/PUT/DELETE/PUT `/:id/default`，事务保证 |

**进度日志证据** (`.harness/progress.txt`):
```
T006: 尝试 #1 失败: 未知错误 → 尝试 #2 失败: 未知错误 → 尝试 #3 失败: 未知错误 → needs_human
T007: 尝试 #1 失败: 未知错误 → 尝试 #2 评估失败: 未知错误 → 尝试 #3: 实现已存在且功能正确 → 尝试 #4 失败: 未知错误 → needs_human
T008: 尝试 #1 失败: 未知错误 → 尝试 #2 成功: 实现已存在且功能正确 → 尝试 #3 失败: 未知错误 → needs_human
T009: 尝试 #1 失败: 未知错误 → 尝试 #2 失败: 未知错误 → 尝试 #3 失败: 未知错误 → needs_human
```

**关键问题**:
- T007、T008 在中间的尝试中**明确记录**"实现已存在且功能正确，所有验收标准通过手动测试验证"，但后续尝试又失败，最终状态仍为 `needs_human`
- 所有尝试的失败原因都是完全相同的"未知错误"，没有任何诊断信息

**影响**:
- 4 个已完成的后端 API 任务被错误标记为 `needs_human`
- 下游 T010、T014、T015、T016、T017 因依赖这些任务而被阻塞为 `pending`
- 项目实际后端完成度约 90%，但 Harness 显示仅 25%

**根因推测**:
与 Bug-003 相同：评估器（Honest）在 generation 或 evaluation 阶段崩溃，原始错误信息被吞掉，只返回"未知错误"。T007、T008 的笔记显示代码实际上是正确的，说明评估器在某些运行条件下能正常工作，但不稳定。

**相关文件**:
- `server/routes/orders.js`（T006~T008 代码已存在）
- `server/routes/addresses.js`（T009 代码已存在）
- `.harness/progress.txt`
- `.harness/failure.md`

---

### Bug-008: 小程序工程初始化任务被错误标记为 needs_human

**严重程度**: 🟠 High

**现象**:
T011 "小程序工程初始化与全局配置" 被标记为 `needs_human`，但 `miniprogram/` 目录下已有完整骨架：

- `app.js` — 全局登录状态管理、自动静默登录
- `app.json` — TabBar（首页/订单/我的）、7 个页面路由
- `app.wxss` — 全局样式变量
- `utils/request.js` — JWT 自动携带、401 自动重登录并重试、队列防并发
- `utils/auth.js` — 微信登录封装
- 所有 7 个页面的骨架文件（.js/.wxml/.wxss）已创建
- `components/` 目录已创建但组件文件为空

**进度日志证据**:
```
T011: 尝试 #1 失败: 未知错误 → 尝试 #2 失败: 未知错误 → 尝试 #3 失败: 未知错误 → needs_human
```

**影响**:
- T011 下游所有小程序页面任务（T012~T018）被阻塞
- 与 Bug-007 叠加，导致前端 9 个任务全部无法推进

**根因推测**:
同样为评估器崩溃。T011 的代码产出实际上已经非常完整，仅缺少组件的具体实现内容。

---

### Bug-009: 下游任务连锁阻塞

**严重程度**: 🟡 Medium

**现象**:
由于 T006~T009 和 T011 被错误标记为 `needs_human`，以下 10 个下游任务保持 `pending` 无法执行：

| 被阻塞任务 | 依赖的误标记任务 | 实际应可执行 |
|-----------|-----------------|-------------|
| T010 服务评价 API | T007、T008 | ✅ 后端可推进 |
| T012 首页服务分类展示 | T011 | ✅ 前端可推进 |
| T013 预约下单页 | T011、T012 | ✅ 前端可推进 |
| T014 我的订单列表页 | T006、T011 | ✅ 前端可推进 |
| T015 订单详情页 | T007、T008、T010、T011 | ✅ 前端可推进 |
| T016 我的页面 | T006、T011 | ✅ 前端可推进 |
| T017 地址管理页面 | T009、T011 | ✅ 前端可推进 |
| T018 公共组件开发 | T011 | ✅ 前端可推进 |
| T019 前后端联调 | T012~T017 | ✅ 集成可推进 |
| T020 部署配置 | T019 | ✅ 部署可推进 |

**影响**:
- 整个项目自动化流程完全停滞
- 实际代码完成度约 60%，但 Harness 显示仅 25%

---

## 3. 连锁反应分析

```
Honest 评估器崩溃（未知错误）
    │
    ├──► T006 被标记 needs_human ──► T014、T016 被阻塞
    │
    ├──► T007 被标记 needs_human ──► T010、T015 被阻塞
    │
    ├──► T008 被标记 needs_human ──► T010、T015 被阻塞
    │
    ├──► T009 被标记 needs_human ──► T017 被阻塞
    │
    └──► T011 被标记 needs_human ──► T012、T013、T014、T015、T016、T017、T018 被阻塞

最终结果: 5 个任务代码已完成但被标记失败，10 个任务被阻塞无法执行。
```

---

## 4. 与项目一（维修派单管家）的对比

| 维度 | 维修派单管家 | 洁邻管家 |
|------|-------------|----------|
| 总任务数 | 20 | 20 |
| completed | 11 | 5 |
| needs_human（代码实际已完成） | 3 (T012, T015, T016) | **5 (T006~T009, T011)** |
| pending（被阻塞） | 3 | **10** |
| 核心问题 | 进程中断 + Generator 崩溃 | **评估器持续崩溃** |
| 共同问题 | 都出现"未知错误"导致状态与代码不一致 | 都出现"未知错误"导致状态与代码不一致 |

**共同模式**:
两个项目都因 Honest 评估工具的"未知错误"导致任务状态与代码实际完成情况严重脱节。这是 Harness 的系统性问题，不是项目特定问题。

---

## 5. 修复建议（按优先级）

### P0 - 立即修复

1. **修复 Honest 评估器稳定性**
   - `orchestrator.js:578` 附近的错误处理需要记录原始错误堆栈，而不是用"未知错误"覆盖
   - 增加评估器重试机制（评估器崩溃时不应算入任务重试次数）
   - 评估器崩溃后应自动降级为静态代码检查，而不是直接标记 needs_human

2. **增加"代码存在性"校验作为备用依赖检查**
   - 在检查任务依赖时，如果 `status !== "completed"`，额外检查关键产出文件是否已存在
   - 如果代码已存在且通过静态检查，允许下游任务继续执行

### P1 - 高优先级

3. **评估器增加错误分类**
   - 与 Bug-005 相同：区分 `EVALUATOR_ERROR`（评估器自身崩溃）和 `CODE_ERROR`（代码不合格）
   - 遇到 `EVALUATOR_ERROR` 时应标记评估无效，触发评估器重试而不是任务重试

4. **任务状态修复模式**
   - 提供 `--fix-status` 命令，扫描文件系统与 `tasks.json` 对比，自动修正状态
   - 或提供 `--force-continue` 选项，忽略 needs_human 状态继续执行下游任务

---

## 6. 附录：关键文件清单

| 文件路径 | 说明 |
|---------|------|
| `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/.harness/tasks.json` | 任务定义与状态 |
| `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/.harness/progress.txt` | 进度日志 |
| `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/.harness/failure.md` | 错误收集报告 |
| `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/server/routes/orders.js` | T006~T008 代码已存在 |
| `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/server/routes/addresses.js` | T009 代码已存在 |
| `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/miniprogram/app.js` | T011 代码已存在 |
| `/home/yams/autorun-tmp-dir/s2-wechat-miniapp/miniprogram/utils/request.js` | T011 代码已存在 |

---

## 5. 附录：关键文件清单（项目一）

| 文件路径 | 说明 |
|---------|------|
| `/home/yams/autorun-tmp-dir/s1-admin-system/.harness/tasks.json` | 任务定义与状态 |
| `/home/yams/autorun-tmp-dir/s1-admin-system/.harness/logs/run-2026-04-23.log` | 完整执行日志 |
| `/home/yams/autorun-tmp-dir/s1-admin-system/.harness/reports/evaluator_report_T001_1.json` | 阈值逻辑错误示例 |
| `/home/yams/autorun-tmp-dir/s1-admin-system/.harness/reports/evaluator_report_T013_2.json` | 评估器崩溃示例 |
| `/home/yams/autorun-tmp-dir/s1-admin-system/.harness/failure.md` | 错误收集报告 |
| `/home/yams/autorun-tmp-dir/s1-admin-system/.harness/progress.txt` | 进度日志 |
| `autorun-harness/dist/core/orchestrator.js:578` | Generator 错误抛出点 |

---

# 项目三：万家官网管家 (wjgug)

> 记录时间: 2026-04-24
> 来源项目: 万家官网管家 — 轻量级官网 + CMS 系统
> 项目路径: `/home/yams/autorun-tmp-dir/s3-website-cms/`

---

## 1. 项目上下文

### 1.1 项目信息

| 属性 | 值 |
|------|-----|
| 项目名称 | 万家官网管家 |
| 项目路径 | `/home/yams/autorun-tmp-dir/s3-website-cms/` |
| 任务定义文件 | `.harness/tasks.json` |
| 执行日志 | `.harness/logs/run-2026-04-23.log` |
| 规格文件 | `.harness/spec.md` |

### 1.2 任务执行结果概览

| 状态 | 任务 ID | 数量 |
|------|---------|------|
| `completed` | T001 ~ T008 | 8 |
| `needs_human` | T009, T016 | 2 |
| `pending` | T010~T015, T017~T023 | 15 |
| **总计** | T001 ~ T023 | **23** |

### 1.3 执行时间线

```
09:51  T001 后端初始化         ✅ completed
10:04  T002 认证模块            ✅ completed
10:22  T003 文件上传            ✅ completed
10:37  T004 留言 API            ✅ completed
10:47  T005 服务 API            ✅ completed
10:53  T006 新闻 API            ✅ completed
11:00  T007 轮播图 API          ✅ completed
11:06  T008 站点设置+仪表盘    ✅ completed
11:06  T009 后台 CMS 初始化    ⏳ attempt #1 开始
11:11  T009                    ⚠️ SIGINT 中断于 evaluation 阶段
12:14  T009                    ❌ attempt #1 "未知错误" (generation)
12:18  T009                    ❌ attempt #2 "未知错误" (generation)
12:25  T009                    ❌ attempt #3 "未知错误" (generation) → needs_human
12:33  T016 前台官网初始化     ❌ attempt #1 "未知错误" (generation)
12:39  T016                    ❌ attempt #2 "未知错误" (generation)
12:45  T016                    ❌ attempt #3 "未知错误" (generation) → needs_human
20:40  Orchestrator            ⛔ "没有找到可执行的任务" — 项目停滞
```

---

## 2. 发现的 Bug 列表

### Bug-W001: Generator 在 generation 阶段持续崩溃（"未知错误"）

**严重程度**: 🔴 Critical

**现象**:
T009 的 3 次重试和 T016 的 3 次尝试，**全部 6 次执行**在 `runGenerator` 第 578 行抛出完全相同的错误：

```
Error: 未知错误
    at Orchestrator.runGenerator (file:///home/yams/autorun-harness/dist/core/orchestrator.js:578:19)
```

**关键问题**:
- 与前两个项目（Bug-003、Bug-007）完全相同的错误模式和堆栈
- 错误发生在 generation 阶段，即代码生成阶段
- 没有任何上下文信息（LLM 响应状态、文件操作目标、当前步骤等）

**影响**:
- T009 和 T016 两个初始化任务永远无法完成
- 15 个下游前端任务全部被阻塞
- 项目实际完成度约 35%，但剩余 65% 无法自动推进

**根因推测**:
1. 与 Bug-003 相同：`runGenerator` 的 catch 块吞掉了原始错误，用 `"未知错误"` 替换
2. 可能是 LLM API 调用失败（上下文过长、Token 超限、网络超时等）
3. 可能是文件系统操作冲突（目标目录已存在、权限问题等）

**相关文件**:
- `autorun-harness/dist/core/orchestrator.js:578`
- `.harness/logs/run-2026-04-23.log`
- `.harness/failure.md`

---

### Bug-W002: SIGINT 中断导致任务状态与文件系统不同步

**严重程度**: 🔴 Critical

**现象**:
T009 第一次尝试在 **evaluation 阶段被 SIGINT 信号中断**（11:11）。进程记录"保存当前状态"，但：
1. `tasks.json` 中 T009 被重置为未开始状态
2. 但 **文件系统上 `admin/` 目录已存在完整的项目骨架**
   - `admin/src/router/index.js` — 92 行
   - `admin/src/components/Layout.vue` — 214 行
   - `admin/src/views/Login.vue` — 173 行
   - `admin/src/api/index.js` — 149 行
   - `admin/src/utils/auth.js` — 存在
3. 后续重试全部在 generation 阶段崩溃

**时间线**:
```
11:06:02  T009 attempt=1 开始（generation 阶段）
11:11:00  收到 SIGINT 信号，进程中断
11:11:00  Orchestrator 记录："进程被中断，保存当前状态"，phase=evaluation
12:14:02  Harness 重启，T009 再次 attempt=1 开始
12:14:02  Generator 抛出"未知错误"
```

**影响**:
- T009 的代码实际已生成（登录、Layout、路由、API 封装全部完整）
- 但任务被标记为 `needs_human`，阻塞了 7 个下游任务
- 下游任务文件（Dashboard.vue、Banners.vue 等）也作为占位页面存在，但永远无法被正式实现

**根因推测**:
1. **状态保存不完整**：中断时只保存了任务状态，没有记录已生成的文件清单
2. **恢复逻辑缺失**：重启后未检查文件系统是否已有产出，直接重新开始 generation
3. **Generator 幂等性不足**：在目标文件已存在的情况下可能因冲突而崩溃

**相关文件**:
- `.harness/logs/run-2026-04-23.log` (T009 相关行)
- `admin/src/` 下已存在的完整源码文件

---

### Bug-W003: T009/T016 核心代码已完成但任务被错误标记为失败

**严重程度**: 🟠 High

**现象**:
虽然 T009 和 T016 被标记为 `needs_human`，但**它们的核心基础设施代码实际上已经完整实现**：

**T009（后台 CMS 初始化）实际产出**:
| 文件 | 行数 | 状态 |
|------|------|------|
| `admin/src/components/Layout.vue` | 214 | ✅ 完整（侧边栏、头部、路由菜单、未读角标、退出登录） |
| `admin/src/views/Login.vue` | 173 | ✅ 完整（表单验证、API 登录、Token 存储） |
| `admin/src/router/index.js` | 92 | ✅ 完整（路由守卫、6 个子路由、401 跳转） |
| `admin/src/api/index.js` | 149 | ✅ 完整（axios 封装、拦截器、所有 API 函数） |
| `admin/src/utils/auth.js` | ~30 | ✅ 完整（Token 存储/获取/清除） |
| `admin/src/views/*.vue` (除 Login) | ~15 | ⚠️ 占位页面（Dashboard/Banners/Messages/News/Services/Settings） |

**T016（前台官网初始化）实际产出**:
| 文件 | 行数 | 状态 |
|------|------|------|
| `web/src/router/index.js` | 62 | ✅ 完整（6 个路由、动态标题） |
| `web/src/components/Navbar.vue` | 281 | ✅ 完整（响应式、汉堡菜单、滚动阴影） |
| `web/src/components/Footer.vue` | ~20 | ⚠️ 简单实现 |
| `web/src/views/Home.vue` | 101 | ⚠️ 有骨架但无 API 集成 |
| `web/src/views/*.vue` (其他) | ~15 | ⚠️ 占位页面 |

**关键问题**:
- T009 的 AC 要求（项目启动、登录功能、路由守卫、Layout 导航）对应的代码都已实现
- T016 的 AC 要求（项目启动、Navbar 响应式、路由配置）对应的代码也已实现
- 失败原因不是代码质量问题，而是 **harness 工具本身崩溃**

**影响**:
- 项目可以手动继续开发，但 harness 无法自动推进
- 15 个下游任务被不必要地阻塞

---

### Bug-W004: 下游任务因错误的上游状态被大规模阻塞

**严重程度**: 🟡 Medium

**现象**:
T009（needs_human）阻塞了 7 个下游任务，T016（needs_human）阻塞了 5 个下游任务，加上 T023 的间接阻塞，共 **15 个任务**处于 pending 无法执行。

**阻塞链条**:
```
T009 needs_human ─┬─→ T010 仪表盘      被阻塞
                  ├─→ T011 轮播图管理   被阻塞
                  ├─→ T012 服务管理     被阻塞
                  ├─→ T013 新闻管理     被阻塞
                  ├─→ T014 留言管理     被阻塞
                  ├─→ T015 站点设置     被阻塞
                  └─→ T022 角标通知     被阻塞

T016 needs_human ─┬─→ T017 首页         被阻塞
                  ├─→ T018 服务页       被阻塞
                  ├─→ T019 新闻页       被阻塞
                  ├─→ T020 留言页       被阻塞
                  └─→ T021 SEO         被阻塞
                           ↓
                  T023 部署配置          被阻塞（依赖 T015 + T017）
```

**问题**:
这些下游任务的占位页面文件甚至已经存在（例如 `admin/src/views/Dashboard.vue`、`web/src/views/Services.vue` 等），只是内容是空的。如果 harness 能正确识别上游代码已存在，这些任务本可以继续执行。

---

## 3. 三个项目的横向对比

| 维度 | 维修派单管家 | 洁邻管家 | 万家官网管家 |
|------|------------|----------|------------|
| 总任务数 | 20 | 20 | 23 |
| completed | 11 (55%) | 5 (25%) | 8 (35%) |
| needs_human（代码实际已完成） | 3 | 5 | **2 (T009, T016)** |
| pending（被阻塞） | 3 | 10 | **15** |
| 阻塞根因 | T012 SIGINT + Generator 崩溃 | 评估器持续崩溃 | **T009 SIGINT + T016 Generator 崩溃** |
| 下游阻塞数 | 3 | 10 | **15** |
| 错误模式 | 完全相同的 `"未知错误"` @ orchestrator.js:578 | 完全相同的 `"未知错误"` | 完全相同的 `"未知错误"` @ orchestrator.js:578 |

**共同模式**:
1. 三个项目都出现 **SIGINT 中断 evaluation 阶段** 后，重启时 generation 阶段持续崩溃
2. 三个项目都是 **orchestrator.js:578 的"未知错误"**
3. 三个项目都是 **代码已生成但任务未标记完成**
4. 三个项目都导致 **下游任务被大规模阻塞**
5. **阻塞严重程度递增**：维修派单管家(3) → 洁邻管家(10) → 万家官网管家(15)

---

## 4. 修复建议（针对本项目）

### 立即修复（人工介入）

1. **手动将 T009 和 T016 标记为 completed**
   - 理由：核心代码（Layout、Login、router、api、Navbar）已经完整实现
   - 占位页面不属于初始化任务的 AC 范围，应交由下游任务填充

2. **重新执行 harness 从 T010 开始**
   - T009/T016 完成后，T010~T023 应可正常调度

### Harness 工具修复

3. **修复 Generator 错误信息**（同 Bug-003）
   - 在 `orchestrator.js:578` 添加详细的错误上下文

4. **修复进程中断恢复逻辑**（同 Bug-002）
   - 中断时记录已生成文件清单
   - 重启后检查文件系统，已有产出则跳过 generation 直接进入评估

5. **优化依赖检查逻辑**（同 Bug-006）
   - 增加"检查代码产出是否存在"的备选依赖验证
   - 允许配置 `strictDependencies: false` 用于恢复模式

---

## 5. 附录：关键文件清单

| 文件路径 | 说明 |
|---------|------|
| `/home/yams/autorun-tmp-dir/s3-website-cms/.harness/tasks.json` | 任务定义与状态 |
| `/home/yams/autorun-tmp-dir/s3-website-cms/.harness/logs/run-2026-04-23.log` | 完整执行日志 |
| `/home/yams/autorun-tmp-dir/s3-website-cms/.harness/failure.md` | 错误收集报告 |
| `/home/yams/autorun-tmp-dir/s3-website-cms/.harness/progress.txt` | 进度日志 |
| `/home/yams/autorun-tmp-dir/s3-website-cms/admin/src/components/Layout.vue` | 已生成但任务未完成的代码 |
| `/home/yams/autorun-tmp-dir/s3-website-cms/admin/src/views/Login.vue` | 已生成但任务未完成的代码 |
| `/home/yams/autorun-tmp-dir/s3-website-cms/web/src/components/Navbar.vue` | 已生成但任务未完成的代码 |
| `autorun-harness/dist/core/orchestrator.js:578` | Generator 错误抛出点 |
