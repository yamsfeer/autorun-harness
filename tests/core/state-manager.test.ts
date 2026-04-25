import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { StateManager } from '../../src/core/state-manager.js';
import { TaskList, TaskStatus } from '../../src/types/index.js';

describe('StateManager', () => {
  let tempDir: string;
  let stateManager: StateManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-test-'));
    stateManager = new StateManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadTasks / saveTasks', () => {
    it('should return empty task list when file does not exist', async () => {
      const tasks = await stateManager.loadTasks();
      expect(tasks.tasks).toEqual([]);
      expect(tasks.statistics.total).toBe(0);
    });

    it('should save and load tasks', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };

      await stateManager.saveTasks(taskList);
      const loaded = await stateManager.loadTasks();

      expect(loaded.tasks).toHaveLength(1);
      expect(loaded.tasks[0].id).toBe('T001');
      expect(loaded.tasks[0].status).toBe('pending');
    });
  });

  describe('loadSpec / saveSpec', () => {
    it('should return empty string when spec does not exist', async () => {
      const spec = await stateManager.loadSpec();
      expect(spec).toBe('');
    });

    it('should save and load spec', async () => {
      await stateManager.saveSpec('# Test Spec\n\nContent here');
      const loaded = await stateManager.loadSpec();
      expect(loaded).toBe('# Test Spec\n\nContent here');
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status and completed_at', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      await stateManager.updateTaskStatus('T001', 'completed');
      const loaded = await stateManager.loadTasks();

      expect(loaded.tasks[0].status).toBe('completed');
      expect(loaded.tasks[0].completed_at).toBeTruthy();
    });

    it('should update statistics when status changes', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      await stateManager.updateTaskStatus('T001', 'in_progress');
      const loaded = await stateManager.loadTasks();

      expect(loaded.statistics.pending).toBe(0);
      expect(loaded.statistics.in_progress).toBe(1);
    });
  });

  describe('incrementTaskAttempts', () => {
    it('should increment attempts and return new value', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      const attempts = await stateManager.incrementTaskAttempts('T001');
      expect(attempts).toBe(1);

      const loaded = await stateManager.loadTasks();
      expect(loaded.tasks[0].attempts).toBe(1);
    });

    it('should return 0 for non-existent task', async () => {
      const attempts = await stateManager.incrementTaskAttempts('NONEXISTENT');
      expect(attempts).toBe(0);
    });
  });

  describe('addTaskNote', () => {
    it('should add note to task', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      await stateManager.addTaskNote('T001', 'Note 1');
      await stateManager.addTaskNote('T001', 'Note 2');

      const loaded = await stateManager.loadTasks();
      expect(loaded.tasks[0].notes).toEqual(['Note 1', 'Note 2']);
    });

    it('should handle missing notes array', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            // notes intentionally omitted
          } as any,
        ],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      await stateManager.addTaskNote('T001', 'New note');

      const loaded = await stateManager.loadTasks();
      expect(loaded.tasks[0].notes).toEqual(['New note']);
    });
  });

  describe('appendProgress / loadProgress', () => {
    it('should append and load progress', async () => {
      await stateManager.appendProgress({
        timestamp: '2024-01-01T00:00:00Z',
        taskId: 'T001',
        status: 'completed',
        details: 'Task done',
      });

      await stateManager.appendProgress({
        timestamp: '2024-01-01T01:00:00Z',
        taskId: 'T002',
        status: 'failed',
        details: 'Task failed',
        errors: ['error1', 'error2'],
      });

      const progress = await stateManager.loadProgress();
      expect(progress).toContain('T001');
      expect(progress).toContain('completed');
      expect(progress).toContain('T002');
      expect(progress).toContain('error1');
      expect(progress).toContain('error2');
    });
  });

  describe('getNextTask', () => {
    it('should return null when no tasks exist', async () => {
      const next = await stateManager.getNextTask();
      expect(next).toBeNull();
    });

    it('should return in_progress task first', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Pending Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
          {
            id: 'T002',
            title: 'In Progress Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'in_progress',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 2, pending: 1, in_progress: 1, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      const next = await stateManager.getNextTask();
      expect(next?.id).toBe('T002');
    });

    it('should return pending task with met dependencies', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Completed Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'completed',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
          {
            id: 'T002',
            title: 'Dependent Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: ['T001'],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 2, pending: 1, in_progress: 0, completed: 1, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      const next = await stateManager.getNextTask();
      expect(next?.id).toBe('T002');
    });

    it('should not return task with unmet dependencies', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Incomplete Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
          {
            id: 'T002',
            title: 'Dependent Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: ['T001'],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 2, pending: 2, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      const next = await stateManager.getNextTask();
      expect(next?.id).toBe('T001');
    });

    // Bug-006 fix: check outputs as fallback dependency verification
    it('should allow task when dependency has outputs that exist (Bug-006 fix)', async () => {
      // Create output file for T001
      const outputDir = path.join(tempDir, 'src', 'components');
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path.join(outputDir, 'Layout.vue'), '<template></template>', 'utf-8');

      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Init Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            outputs: ['src/components/Layout.vue'],
            attempts: 0,
            status: 'needs_human', // Not completed, but outputs exist
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
          {
            id: 'T002',
            title: 'Dependent Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: ['T001'],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 2, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 1 },
      };
      await stateManager.saveTasks(taskList);

      const next = await stateManager.getNextTask();
      expect(next?.id).toBe('T002');
    });

    it('should not allow task when dependency outputs are missing', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Init Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            outputs: ['src/components/Missing.vue'],
            attempts: 0,
            status: 'needs_human',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
          {
            id: 'T002',
            title: 'Dependent Task',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: ['T001'],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 2, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 1 },
      };
      await stateManager.saveTasks(taskList);

      const next = await stateManager.getNextTask();
      // T002 is blocked, T001 is needs_human (not eligible for getNextTask)
      expect(next).toBeNull();
    });
  });

  describe('isProjectComplete', () => {
    it('should return true when all tasks are completed or needs_human', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'completed',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
          {
            id: 'T002',
            title: 'Task 2',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'needs_human',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 2, pending: 0, in_progress: 0, completed: 1, blocked: 0, needs_human: 1 },
      };
      await stateManager.saveTasks(taskList);

      expect(await stateManager.isProjectComplete()).toBe(true);
    });

    it('should return false when tasks are still pending', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      expect(await stateManager.isProjectComplete()).toBe(false);
    });
  });

  describe('getStatistics', () => {
    it('should return current statistics', async () => {
      const taskList: TaskList = {
        project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
        tasks: [
          {
            id: 'T001',
            title: 'Task 1',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'completed',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
          {
            id: 'T002',
            title: 'Task 2',
            category: 'functional',
            priority: 'high',
            description: 'desc',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
        statistics: { total: 2, pending: 1, in_progress: 0, completed: 1, blocked: 0, needs_human: 0 },
      };
      await stateManager.saveTasks(taskList);

      const stats = await stateManager.getStatistics();
      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });
});
