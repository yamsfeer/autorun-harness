import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 工厂函数内部定义，避免 hoisting 问题
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
  },
  access: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../../src/core/orchestrator.js', () => ({
  Orchestrator: vi.fn().mockImplementation(function() {
    return {
      run: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ isComplete: true, nextTask: null }),
    };
  }),
}));

import { runCommand } from '../../src/commands/run.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import fs from 'fs/promises';

describe('runCommand', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    exitSpy.mockClear();
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  it('should run tasks with default options', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);

    await runCommand('/tmp/test-project', {});

    expect(logSpy).toHaveBeenCalledWith('🏃 开始执行任务...\n');
    expect(logSpy).toHaveBeenCalledWith('📁 项目目录：/tmp/test-project');
    expect(Orchestrator).toHaveBeenCalledWith('/tmp/test-project');
    expect(logSpy).toHaveBeenCalledWith('\n✅ 项目已完成！');
  });

  it('should run tasks with custom maxTasks and maxTokens', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const mockRun = vi.fn().mockResolvedValue(undefined);
    const mockGetStatus = vi.fn().mockResolvedValue({ isComplete: true, nextTask: null });
    vi.mocked(Orchestrator).mockImplementation(function() {
      return { run: mockRun, getStatus: mockGetStatus } as any;
    });

    await runCommand('/tmp/test-project', {
      maxTasks: '5',
      maxTokens: '100000',
    });

    expect(mockRun).toHaveBeenCalledWith(5, 100000);
    expect(logSpy).toHaveBeenCalledWith('   - 最大任务数：5');
    expect(logSpy).toHaveBeenCalledWith('   - Token 上限：100,000');
  });

  it('should exit when project is not initialized', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('Directory not found'));

    await runCommand('/tmp/uninitialized', {});

    expect(errorSpy).toHaveBeenCalledWith('❌ 错误：项目未初始化');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should exit when tasks.json is not found', async () => {
    // 需要区分两次 access 调用：第一次成功（harness dir），第二次失败（tasks.json）
    let callCount = 0;
    vi.mocked(fs.access).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(undefined);
      return Promise.reject(new Error('File not found'));
    });

    await runCommand('/tmp/no-tasks', {});

    expect(errorSpy).toHaveBeenCalledWith('❌ 错误：未找到任务列表文件');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should show paused status when project is not complete but has next task', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const mockRun = vi.fn().mockResolvedValue(undefined);
    const mockGetStatus = vi.fn().mockResolvedValue({
      isComplete: false,
      nextTask: { title: 'Next Task Title' },
    });
    vi.mocked(Orchestrator).mockImplementation(function() {
      return { run: mockRun, getStatus: mockGetStatus } as any;
    });

    await runCommand('/tmp/test-project', {});

    expect(logSpy).toHaveBeenCalledWith('\n⏸️  执行暂停，下一个任务：Next Task Title');
  });

  it('should show warning when cannot continue', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const mockRun = vi.fn().mockResolvedValue(undefined);
    const mockGetStatus = vi.fn().mockResolvedValue({
      isComplete: false,
      nextTask: null,
    });
    vi.mocked(Orchestrator).mockImplementation(function() {
      return { run: mockRun, getStatus: mockGetStatus } as any;
    });

    await runCommand('/tmp/test-project', {});

    expect(logSpy).toHaveBeenCalledWith('\n⚠️  无法继续执行，请检查任务状态');
  });

  it('should handle errors and print stack trace', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const testError = new Error('Test error');
    const mockRun = vi.fn().mockRejectedValue(testError);
    vi.mocked(Orchestrator).mockImplementation(function() {
      return { run: mockRun, getStatus: vi.fn() } as any;
    });

    await runCommand('/tmp/test-project', {});

    expect(errorSpy).toHaveBeenCalledWith('\n❌ 执行失败：', 'Test error');
    expect(errorSpy).toHaveBeenCalledWith('\n堆栈信息：', testError.stack);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle non-Error exceptions', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const mockRun = vi.fn().mockRejectedValue('string error');
    vi.mocked(Orchestrator).mockImplementation(function() {
      return { run: mockRun, getStatus: vi.fn() } as any;
    });

    await runCommand('/tmp/test-project', {});

    expect(errorSpy).toHaveBeenCalledWith('\n❌ 执行失败：', 'string error');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
