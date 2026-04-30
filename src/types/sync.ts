/**
 * 从文档中提取的结构化特征
 */
export interface DocFeature {
  docFile: string;
  featureType: DocFeatureType;
  name: string;
  section: string;
  details: Record<string, string>;
  line: number;
}

export type DocFeatureType =
  | 'api_route'
  | 'data_table'
  | 'ui_component'
  | 'ui_page'
  | 'prd_feature';

/**
 * 差异类型
 */
export type DiscrepancyType =
  | 'doc_without_task'
  | 'task_without_doc'
  | 'code_mismatch'
  | 'doc_changed';

/**
 * 差异项
 */
export interface SyncDiscrepancy {
  id: string;
  type: DiscrepancyType;
  severity: 'high' | 'medium' | 'low';
  description: string;
  docFeature?: DocFeature;
  relatedTaskId?: string;
  relatedCodePath?: string;
  autoFixable: boolean;
  fixAction?: FixAction;
}

/**
 * 修复动作
 */
export interface FixAction {
  type: 'add_task' | 'remove_task' | 'update_task' | 'mark_for_review' | 'generate_cleanup_task';
  description: string;
  payload?: Record<string, unknown>;
}

/**
 * 修复结果
 */
export interface SyncFixResult {
  discrepancyId: string;
  fixAction: FixAction;
  applied: boolean;
  result: 'success' | 'skipped' | 'failed';
  message: string;
}

/**
 * 同步报告
 */
export interface SyncReport {
  timestamp: string;
  projectDir: string;
  docsDir: string;
  mode: 'check' | 'fix';
  parsedFeatures: DocFeature[];
  discrepancies: SyncDiscrepancy[];
  fixes: SyncFixResult[];
  summary: SyncSummary;
}

export interface SyncSummary {
  totalFeatures: number;
  alignedFeatures: number;
  discrepancies: number;
  bySeverity: { high: number; medium: number; low: number };
  autoFixed: number;
  needsReview: number;
}

/**
 * CLI 命令选项 - sync
 */
export interface SyncCommandOptions {
  check?: boolean;
  fix?: boolean;
  docs?: string;
}

/**
 * SyncEngine 配置
 */
export interface SyncEngineOptions {
  checkOnly: boolean;
  autoFix: boolean;
  docsDir: string;
}
