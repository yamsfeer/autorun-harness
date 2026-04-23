#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { providerCommand } from './commands/provider.js';

const program = new Command();

program
  .name('autorun-harness')
  .description('长期运行代理框架 — 从需求文档到可运行代码的全自动软件开发')
  .version('1.0.0')
  .usage('<command> [options]')
  .addHelpText('after', `
典型工作流:
  $ autorun-harness init ./my-app --prd PRD.md   # 从 PRD 初始化项目
  $ autorun-harness run ./my-app                  # 自动执行任务直到完成
  $ autorun-harness provider --list               # 查看当前 AI 提供商配置

文档:
  https://github.com/yamsfeer/autorun-harness
`);

program
  .command('init')
  .description('初始化项目：读取需求文档，生成规格说明和任务列表')
  .argument('<project-dir>', '项目目录路径（不存在会自动创建）')
  .option('-p, --prd <file>', 'PRD 文档路径（Markdown 格式）')
  .option('-n, --name <name>', '项目名称（默认使用目录名）')
  .option('--json <file>', 'JSON/YAML 需求文件路径（简单模式）')
  .option('--text <text>', '口语化需求描述（简单模式）')
  .option('-m, --mode <mode>', '初始化模式：simple | full（默认: full）', 'full')
  .option('--docs <dir>', '已有文档目录路径（完整模式，默认: <project-dir>/docs）')
  .addHelpText('after', `
模式说明:
  full    完整模式（默认）— 收集已有文档，生成 CLAUDE.md 索引和完整规格
          需要提供 --prd 或 --docs 指向包含 PRD.md 的目录

  simple  简单模式 — 直接从 PRD/JSON/文本生成规格和任务
          使用 --prd、--json 或 --text 提供需求

示例:
  $ autorun-harness init ./my-app --prd ./PRD.md
  $ autorun-harness init ./my-app --docs ./docs --name "我的项目"
  $ autorun-harness init ./my-app --mode simple --text "做一个待办事项应用"
  $ autorun-harness init ./my-app --mode simple --json requirements.json
`)
  .action(initCommand);

program
  .command('run')
  .description('执行任务：循环处理任务列表中的待办任务直到完成或达到上限')
  .argument('<project-dir>', '已初始化的项目目录路径')
  .option('-m, --max-tasks <number>', '最大执行任务数（默认: 10）', '10')
  .option('-t, --max-tokens <number>', 'Token 使用上限（超出则暂停）')
  .option('--continue', '从上次中断处继续执行')
  .addHelpText('after', `
示例:
  $ autorun-harness run ./my-app                        # 执行最多 10 个任务
  $ autorun-harness run ./my-app --max-tasks 20         # 执行最多 20 个任务
  $ autorun-harness run ./my-app --max-tokens 100000    # Token 上限 100k
  $ autorun-harness run ./my-app --continue             # 从中断处继续
`)
  .action(runCommand);

program
  .command('provider')
  .description('管理 AI 服务提供商配置（全局配置，所有项目共享）')
  .option('-l, --list', '列出所有已配置的提供商')
  .option('-a, --add', '添加新的提供商（需配合 --name/--token/--url/--model）')
  .option('-s, --switch <name>', '切换到指定提供商')
  .option('-r, --remove <name>', '删除指定提供商')
  .option('--name <name>', '提供商名称（添加时必填）')
  .option('--token <token>', '认证 Token（添加时必填）')
  .option('--url <url>', 'API Base URL（添加时必填）')
  .option('--model <model>', '模型名称（添加时必填）')
  .addHelpText('after', `
子命令:
  --list              显示所有提供商及当前激活项
  --add               添加提供商（需要 --name, --token, --url, --model 四项）
  --switch <name>     切换到指定提供商
  --remove <name>     删除指定提供商配置
  （无参数）            等同于 --list

示例:
  $ autorun-harness provider --list
  $ autorun-harness provider --add --name glm-1 --token "xxx" --url "https://open.bigmodel.cn/api/anthropic" --model "GLM-4.7"
  $ autorun-harness provider --switch glm-1
  $ autorun-harness provider --remove glm-1
`)
  .action(providerCommand);

program.showHelpAfterError('(使用 --help 查看详细用法)');
program.showSuggestionAfterError(true);

program.parse(process.argv);
