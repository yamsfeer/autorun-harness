import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import { chromium } from 'playwright';
import { CheckResult, ProjectLevelMetrics } from './types.js';

const execFileAsync = promisify(execFile);

interface ProjectLevelOptions {
  devServerUrl: string;
  devServerTimeout: number;
}

/**
 * 计算第二层：项目级指标
 * 执行 Shell 命令自动化检查
 */
export async function computeProjectLevelMetrics(
  projectDir: string,
  options: ProjectLevelOptions
): Promise<ProjectLevelMetrics> {
  return {
    correctness: {
      buildSuccess: await checkBuildSuccess(projectDir),
      testPassRate: await checkTestPassRate(projectDir),
    },
    stability: {
      devServerStartup: await checkDevServerStartup(projectDir, options),
      runtimeNoCrash: await checkRuntimeNoCrash(projectDir, options),
    },
    quality: {
      typeScriptErrors: await checkTypeScriptErrors(projectDir),
      eslintIssues: await checkEslintIssues(projectDir),
      auditVulnerabilities: await checkNpmAudit(projectDir),
    },
  };
}

// ===== 辅助函数 =====

/**
 * 通用检查执行器
 */
async function runCheck(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; timeout?: number },
  parser: (stdout: string, stderr: string, exitCode: number) => Omit<CheckResult, 'durationMs'>
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeout || 60000,
      shell: true,
    });
    const durationMs = Date.now() - start;
    const result = parser(stdout, stderr, 0);
    return { ...result, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    if (err.code === 'ENOENT') {
      return { name, status: 'skipped', value: false, details: `命令不存在: ${command}`, durationMs };
    }
    const exitCode = err.status ?? -1;
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    if (exitCode !== 0) {
      const result = parser(stdout, stderr, exitCode);
      return { ...result, durationMs };
    }
    return {
      name,
      status: 'error',
      value: false,
      error: err.message,
      durationMs,
    };
  }
}

/**
 * 检查 package.json 中的脚本是否存在
 */
async function hasScript(projectDir: string, scriptName: string): Promise<boolean> {
  try {
    const content = await fs.readFile(path.join(projectDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);
    return !!pkg.scripts?.[scriptName];
  } catch {
    return false;
  }
}

/**
 * 检查文件是否存在
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ===== 正确性检查 =====

async function checkBuildSuccess(projectDir: string): Promise<CheckResult> {
  const name = '构建成功';
  if (!(await fileExists(path.join(projectDir, 'package.json')))) {
    return { name, status: 'skipped', value: false, details: '无 package.json', durationMs: 0 };
  }
  if (!(await hasScript(projectDir, 'build'))) {
    return { name, status: 'skipped', value: false, details: '无 build 脚本', durationMs: 0 };
  }

  return runCheck(name, 'npm', ['run', 'build'], { cwd: projectDir, timeout: 120000 }, (_stdout, stderr, exitCode) => {
    if (exitCode === 0) {
      return { name, status: 'pass', value: true, details: '构建成功' };
    }
    const errorLines = stderr.trim().split('\n').slice(-3).join('\n');
    return { name, status: 'fail', value: false, details: errorLines };
  });
}

async function checkTestPassRate(projectDir: string): Promise<CheckResult> {
  const name = '测试通过率';
  if (!(await fileExists(path.join(projectDir, 'package.json')))) {
    return { name, status: 'skipped', value: false, details: '无 package.json', durationMs: 0 };
  }
  if (!(await hasScript(projectDir, 'test'))) {
    return { name, status: 'skipped', value: false, details: '无 test 脚本', durationMs: 0 };
  }

  return runCheck(name, 'npm', ['test'], { cwd: projectDir, timeout: 120000 }, (stdout, stderr, _exitCode) => {
    const output = stdout + '\n' + stderr;

    // 尝试匹配 jest/vitest 格式
    const jestMatch = output.match(/Tests:\s+(\d+) passed[^,]*(?:,\s+(\d+) failed)?[^,]*(?:,\s+(\d+) total)?/);
    if (jestMatch) {
      const passed = parseInt(jestMatch[1] || '0');
      const failed = parseInt(jestMatch[2] || '0');
      const total = parseInt(jestMatch[3] || String(passed + failed));
      const rate = total > 0 ? passed / total : 0;
      return {
        name,
        status: failed === 0 ? 'pass' : 'fail',
        value: rate,
        details: `${passed}/${total} 通过` + (failed > 0 ? `，${failed} 个失败` : ''),
      };
    }

    // 尝试匹配 vitest 另一种格式
    const vitestMatch = output.match(/(\d+) passed.*?(\d+) failed/);
    if (vitestMatch) {
      const passed = parseInt(vitestMatch[1]);
      const failed = parseInt(vitestMatch[2]);
      const total = passed + failed;
      const rate = total > 0 ? passed / total : 0;
      return {
        name,
        status: failed === 0 ? 'pass' : 'fail',
        value: rate,
        details: `${passed}/${total} 通过` + (failed > 0 ? `，${failed} 个失败` : ''),
      };
    }

    // 尝试匹配 mocha 格式
    const mochaMatch = output.match(/(\d+) passing.*?(\d+) failing/);
    if (mochaMatch) {
      const passed = parseInt(mochaMatch[1]);
      const failed = parseInt(mochaMatch[2]);
      const total = passed + failed;
      const rate = total > 0 ? passed / total : 0;
      return {
        name,
        status: failed === 0 ? 'pass' : 'fail',
        value: rate,
        details: `${passed}/${total} 通过` + (failed > 0 ? `，${failed} 个失败` : ''),
      };
    }

    // 无法解析输出，按退出码判断
    return {
      name,
      status: 'error',
      value: false,
      details: '无法解析测试输出',
      error: output.slice(-200),
    };
  });
}

// ===== 稳定性检查 =====

async function checkDevServerStartup(
  projectDir: string,
  options: ProjectLevelOptions
): Promise<CheckResult> {
  const name = '开发服务器启动';
  const start = Date.now();

  // 先检查 URL 是否已经响应
  const alreadyUp = await checkUrl(options.devServerUrl, 2000);
  if (alreadyUp) {
    return { name, status: 'pass', value: true, details: '服务器已运行', durationMs: Date.now() - start };
  }

  // 尝试启动 dev server
  if (!(await hasScript(projectDir, 'dev')) && !(await hasScript(projectDir, 'start'))) {
    return {
      name,
      status: 'skipped',
      value: false,
      details: '服务器未运行且无 dev/start 脚本',
      durationMs: Date.now() - start,
    };
  }

  const script = (await hasScript(projectDir, 'dev')) ? 'dev' : 'start';

  try {
    const child = execFile('npm', ['run', script], { cwd: projectDir, shell: true });
    const childPid = child.pid;

    // 轮询等待服务器响应
    const up = await pollUrl(options.devServerUrl, options.devServerTimeout);

    // 清理进程
    if (childPid) {
      try {
        process.kill(childPid);
      } catch {
        // 进程可能已退出
      }
    }

    if (up) {
      return { name, status: 'pass', value: true, details: `服务器在 ${(Date.now() - start) / 1000}s 内启动`, durationMs: Date.now() - start };
    } else {
      return { name, status: 'fail', value: false, details: `服务器在 ${options.devServerTimeout}s 内未响应`, durationMs: Date.now() - start };
    }
  } catch (err: any) {
    return { name, status: 'error', value: false, error: err.message, durationMs: Date.now() - start };
  }
}

async function checkRuntimeNoCrash(
  projectDir: string,
  options: ProjectLevelOptions
): Promise<CheckResult> {
  const name = '运行时零崩溃';
  const start = Date.now();

  // 检查服务器是否可达
  const isUp = await checkUrl(options.devServerUrl, 3000);
  if (!isUp) {
    return {
      name,
      status: 'skipped',
      value: false,
      details: '开发服务器未运行，跳过运行时检查',
      durationMs: Date.now() - start,
    };
  }

  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const jsErrors: string[] = [];
    page.on('pageerror', (error: Error) => {
      jsErrors.push(error.message);
    });

    await page.goto(options.devServerUrl, { waitUntil: 'networkidle', timeout: 10000 });
    // 等待 5 秒观察是否有 JS 错误
    await new Promise(resolve => setTimeout(resolve, 5000));

    await browser.close();

    if (jsErrors.length === 0) {
      return { name, status: 'pass', value: true, details: '0 个 JS 错误', durationMs: Date.now() - start };
    } else {
      return {
        name,
        status: 'fail',
        value: false,
        details: `${jsErrors.length} 个 JS 错误: ${jsErrors[0].slice(0, 100)}`,
        durationMs: Date.now() - start,
      };
    }
  } catch (err: any) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    if (err.message?.includes("Executable doesn't exist")) {
      return {
        name,
        status: 'skipped',
        value: false,
        details: 'Playwright 浏览器未安装（运行 npx playwright install）',
        durationMs: Date.now() - start,
      };
    }
    return { name, status: 'error', value: false, error: err.message, durationMs: Date.now() - start };
  }
}

// ===== 质量检查 =====

async function checkTypeScriptErrors(projectDir: string): Promise<CheckResult> {
  const name = 'TypeScript 错误数';
  if (!(await fileExists(path.join(projectDir, 'tsconfig.json')))) {
    return { name, status: 'skipped', value: false, details: '无 tsconfig.json', durationMs: 0 };
  }

  return runCheck(name, 'npx', ['tsc', '--noEmit'], { cwd: projectDir, timeout: 60000 }, (_stdout, stderr, exitCode) => {
    if (exitCode === 0) {
      return { name, status: 'pass', value: 0, details: '0 个错误' };
    }

    // 尝试解析 "Found N errors"
    const match = stderr.match(/Found (\d+) error/);
    const errorCount = match ? parseInt(match[1]) : -1;

    if (errorCount >= 0) {
      return { name, status: 'fail', value: errorCount, details: `${errorCount} 个 TypeScript 错误` };
    }

    // 尝试从 stderr 统计错误行
    const errorLines = stderr.split('\n').filter(l => l.includes('error TS'));
    const count = errorLines.length;
    return {
      name,
      status: count === 0 ? 'error' : 'fail',
      value: count,
      details: count > 0 ? `${count} 个 TypeScript 错误` : '无法解析 tsc 输出',
    };
  });
}

async function checkEslintIssues(projectDir: string): Promise<CheckResult> {
  const name = 'ESLint 问题数';

  // 检查是否有 eslint 配置
  const configFiles = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.cjs'];
  const hasConfig = await Promise.all(
    configFiles.map(f => fileExists(path.join(projectDir, f)))
  );
  const hasFlatConfig = await fileExists(path.join(projectDir, 'eslint.config.js')) ||
    await fileExists(path.join(projectDir, 'eslint.config.mjs')) ||
    await fileExists(path.join(projectDir, 'eslint.config.cjs'));

  if (!hasConfig.includes(true) && !hasFlatConfig) {
    return { name, status: 'skipped', value: false, details: '无 ESLint 配置', durationMs: 0 };
  }

  return runCheck(name, 'npx', ['eslint', '.', '--format', 'json'], { cwd: projectDir, timeout: 60000 }, (stdout, _stderr, exitCode) => {
    try {
      const results = JSON.parse(stdout);
      let totalErrors = 0;
      let totalWarnings = 0;

      for (const fileResult of results) {
        totalErrors += fileResult.errorCount || 0;
        totalWarnings += fileResult.warningCount || 0;
      }

      const total = totalErrors + totalWarnings;
      if (exitCode === 0 || total === 0) {
        return { name, status: 'pass', value: 0, details: '0 个问题' };
      }
      return {
        name,
        status: 'fail',
        value: total,
        details: `${totalErrors} 个错误，${totalWarnings} 个警告`,
      };
    } catch {
      return { name, status: 'error', value: false, details: '无法解析 ESLint 输出' };
    }
  });
}

async function checkNpmAudit(projectDir: string): Promise<CheckResult> {
  const name = '安全漏洞数';
  if (!(await fileExists(path.join(projectDir, 'package-lock.json')))) {
    return { name, status: 'skipped', value: false, details: '无 package-lock.json', durationMs: 0 };
  }

  return runCheck(name, 'npm', ['audit', '--json'], { cwd: projectDir, timeout: 30000 }, (stdout, _stderr, _exitCode) => {
    try {
      const audit = JSON.parse(stdout);
      const vulns = audit.metadata?.vulnerabilities || {};
      const high = vulns.high || 0;
      const critical = vulns.critical || 0;
      const total = high + critical;

      if (total === 0) {
        return { name, status: 'pass', value: 0, details: '0 个高危漏洞' };
      }
      return {
        name,
        status: 'fail',
        value: total,
        details: `${high} 个 high，${critical} 个 critical`,
      };
    } catch {
      return { name, status: 'error', value: false, details: '无法解析 npm audit 输出' };
    }
  });
}

// ===== HTTP 工具 =====

function checkUrl(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function pollUrl(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise(async (resolve) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await checkUrl(url, 2000)) {
        resolve(true);
        return;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    resolve(false);
  });
}
