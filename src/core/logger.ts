import fs from 'fs/promises';
import path from 'path';
import { LogEntry, LogLevel, LoggerConfig } from '../types/quality.js';

/**
 * 日志系统
 * 提供结构化日志记录能力
 */
export class Logger {
  private config: LoggerConfig;
  private logDir: string;
  private currentLogFile: string;

  constructor(harnessDir: string, config?: Partial<LoggerConfig>) {
    this.logDir = path.join(harnessDir, 'logs');
    this.config = {
      level: config?.level || 'info',
      console: config?.console ?? true,
      file: config?.file ?? true,
      filePath: config?.filePath,
    };
    this.currentLogFile = '';
  }

  /**
   * 初始化日志系统
   */
  async initialize(): Promise<void> {
    if (this.config.file) {
      await fs.mkdir(this.logDir, { recursive: true });
      const date = new Date().toISOString().split('T')[0];
      this.currentLogFile = path.join(this.logDir, `run-${date}.log`);
    }
  }

  /**
   * 记录日志
   */
  log(level: LogLevel, module: string, message: string, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
    };

    // 检查日志级别
    if (!this.shouldLog(level)) {
      return;
    }

    // 输出到控制台
    if (this.config.console) {
      this.logToConsole(entry);
    }

    // 输出到文件（异步，不阻塞）
    if (this.config.file && this.currentLogFile) {
      this.logToFile(entry).catch(() => {});
    }
  }

  /**
   * 便捷方法
   */
  debug(module: string, message: string, data?: Record<string, any>): void {
    this.log('debug', module, message, data);
  }

  info(module: string, message: string, data?: Record<string, any>): void {
    this.log('info', module, message, data);
  }

  warn(module: string, message: string, data?: Record<string, any>): void {
    this.log('warn', module, message, data);
  }

  error(module: string, message: string, error?: Error, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      module,
      message,
      data,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    if (this.config.console) {
      this.logToConsole(entry);
    }

    if (this.config.file && this.currentLogFile) {
      this.logToFile(entry).catch(() => {});
    }
  }

  /**
   * 检查是否应该记录该级别日志
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const entryLevelIndex = levels.indexOf(level);
    return entryLevelIndex >= currentLevelIndex;
  }

  /**
   * 输出到控制台
   */
  private logToConsole(entry: LogEntry): void {
    const prefix = this.getLevelPrefix(entry.level);
    const timestamp = entry.timestamp.split('T')[1].split('.')[0];
    let output = `${prefix} [${timestamp}] [${entry.module}] ${entry.message}`;

    if (entry.data) {
      output += ` ${JSON.stringify(entry.data)}`;
    }

    if (entry.error) {
      output += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack && this.config.level === 'debug') {
        output += `\n  ${entry.error.stack.split('\n').slice(1, 4).join('\n  ')}`;
      }
    }

    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  /**
   * 输出到文件
   */
  private async logToFile(entry: LogEntry): Promise<void> {
    const logLine = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.currentLogFile, logLine, 'utf-8');
  }

  /**
   * 获取日志级别前缀
   */
  private getLevelPrefix(level: LogLevel): string {
    const prefixes: Record<LogLevel, string> = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
    };
    return prefixes[level];
  }
}

/**
 * 创建日志器实例
 */
export function createLogger(harnessDir: string, config?: Partial<LoggerConfig>): Logger {
  return new Logger(harnessDir, config);
}
