'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '../src', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, TextEncoder,
    require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  }, { filename });
  return module.exports;
}

function fixture() {
  const resetters = [], failures = [], reads = new Map(), writes = new Map(), records = new Map();
  const sharedCacheKeys = ['office_pages_v1', 'office_boards_v1', 'office_meetings_v1', '@SahaTakip:maintenance_plans'];
  const api = {
    bootstrapPortal: async () => ({ user: { id: 'synthetic-employee' }, sharedCacheKeys, cache: {} }),
    onPortalReset: callback => { resetters.push(callback); },
    reportPortalError: error => error,
    reportWriteFailure: error => failures.push(error),
    portalRpc: async (name, args) => {
      assert.equal(name, 'app_saha_cache');
      const current = records.get(args.key) || { value: null, revision: 0 };
      if (args.operation === 'get') {
        const result = { ...current, shared: sharedCacheKeys.includes(args.key) };
        await Promise.resolve();
        return result;
      }
      assert.equal(args.operation, 'set');
      writes.set(args.key, (writes.get(args.key) || 0) + 1);
      if (sharedCacheKeys.includes(args.key) && args.revision !== current.revision) {
        throw Object.assign(new Error('Synthetic concurrent employee edit'), { status: 409 });
      }
      const saved = { value: args.value, revision: current.revision + 1 };
      records.set(args.key, saved);
      return { ...saved, shared: sharedCacheKeys.includes(args.key) };
    },
  };
  const storage = load('portal/privateStorage.ts', { './api': api }).default;
  const coalescer = load('portal/coalescedRead.ts', { './api': api });
  const datasets = {
    office_pages: [{ id: 'synthetic-page', title: 'Synthetic page', blocks: [], created_at: '2026-10-30T00:00:00Z' }],
    office_boards: [{ id: 'synthetic-board', title: 'Synthetic board', columns: [], created_at: '2026-10-30T00:00:00Z' }],
    office_meetings: [{ id: 'synthetic-meeting', title: 'Synthetic meeting', date: '2026-10-30', action_items: [] }],
    maintenance_plans: [{ id: 'synthetic-plan', name: 'Synthetic maintenance', kind: 'preventive', frequency_days: 30, next_due_at: new Date(Date.now() + 86400000).toISOString(), active: true }],
  };
  const supabase = {
    from: table => ({
      select: () => ({
        order: async () => {
          reads.set(table, (reads.get(table) || 0) + 1);
          await Promise.resolve();
          return { data: datasets[table] || [], error: null };
        },
      }),
    }),
  };
  const dependencies = {
    '@react-native-async-storage/async-storage': storage,
    '../portal/coalescedRead': coalescer,
    './supabase': { supabase, SUPABASE_CONFIGURED: true },
    './data/repository': { newUuid: () => 'synthetic-uuid' },
    '../utils/date': { localDateISO: () => '2026-10-30' },
    '../utils/search': { matchesAnyField: () => true },
    './photoUpload': { attachmentKind: () => 'file' },
  };
  return {
    storage, records, reads, writes, failures, coalescer,
    office: load('services/officeWorkspace.ts', dependencies),
    maintenance: load('services/maintenancePlans.ts', dependencies),
    reset: () => resetters.forEach(callback => callback()),
  };
}

test('OfficeHub statistics and recent-page load hydrate each shared list once', async () => {
  const f = fixture();
  const [stats, pages, boards, meetings] = await Promise.all([
    f.office.officeStats(), f.office.listPages(), f.office.listBoards(), f.office.listMeetings(),
  ]);
  assert.equal(stats.pages, 1);
  assert.equal(stats.boards, 1);
  assert.equal(stats.meetings, 1);
  assert.equal(pages[0].id, 'synthetic-page');
  assert.equal(boards[0].id, 'synthetic-board');
  assert.equal(meetings[0].id, 'synthetic-meeting');
  for (const table of ['office_pages', 'office_boards', 'office_meetings']) assert.equal(f.reads.get(table), 1, table);
  for (const key of ['office_pages_v1', 'office_boards_v1', 'office_meetings_v1']) assert.equal(f.writes.get(key), 1, key);
  assert.equal(f.failures.length, 0);
  await f.office.listPages();
  assert.equal(f.reads.get('office_pages'), 2, 'A completed result must not become a stale read cache');
});

test('SectorHub plan count and due-soon list share one read and one cache hydration', async () => {
  const f = fixture();
  const [plans, due] = await Promise.all([f.maintenance.listPlans(), f.maintenance.dueSoon(7)]);
  assert.equal(plans.length, 1);
  assert.equal(due[0].id, plans[0].id);
  assert.equal(f.reads.get('maintenance_plans'), 1);
  assert.equal(f.writes.get('@SahaTakip:maintenance_plans'), 1);
  assert.equal(f.failures.length, 0);
});

test('an actual employee conflict still rejects once and never replays a business payload', async () => {
  const f = fixture();
  await f.office.listPages();
  const key = 'office_pages_v1';
  f.records.set(key, { value: 'external employee value', revision: 2 });
  await assert.rejects(f.storage.setItem(key, 'stale employee value'), /concurrent employee edit/);
  assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0].status, 409);
  assert.equal(f.records.get(key).value, 'external employee value');
  assert.equal(f.writes.get(key), 2, 'One hydration plus one rejected attempt; no automatic retry');
});

test('failed coalesced reads reject every caller and a later call starts fresh', async () => {
  const f = fixture();
  let attempts = 0;
  const read = () => { attempts++; return Promise.reject(new Error('Synthetic read failure')); };
  const first = f.coalescer.coalescePortalRead('synthetic-read', read);
  const second = f.coalescer.coalescePortalRead('synthetic-read', read);
  assert.equal(first, second);
  const settled = await Promise.allSettled([first, second]);
  assert.equal(attempts, 1);
  assert.ok(settled.every(result => result.status === 'rejected'));
  assert.equal(await f.coalescer.coalescePortalRead('synthetic-read', async () => 'fresh'), 'fresh');
});

test('portal reset prevents another module or employee from reusing an active read', async () => {
  const f = fixture();
  let release;
  const old = f.coalescer.coalescePortalRead('synthetic-read', () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  f.reset();
  const fresh = f.coalescer.coalescePortalRead('synthetic-read', async () => 'new employee');
  assert.notEqual(old, fresh);
  assert.equal(await fresh, 'new employee');
  release('old employee');
  assert.equal(await old, 'old employee');
});
