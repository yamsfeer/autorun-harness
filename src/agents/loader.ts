import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录路径（ES Module 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Agent 定义接口（简化版，与 SDK 的 AgentDefinition 兼容）
 */
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  maxTurns?: number;
}

/**
 * Agent 加载器
 */
export class AgentLoader {
  private promptsDir: string;

  constructor(promptsDir?: string) {
    // 默认使用项目根目录下的 prompts 目录
    this.promptsDir = promptsDir || path.join(__dirname, '../../prompts');
  }

  /**
   * 加载提示词文件
   */
  private async loadPrompt(name: string): Promise<string> {
    const filePath = path.join(this.promptsDir, `${name}.md`);
    return await fs.readFile(filePath, 'utf-8');
  }

  /**
   * 加载规划器 Agent
   * @param mode 初始化模式：'simple' 或 'full'
   */
  async loadPlanner(mode: 'simple' | 'full' = 'full'): Promise<AgentDefinition> {
    const promptFile = mode === 'simple' ? 'planner-simple' : 'planner-full';
    const prompt = await this.loadPrompt(promptFile);
    return {
      description: '产品规划专家，负责需求分析和任务拆分，生成产品规格和任务列表',
      prompt,
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      model: 'sonnet',
      maxTurns: mode === 'simple' ? 15 : 30,
    };
  }

  /**
   * 加载生成器 Agent
   */
  async loadGenerator(): Promise<AgentDefinition> {
    const prompt = await this.loadPrompt('generator');
    return {
      description: '资深工程师，负责实现功能代码，遵循设计约束',
      prompt,
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      model: 'sonnet',
      maxTurns: 20,
    };
  }

  /**
   * 加载评估器 Agent（Phase 2）
   */
  async loadEvaluator(): Promise<AgentDefinition> {
    const prompt = await this.loadPrompt('evaluator');
    return {
      description: 'QA 评估器，严格验收开发工作，执行验收标准测试',
      prompt,
      tools: ['Read', 'Bash', 'Glob', 'Grep'],
      model: 'sonnet',
      maxTurns: 15,
    };
  }
}

/**
 * 创建 Agent 加载器实例
 */
export function createAgentLoader(promptsDir?: string): AgentLoader {
  return new AgentLoader(promptsDir);
}
