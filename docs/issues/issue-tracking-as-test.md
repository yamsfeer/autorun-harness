# Issue 追踪方案：Issue as Test

> 创建时间：2026-04-29
> 状态：讨论中

---

## 问题

用 markdown 文件或 GitHub Issues 管理 issue/buf/feature 存在三个错位：

1. **文档与代码不同步** — issue 文件的状态需要手动更新，容易忘记
2. **文档与测试不同步** — 实现了功能但忘了改文档状态，或改了状态但测试没覆盖
3. **GitHub Issue 与本地不同步** — 网络依赖，不方便本地阅读和搜索

## 核心思路

**让测试套件成为 issue tracker。** 测试在代码里，天然和代码同步；测试可执行，天然验证完成状态。

```
讨论（不确定要不要做） → Feature/Bug（确定要做） → 已完成
     ↑ 最模糊                                    最明确 ↑
```

所有东西最终流向测试。测试是唯一的"完成"定义，其他形式都是中间状态。

```
讨论 ──(决定做)──→ Feature/Bug ──(写测试)──→ test.skip ──(实现)──→ test pass ──→ 关闭
  │                   │
  └──(决定不做)──→ 删除
```

---

## 四种情况的做法

### 1. Bug — 写失败测试

发现 bug 时，写一个能复现的失败测试。bug 修好后测试自动变绿，不需要手动改状态。

```typescript
// tests/issues/bugs/evaluator-report-missing.test.ts
describe('Bug: 评估报告缺失时不应默认生成失败报告', () => {
  test('报告文件不存在时，应标记为 evaluator_error 而非代码失败', async () => {
    const result = await evaluator.evaluate(task, { reportFileExists: false });
    expect(result.type).toBe('evaluator_error');  // 当前实际返回 'code_error'，测试为红
  });
});
```

### 2. Feature — 写 skip 测试

用 `test.skip` 描述期望行为。实现时去掉 skip，测试通过即完成。

```typescript
// tests/issues/features/quality-gates.test.ts
describe('Feature: 强制质量门', () => {
  test.skip('Generator 完成后应自动运行 tsc --noEmit', async () => {
    const result = await orchestrator.runTask(task);
    expect(result.qualityGates.typescript.status).toBe('pass');
  });
});
```

### 3. Issue/改进 — 可测试部分抽成测试，不可测试的留文档

可落地的具体需求写成 `test.skip`，设计决策仍留文档。**一旦决策确定，把可落地的部分抽成测试，原文件不再维护状态。**

```typescript
// tests/issues/improvements/dependency-context.test.ts
describe('改进: 依赖任务文件列表注入上下文', () => {
  test.skip('Generator prompt 应包含上游任务的 produced_files', async () => {
    // 可测试
  });
});
```

### 4. 讨论 — 临时文件，有生命周期

讨论是临时状态，不应长期存在。有结论后必须转化为测试或删除。

```markdown
# 并行执行方案选择

**状态**: 讨论中 / 已决策 / 已放弃
**决策日期**: -
**转化结果**: - （如果已决策，写明转化到了哪个测试文件）
```

---

## 目录结构

```
tests/issues/
├── bugs/                           ← 红色测试（当前失败）
│   ├── evaluator-report-missing.test.ts
│   └── generator-not-idempotent.test.ts
│
├── features/                       ← skip 测试（待实现）
│   ├── quality-gates.test.ts
│   ├── git-rollback.test.ts
│   └── human-intervention.test.ts
│
└── improvements/                   ← skip 测试（待实现）
    ├── dependency-context.test.ts
    ├── regression-testing.test.ts
    └── architecture-summary.test.ts

docs/issues/
├── discussions/                    ← 临时讨论，有生命周期
│   └── 2026-04-27-parallel-approach.md
│
├── development-plan.md             ← 阶段性路线图
└── issues-catalog.md               ← 历史参考（不再主动维护状态）
```

---

## 日常工作流

| 你遇到了... | 第一步 | 第二步 | 完成 |
|------------|--------|--------|------|
| Bug | 写失败测试 | 修代码 | 测试变绿 |
| 新 Feature 想法 | 写 `test.skip` | 实现，去 skip | 测试通过 |
| 改进想法 | 可测试部分 → `test.skip`，不可测试部分 → docs | 决策后全部流向测试 | 测试通过 |
| 还不确定要不要做 | 写 `docs/issues/discussions/` | 讨论完 → 转测试或删除 | — |

---

## 常用命令

```bash
# 所有未完成的 bug（失败测试）
npx vitest run tests/issues/bugs/ --reporter=verbose 2>&1 | grep FAIL

# 所有未实现的 feature/improvement（skip 测试）
npx vitest run tests/issues/ --reporter=verbose 2>&1 | grep SKIP

# 未决策的讨论
ls docs/issues/discussions/ | grep -v "已决策\|已放弃"
```

---

## 与其他方案的对比

| 维度 | Markdown 文件 | GitHub Issues | Issue as Test |
|------|-------------|---------------|---------------|
| 和代码同步 | 手动更新，容易漂移 | 手动关闭，容易忘 | 测试在代码里，天然同步 |
| 和测试同步 | 另一回事，需要人记得 | 另一回事 | 本身就是测试 |
| 可验证 | 不可执行 | 不可执行 | 可执行 |
| 本地可读 | 好 | 需要网络/CLI | 好，就是代码 |
| 做完即关闭 | 手动改状态 | 手动 close | 去 skip 就行，测试通过即关闭 |
| 漂移风险 | 高 | 中 | 极低 |

---

## 迁移计划（待确认）

如果决定采用此方案：

1. 创建 `tests/issues/` 目录及子目录（bugs/、features/、improvements/）
2. 将 issues-catalog.md 中的每条 issue 转化为测试用例
3. Bug 写失败测试，Feature/改进写 `test.skip`
4. 创建 `docs/issues/discussions/` 目录
5. 将纯讨论性内容移入 discussions/
6. issues-catalog.md 降级为历史参考，不再主动维护状态
