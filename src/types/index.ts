/**
 * 任务状态枚举
 */
export type TaskStatus = 
  | 'pending'      // 待处理
  | 'in_progress'  // 进行中
  | 'completed'    // 已完成
  | 'blocked'      // 被阻塞
  | 'needs_human'; // 需要人工介入

/**
 * 任务优先级
 */
export type TaskPriority = 'high' | 'medium' | 'low';

/**
 * 任务分类
 */
export type TaskCategory = 
  | 'functional'   // 功能性
  | 'style'        // 样式
  | 'performance'  // 性能
  | 'security'     // 安全
  | 'integration'; // 集成

/**
 * 验收标准步骤状态
 */
export type AcceptanceCriterionStatus = 'pending' | 'pass' | 'fail';

/**
 * 验收标准
 */
export interface AcceptanceCriterion {
  id: string;
  description: string;
  steps: string[];
  status: AcceptanceCriterionStatus;
}

/**
 * 任务定义
 */
export interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  dependencies: string[];
  /** 关键产出文件路径（相对项目根目录），用于依赖检查时验证代码是否已生成 */
  outputs?: string[];
  attempts: number;
  status: TaskStatus;
  assigned_to: string | null;
  completed_at: string | null;
  notes: string[];
}

/**
 * 任务列表
 */
export interface TaskList {
  project: {
    name: string;
    version: string;
    created_at: string;
  };
  tasks: Task[];
  statistics: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    blocked: number;
    needs_human: number;
  };
}

/**
 * 进度日志条目
 */
export interface ProgressEntry {
  timestamp: string;
  taskId: string;
  status: string;
  details?: string;
  errors?: string[];
}

/**
 * 评估报告 - 验收标准结果
 */
export interface CriterionResult {
  criterion_id: string;
  description: string;
  result: 'pass' | 'fail';
  details: Array<{
    step: number;
    action: string;
    status: 'pass' | 'fail' | 'pending';
    reason?: string;
    note?: string;
  }>;
}

/**
 * 质量评分
 */
export interface QualityScore {
  score: number;
  weight: number;
  weighted: number;
  comment: string;
  issues?: Array<{
    file: string;
    line: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }>;
}

/**
 * 评估报告
 */
export interface EvaluatorReport {
  report_id: string;
  task_id: string;
  attempt: number;
  timestamp: string;
  overall_result: 'pass' | 'fail';
  summary: string;
  criteria_results: CriterionResult[];
  quality_scores: {
    functionality: QualityScore;
    code_quality: QualityScore;
    product_depth: QualityScore;
    visual_design: QualityScore;
  };
  total_weighted_score: number;
  threshold: number;
  final_decision: 'pass' | 'fail';
  feedback_for_generator: string;
  screenshot_paths: string[];
  /** 标记此报告是否为评估器自身崩溃导致的（非代码问题） */
  evaluator_error?: boolean;
}

/**
 * 项目配置
 */
export interface ProjectConfig {
  name: string;
  description?: string;
  tech_stack?: {
    frontend?: string;
    backend?: string;
    database?: string;
    other?: string[];
  };
  constraints?: string[];
}

/**
 * Agent 类型
 */
export type AgentType = 'planner' | 'generator' | 'evaluator';

/**
 * 初始化模式
 */
export type InitMode = 'simple' | 'full';

/**
 * CLI 命令选项 - init
 */
export interface InitCommandOptions {
  prd?: string;
  json?: string;
  text?: string;
  name?: string;
  mode?: InitMode;      // 初始化模式，默认 'full'
  docs?: string;        // 文档目录路径（完整模式）
}

/**
 * CLI 命令选项 - run
 */
export interface RunCommandOptions {
  maxTasks?: string;
  maxTokens?: string;
  continue?: boolean;
}

// 导出质量保障相关类型
export * from './quality.js';

// 导出同步相关类型
export * from './sync.js';
