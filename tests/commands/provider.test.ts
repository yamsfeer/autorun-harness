import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { providerCommand } from '../../src/commands/provider.js';

// 工厂函数内部不能引用外部变量（hoisting 规则），所以在工厂内定义
vi.mock('../../src/core/provider-manager.js', () => ({
  getProviderManager: vi.fn(),
}));

vi.mock('../../src/core/error-handler.js', () => ({
  applyProviderConfig: vi.fn(),
}));

import { getProviderManager } from '../../src/core/provider-manager.js';

describe('providerCommand', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  const mockInitialize = vi.fn().mockResolvedValue(undefined);
  const mockPrintStatus = vi.fn();
  const mockAddProvider = vi.fn().mockResolvedValue(undefined);
  const mockRemoveProvider = vi.fn().mockResolvedValue(undefined);
  const mockSwitchTo = vi.fn().mockResolvedValue({ success: true });
  const mockGetConfigDir = vi.fn().mockReturnValue('/mock/config/dir');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProviderManager).mockReturnValue({
      initialize: mockInitialize,
      printStatus: mockPrintStatus,
      addProvider: mockAddProvider,
      removeProvider: mockRemoveProvider,
      switchTo: mockSwitchTo,
      getConfigDir: mockGetConfigDir,
    } as any);
  });

  afterEach(() => {
    exitSpy.mockClear();
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  it('should initialize manager and print status by default', async () => {
    await providerCommand({});

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockPrintStatus).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('  配置目录: /mock/config/dir');
  });

  it('should list providers with --list', async () => {
    await providerCommand({ list: true });

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockPrintStatus).toHaveBeenCalledTimes(1);
  });

  it('should add provider with all required options', async () => {
    await providerCommand({
      add: true,
      name: 'test-provider',
      token: 'test-token',
      url: 'https://test.com',
      model: 'test-model',
    });

    expect(mockAddProvider).toHaveBeenCalledWith({
      name: 'test-provider',
      authToken: 'test-token',
      baseUrl: 'https://test.com',
      model: 'test-model',
    });
    expect(mockPrintStatus).toHaveBeenCalledTimes(1);
  });

  it('should exit with error when adding provider without required options (missing name)', async () => {
    await providerCommand({
      add: true,
      token: 'test-token',
      url: 'https://test.com',
      model: 'test-model',
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('❌ 添加提供商需要以下参数：');
  });

  it('should exit with error when adding provider without required options (missing token)', async () => {
    await providerCommand({
      add: true,
      name: 'test-provider',
      url: 'https://test.com',
      model: 'test-model',
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should exit with error when adding provider without required options (missing url)', async () => {
    await providerCommand({
      add: true,
      name: 'test-provider',
      token: 'test-token',
      model: 'test-model',
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should exit with error when adding provider without required options (missing model)', async () => {
    await providerCommand({
      add: true,
      name: 'test-provider',
      token: 'test-token',
      url: 'https://test.com',
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should remove provider with --remove', async () => {
    await providerCommand({ remove: 'provider-to-remove' });

    expect(mockRemoveProvider).toHaveBeenCalledWith('provider-to-remove');
    expect(mockPrintStatus).toHaveBeenCalledTimes(1);
  });

  it('should handle remove provider error', async () => {
    mockRemoveProvider.mockRejectedValueOnce(new Error('Provider not found'));

    await providerCommand({ remove: 'non-existent' });

    expect(mockRemoveProvider).toHaveBeenCalledWith('non-existent');
    expect(errorSpy).toHaveBeenCalledWith('❌ Provider not found');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should switch provider with --switch', async () => {
    mockSwitchTo.mockResolvedValueOnce({
      success: true,
      newProvider: 'new-provider',
    });

    await providerCommand({ switch: 'new-provider' });

    expect(mockSwitchTo).toHaveBeenCalledWith('new-provider');
    expect(mockPrintStatus).toHaveBeenCalledTimes(1);
  });

  it('should handle failed provider switch', async () => {
    mockSwitchTo.mockResolvedValueOnce({
      success: false,
      reason: 'Provider unavailable',
      instructions: 'Please check configuration',
    });

    await providerCommand({ switch: 'bad-provider' });

    expect(mockSwitchTo).toHaveBeenCalledWith('bad-provider');
    expect(errorSpy).toHaveBeenCalledWith('❌ Provider unavailable');
    expect(errorSpy).toHaveBeenCalledWith('Please check configuration');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle switch without instructions', async () => {
    mockSwitchTo.mockResolvedValueOnce({
      success: false,
      reason: 'Unknown provider',
    });

    await providerCommand({ switch: 'unknown' });

    expect(errorSpy).toHaveBeenCalledWith('❌ Unknown provider');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
