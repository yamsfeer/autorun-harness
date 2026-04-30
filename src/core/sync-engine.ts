import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { StateManager } from './state-manager.js';
import {
  DocFeature,
  DocFeatureType,
  SyncDiscrepancy,
  FixAction,
  SyncFixResult,
  SyncReport,
  SyncSummary,
  SyncEngineOptions,
  Task,
  TaskList,
} from '../types/index.js';

let discrepancyCounter = 0;

function nextDiscrepancyId(): string {
  discrepancyCounter += 1;
  return `DISC-${String(discrepancyCounter).padStart(3, '0')}`;
}

/**
 * SyncEngine — 将 docs/ 作为唯一事实来源，检测文档与 tasks/代码的一致性问题并自动修正。
 */
export class SyncEngine {
  private projectDir: string;
  private docsDir: string;
  private stateManager: StateManager;
  private options: SyncEngineOptions;

  constructor(projectDir: string, options: SyncEngineOptions) {
    this.projectDir = projectDir;
    this.docsDir = path.resolve(projectDir, options.docsDir);
    this.stateManager = new StateManager(projectDir);
    this.options = options;
  }

  /**
   * 主入口：执行同步检查 / 修复
   */
  async sync(): Promise<SyncReport> {
    const mode = this.options.autoFix ? 'fix' : 'check';

    // 步骤 1：解析文档特征
    const parsedFeatures = await this.parseDocs();

    // 步骤 2：加载任务
    const tasks = await this.parseTasks();

    // 步骤 3：比较差异
    const discrepancies = this.compare(parsedFeatures, tasks);

    // 步骤 4 & 5：生成和（可选）应用修复
    const fixes = await this.generateAndApplyFixes(discrepancies, tasks, mode);

    // 计算摘要
    const summary = this.buildSummary(parsedFeatures, discrepancies, fixes);

    const report: SyncReport = {
      timestamp: new Date().toISOString(),
      projectDir: this.projectDir,
      docsDir: this.docsDir,
      mode,
      parsedFeatures,
      discrepancies,
      fixes,
      summary,
    };

    return report;
  }

  // ─── 步骤 1：解析文档 ────────────────────────────────────────────

  async parseDocs(): Promise<DocFeature[]> {
    const features: DocFeature[] = [];

    try {
      await fs.access(this.docsDir);
    } catch {
      return features; // docs 目录不存在，返回空
    }

    const files = await this.walkDocs();
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const extracted = this.extractFeatures(file, content);
        features.push(...extracted);
      } catch {
        // skip unreadable files
      }
    }

    return features;
  }

  private async walkDocs(dir?: string): Promise<string[]> {
    const target = dir || this.docsDir;
    const results: string[] = [];
    let entries;

    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.walkDocs(fullPath);
        results.push(...sub);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }

    return results;
  }

  private extractFeatures(filePath: string, content: string): DocFeature[] {
    const features: DocFeature[] = [];
    const relativePath = path.relative(this.projectDir, filePath);
    const lines = content.split('\n');

    let currentSection = '';
    let lineIndex = 0;

    for (const line of lines) {
      lineIndex += 1;

      // 追踪当前 section（## 标题）
      const h2 = line.match(/^##\s+(.+)/);
      if (h2) {
        currentSection = h2[1].trim();
        features.push({
          docFile: relativePath,
          featureType: 'prd_feature',
          name: currentSection,
          section: currentSection,
          details: { type: 'section' },
          line: lineIndex,
        });
        continue;
      }

      // API 路由：`METHOD /path`
      const apiRoute = line.match(/`(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s`]+)`/i);
      if (apiRoute) {
        const method = apiRoute[1].toUpperCase();
        const route = apiRoute[2];
        features.push({
          docFile: relativePath,
          featureType: 'api_route',
          name: `${method} ${route}`,
          section: currentSection,
          details: { method, route },
          line: lineIndex,
        });
        continue;
      }

      // API 路由：**GET /path** 或 **POST /path**
      const boldApi = line.match(/\*\*(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\*]+)\*\*/i);
      if (boldApi) {
        const method = boldApi[1].toUpperCase();
        const route = boldApi[2].trim();
        features.push({
          docFile: relativePath,
          featureType: 'api_route',
          name: `${method} ${route}`,
          section: currentSection,
          details: { method, route },
          line: lineIndex,
        });
        continue;
      }

      // 数据表/模型：### 下的表名定义 或 `table_name` 模式
      const tableDef = line.match(/^###\s+(.+)/);
      if (tableDef && currentSection) {
        const name = tableDef[1].trim();
        const lower = name.toLowerCase();
        if (
          lower.includes('table') ||
          lower.includes('model') ||
          lower.includes('schema') ||
          lower.includes('entity') ||
          lower.includes('表') ||
          lower.includes('模型')
        ) {
          features.push({
            docFile: relativePath,
            featureType: 'data_table',
            name,
            section: currentSection,
            details: { type: 'data_table' },
            line: lineIndex,
          });
        }
        continue;
      }

      // UI 组件：从 ### 标题或表格行中提取
      const componentDef = line.match(/\*\*([^*]+)\*\*/);
      if (componentDef && /component|组件|page|页面/i.test(currentSection)) {
        const name = componentDef[1].trim();
        if (name.length < 80) {
          features.push({
            docFile: relativePath,
            featureType: 'ui_component',
            name,
            section: currentSection,
            details: { type: 'ui_component' },
            line: lineIndex,
          });
        }
      }
    }

    // 额外检测：markdown 表格中的 API 路由
    const tableRouteRegex = /\|\s*(GET|POST|PUT|DELETE|PATCH)\s+\|\s*`?(\/[^\s|`]+)`?\s*\|/gi;
    let match;
    while ((match = tableRouteRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const route = match[2];
      const alreadyExists = features.some(
        f => f.featureType === 'api_route' && f.name === `${method} ${route}`
      );
      if (!alreadyExists) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        features.push({
          docFile: relativePath,
          featureType: 'api_route',
          name: `${method} ${route}`,
          section: currentSection || 'API',
          details: { method, route },
          line: lineNum,
        });
      }
    }

    return features;
  }

  // ─── 步骤 2：解析任务 ────────────────────────────────────────────

  async parseTasks(): Promise<TaskList> {
    return this.stateManager.loadTasks();
  }

  // ─── 步骤 3：比较差异 ────────────────────────────────────────────

  compare(docFeatures: DocFeature[], tasks: TaskList): SyncDiscrepancy[] {
    const discrepancies: SyncDiscrepancy[] = [];
    const taskList = tasks.tasks;

    // 检查 1：doc_without_task — 文档中有，任务中没有
    for (const feature of docFeatures) {
      const matchingTask = this.findMatchingTask(feature, taskList);
      if (!matchingTask) {
        discrepancies.push({
          id: nextDiscrepancyId(),
          type: 'doc_without_task',
          severity: this.severityForFeature(feature),
          description: `文档 "${feature.docFile}:${feature.line}" 描述了 "${feature.name}" (${feature.featureType})，但 tasks.json 中没有对应任务`,
          docFeature: feature,
          autoFixable: true,
          fixAction: {
            type: 'add_task',
            description: `为 "${feature.name}" 生成新任务`,
            payload: { featureName: feature.name, featureType: feature.featureType, section: feature.section },
          },
        });
      }
    }

    // 检查 2：task_without_doc — 任务中有，文档中没有
    for (const task of taskList) {
      const matchingFeature = this.findMatchingFeature(task, docFeatures);
      if (!matchingFeature) {
        const isCompleted = task.status === 'completed';
        discrepancies.push({
          id: nextDiscrepancyId(),
          type: 'task_without_doc',
          severity: isCompleted ? 'medium' : 'low',
          description: `tasks.json 中的 "${task.title}" (${task.id}) 在文档中没有对应描述`,
          relatedTaskId: task.id,
          autoFixable: isCompleted, // 只有已完成的才能安全删除
          fixAction: isCompleted
            ? {
                type: 'remove_task',
                description: `移除已完成且文档中不再提及的任务 "${task.title}" (${task.id})`,
                payload: { taskId: task.id, taskTitle: task.title },
              }
            : {
                type: 'mark_for_review',
                description: `任务 "${task.title}" (${task.id}) 在文档中无对应，但尚未完成，需要人工确认`,
                payload: { taskId: task.id },
              },
        });
      }
    }

    // 检查 3：doc_changed — 已完成任务的验收标准与文档描述不一致（轻量检查）
    for (const task of taskList.filter(t => t.status === 'completed')) {
      const matchingFeature = this.findMatchingFeature(task, docFeatures);
      if (matchingFeature) {
        const acMismatch = this.checkAcceptanceCriteriaMismatch(task, matchingFeature);
        if (acMismatch) {
          discrepancies.push({
            id: nextDiscrepancyId(),
            type: 'doc_changed',
            severity: 'medium',
            description: `已完成的 "${task.title}" (${task.id}) 验收标准与文档 "${matchingFeature.docFile}:${matchingFeature.line}" 不一致`,
            docFeature: matchingFeature,
            relatedTaskId: task.id,
            autoFixable: true,
            fixAction: {
              type: 'update_task',
              description: `根据文档更新 "${task.title}" 的验收标准`,
              payload: { taskId: task.id, featureName: matchingFeature.name },
            },
          });
        }
      }
    }

    // 检查 4：code_mismatch — 已完成任务缺少产出文件
    for (const task of taskList.filter(t => t.status === 'completed')) {
      if (task.outputs && task.outputs.length > 0) {
        const missing = task.outputs.filter(o => !fsSync.existsSync(path.join(this.projectDir, o)));
        if (missing.length > 0) {
          discrepancies.push({
            id: nextDiscrepancyId(),
            type: 'code_mismatch',
            severity: 'high',
            description: `已完成任务 "${task.title}" (${task.id}) 的产出文件缺失: ${missing.join(', ')}`,
            relatedTaskId: task.id,
            relatedCodePath: missing[0],
            autoFixable: false,
            fixAction: {
              type: 'generate_cleanup_task',
              description: `为缺失文件 "${missing.join(', ')}" 生成补充任务`,
              payload: { taskId: task.id, missingFiles: missing },
            },
          });
        }
      }
    }

    return discrepancies;
  }

  private findMatchingTask(feature: DocFeature, tasks: Task[]): Task | undefined {
    const featureKeywords = this.extractKeywords(feature.name);
    if (featureKeywords.length === 0) return undefined;

    return tasks.find(task => {
      const taskText = `${task.title} ${task.description}`.toLowerCase();
      // 至少一半的关键词出现在任务标题或描述中
      const matchCount = featureKeywords.filter(kw => taskText.includes(kw));
      return matchCount.length >= Math.ceil(featureKeywords.length / 2);
    });
  }

  private findMatchingFeature(task: Task, features: DocFeature[]): DocFeature | undefined {
    const taskKeywords = this.extractKeywords(task.title);
    if (taskKeywords.length === 0) return undefined;

    return features.find(feature => {
      const featureText = `${feature.name} ${feature.section} ${Object.values(feature.details).join(' ')}`.toLowerCase();
      const matchCount = taskKeywords.filter(kw => featureText.includes(kw));
      return matchCount.length >= Math.ceil(taskKeywords.length / 2);
    });
  }

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[`*_#\[\]()]/g, '')
      .split(/[\s\-/:,.]+/)
      .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  }

  private checkAcceptanceCriteriaMismatch(task: Task, feature: DocFeature): boolean {
    // 轻量检查：文档关键描述是否出现在验收标准中
    const detailsText = Object.values(feature.details).join(' ').toLowerCase();
    if (detailsText.length < 5) return false;

    const acText = task.acceptance_criteria.map(ac => ac.description.toLowerCase()).join(' ');
    const keywords = this.extractKeywords(detailsText);
    if (keywords.length === 0) return false;

    const matchCount = keywords.filter(kw => acText.includes(kw));
    return matchCount.length < Math.ceil(keywords.length / 2);
  }

  private severityForFeature(feature: DocFeature): 'high' | 'medium' | 'low' {
    if (feature.featureType === 'api_route' || feature.featureType === 'data_table') return 'high';
    if (feature.featureType === 'ui_page') return 'medium';
    return 'low';
  }

  // ─── 步骤 4 & 5：生成并应用修复 ───────────────────────────────────

  private async generateAndApplyFixes(
    discrepancies: SyncDiscrepancy[],
    tasks: TaskList,
    mode: 'check' | 'fix'
  ): Promise<SyncFixResult[]> {
    const results: SyncFixResult[] = [];

    for (const disc of discrepancies) {
      if (!disc.fixAction) continue;

      const result: SyncFixResult = {
        discrepancyId: disc.id,
        fixAction: disc.fixAction,
        applied: false,
        result: 'skipped',
        message: mode === 'check' ? '检查模式，跳过修复' : '',
      };

      if (mode === 'fix' && disc.autoFixable) {
        try {
          await this.applySingleFix(disc, tasks);
          result.applied = true;
          result.result = 'success';
          result.message = `已应用: ${disc.fixAction.description}`;
        } catch (err) {
          result.result = 'failed';
          result.message = `修复失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      results.push(result);
    }

    return results;
  }

  private async applySingleFix(discrepancy: SyncDiscrepancy, tasks: TaskList): Promise<void> {
    const action = discrepancy.fixAction!;

    switch (action.type) {
      case 'add_task': {
        const payload = action.payload || {};
        const featureName = String(payload.featureName || discrepancy.docFeature?.name || 'New Feature');
        const featureType = String(payload.featureType || 'prd_feature');
        const section = String(payload.section || '');

        const newTask = this.createTaskFromFeature(featureName, featureType, section, tasks);
        tasks.tasks.push(newTask);
        break;
      }

      case 'remove_task': {
        const taskId = String(action.payload?.taskId || discrepancy.relatedTaskId || '');
        const idx = tasks.tasks.findIndex(t => t.id === taskId);
        if (idx >= 0) {
          tasks.tasks.splice(idx, 1);
        }
        break;
      }

      case 'update_task': {
        const taskId = String(action.payload?.taskId || discrepancy.relatedTaskId || '');
        const task = tasks.tasks.find(t => t.id === taskId);
        if (task && discrepancy.docFeature) {
          task.status = 'pending';
          task.attempts = 0;
          task.acceptance_criteria = this.buildAcceptanceCriteria(discrepancy.docFeature);
        }
        break;
      }

      case 'mark_for_review':
      case 'generate_cleanup_task': {
        // 不自动处理，留在报告中供用户查看
        break;
      }
    }

    // 保存修改
    this.updateStatistics(tasks);
    await this.stateManager.saveTasks(tasks);
  }

  private createTaskFromFeature(
    name: string,
    featureType: string,
    section: string,
    tasks: TaskList
  ): Task {
    const id = this.generateTaskId(tasks);
    const category = this.categoryForFeatureType(featureType);

    return {
      id,
      title: name,
      category,
      priority: 'medium',
      description: `根据文档自动生成: ${section} — ${name} (${featureType})`,
      acceptance_criteria: [
        {
          id: `${id}-AC001`,
          description: `实现 ${name}`,
          steps: [`根据 docs/ 中的文档描述实现 ${name}`],
          status: 'pending',
        },
      ],
      dependencies: [],
      attempts: 0,
      status: 'pending',
      assigned_to: null,
      completed_at: null,
      notes: [`[sync] 由同步引擎自动生成，来源: ${featureType}`],
    };
  }

  private buildAcceptanceCriteria(feature: DocFeature) {
    return [
      {
        id: `AC-${feature.name.slice(0, 20).replace(/\s/g, '-')}`,
        description: `根据文档更新: ${feature.name}`,
        steps: [`按照 docs/ 中 "${feature.section}" 的描述验证 ${feature.name}`],
        status: 'pending' as const,
      },
    ];
  }

  private generateTaskId(tasks: TaskList): string {
    const existing = tasks.tasks.map(t => {
      const match = t.id.match(/^T(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return `T${String(max + 1).padStart(3, '0')}`;
  }

  private categoryForFeatureType(featureType: string): Task['category'] {
    switch (featureType) {
      case 'api_route': return 'functional';
      case 'data_table': return 'functional';
      case 'ui_component': return 'style';
      case 'ui_page': return 'style';
      default: return 'functional';
    }
  }

  private updateStatistics(tasks: TaskList): void {
    tasks.statistics = {
      total: tasks.tasks.length,
      pending: tasks.tasks.filter(t => t.status === 'pending').length,
      in_progress: tasks.tasks.filter(t => t.status === 'in_progress').length,
      completed: tasks.tasks.filter(t => t.status === 'completed').length,
      blocked: tasks.tasks.filter(t => t.status === 'blocked').length,
      needs_human: tasks.tasks.filter(t => t.status === 'needs_human').length,
    };
  }

  // ─── 摘要 ────────────────────────────────────────────────────────

  private buildSummary(
    features: DocFeature[],
    discrepancies: SyncDiscrepancy[],
    fixes: SyncFixResult[]
  ): SyncSummary {
    const bySeverity = { high: 0, medium: 0, low: 0 };
    for (const d of discrepancies) {
      bySeverity[d.severity] += 1;
    }

    return {
      totalFeatures: features.length,
      alignedFeatures: features.length - discrepancies.filter(d => d.type === 'doc_without_task').length,
      discrepancies: discrepancies.length,
      bySeverity,
      autoFixed: fixes.filter(f => f.applied && f.result === 'success').length,
      needsReview: discrepancies.filter(d => !d.autoFixable).length,
    };
  }
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'and', 'but', 'or', 'not', 'no', 'if', 'then', 'else', 'when',
  'this', 'that', 'these', 'those', 'it', 'its', 'we', 'you', 'they',
  'he', 'she', 'his', 'her', 'their', 'our', 'my', 'your',
  '也', '的', '是', '了', '在', '和', '就', '都', '而', '及',
  '与', '着', '或', '一个', '没有', '我们', '你们', '他们', '它们',
  '这个', '那个', '这些', '那些', '什么', '哪个', '怎么', '如何',
  '因为', '所以', '但是', '虽然', '如果', '可以', '需要', '应该',
]);
