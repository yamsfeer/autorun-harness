import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator, OrchestratorDeps } from './orchestrator.js';
import { Task, EvaluatorReport } from '../types/index.js';

// Mock cost-tracker 以支持 maxTokens 路径测试（run() 内部会重新创建 costTracker）
vi.mock('./cost-tracker.js', () => ({
  createCostTracker: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
    getTotalTokens: vi.fn().mockReturnValue(1000),
    printReport: vi.fn(),
  }),
  CostTracker: vi.fn(),
}));

describe('Orchestrator', () => {
  const projectDir = '/tmp/test-project';
  let orchestrator: Orchestrator;

  // 通用 mock 工厂
  function createMockDeps(overrides: Partial<OrchestratorDeps> = {}): Required<OrchestratorDeps> {
    return {
      stateManager: {
        loadTasks: vi.fn().mockResolvedValue({ tasks: [], statistics: { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 } }),
        saveTasks: vi.fn().mockResolvedValue(undefined),
        updateTaskStatus: vi.fn().mockResolvedValue(undefined),
        incrementTaskAttempts: vi.fn().mockResolvedValue(1),
        addTaskNote: vi.fn().mockResolvedValue(undefined),
        appendProgress: vi.fn().mockResolvedValue(undefined),
        getNextTask: vi.fn().mockResolvedValue(null),
        isProjectComplete: vi.fn().mockResolvedValue(false),
        getStatistics: vi.fn().mockResolvedValue({ total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 }),
        loadSpec: vi.fn().mockResolvedValue(''),
        loadProgress: vi.fn().mockResolvedValue(''),
      } as any,
      evaluator: {
        evaluate: vi.fn().mockResolvedValue({
          final_decision: 'pass',
          summary: 'Good',
          criteria_results: [],
        }),
      } as any,
      logger: {
        initialize: vi.fn().mockResolvedValue(undefined),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as any,
      costTracker: {
        initialize: vi.fn().mockResolvedValue(undefined),
        record: vi.fn().mockResolvedValue(undefined),
        getTotalTokens: vi.fn().mockReturnValue(0),
        printReport: vi.fn(),
      } as any,
      failureCollector: {
        initialize: vi.fn().mockResolvedValue(undefined),
        recordFailure: vi.fn().mockResolvedValue(undefined),
        recordFromEvaluatorReport: vi.fn().mockResolvedValue(undefined),
        getRecords: vi.fn().mockReturnValue([]),
      } as any,
      providerManager: {
        initialize: vi.fn().mockResolvedValue(undefined),
        getCurrentProvider: vi.fn().mockReturnValue({ name: 'test', model: 'claude-test' }),
        getEnvConfig: vi.fn().mockReturnValue({
          ANTHROPIC_AUTH_TOKEN: 'test-token',
          ANTHROPIC_BASE_URL: 'https://test.com',
          ANTHROPIC_MODEL: 'claude-test',
        }),
        handleRateLimit: vi.fn().mockResolvedValue({ success: true, newProvider: 'backup' }),
        handleUsageLimit: vi.fn().mockResolvedValue({ success: true, newProvider: 'backup' }),
        printStatus: vi.fn(),
      } as any,
      messageHandler: {
        reset: vi.fn(),
        handleMessage: vi.fn(),
        handleResult: vi.fn().mockReturnValue({ success: true, usage: { input_tokens: 10, output_tokens: 20 } }),
      } as any,
      agentLoader: {
        loadPlanner: vi.fn().mockResolvedValue({ prompt: 'planner prompt' }),
        loadGenerator: vi.fn().mockResolvedValue({ prompt: 'generator prompt' }),
        loadEvaluator: vi.fn().mockResolvedValue({ prompt: 'evaluator prompt' }),
      } as any,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createOrchestrator(deps: Partial<OrchestratorDeps> = {}) {
    const fullDeps = createMockDeps(deps);
    const o = new Orchestrator(projectDir, fullDeps);
    // 跳过 initializeModules 避免信号处理和真实 I/O
    vi.spyOn(o as any, 'initializeModules').mockResolvedValue(undefined);
    return { orchestrator: o, deps: fullDeps };
  }

  describe('run() - 边界条件', () => {
    it('项目已完成时应直接结束', async () => {
      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete.mockResolvedValue(true);

      await orchestrator.run();

      expect(deps.stateManager.isProjectComplete).toHaveBeenCalled();
      expect(deps.stateManager.getNextTask).not.toHaveBeenCalled();
    });

    it('没有可执行任务时应结束循环', async () => {
      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.getNextTask.mockResolvedValue(null);

      await orchestrator.run();

      expect(deps.stateManager.getNextTask).toHaveBeenCalled();
      expect(deps.stateManager.updateTaskStatus).not.toHaveBeenCalled();
    });
  });

  describe('run() - 正常流程', () => {
    it('任务生成成功且评估通过 → 标记 completed', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 0, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };
      const report: EvaluatorReport = {
        report_id: 'R1', task_id: 'T001', attempt: 1, timestamp: new Date().toISOString(),
        overall_result: 'pass', summary: 'All good', criteria_results: [],
        quality_scores: { functionality: { score: 0.8, weight: 0.4, weighted: 0.32, comment: '' }, code_quality: { score: 0.8, weight: 0.25, weighted: 0.2, comment: '' }, product_depth: { score: 0.8, weight: 0.2, weighted: 0.16, comment: '' }, visual_design: { score: 0.8, weight: 0.15, weighted: 0.12, comment: '' } },
        total_weighted_score: 0.8, threshold: 0.75, final_decision: 'pass',
        feedback_for_generator: '', screenshot_paths: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.evaluator.evaluate.mockResolvedValue(report);

      // mock runGenerator 直接成功
      vi.spyOn(orchestrator as any, 'runGenerator').mockResolvedValue(undefined);

      await orchestrator.run();

      // 断言状态流转：pending → in_progress → completed
      expect(deps.stateManager.updateTaskStatus).toHaveBeenNthCalledWith(1, 'T001', 'in_progress');
      expect(deps.stateManager.updateTaskStatus).toHaveBeenNthCalledWith(2, 'T001', 'completed');
      expect(deps.stateManager.appendProgress).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'T001', status: 'completed' })
      );
    });
  });

  describe('run() - 评估失败流程', () => {
    it('评估失败且 attempts < 3 → 回退 pending，增加尝试次数', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 0, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };
      const report: EvaluatorReport = {
        report_id: 'R1', task_id: 'T001', attempt: 1, timestamp: new Date().toISOString(),
        overall_result: 'fail', summary: 'Bad code', criteria_results: [],
        quality_scores: { functionality: { score: 0.5, weight: 0.4, weighted: 0.2, comment: '' }, code_quality: { score: 0.5, weight: 0.25, weighted: 0.125, comment: '' }, product_depth: { score: 0.5, weight: 0.2, weighted: 0.1, comment: '' }, visual_design: { score: 0.5, weight: 0.15, weighted: 0.075, comment: '' } },
        total_weighted_score: 0.5, threshold: 0.75, final_decision: 'fail',
        feedback_for_generator: 'Fix this', screenshot_paths: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.evaluator.evaluate.mockResolvedValue(report);
      deps.stateManager.incrementTaskAttempts.mockResolvedValue(1);

      vi.spyOn(orchestrator as any, 'runGenerator').mockResolvedValue(undefined);

      await orchestrator.run();

      expect(deps.stateManager.incrementTaskAttempts).toHaveBeenCalledWith('T001');
      expect(deps.stateManager.updateTaskStatus).toHaveBeenLastCalledWith('T001', 'pending');
    });

    it('评估失败且 attempts >= 3 → 标记 needs_human', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 2, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };
      const report: EvaluatorReport = {
        report_id: 'R1', task_id: 'T001', attempt: 1, timestamp: new Date().toISOString(),
        overall_result: 'fail', summary: 'Still bad', criteria_results: [],
        quality_scores: { functionality: { score: 0.5, weight: 0.4, weighted: 0.2, comment: '' }, code_quality: { score: 0.5, weight: 0.25, weighted: 0.125, comment: '' }, product_depth: { score: 0.5, weight: 0.2, weighted: 0.1, comment: '' }, visual_design: { score: 0.5, weight: 0.15, weighted: 0.075, comment: '' } },
        total_weighted_score: 0.5, threshold: 0.75, final_decision: 'fail',
        feedback_for_generator: 'Fix this', screenshot_paths: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.evaluator.evaluate.mockResolvedValue(report);
      deps.stateManager.incrementTaskAttempts.mockResolvedValue(3);

      vi.spyOn(orchestrator as any, 'runGenerator').mockResolvedValue(undefined);

      await orchestrator.run();

      expect(deps.stateManager.incrementTaskAttempts).toHaveBeenCalledWith('T001');
      expect(deps.stateManager.updateTaskStatus).toHaveBeenLastCalledWith('T001', 'needs_human');
    });

    it('evaluator_error=true 时不增加尝试次数，回退 pending（Bug-005）', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 2, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };
      const report: EvaluatorReport = {
        report_id: 'R1', task_id: 'T001', attempt: 1, timestamp: new Date().toISOString(),
        overall_result: 'fail', summary: '评估器崩溃', criteria_results: [],
        quality_scores: { functionality: { score: 0.3, weight: 0.4, weighted: 0.12, comment: '' }, code_quality: { score: 0.3, weight: 0.25, weighted: 0.075, comment: '' }, product_depth: { score: 0.3, weight: 0.2, weighted: 0.06, comment: '' }, visual_design: { score: 0.3, weight: 0.15, weighted: 0.045, comment: '' } },
        total_weighted_score: 0.3, threshold: 0.75, final_decision: 'fail',
        feedback_for_generator: '评估器崩溃', screenshot_paths: [],
        evaluator_error: true,
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.evaluator.evaluate.mockResolvedValue(report);

      vi.spyOn(orchestrator as any, 'runGenerator').mockResolvedValue(undefined);

      await orchestrator.run();

      // 关键断言：不应增加尝试次数
      expect(deps.stateManager.incrementTaskAttempts).not.toHaveBeenCalled();
      // 回退到 pending
      expect(deps.stateManager.updateTaskStatus).toHaveBeenLastCalledWith('T001', 'pending');
      // 添加备注说明是评估器崩溃
      expect(deps.stateManager.addTaskNote).toHaveBeenCalledWith(
        'T001',
        expect.stringContaining('评估器崩溃')
      );
    });
  });

  describe('run() - Generator 错误处理', () => {
    it('generator 抛 rate_limit → provider 切换成功 → 重试当前任务', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 0, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      deps.stateManager.getNextTask.mockResolvedValue(task);

      // runGenerator 抛 rate_limit 错误
      const rateLimitError = new Error('429 rate limit');
      (rateLimitError as any).type = 'rate_limit';
      vi.spyOn(orchestrator as any, 'runGenerator').mockRejectedValue(rateLimitError);

      await orchestrator.run();

      expect(deps.providerManager.handleRateLimit).toHaveBeenCalled();
      // 切换成功后任务回退 pending
      expect(deps.stateManager.updateTaskStatus).toHaveBeenCalledWith('T001', 'pending');
      // 不应增加 taskCount（通过检查最终统计输出间接验证）
    });

    it('generator 抛 rate_limit → provider 切换失败 → 标记 needs_human 并退出循环', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 0, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete.mockResolvedValue(false);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.providerManager.handleRateLimit.mockResolvedValue({
        success: false,
        reason: 'No available provider',
      });

      const rateLimitError = new Error('429 rate limit');
      (rateLimitError as any).type = 'rate_limit';
      vi.spyOn(orchestrator as any, 'runGenerator').mockRejectedValue(rateLimitError);

      await orchestrator.run();

      expect(deps.providerManager.handleRateLimit).toHaveBeenCalled();
      expect(deps.stateManager.updateTaskStatus).toHaveBeenLastCalledWith('T001', 'needs_human');
    });

    it('generator 抛普通错误且 attempts < 3 → 回退 pending', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 0, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.stateManager.incrementTaskAttempts.mockResolvedValue(1);

      vi.spyOn(orchestrator as any, 'runGenerator').mockRejectedValue(new Error('build failed'));

      await orchestrator.run();

      expect(deps.stateManager.incrementTaskAttempts).toHaveBeenCalledWith('T001');
      expect(deps.stateManager.updateTaskStatus).toHaveBeenLastCalledWith('T001', 'pending');
    });

    it('generator 抛普通错误且 attempts >= 3 → 标记 needs_human', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 2, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.stateManager.incrementTaskAttempts.mockResolvedValue(3);

      vi.spyOn(orchestrator as any, 'runGenerator').mockRejectedValue(new Error('build failed'));

      await orchestrator.run();

      expect(deps.stateManager.incrementTaskAttempts).toHaveBeenCalledWith('T001');
      expect(deps.stateManager.updateTaskStatus).toHaveBeenLastCalledWith('T001', 'needs_human');
    });
  });

  describe('run() - Token 预算', () => {
    it('Token 预算耗尽时应提前结束', async () => {
      const task: Task = {
        id: 'T001', title: 'Test Task', category: 'functional', priority: 'high',
        description: 'desc', acceptance_criteria: [], dependencies: [],
        attempts: 0, status: 'pending', assigned_to: null, completed_at: null, notes: [],
      };
      const report: EvaluatorReport = {
        report_id: 'R1', task_id: 'T001', attempt: 1, timestamp: new Date().toISOString(),
        overall_result: 'pass', summary: 'Good', criteria_results: [],
        quality_scores: { functionality: { score: 0.8, weight: 0.4, weighted: 0.32, comment: '' }, code_quality: { score: 0.8, weight: 0.25, weighted: 0.2, comment: '' }, product_depth: { score: 0.8, weight: 0.2, weighted: 0.16, comment: '' }, visual_design: { score: 0.8, weight: 0.15, weighted: 0.12, comment: '' } },
        total_weighted_score: 0.8, threshold: 0.75, final_decision: 'pass',
        feedback_for_generator: '', screenshot_paths: [],
      };

      const { orchestrator, deps } = createOrchestrator();
      deps.stateManager.isProjectComplete.mockResolvedValue(false);
      deps.stateManager.getNextTask.mockResolvedValue(task);
      deps.evaluator.evaluate.mockResolvedValue(report);
      deps.costTracker.getTotalTokens.mockReturnValue(1000);

      vi.spyOn(orchestrator as any, 'runGenerator').mockResolvedValue(undefined);

      // maxTokens = 500, 但重新创建的 costTracker 返回 1000
      await orchestrator.run(10, 500);

      // getNextTask 只应被调用一次（第一个任务后预算耗尽 break）
      expect(deps.stateManager.getNextTask).toHaveBeenCalledTimes(1);
      // logger 应记录预算耗尽警告
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'orchestrator',
        'Token 预算已用完',
        expect.any(Object)
      );
    });
  });

  describe('getStatus()', () => {
    it('应返回项目状态摘要', async () => {
      const { orchestrator, deps } = createOrchestrator();
      const stats = { total: 5, completed: 3, pending: 2, in_progress: 0, blocked: 0, needs_human: 0 };
      deps.stateManager.isProjectComplete.mockResolvedValue(false);
      deps.stateManager.getStatistics.mockResolvedValue(stats);
      deps.stateManager.getNextTask.mockResolvedValue(null);

      const status = await orchestrator.getStatus();

      expect(status.isComplete).toBe(false);
      expect(status.statistics).toEqual(stats);
      expect(status.nextTask).toBeNull();
    });
  });
});
