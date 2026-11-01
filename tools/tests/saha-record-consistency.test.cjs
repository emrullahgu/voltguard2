'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
let ts;
try { ts = require('../saha-app/node_modules/typescript'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'../saha-app/node_modules/typescript'")) throw error;
  ts = require('typescript');
}
const root = path.resolve(__dirname, '../..');
const sourceRoot = path.join(root, 'tools/saha-app/src');
const baselineFiles = new Set(['portal/nativeClient.ts', 'services/officeWorkspace.ts', 'services/maintenancePlans.ts', 'services/formTemplates.ts']);
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(sourceRoot, relative);
  // Optional old-source verification never replaces a working-tree file.
  const source = process.env.VG_REVIEW_BASELINE === '1' && baselineFiles.has(relative)
    ? execFileSync('git', ['show', 'HEAD:tools/saha-app/src/' + relative], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, TextEncoder, console,
    require(name) { if (name in dependencies) return dependencies[name]; throw new Error('Unexpected dependency: ' + name); },
    ...globals,
  }, { filename });
  return module.exports;
}
const id = '10000000-0000-4000-8000-000000000001';
function fixture() {
  const tables = new Map(), cache = new Map(), calls = [], cacheWrites = [], timers = [], notices = [], resetters = [];
  const sharedCacheKeys = ['office_pages_v1', 'office_boards_v1', 'office_meetings_v1', '@SahaTakip:maintenance_plans'];
  let rejectWrite = null, rejectRead = false, rejectCache = false, sequence = 10;
  const conflict = () => Object.assign(new Error('Synthetic concurrent employee edit'), { status: 409 });
  const api = {
    bootstrapPortal: async () => ({ user: { id: 'synthetic-employee' }, sharedCacheKeys, cache: {} }),
    onPortalReset: callback => { resetters.push(callback); },
    reportPortalError: error => { notices.push(error); return error; },
    reportWriteFailure: error => { notices.push(error); },
    async portalRpc(name, args) {
      if (name === 'app_saha_cache') {
        const current = cache.get(args.key) || { value: null, revision: 0 };
        if (args.operation === 'get') return { ...current, shared: sharedCacheKeys.includes(args.key) };
        assert.equal(args.operation, 'set');
        cacheWrites.push(structuredClone(args));
        if (rejectCache) throw new Error('Synthetic optional cache unavailable');
        if (sharedCacheKeys.includes(args.key) && args.revision !== current.revision) throw conflict();
        const next = { value: args.value, revision: current.revision + 1 };
        cache.set(args.key, next);
        return { ...next, shared: sharedCacheKeys.includes(args.key) };
      }
      assert.equal(name, 'app_saha_query');
      calls.push(structuredClone(args));
      const rows = tables.get(args.table) || new Map(); tables.set(args.table, rows);
      if (args.operation === 'select' && rejectRead) throw new Error('Synthetic canonical read unavailable');
      if (args.operation !== 'select' && rejectWrite) throw rejectWrite;
      const matching = [...rows.values()].filter(record => args.filters.every(filter => {
        if (filter.op === 'eq') return record.payload[filter.field] === filter.value;
        if (filter.op === 'in') return filter.value.includes(record.payload[filter.field]);
        throw new Error('Unexpected fixture filter ' + filter.op);
      }));
      let selected = matching;
      if (args.operation === 'delete' || args.operation === 'update') {
        for (const record of matching) if (args.versions[record.payload.id] !== record.revision) throw conflict();
        for (const record of matching) {
          if (args.operation === 'delete') rows.delete(record.payload.id);
          else { record.payload = { ...record.payload, ...args.rows }; record.revision++; }
        }
      } else if (args.operation === 'insert' || args.operation === 'upsert') {
        selected = args.rows.map(input => {
          const recordId = input.id || `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
          const current = rows.get(recordId);
          if (current && args.versions[recordId] !== current.revision) throw conflict();
          const record = { payload: { ...current?.payload, ...structuredClone(input), id: recordId }, revision: (current?.revision || 0) + 1 };
          rows.set(recordId, record); return record;
        });
      }
      const versions = Object.fromEntries(selected.map(record => [record.payload.id, record.revision]));
      const data = args.operation !== 'select' && !args.returning ? null
        : args.single ? structuredClone(selected[0]?.payload || null) : selected.map(record => structuredClone(record.payload));
      return { data, versions };
    },
  };
  const client = load('portal/nativeClient.ts', { './api': api }, {
    document: { visibilityState: 'visible' },
    setInterval: callback => { timers.push(callback); return timers.length; }, clearInterval: () => {},
  });
  const storage = load('portal/privateStorage.ts', { './api': api }).default;
  const coalescer = load('portal/coalescedRead.ts', { './api': api });
  const dependencies = {
    '@react-native-async-storage/async-storage': storage,
    '../portal/coalescedRead': coalescer,
    './supabase': client,
    './data/repository': { newUuid: () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    '../utils/date': { localDateISO: () => '2026-10-31' },
    '../utils/search': { matchesAnyField: () => true }, './photoUpload': { attachmentKind: () => 'file' },
  };
  return {
    tables, cache, calls, cacheWrites, timers, notices, client,
    office: load('services/officeWorkspace.ts', dependencies), maintenance: load('services/maintenancePlans.ts', dependencies),
    formTemplates: load('services/formTemplates.ts', dependencies),
    seed(table, payload) { tables.set(table, new Map([[payload.id, { payload: structuredClone(payload), revision: 1 }]])); },
    row(table) { return tables.get(table)?.get(id); },
    remoteEdit(table) { const record = tables.get(table).get(id); record.payload.title = 'Synthetic colleague value'; record.revision++; },
    rejectWrite(error) { rejectWrite = error; }, rejectRead(value) { rejectRead = value; }, rejectCache(value) { rejectCache = value; },
    reset() { resetters.forEach(callback => callback()); },
  };
}
const officeCases = [
  { table: 'office_pages', key: 'office_pages_v1', list: 'listPages', save: 'savePage', remove: 'deletePage', row: { id, title: 'Synthetic original', blocks: [], created_at: '2026-10-31T00:00:00Z' } },
  { table: 'office_boards', key: 'office_boards_v1', list: 'listBoards', save: 'saveBoard', remove: 'deleteBoard', row: { id, title: 'Synthetic original', columns: [], created_at: '2026-10-31T00:00:00Z' } },
  { table: 'office_meetings', key: 'office_meetings_v1', list: 'listMeetings', save: 'saveMeeting', remove: 'deleteMeeting', row: { id, title: 'Synthetic original', date: '2026-10-31', action_items: [], created_at: '2026-10-31T00:00:00Z' } },
];

test('background channel notifications cannot advance a legacy editor CAS token', async () => {
  const f = fixture(); f.seed('customers', { id, title: 'Original' });
  await f.client.supabase.from('customers').select('*');
  let changed = false;
  const channel = f.client.supabase.channel('synthetic-customers').on('postgres_changes', { table: 'customers', event: '*' }, () => { changed = true; }).subscribe();
  await new Promise(setImmediate);
  f.remoteEdit('customers'); await f.timers[0]();
  assert.equal(changed, true);
  const result = await f.client.supabase.from('customers').update({ title: 'Stale editor' }).eq('id', id);
  assert.equal(result.error?.status, 409);
  assert.equal(f.calls.at(-1).versions[id], 1);
  assert.equal(f.row('customers').payload.title, 'Synthetic colleague value');
  await f.client.supabase.from('customers').select('*');
  assert.equal((await f.client.supabase.from('customers').update({ title: 'Reloaded editor' }).eq('id', id)).error, null);
  assert.equal((await f.client.supabase.from('customers').update({ title: 'Second acknowledged edit' }).eq('id', id)).error, null);
  assert.equal(f.calls.at(-1).versions[id], 3, 'Successful writes must still advance ordinary callers');
  await channel.unsubscribe();
});

for (const c of officeCases) {
  test(c.table + ': explicit draft snapshot survives unrelated reads and rejects stale save/delete without cache writes', async () => {
    const f = fixture(); f.seed(c.table, c.row);
    const [draft] = await f.office[c.list](); assert.equal(draft.serverRevision, 1);
    f.remoteEdit(c.table);
    const [fresh] = await f.office[c.list](); assert.equal(fresh.serverRevision, 2);
    const cacheBefore = f.cache.get(c.key).value, writesBefore = f.cacheWrites.length;
    await assert.rejects(f.office[c.save]({ ...draft, title: 'Stale draft' }), error => error.status === 409);
    await assert.rejects(f.office[c.remove](id, draft.serverRevision), /Sayfa silinemedi|Pano silinemedi|Toplantı silinemedi|concurrent/);
    assert.equal(f.cacheWrites.length, writesBefore);
    assert.equal(f.cache.get(c.key).value, cacheBefore);
    assert.equal(f.row(c.table).payload.title, 'Synthetic colleague value');
    const saved = await f.office[c.save]({ ...fresh, title: 'Confirmed edit' });
    assert.equal(saved.serverRevision, 3);
    assert.equal((await f.office[c.save]({ ...saved, title: 'Next confirmed edit' })).serverRevision, 4);
  });
  test(c.table + ': denied saves and failed canonical reads cannot become fallback cache data', async () => {
    const f = fixture(); f.seed(c.table, c.row);
    const [draft] = await f.office[c.list]();
    const originalCache = f.cache.get(c.key).value, writesBefore = f.cacheWrites.length;
    f.rejectWrite(Object.assign(new Error('Synthetic write denied'), { status: 403 }));
    await assert.rejects(f.office[c.save]({ ...draft, title: 'Denied edit' }), /Synthetic write denied/);
    assert.equal(f.cache.get(c.key).value, originalCache); assert.equal(f.cacheWrites.length, writesBefore);
    f.rejectRead(true);
    await assert.rejects(f.office[c.list](), /Synthetic canonical read unavailable/);
    assert.equal(f.cache.get(c.key).value, originalCache); assert.equal(f.cacheWrites.length, writesBefore);
  });
  test(c.table + ': accepted primary save stays successful when optional cache update fails', async () => {
    const f = fixture(); f.seed(c.table, c.row);
    const [draft] = await f.office[c.list](); f.rejectCache(true);
    const saved = await f.office[c.save]({ ...draft, title: 'Acknowledged before cache error' });
    assert.equal(saved.serverRevision, 2);
    assert.equal(f.row(c.table).payload.title, saved.title);
    assert.equal(f.calls.filter(call => call.operation === 'upsert').length, 1);
    assert.ok(f.notices.some(error => /cache unavailable/.test(error.message)));
  });
}

function seedMaintenance(f) {
  f.seed('maintenance_plans', { id, name: 'Synthetic plan', kind: 'preventive', frequency_days: 30, next_due_at: '2026-11-01T00:00:00Z', active: true });
}
for (const status of [403, 409, 0]) test('maintenance rejected/uncertain mutations preserve canonical cache, status ' + status, async () => {
  const f = fixture(); seedMaintenance(f);
  const [plan] = await f.maintenance.listPlans();
  const before = f.cache.get('@SahaTakip:maintenance_plans').value, cacheWrites = f.cacheWrites.length;
  const error = Object.assign(new Error('Synthetic refused or uncertain write'), { status }); f.rejectWrite(error);
  const queryCount = f.calls.length;
  await assert.rejects(f.maintenance.createPlan({ name: 'Rejected', kind: 'preventive', frequencyDays: 10, active: true }), /Synthetic refused/);
  await assert.rejects(f.maintenance.updatePlan(id, { name: 'Rejected edit' }, plan.serverRevision), /Synthetic refused/);
  await assert.rejects(f.maintenance.markDone(id, undefined, plan.serverRevision), /Synthetic refused/);
  await assert.rejects(f.maintenance.deletePlan(id, plan.serverRevision), /Synthetic refused/);
  assert.equal(f.cache.get('@SahaTakip:maintenance_plans').value, before);
  assert.equal(f.cacheWrites.length, cacheWrites);
  assert.equal(f.calls.slice(queryCount).some(call => call.operation === 'select'), false, 'No pre-mutation refresh may replace the displayed snapshot');
});
test('maintenance creation, edits and deletion require native acknowledgement and preserve returned tokens', async () => {
  const f = fixture();
  const created = await f.maintenance.createPlan({ name: 'Confirmed plan', kind: 'preventive', frequencyDays: 10, active: true });
  assert.equal(created.serverRevision, 1);
  const edited = await f.maintenance.updatePlan(created.id, { notes: 'Confirmed edit' }, created.serverRevision);
  assert.equal(edited.serverRevision, 2); assert.equal(edited.notes, 'Confirmed edit');
  const done = await f.maintenance.markDone(created.id, '2026-11-01T00:00:00Z', edited.serverRevision);
  assert.equal(done.serverRevision, 3); assert.equal(done.lastDoneAt, '2026-11-01T00:00:00Z');
  await f.maintenance.deletePlan(created.id, done.serverRevision);
  assert.equal(f.tables.get('maintenance_plans').size, 0);
  assert.equal(JSON.parse(f.cache.get('@SahaTakip:maintenance_plans').value).length, 0);
});
test('maintenance canonical read error preserves existing cache and propagates failure', async () => {
  const f = fixture(); seedMaintenance(f); await f.maintenance.listPlans();
  const before = f.cache.get('@SahaTakip:maintenance_plans').value, writes = f.cacheWrites.length; f.rejectRead(true);
  await assert.rejects(f.maintenance.listPlans(), /Synthetic canonical read unavailable/);
  assert.equal(f.cache.get('@SahaTakip:maintenance_plans').value, before); assert.equal(f.cacheWrites.length, writes);
});
test('marking a plan missing from the loaded cache cannot report success or manufacture a record', async () => {
  const f = fixture();
  await assert.rejects(f.maintenance.markDone(id, undefined, 1), /Bakım planı yüklenmedi/);
  assert.equal(f.calls.length, 0); assert.equal(f.cacheWrites.length, 0);
});
test('maintenance accepted save does not get resubmitted when the cache fails', async () => {
  const f = fixture(); f.rejectCache(true);
  const created = await f.maintenance.createPlan({ name: 'Confirmed despite cache', kind: 'preventive', frequencyDays: 10, active: true });
  assert.equal(created.serverRevision, 1); assert.equal(f.calls.filter(call => call.operation === 'insert').length, 1);
});
test('one office editor serializes drafts and advances only its own acknowledged snapshot', async () => {
  const f = fixture(); const c = officeCases[0]; f.seed(c.table, c.row);
  const [loaded] = await f.office.listPages();
  const { createSnapshotSaveQueue } = load('portal/snapshotSaveQueue.ts');
  const queue = createSnapshotSaveQueue(snapshot => f.office.savePage(snapshot)); queue.reset(loaded);
  const [first, second] = await Promise.all([queue.save({ ...loaded, title: 'First draft' }), queue.save({ ...loaded, title: 'Second draft' })]);
  assert.equal(first.serverRevision, 2); assert.equal(second.serverRevision, 3);
  assert.equal(f.row(c.table).payload.title, 'Second draft');
  f.remoteEdit(c.table);
  const count = f.calls.filter(call => call.operation === 'upsert').length;
  const failures = await Promise.allSettled([queue.save({ ...loaded, title: 'Stale draft' }), queue.save({ ...loaded, title: 'Later draft' })]);
  assert.ok(failures.every(result => result.status === 'rejected' && result.reason.status === 409));
  assert.equal(f.calls.filter(call => call.operation === 'upsert').length, count + 1, 'A failed submission must not replay any queued draft');
  const [reloaded] = await f.office.listPages(); queue.reset(reloaded);
  assert.equal((await queue.save({ ...reloaded, title: 'Explicitly reloaded editor' })).serverRevision, 5);
});
test('explicit empty snapshots cannot borrow a known token and portal reset removes legacy tokens', async () => {
  const f = fixture(); f.seed('office_pages', officeCases[0].row);
  await f.client.supabase.from('office_pages').select('*');
  const collision = await f.client.supabase.from('office_pages').upsert({ ...officeCases[0].row, title: 'Unloaded upsert' }).expectVersions({}).select().single();
  assert.equal(collision.error?.status, 409); assert.equal(f.row('office_pages').payload.title, 'Synthetic original');
  f.reset();
  const reset = await f.client.supabase.from('office_pages').update({ title: 'Former employee snapshot' }).eq('id', id);
  assert.equal(reset.error?.status, 409); assert.equal(Object.keys(f.calls.at(-1).versions).length, 0);
});
test('new office pages, boards and meetings persist, reread, and delete using acknowledged snapshots', async () => {
  const f = fixture();
  for (const c of officeCases) {
    const created = await f.office[c.save]({ title: 'Synthetic new record' });
    assert.equal(created.serverRevision, 1);
    assert.equal((await f.office[c.list]())[0].id, created.id);
    await f.office[c.remove](created.id, created.serverRevision);
    assert.equal(f.tables.get(c.table).size, 0);
    assert.equal(JSON.parse(f.cache.get(c.key).value).length, 0);
  }
});
test('changing editor records cancels a queued old draft without rebasing it onto the new snapshot', async () => {
  const { createSnapshotSaveQueue } = load('portal/snapshotSaveQueue.ts');
  const commits = [];
  const queue = createSnapshotSaveQueue(async snapshot => { commits.push(snapshot); return { ...snapshot, serverRevision: snapshot.serverRevision + 1 }; });
  const previous = { id: 'synthetic-old-page', serverRevision: 1, title: 'Old draft' };
  queue.reset(previous);
  const queued = queue.save(previous);
  queue.reset({ id: 'synthetic-new-page', serverRevision: 8, title: 'New page' });
  await assert.rejects(queued, /Düzenlenen kayıt değişti/); assert.equal(commits.length, 0);
  const saved = await queue.save({ id: 'synthetic-new-page', serverRevision: 8, title: 'New draft' });
  assert.equal(saved.serverRevision, 9); assert.equal(commits.length, 1); assert.equal(commits[0].id, 'synthetic-new-page');
});
test('checking a conflicted record preserves the draft and only an explicit recovery selection rebases it', async () => {
  const f = fixture(); const c = officeCases[0]; f.seed(c.table, c.row);
  const [loaded] = await f.office.listPages();
  const { createSnapshotSaveQueue, rebaseSnapshotDraft } = load('portal/snapshotSaveQueue.ts');
  const queue = createSnapshotSaveQueue(snapshot => f.office.savePage(snapshot)); queue.reset(loaded);
  const draft = { ...loaded, title: 'Preserved draft', blocks: [{ id: 'synthetic-block', type: 'text', text: 'Unsaved draft content' }] };
  f.remoteEdit(c.table);
  f.row(c.table).payload.parent_id = '20000000-0000-4000-8000-000000000001';
  await assert.rejects(queue.save(draft), error => error.status === 409);
  const current = await f.office.getPage(id), calls = f.calls.length;
  assert.equal(current.title, 'Synthetic colleague value'); assert.equal(draft.title, 'Preserved draft'); assert.equal(draft.serverRevision, 1);
  await assert.rejects(queue.save(draft), error => error.status === 409);
  assert.equal(f.calls.length, calls, 'A fresh read must not unlock or automatically rebase a failed draft');
  const chosen = rebaseSnapshotDraft(draft, current, ['title', 'icon', 'blocks', 'isFavorite']);
  assert.equal(chosen.parentId, current.parentId, 'Unedited server metadata must survive recovery');
  assert.equal(chosen.serverRevision, 2); assert.equal(chosen.blocks[0].text, 'Unsaved draft content');
  queue.reset(current);
  const saved = await queue.save(chosen);
  assert.equal(saved.serverRevision, 3); assert.equal(saved.title, draft.title);
  assert.equal(f.calls.at(-1).versions[id], 2);
});
test('a colleague edit after recovery preview still rejects an explicitly reapplied draft', async () => {
  const f = fixture(); const c = officeCases[1]; f.seed(c.table, c.row);
  const [loaded] = await f.office.listBoards(); f.remoteEdit(c.table);
  const current = await f.office.getBoard(id);
  const { createSnapshotSaveQueue, rebaseSnapshotDraft } = load('portal/snapshotSaveQueue.ts');
  const queue = createSnapshotSaveQueue(snapshot => f.office.saveBoard(snapshot)); queue.reset(current);
  f.remoteEdit(c.table);
  const chosen = rebaseSnapshotDraft({ ...loaded, title: 'Explicit draft' }, current, ['title', 'icon', 'description', 'columns']);
  await assert.rejects(queue.save(chosen), error => error.status === 409);
  assert.equal(f.calls.at(-1).versions[id], 2); assert.equal(f.row(c.table).revision, 3);
  assert.equal(f.row(c.table).payload.title, 'Synthetic colleague value');
});
test('recovery panel displays the actual server preview and writes only through its explicit apply button', () => {
  const createElement = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });
  const component = load('components/OfficeWriteRecovery.tsx', {
    react: { createElement },
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: styles => styles } },
    '../theme': { colors: { bg: {}, text: {}, border: {}, rose: {} }, spacing: {}, radius: {} },
  }).default;
  let checks = 0, opened = 0, applied = 0;
  const props = { checking: false, current: null, onCheck: () => { checks++; }, onOpen: () => { opened++; }, onApply: () => { applied++; } };
  const flatten = node => !node || typeof node !== 'object' ? [node] : [node, ...(node.props?.children || []).flatMap(flatten)];
  let tree = flatten(component(props));
  assert.equal(tree.filter(node => node?.type === 'Button').length, 1);
  tree.find(node => node?.type === 'Button').props.onPress(); assert.equal(checks, 1); assert.equal(applied, 0);
  tree = flatten(component({ ...props, current: { title: 'Actual server title', summary: 'Actual current server content' } }));
  assert.ok(tree.includes('Actual current server content')); assert.ok(tree.includes('Actual server title'));
  const buttons = tree.filter(node => node?.type === 'Button'); assert.equal(buttons.length, 3);
  buttons[1].props.onPress(); assert.equal(opened, 1); assert.equal(applied, 0);
  buttons[2].props.onPress(); assert.equal(applied, 1);
});
test('empty form presets send no insert and first-open initialization remains idempotent', async () => {
  const f = fixture();
  await f.formTemplates.ensureSeeded();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].table, 'form_templates'); assert.equal(f.calls[0].operation, 'select');
  assert.equal(f.cacheWrites.filter(call => call.key === '@SahaTakip:form_templates').length, 1, 'An empty preset must not rewrite the hydrated list');
  assert.equal(f.cache.get('@SahaTakip:form_templates_seeded_v1').value, '1');
  await f.formTemplates.ensureSeeded();
  assert.equal(f.calls.length, 1, 'Opening an initialized empty form library must not seed again');
});
test('first-open form initialization preserves an existing real template and inserts no presets', async () => {
  const f = fixture(); f.seed('form_templates', { id, name: 'Synthetic existing template', fields: [], category: 'Diğer' });
  await f.formTemplates.ensureSeeded();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].operation, 'select');
  assert.equal(JSON.parse(f.cache.get('@SahaTakip:form_templates').value)[0].name, 'Synthetic existing template');
  assert.equal(f.row('form_templates').payload.name, 'Synthetic existing template');
});
