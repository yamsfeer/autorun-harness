import { query } from '@anthropic-ai/claude-agent-sdk';
import { StateManager } from './state-manager.js';
import { createAgentLoader, AgentDefinition } from '../agents/index.js';
import { createEvaluator, Evaluator } from './evaluator.js';
import { Task, EvaluatorReport } from '../types/index.js';
import { Logger, createLogger } from './logger.js';
import { CostTracker, createCostTracker } from './cost-tracker.js';
import { FailureCollector, createFailureCollector } from './failure-collector.js';
import { getProviderManager, ProviderManager } from './provider-manager.js';
import { getGracefulShutdown } from './graceful-shutdown.js';
import { createMessageHandler, MessageHandler } from './message-handler.js';
import {
  parseErrorType,
  shouldSwitchProvider,
  applyProviderConfig,
  formatError,
} from './error-handler.js';
import path from 'path';

/**
 * 初始化选项
 */
interface InitializeOptions {
  mode: 'simple' | 'full';
  existingDocs?: Record<string, string>;
  prdSource?: string;
}

/**
 * 主控编排器
 * 负责协调整个代理框架的执行流程
 */
export class Orchestrator {
  private stateManager: StateManager;
  private projectDir: string;
  private harnessDir: string;
  private agentLoader;
  private evaluator: Evaluator;

  // 质量保障模块
  private logger: Logger;
  private costTracker: CostTracker;
  private failureCollector: FailureCollector;
  private providerManager: ProviderManager;
  private messageHandler: MessageHandler;

  // 当前执行状态（用于中断时保存）
  private currentTask: Task | null = null;
  private currentPhase: string = '';

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.harnessDir = path.join(projectDir, '.harness');
    this.stateManager = new StateManager(projectDir);
    this.agentLoader = createAgentLoader();
    this.evaluator = createEvaluator(projectDir);

    // 初始化质量保障模块
    this.logger = createLogger(this.harnessDir, { level: 'info' });
    this.costTracker = createCostTracker(this.harnessDir);
    this.failureCollector = createFailureCollector(this.harnessDir);
    this.providerManager = getProviderManager();
    this.messageHandler = createMessageHandler();
  }

  /**
   * 初始化所有模块
   */
  private async initializeModules(): Promise<void> {
    await this.logger.initialize();
    await this.costTracker.initialize();
    await this.failureCollector.initialize();
    await this.providerManager.initialize();

    // 启动时立即将当前 provider 配置写入 process.env
    // 确保后续 query() 启动的 Claude 子进程继承正确的环境变量
    await this.applyCurrentProvider();

    // 设置信号处理
    const shutdown = getGracefulShutdown();
    shutdown.initialize(this.logger);

    // 添加清理回调
    shutdown.onCleanup(async () => {
      await this.handleInterruption();
    });
  }

  /**
   * 处理中断信号
   */
  private async handleInterruption(): Promise<void> {
    if (this.currentTask) {
      this.logger.warn('orchestrator', '进程被中断，保存当前状态', {
        taskId: this.currentTask.id,
        phase: this.currentPhase,
      });

      // 如果有正在进行的任务，记录中断状态
      await this.stateManager.appendProgress({
        timestamp: new Date().toISOString(),
        taskId: this.currentTask.id,
        status: 'interrupted',
        details: `进程被中断于 ${this.currentPhase} 阶段`,
      });

      // 记录到 failure collector
      await this.failureCollector.recordFailure({
        task: this.currentTask,
        attempt: this.currentTask.attempts + 1,
        errorType: 'api_timeout', // 使用 api_timeout 表示中断
        errorMessage: `进程被中断 (SIGTERM/SIGINT)，阶段: ${this.currentPhase}`,
        agentPhase: this.currentPhase as 'planning' | 'generation' | 'evaluation',
      });
    }
  }

  /**
   * 初始化阶段：调用 Planner 生成规格和任务
   */
  async initialize(
    prdContent: string,
    projectName?: string,
    options: InitializeOptions = { mode: 'full' }
  ): Promise<void> {
    await this.initializeModules();

    this.logger.info('orchestrator', '开始初始化项目', { projectName, mode: options.mode });
    console.log('🎯 初始化阶段：分析需求，生成规格和任务...\n');

    // 设置当前阶段（用于中断时记录）
    this.currentPhase = 'planning';

    // 显示当前配置状态
    this.printProviderStatus();

    try {
      // 加载 Planner Agent 定义（根据模式加载不同提示词）
      const plannerDef = await this.agentLoader.loadPlanner(options.mode);

      // 根据模式构建用户提示
      const userPrompt = this.buildUserPrompt(prdContent, projectName, options);

      // 调用 Planner Agent
      const queryResult = query({
        prompt: userPrompt,
        options: {
          cwd: this.projectDir,
          systemPrompt: plannerDef.prompt,
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          permissionMode: 'acceptEdits',
          maxTurns: options.mode === 'simple' ? 15 : 30,
        },
      });

      // 重置消息处理器
      this.messageHandler.reset();

      // 处理消息流
      for await (const message of queryResult) {
        if (message.type === 'result') {
          const { success, usage } = this.messageHandler.handleResult(message);

          // 记录 token 使用
          if (usage) {
            await this.costTracker.record({
              sessionId: this.getSessionId(),
              agent: 'planner',
              model: this.providerManager.getCurrentProvider()?.model || 'unknown',
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
            });
          }

          if (success) {
            this.currentPhase = ''; // 清除阶段标记
            this.logger.info('orchestrator', '初始化完成');
            console.log('\n✅ 初始化完成！');

            if (options.mode === 'simple') {
              console.log(`   - 技术规格：${this.projectDir}/.harness/spec.md`);
              console.log(`   - 任务列表：${this.projectDir}/.harness/tasks.json`);
            } else {
              console.log(`   - 文档索引：${this.projectDir}/CLAUDE.md`);
              console.log(`   - 完整文档：${this.projectDir}/docs/`);
              console.log(`   - 任务列表：${this.projectDir}/.harness/tasks.json`);
            }
          } else {
            this.currentPhase = '';
            this.logger.error('orchestrator', '初始化失败');
            console.error('❌ 初始化失败');
          }
          break;
        } else {
          this.messageHandler.handleMessage(message);
        }
      }
    } catch (error) {
      this.currentPhase = '';
      const errorType = parseErrorType(error);
      this.logger.error('orchestrator', '初始化过程出错', error instanceof Error ? error : undefined);

      // 检查是否需要切换提供商
      if (shouldSwitchProvider(error)) {
        await this.handleProviderSwitch(errorType === 'rate_limit' ? 'rate_limit' : 'usage_limit');
        // 不抛出错误，让调用者决定是否重试
        return;
      }

      throw error;
    }
  }

  /**
   * 根据模式构建用户提示
   */
  private buildUserPrompt(
    prdContent: string,
    projectName?: string,
    options?: InitializeOptions
  ): string {
    const mode = options?.mode || 'full';

    if (mode === 'simple') {
      return `请分析以下需求并生成项目任务列表。

## 用户需求

${prdContent}

${projectName ? `项目名称：${projectName}` : ''}

## 输出要求

请生成以下必要文件：

1. **.harness/spec.md** — 技术规格（简洁版，包含技术栈、目录结构、核心功能）
2. **.harness/tasks.json** — 任务列表（JSON 格式，包含验收标准）
3. **.harness/progress.txt** — 进度日志（初始为空）

注意：
- 不需要生成复杂的设计文档（DESIGN.md, API_CONTRACT.md 等）
- 专注于任务拆分和验收标准
- 保持简洁高效

请开始工作。`;
    } else {
      const existingDocsInfo = this.formatExistingDocsInfo(options?.existingDocs);

      return `请分析以下需求和已有文档，生成完整的项目文档体系和任务列表。

## 用户需求

${prdContent}

${projectName ? `项目名称：${projectName}` : ''}

${existingDocsInfo}

## 输出要求

请生成以下文件：

1. **CLAUDE.md** — 文档索引（项目根目录）
2. **docs/DESIGN.md** — 设计系统（如不存在）
3. **docs/API_CONTRACT.md** — 前后端 API 契约（如不存在）
4. **docs/DATA_MODEL.md** — 数据模型定义（如不存在）
5. **docs/UE_FLOW.md** — UE 交互逻辑状态机（如不存在）
6. **docs/FLOWCHART.md** — 业务流程图（如不存在）
7. **.harness/spec.md** — 技术规格（简洁版）
8. **.harness/tasks.json** — 任务列表（JSON 格式）
9. **init.sh** — 初始化脚本
10. **.harness/progress.txt** — 进度日志

注意：
- 如果某些文档已存在，请先阅读它们，不要重新生成
- 专注于理解已有文档并基于它们拆分任务
- PRD 已在 docs/PRD.md，请先读取它再进行分析

请开始工作。`;
    }
  }

  /**
   * 格式化已有文档信息
   */
  private formatExistingDocsInfo(existingDocs?: Record<string, string>): string {
    if (!existingDocs || Object.keys(existingDocs).length === 0) {
      return '';
    }

    const docList = Object.keys(existingDocs)
      .map(name => `- ${name}`)
      .join('\n');

    return `## 已有文档

以下文档已存在，请先阅读它们：

${docList}
`;
  }

  /**
   * 执行阶段：循环处理任务
   */
  async run(maxTasks: number = 10, maxTokens?: number): Promise<void> {
    await this.initializeModules();

    this.logger.info('orchestrator', '开始执行任务', { maxTasks, maxTokens });
    console.log('🚀 开始执行任务...\n');

    // 显示当前配置状态
    this.printProviderStatus();

    // 设置 Token 预算
    if (maxTokens) {
      // 注意：这里需要重新创建 costTracker 带配置
      this.costTracker = createCostTracker(this.harnessDir, { maxTotalTokens: maxTokens });
      await this.costTracker.initialize();
    }

    let taskCount = 0;

    while (taskCount < maxTasks) {
      // 检查项目是否已完成
      if (await this.stateManager.isProjectComplete()) {
        this.logger.info('orchestrator', '所有任务已完成');
        console.log('\n🎉 所有任务已完成！');
        const stats = await this.stateManager.getStatistics();
        console.log(`   统计：${stats.completed}/${stats.total} 完成，${stats.needs_human} 需人工介入`);
        break;
      }

      // 获取下一个待处理任务
      const nextTask = await this.stateManager.getNextTask();
      if (!nextTask) {
        this.logger.warn('orchestrator', '没有找到可执行的任务');
        console.log('\n⚠️  没有找到可执行的任务');
        const stats = await this.stateManager.getStatistics();
        console.log(`   待处理：${stats.pending}，进行中：${stats.in_progress}，被阻塞：${stats.blocked}`);
        break;
      }

      this.logger.info('orchestrator', '开始处理任务', {
        taskId: nextTask.id,
        title: nextTask.title,
        attempt: nextTask.attempts + 1,
      });

      console.log(`\n📌 任务 ${taskCount + 1}/${maxTasks}: ${nextTask.title} (${nextTask.id})`);

      // 更新任务状态为进行中
      await this.stateManager.updateTaskStatus(nextTask.id, 'in_progress');

      // 设置当前任务和阶段（用于中断时记录）
      this.currentTask = nextTask;

      try {
        // 调用 Generator Agent 执行任务
        this.currentPhase = 'generation';
        await this.runGenerator(nextTask);

        // 调用评估器验收任务
        this.currentPhase = 'evaluation';
        const attempts = await this.getTaskAttempts(nextTask.id);
        const report = await this.evaluator.evaluate(nextTask, attempts + 1);

        // 检查评估结果
        if (report.final_decision === 'pass') {
          // 评估通过
          await this.handleTaskSuccess(nextTask, report);
        } else {
          // 评估失败
          await this.handleTaskFailure(nextTask, report, 'evaluation');
        }

        // 清除当前任务标记
        this.currentTask = null;
        this.currentPhase = '';
      } catch (error) {
        // 清除当前任务标记
        this.currentTask = null;
        this.currentPhase = '';

        // 检查是否需要切换提供商
        if (shouldSwitchProvider(error)) {
          const errorType = parseErrorType(error);
          const switched = await this.handleProviderSwitch(
            errorType === 'rate_limit' ? 'rate_limit' : 'usage_limit'
          );

          if (switched) {
            // 切换成功，回退任务状态以便下次重试
            await this.stateManager.updateTaskStatus(nextTask.id, 'pending');
            this.logger.info('orchestrator', '提供商切换成功，任务将重试', { taskId: nextTask.id });
            console.log('   🔄 已切换提供商，任务将重试');
            continue; // 不增加 taskCount，重试当前任务
          } else {
            // 切换失败，记录错误并退出
            await this.handleTaskError(nextTask, error, true);
            break; // 退出循环
          }
        }

        // 其他错误
        await this.handleTaskError(nextTask, error, false);
      }

      taskCount++;

      // 检查 Token 预算
      if (maxTokens) {
        const totalTokens = this.costTracker.getTotalTokens();
        if (totalTokens >= maxTokens) {
          this.logger.warn('orchestrator', 'Token 预算已用完', { totalTokens, maxTokens });
          console.log(`\n📊 Token 预算已用完 (${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()})，停止执行`);
          break;
        }
      }
    }

    // 输出最终统计
    await this.printFinalStats(taskCount);
  }

  /**
   * 打印当前提供商状态（简化版）
   */
  private printProviderStatus(): void {
    const current = this.providerManager.getCurrentProvider();
    if (current) {
      console.log(`📡 使用提供商配置: ${current.name} (${current.model})`);
    } else {
      console.log('📡 未配置提供商，请在 ~/.config/autorun-harness/providers/ 添加配置');
    }
  }

  /**
   * 应用当前提供商配置到环境变量
   * 启动时和切换提供商后都会调用
   */
  private async applyCurrentProvider(): Promise<void> {
    const envConfig = this.providerManager.getEnvConfig();
    if (envConfig) {
      applyProviderConfig({
        authToken: envConfig.ANTHROPIC_AUTH_TOKEN,
        baseUrl: envConfig.ANTHROPIC_BASE_URL,
        model: envConfig.ANTHROPIC_MODEL,
      });
      const provider = this.providerManager.getCurrentProvider();
      if (provider) {
        console.log(`📡 已切换到提供商: ${provider.name} (${provider.model})`);
      }
    }
  }

  /**
   * 处理提供商切换
   */
  private async handleProviderSwitch(type: 'rate_limit' | 'usage_limit'): Promise<boolean> {
    this.logger.warn('orchestrator', `检测到${type === 'rate_limit' ? '频率限制(429)' : '用量限制'}，尝试切换提供商`);

    const result = type === 'rate_limit'
      ? await this.providerManager.handleRateLimit()
      : await this.providerManager.handleUsageLimit();

    if (result.success) {
      // 应用新的提供商配置
      await this.applyCurrentProvider();

      this.logger.info('orchestrator', '提供商切换成功', {
        from: result.previousProvider,
        to: result.newProvider,
      });
      return true;
    } else {
      this.logger.error('orchestrator', '提供商切换失败', undefined, { reason: result.reason });
      console.error(`\n❌ ${result.reason}`);
      if (result.instructions) {
        console.error(result.instructions);
      }
      return false;
    }
  }

  /**
   * 处理任务成功
   */
  private async handleTaskSuccess(task: Task, report: EvaluatorReport): Promise<void> {
    await this.stateManager.updateTaskStatus(task.id, 'completed');
    await this.stateManager.appendProgress({
      timestamp: new Date().toISOString(),
      taskId: task.id,
      status: 'completed',
      details: `任务通过验收\n\n${report.summary}`,
    });

    this.logger.info('orchestrator', '任务完成', { taskId: task.id });
    console.log(`   ✅ 完成（通过验收）`);
  }

  /**
   * 处理任务失败（评估失败）
   */
  private async handleTaskFailure(task: Task, report: EvaluatorReport, phase: string): Promise<void> {
    this.logger.warn('orchestrator', '任务评估失败', {
      taskId: task.id,
      summary: report.summary,
    });

    console.log(`   ❌ 评估失败: ${report.summary}`);

    // 记录到错误收集器
    await this.failureCollector.recordFromEvaluatorReport({
      task,
      attempt: task.attempts + 1,
      errorMessage: report.summary,
      criteriaResults: report.criteria_results,
    });

    // 增加尝试次数
    const newAttempts = await this.stateManager.incrementTaskAttempts(task.id);
    await this.stateManager.addTaskNote(task.id, `尝试 #${newAttempts} 评估失败: ${report.summary}`);

    if (newAttempts >= 3) {
      // 标记为需要人工介入
      await this.stateManager.updateTaskStatus(task.id, 'needs_human');
      await this.stateManager.appendProgress({
        timestamp: new Date().toISOString(),
        taskId: task.id,
        status: 'needs_human',
        details: '评估失败次数过多，需要人工介入',
        errors: [report.feedback_for_generator],
      });

      this.logger.warn('orchestrator', '任务标记为需要人工介入', { taskId: task.id });
      console.log('   ⚠️  已标记为需要人工介入');
    } else {
      // 回退到 pending 状态
      await this.stateManager.updateTaskStatus(task.id, 'pending');
      await this.stateManager.appendProgress({
        timestamp: new Date().toISOString(),
        taskId: task.id,
        status: 'pending',
        details: `评估失败，将在下次循环重试 (${newAttempts}/3)\n\n反馈: ${report.feedback_for_generator}`,
        errors: [report.feedback_for_generator],
      });

      console.log(`   🔄 将在下次循环重试 (${newAttempts}/3)`);
    }
  }

  /**
   * 处理任务错误（异常）
   */
  private async handleTaskError(task: Task, error: unknown, allProvidersExhausted: boolean): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorType = parseErrorType(error);

    this.logger.error('orchestrator', '任务执行出错', error instanceof Error ? error : undefined, {
      taskId: task.id,
      errorType,
    });

    console.error(`   ❌ 失败: ${formatError(error)}`);

    // 记录到错误收集器
    await this.failureCollector.recordFailure({
      task,
      attempt: task.attempts + 1,
      errorType,
      errorMessage: errorMsg,
      errorStack: error instanceof Error ? error.stack : undefined,
      agentPhase: 'generation',
    });

    // 增加尝试次数
    const attempts = await this.stateManager.incrementTaskAttempts(task.id);
    await this.stateManager.addTaskNote(task.id, `尝试 #${attempts} 失败: ${errorMsg}`);

    if (allProvidersExhausted || attempts >= 3) {
      // 标记为需要人工介入
      await this.stateManager.updateTaskStatus(task.id, 'needs_human');
      await this.stateManager.appendProgress({
        timestamp: new Date().toISOString(),
        taskId: task.id,
        status: 'needs_human',
        details: allProvidersExhausted
          ? '所有提供商都不可用，需要人工介入'
          : '尝试次数过多，需要人工介入',
        errors: [errorMsg],
      });

      console.log('   ⚠️  已标记为需要人工介入');
    } else {
      // 回退到 pending 状态
      await this.stateManager.updateTaskStatus(task.id, 'pending');
      await this.stateManager.appendProgress({
        timestamp: new Date().toISOString(),
        taskId: task.id,
        status: 'pending',
        details: `任务失败，将在下次循环重试 (${attempts}/3)`,
        errors: [errorMsg],
      });
    }
  }

  /**
   * 执行生成器任务
   */
  private async runGenerator(task: Task): Promise<void> {
    const generatorDef = await this.agentLoader.loadGenerator();
    const spec = await this.stateManager.loadSpec();

    const userPrompt = `请实现以下任务。

## 当前任务

${JSON.stringify(task, null, 2)}

## 产品规格

${spec}

---

请根据任务需求和产品规格实现功能。完成后确保代码可以正常运行。
`;

    this.logger.debug('orchestrator', '开始执行生成器', { taskId: task.id });
    console.log('   🔧 开始实现...');

    // 重置消息处理器
    this.messageHandler.reset();

    const queryResult = query({
      prompt: userPrompt,
      options: {
        cwd: this.projectDir,
        systemPrompt: generatorDef.prompt,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'acceptEdits',
        maxTurns: 20,
      },
    });

    // 处理消息流
    let lastResult: { success: boolean; usage?: any; error?: string } | null = null;

    for await (const message of queryResult) {
      if (message.type === 'result') {
        lastResult = this.messageHandler.handleResult(message);

        // 记录 token 使用
        if (lastResult.usage) {
          await this.costTracker.record({
            sessionId: this.getSessionId(),
            taskId: task.id,
            agent: 'generator',
            model: this.providerManager.getCurrentProvider()?.model || 'unknown',
            inputTokens: lastResult.usage.input_tokens || 0,
            outputTokens: lastResult.usage.output_tokens || 0,
          });
        }
        break;
      } else {
        this.messageHandler.handleMessage(message);
      }
    }

    // 检查 Agent 执行结果：失败时抛出错误以触发 provider 切换
    if (!lastResult) {
      throw new Error('Agent 执行异常：未收到结果消息，可能是请求超时或被中断');
    }
    if (!lastResult.success) {
      throw new Error(lastResult.error || 'Agent 执行失败');
    }
  }

  /**
   * 输出最终统计
   */
  private async printFinalStats(taskCount: number): Promise<void> {
    const stats = await this.stateManager.getStatistics();

    console.log('\n📊 执行统计：');
    console.log(`   - 已处理任务：${taskCount}`);
    console.log(`   - 任务状态：${stats.completed} 完成 / ${stats.needs_human} 需人工 / ${stats.pending} 待处理`);

    // Token 使用报告
    this.costTracker.printReport();

    // 提供商状态
    this.providerManager.printStatus();

    // 错误摘要
    const failures = this.failureCollector.getRecords();
    if (failures.length > 0) {
      console.log(`\n⚠️  错误记录：${failures.length} 条（详见 .harness/failure.md）`);
    }
  }

  /**
   * 获取任务尝试次数
   */
  private async getTaskAttempts(taskId: string): Promise<number> {
    const tasks = await this.stateManager.loadTasks();
    const task = tasks.tasks.find((t) => t.id === taskId);
    return task?.attempts || 0;
  }

  /**
   * 获取会话 ID
   */
  private getSessionId(): string {
    return `session-${Date.now()}`;
  }

  /**
   * 获取项目状态
   */
  async getStatus(): Promise<{
    isComplete: boolean;
    statistics: any;
    nextTask: Task | null;
  }> {
    const isComplete = await this.stateManager.isProjectComplete();
    const statistics = await this.stateManager.getStatistics();
    const nextTask = await this.stateManager.getNextTask();

    return { isComplete, statistics, nextTask };
  }
}
