/**
 * 消息处理器
 * 筛选和格式化代理消息，显示阶段性进度
 */

/**
 * 工具调用信息
 */
interface ToolUse {
  id: string;
  name: string;
  input: Record<string, any>;
}

/**
 * 进度信息
 */
interface ProgressInfo {
  icon: string;
  action: string;
  detail?: string;
}

/**
 * 消息处理器配置
 */
export interface MessageHandlerConfig {
  /** 是否显示详细输出 */
  verbose?: boolean;
  /** 最大详情长度 */
  maxDetailLength?: number;
}

/**
 * 创建消息处理器
 */
export function createMessageHandler(config: MessageHandlerConfig = {}) {
  const { verbose = false, maxDetailLength = 60 } = config;

  // 当前正在处理的工具调用（用于匹配结果）
  const pendingTools: Map<string, ToolUse> = new Map();

  // 上一条输出的类型（用于控制换行）
  let lastOutputType: 'tool' | 'text' | null = null;

  /**
   * 处理 assistant 消息
   */
  function handleAssistant(message: any): ProgressInfo[] {
    const results: ProgressInfo[] = [];
    const content = message.message?.content;

    if (!Array.isArray(content)) return results;

    for (const block of content) {
      if (block.type === 'tool_use') {
        // 记录工具调用
        pendingTools.set(block.id, {
          id: block.id,
          name: block.name,
          input: block.input,
        });

        const info = formatToolStart(block.name, block.input);
        if (info) {
          results.push(info);
        }
      } else if (block.type === 'text') {
        // 处理文本内容 - 提取关键行动声明
        const text = block.text?.trim();
        if (text) {
          const action = extractAction(text);
          if (action) {
            results.push({ icon: '💭', action });
          }
        }
      }
    }

    return results;
  }

  /**
   * 处理 tool_result 消息
   */
  function handleToolResult(message: any): ProgressInfo | null {
    const toolUseId = message.tool_use_id || message.toolUseId;
    const tool = pendingTools.get(toolUseId);

    if (!tool) return null;

    pendingTools.delete(toolUseId);

    // 只在 verbose 模式或出错时显示结果
    const isError = message.is_error || message.isError;
    if (isError) {
      const errorDetail = truncate(String(message.content || '未知错误'), maxDetailLength);
      return { icon: '❌', action: `${tool.name} 失败`, detail: errorDetail };
    }

    return null;
  }

  /**
   * 格式化工具调用开始信息
   */
  function formatToolStart(toolName: string, input: Record<string, any>): ProgressInfo | null {
    switch (toolName) {
      case 'Read': {
        const filePath = truncate(getFileName(input.file_path), maxDetailLength);
        return { icon: '📖', action: '读取文件', detail: filePath };
      }
      case 'Write': {
        const filePath = truncate(getFileName(input.file_path), maxDetailLength);
        return { icon: '✏️', action: '创建文件', detail: filePath };
      }
      case 'Edit': {
        const filePath = truncate(getFileName(input.file_path), maxDetailLength);
        return { icon: '🔧', action: '编辑文件', detail: filePath };
      }
      case 'Bash': {
        const cmd = truncate(input.command || '', maxDetailLength);
        return { icon: '⚡', action: '执行命令', detail: cmd };
      }
      case 'Glob': {
        const pattern = truncate(input.pattern || '', maxDetailLength);
        return { icon: '🔍', action: '搜索文件', detail: pattern };
      }
      case 'Grep': {
        const pattern = truncate(input.pattern || '', maxDetailLength);
        return { icon: '🔎', action: '搜索内容', detail: pattern };
      }
      default:
        return null;
    }
  }

  /**
   * 从文本中提取行动声明
   */
  function extractAction(text: string): string | null {
    // 匹配类似 "我需要..." "让我..." "首先..." "接下来..." 等行动声明
    const actionPatterns = [
      /^(我需要|让我|首先|接下来|然后|现在|我将)/m,
      /^#{1,3}\s+(.+)/m,  // Markdown 标题
    ];

    // 只提取简短的第一句或标题
    const firstLine = text.split('\n')[0];
    if (firstLine.length < 80) {
      for (const pattern of actionPatterns) {
        if (pattern.test(firstLine)) {
          return firstLine;
        }
      }
    }

    return null;
  }

  /**
   * 从路径中提取文件名
   */
  function getFileName(filePath: string): string {
    if (!filePath) return '';
    const parts = filePath.split('/');
    return parts[parts.length - 1] || filePath;
  }

  /**
   * 截断字符串
   */
  function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }

  /**
   * 输出进度信息
   */
  function printProgress(info: ProgressInfo): void {
    const parts = [info.icon, info.action];
    if (info.detail) {
      parts.push(info.detail);
    }
    console.log('   ', parts.join(' '));
    lastOutputType = 'tool';
  }

  /**
   * 处理消息
   */
  function handleMessage(message: any): void {
    if (message.type === 'assistant') {
      const infos = handleAssistant(message);
      for (const info of infos) {
        printProgress(info);
      }
    } else if (message.type === 'tool_result') {
      const info = handleToolResult(message);
      if (info) {
        printProgress(info);
      }
    }
  }

  /**
   * 处理结果消息
   */
  function handleResult(message: any): { success: boolean; usage?: any; error?: string } {
    const success = message.subtype === 'success';
    const usage = message.usage;
    const error = message.error?.message || message.error || (success ? undefined : '未知错误');

    return { success, usage, error };
  }

  /**
   * 清理状态
   */
  function reset(): void {
    pendingTools.clear();
    lastOutputType = null;
  }

  return {
    handleMessage,
    handleResult,
    reset,
  };
}

export type MessageHandler = ReturnType<typeof createMessageHandler>;
