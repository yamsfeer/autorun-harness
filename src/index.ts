#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { providerCommand } from './commands/provider.js';

const program = new Command();

program
  .name('autorun-harness')
  .description('长期运行代理框架 - 自动化软件开发')
  .version('1.0.0');

program
  .command('init')
  .description('初始化项目：读取 PRD，生成规格和任务列表')
  .argument('<project-dir>', '项目目录路径')
  .option('-p, --prd <file>', 'PRD 文档路径')
  .option('-n, --name <name>', '项目名称')
  .option('--json <file>', 'JSON/YAML 需求文件路径')
  .option('--text <text>', '口语化需求描述')
  .option('-m, --mode <mode>', '初始化模式：simple 或 full（默认）', 'full')
  .option('--docs <dir>', '文档目录路径（完整模式）')
  .action(initCommand);

program
  .command('run')
  .description('执行任务：循环处理任务直到完成')
  .argument('<project-dir>', '项目目录路径')
  .option('-m, --max-tasks <number>', '最大任务数', '10')
  .option('-t, --max-tokens <number>', 'Token 使用上限')
  .option('--continue', '从上次中断处继续')
  .action(runCommand);

program
  .command('provider')
  .description('管理 AI 服务提供商配置（全局配置）')
  .option('-l, --list', '列出所有提供商')
  .option('-a, --add', '添加新提供商')
  .option('-s, --switch <name>', '切换到指定提供商')
  .option('-r, --remove <name>', '删除指定提供商')
  .option('--name <name>', '提供商名称')
  .option('--token <token>', '认证 Token')
  .option('--url <url>', 'API Base URL')
  .option('--model <model>', '模型名称')
  .action(providerCommand);

// 解析命令行参数
program.parse(process.argv);
