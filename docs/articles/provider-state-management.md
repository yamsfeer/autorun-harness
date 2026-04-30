# Provider 状态管理设计文档

## 背景

autorun-harness 支持配置多个 AI 服务提供商（Provider），在某个 Provider 达到限额时自动切换到下一个。当前的实现存在几个问题：

1. **状态覆盖 bug**：`handleUsageLimit()` 将 Provider 标记为 `unavailable`，但随后 `switchToNext()` 无条件将其覆盖为 `rate_limited`，导致 `unavailable` 状态丢失
2. **无法自动恢复**：`unavailable` 状态永远不会自动恢复；`rate_limited` 的 1 小时恢复检查只在所有 Provider 都不可用时才触发
3. **进程重启后状态丢失**：没有启动时的恢复检查，进程重启后已过冷却期的 Provider 仍然卡在旧状态
4. **配置与状态混合**：静态配置（token、URL、model）和运行时状态（status、rateLimitedAt）混在同一个 JSON 文件中

## 设计方案

### 1. 分离静态配置与运行时状态

**Provider 配置文件**（`~/.config/autorun-harness/providers/*.json`）只保存静态信息：

```json
{
  "name": "zhijie-glm",
  "authToken": "f95d2eba-...",
  "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
  "model": "glm-5.1",
  "notes": "字节跳动 ARK 平台"
}
```

**状态文件**（`~/.config/autorun-harness/providers/.state.json`）保存运行时状态：

```json
{
  "currentProvider": "zhijie-glm",
  "totalSwitches": 1,
  "lastSwitchAt": "2026-04-15T18:54:19.874Z",
  "providers": {
    "zhijie-glm": {
      "status": "active",
      "lastUsed": "2026-04-15T18:54:19.873Z",
      "rateLimitedAt": null,
      "unavailableAt": null
    },
    "kimi": {
      "status": "available",
      "lastUsed": null,
      "rateLimitedAt": null,
      "unavailableAt": null
    }
  }
}
```

### 2. 冷却期自动恢复

| 状态 | 触发原因 | 冷却期 | 恢复目标 |
|---|---|---|---|
| `rate_limited` | 频率限制（429） | 1 小时 | `available` |
| `unavailable` | 用量限制/服务失效 | 24 小时 | `available` |

恢复机制不需要真正的定时器或 API 探测，而是**按需检查**：

- `initialize()` 启动时检查所有 Provider，冷却期已过的恢复为 `available`
- `getAvailableProviders()` 查询前先检查恢复
- `switchToNext()` 搜索前先检查恢复

这种方式即使进程崩溃重启，也能通过 `.state.json` 中的时间戳正确判断恢复状态。

### 3. Provider 状态流转

```
                    addProvider()
                        │
                        ▼
                   ┌──────────┐
                   │ available │◄──────────────────────┐
                   └────┬─────┘                        │
                        │ 被选为当前使用                  │
                        ▼                              │
                   ┌──────────┐                        │
               ┌──│  active   │──┐                     │
               │  └────┬─────┘  │                     │
               │       │        │                     │
          429限速│       │手动切换  │用量限制/失效         │
               ▼       ▼        ▼                     │
        ┌─────────────┐ │  ┌──────────────┐           │
        │rate_limited │ │  │ unavailable  │           │
        └──────┬──────┘ │  └──────┬───────┘           │
               │        │         │                    │
          1小时后│   手动切换│   24小时后│                │
               │        │         │                    │
               └────────┴─────────┼────────────────────┘
                                  │
                                  ▼
                            ┌──────────┐
                            │ available │
                            └──────────┘
```

### 4. 修复 handleUsageLimit bug

`switchToNext()` 改为接受 `statusToSet` 参数，由调用方决定当前 Provider 应标记为什么状态：

- `handleRateLimit()` → `switchToNext(reason, 'rate_limited')`
- `handleUsageLimit()` → `switchToNext(reason, 'unavailable')`

不再在 `switchToNext()` 内部硬编码 `rate_limited`。

### 5. 类型定义

```typescript
// 静态配置（保存到 provider JSON 文件）
export interface ProviderStaticConfig {
  name: string;
  authToken: string;
  baseUrl: string;
  model: string;
  notes?: string;
}

// 运行时状态（保存到 .state.json）
export interface ProviderRuntimeState {
  status: ProviderStatus;
  lastUsed?: string;
  rateLimitedAt?: string;
  unavailableAt?: string;
}

// 内存中的完整 Provider 对象（向后兼容）
export interface AIProvider extends ProviderStaticConfig, ProviderRuntimeState {}

// .state.json 文件格式
export interface ProviderStateFile {
  currentProvider: string;
  totalSwitches: number;
  lastSwitchAt?: string;
  providers: Record<string, ProviderRuntimeState>;
}
```

### 6. 环境变量传递机制 (Settings 优先级)

Provider 配置通过 Claude Code CLI 的 settings 优先级机制传递。CLI 启动时按以下优先级加载 settings 并应用 `env`：

```
1. 项目 .claude/settings.local.json    ← 最高优先级（harness 不修改）
2. 项目 .claude/settings.json
3. 用户 ~/.claude/settings.local.json  ← harness 写入这里（merge 保留已有设置）
4. 用户 ~/.claude/settings.json        ← 最低优先级
```

**四层防护确保 provider 配置生效：**

1. **`process.env`** — `applyProviderConfig()` 写入当前进程，立即生效
2. **`~/.claude/settings.local.json`** — `writeProviderToUserLocalSettings()` 写入用户级 local settings，做 merge 保留已有设置。优先级高于 `~/.claude/settings.json`，解决之前全局 settings.json 覆盖 SDK 传参的问题
3. **SDK `options.env`** — `getProviderQueryOptions()` 每次 `query()` 都传入完整 env，兜底
4. **项目级冲突检测** — `checkProjectLocalSettings()` 检查项目是否有 ANTHROPIC_* 配置，有则警告

```
ProviderManager.getEnvConfig()
    → { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL }
        │
        ▼
applyProviderConfig() → 写入 process.env (当前进程)
writeProviderToUserLocalSettings() → 写入 ~/.claude/settings.local.json (全局生效)
        │
        ▼
query() → SDK 启动子进程 → 子进程继承 options.env
        │
        ▼
Claude CLI 加载 settings（优先级：项目 local > 用户 local > 用户）
  → ~/.claude/settings.local.json 覆盖 ~/.claude/settings.json ✅
```

### 7. 迁移策略

首次运行新版本时，已有 provider 文件可能包含旧的运行时字段（status、lastUsed 等）。处理方式：

1. 读取 provider 文件，只提取静态字段，status 默认设为 `available`
2. 读取旧版 `.state.json`（无 `providers` map），无法恢复旧状态
3. 执行 `checkRecovery()`（无操作，因为所有都是 available）
4. `saveState()` 写入新格式
5. `saveProviderFile()` 清理旧文件中的运行时字段

## 与 CC-Switch 的关系

CC-Switch 是一个本地 HTTP 代理工具，通过拦截 Claude 的 API 请求实现实时切换 Provider。autorun-harness 不使用 CC-Switch，而是通过环境变量直接指定 Provider：

- 在 `initializeModules()` 中调用 `applyCurrentProvider()` 写入 `process.env`
- 后续所有 `query()` 启动的子进程继承这些环境变量
- 不依赖外部工具，配置文件是 Provider 的唯一事实来源
