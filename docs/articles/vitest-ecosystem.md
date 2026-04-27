# Vitest 测试生态全景

## 一、Vitest 与 Vite 的关系

Vitest 是基于 Vite 的测试框架，它**复用 Vite 的基础设施**而不是自己重新实现：

```
Vite 生态分工
┌─────────────┐     ┌─────────────┐
│    Vite     │ ──► │  构建工具    │
│  (底层引擎)  │     │  开发服务器  │
│             │     │  预览服务器  │
└─────────────┘     └─────────────┘
       ▲
       │ 基于
┌─────────────┐     ┌─────────────┐
│   Vitest    │ ──► │  测试发现    │
│  (测试框架)  │     │  断言、报告  │
└─────────────┘     └─────────────┘
```

这就是为什么 Vitest 没有 `vitest preview` 命令——它直接使用 `vite preview` 来预览生成的静态报告文件。

---

## 二、报告类型总览

### 2.1 终端输出（实时反馈，人阅读）

| Reporter | 说明 | 适用场景 |
|----------|------|----------|
| `spec` | 默认格式，详细列表 | 日常开发 |
| `dot` | 点号进度条 | 测试数量庞大时 |
| `tap` | TAP 协议格式 | 兼容旧工具链 |
| `verbose` | 每个测试用例都输出 | 调试具体用例 |
| `silent` | 只显示错误 | 最小干扰 |

```bash
# 使用示例
vitest run --reporter=dot
vitest run --reporter=tap
```

### 2.2 HTML 报告（可视化沉淀）

有两种实现路径：

| 方式 | 命令 | 特点 |
|------|------|------|
| **内置 html reporter** | `vitest run --reporter=html` | 生成静态 HTML 文件，可部署到任意服务器 |
| **@vitest/ui** | `vitest --ui` | 交互式 Web 界面，支持实时过滤、搜索、重跑测试 |

`@vitest/ui` 是本项目的 `devDependencies` 之一，启动后会打开一个完整的 Web 应用：

```bash
npx vitest --ui --open
```

### 2.3 覆盖率报告（多格式输出）

通过 `@vitest/coverage-v8` 生成，支持同时输出多种格式：

```ts
// vitest.config.ts
coverage: {
  provider: 'v8',
  reporter: [
    'text',      // 终端摘要（人看）
    'json',      // 机器消费
    'html',      // 可视化页面（人看）
    'lcov',      // 兼容 Coveralls / CodeCov 等云服务
    'clover',    // Atlassian 生态
    'cobertura'  // Jenkins / Azure DevOps
  ],
  reportsDirectory: 'tests/coverage'
}
```

### 2.4 结构化数据（CI / 机器消费）

```bash
# JUnit XML（几乎所有 CI 系统都支持）
vitest run --reporter=junit --outputFile=tests/reports/junit.xml

# JSON（供脚本二次处理）
vitest run --reporter=json --outputFile=tests/reports/results.json
```

---

## 三、本项目已配置的命令

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:report": "vitest run",
  "test:preview": "npx vite preview --outDir tests/html",
  "test:coverage": "vitest run --coverage",
  "test:coverage:preview": "npx vite preview --outDir tests/coverage"
}
```

| 命令 | 输出位置 | 说明 |
|------|----------|------|
| `npm test` | 终端 | 运行所有测试 |
| `npm run test:watch` | 终端 | 监听模式，文件变更自动重跑 |
| `npm run test:report` | `tests/html/` | 生成 HTML 测试报告 |
| `npm run test:preview` | `http://localhost:4173` | 预览 HTML 测试报告 |
| `npm run test:coverage` | `tests/coverage/` | 生成覆盖率报告 |
| `npm run test:coverage:preview` | `http://localhost:4173` | 预览覆盖率报告 |

---

## 四、完整生态图谱

```
Vitest 测试报告生态
│
├── 终端输出（人看，实时）
│   ├── spec（默认，详细列表）
│   ├── dot（紧凑进度）
│   ├── tap（协议兼容）
│   └── verbose / silent
│
├── HTML 可视化（人看，可沉淀）
│   ├── 内置 html reporter → 静态文件（可部署）
│   └── @vitest/ui → 交互式 Web 应用（实时重跑）
│
├── 覆盖率（人看 + 机器消费）
│   ├── text（终端摘要）
│   ├── html（可视化页面）
│   ├── json（机器消费）
│   └── lcov / clover / cobertura（CI 平台上传）
│
└── 结构化数据（纯机器消费）
    ├── junit.xml（CI 测试追踪）
    └── json（自定义脚本分析）
```

---

## 五、为什么使用 vite preview

Vitest 生成的是**静态 HTML 文件**（加上 CSS/JS 资源）。预览这些文件需要一个静态文件服务器，而 Vite 已经提供了这个功能：

```bash
# Vite 提供预览功能
npx vite preview --outDir <目录>

# Vitest 生成报告后，会提示你使用这个命令
# "You can run npx vite preview --outDir tests/html"
```

这避免了 Vitest 重复造轮子，也保持了与 Vite 生态的一致性。

---

## 六、扩展：CI 场景下的完整配置

如果需要对接 CI 流水线，通常的组合是：

```bash
vitest run \
  --reporter=default \
  --reporter=junit \
  --outputFile=tests/reports/junit.xml \
  --coverage
```

这样一次运行会同时产出：
- 终端摘要（给人看）
- `junit.xml`（给 CI 系统解析测试结果）
- `tests/coverage/` 下的多格式覆盖率报告（给代码覆盖率云服务）