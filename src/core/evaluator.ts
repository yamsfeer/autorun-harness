import { query } from '@anthropic-ai/claude-agent-sdk';
import { createAgentLoader, AgentDefinition } from '../agents/index.js';
import { Task, EvaluatorReport, AcceptanceCriterion, AcceptanceCriterionStatus } from '../types/index.js';
import { StateManager } from './state-manager.js';
import { createMessageHandler, MessageHandler } from './message-handler.js';
import { createError } from './error-handler.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * 评估器
 * 负责验收开发工作，执行验收标准测试
 */
export class Evaluator {
  private projectDir: string;
  private stateManager: StateManager;
  private agentLoader;
  private messageHandler: MessageHandler;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.stateManager = new StateManager(projectDir);
    this.agentLoader = createAgentLoader();
    this.messageHandler = createMessageHandler();
  }

  /**
   * 评估任务
   */
  async evaluate(task: Task, attempt: number): Promise<EvaluatorReport> {
    console.log('   🔍 开始评估...');

    try {
      // 确保 reports 目录存在
      const reportsDir = path.join(this.projectDir, '.harness', 'reports');
      await fs.mkdir(reportsDir, { recursive: true });

      // 加载评估器 Agent 定义
      const evaluatorDef = await this.agentLoader.loadEvaluator();

      // 读取产品规格
      const spec = await this.stateManager.loadSpec();

      // 准备用户输入
      const reportFileName = `evaluator_report_${task.id}_${attempt}.json`;
      const reportPath = `.harness/reports/${reportFileName}`;

      const userPrompt = `请评估以下任务的完成情况。

## 当前任务

${JSON.stringify(task, null, 2)}

## 产品规格

${spec}

---

## 评估要求

1. 逐条检查每个验收标准 (acceptance_criteria)
2. 实际运行命令测试功能（如 npm run build, npm test 等）
3. 记录每个验收标准的测试结果
4. 如果是CLI应用，实际运行命令验证功能
5. 如果失败，提供具体的修复建议

## 重要：报告文件

**必须**将评估报告保存到以下路径：
\`${reportPath}\`

文件名中的参数：
- task_id = ${task.id}
- attempt = ${attempt}

报告必须包含：
- report_id: 唯一ID
- task_id: "${task.id}"
- attempt: ${attempt}
- timestamp: 时间戳
- overall_result: "pass" 或 "fail"
- summary: 评估总结
- criteria_results: 每个验收标准的详细结果
- total_weighted_score: 加权总分
- threshold: 0.75
- final_decision: "pass" 或 "fail"
- feedback_for_generator: 给生成器的反馈
`;

      // 重置消息处理器
      this.messageHandler.reset();

      // 调用评估器 Agent
      const queryResult = query({
        prompt: userPrompt,
        options: {
          cwd: this.projectDir,
          systemPrompt: evaluatorDef.prompt,
          model: process.env.ANTHROPIC_MODEL,
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          permissionMode: 'acceptEdits',
          maxTurns: 15,
        },
      });

      // 处理消息流
      let lastResult: { success: boolean; usage?: any; error?: string; rawMessage?: any } | null = null;

      for await (const message of queryResult) {
        if (message.type === 'result') {
          lastResult = this.messageHandler.handleResult(message);
          break;
        } else {
          this.messageHandler.handleMessage(message);
        }
      }

      // 检查 Agent 执行结果
      if (!lastResult) {
        throw createError('evaluator_error', '评估器执行异常：未收到结果消息', {
          context: { taskId: task.id, attempt },
        });
      }
      if (!lastResult.success) {
        // 记录完整原始消息以便诊断
        console.error('   ❌ 评估器 Agent 执行失败:', lastResult.error);
        if (lastResult.rawMessage) {
          console.error('   原始消息:', JSON.stringify(lastResult.rawMessage, null, 2).slice(0, 800));
        }
        throw createError('evaluator_error', lastResult.error || '评估器执行失败', {
          context: { taskId: task.id, attempt, rawMessage: lastResult.rawMessage },
        });
      }

      // 读取生成的评估报告
      const fullReportPath = path.join(this.projectDir, reportPath);

      let report: EvaluatorReport;
      try {
        const reportContent = await fs.readFile(fullReportPath, 'utf-8');
        report = JSON.parse(reportContent) as EvaluatorReport;

        // 验证最终决策与阈值的一致性（Bug-001 修复）
        report = this.validateReportThreshold(report);

        // 更新 tasks.json 中的 acceptance_criteria 状态
        await this.updateTaskAcceptanceStatus(task.id, report);

      } catch (error) {
        console.log('   ⚠️  未找到评估报告或报告解析失败，生成默认失败报告');
        // 如果没有生成报告，视为评估失败
        report = this.createDefaultReport(task, attempt, 'fail', '评估完成但未生成报告，视为失败');
        await this.saveReport(report);
        // 即使生成默认报告也尝试更新 AC 状态
        await this.updateTaskAcceptanceStatus(task.id, report);
      }

      return report;

    } catch (error) {
      console.error('   ❌ 评估失败:', error instanceof Error ? error.message : error);
      // 返回失败报告，并标记为 evaluator_error（评估器自身问题，非代码问题）
      const report = this.createDefaultReport(
        task,
        attempt,
        'fail',
        `评估过程出错: ${error instanceof Error ? error.message : String(error)}`,
        true // evaluator_error = true
      );
      await this.saveReport(report);
      // 即使评估器崩溃也回写 AC 状态（全部标记为 fail 并注明原因）
      await this.updateTaskAcceptanceStatus(task.id, report);
      return report;
    }
  }

  /**
   * 更新任务验收标准状态
   */
  private async updateTaskAcceptanceStatus(taskId: string, report: EvaluatorReport): Promise<void> {
    const tasks = await this.stateManager.loadTasks();
    const task = tasks.tasks.find(t => t.id === taskId);
    
    if (task && report.criteria_results) {
      // 更新每个验收标准的状态
      task.acceptance_criteria.forEach((ac) => {
        const result = report.criteria_results.find(cr => cr.criterion_id === ac.id);
        if (result) {
          ac.status = result.result as AcceptanceCriterionStatus;
        }
      });
      
      // 保存更新后的 tasks.json
      await this.stateManager.saveTasks(tasks);
    }
  }

  /**
   * 验证报告的阈值逻辑一致性（Bug-001 修复）
   * 确保 final_decision = "pass" 当且仅当 total_weighted_score >= threshold
   */
  private validateReportThreshold(report: EvaluatorReport): EvaluatorReport {
    const calculatedDecision = report.total_weighted_score >= report.threshold ? 'pass' : 'fail';
    if (report.final_decision !== calculatedDecision) {
      console.warn(
        `   ⚠️  报告阈值逻辑不一致: total_weighted_score=${report.total_weighted_score}, threshold=${report.threshold}, 但 final_decision="${report.final_decision}"，已修正为 "${calculatedDecision}"`
      );
      report.final_decision = calculatedDecision;
      // 如果修正为 fail，也修正 overall_result
      if (calculatedDecision === 'fail') {
        report.overall_result = 'fail';
        report.summary = `[阈值修正] ${report.summary}`;
      }
    }
    return report;
  }

  /**
   * 保存评估报告
   */
  private async saveReport(report: EvaluatorReport): Promise<void> {
    const reportsDir = path.join(this.projectDir, '.harness', 'reports');
    await fs.mkdir(reportsDir, { recursive: true });
    
    const reportPath = path.join(
      reportsDir,
      `evaluator_report_${report.task_id}_${report.attempt}.json`
    );
    
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  }

  /**
   * 创建默认评估报告
   */
  private createDefaultReport(
    task: Task,
    attempt: number,
    result: 'pass' | 'fail',
    summary: string,
    evaluatorError: boolean = false
  ): EvaluatorReport {
    return {
      report_id: `ER-${Date.now()}`,
      task_id: task.id,
      attempt,
      timestamp: new Date().toISOString(),
      overall_result: result,
      summary,
      criteria_results: task.acceptance_criteria.map((ac) => ({
        criterion_id: ac.id,
        description: ac.description,
        result: result,
        details: ac.steps.map((step, idx) => ({
          step: idx + 1,
          action: step,
          status: result === 'pass' ? 'pass' : 'fail',
        })),
      })),
      quality_scores: {
        functionality: { score: result === 'pass' ? 0.8 : 0.3, weight: 0.4, weighted: 0, comment: summary },
        code_quality: { score: 0.7, weight: 0.25, weighted: 0, comment: '' },
        product_depth: { score: 0.6, weight: 0.2, weighted: 0, comment: '' },
        visual_design: { score: 0.7, weight: 0.15, weighted: 0, comment: '' },
      },
      total_weighted_score: result === 'pass' ? 0.7 : 0.35,
      threshold: 0.75,
      final_decision: result,
      feedback_for_generator: summary,
      screenshot_paths: [],
      evaluator_error: evaluatorError,
    };
  }
}

/**
 * 创建评估器实例
 */
export function createEvaluator(projectDir: string): Evaluator {
  return new Evaluator(projectDir);
}
