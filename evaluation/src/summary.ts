import { TaskLevelMetrics, ProjectLevelMetrics, EvaluationSummary, Grade, CheckResult } from './types.js';

/**
 * 计算评估总结
 */
export function computeEvaluationSummary(
  taskLevel: TaskLevelMetrics,
  projectLevel: ProjectLevelMetrics | null
): EvaluationSummary {
  const taskLevelScore = computeTaskLevelScore(taskLevel);
  const projectLevelScore = projectLevel ? computeProjectLevelScore(projectLevel) : null;
  const overallScore = computeOverallScore(taskLevelScore, projectLevelScore);
  const grade = computeGrade(overallScore);

  const { highlights, issues } = generateHighlightsAndIssues(taskLevel, projectLevel, taskLevelScore, projectLevelScore);

  return {
    overallScore,
    taskLevelScore,
    projectLevelScore,
    grade,
    highlights,
    issues,
  };
}

/**
 * 任务级评分 (0-100)
 *
 * 首次通过率 × 30 + (1 - 人工介入率) × 25 + (1 - 归一化重试次数) × 20 + 平均评估分 × 25
 */
function computeTaskLevelScore(metrics: TaskLevelMetrics): number {
  if (metrics.firstPassDetails.totalCompleted === 0) return 0;

  const firstPassComponent = metrics.firstPassRate * 30;
  const humanComponent = (1 - metrics.humanInterventionRate) * 25;
  const retryComponent = (1 - Math.min(metrics.averageRetryCount / 3, 1)) * 20;
  const scoreComponent = metrics.avgEvaluatorWeightedScore * 25;

  return Math.round((firstPassComponent + humanComponent + retryComponent + scoreComponent) * 10) / 10;
}

/**
 * 项目级评分 (0-100)
 *
 * 通过的检查数 / 非跳过的检查总数 × 100
 */
function computeProjectLevelScore(metrics: ProjectLevelMetrics): number {
  const checks: CheckResult[] = [
    metrics.correctness.buildSuccess,
    metrics.correctness.testPassRate,
    metrics.stability.devServerStartup,
    metrics.stability.runtimeNoCrash,
    metrics.quality.typeScriptErrors,
    metrics.quality.eslintIssues,
    metrics.quality.auditVulnerabilities,
  ];

  const nonSkipped = checks.filter(c => c.status !== 'skipped');
  if (nonSkipped.length === 0) return 0;

  const passed = nonSkipped.filter(c => c.status === 'pass').length;
  return Math.round((passed / nonSkipped.length) * 1000) / 10;
}

/**
 * 综合评分 (0-100)
 */
function computeOverallScore(taskScore: number, projectScore: number | null): number {
  if (projectScore === null) return taskScore;
  return Math.round((taskScore + projectScore) / 2 * 10) / 10;
}

/**
 * 计算等级
 */
function computeGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * 生成亮点和问题
 */
function generateHighlightsAndIssues(
  taskLevel: TaskLevelMetrics,
  projectLevel: ProjectLevelMetrics | null,
  taskScore: number,
  projectScore: number | null
): { highlights: string[]; issues: string[] } {
  const highlights: string[] = [];
  const issues: string[] = [];

  // 任务级亮点
  if (taskLevel.firstPassRate >= 0.7) {
    highlights.push(`首次通过率 ${(taskLevel.firstPassRate * 100).toFixed(1)}%`);
  }
  if (taskLevel.humanInterventionRate === 0) {
    highlights.push('无需人工介入');
  }
  if (taskLevel.avgEvaluatorWeightedScore >= 0.8) {
    highlights.push(`平均评估分 ${(taskLevel.avgEvaluatorWeightedScore * 100).toFixed(0)}/100`);
  }

  // 任务级问题
  if (taskLevel.firstPassRate < 0.5) {
    issues.push(`首次通过率仅 ${(taskLevel.firstPassRate * 100).toFixed(1)}%`);
  }
  if (taskLevel.humanInterventionRate > 0.1) {
    issues.push(`${taskLevel.humanInterventionDetails.needsHuman} 个任务需人工介入`);
  }
  if (taskLevel.averageRetryCount > 1) {
    issues.push(`平均重试 ${taskLevel.averageRetryCount.toFixed(1)} 次`);
  }

  // 项目级亮点和问题
  if (projectLevel) {
    const allChecks: { name: string; result: CheckResult }[] = [
      { name: '构建', result: projectLevel.correctness.buildSuccess },
      { name: '测试', result: projectLevel.correctness.testPassRate },
      { name: '服务器', result: projectLevel.stability.devServerStartup },
      { name: '运行时', result: projectLevel.stability.runtimeNoCrash },
      { name: 'TS', result: projectLevel.quality.typeScriptErrors },
      { name: 'ESLint', result: projectLevel.quality.eslintIssues },
      { name: '安全', result: projectLevel.quality.auditVulnerabilities },
    ];

    for (const { name, result } of allChecks) {
      if (result.status === 'pass') {
        highlights.push(`${name}检查通过`);
      } else if (result.status === 'fail') {
        issues.push(`${name}: ${result.details || '未通过'}`);
      }
    }
  }

  return {
    highlights: highlights.slice(0, 5),
    issues: issues.slice(0, 5),
  };
}
