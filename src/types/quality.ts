/**
 * 质量保障模块类型定义
 */

// ============ 日志系统 ============

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;      // 模块名：orchestrator, generator, evaluator 等
  message: string;
  data?: Record<string, any>;  // 附加数据
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  level: LogLevel;
  console: boolean;      // 是否输出到控制台
  file: boolean;         // 是否输出到文件
  filePath?: string;     // 日志文件路径
}

// ============ 错误处理 ============

export type ErrorType =
  | 'network'           // 网络错误
  | 'api_timeout'       // API 超时
  | 'api_error'         // API 返回错误
  | 'rate_limit'        // 频率限制 (429)
  | 'usage_limit'       // 用量限制（日/周额度用尽）
  | 'agent_error'       // Agent 执行错误
  | 'validation_error'  // 验证错误
  | 'file_error'        // 文件操作错误
  | 'unknown';          // 未知错误

export interface AppError extends Error {
  type: ErrorType;
  code?: string;
  retryable: boolean;    // 是否可重试
  shouldExit: boolean;   // 是否应该退出当前实例
  context?: Record<string, any>;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;     // 基础延迟（毫秒）
  maxDelay: number;      // 最大延迟
  backoffMultiplier: number;  // 退避乘数
}

// ============ 成本追踪 ============

export interface CostEntry {
  timestamp: string;
  sessionId: string;
  taskId?: string;
  agent: 'planner' | 'generator' | 'evaluator';
  model: string;
  inputTokens: number;
  outputTokens: number;
  // 估算成本（可选，用于参考）
  estimatedCostUsd?: number;
}

export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  byAgent: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
  byTask: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
}

export interface BudgetConfig {
  maxTotalTokens?: number;    // 总 Token 预算上限
  maxTaskTokens?: number;     // 单任务 Token 上限
  warnThreshold: number;      // 警告阈值（百分比）
}

// ============ 错误收集 ============

export interface AcceptanceCriterionFailure {
  criterionId: string;
  description: string;
  failedStep?: number;
  failedStepDescription?: string;
  reason?: string;
}

export interface FailureRecord {
  id: string;
  timestamp: string;

  // 任务详情
  taskId: string;
  taskTitle: string;
  taskCategory: string;
  taskPriority: string;
  attempt: number;

  // 错误信息
  errorType: ErrorType;
  errorMessage: string;
  errorStack?: string;

  // 验收标准失败详情
  acceptanceCriteriaFailures: AcceptanceCriterionFailure[];

  // 上下文
  affectedFiles?: string[];         // 涉及的文件
  agentPhase: 'planning' | 'generation' | 'evaluation';

  // 恢复记录
  recoveryAttempts: RecoveryAttempt[];
  resolution?: {
    timestamp: string;
    solution: string;
    success: boolean;
    fixedBy?: 'auto' | 'human';     // 谁修复的
  };
}

export interface RecoveryAttempt {
  timestamp: string;
  action: string;
  result: 'success' | 'fail' | 'needs_human';
  details?: string;
}

export interface FailurePattern {
  pattern: string;           // 错误模式描述
  occurrences: number;       // 出现次数
  lastSeen: string;
  suggestedSolution?: string;
}

// ============ 通知系统 ============

export interface NotificationConfig {
  enabled: boolean;
  type: 'webhook' | 'email' | 'console';
  webhookUrl?: string;
  emailRecipients?: string[];
}

export interface NotificationPayload {
  type: 'needs_human' | 'budget_exceeded' | 'project_complete' | 'error';
  projectId: string;
  taskId?: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

// ============ 多服务提供商配置 ============

export type ProviderStatus = 'active' | 'rate_limited' | 'available' | 'unavailable';

export interface AIProvider {
  name: string;              // 提供商名称，如 "glm-1", "openai-main"
  authToken: string;         // ANTHROPIC_AUTH_TOKEN
  baseUrl: string;           // ANTHROPIC_BASE_URL
  model: string;             // ANTHROPIC_MODEL
  status: ProviderStatus;    // 当前状态
  lastUsed?: string;         // 最后使用时间
  rateLimitedAt?: string;    // 被限制的时间
  notes?: string;            // 备注
}

export interface ProviderConfig {
  currentProvider: string;   // 当前使用的提供商名称
  providers: AIProvider[];   // 所有提供商列表
  lastSwitchAt?: string;     // 最后切换时间
  totalSwitches: number;     // 总切换次数
}

export interface SwitchResult {
  success: boolean;
  previousProvider?: string;
  newProvider?: string;
  reason: string;
  instructions?: string;     // 如果需要手动操作，给出指引
}
