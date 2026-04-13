import path from 'path';
import fs from 'fs/promises';
import { Orchestrator } from '../core/orchestrator.js';
import { RunCommandOptions } from '../types/index.js';

/**
 * run 命令实现
 */
export async function runCommand(
  projectDir: string,
  options: RunCommandOptions
): Promise<void> {
  console.log('🏃 开始执行任务...\n');

  try {
    // 1. 解析项目目录路径
    const absolutePath = path.resolve(projectDir);
    console.log(`📁 项目目录：${absolutePath}`);

    // 2. 检查项目是否已初始化
    const harnessDir = path.join(absolutePath, '.harness');
    try {
      await fs.access(harnessDir);
    } catch {
      console.error('❌ 错误：项目未初始化');
      console.log('   请先运行：autorun-harness init <project-dir> --prd <prd-file>');
      process.exit(1);
    }

    // 3. 检查任务列表是否存在
    const tasksFile = path.join(harnessDir, 'tasks.json');
    try {
      await fs.access(tasksFile);
    } catch {
      console.error('❌ 错误：未找到任务列表文件');
      console.log('   请先运行：autorun-harness init <project-dir> --prd <prd-file>');
      process.exit(1);
    }

    // 4. 解析选项
    const maxTasks = options.maxTasks ? parseInt(options.maxTasks, 10) : 10;
    const maxTokens = options.maxTokens ? parseInt(options.maxTokens, 10) : undefined;

    console.log(`⚙️  配置：`);
    console.log(`   - 最大任务数：${maxTasks}`);
    if (maxTokens) {
      console.log(`   - Token 上限：${maxTokens.toLocaleString()}`);
    }
    console.log();

    // 5. 创建 Orchestrator 并执行
    const orchestrator = new Orchestrator(absolutePath);
    await orchestrator.run(maxTasks, maxTokens);

    // 6. 输出最终状态
    const status = await orchestrator.getStatus();
    if (status.isComplete) {
      console.log('\n✅ 项目已完成！');
    } else if (status.nextTask) {
      console.log(`\n⏸️  执行暂停，下一个任务：${status.nextTask.title}`);
    } else {
      console.log('\n⚠️  无法继续执行，请检查任务状态');
    }

  } catch (error) {
    console.error('\n❌ 执行失败：', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\n堆栈信息：', error.stack);
    }
    process.exit(1);
  }
}
