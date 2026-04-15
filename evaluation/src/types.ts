/**
 * 评估系统类型定义
 */

// ===== 基础类型 =====

export type CheckStatus = 'pass' | 'fail' | 'skipped' | 'error';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  value: number | string | boolean;
  details?: string;
  error?: string;
  durationMs: number;
}

// ===== 第一层：任务级指标 =====

export interface TaskLevelMetrics {
  firstPassRate: number;
  firstPassDetails: { firstPass: number; totalCompleted: number };
  averageRetryCount: number;
  retryDetails: { totalAttempts: number; completedCount: number };
  humanInterventionRate: number;
  humanInterventionDetails: { needsHuman: number; total: number };
  perAgentTokenCost: Record<string, { inputTokens: number; outputTokens: number; total: number }>;
  perTaskTokenCost: Record<string, { inputTokens: number; outputTokens: number; total: number; taskTitle?: string }>;
  totalTokenCost: { inputTokens: number; outputTokens: number; total: number };
  avgEvaluatorWeightedScore: number;
  evaluatorScoreDetails: { totalScore: number; reportCount: number };
}

// ===== 第二层：项目级指标 =====

export interface CorrectnessMetrics {
  buildSuccess: CheckResult;
  testPassRate: CheckResult;
}

export interface StabilityMetrics {
  devServerStartup: CheckResult;
  runtimeNoCrash: CheckResult;
}

export interface QualityMetrics {
  typeScriptErrors: CheckResult;
  eslintIssues: CheckResult;
  auditVulnerabilities: CheckResult;
}

export interface ProjectLevelMetrics {
  correctness: CorrectnessMetrics;
  stability: StabilityMetrics;
  quality: QualityMetrics;
}

// ===== 总结 =====

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface EvaluationSummary {
  overallScore: number;
  taskLevelScore: number;
  projectLevelScore: number | null;
  grade: Grade;
  highlights: string[];
  issues: string[];
}

// ===== 完整报告 =====

export interface EvaluationReport {
  version: string;
  projectName: string;
  projectDir: string;
  timestamp: string;
  taskLevel: TaskLevelMetrics;
  projectLevel: ProjectLevelMetrics | null;
  summary: EvaluationSummary;
}

// ===== CLI 选项 =====

export interface EvaluateCommandOptions {
  json?: boolean;
  skipLayer2?: boolean;
  devUrl?: string;
  devTimeout?: string;
}
