import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Task, TaskList, TaskStatus, ProgressEntry } from '../types/index.js';

/**
 * 状态管理器
 * 负责管理项目的状态文件（tasks.json、progress.txt 等）
 */
export class StateManager {
  private harnessDir: string;

  constructor(projectDir: string) {
    this.harnessDir = path.join(projectDir, '.harness');
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.harnessDir, { recursive: true });
  }

  /**
   * 加载任务列表
   */
  async loadTasks(): Promise<TaskList> {
    await this.ensureDir();
    const filePath = path.join(this.harnessDir, 'tasks.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // 如果文件不存在，返回空的任务列表
      return {
        project: {
          name: '',
          version: '1.0.0',
          created_at: new Date().toISOString(),
        },
        tasks: [],
        statistics: {
          total: 0,
          pending: 0,
          in_progress: 0,
          completed: 0,
          blocked: 0,
          needs_human: 0,
        },
      };
    }
  }

  /**
   * 保存任务列表
   */
  async saveTasks(tasks: TaskList): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.harnessDir, 'tasks.json');
    await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), 'utf-8');
  }

  /**
   * 加载规格文档
   */
  async loadSpec(): Promise<string> {
    await this.ensureDir();
    const filePath = path.join(this.harnessDir, 'spec.md');
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      return '';
    }
  }

  /**
   * 保存规格文档
   */
  async saveSpec(content: string): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.harnessDir, 'spec.md');
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const tasks = await this.loadTasks();
    const task = tasks.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
      if (status === 'completed') {
        task.completed_at = new Date().toISOString();
      }
      this.updateStatistics(tasks);
      await this.saveTasks(tasks);
    }
  }

  /**
   * 增加任务尝试次数
   */
  async incrementTaskAttempts(taskId: string): Promise<number> {
    const tasks = await this.loadTasks();
    const task = tasks.tasks.find((t) => t.id === taskId);
    if (task) {
      task.attempts += 1;
      await this.saveTasks(tasks);
      return task.attempts;
    }
    return 0;
  }

  /**
   * 添加任务备注
   */
  async addTaskNote(taskId: string, note: string): Promise<void> {
    const tasks = await this.loadTasks();
    const task = tasks.tasks.find((t) => t.id === taskId);
    if (task) {
      // 确保 notes 数组存在
      if (!task.notes) {
        task.notes = [];
      }
      task.notes.push(note);
      await this.saveTasks(tasks);
    }
  }

  /**
   * 追加进度日志
   */
  async appendProgress(entry: ProgressEntry): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.harnessDir, 'progress.txt');
    const logEntry = `
## ${entry.timestamp} — 任务 ${entry.taskId}

状态：${entry.status}
${entry.details ? `详情：${entry.details}` : ''}
${entry.errors && entry.errors.length > 0 ? `错误：\n${entry.errors.map((e) => `  - ${e}`).join('\n')}` : ''}

---
`;
    await fs.appendFile(filePath, logEntry, 'utf-8');
  }

  /**
   * 加载进度日志
   */
  async loadProgress(): Promise<string> {
    await this.ensureDir();
    const filePath = path.join(this.harnessDir, 'progress.txt');
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      return '';
    }
  }

  /**
   * 获取下一个待处理任务
   * 优先恢复 in_progress 状态的任务（上次中断的任务）
   */
  async getNextTask(): Promise<Task | null> {
    const tasks = await this.loadTasks();

    // 优先返回 in_progress 状态的任务（恢复中断的任务）
    const inProgressTask = tasks.tasks.find(
      (t) => t.status === 'in_progress' && this.areDependenciesMet(t, tasks)
    );
    if (inProgressTask) {
      return inProgressTask;
    }

    // 然后查找 pending 状态的任务
    return (
      tasks.tasks.find(
        (t) => t.status === 'pending' && this.areDependenciesMet(t, tasks)
      ) || null
    );
  }

  /**
   * 检查任务依赖是否满足
   * 主逻辑：依赖任务状态为 completed
   * 备选逻辑：如果依赖任务定义了 outputs 且所有产出文件都存在，也视为满足（Bug-006 修复）
   */
  private areDependenciesMet(task: Task, tasks: TaskList): boolean {
    return task.dependencies.every((depId) => {
      const dep = tasks.tasks.find((t) => t.id === depId);
      if (!dep) return false;

      // 主检查：状态是否已完成
      if (dep.status === 'completed') {
        return true;
      }

      // 备选检查：如果任务定义了关键产出文件，检查它们是否都存在
      if (dep.outputs && dep.outputs.length > 0) {
        return this.checkOutputsExist(dep.outputs);
      }

      return false;
    });
  }

  /**
   * 检查任务的产出文件是否全部存在
   */
  private checkOutputsExist(outputs: string[]): boolean {
    try {
      for (const outputPath of outputs) {
        const fullPath = path.join(this.harnessDir, '..', outputPath);
        if (!fsSync.existsSync(fullPath)) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 更新统计信息
   */
  private updateStatistics(tasks: TaskList): void {
    tasks.statistics = {
      total: tasks.tasks.length,
      pending: tasks.tasks.filter((t) => t.status === 'pending').length,
      in_progress: tasks.tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.tasks.filter((t) => t.status === 'completed').length,
      blocked: tasks.tasks.filter((t) => t.status === 'blocked').length,
      needs_human: tasks.tasks.filter((t) => t.status === 'needs_human').length,
    };
  }

  /**
   * 检查项目是否已完成
   */
  async isProjectComplete(): Promise<boolean> {
    const tasks = await this.loadTasks();
    return tasks.tasks.every((t) => 
      t.status === 'completed' || t.status === 'needs_human'
    );
  }

  /**
   * 获取项目统计信息
   */
  async getStatistics(): Promise<TaskList['statistics']> {
    const tasks = await this.loadTasks();
    return tasks.statistics;
  }
}
