import fs from 'fs/promises';
import path from 'path';
import {
  FailureRecord,
  FailurePattern,
  RecoveryAttempt,
  ErrorType,
  AcceptanceCriterionFailure,
} from '../types/quality.js';
import { Task } from '../types/index.js';

/**
 * 错误收集器
 * 收集和分析开发过程中的错误
 */
export class FailureCollector {
  private failurePath: string;
  private records: FailureRecord[] = [];

  constructor(harnessDir: string) {
    this.failurePath = path.join(harnessDir, 'failure.md');
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    // 解析已有的 failure.md
    await this.loadExisting();
  }

  /**
   * 记录失败 - 详细版本
   */
  async recordFailure(params: {
    task: Task;
    attempt: number;
    errorType: ErrorType;
    errorMessage: string;
    errorStack?: string;
    acceptanceCriteriaFailures?: AcceptanceCriterionFailure[];
    affectedFiles?: string[];
    agentPhase: 'planning' | 'generation' | 'evaluation';
  }): Promise<FailureRecord> {
    const record: FailureRecord = {
      id: `FAIL-${Date.now()}`,
      timestamp: new Date().toISOString(),

      // 任务详情
      taskId: params.task.id,
      taskTitle: params.task.title,
      taskCategory: params.task.category,
      taskPriority: params.task.priority,
      attempt: params.attempt,

      // 错误信息
      errorType: params.errorType,
      errorMessage: params.errorMessage,
      errorStack: params.errorStack,

      // 验收标准失败详情
      acceptanceCriteriaFailures: params.acceptanceCriteriaFailures || [],

      // 上下文
      affectedFiles: params.affectedFiles,
      agentPhase: params.agentPhase,

      // 恢复记录
      recoveryAttempts: [],
    };

    this.records.push(record);
    await this.save();

    return record;
  }

  /**
   * 从评估报告创建失败记录
   */
  async recordFromEvaluatorReport(params: {
    task: Task;
    attempt: number;
    errorMessage: string;
    criteriaResults: Array<{
      criterion_id: string;
      description: string;
      result: 'pass' | 'fail';
      details: Array<{
        step: number;
        action: string;
        status: 'pass' | 'fail' | 'pending';
        reason?: string;
      }>;
    }>;
    affectedFiles?: string[];
  }): Promise<FailureRecord> {
    // 提取失败的验收标准
    const failedCriteria: AcceptanceCriterionFailure[] = params.criteriaResults
      .filter(cr => cr.result === 'fail')
      .map(cr => {
        const failedStep = cr.details.find(d => d.status === 'fail');
        return {
          criterionId: cr.criterion_id,
          description: cr.description,
          failedStep: failedStep?.step,
          failedStepDescription: failedStep?.action,
          reason: failedStep?.reason,
        };
      });

    return this.recordFailure({
      task: params.task,
      attempt: params.attempt,
      errorType: 'validation_error',
      errorMessage: params.errorMessage,
      acceptanceCriteriaFailures: failedCriteria,
      affectedFiles: params.affectedFiles,
      agentPhase: 'evaluation',
    });
  }

  /**
   * 记录恢复尝试
   */
  async recordRecovery(
    failureId: string,
    attempt: Omit<RecoveryAttempt, 'timestamp'>
  ): Promise<void> {
    const record = this.records.find(r => r.id === failureId);
    if (record) {
      record.recoveryAttempts.push({
        ...attempt,
        timestamp: new Date().toISOString(),
      });
      await this.save();
    }
  }

  /**
   * 记录解决方案
   */
  async recordResolution(
    failureId: string,
    solution: string,
    success: boolean,
    fixedBy: 'auto' | 'human' = 'auto'
  ): Promise<void> {
    const record = this.records.find(r => r.id === failureId);
    if (record) {
      record.resolution = {
        timestamp: new Date().toISOString(),
        solution,
        success,
        fixedBy,
      };
      await this.save();
    }
  }

  /**
   * 分析错误模式
   */
  analyzePatterns(): FailurePattern[] {
    const patterns: Map<string, FailurePattern> = new Map();

    for (const record of this.records) {
      // 按错误类型 + 任务类型分组
      const key = `${record.errorType}:${record.taskCategory}:${this.extractPattern(record.errorMessage)}`;

      if (!patterns.has(key)) {
        patterns.set(key, {
          pattern: this.extractPattern(record.errorMessage),
          occurrences: 0,
          lastSeen: record.timestamp,
          suggestedSolution: this.getSuggestedSolution(record),
        });
      }

      const pattern = patterns.get(key)!;
      pattern.occurrences += 1;
      if (record.timestamp > pattern.lastSeen) {
        pattern.lastSeen = record.timestamp;
      }
    }

    return Array.from(patterns.values()).sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * 按任务类型分析
   */
  analyzeByCategory(): Record<string, { count: number; commonErrors: string[] }> {
    const result: Record<string, { count: number; commonErrors: string[] }> = {};

    for (const record of this.records) {
      const cat = record.taskCategory;
      if (!result[cat]) {
        result[cat] = { count: 0, commonErrors: [] };
      }
      result[cat].count += 1;

      const errorSummary = record.errorMessage.slice(0, 50);
      if (!result[cat].commonErrors.includes(errorSummary)) {
        result[cat].commonErrors.push(errorSummary);
      }
    }

    return result;
  }

  /**
   * 提取错误模式
   */
  private extractPattern(message: string): string {
    return message
      .replace(/\d+/g, 'N')
      .replace(/\/[\w\-./]+/g, '<PATH>')
      .replace(/['"][^'"]+['"]/g, '<STRING>')
      .slice(0, 80);
  }

  /**
   * 获取建议的解决方案
   */
  private getSuggestedSolution(record: FailureRecord): string | undefined {
    // 从已解决的相似问题中学习
    const resolved = this.records.find(r =>
      r.taskCategory === record.taskCategory &&
      r.errorType === record.errorType &&
      r.resolution?.success
    );

    return resolved?.resolution?.solution;
  }

  /**
   * 生成 failure.md 内容
   */
  generateMarkdown(): string {
    const patterns = this.analyzePatterns();
    const byCategory = this.analyzeByCategory();
    const now = new Date().toISOString();

    let md = `# 错误收集报告

> 最后更新: ${now}
> 总错误数: ${this.records.length}

## 按任务类型统计

`;

    for (const [category, data] of Object.entries(byCategory)) {
      md += `### ${category}
- 失败次数: ${data.count}
- 常见错误: ${data.commonErrors.slice(0, 3).join(', ')}

`;
    }

    md += `## 错误模式分析

`;

    if (patterns.length === 0) {
      md += `_暂无错误记录_\n`;
    } else {
      for (const pattern of patterns) {
        md += `### ${pattern.pattern}

- 出现次数: ${pattern.occurrences}
- 最后出现: ${pattern.lastSeen}
${pattern.suggestedSolution ? `- 建议方案: ${pattern.suggestedSolution}` : ''}

`;
      }
    }

    md += `## 最近错误详情

`;

    // 最近 10 条
    const recent = this.records.slice(-10).reverse();
    for (const record of recent) {
      md += `### ${record.id} — ${record.taskId}: ${record.taskTitle}

| 属性 | 值 |
|------|-----|
| 时间 | ${record.timestamp} |
| 阶段 | ${record.agentPhase} |
| 类型 | ${record.errorType} |
| 尝试 | 第 ${record.attempt} 次 |
| 优先级 | ${record.taskPriority} |

**错误信息**: ${record.errorMessage}

`;

      if (record.acceptanceCriteriaFailures.length > 0) {
        md += `**失败的验收标准**:

| ID | 描述 | 失败步骤 | 原因 |
|----|------|----------|------|
`;
        for (const ac of record.acceptanceCriteriaFailures) {
          md += `| ${ac.criterionId} | ${ac.description} | ${ac.failedStep ? `步骤${ac.failedStep}: ${ac.failedStepDescription}` : '-'} | ${ac.reason || '-'} |\n`;
        }
        md += '\n';
      }

      if (record.affectedFiles && record.affectedFiles.length > 0) {
        md += `**涉及文件**: ${record.affectedFiles.join(', ')}

`;
      }

      if (record.resolution) {
        md += `**解决方案**: ${record.resolution.solution}
- 状态: ${record.resolution.success ? '✅ 成功' : '❌ 失败'}
- 修复者: ${record.resolution.fixedBy}

`;
      }
      md += `---\n\n`;
    }

    return md;
  }

  /**
   * 加载已有记录
   */
  private async loadExisting(): Promise<void> {
    // 暂时跳过，可扩展为从 JSON 文件加载
  }

  /**
   * 保存到文件
   */
  private async save(): Promise<void> {
    const md = this.generateMarkdown();
    await fs.writeFile(this.failurePath, md, 'utf-8');
  }

  /**
   * 获取所有记录
   */
  getRecords(): FailureRecord[] {
    return this.records;
  }

  /**
   * 获取特定任务的失败记录
   */
  getRecordsByTask(taskId: string): FailureRecord[] {
    return this.records.filter(r => r.taskId === taskId);
  }
}

/**
 * 创建错误收集器实例
 */
export function createFailureCollector(harnessDir: string): FailureCollector {
  return new FailureCollector(harnessDir);
}
