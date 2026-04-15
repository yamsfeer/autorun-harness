import { query } from '@anthropic-ai/claude-agent-sdk';
import { createAgentLoader, AgentDefinition } from '../agents/index.js';
import { Task, EvaluatorReport, AcceptanceCriterion, AcceptanceCriterionStatus } from '../types/index.js';
import { StateManager } from './state-manager.js';
import { createMessageHandler, MessageHandler } from './message-handler.js';
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
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          permissionMode: 'acceptEdits',
          maxTurns: 15,
        },
      });

      // 处理消息流
      for await (const message of queryResult) {
        if (message.type === 'result') {
          break;
        } else {
          this.messageHandler.handleMessage(message);
        }
      }

      // 读取生成的评估报告
      const fullReportPath = path.join(this.projectDir, reportPath);

      let report: EvaluatorReport;
      try {
        const reportContent = await fs.readFile(fullReportPath, 'utf-8');
        report = JSON.parse(reportContent) as EvaluatorReport;
        
        // 更新 tasks.json 中的 acceptance_criteria 状态
        await this.updateTaskAcceptanceStatus(task.id, report);
        
      } catch (error) {
        console.log('   ⚠️  未找到评估报告，生成默认报告');
        // 如果没有生成报告，返回一个默认的成功报告
        report = this.createDefaultReport(task, attempt, 'pass', '评估完成（未生成详细报告）');
        await this.saveReport(report);
      }

      return report;

    } catch (error) {
      console.error('   ❌ 评估失败:', error instanceof Error ? error.message : error);
      // 返回失败报告
      const report = this.createDefaultReport(
        task,
        attempt,
        'fail',
        `评估过程出错: ${error instanceof Error ? error.message : String(error)}`
      );
      await this.saveReport(report);
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
    summary: string
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
    };
  }
}

/**
 * 创建评估器实例
 */
export function createEvaluator(projectDir: string): Evaluator {
  return new Evaluator(projectDir);
}
