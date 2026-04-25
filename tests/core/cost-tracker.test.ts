import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostTracker, createCostTracker } from '../../src/core/cost-tracker.js';

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock('fs/promises', () => ({
  default: {
    readFile: (...args: any[]) => mockReadFile(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
  },
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
}));

describe('CostTracker', () => {
  const harnessDir = '/tmp/test-project/.harness';
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
  });

  describe('createCostTracker', () => {
    it('should create a CostTracker instance', () => {
      const tracker = createCostTracker(harnessDir);
      expect(tracker).toBeInstanceOf(CostTracker);
    });
  });

  describe('initialize', () => {
    it('should load existing cost data from file', async () => {
      const data = {
        entries: [
          { taskId: 'task-1', agent: 'generator', inputTokens: 100, outputTokens: 200, timestamp: '2024-01-01T00:00:00Z' },
          { taskId: 'task-2', agent: 'evaluator', inputTokens: 50, outputTokens: 100, timestamp: '2024-01-01T00:00:00Z' },
        ],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(data));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      expect(tracker.getTotalTokens()).toBe(450);
      expect(tracker.getTaskTokens('task-1')).toBe(300);
    });

    it('should initialize empty when file does not exist', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      expect(tracker.getTotalTokens()).toBe(0);
    });

    it('should initialize empty when JSON is corrupted', async () => {
      mockReadFile.mockResolvedValueOnce('not json');

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      expect(tracker.getTotalTokens()).toBe(0);
    });
  });

  describe('record', () => {
    it('should accumulate tokens and save', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      await tracker.record({ taskId: 'task-1', agent: 'generator', inputTokens: 100, outputTokens: 200 });
      await tracker.record({ taskId: 'task-2', agent: 'evaluator', inputTokens: 50, outputTokens: 50 });

      expect(tracker.getTotalTokens()).toBe(400);
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
    });

    it('should throw when total budget is exceeded', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir, { maxTotalTokens: 300 });
      await tracker.initialize();

      await tracker.record({ taskId: 'task-1', agent: 'generator', inputTokens: 100, outputTokens: 100 });

      await expect(
        tracker.record({ taskId: 'task-2', agent: 'generator', inputTokens: 100, outputTokens: 100 })
      ).rejects.toThrow('Token 预算已用完');
    });

    it('should warn when approaching budget threshold', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir, { maxTotalTokens: 1000, warnThreshold: 0.8 });
      await tracker.initialize();

      await tracker.record({ taskId: 'task-1', agent: 'generator', inputTokens: 500, outputTokens: 300 });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Token 预算警告'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('80.0%'));
    });

    it('should warn when task token limit is reached', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir, { maxTaskTokens: 100 });
      await tracker.initialize();

      await tracker.record({ taskId: 'task-1', agent: 'generator', inputTokens: 60, outputTokens: 50 });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('task-1'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('已达上限'));
    });
  });

  describe('getTaskTokens', () => {
    it('should sum tokens for a specific task', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      await tracker.record({ taskId: 'task-1', agent: 'generator', inputTokens: 100, outputTokens: 200 });
      await tracker.record({ taskId: 'task-1', agent: 'evaluator', inputTokens: 50, outputTokens: 50 });
      await tracker.record({ taskId: 'task-2', agent: 'generator', inputTokens: 30, outputTokens: 30 });

      expect(tracker.getTaskTokens('task-1')).toBe(400);
      expect(tracker.getTaskTokens('task-2')).toBe(60);
      expect(tracker.getTaskTokens('non-existent')).toBe(0);
    });
  });

  describe('getSummary', () => {
    it('should group by agent and task', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      await tracker.record({ taskId: 'task-1', agent: 'generator', inputTokens: 100, outputTokens: 200 });
      await tracker.record({ taskId: 'task-2', agent: 'generator', inputTokens: 50, outputTokens: 100 });
      await tracker.record({ taskId: 'task-1', agent: 'evaluator', inputTokens: 30, outputTokens: 30 });

      const summary = tracker.getSummary();

      expect(summary.totalInputTokens).toBe(180);
      expect(summary.totalOutputTokens).toBe(330);
      expect(summary.totalTokens).toBe(510);

      expect(summary.byAgent['generator']).toEqual({ inputTokens: 150, outputTokens: 300, calls: 2 });
      expect(summary.byAgent['evaluator']).toEqual({ inputTokens: 30, outputTokens: 30, calls: 1 });

      expect(summary.byTask['task-1']).toEqual({ inputTokens: 130, outputTokens: 230, calls: 2 });
      expect(summary.byTask['task-2']).toEqual({ inputTokens: 50, outputTokens: 100, calls: 1 });
    });

    it('should return empty summary when no entries', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      const summary = tracker.getSummary();
      expect(summary.totalTokens).toBe(0);
      expect(Object.keys(summary.byAgent)).toHaveLength(0);
      expect(Object.keys(summary.byTask)).toHaveLength(0);
    });
  });

  describe('getTotalTokens', () => {
    it('should return sum of input and output tokens', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({
        entries: [{ taskId: 't1', agent: 'a', inputTokens: 100, outputTokens: 200, timestamp: '2024-01-01T00:00:00Z' }],
      }));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();

      expect(tracker.getTotalTokens()).toBe(300);
    });
  });

  describe('printReport', () => {
    it('should print formatted report', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const tracker = new CostTracker(harnessDir);
      await tracker.initialize();
      await tracker.record({ taskId: 'task-1', agent: 'generator', inputTokens: 1000, outputTokens: 2000 });

      tracker.printReport();

      expect(logSpy).toHaveBeenCalledWith('\n📊 Token 使用报告');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('总输入 Token'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('generator'));
    });
  });
});
