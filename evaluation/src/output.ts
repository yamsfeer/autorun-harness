import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { EvaluationReport, TaskLevelMetrics, ProjectLevelMetrics, EvaluationSummary, CheckResult } from './types.js';

/**
 * 写入 JSON 报告文件
 */
export async function writeReport(report: EvaluationReport, harnessDir: string): Promise<void> {
  await fs.mkdir(harnessDir, { recursive: true });
  const reportPath = path.join(harnessDir, 'evaluation-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return;
}

/**
 * 打印人类可读的控制台输出
 */
export function printReport(report: EvaluationReport): void {
  console.log('');
  console.log(chalk.bold('  autorun-harness evaluate'));
  console.log(chalk.gray(`  项目: ${report.projectName}`));
  console.log(chalk.gray(`  目录: ${report.projectDir}`));
  console.log(chalk.gray(`  时间: ${report.timestamp}`));
  console.log('');

  // ===== 第一层 =====
  console.log(chalk.bold.cyan('  ═══ 第一层：任务级指标 ═══'));
  console.log('');

  const tl = report.taskLevel;
  console.log(`  首次通过率:       ${formatPercent(tl.firstPassRate)}  ${chalk.gray(`(${tl.firstPassDetails.firstPass}/${tl.firstPassDetails.totalCompleted})`)}`);
  console.log(`  平均重试次数:     ${formatNumber(tl.averageRetryCount)}`);
  console.log(`  人工介入率:       ${formatPercent(tl.humanInterventionRate)}  ${chalk.gray(`(${tl.humanInterventionDetails.needsHuman}/${tl.humanInterventionDetails.total})`)}`);
  console.log('');

  // Token 成本
  console.log(chalk.white('  Token 成本:'));
  console.log(`    总计:           ${formatTokens(tl.totalTokenCost.total)}`);
  const agentEntries = Object.entries(tl.perAgentTokenCost);
  if (agentEntries.length > 0) {
    const grandTotal = tl.totalTokenCost.total || 1;
    for (const [agent, cost] of agentEntries) {
      const pct = ((cost.total / grandTotal) * 100).toFixed(1);
      console.log(`    ${agent + ':'.padEnd(14)}${formatTokens(cost.total)} ${chalk.gray(`(${pct}%)`)}`);
    }
  }
  console.log('');

  console.log(`  平均评估分数:     ${formatScore(tl.avgEvaluatorWeightedScore)}`);

  // ===== 第二层 =====
  if (report.projectLevel) {
    console.log('');
    console.log(chalk.bold.cyan('  ═══ 第二层：项目级指标 ═══'));
    console.log('');

    const pl = report.projectLevel;

    console.log(chalk.white('  正确性:'));
    printCheckResult(pl.correctness.buildSuccess, '    ');
    printCheckResult(pl.correctness.testPassRate, '    ');
    console.log('');

    console.log(chalk.white('  稳定性:'));
    printCheckResult(pl.stability.devServerStartup, '    ');
    printCheckResult(pl.stability.runtimeNoCrash, '    ');
    console.log('');

    console.log(chalk.white('  质量:'));
    printCheckResult(pl.quality.typeScriptErrors, '    ');
    printCheckResult(pl.quality.eslintIssues, '    ');
    printCheckResult(pl.quality.auditVulnerabilities, '    ');
  } else {
    console.log('');
    console.log(chalk.gray('  第二层已跳过（使用 --skip-layer2）'));
  }

  // ===== 总结 =====
  console.log('');
  console.log(chalk.bold.cyan('  ═══ 总结 ═══'));
  console.log('');

  const summary = report.summary;
  console.log(`  综合评分:         ${chalk.bold(formatGrade(summary.grade))}  ${chalk.white(`${summary.overallScore}/100`)}`);
  console.log(`  任务级评分:       ${summary.taskLevelScore}/100`);
  if (summary.projectLevelScore !== null) {
    console.log(`  项目级评分:       ${summary.projectLevelScore}/100`);
  }
  console.log('');

  if (summary.highlights.length > 0) {
    console.log(chalk.green('  亮点:'));
    for (const h of summary.highlights) {
      console.log(chalk.green(`    + ${h}`));
    }
  }

  if (summary.issues.length > 0) {
    console.log(chalk.red('  问题:'));
    for (const i of summary.issues) {
      console.log(chalk.red(`    - ${i}`));
    }
  }

  console.log('');
  console.log(chalk.gray(`  报告已保存: ${report.projectDir}/.harness/evaluation-report.json`));
  console.log('');
}

// ===== 格式化工具 =====

function formatPercent(value: number): string {
  const pct = (value * 100).toFixed(1);
  if (value >= 0.7) return chalk.green(`${pct}%`);
  if (value >= 0.4) return chalk.yellow(`${pct}%`);
  return chalk.red(`${pct}%`);
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function formatTokens(count: number): string {
  return count.toLocaleString() + ' tokens';
}

function formatScore(score: number): string {
  if (score >= 0.75) return chalk.green(score.toFixed(2));
  if (score >= 0.5) return chalk.yellow(score.toFixed(2));
  return chalk.red(score.toFixed(2));
}

function formatGrade(grade: string): string {
  switch (grade) {
    case 'A': return chalk.green('A');
    case 'B': return chalk.cyan('B');
    case 'C': return chalk.yellow('C');
    case 'D': return chalk.red('D');
    default: return chalk.red('F');
  }
}

function printCheckResult(result: CheckResult, indent: string): void {
  const statusStr = formatStatus(result.status);
  const name = result.name.padEnd(14, ' ');
  let line = `${indent}${name}${statusStr}`;

  if (result.details) {
    line += `  ${chalk.gray(result.details)}`;
  }

  console.log(line);
}

function formatStatus(status: string): string {
  switch (status) {
    case 'pass': return chalk.green('PASS');
    case 'fail': return chalk.red('FAIL');
    case 'skipped': return chalk.gray('SKIP');
    case 'error': return chalk.yellow('ERR ');
    default: return status;
  }
}
