# Issue: 建立 AI 原生质量控制体系，防止全自动开发中的代码腐化

**Created**: 2026-04-16
**Status**: Open (待讨论与规划)
**Priority**: High

---

## 问题描述

当前 harness 的核心流程（Planner → Generator → Evaluator）在从零到一的开发中已经验证有效，但对于**代码质量的长期演进**缺乏系统性约束。随着任务数量增加，AI 生成的代码容易出现以下典型问题：

1. **一致性破坏**：同一种逻辑出现多种不同写法
2. **过度设计**：为小功能引入不必要的抽象层
3. **补丁摞补丁**：bug 修复以临时 workaround 的形式堆积
4. **隐形回归**：修改 A 功能时顺手改坏了 B 功能
5. **上下文与文档脱节**：代码和 `spec.md` / `ARCHITECTURE.md` 逐渐不同步

这些问题本质上就是**全自动开发环境下的"屎山"现象**。仅仅依赖 Evaluator 的事后检测不足以根绝，需要把确定性的、程序化的约束嵌入到开发的完整生命周期。

---

## 核心认知

### AI 质量控制 ≠ 传统 Code Review

它不是"等代码写完了再找问题"，而是**"让写烂代码这件事在物理上不可行或代价极高"**。

| 阶段 | 传统 Code Review | AI 原生质量控制 |
|------|------------------|-----------------|
| 写之前 | 不介入 | 架构规则、代码模板、类型先行 |
| 写之中 | 不介入 | 实时 lint、编译报错、强制 gate |
| 写之后 | 人工逐行阅读 diff | LLM evaluator + 自动化测试 + 回归检查 + 架构审查 |

最合理的分工是：**工具负责"不能错"，人负责"对不对"**。

---

## 五层质量控制体系

### 1. 预防层：让 AI "写不出"烂代码

**强制的架构契约（Architectural Contracts）**
- 在 Generator 工作前注入 `architecture-rules.yaml`，定义分层、依赖方向、文件命名等
- 规则可程序化验证，不通过则 block 提交

**基于模板的生成约束（Template-Driven Generation）**
- 预置代码模板：`templates/api-route.ts`、`templates/component.tsx`
- Generator 的 prompt 中明确要求："如果要创建新的 X，先读取 `templates/X.ts`，不要从零写"

**类型优先（Type-Driven Development）**
- 增加一个前置步骤：Generator 先产出类型/接口变更
- 由 Type Checker Agent 验证通过后才允许写具体实现

---

### 2. 检测层：LLM + 确定性工具的混合质量门

每个 sprint 或每次 commit 后，强制跑以下分层检查：

| Gate | 工具示例 | 拦截问题 |
|------|---------|---------|
| **编译门** | `tsc --noEmit` | 类型错误、循环依赖 |
| **风格门** | ESLint + Prettier | 格式混乱、禁用 API |
| **安全门** | Semgrep / CodeQL | SQL 注入、XSS、硬编码密钥 |
| **架构门** | 自定义脚本 / depcheck | 非法跨层引用、重复代码 |
| **测试门** | 单元测试 + 集成测试 | 功能回归 |
| **性能门** | Lighthouse / bundle analyzer | 包体积暴增、性能退化 |

**专门针对 AI 的 Lint 规则**
- 禁止未解释的 magic number/string
- 禁止未使用的抽象（只用一次的 utility）
- 复杂度超过阈值必须附带 "why" 注释
- 强制使用已有模式（pattern alignment）

---

### 3. 修复层：结构化修复，而非补丁式修复

Evaluator 报告应附带 `fix_strategy`：
- `patch`：局部修复
- `refactor`：必须通读相关代码，设计重构方案后再执行
- `rollback`：如果修复成本高于重做，回滚到上一个 git tag

**引入 Refactor Agent**
- 当某文件连续两次被 evaluator 指出问题，或复杂度超过阈值时
- 由专门的 Refactor Agent 负责：简化函数、消除重复、拆分大文件

**Context Reset 后的债务检查**
- 每次 context reset 时，运行 Debt Scanner Agent
- 检查 TODO 注释、临时 workaround、未覆盖的新代码
- 输出 `tech-debt-report.json`，下一个 Generator 必须优先处理

---

### 4. 架构层：系统设计上防止全局腐化

**接口隔离的 Sprint 设计**
- 每个 task 必须声明：
  - `input_interfaces`：依赖的已有模块/接口
  - `output_interfaces`：会暴露的新接口
  - `forbidden_modifications`：不允许修改的文件列表
- Evaluator 验收时，同时检查接口契约是否被破坏

**活的文档（Living Docs）**
- 每个 Sprint 结束后，Generator 必须更新：
  - `ARCHITECTURE.md`：模块关系图
  - `API.md`：接口变更
  - `DECISIONS.md`：关键设计决策
- Evaluator 增加 `doc_sync` 检查项

---

### 5. 增量项目特别策略

**变更影响面分析（Impact Analysis）**
- Generator 动手前，必须回答：
  - 要修改哪些文件？
  - 这些文件被哪些测试覆盖？
  - 有哪些其他功能依赖它们？
- 由静态分析工具（ts-morph / dependency-cruiser）自动提供数据

**沙箱验证 + Diff Review Agent**
- Generator 在 feature branch 上工作
- 完成后由 Diff Review Agent 审查：
  - 变更是否超出 task 范围？
  - 有没有删除不该删的代码？
  - 未要求修改的文件里出现了什么变化？

**回归测试集自动扩充**
- 每次修复 bug 或实现功能后，Generator 必须为该场景写一个测试
- 测试集随开发进度自然增厚

---

## Code Review 在 AI 开发中的定位

### 审 AI 代码 vs 审人代码的重点差异

**审人代码**：关注意图表达、知识传递、边界情况考虑
**审 AI 代码**：关注一致性、节制、隐形凑合、沉默回归

### AI 代码的 Code Review Checklist

```
□ 范围控制：改动是否聚焦？有无"顺手优化"的无关变更？
□ 模式对齐：是否遵循了项目现有约定？有无更好的新抽象破坏一致性？
□ 节制原则：能不能删 20% 代码还不影响功能？
□ 非变更区审查：diff 之外有没有被静默修改的文件？
□ 边界验证：看起来"有处理"的地方，是真处理了还是只写了 if (data)
□ 测试覆盖：核心路径是否有测试？测试在测行为还是实现细节？
□ 文档同步：接口/架构文档是否已更新？
□ 债务标记：有没有 TODO、FIXME、临时 workaround？
```

---

## 待实施的关键改进项（按优先级）

### P0：立即落地
1. **强制质量门（Quality Gates）**
   - 将 `tsc --noEmit` + ESLint + 测试套件嵌入到 Generator 提交后的自动流程
   - 任一 gate 失败即 block，反馈给 Generator 修复

2. **架构规则与代码模板**
   - 为当前项目创建 `architecture-rules.yaml` 和 `templates/` 目录
   - 更新 Generator prompt，要求强制遵循

### P1：接下来做
3. **回归测试机制**
   - 每完成 N 个任务执行一次全量回归
   - 增加 Diff Review Agent，重点审查非预期变更

4. **Refactor Agent 与修复策略**
   - Evaluator 输出增加 `fix_strategy` 字段
   - 同一文件问题重复出现时触发 Refactor Agent

### P2：长期建设
5. **类型优先流程**
   - 增加 "先写类型，再写实现" 的前置步骤

6. **增量项目的 Codebase Archaeology**
   - 为已有项目引入自动化的架构分析、影响面分析

---

## 与现有改进计划的关联

- 与 **改进 2（验收标准变成可执行测试）** 直接互补：测试是质量门的核心
- 与 **改进 3（周期性全量回归）** 直接互补：检测 AI 的沉默回归
- 与 **改进 4（维护活的架构摘要）** 直接互补：Living Docs 是架构层的落地
- 与 **改进 6（Git tag 做回滚锚点）** 直接互补：为修复层提供 rollback 能力
- 与 `issue-incremental-development.md` 直接相关：增量场景是质量控制体系最重要的战场

---

## 相关文档

- `docs/issues-4-improvement-plan.md`
- `docs/issue-incremental-development.md`
- `prompts/generator.md`
- `prompts/evaluator.md`
