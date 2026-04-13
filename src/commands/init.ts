import fs from 'fs/promises';
import path from 'path';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { Orchestrator } from '../core/orchestrator.js';
import { InitCommandOptions, InitMode } from '../types/index.js';

const execPromise = promisify(execCallback);

/**
 * 收集已有文档
 */
async function collectExistingDocuments(docsDir: string): Promise<Record<string, string>> {
  const docs: Record<string, string> = {};

  try {
    const files = await fs.readdir(docsDir);

    for (const file of files) {
      const filePath = path.join(docsDir, file);
      const stat = await fs.stat(filePath);

      if (stat.isFile() && (file.endsWith('.md') || file.endsWith('.txt'))) {
        const content = await fs.readFile(filePath, 'utf-8');
        docs[file] = content;
        console.log(`   ✓ 已收集文档：${file}`);
      }
    }
  } catch (error) {
    // 目录不存在，返回空对象
  }

  return docs;
}

/**
 * init 命令实现
 */
export async function initCommand(
  projectDir: string,
  options: InitCommandOptions
): Promise<void> {
  console.log('🚀 初始化项目...\n');

  try {
    const absolutePath = path.resolve(projectDir);
    const mode: InitMode = (options.mode as InitMode) || 'full';  // 默认完整模式

    console.log(`📁 项目目录：${absolutePath}`);
    console.log(`🔧 初始化模式：${mode === 'simple' ? '简单模式' : '完整模式'}`);

    // 创建项目目录结构
    await fs.mkdir(absolutePath, { recursive: true });
    await fs.mkdir(path.join(absolutePath, '.harness'), { recursive: true });

    // 收集已有文档（完整模式需要）
    let existingDocs: Record<string, string> = {};
    let prdContent = '';
    let prdSource = '';

    if (mode === 'full') {
      // 完整模式：收集已有文档
      const docsDir = options.docs
        ? path.resolve(options.docs)
        : path.join(absolutePath, 'docs');

      // 确保 docs 目录存在
      await fs.mkdir(docsDir, { recursive: true });
      existingDocs = await collectExistingDocuments(docsDir);

      // 检查是否提供了必要的文档
      const hasDocs = Object.keys(existingDocs).length > 0 || options.prd;

      if (!hasDocs) {
        console.error('\n❌ 错误：完整模式需要提供文档\n');
        console.error('请使用以下方式之一：');
        console.error('  --prd <file>     提供 PRD 文档');
        console.error('  --docs <dir>     提供文档目录（包含 PRD.md 等）');
        console.error('');
        console.error('或使用简单模式：');
        console.error('  --mode simple --text "你的需求描述"');
        process.exit(1);
      }

      // 读取 PRD 内容
      if (options.prd) {
        console.log(`📄 读取 PRD 文档：${options.prd}`);
        prdContent = await fs.readFile(options.prd, 'utf-8');
        prdSource = options.prd;
      } else if (existingDocs['PRD.md']) {
        prdContent = existingDocs['PRD.md'];
        prdSource = 'docs/PRD.md';
        console.log(`📄 使用已有 PRD 文档：docs/PRD.md`);
      }

    } else {
      // 简单模式：原有逻辑
      if (options.prd) {
        console.log(`📄 读取 PRD 文档：${options.prd}`);
        prdContent = await fs.readFile(options.prd, 'utf-8');
        prdSource = options.prd;
      } else if (options.json) {
        console.log(`📄 读取 JSON/YAML 需求：${options.json}`);
        const jsonContent = await fs.readFile(options.json, 'utf-8');
        prdContent = `需求定义（JSON/YAML）：\n\`\`\`json\n${jsonContent}\n\`\`\``;
        prdSource = options.json;
      } else if (options.text) {
        console.log('📝 使用文本需求描述');
        prdContent = `用户需求：\n${options.text}`;
        prdSource = '文本输入';
      } else {
        console.error('❌ 错误：必须提供 --prd、--json 或 --text 其中之一');
        process.exit(1);
      }

      // 简单模式不创建 docs 目录
    }

    // 初始化 git 仓库
    console.log('📦 初始化 Git 仓库...');
    try {
      await execPromise('git init', { cwd: absolutePath });
      console.log('   ✓ Git 仓库初始化完成');
    } catch (error) {
      console.log('   ⚠️  Git 初始化跳过（可能已存在）');
    }

    // 调用 Orchestrator
    const orchestrator = new Orchestrator(absolutePath);
    await orchestrator.initialize(prdContent, options.name, {
      mode,
      existingDocs: mode === 'full' ? existingDocs : undefined,
      prdSource,
    });

    // 输出后续步骤
    console.log('\n📋 下一步：');
    if (mode === 'simple') {
      console.log(`   1. 检查规格文档：${absolutePath}/.harness/spec.md`);
      console.log(`   2. 检查任务列表：${absolutePath}/.harness/tasks.json`);
      console.log(`   3. 运行任务：autorun-harness run ${projectDir}`);
    } else {
      console.log(`   1. 检查文档索引：${absolutePath}/CLAUDE.md`);
      console.log(`   2. 检查完整文档：${absolutePath}/docs/`);
      console.log(`   3. 检查任务列表：${absolutePath}/.harness/tasks.json`);
      console.log(`   4. 运行任务：autorun-harness run ${projectDir}`);
    }

  } catch (error) {
    console.error('\n❌ 初始化失败：', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
