import fs from 'fs/promises';
import path from 'path';
import { TaskLevelMetrics } from './types.js';

/**
 * 计算第一层：任务级指标
 * 从 .harness/ 下的状态文件中提取，零人工
 */
export async function computeTaskLevelMetrics(harnessDir: string): Promise<TaskLevelMetrics> {
  const tasksData = await loadJsonFile(path.join(harnessDir, 'tasks.json'));
  const costsData = await loadJsonFile(path.join(harnessDir, 'costs.json'));
  const reportScores = await loadReportScores(harnessDir);

  // 从 tasks.json 提取
  const tasks: any[] = tasksData?.tasks || [];
  const completedTasks = tasks.filter((t: any) => t.status === 'completed');
  const needsHumanTasks = tasks.filter((t: any) => t.status === 'needs_human');
  const firstPassTasks = completedTasks.filter((t: any) => t.attempts === 0);

  const firstPassRate = completedTasks.length > 0 ? firstPassTasks.length / completedTasks.length : 0;
  const totalAttempts = completedTasks.reduce((sum: number, t: any) => sum + t.attempts, 0);
  const averageRetryCount = completedTasks.length > 0 ? totalAttempts / completedTasks.length : 0;
  const humanInterventionRate = tasks.length > 0 ? needsHumanTasks.length / tasks.length : 0;

  // 从 costs.json 提取
  const entries: any[] = costsData?.entries || [];
  const perAgentTokenCost = computePerAgentCost(entries);
  const perTaskTokenCost = computePerTaskCost(entries, tasks);
  const totalTokenCost = computeTotalCost(entries);

  // 从 reports/*.json 提取
  const totalScore = reportScores.reduce((sum, s) => sum + s, 0);
  const avgEvaluatorWeightedScore = reportScores.length > 0 ? totalScore / reportScores.length : 0;

  return {
    firstPassRate,
    firstPassDetails: {
      firstPass: firstPassTasks.length,
      totalCompleted: completedTasks.length,
    },
    averageRetryCount,
    retryDetails: {
      totalAttempts,
      completedCount: completedTasks.length,
    },
    humanInterventionRate,
    humanInterventionDetails: {
      needsHuman: needsHumanTasks.length,
      total: tasks.length,
    },
    perAgentTokenCost,
    perTaskTokenCost,
    totalTokenCost,
    avgEvaluatorWeightedScore,
    evaluatorScoreDetails: {
      totalScore,
      reportCount: reportScores.length,
    },
  };
}

/**
 * 安全地读取 JSON 文件
 */
async function loadJsonFile(filePath: string): Promise<any> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 读取所有评估报告的 total_weighted_score
 */
async function loadReportScores(harnessDir: string): Promise<number[]> {
  const reportsDir = path.join(harnessDir, 'reports');
  const scores: number[] = [];

  try {
    const files = await fs.readdir(reportsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(reportsDir, file), 'utf-8');
        const report = JSON.parse(content);
        if (typeof report.total_weighted_score === 'number') {
          scores.push(report.total_weighted_score);
        }
      } catch {
        // 跳过无法解析的报告
      }
    }
  } catch {
    // reports 目录不存在
  }

  return scores;
}

/**
 * 按代理分组计算 Token 成本
 */
function computePerAgentCost(entries: any[]): Record<string, { inputTokens: number; outputTokens: number; total: number }> {
  const result: Record<string, { inputTokens: number; outputTokens: number; total: number }> = {};

  for (const entry of entries) {
    const agent = entry.agent || 'unknown';
    if (!result[agent]) {
      result[agent] = { inputTokens: 0, outputTokens: 0, total: 0 };
    }
    result[agent].inputTokens += entry.inputTokens || 0;
    result[agent].outputTokens += entry.outputTokens || 0;
    result[agent].total += (entry.inputTokens || 0) + (entry.outputTokens || 0);
  }

  return result;
}

/**
 * 按任务分组计算 Token 成本
 */
function computePerTaskCost(
  entries: any[],
  tasks: any[]
): Record<string, { inputTokens: number; outputTokens: number; total: number; taskTitle?: string }> {
  const taskMap = new Map<string, string>();
  for (const task of tasks) {
    taskMap.set(task.id, task.title);
  }

  const result: Record<string, { inputTokens: number; outputTokens: number; total: number; taskTitle?: string }> = {};

  for (const entry of entries) {
    if (!entry.taskId) continue;
    if (!result[entry.taskId]) {
      result[entry.taskId] = {
        inputTokens: 0,
        outputTokens: 0,
        total: 0,
        taskTitle: taskMap.get(entry.taskId),
      };
    }
    result[entry.taskId].inputTokens += entry.inputTokens || 0;
    result[entry.taskId].outputTokens += entry.outputTokens || 0;
    result[entry.taskId].total += (entry.inputTokens || 0) + (entry.outputTokens || 0);
  }

  return result;
}

/**
 * 计算总 Token 成本
 */
function computeTotalCost(entries: any[]): { inputTokens: number; outputTokens: number; total: number } {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const entry of entries) {
    inputTokens += entry.inputTokens || 0;
    outputTokens += entry.outputTokens || 0;
  }

  return { inputTokens, outputTokens, total: inputTokens + outputTokens };
}
