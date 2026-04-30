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

四层防护机制，确保 provider 的 model + baseUrl + authToken 作为完整套件生效：

### 第 1 层（核心）：写入用户级 `~/.claude/settings.local.json`

在 `applyCurrentProvider()` 和 `provider --switch` 中，将当前 provider 的完整 env 配置写入用户级 `~/.claude/settings.local.json`，并做 merge 保留已有设置：

```typescript
// error-handler.ts - writeProviderToUserLocalSettings()
const settingsPath = path.join(os.homedir(), '.claude', 'settings.local.json');

// 读取已有设置，做 merge
let existing = {};
try { existing = JSON.parse(await fs.readFile(settingsPath, 'utf-8')); } catch {}

const settings = {
  ...existing,                          // 保留用户已有的其他设置
  env: {
    ...(existing.env || {}),            // 保留用户已有的其他 env
    ANTHROPIC_AUTH_TOKEN: envConfig.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_BASE_URL: envConfig.ANTHROPIC_BASE_URL,
    ANTHROPIC_MODEL: envConfig.ANTHROPIC_MODEL,
  },
};
await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
```

**选择用户级而非项目级的原因：**

`provider --switch` 是全局命令（不限定某个项目），写用户级 `~/.claude/settings.local.json` 可以一次切换影响所有项目。优先级链：

```
1. 项目 .claude/settings.local.json   ← 最高（不碰，用户可能有自己的考量）
2. 项目 .claude/settings.json
3. 用户 ~/.claude/settings.local.json ← 写这里，高于 ~/.claude/settings.json
4. 用户 ~/.claude/settings.json       ← 之前覆盖 SDK 传参的元凶
```

用户级 `settings.local.json` 优先级高于用户级 `settings.json`，足以覆盖全局默认配置。如果项目级有 `ANTHROPIC_*` 配置，会打印警告提醒用户，但不会去修改项目文件。

### 项目级冲突检测

`applyCurrentProvider()` 会检查项目级 `.claude/settings.local.json` 是否设置了 `ANTHROPIC_*`：

```typescript
// error-handler.ts - checkProjectLocalSettings()
const projectSettings = JSON.parse(await fs.readFile(projectClaudeDir + '/settings.local.json', 'utf-8'));
if (projectSettings.env?.ANTHROPIC_BASE_URL || projectSettings.env?.ANTHROPIC_MODEL ...) {
  console.warn('⚠️ 项目级 settings.local.json 设置了 ANTHROPIC_*，优先级最高，会覆盖 harness 的 provider 配置');
}
```

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
provider 切换时 (provider --switch 或 run 中自动切换)：
  applyCurrentProvider()
    ├── 1. 写 process.env.ANTHROPIC_*              ← 当前进程生效
    ├── 2. 写 ~/.claude/settings.local.json (merge) ← 全局生效，覆盖 ~/.claude/settings.json
    └── 3. 检查项目级 settings.local.json 冲突     ← 有冲突则警告

query() 调用时：
  options: {
    model: provider.model,                   ← 显式指定模型
    env: { ...process.env, ANTHROPIC_* }     ← 含完整 provider 配置 + 系统变量
  }

CLI 子进程启动时：
  1. 继承 options.env 的环境变量
  2. 读 ~/.claude/settings.local.json → 覆盖 ~/.claude/settings.json 的配置 ✅
  （如果项目有 .claude/settings.local.json → 最高优先级，会覆盖用户级配置 → ⚠️ 警告用户）
```

## 影响范围

- `src/core/error-handler.ts` — 新增 `writeProviderToUserLocalSettings()`、`checkProjectLocalSettings()`
- `src/core/orchestrator.ts` — 修改 `applyCurrentProvider()` 写入用户级 settings、检查项目级冲突；新增 `getProviderQueryOptions()`
- `src/core/evaluator.ts` — 在 `query()` 调用中传入完整 provider 配置
- `src/commands/provider.ts` — `--switch` 时也写入 `~/.claude/settings.local.json`

## 验证方法

```bash
# 1. 单元测试
npx vitest run

# 2. provider --switch 写入 ~/.claude/settings.local.json
node dist/index.js provider --switch <provider-name>
cat ~/.claude/settings.local.json  # 验证 ANTHROPIC_* 已更新

# 3. merge 行为：已有其他设置不受影响
# 4. 项目级冲突警告：在项目中创建 .claude/settings.local.json 带 ANTHROPIC_* 字段
```
