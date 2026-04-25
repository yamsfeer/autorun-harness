import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMessageHandler } from '../../src/core/message-handler.js';

describe('createMessageHandler', () => {
  let handler: ReturnType<typeof createMessageHandler>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handler = createMessageHandler();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function expectConsoleContains(substring: string) {
    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls;
    const found = calls.some((call: unknown[]) =>
      call.some((arg: unknown) => typeof arg === 'string' && arg.includes(substring))
    );
    expect(found).toBe(true);
  }

  describe('handleMessage - assistant messages', () => {
    it('should handle tool_use messages', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/test.ts' } },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('读取文件');
      expectConsoleContains('test.ts');
    });

    it('should handle Write tool_use', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/src/new.ts' } },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('创建文件');
    });

    it('should handle Edit tool_use', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/src/existing.ts' } },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('编辑文件');
    });

    it('should handle Bash tool_use', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('执行命令');
      expectConsoleContains('npm test');
    });

    it('should handle Glob tool_use', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Glob', input: { pattern: 'src/**/*.ts' } },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('搜索文件');
    });

    it('should handle Grep tool_use', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Grep', input: { pattern: 'function' } },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('搜索内容');
    });

    it('should handle unknown tools silently', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'UnknownTool', input: {} },
          ],
        },
      };

      handler.handleMessage(message);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should extract action from text content', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '我需要先分析代码结构\n然后修改文件' },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('我需要先分析代码结构');
    });

    it('should extract markdown headers as actions', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '## 分析结果\n\n这是内容' },
          ],
        },
      };

      handler.handleMessage(message);
      expectConsoleContains('分析结果');
    });

    it('should ignore long text without action patterns', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '这是一段非常长的解释文字，没有任何行动声明的开头，只是单纯地在描述一些背景信息和上下文，不应该被提取为行动声明'.repeat(2) },
          ],
        },
      };

      handler.handleMessage(message);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should handle multiple content blocks', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '让我开始工作' },
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/a.ts' } },
            { type: 'tool_use', id: 'tu2', name: 'Write', input: { file_path: '/src/b.ts' } },
          ],
        },
      };

      handler.handleMessage(message);
      expect(consoleSpy).toHaveBeenCalledTimes(3);
    });

    it('should handle empty content', () => {
      const message = {
        type: 'assistant',
        message: { content: [] },
      };

      handler.handleMessage(message);
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - tool_result messages', () => {
    it('should display error results', () => {
      const assistantMsg = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/test.ts' } },
          ],
        },
      };
      handler.handleMessage(assistantMsg);
      consoleSpy.mockClear();

      const resultMsg = {
        type: 'tool_result',
        tool_use_id: 'tu1',
        is_error: true,
        content: 'File not found',
      };

      handler.handleMessage(resultMsg);
      expectConsoleContains('Read 失败');
      expectConsoleContains('File not found');
    });

    it('should ignore successful tool results', () => {
      const assistantMsg = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/test.ts' } },
          ],
        },
      };
      handler.handleMessage(assistantMsg);
      consoleSpy.mockClear();

      const resultMsg = {
        type: 'tool_result',
        tool_use_id: 'tu1',
        is_error: false,
        content: 'file content here',
      };

      handler.handleMessage(resultMsg);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should handle tool_result for unknown tool', () => {
      const resultMsg = {
        type: 'tool_result',
        tool_use_id: 'unknown-id',
        is_error: true,
        content: 'error',
      };

      handler.handleMessage(resultMsg);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should handle isError property (alternative naming)', () => {
      const assistantMsg = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } },
          ],
        },
      };
      handler.handleMessage(assistantMsg);
      consoleSpy.mockClear();

      const resultMsg = {
        type: 'tool_result',
        toolUseId: 'tu1',
        isError: true,
        content: 'Command failed',
      };

      handler.handleMessage(resultMsg);
      expectConsoleContains('Bash 失败');
    });
  });

  describe('handleResult', () => {
    it('should handle success result', () => {
      const message = {
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const result = handler.handleResult(message);
      expect(result.success).toBe(true);
      expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
      expect(result.error).toBeUndefined();
    });

    it('should handle error with errors array', () => {
      const message = {
        type: 'result',
        subtype: 'error_max_turns',
        errors: ['max turns exceeded', 'tool use failed'],
      };

      const result = handler.handleResult(message);
      expect(result.success).toBe(false);
      expect(result.error).toBe('max turns exceeded; tool use failed');
    });

    it('should handle error with error.message', () => {
      const message = {
        type: 'result',
        subtype: 'error',
        error: { message: 'something went wrong' },
      };

      const result = handler.handleResult(message);
      expect(result.success).toBe(false);
      expect(result.error).toBe('something went wrong');
    });

    it('should handle error with error object (no message)', () => {
      const message = {
        type: 'result',
        subtype: 'error',
        error: { code: 'E500' },
      };

      const result = handler.handleResult(message);
      expect(result.success).toBe(false);
      expect(result.error).toBe('[object Object]');
    });

    it('should handle error with only subtype', () => {
      const message = {
        type: 'result',
        subtype: 'error_api',
      };

      const result = handler.handleResult(message);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent 执行失败: error_api');
    });

    it('should handle unknown failure', () => {
      const message = {
        type: 'result',
      };

      const result = handler.handleResult(message);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent 执行失败（未知原因）');
    });
  });

  describe('reset', () => {
    it('should clear pending tools', () => {
      const assistantMsg = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/test.ts' } },
          ],
        },
      };
      handler.handleMessage(assistantMsg);

      handler.reset();

      const resultMsg = {
        type: 'tool_result',
        tool_use_id: 'tu1',
        is_error: true,
        content: 'error',
      };

      handler.handleMessage(resultMsg);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('verbose mode', () => {
    it('should accept verbose config', () => {
      const verboseHandler = createMessageHandler({ verbose: true, maxDetailLength: 100 });
      expect(verboseHandler).toBeDefined();
    });
  });
});
