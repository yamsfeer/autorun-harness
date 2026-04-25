import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// 固定 home 目录路径 —— ProviderManager 的 GLOBAL_CONFIG_DIR 在模块加载时计算
// 所以 os.homedir() 的返回值必须在模块加载时就确定
// 注意：vi.mock 工厂函数内不能引用外部变量（hoisting 规则），路径必须写死在工厂内
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/tmp/provider-e2e-home'),
    tmpdir: vi.fn(() => '/tmp'),
  },
  homedir: vi.fn(() => '/tmp/provider-e2e-home'),
  tmpdir: vi.fn(() => '/tmp'),
}));

// mock console 避免输出污染
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

import { createProviderManager } from '../../src/core/provider-manager.js';
import { parseErrorType, shouldSwitchProvider, createError } from '../../src/core/error-handler.js';

describe('ProviderManager E2E — 故障切换与恢复', () => {
  const configDir = path.join('/tmp/provider-e2e-home', '.config', 'autorun-harness', 'providers');

  beforeEach(async () => {
    // 创建配置目录
    await fs.mkdir(configDir, { recursive: true });
    logSpy.mockClear();
    warnSpy.mockClear();
  });

  afterEach(async () => {
    // 清理临时目录
    await fs.rm('/tmp/provider-e2e-home', { recursive: true, force: true });
  });

  /**
   * 辅助函数：写入 provider 配置文件
   */
  async function writeProviderConfig(name: string, config: Record<string, string>) {
    const filePath = path.join(configDir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * 辅助函数：写入 .state.json
   */
  async function writeState(state: Record<string, unknown>) {
    const statePath = path.join(configDir, '.state.json');
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * 辅助函数：读取 .state.json
   */
  async function readState(): Promise<Record<string, unknown>> {
    const statePath = path.join(configDir, '.state.json');
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content);
  }

  it('should switch to next provider on rate limit', async () => {
    // 准备：两个 provider，provider-a 为当前 active
    await writeProviderConfig('provider-a', {
      name: 'provider-a',
      authToken: 'token-a',
      baseUrl: 'https://api.a.com',
      model: 'model-a',
    });
    await writeProviderConfig('provider-b', {
      name: 'provider-b',
      authToken: 'token-b',
      baseUrl: 'https://api.b.com',
      model: 'model-b',
    });
    await writeState({
      currentProvider: 'provider-a',
      totalSwitches: 0,
      providers: {},
    });

    // 执行
    const manager = createProviderManager();
    await manager.initialize();

    const result = await manager.handleRateLimit();

    // 验证切换结果
    expect(result.success).toBe(true);
    expect(result.previousProvider).toBe('provider-a');
    expect(result.newProvider).toBe('provider-b');

    // 验证状态持久化到 .state.json
    const state = await readState();
    expect(state.currentProvider).toBe('provider-b');
    expect(state.totalSwitches).toBe(1);
    expect(state.lastSwitchAt).toBeDefined();

    const providersState = state.providers as Record<string, Record<string, unknown>>;
    expect(providersState['provider-a'].status).toBe('rate_limited');
    expect(providersState['provider-a'].rateLimitedAt).toBeDefined();
    expect(providersState['provider-b'].status).toBe('active');

    // 验证 provider-a 的静态配置文件不包含运行时字段
    const aConfigRaw = await fs.readFile(path.join(configDir, 'provider-a.json'), 'utf-8');
    const aConfig = JSON.parse(aConfigRaw);
    expect(aConfig.status).toBeUndefined();
    expect(aConfig.rateLimitedAt).toBeUndefined();
    expect(aConfig.authToken).toBe('token-a');
  });

  it('should mark provider as unavailable on usage limit', async () => {
    // 准备
    await writeProviderConfig('provider-a', {
      name: 'provider-a',
      authToken: 'token-a',
      baseUrl: 'https://api.a.com',
      model: 'model-a',
    });
    await writeProviderConfig('provider-b', {
      name: 'provider-b',
      authToken: 'token-b',
      baseUrl: 'https://api.b.com',
      model: 'model-b',
    });
    await writeState({
      currentProvider: 'provider-a',
      totalSwitches: 0,
      providers: {},
    });

    const manager = createProviderManager();
    await manager.initialize();

    const result = await manager.handleUsageLimit();

    // 验证
    expect(result.success).toBe(true);
    expect(result.newProvider).toBe('provider-b');

    const state = await readState();
    const providersState = state.providers as Record<string, Record<string, unknown>>;
    expect(providersState['provider-a'].status).toBe('unavailable');
    expect(providersState['provider-a'].unavailableAt).toBeDefined();
    expect(providersState['provider-a'].rateLimitedAt).toBeUndefined();
  });

  it('should fail to switch when all providers are limited', async () => {
    // 准备：只有一个 provider
    await writeProviderConfig('provider-a', {
      name: 'provider-a',
      authToken: 'token-a',
      baseUrl: 'https://api.a.com',
      model: 'model-a',
    });
    await writeState({
      currentProvider: 'provider-a',
      totalSwitches: 0,
      providers: {},
    });

    const manager = createProviderManager();
    await manager.initialize();

    // 第一次 rate limit：没有备用 provider，应该失败
    const result = await manager.handleRateLimit();

    expect(result.success).toBe(false);
    expect(result.reason).toContain('所有服务提供商');
    expect(result.instructions).toBeDefined();

    const state = await readState();
    expect(state.currentProvider).toBe('provider-a'); // 没有改变
  });

  it('should round-robin through multiple providers', async () => {
    // 准备：三个 provider
    for (const name of ['provider-a', 'provider-b', 'provider-c']) {
      await writeProviderConfig(name, {
        name,
        authToken: `token-${name}`,
        baseUrl: `https://api.${name}.com`,
        model: `model-${name}`,
      });
    }
    await writeState({
      currentProvider: 'provider-a',
      totalSwitches: 0,
      providers: {},
    });

    const manager = createProviderManager();
    await manager.initialize();

    // 第一次切换：a -> b
    const result1 = await manager.handleRateLimit();
    expect(result1.newProvider).toBe('provider-b');

    // 第二次切换：b -> c
    const result2 = await manager.handleRateLimit();
    expect(result2.newProvider).toBe('provider-c');

    // 第三次切换：c -> a（a 仍然 rate_limited，不可用）
    const result3 = await manager.handleRateLimit();
    expect(result3.success).toBe(false); // a 还是 rate_limited，无法回环

    const state = await readState();
    expect(state.totalSwitches).toBe(2);
  });

  it('should recover rate_limited provider after cooldown period', async () => {
    // 准备：一个 rate_limited 的 provider（冷却期已过）
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await writeProviderConfig('provider-a', {
      name: 'provider-a',
      authToken: 'token-a',
      baseUrl: 'https://api.a.com',
      model: 'model-a',
    });
    await writeState({
      currentProvider: 'provider-a',
      totalSwitches: 0,
      providers: {
        'provider-a': {
          status: 'rate_limited',
          rateLimitedAt: twoHoursAgo,
        },
      },
    });

    const manager = createProviderManager();
    await manager.initialize();

    // 初始化时会调用 checkRecovery()，冷却期已过的 provider 应该恢复
    const availableProviders = manager.getAvailableProviders();
    const providerA = availableProviders.find(p => p.name === 'provider-a');

    expect(providerA?.status).toBe('available');

    const state = await readState();
    const providersState = state.providers as Record<string, Record<string, unknown>>;
    expect(providersState['provider-a'].status).toBe('available');
    expect(providersState['provider-a'].rateLimitedAt).toBeUndefined();
  });

  it('should not recover rate_limited provider before cooldown expires', async () => {
    // 准备：一个刚被 rate_limited 的 provider（冷却期未过）
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await writeProviderConfig('provider-a', {
      name: 'provider-a',
      authToken: 'token-a',
      baseUrl: 'https://api.a.com',
      model: 'model-a',
    });
    await writeProviderConfig('provider-b', {
      name: 'provider-b',
      authToken: 'token-b',
      baseUrl: 'https://api.b.com',
      model: 'model-b',
    });
    await writeState({
      currentProvider: 'provider-b',
      totalSwitches: 0,
      providers: {
        'provider-a': {
          status: 'rate_limited',
          rateLimitedAt: fiveMinutesAgo,
        },
      },
    });

    const manager = createProviderManager();
    await manager.initialize();

    // provider-a 仍然 rate_limited，不应恢复
    const availableProviders = manager.getAvailableProviders();
    const providerA = availableProviders.find(p => p.name === 'provider-a');

    expect(providerA).toBeUndefined();

    // getAllProviders 仍然能看到它，但状态是 rate_limited
    const allProviders = manager.getAllProviders();
    expect(allProviders.find(p => p.name === 'provider-a')?.status).toBe('rate_limited');
  });

  it('should integrate with error-handler to identify rate_limit errors', async () => {
    // 验证 error-handler 的 parseErrorType 能正确识别各种错误
    const rateLimitError = createError('rate_limit', 'Rate limit exceeded: 429 Too Many Requests');
    expect(parseErrorType(rateLimitError)).toBe('rate_limit');
    expect(shouldSwitchProvider(rateLimitError)).toBe(true);

    const usageLimitError = createError('usage_limit', 'Quota exceeded for this month');
    expect(parseErrorType(usageLimitError)).toBe('usage_limit');
    expect(shouldSwitchProvider(usageLimitError)).toBe(true);

    const timeoutError = createError('api_timeout', 'Request timeout');
    expect(parseErrorType(timeoutError)).toBe('api_timeout');
    expect(shouldSwitchProvider(timeoutError)).toBe(false);

    const networkError = createError('network', 'ECONNREFUSED');
    expect(parseErrorType(networkError)).toBe('network');
    expect(shouldSwitchProvider(networkError)).toBe(false);
  });

  it('should persist provider state across re-initialization', async () => {
    // 准备
    await writeProviderConfig('provider-a', {
      name: 'provider-a',
      authToken: 'token-a',
      baseUrl: 'https://api.a.com',
      model: 'model-a',
    });
    await writeProviderConfig('provider-b', {
      name: 'provider-b',
      authToken: 'token-b',
      baseUrl: 'https://api.b.com',
      model: 'model-b',
    });
    await writeState({
      currentProvider: 'provider-a',
      totalSwitches: 0,
      providers: {},
    });

    // 第一次初始化并切换
    const manager1 = createProviderManager();
    await manager1.initialize();
    await manager1.handleRateLimit();

    // 创建新的 ProviderManager 实例（模拟进程重启）
    const manager2 = createProviderManager();
    await manager2.initialize();

    // 验证状态被正确恢复
    expect(manager2.getCurrentProvider()?.name).toBe('provider-b');
    const allProviders = manager2.getAllProviders();
    expect(allProviders.find(p => p.name === 'provider-a')?.status).toBe('rate_limited');
    expect(allProviders.find(p => p.name === 'provider-b')?.status).toBe('active');
  });

  it('should keep static config clean without runtime fields', async () => {
    // 准备
    await writeProviderConfig('provider-x', {
      name: 'provider-x',
      authToken: 'secret-token',
      baseUrl: 'https://api.x.com',
      model: 'model-x',
      notes: 'test notes',
    });
    await writeState({
      currentProvider: 'provider-x',
      totalSwitches: 0,
      providers: {},
    });

    const manager = createProviderManager();
    await manager.initialize();

    // 触发切换（只有一个 provider，会失败，但当前 provider 会被标记）
    await manager.handleRateLimit();

    // 读取静态配置文件
    const configRaw = await fs.readFile(path.join(configDir, 'provider-x.json'), 'utf-8');
    const config = JSON.parse(configRaw);

    // 静态配置只应包含原始字段
    expect(config).toEqual({
      name: 'provider-x',
      authToken: 'secret-token',
      baseUrl: 'https://api.x.com',
      model: 'model-x',
      notes: 'test notes',
    });
    expect(config.status).toBeUndefined();
    expect(config.rateLimitedAt).toBeUndefined();
    expect(config.unavailableAt).toBeUndefined();
    expect(config.lastUsed).toBeUndefined();
  });
});
