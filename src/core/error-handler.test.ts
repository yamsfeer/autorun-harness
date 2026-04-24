import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createError,
  shouldSwitchProvider,
  withRetry,
  withTimeout,
  withRetryAndTimeout,
  parseErrorType,
  formatError,
  shouldExit,
  getExitInstructions,
  applyProviderConfig,
} from './error-handler.js';
import { AppError, ErrorType } from '../types/quality.js';

describe('createError', () => {
  it('should create an error with correct type and default properties', () => {
    const error = createError('network', 'connection failed');

    expect(error.message).toBe('connection failed');
    expect(error.name).toBe('networkError');
    expect(error.type).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.shouldExit).toBe(false);
  });

  it('should respect custom options', () => {
    const cause = new Error('original');
    const error = createError('api_error', 'api failed', {
      code: 'E500',
      retryable: false,
      shouldExit: true,
      cause,
      context: { taskId: 'T001' },
    });

    expect(error.code).toBe('E500');
    expect(error.retryable).toBe(false);
    expect(error.shouldExit).toBe(true);
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ taskId: 'T001' });
  });

  it('should mark rate_limit and usage_limit as non-retryable', () => {
    const rateLimit = createError('rate_limit', 'too many requests');
    const usageLimit = createError('usage_limit', 'quota exceeded');

    expect(rateLimit.retryable).toBe(false);
    expect(usageLimit.retryable).toBe(false);
  });
});

describe('shouldSwitchProvider', () => {
  it('should return true for rate_limit and usage_limit errors', () => {
    expect(shouldSwitchProvider(createError('rate_limit', '429'))).toBe(true);
    expect(shouldSwitchProvider(createError('usage_limit', 'quota'))).toBe(true);
  });

  it('should return false for other error types', () => {
    expect(shouldSwitchProvider(createError('network', 'timeout'))).toBe(false);
    expect(shouldSwitchProvider(createError('api_error', '500'))).toBe(false);
    expect(shouldSwitchProvider(new Error('plain error'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const result = await withRetry(operation);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors and eventually succeed', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(createError('network', 'timeout'))
      .mockRejectedValueOnce(createError('network', 'timeout'))
      .mockResolvedValue('success');

    const onRetry = vi.fn();
    const result = await withRetry(operation, { baseDelay: 1, maxDelay: 10 }, onRetry);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('should not retry non-retryable errors', async () => {
    const operation = vi.fn().mockRejectedValue(createError('rate_limit', '429'));

    await expect(withRetry(operation)).rejects.toThrow('429');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should throw after max retries exceeded', async () => {
    const operation = vi.fn().mockRejectedValue(createError('network', 'timeout'));

    await expect(withRetry(operation, { maxRetries: 2, baseDelay: 1, maxDelay: 10 })).rejects.toThrow('timeout');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should respect maxDelay cap', async () => {
    const delays: number[] = [];
    const operation = vi.fn()
      .mockRejectedValueOnce(createError('network', 'e1'))
      .mockRejectedValueOnce(createError('network', 'e2'))
      .mockRejectedValueOnce(createError('network', 'e3'))
      .mockRejectedValueOnce(createError('network', 'e4'))
      .mockResolvedValue('success');

    const onRetry = (_attempt: number, _error: Error, delay: number) => {
      delays.push(delay);
    };

    await withRetry(
      operation,
      { maxRetries: 4, baseDelay: 10, maxDelay: 50, backoffMultiplier: 2 },
      onRetry
    );

    expect(delays[0]).toBe(10);  // 10 * 2^0
    expect(delays[1]).toBe(20);  // 10 * 2^1
    expect(delays[2]).toBe(40);  // 10 * 2^2
    expect(delays[3]).toBe(50);  // 10 * 2^3 = 80, capped at 50
  });
});

describe('withTimeout', () => {
  it('should return result if operation completes in time', async () => {
    const operation = Promise.resolve('done');
    const result = await withTimeout(operation, 1000);
    expect(result).toBe('done');
  });

  it('should throw timeout error if operation takes too long', async () => {
    const operation = new Promise<string>(() => {
      // never resolves
    });

    await expect(withTimeout(operation, 50, 'custom timeout message')).rejects.toThrow('custom timeout message');
  });
});

describe('withRetryAndTimeout', () => {
  it('should combine retry and timeout', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(createError('network', 'timeout'))
      .mockResolvedValue('success');

    const result = await withRetryAndTimeout(operation, 500, { baseDelay: 1, maxDelay: 10 });
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should timeout even with retries', async () => {
    const operation = vi.fn().mockImplementation(
      () => new Promise<string>(() => { /* never resolves */ })
    );

    await expect(withRetryAndTimeout(operation, 50, { baseDelay: 1, maxDelay: 10 })).rejects.toThrow('超时');
  });
});

describe('parseErrorType', () => {
  const cases: Array<{ input: string; expected: ErrorType }> = [
    { input: '429 rate limit', expected: 'rate_limit' },
    { input: 'quota exceeded', expected: 'usage_limit' },
    { input: 'credit limit reached', expected: 'usage_limit' },
    { input: 'monthly limit', expected: 'usage_limit' },
    { input: 'context length exceeded', expected: 'usage_limit' },
    { input: 'token limit', expected: 'usage_limit' },
    { input: 'connection timeout', expected: 'api_timeout' },
    { input: 'ECONNREFUSED', expected: 'network' },
    { input: 'ENOTFOUND', expected: 'network' },
    { input: 'api returned 500', expected: 'api_error' },
    { input: 'something weird', expected: 'unknown' },
  ];

  it.each(cases)('should classify "$input" as $expected', ({ input, expected }) => {
    expect(parseErrorType(new Error(input))).toBe(expected);
  });

  it('should classify evaluator_error by name', () => {
    const error = new Error('crash');
    error.name = 'EvaluatorError';
    expect(parseErrorType(error)).toBe('evaluator_error');
  });

  it('should classify 评估器错误 by message', () => {
    expect(parseErrorType(new Error('评估器出错了'))).toBe('evaluator_error');
  });

  it('should preserve type for AppError', () => {
    const error = createError('validation_error', 'bad input');
    expect(parseErrorType(error)).toBe('validation_error');
  });

  it('should return unknown for non-Error values', () => {
    expect(parseErrorType('string error')).toBe('unknown');
    expect(parseErrorType(42)).toBe('unknown');
    expect(parseErrorType(null)).toBe('unknown');
  });
});

describe('formatError', () => {
  it('should format AppError with type', () => {
    const error = createError('network', 'timeout', { code: 'ETIMEDOUT' });
    expect(formatError(error)).toBe('[network] timeout (ETIMEDOUT)');
  });

  it('should format plain Error', () => {
    expect(formatError(new Error('plain'))).toBe('[unknown] plain');
  });

  it('should stringify non-errors', () => {
    expect(formatError(42)).toBe('42');
  });
});

describe('shouldExit', () => {
  it('should return false by default', () => {
    expect(shouldExit(createError('network', 'timeout'))).toBe(false);
    expect(shouldExit(new Error('plain'))).toBe(false);
  });

  it('should return true when shouldExit is set', () => {
    expect(shouldExit(createError('api_error', 'fatal', { shouldExit: true }))).toBe(true);
  });
});

describe('getExitInstructions', () => {
  it('should return null for non-exit errors', () => {
    expect(getExitInstructions(createError('network', 'timeout'))).toBeNull();
  });

  it('should return instructions for rate_limit', () => {
    const instructions = getExitInstructions(createError('rate_limit', '429', { shouldExit: true }));
    expect(instructions).toContain('频率限制');
    expect(instructions).toContain('429');
  });

  it('should return instructions for usage_limit', () => {
    const instructions = getExitInstructions(createError('usage_limit', 'quota', { shouldExit: true }));
    expect(instructions).toContain('用量限制');
  });
});

describe('applyProviderConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should set environment variables', () => {
    applyProviderConfig({
      authToken: 'test-token',
      baseUrl: 'https://api.test.com',
      model: 'claude-test',
    });

    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('test-token');
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.test.com');
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-test');
  });
});
