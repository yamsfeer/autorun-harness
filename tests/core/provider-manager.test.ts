import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 在工厂内定义 mock 变量，避免 hoisting 问题
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockReadFile = vi.fn().mockRejectedValue(new Error('file not found'));
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  default: {
    mkdir: (...args: any[]) => mockMkdir(...args),
    readdir: (...args: any[]) => mockReaddir(...args),
    readFile: (...args: any[]) => mockReadFile(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    unlink: (...args: any[]) => mockUnlink(...args),
  },
  mkdir: (...args: any[]) => mockMkdir(...args),
  readdir: (...args: any[]) => mockReaddir(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
}));

vi.mock('os', () => ({
  default: { homedir: () => '/mock/home' },
  homedir: () => '/mock/home',
}));

import { createProviderManager, getProviderManager, ProviderManager } from '../../src/core/provider-manager.js';
import fs from 'fs/promises';

describe('ProviderManager', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const configDir = '/mock/home/.config/autorun-harness/providers';

  function createManager(): ProviderManager {
    return createProviderManager();
  }

  function mockReadFileWithMap(fileMap: Record<string, string>) {
    mockReadFile.mockImplementation(async (filePath: any) => {
      const key = String(filePath);
      if (fileMap[key] !== undefined) return fileMap[key];
      throw new Error(`ENOENT: ${key}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockClear().mockResolvedValue(undefined);
    mockReaddir.mockClear().mockResolvedValue([]);
    mockReadFile.mockClear().mockRejectedValue(new Error('file not found'));
    mockWriteFile.mockClear().mockResolvedValue(undefined);
    mockUnlink.mockClear().mockResolvedValue(undefined);
  });

  afterEach(() => {
    warnSpy.mockClear();
  });

  // === 工厂函数 ===
  it('createProviderManager should return a new instance', () => {
    const m1 = createProviderManager();
    const m2 = createProviderManager();
    expect(m1).not.toBe(m2);
    expect(m1).toBeInstanceOf(ProviderManager);
  });

  it('getProviderManager should return singleton', () => {
    const m1 = getProviderManager();
    const m2 = getProviderManager();
    expect(m1).toBe(m2);
  });

  it('getConfigDir should return config directory path', () => {
    const manager = createManager();
    expect(manager.getConfigDir()).toBe(configDir);
  });

  // === initialize ===
  it('initialize should create config dir when empty', async () => {
    const manager = createManager();
    mockReaddir.mockResolvedValueOnce([]);

    await manager.initialize();

    expect(mockMkdir).toHaveBeenCalledWith(configDir, { recursive: true });
  });

  it('initialize should load provider configs from json files', async () => {
    const manager = createManager();
    mockReaddir.mockResolvedValueOnce(['openai.json', 'anthropic.json']);
    mockReadFileWithMap({
      [`${configDir}/openai.json`]: JSON.stringify({ name: 'openai', authToken: 'tok1', baseUrl: 'https://api.openai.com', model: 'gpt-4' }),
      [`${configDir}/anthropic.json`]: JSON.stringify({ name: 'anthropic', authToken: 'tok2', baseUrl: 'https://api.anthropic.com', model: 'claude-3' }),
    });

    await manager.initialize();

    const all = manager.getAllProviders();
    expect(all).toHaveLength(2);
    expect(all.map(p => p.name)).toContain('openai');
    expect(all.map(p => p.name)).toContain('anthropic');
  });

  it('initialize should skip corrupted json files', async () => {
    const manager = createManager();
    mockReaddir.mockResolvedValueOnce(['good.json', 'bad.json']);
    mockReadFileWithMap({
      [`${configDir}/good.json`]: JSON.stringify({ name: 'good', authToken: 't', baseUrl: 'http://x', model: 'm' }),
      [`${configDir}/bad.json`]: 'not valid json',
    });

    await manager.initialize();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad.json'));
    expect(manager.getAllProviders()).toHaveLength(1);
    expect(manager.getAllProviders()[0].name).toBe('good');
  });

  it('initialize should skip hidden files', async () => {
    const manager = createManager();
    mockReaddir.mockResolvedValueOnce(['provider.json', '.state.json']);
    mockReadFileWithMap({
      [`${configDir}/provider.json`]: JSON.stringify({ name: 'p', authToken: 't', baseUrl: 'http://x', model: 'm' }),
    });

    await manager.initialize();

    expect(manager.getAllProviders()).toHaveLength(1);
    expect(manager.getAllProviders()[0].name).toBe('p');
  });

  it('initialize should load state and merge runtime status', async () => {
    const manager = createManager();
    mockReaddir.mockResolvedValueOnce(['p1.json']);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockReadFileWithMap({
      [`${configDir}/p1.json`]: JSON.stringify({ name: 'p1', authToken: 't', baseUrl: 'http://x', model: 'm' }),
      [`${configDir}/.state.json`]: JSON.stringify({
        currentProvider: 'p1',
        totalSwitches: 3,
        providers: {
          p1: { status: 'rate_limited', rateLimitedAt: twoHoursAgo },
        },
      }),
    });

    await manager.initialize();

    const p = manager.getCurrentProvider();
    expect(p?.name).toBe('p1');
    // 2 hours > 1 hour cooldown, should recover to available
    expect(p?.status).toBe('available');
  });

  it('initialize should set first provider as active when no state file', async () => {
    const manager = createManager();
    mockReaddir.mockResolvedValueOnce(['p1.json', 'p2.json']);
    mockReadFileWithMap({
      [`${configDir}/p1.json`]: JSON.stringify({ name: 'p1', authToken: 't1', baseUrl: 'http://a', model: 'm1' }),
      [`${configDir}/p2.json`]: JSON.stringify({ name: 'p2', authToken: 't2', baseUrl: 'http://b', model: 'm2' }),
    });

    await manager.initialize();

    const current = manager.getCurrentProvider();
    expect(current?.name).toBe('p1');
    expect(current?.status).toBe('available');
  });

  // === addProvider ===
  it('addProvider should write file and set as active if first', async () => {
    const manager = createManager();
    await manager.addProvider({
      name: 'new-provider',
      authToken: 'token',
      baseUrl: 'https://api.example.com',
      model: 'model-x',
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${configDir}/new-provider.json`,
      expect.stringContaining('"name": "new-provider"'),
      'utf-8'
    );
    expect(manager.getCurrentProvider()?.name).toBe('new-provider');
    expect(manager.getCurrentProvider()?.status).toBe('active');
  });

  it('addProvider should not change current if already set', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'first', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'second', authToken: 't', baseUrl: 'http://b', model: 'm' });

    expect(manager.getCurrentProvider()?.name).toBe('first');
    expect(manager.getAllProviders()).toHaveLength(2);
  });

  // === removeProvider ===
  it('removeProvider should delete file and remove from memory', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });
    // switch to p2 so p1 can be removed
    await manager.switchTo('p2');

    const result = await manager.removeProvider('p1');

    expect(result).toBe(true);
    expect(mockUnlink).toHaveBeenCalledWith(`${configDir}/p1.json`);
    expect(manager.getAllProviders().map(p => p.name)).not.toContain('p1');
  });

  it('removeProvider should throw if removing current provider', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });

    await expect(manager.removeProvider('p1')).rejects.toThrow('无法删除正在使用的提供商');
  });

  it('removeProvider should return false for non-existent provider', async () => {
    const manager = createManager();
    const result = await manager.removeProvider('nonexistent');
    expect(result).toBe(false);
  });

  // === switchTo ===
  it('switchTo should change active provider', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });

    const result = await manager.switchTo('p2');

    expect(result.success).toBe(true);
    expect(result.newProvider).toBe('p2');
    expect(result.previousProvider).toBe('p1');
    expect(manager.getCurrentProvider()?.name).toBe('p2');
    expect(manager.getCurrentProvider()?.status).toBe('active');
  });

  it('switchTo should reset previous provider status to available', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });

    await manager.switchTo('p2');

    const p1 = manager.getAllProviders().find(p => p.name === 'p1');
    expect(p1?.status).toBe('available');
  });

  it('switchTo should return failure for non-existent provider', async () => {
    const manager = createManager();
    const result = await manager.switchTo('nonexistent');

    expect(result.success).toBe(false);
    expect(result.reason).toContain('找不到');
  });

  // === switchToNext ===
  it('switchToNext should round-robin to next available provider', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });

    const result = await manager.switchToNext('test reason', 'rate_limited');

    expect(result.success).toBe(true);
    expect(result.previousProvider).toBe('p1');
    expect(result.newProvider).toBe('p2');
    expect(result.reason).toBe('test reason');
  });

  it('switchToNext should mark current as rate_limited', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });

    await manager.switchToNext('rate limit', 'rate_limited');

    const p1 = manager.getAllProviders().find(p => p.name === 'p1');
    expect(p1?.status).toBe('rate_limited');
    expect(p1?.rateLimitedAt).toBeDefined();
  });

  it('switchToNext should return failure when no providers configured', async () => {
    const manager = createManager();
    const result = await manager.switchToNext('test');

    expect(result.success).toBe(false);
    expect(result.reason).toContain('没有配置');
  });

  it('switchToNext should return failure when all providers limited', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.switchToNext('', 'rate_limited');

    const result = await manager.switchToNext('', 'rate_limited');

    expect(result.success).toBe(false);
    expect(result.reason).toContain('所有服务提供商');
  });

  // === handleRateLimit / handleUsageLimit ===
  it('handleRateLimit should delegate to switchToNext with correct reason and status', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });

    const result = await manager.handleRateLimit();

    expect(result.success).toBe(true);
    expect(result.reason).toContain('频率限制');
    const p1 = manager.getAllProviders().find(p => p.name === 'p1');
    expect(p1?.status).toBe('rate_limited');
  });

  it('handleUsageLimit should delegate to switchToNext with correct reason and status', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });

    const result = await manager.handleUsageLimit();

    expect(result.success).toBe(true);
    expect(result.reason).toContain('用量限制');
    const p1 = manager.getAllProviders().find(p => p.name === 'p1');
    expect(p1?.status).toBe('unavailable');
  });

  // === checkRecovery ===
  it('checkRecovery should recover rate_limited after 1 hour', async () => {
    const manager = createManager();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.switchToNext('', 'rate_limited');

    // Manually set the rateLimitedAt to 2 hours ago
    const p1 = manager.getAllProviders().find(p => p.name === 'p1');
    if (p1) p1.rateLimitedAt = twoHoursAgo;

    const recovered = manager.checkRecovery();

    expect(recovered).toBe(1);
    expect(p1?.status).toBe('available');
    expect(p1?.rateLimitedAt).toBeUndefined();
  });

  it('checkRecovery should not recover rate_limited before 1 hour', async () => {
    const manager = createManager();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.switchToNext('', 'rate_limited');

    const p1 = manager.getAllProviders().find(p => p.name === 'p1');
    if (p1) p1.rateLimitedAt = thirtyMinAgo;

    const recovered = manager.checkRecovery();

    expect(recovered).toBe(0);
    expect(p1?.status).toBe('rate_limited');
  });

  it('checkRecovery should recover unavailable after 24 hours', async () => {
    const manager = createManager();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.switchToNext('', 'unavailable');

    const p1 = manager.getAllProviders().find(p => p.name === 'p1');
    if (p1) p1.unavailableAt = twoDaysAgo;

    const recovered = manager.checkRecovery();

    expect(recovered).toBe(1);
    expect(p1?.status).toBe('available');
  });

  // === getEnvConfig ===
  it('getEnvConfig should return current provider env vars', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 'my-token', baseUrl: 'https://api.example.com', model: 'model-x' });

    const env = manager.getEnvConfig();

    expect(env).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'my-token',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      ANTHROPIC_MODEL: 'model-x',
    });
  });

  it('getEnvConfig should return null when no current provider', () => {
    const manager = createManager();
    expect(manager.getEnvConfig()).toBeNull();
  });

  // === getAvailableProviders ===
  it('getAvailableProviders should filter by available or active status', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });
    await manager.addProvider({ name: 'p3', authToken: 't', baseUrl: 'http://c', model: 'm' });
    await manager.switchTo('p2');
    await manager.switchToNext('', 'rate_limited'); // p2 becomes rate_limited

    const available = manager.getAvailableProviders();
    const names = available.map(p => p.name);
    expect(names).toContain('p1');
    expect(names).toContain('p3');
    expect(names).not.toContain('p2');
  });

  // === printStatus ===
  it('printStatus should show empty message when no providers', () => {
    const manager = createManager();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    manager.printStatus();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('尚未配置'));
    logSpy.mockRestore();
  });

  it('printStatus should sort by status priority', async () => {
    const manager = createManager();
    await manager.addProvider({ name: 'p1', authToken: 't', baseUrl: 'http://a', model: 'm' });
    await manager.addProvider({ name: 'p2', authToken: 't', baseUrl: 'http://b', model: 'm' });
    await manager.switchTo('p2'); // p2 active

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    manager.printStatus();

    // p2 is active (current), should be marked
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('p2'));
    logSpy.mockRestore();
  });
});
