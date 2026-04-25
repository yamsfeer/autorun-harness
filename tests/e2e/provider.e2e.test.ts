import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// 固定路径 —— ProviderManager 的 GLOBAL_CONFIG_DIR 在模块加载时计算
// vi.mock 工厂内不能引用外部变量（hoisting 规则），路径必须写死在工厂内
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/tmp/provider-cli-e2e-home'),
    tmpdir: vi.fn(() => '/tmp'),
  },
  homedir: vi.fn(() => '/tmp/provider-cli-e2e-home'),
  tmpdir: vi.fn(() => '/tmp'),
}));

const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

import { providerCommand } from '../../src/commands/provider.js';

describe('provider CLI e2e', () => {
  const configDir = path.join('/tmp/provider-cli-e2e-home', '.config', 'autorun-harness', 'providers');

  beforeEach(async () => {
    await fs.mkdir(configDir, { recursive: true });
    exitSpy.mockClear();
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  afterEach(async () => {
    await fs.rm('/tmp/provider-cli-e2e-home', { recursive: true, force: true });
  });

  /**
   * 辅助函数：读取 provider 配置文件
   */
  async function readProviderConfig(name: string): Promise<Record<string, unknown>> {
    const content = await fs.readFile(path.join(configDir, `${name}.json`), 'utf-8');
    return JSON.parse(content);
  }

  /**
   * 辅助函数：读取 .state.json
   */
  async function readState(): Promise<Record<string, unknown>> {
    const content = await fs.readFile(path.join(configDir, '.state.json'), 'utf-8');
    return JSON.parse(content);
  }

  it('should show status by default (no args)', async () => {
    await providerCommand({});

    // 验证输出包含配置目录
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('配置目录'));
  });

  it('should list providers with --list', async () => {
    await providerCommand({ list: true });

    // --list 等同于默认行为：显示状态
    expect(logSpy).toHaveBeenCalled();
  });

  it('should add provider and create config file', async () => {
    await providerCommand({
      add: true,
      name: 'test-provider',
      token: 'secret-token',
      url: 'https://api.test.com',
      model: 'test-model-v1',
    });

    // 验证配置文件真实创建
    const config = await readProviderConfig('test-provider');
    expect(config.name).toBe('test-provider');
    expect(config.authToken).toBe('secret-token');
    expect(config.baseUrl).toBe('https://api.test.com');
    expect(config.model).toBe('test-model-v1');

    // 验证静态配置不包含运行时字段
    expect(config.status).toBeUndefined();
    expect(config.lastUsed).toBeUndefined();

    // 验证输出
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已添加提供商'));

    // 验证 state 文件
    const state = await readState();
    expect(state.currentProvider).toBe('test-provider');
  });

  it('should exit when adding provider without required options (missing name)', async () => {
    await providerCommand({
      add: true,
      token: 'token',
      url: 'https://test.com',
      model: 'model',
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('❌ 添加提供商需要以下参数：');
  });

  it('should exit when adding provider without required options (missing token)', async () => {
    await providerCommand({
      add: true,
      name: 'test',
      url: 'https://test.com',
      model: 'model',
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should switch to existing provider', async () => {
    // 先添加两个 provider
    await providerCommand({
      add: true,
      name: 'provider-a',
      token: 'token-a',
      url: 'https://api.a.com',
      model: 'model-a',
    });

    await providerCommand({
      add: true,
      name: 'provider-b',
      token: 'token-b',
      url: 'https://api.b.com',
      model: 'model-b',
    });

    // 切换到 provider-b
    await providerCommand({ switch: 'provider-b' });

    // 验证 state 文件更新
    const state = await readState();
    expect(state.currentProvider).toBe('provider-b');

    // 验证输出
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已切换到提供商'));
  });

  it('should exit when switching to non-existent provider', async () => {
    await providerCommand({ switch: 'non-existent' });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('non-existent'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should remove provider and delete config file', async () => {
    // 先添加 provider
    await providerCommand({
      add: true,
      name: 'to-remove',
      token: 'token',
      url: 'https://test.com',
      model: 'model',
    });

    // 验证文件存在
    const configBefore = await readProviderConfig('to-remove');
    expect(configBefore.name).toBe('to-remove');

    // 删除 provider
    await providerCommand({ remove: 'to-remove' });

    // 验证文件被删除
    await expect(fs.access(path.join(configDir, 'to-remove.json'))).rejects.toThrow();

    // 验证输出
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已删除提供商'));
  });

  it('should handle removing non-existent provider', async () => {
    // removeProvider 返回 false 而不是抛出异常
    // providerCommand 没有检查返回值，继续执行
    await providerCommand({ remove: 'non-existent' });

    // 验证没有报错退出（因为 removeProvider 没有抛出）
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
