# Bug: Provider 切换时模型与 baseUrl/authToken 不匹配

> 发现时间: 2026-04-30
> 严重程度: 🔴 Critical
> 状态: ✅ 已修复

---

## 现象

当 harness 切换到不同 provider（如从 DeepSeek 切换到 GLM）时，`query()` 实际调用的仍然是旧 provider 的 API endpoint，导致请求发到了错误的 baseUrl，返回 "model not supported" 错误。

**典型错误：**
```
API Error: 400 {"error":{"message":"The supported API model names are deepseek-v4-pro 
or deepseek-v4-flash, but you passed glm-5.1."}}
```

这个错误说明请求发到了 DeepSeek API，但 model 参数是 `glm-5.1`——model 和 baseUrl 不匹配。

## 根因

### 直接原因

`~/.claude/settings.json` 中硬编码了 DeepSeek 的 env 配置：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_MODEL": "deepseek-v4-pro"
  }
}
```

### 更深层原因：Claude Code CLI 的 settings 优先级机制

Claude Code CLI 在启动时按以下**优先级从高到低**加载 settings 并应用 `env` 覆盖：

```
1. 项目 .claude/settings.local.json    ← 最高优先级
2. 项目 .claude/settings.json
3. 用户 ~/.claude/settings.local.json
4. 用户 ~/.claude/settings.json        ← 最低优先级
```

settings.json 的 `env` 会在 CLI 启动时**覆盖进程的环境变量**。因此即使 harness 通过 SDK 的 `options.env` 传入了正确的 `ANTHROPIC_BASE_URL`，CLI 启动后也会被 `~/.claude/settings.json` 刷回 DeepSeek 的 URL。

**这就是为什么"只改 model 不改 baseUrl"会失败——baseUrl 根本改不了，总是被 settings.json 覆盖。**

### 旧代码的问题

修复前，harness 在调用 `query()` 时只传了 `model`，没有传 `env`（或传了但被 settings.json 覆盖）：

```typescript
// 旧代码：只传 model，baseUrl/authToken 依赖 process.env（会被 settings.json 覆盖）
const queryResult = query({
  prompt: userPrompt,
  options: {
    model: this.providerManager.getCurrentProvider()?.model,  // 只有 model
    // 没有 env —— ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 缺失或被 settings.json 覆盖
  },
});
```

而 `applyCurrentProvider()` 虽然写了 `process.env.ANTHROPIC_BASE_URL`，但 `~/.claude/settings.json` 会在 CLI 子进程启动后覆盖它。

## 解决方案

三层防护机制，确保 provider 的 model + baseUrl + authToken 作为完整套件生效：

### 第 1 层（核心）：写入项目级 `.claude/settings.local.json`

在 `applyCurrentProvider()` 中，将当前 provider 的完整 env 配置写入项目目录的 `.claude/settings.local.json`：

```typescript
// orchestrator.ts - applyCurrentProvider()
const claudeDir = path.join(this.projectDir, '.claude');
await fs.mkdir(claudeDir, { recursive: true });
const localSettings = {
  env: {
    ANTHROPIC_AUTH_TOKEN: envConfig.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_BASE_URL: envConfig.ANTHROPIC_BASE_URL,
    ANTHROPIC_MODEL: envConfig.ANTHROPIC_MODEL,
  },
};
await fs.writeFile(
  path.join(claudeDir, 'settings.local.json'),
  JSON.stringify(localSettings, null, 2),
  'utf-8'
);
```

由于项目级 `settings.local.json` 优先级**高于**用户级 `settings.json`，CLI 子进程启动后会使用 harness 写入的配置，覆盖用户的全局 DeepSeek 配置。

### 第 2 层：`query()` options 中传入完整 provider 配置

新增 `getProviderQueryOptions()` 方法，每次 `query()` 调用都传入 `model` + `env`（含 `...process.env` 以保留系统环境变量）：

```typescript
// orchestrator.ts
private getProviderQueryOptions() {
  const provider = this.providerManager.getCurrentProvider();
  if (!provider) return {};
  return {
    model: provider.model,
    env: {
      ...process.env,           // 必须保留，否则 SDK 丢失 PATH 等系统变量
      ANTHROPIC_AUTH_TOKEN: provider.authToken,
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_MODEL: provider.model,
    },
  };
}
```

⚠️ 关键注意事项：**`env` 选项会替换（而非合并）子进程的整个环境变量**。不加 `...process.env` 会导致 SDK 找不到 Node.js 可执行文件，报 `Claude Code executable not found`。

### 第 3 层（已有）：`applyProviderConfig()` 设置 `process.env`

保留原有的 `process.env` 写入逻辑，作为当前进程中的基础配置：

```typescript
// error-handler.ts
process.env.ANTHROPIC_AUTH_TOKEN = config.authToken;
process.env.ANTHROPIC_BASE_URL = config.baseUrl;
process.env.ANTHROPIC_MODEL = config.model;
```

### 完整流程

```
provider 切换时：
  applyCurrentProvider()
    ├── 1. 写 process.env.ANTHROPIC_*        ← 当前进程生效
    ├── 2. 写 .claude/settings.local.json    ← CLI 子进程 settings 最高优先级
    └── 3. getProviderQueryOptions() 传 env  ← 兜底，确保子进程 env 正确

query() 调用时：
  options: {
    model: provider.model,                   ← 显式指定模型
    env: { ...process.env, ANTHROPIC_* }     ← 含完整 provider 配置 + 系统变量
  }

CLI 子进程启动时：
  1. 继承 options.env 的环境变量
  2. 读 .claude/settings.local.json → 覆盖 settings.json 的配置 ✅
```

## 影响范围

- `src/core/orchestrator.ts` — 修改 `applyCurrentProvider()`、新增 `getProviderQueryOptions()`、修改两处 `query()` 调用
- `src/core/evaluator.ts` — 在 `query()` 调用中传入完整 provider 配置

## 验证方法

```bash
# 运行 provider 配置测试
node test_provider_config.mjs
```

测试结果（3/3 通过）：

| 配置方式 | 预期模型 | 实际模型 | 结果 |
|----------|----------|----------|------|
| DeepSeek via settings.local.json + model | deepseek-v4-pro | deepseek-v4-pro | ✅ |
| GLM via settings.local.json + model | glm-5.1 | glm-5.1 | ✅ |
| GLM via settings.local.json only | glm-5.1 | glm-5.1 | ✅ |
