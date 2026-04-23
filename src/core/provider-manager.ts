import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AIProvider, ProviderConfig, ProviderStatus, SwitchResult } from '../types/quality.js';

/**
 * 全局配置目录
 */
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.config', 'autorun-harness', 'providers');

/**
 * 多服务提供商管理器
 * 管理多个 AI 服务提供商配置，支持自动切换
 * 
 * 配置路径：~/.config/autorun-harness/providers/*.json
 * 每个提供商一个独立的 JSON 文件
 */
export class ProviderManager {
  private configDir: string;
  private providers: Map<string, AIProvider> = new Map();
  private currentProviderName: string = '';
  private totalSwitches: number = 0;
  private lastSwitchAt?: string;
  constructor() {
    this.configDir = GLOBAL_CONFIG_DIR;
  }

  /**
   * 初始化 - 加载所有提供商配置
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });

      // 读取所有 .json 文件
      const files = await fs.readdir(this.configDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.configDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const provider = JSON.parse(content) as AIProvider;

          // 文件名作为默认 name（如果没有设置）
          if (!provider.name) {
            provider.name = path.basename(file, '.json');
          }

          this.providers.set(provider.name, provider);
        } catch (e) {
          console.warn(`⚠️ 无法加载提供商配置: ${file}`);
        }
      }

      // 加载状态文件
      await this.loadState();

    } catch (error) {
      console.warn('⚠️ 无法初始化提供商管理器:', error);
    }
  }

  /**
   * 加载状态文件（当前选中的提供商）
   */
  private async loadState(): Promise<void> {
    try {
      const statePath = path.join(this.configDir, '.state.json');
      const content = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(content);
      this.currentProviderName = state.currentProvider || '';
      this.totalSwitches = state.totalSwitches || 0;
      this.lastSwitchAt = state.lastSwitchAt;
    } catch {
      // 状态文件不存在，选择第一个可用的提供商
      const available = this.getAvailableProviders();
      if (available.length > 0) {
        this.currentProviderName = available[0].name;
      }
    }
  }

  /**
   * 保存状态文件
   */
  private async saveState(): Promise<void> {
    const statePath = path.join(this.configDir, '.state.json');
    await fs.writeFile(
      statePath,
      JSON.stringify({
        currentProvider: this.currentProviderName,
        totalSwitches: this.totalSwitches,
        lastSwitchAt: this.lastSwitchAt,
      }, null, 2),
      'utf-8'
    );
  }

  /**
   * 获取当前提供商
   */
  getCurrentProvider(): AIProvider | null {
    if (!this.currentProviderName) return null;
    return this.providers.get(this.currentProviderName) || null;
  }

  /**
   * 获取所有提供商
   */
  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 获取可用的提供商（status 为 available 或 active）
   */
  getAvailableProviders(): AIProvider[] {
    return Array.from(this.providers.values()).filter(p =>
      p.status === 'available' || p.status === 'active'
    );
  }

  /**
   * 添加或更新提供商
   */
  async addProvider(provider: Omit<AIProvider, 'status'>): Promise<void> {
    const newProvider: AIProvider = {
      ...provider,
      status: 'available',
      lastUsed: new Date().toISOString(),
    };

    // 保存到单独的文件
    const fileName = `${provider.name}.json`;
    const filePath = path.join(this.configDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(newProvider, null, 2), 'utf-8');

    // 更新内存
    this.providers.set(provider.name, newProvider);

    // 如果没有当前提供商，设置为第一个
    if (!this.currentProviderName) {
      this.currentProviderName = provider.name;
      newProvider.status = 'active';
      await this.saveState();
    }
  }

  /**
   * 删除提供商
   */
  async removeProvider(name: string): Promise<boolean> {
    if (!this.providers.has(name)) {
      return false;
    }

    // 不能删除当前正在使用的
    if (this.currentProviderName === name) {
      throw new Error('无法删除正在使用的提供商，请先切换到其他提供商');
    }

    const filePath = path.join(this.configDir, `${name}.json`);
    await fs.unlink(filePath);
    this.providers.delete(name);
    return true;
  }

  /**
   * 切换到下一个可用提供商
   */
  async switchToNext(reason: string): Promise<SwitchResult> {
    if (this.providers.size === 0) {
      return {
        success: false,
        reason: '没有配置任何服务提供商',
        instructions: `请在 ${this.configDir} 目录下添加提供商配置文件`,
      };
    }

    const currentProvider = this.getCurrentProvider();
    const previousName = currentProvider?.name;

    // 标记当前提供商为 rate_limited
    if (currentProvider) {
      currentProvider.status = 'rate_limited';
      currentProvider.rateLimitedAt = new Date().toISOString();
      await this.saveProviderFile(currentProvider);
    }

    // 查找下一个可用的提供商
    const providerList = Array.from(this.providers.values());
    const currentIndex = providerList.findIndex(p => p.name === this.currentProviderName);

    let nextProvider: AIProvider | null = null;

    // 从当前索引之后查找
    for (let i = 1; i <= providerList.length; i++) {
      const nextIndex = (currentIndex + i) % providerList.length;
      const candidate = providerList[nextIndex];

      if (candidate.status === 'available' || candidate.status === 'active') {
        nextProvider = candidate;
        break;
      }
    }

    // 如果没找到，尝试使用之前被限制但现在可能已恢复的
    if (!nextProvider) {
      for (const provider of providerList) {
        if (provider.status === 'rate_limited' && provider.rateLimitedAt) {
          const limitedTime = new Date(provider.rateLimitedAt).getTime();
          const hoursPassed = (Date.now() - limitedTime) / (1000 * 60 * 60);

          if (hoursPassed >= 1) {
            nextProvider = provider;
            nextProvider.status = 'available';
            break;
          }
        }
      }
    }

    if (!nextProvider) {
      return {
        success: false,
        previousProvider: previousName,
        reason: '所有服务提供商都已达到限制',
        instructions: this.generateManualSwitchInstructions(),
      };
    }

    // 执行切换
    this.currentProviderName = nextProvider.name;
    nextProvider.status = 'active';
    nextProvider.lastUsed = new Date().toISOString();
    this.lastSwitchAt = new Date().toISOString();
    this.totalSwitches += 1;

    await this.saveProviderFile(nextProvider);
    await this.saveState();

    return {
      success: true,
      previousProvider: previousName,
      newProvider: nextProvider.name,
      reason,
    };
  }

  /**
   * 标记当前提供商为限制状态并切换
   */
  async handleRateLimit(): Promise<SwitchResult> {
    return this.switchToNext('遇到频率限制 (429)');
  }

  /**
   * 标记当前提供商为用量限制状态并切换
   */
  async handleUsageLimit(): Promise<SwitchResult> {
    const current = this.getCurrentProvider();
    if (current) {
      current.status = 'unavailable';
      await this.saveProviderFile(current);
    }
    return this.switchToNext('达到用量限制');
  }

  /**
   * 手动切换到指定提供商
   */
  async switchTo(name: string): Promise<SwitchResult> {
    const target = this.providers.get(name);
    if (!target) {
      return {
        success: false,
        reason: `找不到提供商: ${name}`,
        instructions: `可用提供商: ${Array.from(this.providers.keys()).join(', ')}`,
      };
    }

    const previousProvider = this.getCurrentProvider();
    const previousName = previousProvider?.name;

    // 重置之前的 active 状态
    if (previousProvider && previousProvider.status === 'active') {
      previousProvider.status = 'available';
      await this.saveProviderFile(previousProvider);
    }

    // 设置新的 active
    target.status = 'active';
    target.lastUsed = new Date().toISOString();
    this.currentProviderName = name;
    this.lastSwitchAt = new Date().toISOString();
    this.totalSwitches += 1;

    await this.saveProviderFile(target);
    await this.saveState();

    return {
      success: true,
      previousProvider: previousName,
      newProvider: name,
      reason: '手动切换',
    };
  }

  /**
   * 保存单个提供商文件
   */
  private async saveProviderFile(provider: AIProvider): Promise<void> {
    const filePath = path.join(this.configDir, `${provider.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(provider, null, 2), 'utf-8');
  }

  /**
   * 生成手动切换指引
   */
  private generateManualSwitchInstructions(): string {
    const providers = this.getAllProviders();

    let instructions = `所有提供商都已受限。请添加新的提供商配置。

配置目录: ${this.configDir}

创建新文件，例如 openai.json:
{
  "name": "openai",
  "authToken": "your-token",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4",
  "status": "available"
}

当前提供商状态:
`;

    for (const p of providers) {
      instructions += `  - ${p.name}: ${p.status}`;
      if (p.rateLimitedAt) {
        instructions += ` (受限时间: ${p.rateLimitedAt})`;
      }
      instructions += '\n';
    }

    return instructions;
  }

  /**
   * 获取当前提供商的连接配置
   * 唯一事实来源：provider 配置文件
   */
  getEnvConfig(): { ANTHROPIC_AUTH_TOKEN: string; ANTHROPIC_BASE_URL: string; ANTHROPIC_MODEL: string } | null {
    const provider = this.getCurrentProvider();
    if (!provider) return null;

    return {
      ANTHROPIC_AUTH_TOKEN: provider.authToken,
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_MODEL: provider.model,
    };
  }

  /**
   * 打印当前状态
   */
  printStatus(): void {
    const providers = this.getAllProviders();
    const current = this.getCurrentProvider();
    console.log('\n📡 服务提供商状态');
    console.log(`   配置目录: ${this.configDir}`);

    if (current) {
      console.log(`   当前: ${current.name} (${current.model})`);
    } else {
      console.log(`   当前: 未设置`);
    }

    console.log(`   切换次数: ${this.totalSwitches}`);

    if (providers.length > 0) {
      console.log('\n   备用提供商:');
      for (const p of providers) {
        const isCurrent = p.name === this.currentProviderName;
        const statusIcon = {
          'active': '✅',
          'available': '🟢',
          'rate_limited': '🔴',
          'unavailable': '⚫',
        }[p.status];

        console.log(`   ${isCurrent ? '→' : ' '} ${p.name}: ${statusIcon} ${p.status} (${p.model})`);
      }
    }
  }

  /**
   * 获取配置目录路径
   */
  getConfigDir(): string {
    return this.configDir;
  }
}

// 单例实例
let _instance: ProviderManager | null = null;

/**
 * 获取提供商管理器单例
 */
export function getProviderManager(): ProviderManager {
  if (!_instance) {
    _instance = new ProviderManager();
  }
  return _instance;
}

/**
 * 创建新的提供商管理器实例
 */
export function createProviderManager(): ProviderManager {
  return new ProviderManager();
}
