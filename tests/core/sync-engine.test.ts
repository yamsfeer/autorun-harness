import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { SyncEngine } from '../../src/core/sync-engine.js';
import { StateManager } from '../../src/core/state-manager.js';
import { TaskList, DocFeature, SyncDiscrepancy } from '../../src/types/index.js';

function createTaskList(overrides?: Partial<TaskList>): TaskList {
  return {
    project: { name: 'Test', version: '1.0.0', created_at: new Date().toISOString() },
    tasks: [],
    statistics: { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, needs_human: 0 },
    ...overrides,
  };
}

describe('SyncEngine', () => {
  let tempDir: string;
  let engine: SyncEngine;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createEngine(autoFix = false): SyncEngine {
    return new SyncEngine(tempDir, { checkOnly: !autoFix, autoFix, docsDir: 'docs' });
  }

  async function setupDocs(files: Record<string, string>): Promise<void> {
    const docsDir = path.join(tempDir, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(docsDir, name), content, 'utf-8');
    }
  }

  async function setupHarness(taskList: TaskList): Promise<void> {
    const harnessDir = path.join(tempDir, '.harness');
    await fs.mkdir(harnessDir, { recursive: true });
    await fs.writeFile(
      path.join(harnessDir, 'tasks.json'),
      JSON.stringify(taskList, null, 2),
      'utf-8'
    );
  }

  // ─── parseDocs ──────────────────────────────────────────────────

  describe('parseDocs', () => {
    it('should return empty array when docs directory does not exist', async () => {
      engine = createEngine();
      const features = await engine.parseDocs();
      expect(features).toEqual([]);
    });

    it('should extract ## sections as features', async () => {
      await setupDocs({
        'DESIGN.md': '## User Authentication\n\nLogin and registration system.\n\n## Dashboard\n\nMain user dashboard.',
      });
      engine = createEngine();

      const features = await engine.parseDocs();
      const sections = features.filter(f => f.featureType === 'prd_feature');
      expect(sections).toHaveLength(2);
      expect(sections[0].name).toBe('User Authentication');
      expect(sections[1].name).toBe('Dashboard');
    });

    it('should extract API routes from inline code', async () => {
      await setupDocs({
        'API_CONTRACT.md': `
## Auth API

\`POST /api/auth/login\` — 登录
\`GET /api/auth/me\` — 获取当前用户
\`DELETE /api/auth/logout\` — 登出
`,
      });
      engine = createEngine();

      const features = await engine.parseDocs();
      const routes = features.filter(f => f.featureType === 'api_route');
      expect(routes).toHaveLength(3);
      expect(routes.map(r => r.name)).toContain('POST /api/auth/login');
      expect(routes.map(r => r.name)).toContain('GET /api/auth/me');
      expect(routes.map(r => r.name)).toContain('DELETE /api/auth/logout');
    });

    it('should extract API routes from bold markdown', async () => {
      await setupDocs({
        'API_CONTRACT.md': '**POST /api/orders** — create order\n**GET /api/orders/:id** — get order',
      });
      engine = createEngine();

      const features = await engine.parseDocs();
      const routes = features.filter(f => f.featureType === 'api_route');
      expect(routes).toHaveLength(2);
    });

    it('should extract data tables from ### headers', async () => {
      await setupDocs({
        'DATA_MODEL.md': `
## Database

### User Table
fields...

### Order Model
fields...
`,
      });
      engine = createEngine();

      const features = await engine.parseDocs();
      const tables = features.filter(f => f.featureType === 'data_table');
      expect(tables).toHaveLength(2);
    });

    it('should walk subdirectories', async () => {
      const subDir = path.join(tempDir, 'docs', 'api');
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, 'auth.md'), '## Auth\n\n`POST /api/auth/login`', 'utf-8');
      engine = createEngine();

      const features = await engine.parseDocs();
      expect(features.length).toBeGreaterThanOrEqual(2); // section + route
    });

    it('should extract from table-format API routes', async () => {
      await setupDocs({
        'API.md': `
| Method | Path | Description |
|--------|------|-------------|
| GET | \`/api/users\` | list users |
| POST | \`/api/users\` | create user |
`,
      });
      engine = createEngine();

      const features = await engine.parseDocs();
      const routes = features.filter(f => f.featureType === 'api_route');
      expect(routes.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── parseTasks ─────────────────────────────────────────────────

  describe('parseTasks', () => {
    it('should return empty task list when tasks.json does not exist', async () => {
      engine = createEngine();
      const tasks = await engine.parseTasks();
      expect(tasks.tasks).toEqual([]);
    });

    it('should load tasks from .harness/tasks.json', async () => {
      const taskList = createTaskList({
        tasks: [
          {
            id: 'T001',
            title: 'User Login',
            category: 'functional',
            priority: 'high',
            description: 'Implement login',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
      });
      await setupHarness(taskList);
      engine = createEngine();

      const tasks = await engine.parseTasks();
      expect(tasks.tasks).toHaveLength(1);
      expect(tasks.tasks[0].id).toBe('T001');
    });
  });

  // ─── compare ────────────────────────────────────────────────────

  describe('compare', () => {
    it('should detect doc_without_task when feature has no matching task', () => {
      engine = createEngine();
      const features: DocFeature[] = [
        {
          docFile: 'docs/DESIGN.md',
          featureType: 'api_route',
          name: 'POST /api/checkout',
          section: 'Checkout',
          details: { method: 'POST', route: '/api/checkout' },
          line: 42,
        },
      ];
      const taskList = createTaskList();

      const discrepancies = engine.compare(features, taskList);
      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0].type).toBe('doc_without_task');
      expect(discrepancies[0].autoFixable).toBe(true);
      expect(discrepancies[0].fixAction?.type).toBe('add_task');
    });

    it('should detect task_without_doc for completed tasks', () => {
      engine = createEngine();
      const features: DocFeature[] = [];
      const taskList = createTaskList({
        tasks: [
          {
            id: 'T001',
            title: 'Removed Feature',
            category: 'functional',
            priority: 'high',
            description: 'This feature was removed from docs',
            acceptance_criteria: [],
            dependencies: [],
            outputs: ['src/old.ts'],
            attempts: 1,
            status: 'completed',
            assigned_to: null,
            completed_at: new Date().toISOString(),
            notes: [],
          },
        ],
      });

      const discrepancies = engine.compare(features, taskList);
      const taskDiscrepancies = discrepancies.filter(d => d.type === 'task_without_doc');
      expect(taskDiscrepancies).toHaveLength(1);
      expect(taskDiscrepancies[0].autoFixable).toBe(true);
      expect(taskDiscrepancies[0].fixAction?.type).toBe('remove_task');
    });

    it('should mark incomplete tasks without doc as mark_for_review', () => {
      engine = createEngine();
      const features: DocFeature[] = [];
      const taskList = createTaskList({
        tasks: [
          {
            id: 'T001',
            title: 'Orphaned Task',
            category: 'functional',
            priority: 'medium',
            description: 'No doc backing, still in progress',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 2,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
      });

      const discrepancies = engine.compare(features, taskList);
      const taskDisc = discrepancies.find(d => d.type === 'task_without_doc');
      expect(taskDisc).toBeDefined();
      expect(taskDisc!.autoFixable).toBe(false);
      expect(taskDisc!.fixAction?.type).toBe('mark_for_review');
    });

    it('should detect code_mismatch when completed task outputs are missing', () => {
      engine = createEngine();
      const features: DocFeature[] = [
        {
          docFile: 'docs/DESIGN.md',
          featureType: 'prd_feature',
          name: 'User Login',
          section: 'Auth',
          details: {},
          line: 10,
        },
      ];
      const taskList = createTaskList({
        tasks: [
          {
            id: 'T001',
            title: 'User Login',
            category: 'functional',
            priority: 'high',
            description: 'Implement user login feature',
            acceptance_criteria: [],
            dependencies: [],
            outputs: ['src/login.ts', 'src/nonexistent.ts'],
            attempts: 1,
            status: 'completed',
            assigned_to: null,
            completed_at: new Date().toISOString(),
            notes: [],
          },
        ],
      });

      const discrepancies = engine.compare(features, taskList);
      const codeDisc = discrepancies.filter(d => d.type === 'code_mismatch');
      expect(codeDisc.length).toBeGreaterThanOrEqual(1);
    });

    it('should match features to tasks by keyword similarity', () => {
      engine = createEngine();
      const features: DocFeature[] = [
        {
          docFile: 'docs/DESIGN.md',
          featureType: 'prd_feature',
          name: 'User Login And Registration',
          section: 'Auth',
          details: {},
          line: 10,
        },
      ];
      const taskList = createTaskList({
        tasks: [
          {
            id: 'T001',
            title: 'Implement user login',
            category: 'functional',
            priority: 'high',
            description: 'Build login and registration',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
      });

      const discrepancies = engine.compare(features, taskList);
      const docWithoutTask = discrepancies.filter(d => d.type === 'doc_without_task');
      // "User Login And Registration" should partially match "Implement user login"
      // keywords: user, login, and, registration → "user" and "login" match → 2/4 >= 2 (ceil(4/2))
      expect(docWithoutTask).toHaveLength(0);
    });

    it('should return no discrepancies when everything matches', () => {
      engine = createEngine();
      const features: DocFeature[] = [
        {
          docFile: 'docs/DESIGN.md',
          featureType: 'prd_feature',
          name: 'User Login',
          section: 'Auth',
          details: {},
          line: 10,
        },
      ];
      const taskList = createTaskList({
        tasks: [
          {
            id: 'T001',
            title: 'User Login',
            category: 'functional',
            priority: 'high',
            description: 'Implement user login',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 0,
            status: 'pending',
            assigned_to: null,
            completed_at: null,
            notes: [],
          },
        ],
      });

      const discrepancies = engine.compare(features, taskList);
      expect(discrepancies).toHaveLength(0);
    });
  });

  // ─── sync (full flow) ───────────────────────────────────────────

  describe('sync', () => {
    it('should produce a report in check mode without modifying tasks', async () => {
      await setupDocs({
        'DESIGN.md': '## New Feature\n\n`POST /api/new`',
      });
      const taskList = createTaskList();
      await setupHarness(taskList);
      engine = createEngine(false);

      const report = await engine.sync();
      expect(report.mode).toBe('check');
      expect(report.parsedFeatures.length).toBeGreaterThan(0);
      expect(report.discrepancies.length).toBeGreaterThan(0);
      expect(report.fixes.every(f => !f.applied)).toBe(true);

      // 确认 tasks.json 未被修改
      const sm = new StateManager(tempDir);
      const tasks = await sm.loadTasks();
      expect(tasks.tasks).toHaveLength(0);
    });

    it('should add tasks in fix mode when docs have new features', async () => {
      await setupDocs({
        'DESIGN.md': '## Checkout\n\n`POST /api/checkout`',
      });
      const taskList = createTaskList();
      await setupHarness(taskList);
      engine = createEngine(true);

      const report = await engine.sync();
      expect(report.mode).toBe('fix');

      // 确认 tasks.json 已新增任务
      const sm = new StateManager(tempDir);
      const tasks = await sm.loadTasks();
      expect(tasks.tasks.length).toBeGreaterThan(0);
      expect(tasks.tasks.some(t => t.title.includes('POST /api/checkout') || t.title.includes('Checkout'))).toBe(true);
    });

    it('should remove completed tasks in fix mode when docs no longer mention them', async () => {
      await setupDocs({
        'DESIGN.md': '## Dashboard\n\nMain dashboard page.',
      });
      const taskList = createTaskList({
        tasks: [
          {
            id: 'T001',
            title: 'Zombie Feature',
            category: 'functional',
            priority: 'low',
            description: 'This was removed from docs',
            acceptance_criteria: [],
            dependencies: [],
            attempts: 1,
            status: 'completed',
            assigned_to: null,
            completed_at: new Date().toISOString(),
            notes: [],
          },
        ],
      });
      await setupHarness(taskList);
      engine = createEngine(true);

      const report = await engine.sync();
      const fixResults = report.fixes.filter(f => f.applied);
      expect(fixResults.length).toBeGreaterThan(0);

      // 确认已完成但文档不包含的任务被删除
      const sm = new StateManager(tempDir);
      const tasks = await sm.loadTasks();
      expect(tasks.tasks.find(t => t.id === 'T001')).toBeUndefined();
    });

    it('should handle empty docs and empty tasks gracefully', async () => {
      // 不创建 docs 目录
      const taskList = createTaskList();
      await setupHarness(taskList);
      engine = createEngine(false);

      const report = await engine.sync();
      expect(report.parsedFeatures).toHaveLength(0);
      expect(report.discrepancies).toHaveLength(0);
      expect(report.summary.totalFeatures).toBe(0);
    });

    it('should handle docs directory with no markdown files', async () => {
      const docsDir = path.join(tempDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(path.join(docsDir, 'image.png'), '', 'utf-8');
      const taskList = createTaskList();
      await setupHarness(taskList);
      engine = createEngine(false);

      const report = await engine.sync();
      expect(report.parsedFeatures).toHaveLength(0);
    });
  });

  // ─── summary ────────────────────────────────────────────────────

  describe('sync report summary', () => {
    it('should correctly count by severity', async () => {
      await setupDocs({
        'API.md': `
## Core API

\`POST /api/orders\`
\`GET /api/orders\`
\`DELETE /api/orders/:id\`

### User Table
fields...

## UI Components
A new button component.
`,
      });
      const taskList = createTaskList(); // empty
      await setupHarness(taskList);
      engine = createEngine(false);

      const report = await engine.sync();
      // api_route and data_table are high severity
      expect(report.summary.bySeverity.high).toBeGreaterThanOrEqual(3);
    });
  });
});
