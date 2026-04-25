import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GracefulShutdown, getGracefulShutdown } from '../../src/core/graceful-shutdown.js';

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  Logger: vi.fn(),
}));

import { createLogger } from '../../src/core/logger.js';

describe('GracefulShutdown', () => {
  const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    (getGracefulShutdown as any)._instance = null;
  });

  afterEach(() => {
    onSpy.mockClear();
    exitSpy.mockClear();
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  it('getGracefulShutdown should return singleton', () => {
    const gs1 = getGracefulShutdown();
    const gs2 = getGracefulShutdown();
    expect(gs1).toBe(gs2);
    expect(gs1).toBeInstanceOf(GracefulShutdown);
  });

  it('initialize should bind SIGTERM and SIGINT listeners', () => {
    const gs = new GracefulShutdown();
    const mockLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;

    gs.initialize(mockLogger);

    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('handle SIGTERM first trigger should execute callbacks and exit 143', async () => {
    const gs = new GracefulShutdown();
    const mockLogger = { error: vi.fn() } as any;
    const callback1 = vi.fn().mockResolvedValue(undefined);
    const callback2 = vi.fn().mockResolvedValue(undefined);

    gs.initialize(mockLogger);
    gs.onCleanup(callback1);
    gs.onCleanup(callback2);

    // Get the SIGTERM handler and call it
    const sigtermHandler = onSpy.mock.calls.find(c => c[0] === 'SIGTERM')![1] as Function;
    await sigtermHandler();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith('shutdown', expect.stringContaining('SIGTERM'), undefined, expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(143);
    expect(gs.isInShutdown()).toBe(true);
  });

  it('handle SIGTERM repeated trigger should exit 1 immediately', async () => {
    const gs = new GracefulShutdown();
    const mockLogger = { error: vi.fn() } as any;

    gs.initialize(mockLogger);

    const sigtermHandler = onSpy.mock.calls.find(c => c[0] === 'SIGTERM')![1] as Function;
    await sigtermHandler();
    expect(exitSpy).toHaveBeenCalledWith(143);

    exitSpy.mockClear();
    await sigtermHandler();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('handle SIGINT should exit 130', async () => {
    const gs = new GracefulShutdown();
    const mockLogger = { error: vi.fn() } as any;

    gs.initialize(mockLogger);

    const sigintHandler = onSpy.mock.calls.find(c => c[0] === 'SIGINT')![1] as Function;
    await sigintHandler();

    expect(mockLogger.error).toHaveBeenCalledWith('shutdown', expect.stringContaining('SIGINT'), undefined, expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it('onCleanup callbacks should execute in order', async () => {
    const gs = new GracefulShutdown();
    const mockLogger = { error: vi.fn() } as any;
    const order: number[] = [];

    gs.initialize(mockLogger);
    gs.onCleanup(async () => { order.push(1); });
    gs.onCleanup(async () => { order.push(2); });
    gs.onCleanup(async () => { order.push(3); });

    const sigtermHandler = onSpy.mock.calls.find(c => c[0] === 'SIGTERM')![1] as Function;
    await sigtermHandler();

    expect(order).toEqual([1, 2, 3]);
  });

  it('one failing callback should not stop others', async () => {
    const gs = new GracefulShutdown();
    const mockLogger = { error: vi.fn() } as any;
    const callback1 = vi.fn().mockRejectedValue(new Error('fail'));
    const callback2 = vi.fn().mockResolvedValue(undefined);

    gs.initialize(mockLogger);
    gs.onCleanup(callback1);
    gs.onCleanup(callback2);

    const sigtermHandler = onSpy.mock.calls.find(c => c[0] === 'SIGTERM')![1] as Function;
    await sigtermHandler();

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('清理回调执行失败:', expect.any(Error));
    expect(exitSpy).toHaveBeenCalledWith(143);
  });

  it('isInShutdown should return false before signal', () => {
    const gs = new GracefulShutdown();
    expect(gs.isInShutdown()).toBe(false);
  });
});
