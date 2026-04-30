import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AppError, ErrorType, RetryConfig } from '../types/quality.js';

/**
 * 默认重试配置
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,      // 1秒
  maxDelay: 30000,      // 30秒
  backoffMultiplier: 2,
};

/**
 * 需要切换提供商的错误类型
 */
const SWITCH_REQUIRED_TYPES: ErrorType[] = ['rate_limit', 'usage_limit'];

/**
 * 创建应用错误
 */
export function createError(
  type: ErrorType,
  message: string,
  options?: {
    code?: string;
    retryable?: boolean;
    shouldExit?: boolean;
    cause?: Error;
    context?: Record<string, any>;
  }
): AppError {
  const error = new Error(message) as AppError;
  error.name = `${type}Error`;
  error.type = type;
  error.code = options?.code;
  error.retryable = options?.retryable ?? isRetryableByDefault(type);
  // rate_limit 和 usage_limit 默认 shouldExit=false，因为可以尝试切换提供商
  error.shouldExit = options?.shouldExit ?? false;
  error.context = options?.context;
  if (options?.cause) {
    error.cause = options.cause;
  }
  return error;
}

/**
 * 判断错误类型默认是否可重试
 */
function isRetryableByDefault(type: ErrorType): boolean {
  // rate_limit 和 usage_limit 不可重试，需要切换提供商
  return ['network', 'api_timeout'].includes(type);
}

/**
 * 检查错误是否需要切换提供商
 */
export function shouldSwitchProvider(error: unknown): boolean {
  if (error instanceof Error) {
    const appError = error as AppError;
    return SWITCH_REQUIRED_TYPES.includes(appError.type);
  }
  return false;
}

/**
 * 带重试的异步操作执行
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config?: Partial<RetryConfig>,
  onRetry?: (attempt: number, error: Error, delay: number) => void
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= finalConfig.maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否可重试
      const appError = error as AppError;
      if (appError.retryable === false || attempt > finalConfig.maxRetries) {
        throw error;
      }

      // 计算延迟
      const delay = Math.min(
        finalConfig.baseDelay * Math.pow(finalConfig.backoffMultiplier, attempt - 1),
        finalConfig.maxDelay
      );

      // 回调
      if (onRetry) {
        onRetry(attempt, lastError, delay);
      }

      // 等待后重试
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * 带超时的异步操作
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(createError('api_timeout', message || `操作超时 (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * 带重试和超时的操作
 */
export async function withRetryAndTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  retryConfig?: Partial<RetryConfig>
): Promise<T> {
  return withRetry(
    () => withTimeout(operation(), timeoutMs),
    retryConfig
  );
}

/**
 * 解析错误类型
 */
export function parseErrorType(error: unknown): ErrorType {
  // 检查是否已经是带类型的 AppError
  if (error instanceof Error) {
    const appError = error as AppError;
    if (appError.type && appError.type !== 'unknown') {
      return appError.type;
    }

    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // 评估器错误
    if (name.includes('evaluator') || message.includes('评估器')) {
      return 'evaluator_error';
    }

    // API 限制错误
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
      return 'rate_limit';
    }
    if (message.includes('usage limit') || message.includes('quota exceeded') || message.includes('monthly limit')
        || message.includes('credit limit') || message.includes('billing') || message.includes('payment')) {
      return 'usage_limit';
    }
    // 上下文长度/Token 上限（部分提供商返回此类错误，切换模型可能解决）
    if (message.includes('context length') || message.includes('token limit') || message.includes('max tokens')
        || message.includes('too long') || message.includes('exceeds maximum')) {
      return 'usage_limit';
    }

    if (name.includes('timeout') || message.includes('timeout')) {
      return 'api_timeout';
    }
    if (name.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
      return 'network';
    }
    if (name.includes('api') || message.includes('api')) {
      return 'api_error';
    }
  }

  return 'unknown';
}

/**
 * 格式化错误信息
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const appError = error as AppError;
    let msg = `[${appError.type || 'unknown'}] ${error.message}`;
    if (appError.code) {
      msg += ` (${appError.code})`;
    }
    return msg;
  }
  return String(error);
}

/**
 * 检查错误是否需要退出（中止执行）
 * 注意：这不同于需要切换提供商。只有当切换提供商失败时才需要退出
 */
export function shouldExit(error: unknown): boolean {
  if (error instanceof Error) {
    const appError = error as AppError;
    // 默认情况下，这些错误需要退出
    // 但如果可以通过切换提供商解决，则不需要退出
    return appError.shouldExit ?? false;
  }
  return false;
}

/**
 * 应用提供商配置到环境变量
 */
export function applyProviderConfig(config: {
  authToken: string;
  baseUrl: string;
  model: string;
}): void {
  process.env.ANTHROPIC_AUTH_TOKEN = config.authToken;
  process.env.ANTHROPIC_BASE_URL = config.baseUrl;
  process.env.ANTHROPIC_MODEL = config.model;
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.model;
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.model;

  console.log(`📡 已切换到提供商: ${config.model} @ ${config.baseUrl}`);
}

/**
 * 将 provider 配置写入用户级 ~/.claude/settings.json
 * 做 merge：保留已有的其他设置（如 cc-switch 写入的 skipDangerousModePermissionPrompt 等），只更新 ANTHROPIC_* env 变量
 *
 * 注意：之前尝试写入 settings.local.json，但测试发现 Claude CLI 子进程不读取该文件
 * （或 process.env 优先级高于它），直接写 settings.json 才能让 CLI 子进程正确加载。
 */
export async function writeProviderToUserLocalSettings(envConfig: {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
}): Promise<void> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const claudeDir = path.dirname(settingsPath);

  // 读取已有设置，做 merge
  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    existing = JSON.parse(raw);
  } catch {
    // 文件不存在或格式非法，从头创建
  }

  const existingEnv = (existing.env as Record<string, string>) || {};
  const settings = {
    ...existing,
    env: {
      ...existingEnv,
      ANTHROPIC_AUTH_TOKEN: envConfig.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_BASE_URL: envConfig.ANTHROPIC_BASE_URL,
      ANTHROPIC_MODEL: envConfig.ANTHROPIC_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: envConfig.ANTHROPIC_DEFAULT_SONNET_MODEL || envConfig.ANTHROPIC_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: envConfig.ANTHROPIC_DEFAULT_OPUS_MODEL || envConfig.ANTHROPIC_MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: envConfig.ANTHROPIC_DEFAULT_HAIKU_MODEL || envConfig.ANTHROPIC_MODEL,
    },
  };

  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * 检查项目级 .claude/settings.local.json 是否有 ANTHROPIC_* 配置会覆盖 harness 的设置
 * 项目级优先级最高，如果有相关配置需要提醒用户
 */
export async function checkProjectLocalSettings(projectDir: string): Promise<void> {
  const projectSettingsPath = path.join(projectDir, '.claude', 'settings.local.json');
  try {
    const raw = await fs.readFile(projectSettingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    if (settings.env) {
      const overrides: string[] = [];
      if (settings.env.ANTHROPIC_AUTH_TOKEN) overrides.push('ANTHROPIC_AUTH_TOKEN');
      if (settings.env.ANTHROPIC_BASE_URL) overrides.push('ANTHROPIC_BASE_URL');
      if (settings.env.ANTHROPIC_MODEL) overrides.push('ANTHROPIC_MODEL');
      if (overrides.length > 0) {
        console.warn(`\n⚠️  项目级 ${projectSettingsPath} 设置了 ${overrides.join(', ')}，优先级最高，会覆盖 harness 的 provider 配置`);
      }
    }
  } catch {
    // 文件不存在 — 无冲突
  }
}

/**
 * 获取退出指令（用于人类操作）
 */
export function getExitInstructions(error: unknown): string | null {
  if (!shouldExit(error)) {
    return null;
  }

  const appError = error as AppError;

  switch (appError.type) {
    case 'rate_limit':
      return `检测到频率限制 (429)。
系统将自动切换到下一个服务提供商并继续执行。
如果所有提供商都已受限，请手动添加新的提供商配置。`;

    case 'usage_limit':
      return `检测到用量限制（额度已用尽）。
系统将自动切换到下一个服务提供商并继续执行。
如果所有提供商都不可用，请等待额度重置或添加新的提供商。`;

    default:
      return `检测到需要人工介入的错误: ${appError.message}`;
  }
}

/**
 * 工具函数：休眠
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
