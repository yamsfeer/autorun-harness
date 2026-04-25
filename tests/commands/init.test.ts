import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 所有 vi.mock 工厂函数在文件顶部定义，内部不引用外部变量
const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn().mockReturnValue(() => mockExec()),
}));

vi.mock('../../src/core/orchestrator.js', () => ({
  Orchestrator: vi.fn().mockImplementation(function() {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

import { initCommand } from '../../src/commands/init.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import fs from 'fs/promises';

describe('initCommand', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockClear().mockResolvedValue({ stdout: '', stderr: '' });
    // 恢复 Orchestrator mock 到默认实现（避免被之前的测试修改）
    vi.mocked(Orchestrator).mockImplementation(function() {
      return {
        initialize: vi.fn().mockResolvedValue(undefined),
      };
    });
  });

  afterEach(() => {
    exitSpy.mockClear();
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  it('should initialize project in simple mode with --text', async () => {
    await initCommand('/tmp/test-project', {
      mode: 'simple',
      text: 'Test requirement',
      name: 'test-project',
    });

    expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(expect.stringContaining('test-project'), { recursive: true });
    expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(expect.stringContaining('.harness'), { recursive: true });
    expect(Orchestrator).toHaveBeenCalledWith(expect.stringContaining('test-project'));
    expect(logSpy).toHaveBeenCalledWith('🚀 初始化项目...\n');
  });

  it('should initialize project in simple mode with --prd', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      mode: 'simple',
      prd: '/path/to/prd.md',
      name: 'test-project',
    });

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/prd.md', 'utf-8');
  });

  it('should initialize project in simple mode with --json', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce('{"key": "value"}');

    await initCommand('/tmp/test-project', {
      mode: 'simple',
      json: '/path/to/spec.json',
      name: 'test-project',
    });

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/spec.json', 'utf-8');
  });

  it('should exit when simple mode has no prd/json/text', async () => {
    await initCommand('/tmp/test-project', {
      mode: 'simple',
      name: 'test-project',
    });

    expect(errorSpy).toHaveBeenCalledWith('❌ 错误：必须提供 --prd、--json 或 --text 其中之一');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should initialize project in full mode with --prd', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      mode: 'full',
      prd: '/path/to/prd.md',
      name: 'test-project',
    });

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/prd.md', 'utf-8');
  });

  it('should initialize project in full mode with existing docs/PRD.md', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(['PRD.md', 'README.md'] as any);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ isFile: () => true } as any)
      .mockResolvedValueOnce({ isFile: () => true } as any);
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce('PRD from docs')
      .mockResolvedValueOnce('README content');

    await initCommand('/tmp/test-project', {
      mode: 'full',
      name: 'test-project',
    });

    expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('PRD.md'), 'utf-8');
  });

  it('should exit when full mode has no docs and no --prd', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([] as any);

    await initCommand('/tmp/test-project', {
      mode: 'full',
      name: 'test-project',
    });

    expect(errorSpy).toHaveBeenCalledWith('\n❌ 错误：完整模式需要提供文档\n');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should use custom docs directory in full mode', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(['PRD.md'] as any);
    vi.mocked(fs.stat).mockResolvedValueOnce({ isFile: () => true } as any);
    vi.mocked(fs.readFile).mockResolvedValueOnce('Custom PRD');

    await initCommand('/tmp/test-project', {
      mode: 'full',
      docs: '/custom/docs',
      name: 'test-project',
    });

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('/custom/docs'), { recursive: true });
  });

  it('should handle docs directory read error gracefully', async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error('Directory not found'));
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      mode: 'full',
      prd: '/path/to/prd.md',
      name: 'test-project',
    });

    // Should still succeed because prd is provided
    expect(Orchestrator).toHaveBeenCalled();
  });

  it('should skip non-md/txt files when collecting docs', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(['PRD.md', 'image.png', 'script.js'] as any);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ isFile: () => true } as any)
      .mockResolvedValueOnce({ isFile: () => true } as any)
      .mockResolvedValueOnce({ isFile: () => true } as any);
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      mode: 'full',
      name: 'test-project',
    });

    expect(fs.readFile).toHaveBeenCalledTimes(1); // Only PRD.md
  });

  it('should skip directories when collecting docs', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(['subdir', 'PRD.md'] as any);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ isFile: () => false } as any)
      .mockResolvedValueOnce({ isFile: () => true } as any);
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      mode: 'full',
      name: 'test-project',
    });

    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('should handle git init error gracefully', async () => {
    mockExec.mockRejectedValueOnce(new Error('Git already initialized'));
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      mode: 'simple',
      text: 'Test',
      name: 'test-project',
    });

    expect(logSpy).toHaveBeenCalledWith('   ⚠️  Git 初始化跳过（可能已存在）');
    expect(Orchestrator).toHaveBeenCalled();
  });

  it('should default to full mode when mode is not specified', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(['PRD.md'] as any);
    vi.mocked(fs.stat).mockResolvedValueOnce({ isFile: () => true } as any);
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      name: 'test-project',
    });

    expect(logSpy).toHaveBeenCalledWith('🔧 初始化模式：完整模式');
  });

  it('should handle initialization errors', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');
    vi.mocked(Orchestrator).mockImplementation(function() {
      return {
        initialize: vi.fn().mockRejectedValue(new Error('Orchestrator failed')),
      };
    });

    await initCommand('/tmp/test-project', {
      mode: 'simple',
      prd: '/path/to/prd.md',
      name: 'test-project',
    });

    expect(errorSpy).toHaveBeenCalledWith('\n❌ 初始化失败：', 'Orchestrator failed');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should print next steps for simple mode', async () => {
    await initCommand('/tmp/test-project', {
      mode: 'simple',
      text: 'Test',
      name: 'test-project',
    });

    expect(logSpy).toHaveBeenCalledWith('\n📋 下一步：');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('检查规格文档'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('检查任务列表'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('autorun-harness run'));
  });

  it('should print next steps for full mode', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce(['PRD.md'] as any);
    vi.mocked(fs.stat).mockResolvedValueOnce({ isFile: () => true } as any);
    vi.mocked(fs.readFile).mockResolvedValueOnce('PRD Content');

    await initCommand('/tmp/test-project', {
      mode: 'full',
      name: 'test-project',
    });

    expect(logSpy).toHaveBeenCalledWith('\n📋 下一步：');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('检查文档索引'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('检查完整文档'));
  });
});
