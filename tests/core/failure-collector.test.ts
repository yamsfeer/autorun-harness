import { describe, it, expect, vi } from 'vitest';
import { FailureCollector, createFailureCollector } from '../../src/core/failure-collector.js';
import { Task } from '../../src/types/index.js';

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-001',
    title: 'Test Task',
    category: 'functional',
    priority: 'high',
    description: 'A test task',
    acceptance_criteria: [],
    dependencies: [],
    attempts: 1,
    status: 'in_progress',
    assigned_to: null,
    completed_at: null,
    notes: [],
    ...overrides,
  };
}

describe('FailureCollector', () => {
  const harnessDir = '/tmp/test-project/.harness';

  it('createFailureCollector should return an instance', () => {
    const collector = createFailureCollector(harnessDir);
    expect(collector).toBeInstanceOf(FailureCollector);
  });

  it('recordFailure should create a record with correct structure', async () => {
    const collector = createFailureCollector(harnessDir);
    const task = createMockTask();

    const record = await collector.recordFailure({
      task,
      attempt: 2,
      errorType: 'build_error',
      errorMessage: 'Build failed',
      agentPhase: 'generation',
    });

    expect(record.taskId).toBe('TASK-001');
    expect(record.taskTitle).toBe('Test Task');
    expect(record.taskCategory).toBe('functional');
    expect(record.taskPriority).toBe('high');
    expect(record.attempt).toBe(2);
    expect(record.errorType).toBe('build_error');
    expect(record.errorMessage).toBe('Build failed');
    expect(record.agentPhase).toBe('generation');
    expect(record.id).toMatch(/^FAIL-\d+$/);
    expect(record.timestamp).toBeDefined();
    expect(record.recoveryAttempts).toEqual([]);
  });

  it('recordFailure should include optional fields', async () => {
    const collector = createFailureCollector(harnessDir);
    const task = createMockTask();

    const record = await collector.recordFailure({
      task,
      attempt: 1,
      errorType: 'validation_error',
      errorMessage: 'Validation failed',
      errorStack: 'at line 10',
      acceptanceCriteriaFailures: [
        { criterionId: 'AC-1', description: 'Should work', failedStep: 1, failedStepDescription: 'Step 1', reason: 'Timeout' },
      ],
      affectedFiles: ['src/index.ts'],
      agentPhase: 'evaluation',
    });

    expect(record.errorStack).toBe('at line 10');
    expect(record.acceptanceCriteriaFailures).toHaveLength(1);
    expect(record.acceptanceCriteriaFailures[0].criterionId).toBe('AC-1');
    expect(record.affectedFiles).toEqual(['src/index.ts']);
  });

  it('recordFromEvaluatorReport should extract failed criteria', async () => {
    const collector = createFailureCollector(harnessDir);
    const task = createMockTask();

    const record = await collector.recordFromEvaluatorReport({
      task,
      attempt: 1,
      errorMessage: 'Evaluation failed',
      criteriaResults: [
        {
          criterion_id: 'AC-1',
          description: 'Should pass',
          result: 'pass',
          details: [{ step: 1, action: 'Do X', status: 'pass' }],
        },
        {
          criterion_id: 'AC-2',
          description: 'Should not crash',
          result: 'fail',
          details: [
            { step: 1, action: 'Do Y', status: 'pass' },
            { step: 2, action: 'Do Z', status: 'fail', reason: 'Null pointer' },
          ],
        },
      ],
    });

    expect(record.errorType).toBe('validation_error');
    expect(record.acceptanceCriteriaFailures).toHaveLength(1);
    expect(record.acceptanceCriteriaFailures[0].criterionId).toBe('AC-2');
    expect(record.acceptanceCriteriaFailures[0].failedStep).toBe(2);
    expect(record.acceptanceCriteriaFailures[0].reason).toBe('Null pointer');
  });

  it('recordRecovery should add recovery attempt to existing record', async () => {
    const collector = createFailureCollector(harnessDir);
    const task = createMockTask();

    const record = await collector.recordFailure({
      task,
      attempt: 1,
      errorType: 'build_error',
      errorMessage: 'Build failed',
      agentPhase: 'generation',
    });

    await collector.recordRecovery(record.id, {
      strategy: 'retry_with_fix',
      details: 'Fixed the import',
    });

    const records = collector.getRecords();
    expect(records[0].recoveryAttempts).toHaveLength(1);
    expect(records[0].recoveryAttempts[0].strategy).toBe('retry_with_fix');
    expect(records[0].recoveryAttempts[0].timestamp).toBeDefined();
  });

  it('recordRecovery should do nothing for non-existent failure', async () => {
    const collector = createFailureCollector(harnessDir);
    await collector.recordRecovery('NON-EXISTENT', { strategy: 'retry' });
    expect(collector.getRecords()).toHaveLength(0);
  });

  it('recordResolution should mark a record as resolved', async () => {
    const collector = createFailureCollector(harnessDir);
    const task = createMockTask();

    const record = await collector.recordFailure({
      task,
      attempt: 1,
      errorType: 'build_error',
      errorMessage: 'Build failed',
      agentPhase: 'generation',
    });

    await collector.recordResolution(record.id, 'Added missing dependency', true, 'human');

    const records = collector.getRecords();
    expect(records[0].resolution).toBeDefined();
    expect(records[0].resolution?.solution).toBe('Added missing dependency');
    expect(records[0].resolution?.success).toBe(true);
    expect(records[0].resolution?.fixedBy).toBe('human');
  });

  it('recordResolution should do nothing for non-existent failure', async () => {
    const collector = createFailureCollector(harnessDir);
    await collector.recordResolution('NON-EXISTENT', 'Fix', true);
    expect(collector.getRecords()).toHaveLength(0);
  });

  it('analyzePatterns should group by errorType and category', async () => {
    const collector = createFailureCollector(harnessDir);

    await collector.recordFailure({
      task: createMockTask({ id: 'T1', category: 'functional' }),
      attempt: 1, errorType: 'build_error', errorMessage: 'Syntax error at line 5',
      agentPhase: 'generation',
    });
    await collector.recordFailure({
      task: createMockTask({ id: 'T2', category: 'functional' }),
      attempt: 1, errorType: 'build_error', errorMessage: 'Syntax error at line 10',
      agentPhase: 'generation',
    });
    await collector.recordFailure({
      task: createMockTask({ id: 'T3', category: 'style' }),
      attempt: 1, errorType: 'validation_error', errorMessage: 'Missing test',
      agentPhase: 'evaluation',
    });

    const patterns = collector.analyzePatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns[0].occurrences).toBe(2); // build_error:functional grouped together
    expect(patterns[1].occurrences).toBe(1);
  });

  it('analyzeByCategory should group and dedupe errors', async () => {
    const collector = createFailureCollector(harnessDir);

    await collector.recordFailure({
      task: createMockTask({ id: 'T1', category: 'functional' }),
      attempt: 1, errorType: 'build_error', errorMessage: 'Build failed completely',
      agentPhase: 'generation',
    });
    await collector.recordFailure({
      task: createMockTask({ id: 'T2', category: 'functional' }),
      attempt: 1, errorType: 'build_error', errorMessage: 'Build failed again with same root cause',
      agentPhase: 'generation',
    });

    const byCategory = collector.analyzeByCategory();
    expect(byCategory['functional']).toBeDefined();
    expect(byCategory['functional'].count).toBe(2);
    expect(byCategory['functional'].commonErrors).toHaveLength(2);
  });

  it('getRecordsByTask should filter by task ID', async () => {
    const collector = createFailureCollector(harnessDir);

    await collector.recordFailure({
      task: createMockTask({ id: 'TASK-A' }),
      attempt: 1, errorType: 'build_error', errorMessage: 'Fail A',
      agentPhase: 'generation',
    });
    await collector.recordFailure({
      task: createMockTask({ id: 'TASK-B' }),
      attempt: 1, errorType: 'build_error', errorMessage: 'Fail B',
      agentPhase: 'generation',
    });

    expect(collector.getRecordsByTask('TASK-A')).toHaveLength(1);
    expect(collector.getRecordsByTask('TASK-B')).toHaveLength(1);
    expect(collector.getRecordsByTask('NON-EXISTENT')).toHaveLength(0);
  });

  it('generateMarkdown should include header and stats', async () => {
    const collector = createFailureCollector(harnessDir);
    const task = createMockTask();

    await collector.recordFailure({
      task,
      attempt: 1, errorType: 'build_error', errorMessage: 'Build failed',
      agentPhase: 'generation',
    });

    const md = collector.generateMarkdown();
    expect(md).toContain('# 错误收集报告');
    expect(md).toContain('总错误数: 1');
    expect(md).toContain('functional');
    expect(md).toContain('TASK-001');
    expect(md).toContain('Build failed');
  });

  it('generateMarkdown should show resolution info', async () => {
    const collector = createFailureCollector(harnessDir);
    const task = createMockTask();

    const record = await collector.recordFailure({
      task,
      attempt: 1, errorType: 'build_error', errorMessage: 'Build failed',
      agentPhase: 'generation',
    });
    await collector.recordResolution(record.id, 'Fixed it', true);

    const md = collector.generateMarkdown();
    expect(md).toContain('解决方案');
    expect(md).toContain('Fixed it');
  });

  it('generateMarkdown should handle empty records', () => {
    const collector = createFailureCollector(harnessDir);
    const md = collector.generateMarkdown();
    expect(md).toContain('_暂无错误记录_');
    expect(md).toContain('总错误数: 0');
  });
});
