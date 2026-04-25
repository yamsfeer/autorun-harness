import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

import { Logger, createLogger } from '../../src/core/logger.js';
import fs from 'fs/promises';

describe('Logger', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    logSpy.mockClear();
    errorSpy.mockClear();
    warnSpy.mockClear();
  });

  describe('createLogger', () => {
    it('should create a Logger instance', () => {
      const logger = createLogger('/tmp/test');
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('initialize', () => {
    it('should create logs directory and set log file path', async () => {
      const logger = new Logger('/tmp/test');
      await logger.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
    });

    it('should not create directory when file output is disabled', async () => {
      const logger = new Logger('/tmp/test', { file: false });
      await logger.initialize();

      expect(fs.mkdir).not.toHaveBeenCalled();
    });

    it('should still create directory when filePath is provided but file is true by default', async () => {
      const logger = new Logger('/tmp/test', { filePath: '/custom/path.log' });
      await logger.initialize();

      // file defaults to true, so mkdir is still called with logDir
      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
    });
  });

  describe('log level filtering', () => {
    it('should skip debug when level is info', () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: true, file: false });
      logger.debug('test', 'message');

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should log info when level is info', () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: true, file: false });
      logger.info('test', 'message');

      expect(logSpy).toHaveBeenCalled();
    });

    it('should skip info when level is warn', () => {
      const logger = new Logger('/tmp/test', { level: 'warn', console: true, file: false });
      logger.info('test', 'message');

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should log warn when level is warn', () => {
      const logger = new Logger('/tmp/test', { level: 'warn', console: true, file: false });
      logger.warn('test', 'message');

      expect(warnSpy).toHaveBeenCalled();
    });

    it('should log error at any level', () => {
      const logger = new Logger('/tmp/test', { level: 'error', console: true, file: false });
      logger.error('test', 'message');

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('shortcut methods', () => {
    it('debug should call log with debug level', () => {
      const logger = new Logger('/tmp/test', { level: 'debug', console: true, file: false });
      logger.debug('mod', 'msg');

      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('info should call log with info level', () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: true, file: false });
      logger.info('mod', 'msg');

      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('warn should call log with warn level', () => {
      const logger = new Logger('/tmp/test', { level: 'warn', console: true, file: false });
      logger.warn('mod', 'msg');

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('error should log to console.error', () => {
      const logger = new Logger('/tmp/test', { level: 'error', console: true, file: false });
      logger.error('mod', 'msg');

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('console output', () => {
    it('should use console.error for error level', () => {
      const logger = new Logger('/tmp/test', { level: 'error', console: true, file: false });
      logger.error('mod', 'error message');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('error message'));
    });

    it('should use console.warn for warn level', () => {
      const logger = new Logger('/tmp/test', { level: 'warn', console: true, file: false });
      logger.warn('mod', 'warn message');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('warn message'));
    });

    it('should use console.log for info level', () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: true, file: false });
      logger.info('mod', 'info message');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('info message'));
    });

    it('should include module name in output', () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: true, file: false });
      logger.info('orchestrator', 'msg');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[orchestrator]'));
    });

    it('should include JSON data in output', () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: true, file: false });
      logger.info('mod', 'msg', { key: 'value' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"key":"value"'));
    });
  });

  describe('error with Error object', () => {
    it('should extract error name and message', () => {
      const logger = new Logger('/tmp/test', { level: 'error', console: true, file: false });
      const err = new Error('test error');
      logger.error('mod', 'failed', err);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('test error'));
    });

    it('should include stack trace in debug mode', () => {
      const logger = new Logger('/tmp/test', { level: 'debug', console: true, file: false });
      const err = new Error('test error');
      logger.error('mod', 'failed', err);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: test error'));
    });
  });

  describe('file output', () => {
    it('should append to log file when file is enabled', async () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: false, file: true });
      await logger.initialize();
      logger.info('mod', 'file message');

      // logToFile is async with .catch(), need to wait a tick
      await new Promise(r => setTimeout(r, 10));

      expect(fs.appendFile).toHaveBeenCalled();
    });

    it('should not append when console is disabled and level is filtered', async () => {
      const logger = new Logger('/tmp/test', { level: 'error', console: false, file: true });
      await logger.initialize();
      logger.info('mod', 'skipped');

      await new Promise(r => setTimeout(r, 10));

      expect(fs.appendFile).not.toHaveBeenCalled();
    });
  });

  describe('no output config', () => {
    it('should not output when both console and file are disabled', () => {
      const logger = new Logger('/tmp/test', { level: 'info', console: false, file: false });
      logger.info('mod', 'msg');

      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
