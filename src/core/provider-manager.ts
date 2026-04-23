import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AIProvider, ProviderStaticConfig, ProviderRuntimeState, ProviderStateFile, ProviderStatus, SwitchResult } from '../types/quality.js';

/**
 * 全局配置目录
 */
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.config', 'autorun-harness', 'providers');

/**
 * 多服务提供商管理器
 * 管理多个 AI 服务提供商配置，支持自动切换
 *
 * 静态配置路径：~/.config/autorun-harness/providers/*.json（每个提供商一个文件）
 * 运行时状态：~/.config/autorun-harness/providers/.state.json
 */
export class ProviderManager {
  private configDir: string;
  private providers: Map<string, AIProvider> = new Map();
  private providerStates: Map<string, ProviderRuntimeState> = new Map();
  private currentProviderName: string = '';
  private totalSwitches: number = 0;
  private lastSwitchAt?: string;

  // 冷却期常量
  private static readonly RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;     // 1 小时
  private static readonly UNAVAILABLE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小时

  constructor() {
    this.configDir = GLOBAL_CONFIG_DIR;
  }

  /**
   * 初始化 - 加载所有提供商配置
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });

      // 1. 加载静态配置
      const files = await fs.readdir(this.configDir);
      const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.configDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const raw = JSON.parse(content);

          const config = raw as ProviderStaticConfig;
          if (!config.name) {
            config.name = path.basename(file, '.json');
          }

          // 先以 available 默认值创建，后续从 .state.json 覆盖
          this.providers.set(config.name, {
            ...config,
            status: 'available',
          });
        } catch (e) {
          console.warn(`⚠️ 无法加载提供商配置: ${file}`);
        }
      }

      // 2. 加载运行时状态
      await this.loadState();

      // 3. 合并运行时状态到 provider 对象
      for (const [name, state] of this.providerStates) {
        const provider = this.providers.get(name);
        if (provider) {
          provider.status = state.status;
          provider.lastUsed = state.lastUsed;
          provider.rateLimitedAt = state.rateLimitedAt;
          provider.unavailableAt = state.unavailableAt;
        }
      }

      // 4. 恢复冷却期已过的 provider
      this.checkRecovery();

      // 5. 持久化恢复变更
      await this.saveState();

      // 6. 清理旧 provider 文件中的运行时字段
      for (const provider of this.providers.values()) {
        await this.saveProviderFile(provider);
      }

    } catch (error) {
      console.warn('⚠️ 无法初始化提供商管理器:', error);
    }
  }

  /**
   * 加载状态文件
   */
  private async loadState(): Promise<void> {
    try {
      const statePath = path.join(this.configDir, '.state.json');
      const content = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(content) as ProviderStateFile;

      this.currentProviderName = state.currentProvider || '';
      this.totalSwitches = state.totalSwitches || 0;
      this.lastSwitchAt = state.lastSwitchAt;

      // 加载 per-provider 运行时状态
      if (state.providers) {
        for (const [name, providerState] of Object.entries(state.providers)) {
          this.providerStates.set(name, providerState);
        }
      }
    } catch {
      // 状态文件不存在，选择第一个可用的提供商
      const available = this.getAvailableProviders();
      if (available.length > 0) {
        this.currentProviderName = available[0].name;
      }
    }
  }

  /**
   * 保存状态文件（含 per-provider 运行时状态）
   */
  private async saveState(): Promise<void> {
    const statePath = path.join(this.configDir, '.state.json');

    const providers: Record<string, ProviderRuntimeState> = {};
    for (const [name, provider] of this.providers) {
      providers[name] = {
        status: provider.status,
        lastUsed: provider.lastUsed,
        rateLimitedAt: provider.rateLimitedAt,
        unavailableAt: provider.unavailableAt,
      };
    }

    await fs.writeFile(
      statePath,
      JSON.stringify({
        currentProvider: this.currentProviderName,
        totalSwitches: this.totalSwitches,
        lastSwitchAt: this.lastSwitchAt,
        providers,
      }, null, 2),
      'utf-8'
    );
  }

  /**
   * 检查所有 provider 的冷却期，恢复已过期的 provider
 * 返回恢复的数量
   */
  checkRecovery(): number {
    let recovered = 0;
    const now = Date.now();

    for (const provider of this.providers.values()) {
      if (provider.status === 'rate_limited' && provider.rateLimitedAt) {
        const elapsed = now - new Date(provider.rateLimitedAt).getTime();
        if (elapsed >= ProviderManager.RATE_LIMIT_COOLDOWN_MS) {
          provider.status = 'available';
          provider.rateLimitedAt = undefined;
          recovered++;
        }
      } else if (provider.status === 'unavailable' && provider.unavailableAt) {
        const elapsed = now - new Date(provider.unavailableAt).getTime();
        if (elapsed >= ProviderManager.UNAVAILABLE_COOLDOWN_MS) {
          provider.status = 'available';
          provider.unavailableAt = undefined;
          recovered++;
        }
      }
    }

    return recovered;
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
    this.checkRecovery();
    return Array.from(this.providers.values()).filter(p =>
      p.status === 'available' || p.status === 'active'
    );
  }

  /**
   * 添加或更新提供商
   */
  async addProvider(config: ProviderStaticConfig): Promise<void> {
    const newProvider: AIProvider = {
      ...config,
      status: 'available',
      lastUsed: new Date().toISOString(),
    };

    // 只保存静态配置到 provider 文件
    const staticConfig: ProviderStaticConfig = {
      name: config.name,
      authToken: config.authToken,
      baseUrl: config.baseUrl,
      model: config.model,
      notes: config.notes,
    };
    const fileName = `${config.name}.json`;
    const filePath = path.join(this.configDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(staticConfig, null, 2), 'utf-8');

    // 更新内存
    this.providers.set(config.name, newProvider);

    // 如果没有当前提供商，设置为第一个
    if (!this.currentProviderName) {
      this.currentProviderName = config.name;
      newProvider.status = 'active';
    }

    await this.saveState();
  }

  /**
   * 删除提供商
   */
  async removeProvider(name: string): Promise<boolean> {
    if (!this.providers.has(name)) {
      return false;
    }

    if (this.currentProviderName === name) {
      throw new Error('无法删除正在使用的提供商，请先切换到其他提供商');
    }

    const filePath = path.join(this.configDir, `${name}.json`);
    await fs.unlink(filePath);
    this.providers.delete(name);
    this.providerStates.delete(name);
    await this.saveState();
    return true;
  }

  /**
   * 切换到下一个可用提供商
 * @param reason 切换原因
 * @param statusToSet 当前 provider 应标记的状态
   */
  async switchToNext(reason: string, statusToSet: ProviderStatus = 'rate_limited'): Promise<SwitchResult> {
    if (this.providers.size === 0) {
      return {
        success: false,
        reason: '没有配置任何服务提供商',
        instructions: `请在 ${this.configDir} 目录下添加提供商配置文件`,
      };
    }

    const currentProvider = this.getCurrentProvider();
    const previousName = currentProvider?.name;

    // 根据调用方指定的状态标记当前 provider
    if (currentProvider) {
      currentProvider.status = statusToSet;
      if (statusToSet === 'rate_limited') {
        currentProvider.rateLimitedAt = new Date().toISOString();
      } else if (statusToSet === 'unavailable') {
        currentProvider.unavailableAt = new Date().toISOString();
      }
    }

    // 搜索前先检查恢复
    this.checkRecovery();

    // 保存状态（当前 provider 的新状态 + 可能的恢复变更）
    await this.saveState();

    // 查找下一个可用的提供商（round-robin）
    const providerList = Array.from(this.providers.values());
    const currentIndex = providerList.findIndex(p => p.name === this.currentProviderName);

    let nextProvider: AIProvider | null = null;

    for (let i = 1; i <= providerList.length; i++) {
      const nextIndex = (currentIndex + i) % providerList.length;
      const candidate = providerList[nextIndex];

      if (candidate.status === 'available' || candidate.status === 'active') {
        nextProvider = candidate;
        break;
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

    await this.saveState();

    return {
      success: true,
      previousProvider: previousName,
      newProvider: nextProvider.name,
      reason,
    };
  }

  /**
   * 标记当前提供商为频率限制状态并切换
   */
  async handleRateLimit(): Promise<SwitchResult> {
    return this.switchToNext('遇到频率限制 (429)', 'rate_limited');
  }

  /**
   * 标记当前提供商为用量限制状态并切换
   */
  async handleUsageLimit(): Promise<SwitchResult> {
    return this.switchToNext('达到用量限制', 'unavailable');
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
    }

    // 设置新的 active
    target.status = 'active';
    target.lastUsed = new Date().toISOString();
    this.currentProviderName = name;
    this.lastSwitchAt = new Date().toISOString();
    this.totalSwitches += 1;

    await this.saveState();

    return {
      success: true,
      previousProvider: previousName,
      newProvider: name,
      reason: '手动切换',
    };
  }

  /**
   * 保存单个提供商文件（只保存静态配置）
   */
  private async saveProviderFile(provider: AIProvider): Promise<void> {
    const staticConfig: ProviderStaticConfig = {
      name: provider.name,
      authToken: provider.authToken,
      baseUrl: provider.baseUrl,
      model: provider.model,
      notes: provider.notes,
    };
    const filePath = path.join(this.configDir, `${provider.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(staticConfig, null, 2), 'utf-8');
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
  "model": "gpt-4"
}

当前提供商状态:
`;

    for (const p of providers) {
      instructions += `  - ${p.name}: ${p.status}`;
      if (p.rateLimitedAt) {
        const recoverAt = new Date(new Date(p.rateLimitedAt).getTime() + ProviderManager.RATE_LIMIT_COOLDOWN_MS);
        instructions += ` (频率受限，预计 ${recoverAt.toLocaleString()} 恢复)`;
      }
      if (p.unavailableAt) {
        const recoverAt = new Date(new Date(p.unavailableAt).getTime() + ProviderManager.UNAVAILABLE_COOLDOWN_MS);
        instructions += ` (不可用，预计 ${recoverAt.toLocaleString()} 恢复)`;
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

    console.log('');
    if (providers.length === 0) {
      console.log('  尚未配置任何提供商');
      console.log(`  运行 autorun-harness provider --add 添加`);
      return;
    }

    // 按优先级排序：active 在最前，然后 available，最后 rate_limited/unavailable
    const statusOrder: Record<string, number> = { active: 0, available: 1, rate_limited: 2, unavailable: 3 };
    const sorted = [...providers].sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

    for (const p of sorted) {
      const isCurrent = p.name === this.currentProviderName;
      let label = '';
      switch (p.status) {
        case 'active':
          label = '✅ 当前使用';
          break;
        case 'available':
          label = '🟢 可用';
          break;
        case 'rate_limited':
          label = '🔴 频率受限';
          if (p.rateLimitedAt) {
            const recoverAt = new Date(new Date(p.rateLimitedAt).getTime() + ProviderManager.RATE_LIMIT_COOLDOWN_MS);
            label += ` (预计 ${recoverAt.toLocaleString()} 恢复)`;
          }
          break;
        case 'unavailable':
          label = '⚫ 不可用';
          if (p.unavailableAt) {
            const recoverAt = new Date(new Date(p.unavailableAt).getTime() + ProviderManager.UNAVAILABLE_COOLDOWN_MS);
            label += ` (预计 ${recoverAt.toLocaleString()} 恢复)`;
          }
          break;
      }

      console.log(`  ${isCurrent ? '→' : ' '} ${p.name}  ${label}  ${p.model}`);
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
