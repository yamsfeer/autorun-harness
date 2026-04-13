import { chromium, Browser, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

/**
 * Playwright 测试工具类
 * 提供浏览器自动化测试能力
 */
export class PlaywrightTester {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private projectDir: string;
  private screenshotsDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.screenshotsDir = path.join(projectDir, '.harness', 'screenshots');
  }

  /**
   * 初始化浏览器
   */
  async initialize(): Promise<void> {
    // 确保截图目录存在
    await fs.mkdir(this.screenshotsDir, { recursive: true });

    // 启动浏览器（无头模式）
    this.browser = await chromium.launch({
      headless: true,
    });

    // 创建浏览器上下文
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    // 创建页面
    this.page = await this.context.newPage();
  }

  /**
   * 导航到 URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('页面未初始化，请先调用 initialize()');
    }
    await this.page.goto(url, { waitUntil: 'networkidle' });
  }

  /**
   * 点击元素
   */
  async click(selector: string): Promise<void> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    await this.page.click(selector);
  }

  /**
   * 填写输入框
   */
  async fill(selector: string, value: string): Promise<void> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    await this.page.fill(selector, value);
  }

  /**
   * 获取文本内容
   */
  async getText(selector: string): Promise<string> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    return await this.page.textContent(selector) || '';
  }

  /**
   * 检查元素是否存在
   */
  async exists(selector: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    const element = await this.page.$(selector);
    return element !== null;
  }

  /**
   * 等待元素出现
   */
  async waitForSelector(selector: string, timeout: number = 5000): Promise<void> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    await this.page.waitForSelector(selector, { timeout });
  }

  /**
   * 截图
   */
  async screenshot(name: string): Promise<string> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    const filename = `${name}-${Date.now()}.png`;
    const filepath = path.join(this.screenshotsDir, filename);
    await this.page.screenshot({ path: filepath, fullPage: true });
    return filepath;
  }

  /**
   * 获取控制台日志
   */
  async getConsoleLogs(): Promise<string[]> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    const logs: string[] = [];
    this.page.on('console', (msg) => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });
    return logs;
  }

  /**
   * 检查是否有 JavaScript 错误
   */
  async hasErrors(): Promise<boolean> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    let hasError = false;
    this.page.on('pageerror', (error) => {
      hasError = true;
    });
    return hasError;
  }

  /**
   * 执行自定义脚本
   */
  async evaluate<R>(fn: () => R): Promise<R> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    return await this.page.evaluate(fn);
  }

  /**
   * 获取当前 URL
   */
  async getCurrentUrl(): Promise<string> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    return this.page.url();
  }

  /**
   * 等待导航完成
   */
  async waitForNavigation(timeout: number = 10000): Promise<void> {
    if (!this.page) {
      throw new Error('页面未初始化');
    }
    await this.page.waitForLoadState('networkidle', { timeout });
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

/**
 * 创建 Playwright 测试器实例
 */
export function createPlaywrightTester(projectDir: string): PlaywrightTester {
  return new PlaywrightTester(projectDir);
}
