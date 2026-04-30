import path from 'path';
import fs from 'fs/promises';
import { SyncEngine } from '../core/sync-engine.js';
import { SyncCommandOptions } from '../types/index.js';

/**
 * sync 命令实现
 * 将 docs/ 作为唯一事实来源，检测并修复文档与 tasks/代码的不一致
 */
export async function syncCommand(
  projectDir: string,
  options: SyncCommandOptions
): Promise<void> {
  try {
    // 1. 解析项目目录
    const absolutePath = path.resolve(projectDir);
    console.log(`📁 项目目录：${absolutePath}\n`);

    // 2. 检查项目是否已初始化
    const harnessDir = path.join(absolutePath, '.harness');
    try {
      await fs.access(harnessDir);
    } catch {
      console.error('❌ 错误：项目未初始化');
      console.log('   请先运行：autorun-harness init <project-dir> --prd <prd-file>');
      process.exit(1);
    }

    // 3. 确定模式
    const mode = options.fix ? 'fix' : 'check';
    const docsDir = options.docs || 'docs';

    console.log(`📋 同步模式：${mode === 'fix' ? '修复' : '检查'}`);
    console.log(`📂 文档目录：${path.join(absolutePath, docsDir)}\n`);

    // 4. 执行同步
    const engine = new SyncEngine(absolutePath, {
      checkOnly: !options.fix,
      autoFix: !!options.fix,
      docsDir,
    });

    console.log('🔍 正在分析文档和任务...\n');
    const report = await engine.sync();

    // 5. 输出报告
    printReport(report);

    // 6. 退出码：有严重不一致时非零
    if (report.summary.bySeverity.high > 0 && mode === 'check') {
      console.log('\n💡 提示：使用 --fix 自动修复可处理的问题');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ 同步失败：', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function printReport(report: import('../types/index.js').SyncReport): void {
  const { summary, discrepancies, fixes } = report;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 同步报告');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`📄 解析文档特征：${summary.totalFeatures} 个`);
  console.log(`✅ 已对齐特征：${summary.alignedFeatures} 个`);
  console.log(`⚠️  发现差异：${summary.discrepancies} 个`);
  console.log(`   🔴 严重：${summary.bySeverity.high}`);
  console.log(`   🟡 中等：${summary.bySeverity.medium}`);
  console.log(`   🟢 轻微：${summary.bySeverity.low}`);

  if (report.mode === 'fix') {
    console.log(`\n🔧 修复结果：`);
    console.log(`   ✅ 已自动修复：${summary.autoFixed}`);
    console.log(`   👁️  需要人工审查：${summary.needsReview}`);
  }

  if (discrepancies.length > 0) {
    console.log('\n' + '─'.repeat(50));
    console.log('差异详情：\n');

    for (const disc of discrepancies) {
      const icon = disc.severity === 'high' ? '🔴' : disc.severity === 'medium' ? '🟡' : '🟢';
      const typeLabel = typeLabels[disc.type] || disc.type;
      console.log(`${icon} [${typeLabel}] ${disc.description}`);
      if (disc.fixAction) {
        const applied = fixes.find(f => f.discrepancyId === disc.id);
        if (applied?.applied) {
          console.log(`   ✅ 已修复: ${disc.fixAction.description}`);
        } else if (disc.autoFixable) {
          console.log(`   🔧 可自动修复: ${disc.fixAction.description}`);
        } else {
          console.log(`   👁️  需要人工审查: ${disc.fixAction.description}`);
        }
      }
      console.log();
    }
  } else {
    console.log('\n✨ 文档与任务完全一致，无需同步！');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

const typeLabels: Record<string, string> = {
  doc_without_task: '文档未列入任务',
  task_without_doc: '任务缺少文档依据',
  code_mismatch: '代码不匹配',
  doc_changed: '文档已变更',
};
