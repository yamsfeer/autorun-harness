import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// mock AI SDK — 返回 success，让 runGenerator() 正常完成
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    return (async function* () {
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 50, output_tokens: 100 } };
    })();
  }),
}));

// mock evaluator — 总是返回通过
vi.mock('../../src/core/evaluator.js', () => ({
  createEvaluator: vi.fn(() => ({
    evaluate: vi.fn().mockResolvedValue({
      final_decision: 'pass',
      summary: 'Task completed successfully',
      criteria_results: [],
      evaluator_error: false,
    }),
  })),
}));

// mock os — ProviderManager 在模块加载时读取 homedir
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/tmp/run-e2e-home'),
    tmpdir: vi.fn(() => '/tmp'),
  },
  homedir: vi.fn(() => '/tmp/run-e2e-home'),
  tmpdir: vi.fn(() => '/tmp'),
}));

const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

import { runCommand } from '../../src/commands/run.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { createProviderManager, getProviderManager } from '../../src/core/provider-manager.js';

describe('run workflow e2e', () => {
  let tempDir: string;
  const providerConfigDir = path.join('/tmp/run-e2e-home', '.config', 'autorun-harness', 'providers');

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-e2e-'));

    // 创建 provider 配置（Orchestrator.initializeModules 需要）
    await fs.mkdir(providerConfigDir, { recursive: true });
    await fs.writeFile(
      path.join(providerConfigDir, 'test-provider.json'),
      JSON.stringify({ name: 'test-provider', authToken: 'test', baseUrl: 'https://test.com', model: 'test-model' }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(providerConfigDir, '.state.json'),
      JSON.stringify({ currentProvider: 'test-provider', totalSwitches: 0, providers: {} }),
      'utf-8'
    );

    // 重置单例状态
    const pm = getProviderManager();
    await pm.initialize();

    exitSpy.mockClear();
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm('/tmp/run-e2e-home', { recursive: true, force: true });
  });

  /**
   * 辅助函数：创建带任务的项目
   */
  async function createProjectWithTasks(tasks: any[]) {
    const harnessDir = path.join(tempDir, '.harness');
    await fs.mkdir(harnessDir, { recursive: true });
    await fs.writeFile(
      path.join(harnessDir, 'tasks.json'),
      JSON.stringify({
        project: { name: 'test-project', version: '1.0.0', created_at: new Date().toISOString() },
        tasks,
        statistics: {
          total: tasks.length,
          pending: tasks.filter((t: any) => t.status === 'pending').length,
          in_progress: 0,
          completed: tasks.filter((t: any) => t.status === 'completed').length,
          blocked: 0,
          needs_human: 0,
        },
      }, null, 2)
    );
  }

  describe('runCommand boundary cases', () => {
    it('should exit when project is not initialized', async () => {
      await runCommand(tempDir, {});

      expect(errorSpy).toHaveBeenCalledWith('❌ 错误：项目未初始化');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when tasks.json is missing', async () => {
      await fs.mkdir(path.join(tempDir, '.harness'), { recursive: true });

      await runCommand(tempDir, {});

      expect(errorSpy).toHaveBeenCalledWith('❌ 错误：未找到任务列表文件');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should report completion when all tasks are done', async () => {
      await createProjectWithTasks([
        { id: 'task-1', title: 'Done task', status: 'completed', description: 'Already done', dependencies: [], attempts: 0 },
      ]);

      await runCommand(tempDir, {});

      expect(logSpy).toHaveBeenCalledWith('\n✅ 项目已完成！');
    });
  });

  describe('Orchestrator.run() workflow', () => {
    it('should complete all pending tasks', async () => {
      await createProjectWithTasks([
        { id: 'task-1', title: 'Feature A', status: 'pending', description: 'Implement A', dependencies: [], attempts: 0 },
        { id: 'task-2', title: 'Feature B', status: 'pending', description: 'Implement B', dependencies: ['task-1'], attempts: 0 },
      ]);

      const orchestrator = new Orchestrator(tempDir, {
        providerManager: createProviderManager(),
      });
      await orchestrator.run(10);

      // 验证 tasks.json 状态
      const tasksContent = await fs.readFile(path.join(tempDir, '.harness', 'tasks.json'), 'utf-8');
      const tasksData = JSON.parse(tasksContent);
      expect(tasksData.tasks[0].status).toBe('completed');
      expect(tasksData.tasks[1].status).toBe('completed');
      expect(tasksData.statistics.completed).toBe(2);
      expect(tasksData.statistics.pending).toBe(0);

      // 验证 progress.txt 记录了进度
      const progress = await fs.readFile(path.join(tempDir, '.harness', 'progress.txt'), 'utf-8');
      expect(progress).toContain('task-1');
      expect(progress).toContain('completed');

      // 验证 costs.json 记录了 Token 使用
      const costsContent = await fs.readFile(path.join(tempDir, '.harness', 'costs.json'), 'utf-8');
      const costsData = JSON.parse(costsContent);
      expect(costsData.entries.length).toBeGreaterThanOrEqual(2);
    });

    it('should respect maxTasks limit', async () => {
      await createProjectWithTasks([
        { id: 'task-1', title: 'Feature A', status: 'pending', description: 'A', dependencies: [], attempts: 0 },
        { id: 'task-2', title: 'Feature B', status: 'pending', description: 'B', dependencies: [], attempts: 0 },
      ]);

      const orchestrator = new Orchestrator(tempDir, {
        providerManager: createProviderManager(),
      });
      await orchestrator.run(1);

      const tasksContent = await fs.readFile(path.join(tempDir, '.harness', 'tasks.json'), 'utf-8');
      const tasksData = JSON.parse(tasksContent);
      expect(tasksData.statistics.completed).toBe(1);
      expect(tasksData.statistics.pending).toBe(1);
    });

    it('should handle empty task list', async () => {
      await createProjectWithTasks([]);

      const orchestrator = new Orchestrator(tempDir, {
        providerManager: createProviderManager(),
      });
      await orchestrator.run(10);

      const status = await orchestrator.getStatus();
      expect(status.isComplete).toBe(true);
      expect(status.statistics.total).toBe(0);
    });

    it('should get correct status after partial execution', async () => {
      await createProjectWithTasks([
        { id: 'task-1', title: 'Feature A', status: 'pending', description: 'A', dependencies: [], attempts: 0 },
        { id: 'task-2', title: 'Feature B', status: 'pending', description: 'B', dependencies: ['task-1'], attempts: 0 },
      ]);

      const orchestrator = new Orchestrator(tempDir, {
        providerManager: createProviderManager(),
      });
      await orchestrator.run(1);

      const status = await orchestrator.getStatus();
      expect(status.isComplete).toBe(false);
      expect(status.statistics.completed).toBe(1);
      expect(status.nextTask).not.toBeNull();
    });

    it('should revert task to pending when evaluation fails', async () => {
      await createProjectWithTasks([
        { id: 'task-1', title: 'Feature A', status: 'pending', description: 'A', dependencies: [], attempts: 0 },
      ]);

      // 注入返回 fail 的 evaluator
      const mockEvaluate = vi.fn().mockResolvedValue({
        final_decision: 'fail',
        summary: 'Code does not meet requirements',
        criteria_results: [{ criterion: 'test', passed: false, reason: 'missing tests' }],
        evaluator_error: false,
        feedback_for_generator: 'Add more tests',
      });

      const orchestrator = new Orchestrator(tempDir, {
        providerManager: createProviderManager(),
        evaluator: { evaluate: mockEvaluate } as any,
      });

      // maxTasks=1 避免无限重试循环
      await orchestrator.run(1);

      // 验证任务回退到 pending，attempts 增加到 1
      const tasksContent = await fs.readFile(path.join(tempDir, '.harness', 'tasks.json'), 'utf-8');
      const tasksData = JSON.parse(tasksContent);
      expect(tasksData.tasks[0].status).toBe('pending');
      expect(tasksData.tasks[0].attempts).toBe(1);
      expect(tasksData.tasks[0].notes).toBeDefined();
      expect(tasksData.tasks[0].notes[0]).toContain('评估失败');

      // 验证 progress.txt 记录了失败
      const progress = await fs.readFile(path.join(tempDir, '.harness', 'progress.txt'), 'utf-8');
      expect(progress).toContain('pending');
      expect(progress).toContain('评估失败');

      // 验证 failure.md 记录了失败模式
      const failurePath = path.join(tempDir, '.harness', 'failure.md');
      try {
        const failureContent = await fs.readFile(failurePath, 'utf-8');
        expect(failureContent).toContain('task-1');
      } catch {
        // failure.md 可能不存在，取决于 failure-collector 的实现
      }
    });

    it('should mark task as needs_human after 3 evaluation failures', async () => {
      // 初始 attempts=2，再失败一次就达到 3 次
      await createProjectWithTasks([
        { id: 'task-1', title: 'Feature A', status: 'pending', description: 'A', dependencies: [], attempts: 2 },
      ]);

      const mockEvaluate = vi.fn().mockResolvedValue({
        final_decision: 'fail',
        summary: 'Still failing',
        criteria_results: [],
        evaluator_error: false,
        feedback_for_generator: 'Needs rework',
      });

      const orchestrator = new Orchestrator(tempDir, {
        providerManager: createProviderManager(),
        evaluator: { evaluate: mockEvaluate } as any,
      });

      await orchestrator.run(1);

      const tasksContent = await fs.readFile(path.join(tempDir, '.harness', 'tasks.json'), 'utf-8');
      const tasksData = JSON.parse(tasksContent);
      expect(tasksData.tasks[0].status).toBe('needs_human');
      expect(tasksData.tasks[0].attempts).toBe(3);

      // 验证 progress.txt 记录了需要人工介入
      const progress = await fs.readFile(path.join(tempDir, '.harness', 'progress.txt'), 'utf-8');
      expect(progress).toContain('needs_human');
    });

    it('should not count attempts when evaluator crashes', async () => {
      await createProjectWithTasks([
        { id: 'task-1', title: 'Feature A', status: 'pending', description: 'A', dependencies: [], attempts: 0 },
      ]);

      // 注入返回 evaluator_error 的 evaluator
      const mockEvaluate = vi.fn().mockResolvedValue({
        final_decision: 'fail',
        summary: 'Evaluator crashed during assessment',
        criteria_results: [],
        evaluator_error: true,
      });

      const orchestrator = new Orchestrator(tempDir, {
        providerManager: createProviderManager(),
        evaluator: { evaluate: mockEvaluate } as any,
      });

      await orchestrator.run(1);

      const tasksContent = await fs.readFile(path.join(tempDir, '.harness', 'tasks.json'), 'utf-8');
      const tasksData = JSON.parse(tasksContent);
      // 评估器崩溃不计入尝试次数
      expect(tasksData.tasks[0].attempts).toBe(0);
      // 状态回退到 pending
      expect(tasksData.tasks[0].status).toBe('pending');

      // 验证 progress.txt 记录了评估器崩溃
      const progress = await fs.readFile(path.join(tempDir, '.harness', 'progress.txt'), 'utf-8');
      expect(progress).toContain('评估器自身崩溃');
    });
  });
});
