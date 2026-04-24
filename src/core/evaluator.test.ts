import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { Evaluator } from './evaluator.js';
import { Task, EvaluatorReport, TaskList } from '../types/index.js';

describe('Evaluator', () => {
  let tempDir: string;
  let evaluator: Evaluator;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-test-'));
    evaluator = new Evaluator(tempDir);

    // Create .harness directory and spec
    await fs.mkdir(path.join(tempDir, '.harness'), { recursive: true });
    await fs.writeFile(path.join(tempDir, '.harness', 'spec.md'), '# Test Spec', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createMockTask(): Task {
    return {
      id: 'T001',
      title: 'Test Task',
      category: 'functional',
      priority: 'high',
      description: 'A test task',
      acceptance_criteria: [
        { id: 'AC001', description: 'Criterion 1', steps: ['Step 1', 'Step 2'], status: 'pending' },
        { id: 'AC002', description: 'Criterion 2', steps: ['Step 3'], status: 'pending' },
      ],
      dependencies: [],
      attempts: 0,
      status: 'pending',
      assigned_to: null,
      completed_at: null,
      notes: [],
    };
  }

  function createMockReport(overrides?: Partial<EvaluatorReport>): EvaluatorReport {
    return {
      report_id: 'R001',
      task_id: 'T001',
      attempt: 1,
      timestamp: new Date().toISOString(),
      overall_result: 'pass',
      summary: 'All good',
      criteria_results: [
        {
          criterion_id: 'AC001',
          description: 'Criterion 1',
          result: 'pass',
          details: [
            { step: 1, action: 'Step 1', status: 'pass' },
            { step: 2, action: 'Step 2', status: 'pass' },
          ],
        },
        {
          criterion_id: 'AC002',
          description: 'Criterion 2',
          result: 'pass',
          details: [
            { step: 1, action: 'Step 3', status: 'pass' },
          ],
        },
      ],
      quality_scores: {
        functionality: { score: 0.8, weight: 0.4, weighted: 0.32, comment: 'Good' },
        code_quality: { score: 0.7, weight: 0.25, weighted: 0.175, comment: '' },
        product_depth: { score: 0.6, weight: 0.2, weighted: 0.12, comment: '' },
        visual_design: { score: 0.7, weight: 0.15, weighted: 0.105, comment: '' },
      },
      total_weighted_score: 0.72,
      threshold: 0.75,
      final_decision: 'pass',
      feedback_for_generator: 'Good job',
      screenshot_paths: [],
      ...overrides,
    };
  }

  describe('validateReportThreshold (Bug-001 fix)', () => {
    it('should keep pass when score >= threshold', () => {
      const report = createMockReport({
        total_weighted_score: 0.8,
        threshold: 0.75,
        final_decision: 'pass',
      });

      const validated = (evaluator as any).validateReportThreshold(report);
      expect(validated.final_decision).toBe('pass');
    });

    it('should fix pass to fail when score < threshold (Bug-001)', () => {
      const report = createMockReport({
        total_weighted_score: 0.7,
        threshold: 0.75,
        final_decision: 'pass', // Wrong! Should be fail
      });

      const validated = (evaluator as any).validateReportThreshold(report);
      expect(validated.final_decision).toBe('fail');
      expect(validated.overall_result).toBe('fail');
      expect(validated.summary).toContain('[阈值修正]');
    });

    it('should keep fail when score < threshold', () => {
      const report = createMockReport({
        total_weighted_score: 0.6,
        threshold: 0.75,
        final_decision: 'fail',
      });

      const validated = (evaluator as any).validateReportThreshold(report);
      expect(validated.final_decision).toBe('fail');
    });

    it('should keep pass when score exactly equals threshold', () => {
      const report = createMockReport({
        total_weighted_score: 0.75,
        threshold: 0.75,
        final_decision: 'pass',
      });

      const validated = (evaluator as any).validateReportThreshold(report);
      expect(validated.final_decision).toBe('pass');
    });
  });

  describe('updateTaskAcceptanceStatus (Bug-004 fix)', () => {
    it('should update AC status in tasks.json based on report', async () => {
      const task = createMockTask();
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [task],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };

      // Save tasks.json
      await fs.writeFile(
        path.join(tempDir, '.harness', 'tasks.json'),
        JSON.stringify(taskList, null, 2),
        'utf-8'
      );

      const report = createMockReport({
        criteria_results: [
          { criterion_id: 'AC001', description: 'Criterion 1', result: 'pass', details: [] },
          { criterion_id: 'AC002', description: 'Criterion 2', result: 'fail', details: [] },
        ],
      });

      await (evaluator as any).updateTaskAcceptanceStatus('T001', report);

      const updated = JSON.parse(
        await fs.readFile(path.join(tempDir, '.harness', 'tasks.json'), 'utf-8')
      );

      expect(updated.tasks[0].acceptance_criteria[0].status).toBe('pass');
      expect(updated.tasks[0].acceptance_criteria[1].status).toBe('fail');
    });

    it('should handle missing criteria_results gracefully', async () => {
      const task = createMockTask();
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [task],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };

      await fs.writeFile(
        path.join(tempDir, '.harness', 'tasks.json'),
        JSON.stringify(taskList, null, 2),
        'utf-8'
      );

      const report = createMockReport({ criteria_results: [] });

      await (evaluator as any).updateTaskAcceptanceStatus('T001', report);

      const updated = JSON.parse(
        await fs.readFile(path.join(tempDir, '.harness', 'tasks.json'), 'utf-8')
      );

      // Status should remain unchanged
      expect(updated.tasks[0].acceptance_criteria[0].status).toBe('pending');
    });

    it('should handle non-existent task gracefully', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [],
        statistics: { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };

      await fs.writeFile(
        path.join(tempDir, '.harness', 'tasks.json'),
        JSON.stringify(taskList, null, 2),
        'utf-8'
      );

      const report = createMockReport();

      // Should not throw
      await expect(
        (evaluator as any).updateTaskAcceptanceStatus('NONEXISTENT', report)
      ).resolves.toBeUndefined();
    });
  });

  describe('createDefaultReport (Bug-005 fix)', () => {
    it('should create fail report with evaluator_error=false by default', () => {
      const task = createMockTask();
      const report = (evaluator as any).createDefaultReport(task, 1, 'fail', 'Test failure');

      expect(report.task_id).toBe('T001');
      expect(report.attempt).toBe(1);
      expect(report.overall_result).toBe('fail');
      expect(report.final_decision).toBe('fail');
      expect(report.evaluator_error).toBe(false);
      expect(report.criteria_results).toHaveLength(2);
      expect(report.criteria_results[0].result).toBe('fail');
    });

    it('should create pass report', () => {
      const task = createMockTask();
      const report = (evaluator as any).createDefaultReport(task, 2, 'pass', 'Test pass');

      expect(report.overall_result).toBe('pass');
      expect(report.final_decision).toBe('pass');
      expect(report.total_weighted_score).toBe(0.7);
      expect(report.threshold).toBe(0.75);
    });

    it('should mark evaluator_error=true when passed (Bug-005)', () => {
      const task = createMockTask();
      const report = (evaluator as any).createDefaultReport(
        task,
        1,
        'fail',
        '评估过程出错: 浏览器崩溃',
        true // evaluator_error
      );

      expect(report.evaluator_error).toBe(true);
      expect(report.overall_result).toBe('fail');
      expect(report.summary).toContain('浏览器崩溃');
    });

    it('should generate criteria_results for all ACs', () => {
      const task = createMockTask();
      const report = (evaluator as any).createDefaultReport(task, 1, 'fail', 'Failed');

      expect(report.criteria_results).toHaveLength(2);
      expect(report.criteria_results[0].criterion_id).toBe('AC001');
      expect(report.criteria_results[0].details).toHaveLength(2); // 2 steps
      expect(report.criteria_results[1].details).toHaveLength(1); // 1 step
    });
  });

  describe('saveReport', () => {
    it('should save report to correct path', async () => {
      const report = createMockReport();
      await (evaluator as any).saveReport(report);

      const reportPath = path.join(tempDir, '.harness', 'reports', 'evaluator_report_T001_1.json');
      expect(fsSync.existsSync(reportPath)).toBe(true);

      const saved = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      expect(saved.report_id).toBe('R001');
      expect(saved.task_id).toBe('T001');
    });
  });
});
