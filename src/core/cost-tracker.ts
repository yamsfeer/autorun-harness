import fs from 'fs/promises';
import path from 'path';
import { CostEntry, CostSummary, BudgetConfig } from '../types/quality.js';

/**
 * 成本追踪器
 * 记录和统计 Token 使用量
 */
export class CostTracker {
  private costsPath: string;
  private entries: CostEntry[] = [];
  private config: BudgetConfig;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;

  constructor(harnessDir: string, config?: Partial<BudgetConfig>) {
    this.costsPath = path.join(harnessDir, 'costs.json');
    this.config = {
      maxTotalTokens: config?.maxTotalTokens,
      maxTaskTokens: config?.maxTaskTokens,
      warnThreshold: config?.warnThreshold || 0.8,  // 80%
    };
  }

  /**
   * 初始化 - 加载历史数据
   */
  async initialize(): Promise<void> {
    try {
      const content = await fs.readFile(this.costsPath, 'utf-8');
      const data = JSON.parse(content);
      this.entries = data.entries || [];
      this.totalInputTokens = this.entries.reduce((sum, e) => sum + e.inputTokens, 0);
      this.totalOutputTokens = this.entries.reduce((sum, e) => sum + e.outputTokens, 0);
    } catch {
      this.entries = [];
      this.totalInputTokens = 0;
      this.totalOutputTokens = 0;
    }
  }

  /**
   * 记录一次 API 调用
   */
  async record(entry: Omit<CostEntry, 'timestamp'>): Promise<void> {
    const fullEntry: CostEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(fullEntry);
    this.totalInputTokens += entry.inputTokens;
    this.totalOutputTokens += entry.outputTokens;

    // 持久化
    await this.save();

    // 检查预算
    await this.checkBudget(entry.taskId);
  }

  /**
   * 检查预算
   */
  private async checkBudget(taskId?: string): Promise<void> {
    const totalTokens = this.totalInputTokens + this.totalOutputTokens;

    // 总预算检查
    if (this.config.maxTotalTokens) {
      const percentage = totalTokens / this.config.maxTotalTokens;

      if (percentage >= 1) {
        throw new Error(`Token 预算已用完: ${totalTokens.toLocaleString()} / ${this.config.maxTotalTokens.toLocaleString()}`);
      }

      if (percentage >= this.config.warnThreshold) {
        console.warn(`⚠️ Token 预算警告: 已使用 ${(percentage * 100).toFixed(1)}% (${totalTokens.toLocaleString()} tokens)`);
      }
    }

    // 单任务预算检查
    if (this.config.maxTaskTokens && taskId) {
      const taskTokens = this.getTaskTokens(taskId);
      if (taskTokens >= this.config.maxTaskTokens) {
        console.warn(`⚠️ 任务 ${taskId} Token 已达上限: ${taskTokens.toLocaleString()}`);
      }
    }
  }

  /**
   * 获取单个任务 Token 数
   */
  getTaskTokens(taskId: string): number {
    return this.entries
      .filter(e => e.taskId === taskId)
      .reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
  }

  /**
   * 获取成本摘要
   */
  getSummary(): CostSummary {
    const byAgent: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};
    const byTask: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};

    for (const entry of this.entries) {
      // 按代理统计
      if (!byAgent[entry.agent]) {
        byAgent[entry.agent] = { inputTokens: 0, outputTokens: 0, calls: 0 };
      }
      byAgent[entry.agent].inputTokens += entry.inputTokens;
      byAgent[entry.agent].outputTokens += entry.outputTokens;
      byAgent[entry.agent].calls += 1;

      // 按任务统计
      if (entry.taskId) {
        if (!byTask[entry.taskId]) {
          byTask[entry.taskId] = { inputTokens: 0, outputTokens: 0, calls: 0 };
        }
        byTask[entry.taskId].inputTokens += entry.inputTokens;
        byTask[entry.taskId].outputTokens += entry.outputTokens;
        byTask[entry.taskId].calls += 1;
      }
    }

    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      byAgent,
      byTask,
    };
  }

  /**
   * 打印成本报告
   */
  printReport(): void {
    const summary = this.getSummary();

    console.log('\n📊 Token 使用报告');
    console.log(`   总输入 Token: ${summary.totalInputTokens.toLocaleString()}`);
    console.log(`   总输出 Token: ${summary.totalOutputTokens.toLocaleString()}`);
    console.log(`   总计: ${summary.totalTokens.toLocaleString()} tokens`);

    console.log('\n   按代理分布:');
    for (const [agent, data] of Object.entries(summary.byAgent)) {
      const total = data.inputTokens + data.outputTokens;
      console.log(`   - ${agent}: ${total.toLocaleString()} tokens (${data.calls} 次调用)`);
    }
  }

  /**
   * 保存到文件
   */
  private async save(): Promise<void> {
    const data = {
      lastUpdated: new Date().toISOString(),
      summary: this.getSummary(),
      entries: this.entries,
    };
    await fs.writeFile(this.costsPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 获取总 Token 数
   */
  getTotalTokens(): number {
    return this.totalInputTokens + this.totalOutputTokens;
  }
}

/**
 * 创建成本追踪器实例
 */
export function createCostTracker(harnessDir: string, config?: Partial<BudgetConfig>): CostTracker {
  return new CostTracker(harnessDir, config);
}
