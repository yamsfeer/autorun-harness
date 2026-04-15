#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { EvaluateCommandOptions, EvaluationReport } from './types.js';
import { computeTaskLevelMetrics } from './task-level.js';
import { computeProjectLevelMetrics } from './project-level.js';
import { computeEvaluationSummary } from './summary.js';
import { writeReport, printReport } from './output.js';

const program = new Command();

program
  .name('harness-eval')
  .description('评估 autorun-harness 框架运行表现')
  .version('1.0.0');

program
  .command('evaluate')
  .description('评估指定项目的框架运行表现')
  .argument('<project-dir>', '项目目录路径')
  .option('--json', '仅输出 JSON（不打印人类可读的输出）')
  .option('--skip-layer2', '跳过项目级检查（构建、测试、lint 等）')
  .option('--dev-url <url>', '开发服务器 URL', 'http://localhost:3000')
  .option('--dev-timeout <seconds>', '开发服务器启动超时（秒）', '15')
  .action(evaluateCommand);

async function evaluateCommand(projectDir: string, options: EvaluateCommandOptions): Promise<void> {
  const absolutePath = path.resolve(projectDir);
  const harnessDir = path.join(absolutePath, '.harness');

  // 验证目录
  try {
    await fs.access(harnessDir);
  } catch {
    console.error(`错误：未找到 .harness 目录 (${harnessDir})`);
    console.error('请指定一个由 autorun-harness 初始化的项目目录');
    process.exit(1);
  }

  // 读取项目名
  let projectName = path.basename(absolutePath);
  try {
    const tasksContent = await fs.readFile(path.join(harnessDir, 'tasks.json'), 'utf-8');
    const tasks = JSON.parse(tasksContent);
    if (tasks.project?.name) {
      projectName = tasks.project.name;
    }
  } catch {
    // 使用目录名
  }

  // ===== 第一层 =====
  const taskLevel = await computeTaskLevelMetrics(harnessDir);

  // ===== 第二层 =====
  let projectLevel = null;
  if (!options.skipLayer2) {
    projectLevel = await computeProjectLevelMetrics(absolutePath, {
      devServerUrl: options.devUrl || 'http://localhost:3000',
      devServerTimeout: parseInt(options.devTimeout || '15', 10) * 1000,
    });
  }

  // ===== 总结 =====
  const summary = computeEvaluationSummary(taskLevel, projectLevel);

  // ===== 组装报告 =====
  const report: EvaluationReport = {
    version: '1.0.0',
    projectName,
    projectDir: absolutePath,
    timestamp: new Date().toISOString(),
    taskLevel,
    projectLevel,
    summary,
  };

  // ===== 输出 =====
  await writeReport(report, harnessDir);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

program.parse(process.argv);
