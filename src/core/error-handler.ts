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
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // API 限制错误
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
      return 'rate_limit';
    }
    if (message.includes('usage limit') || message.includes('quota exceeded') || message.includes('monthly limit')) {
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

  console.log(`📡 已切换到提供商: ${config.model} @ ${config.baseUrl}`);
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
