# autorun-harness-evaluation

autorun-harness 框架的评估工具。对框架生成的项目进行自动化质量评估，输出两级指标报告。

## 安装

```bash
cd evaluation
npm install
npm run build
```

## 使用

```bash
# 基本用法：评估一个由 harness 生成的项目
node dist/index.js evaluate <project-dir>

# 仅输出 JSON（适合脚本处理）
node dist/index.js evaluate <project-dir> --json

# 只跑任务级指标，跳过构建/测试/lint 等项目级检查
node dist/index.js evaluate <project-dir> --skip-layer2

# 指定开发服务器地址（默认 http://localhost:3000）
node dist/index.js evaluate <project-dir> --dev-url http://localhost:8080

# 指定开发服务器启动超时（默认 15 秒）
node dist/index.js evaluate <project-dir> --dev-timeout 30
```

## 输出内容

### 第一层：任务级指标

从 `.harness/` 状态文件自动提取，不需要项目有可运行的代码。

| 指标 | 说明 |
|------|------|
| 首次通过率 | 第一次尝试就通过的任务占比 |
| 平均重试次数 | 每个完成任务的平均尝试次数 |
| 人工介入率 | 标记为 `needs_human` 的任务占比 |
| Token 成本 | 按代理（planner/generator/evaluator）和按任务分组 |
| 平均评估分数 | 所有评估报告的加权分数均值 |

### 第二层：项目级指标

对生成的项目执行自动化检查。缺少前置条件（如无 package.json、无 eslint 配置）的检查会自动跳过，不扣分。

**正确性：**
- 构建成功 — `npm run build` 是否通过
- 测试通过率 — `npm test` 通过的用例比例

**稳定性：**
- 开发服务器启动 — dev server 是否能正常响应
- 运行时零崩溃 — Playwright 打开页面后是否有 JS 错误

**质量：**
- TypeScript 错误数 — `tsc --noEmit` 报告的错误
- ESLint 问题数 — lint 报告的 errors + warnings
- 安全漏洞数 — `npm audit` 中 high + critical 级别的漏洞

## 评分规则

```
任务级 (0-100) = 首次通过率×30 + (1-人工介入率)×25 + (1-重试/3)×20 + 评估分×25
项目级 (0-100) = 通过的检查数 / 非跳过的检查数 × 100
综合评分 = (任务级 + 项目级) / 2

等级：A≥90  B≥80  C≥70  D≥60  F<60
```

## 报告文件

评估结果写入 `<project-dir>/.harness/evaluation-report.json`，包含完整的指标数据和评分。

## 典型工作流

```
# 1. 用 harness 生成项目
autorun-harness init ./my-project --prd ./PRD.md
autorun-harness run ./my-project

# 2. 评估框架表现（基线）
node dist/index.js evaluate ./my-project

# 3. 实施框架改进后，再跑一次同样的项目，对比指标差异
node dist/index.js evaluate ./my-project
```
