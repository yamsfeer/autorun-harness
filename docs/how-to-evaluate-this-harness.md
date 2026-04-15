# 评估体系

> 通过两级指标量化评估框架能力。改进前后各跑一次，通过指标差异验证改进效果。

---

## 第一层：任务级指标

从框架运行时的状态文件自动提取，零人工。

| 指标 | 数据来源 | 计算方式 |
|------|----------|----------|
| 首次通过率 | `tasks.json` 的 `attempts` | attempts 为 0 的已完成任务数 / 已完成任务总数 |
| 平均重试次数 | `tasks.json` | sum(attempts) / completed_count |
| 人工介入率 | `tasks.json` 的 status | needs_human 数 / total |
| 每 Agent Token 成本 | `costs.json` | 按 agent 字段分组，sum(input + output) |
| 每任务 Token 成本 | `costs.json` | 按 taskId 字段分组，sum(input + output) |
| 总 Token 成本 | `costs.json` | sum(input_tokens + output_tokens) |
| 评估加权分数均值 | `reports/*.json` | sum(total_weighted_score) / report_count |

---

## 第二层：项目级指标

为标准 PRD 预写测试套件（一次性人工投入），之后评估全部自动化。

### 维度一：正确性

| 指标 | 测量方式 | 通过标准 |
|------|----------|----------|
| 构建成功率 | `npm run build` 退出码 | 退出码为 0 |
| 测试通过率 | `npm test` | 通过用例数 / 总用例数 |

### 维度二：稳定性

| 指标 | 测量方式 | 通过标准 |
|------|----------|----------|
| 启动成功率 | 启动 dev server，检查端口是否响应 HTTP | 返回 200 |
| 运行时零崩溃 | Playwright 执行核心流程，监控 console.error | 0 个未捕获异常 |

### 维度三：质量

| 指标 | 测量方式 | 通过标准 |
|------|----------|----------|
| TypeScript 错误数 | `tsc --noEmit` | 错误数为 0 |
| ESLint 问题数 | `eslint . --format json` | warnings + errors 总数 |
| 安全漏洞数 | `npm audit` | high + critical 级别数量 |

---

## 评估流程

```
1. 准备阶段（一次性）
   ├── 编写 3 个标准 PRD（简单 / 中等 / 复杂）
   └── 为每个 PRD 编写完整测试套件

2. 基线评估
   ├── 当前版本框架跑 3 个 PRD
   ├── 自动提取第一层指标
   └── 自动提取第二层指标

3. 实施改进
   └── 按 P0 → P1 → P2 优先级逐项实施

4. 改进后评估
   ├── 同一框架跑同样的 3 个 PRD
   ├── 自动提取两层指标
   └── 与基线对比，生成差异报告
```

---

## 标准项目

| 项目 | 复杂度 | 覆盖范围 | 技术栈 |
|------|--------|----------|--------|
| Todo App | 简单 | CRUD、状态管理、基本 UI | 待定 |
| 博客系统 | 中等 | 认证、文章管理、评论、分页 | 待定 |
| 电商购物车 | 复杂 | 商品列表、购物车、结算、库存 | 待定 |
