import { Logger, createLogger } from './logger.js';

/**
 * 优雅关闭管理器
 * 捕获 SIGTERM 和 SIGINT 信号，执行清理操作并记录日志
 */
export class GracefulShutdown {
  private logger: Logger | null = null;
  private isShuttingDown = false;
  private cleanupCallbacks: Array<() => Promise<void>> = [];

  /**
   * 初始化信号处理
   */
  initialize(logger: Logger): void {
    this.logger = logger;

    // 捕获终止信号
    process.on('SIGTERM', () => this.handleSignal('SIGTERM'));
    process.on('SIGINT', () => this.handleSignal('SIGINT'));
  }

  /**
   * 添加清理回调
   */
  onCleanup(callback: () => Promise<void>): void {
    this.cleanupCallbacks.push(callback);
  }

  /**
   * 处理信号
   */
  private async handleSignal(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      // 已经在关闭中，强制退出
      process.exit(1);
    }

    this.isShuttingDown = true;

    console.log(`\n⚠️ 收到 ${signal} 信号，正在优雅关闭...`);

    // 记录到日志
    if (this.logger) {
      this.logger.error('shutdown', `进程被信号中断: ${signal}`, undefined, {
        signal,
        timestamp: new Date().toISOString(),
      });
    }

    // 执行清理回调
    for (const callback of this.cleanupCallbacks) {
      try {
        await callback();
      } catch (error) {
        console.error('清理回调执行失败:', error);
      }
    }

    // 根据信号类型决定退出码
    const exitCode = signal === 'SIGTERM' ? 143 : 130;
    process.exit(exitCode);
  }

  /**
   * 检查是否正在关闭
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }
}

// 单例实例
let _instance: GracefulShutdown | null = null;

/**
 * 获取优雅关闭管理器单例
 */
export function getGracefulShutdown(): GracefulShutdown {
  if (!_instance) {
    _instance = new GracefulShutdown();
  }
  return _instance;
}
