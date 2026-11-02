'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
let ts;
try { ts = require('../saha-app/node_modules/typescript'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'../saha-app/node_modules/typescript'")) throw error;
  ts = require('typescript');
}
const sourceRoot = path.resolve(__dirname, '../saha-app/src');
function load(relative, dependencies, globals = {}) {
  const filename = path.join(sourceRoot, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console, Error,
    require(name) { if (name in dependencies) return dependencies[name]; throw new Error('Unexpected dependency ' + name); },
    ...globals,
  }, { filename });
  return module.exports;
}
function services() {
  const storageReads = [], storageWrites = [], notices = [], reads = [];
  let rpcCalls = 0;
  const api = {
    onPortalReset: () => {}, reportPortalError: error => { notices.push(error); return error; }, reportWriteFailure: () => {},
    bootstrapPortal: async () => ({ user: { id: 'synthetic-staff' } }),
    portalRpc: async () => { rpcCalls++; throw new Error('Unexpected external request'); },
  };
  const storage = load('portal/privateStorage.ts', { './api': api }, { TextEncoder }).default;
  const watchedStorage = {
    ...storage,
    getItem: async key => { storageReads.push(key); return storage.getItem(key); },
    setItem: async (key, value) => { storageWrites.push({ key, value }); return storage.setItem(key, value); },
  };
  const deps = {
    '../portal/api': api, '@react-native-async-storage/async-storage': watchedStorage,
    './supabase': { supabase: {}, SUPABASE_CONFIGURED: true }, './data/repository': { newUuid: () => 'synthetic-id' },
  };
  const modules = {
    '../services/governance': load('services/governance.ts', deps),
    '../services/integrations': load('services/integrations.ts', deps),
    '../services/enterpriseIntegrations': load('services/enterpriseIntegrations.ts', deps),
    '../services/parasut': load('services/parasut.ts', deps),
    '../services/extensions': load('services/extensions.ts', deps),
    '../services/advanced': load('services/advanced.ts', deps),
  };
  for (const [moduleName, names] of Object.entries({
    '../services/governance': ['listSessions'], '../services/integrations': ['listWebhooks', 'listErpAdapters'],
    '../services/enterpriseIntegrations': ['listConnections', 'listSyncJobs', 'listErpCustomers', 'listErpStock', 'listInvoiceDrafts', 'listQuoteOrders', 'listCrmConnections', 'listWebhooksV2', 'listWebhookDeliveriesV2', 'listApiKeysV2', 'listApiUsageLogs', 'listIntegrationErrors', 'listIntegrationHealth'],
    '../services/parasut': ['loadParasutSettings'],
    '../services/extensions': ['listExtIntegrations', 'getExtSummary', 'getExtIntegration', 'getExtLogs'],
    '../services/advanced': ['listEcomChannels', 'listEcomOrders', 'listCallAgents', 'listCallRecords', 'listBIDatasets', 'listVoiceTranscripts', 'listCollectionForecasts', 'listRfmCustomers'],
  })) for (const name of names) {
    const original = modules[moduleName][name];
    modules[moduleName][name] = (...args) => { reads.push(name); return original(...args); };
  }
  return { modules, storage, storageReads, storageWrites, notices, reads, rpcCalls: () => rpcCalls };
}
const colors = new Proxy({}, { get: () => new Proxy({}, { get: () => '#123456' }) });
const numbers = new Proxy({}, { get: () => 12 });
function screen(relative, modules, hosted = true, options = {}) {
  const slots = [], effects = [], alerts = [], navigation = [];
  let cursor = 0, dirty = true, tree;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
    return [slots[index].value, value => {
      const next = typeof value === 'function' ? value(slots[index].value) : value;
      if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
    }];
  };
  const useMemo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !depsEqual(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const useCallback = (callback, deps) => useMemo(() => callback, deps);
  const useRef = initial => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: { current: initial } };
    return slots[index].value;
  };
  const useEffect = (callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !depsEqual(slots[index].deps, deps)) {
      slots[index]?.cleanup?.(); slots[index] = { deps };
      effects.push(() => { slots[index].cleanup = callback(); });
    }
  };
  const useFocusEffect = callback => {
    const index = cursor++;
    if (!slots[index] || slots[index].callback !== callback) {
      slots[index]?.cleanup?.(); slots[index] = { callback };
      effects.push(() => { slots[index].cleanup = callback(); });
    }
  };
  const createElement = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });
  const react = { createElement, useState, useMemo, useCallback, useRef, useEffect, Fragment: 'Fragment' };
  const serviceLoad = load('portal/useServiceLoad.ts', { react });
  const dependencies = {
    ...modules, react,
    'react-native': {
      View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', FlatList: 'FlatList', ScrollView: 'ScrollView',
      TouchableOpacity: 'Button', ActivityIndicator: 'Loading', Modal: 'Modal', TextInput: 'TextInput', Switch: 'Switch', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' },
      StyleSheet: { create: value => value }, Alert: { alert: (...args) => { alerts.push(args); } },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '@react-navigation/native': { useFocusEffect, useNavigation: () => ({ navigate: (...args) => navigation.push(args), goBack: () => navigation.push(['back']) }), useRoute: () => ({ params: options.params === undefined ? { id: 'synthetic-id', connectionId: 'synthetic-id', webhookId: 'synthetic-id' } : options.params }) },
    '../theme': { colors, spacing: numbers, radius: numbers, typography: numbers, brand: {} },
    '../components/ErrorState': { default: 'ErrorState', __esModule: true }, '../components/EmptyState': { default: 'EmptyState', __esModule: true },
    '../utils/perf': { FLATLIST_DEFAULTS: {} }, '../utils/money': { formatTRY: value => String(value) },
    '../context/AuthContext': { useAuth: () => ({ hasPermission: () => true }) },
    '../components/RoleGuard': { useHasRole: () => options.hasRole !== false },
    '../portal/useServiceLoad': serviceLoad,
  };
  const component = load(relative, dependencies, hosted ? { window: { VoltGuardEmployeeModules: {} } } : {}).default;
  const render = () => { cursor = 0; dirty = false; tree = component(); while (typeof tree?.type === 'function') tree = tree.type(tree.props); return tree; };
  const flatten = node => {
    if (!node || typeof node !== 'object') return [node];
    const result = [node, ...(node.props?.children || []).flatMap(flatten)];
    if (node.type === 'FlatList') {
      result.push(...flatten(node.props.ListHeaderComponent));
      if (node.props.data?.length) for (const item of node.props.data) result.push(...flatten(node.props.renderItem({ item })));
      else result.push(...flatten(node.props.ListEmptyComponent));
    }
    return result;
  };
  return {
    alerts, navigation,
    nodes: () => flatten(tree),
    render,
    async flush() {
      for (let round = 0; round < 20; round++) {
        if (dirty) render();
        for (const effect of effects.splice(0)) effect();
        await new Promise(setImmediate);
        if (!dirty && effects.length === 0) return;
      }
      throw new Error('Screen did not settle');
    },
  };
}
const cases = [
  ['SessionLogsScreen', 'Oturum kayıtları kullanılamıyor'],
  ['SuspiciousLoginsScreen', 'Şüpheli giriş denetimi kullanılamıyor'],
  ['WebhooksScreen', 'Webhook servisi kullanılamıyor'],
  ['ErpAdaptersScreen', 'ERP adaptör servisi kullanılamıyor'],
  ['ParasutSettingsScreen', 'Paraşüt servisi kullanılamıyor'],
  ['ErpConnectionsScreen', 'ERP bağlantı servisi kullanılamıyor'],
  ['ExtHubScreen', 'Dış hizmetler kullanılamıyor'],
  ...['ApiUsageLogs', 'CrmConnections', 'ErpConnectionForm', 'ErpCustomers', 'ErpInvoiceDrafts', 'ErpStock', 'ErpSyncJobs', 'ExtConfig', 'ExtLogs', 'IntegrationApiKeys', 'IntegrationErrors', 'IntegrationHealth', 'IntegrationWebhookDeliveries', 'IntegrationWebhookForm', 'IntegrationWebhooks', 'QuoteToOrder']
    .map(name => [name + 'Screen', 'Entegrasyon servisi kullanılamıyor']),
  ['AdvEcommerceScreen', 'E-ticaret servisi kullanılamıyor'],
  ['AdvCallCenterScreen', 'Çağrı merkezi servisi kullanılamıyor'],
  ['AdvBIScreen', 'BI servisi kullanılamıyor'],
  ['AdvVoiceAIScreen', 'Sesli yapay zekâ servisi kullanılamıyor'],
  ['AdvCollectionForecastScreen', 'Tahsilat tahmin servisi kullanılamıyor'],
  ['AdvRfmScreen', 'RFM servisi kullanılamıyor'],
];
for (const [name, title] of cases) test(name + ': actual closed service mounts as unavailable with a handled retry and no write/demo controls', async () => {
  const f = services(), view = screen('screens/' + name + '.tsx', f.modules);
  await view.flush();
  const error = view.nodes().find(node => node?.type === 'ErrorState');
  assert.ok(error); assert.equal(error.props.title, title); assert.match(error.props.message, /bağlı değil|yapılandırılmadı/);
  assert.equal(view.nodes().some(node => ['Button', 'Switch', 'Modal', 'EmptyState', 'FlatList'].includes(node?.type)), false, 'Unavailable services must expose no success list or unsupported mutations');
  const before = f.reads.length;
  await error.props.onRetry(); await view.flush();
  assert.ok(view.nodes().some(node => node?.type === 'ErrorState'));
  if (name.startsWith('Session') || name.startsWith('Suspicious')) assert.equal(f.reads.length, 0, 'Hosted audit screens must not read the unbound cache');
  else assert.ok(f.reads.length > before, 'Retry must really check the service again');
  assert.equal(f.storageWrites.length, 0); assert.equal(f.rpcCalls(), 0); assert.equal(view.alerts.length, 0);
});
for (const name of ['SessionLogsScreen', 'SuspiciousLoginsScreen']) test(name + ': credential cache rejection is caught outside the host and the guard stays intact', async () => {
  const f = services(), view = screen('screens/' + name + '.tsx', f.modules, false);
  await view.flush();
  assert.ok(view.nodes().some(node => node?.type === 'ErrorState'));
  assert.deepEqual(f.storageReads, ['gov_sessions_v1']);
  await assert.rejects(f.storage.getItem('gov_sessions_v1'), /Kimlik bilgileri ve anahtarlar/);
  assert.equal(f.storageWrites.length, 0); assert.equal(f.rpcCalls(), 0);
});
for (const c of [
  { screen: 'WebhooksScreen', module: '../services/integrations', read: 'listWebhooks', data: [{ id: 'synthetic-webhook', label: 'Synthetic', events: [], active: true }], button: 'Test' },
  { screen: 'ErpAdaptersScreen', module: '../services/integrations', read: 'listErpAdapters', data: [{ id: 'synthetic-adapter', provider: 'logo', label: 'Synthetic', active: true }], button: 'Senkronize Et' },
  { screen: 'ErpConnectionsScreen', module: '../services/enterpriseIntegrations', read: 'listConnections', data: [{ id: 'synthetic-connection', vendor: 'logo', status: 'connected', name: 'Synthetic' }], button: 'Test' },
  { screen: 'ParasutSettingsScreen', module: '../services/parasut', read: 'loadParasutSettings', data: { enabled: true, invoicingEnabled: false, offersEnabled: false }, button: 'Bağlantıyı Test Et' },
]) test(c.screen + ': a rejected action after a successful read is caught and never announces success', async () => {
  const f = services(); f.modules[c.module][c.read] = async () => c.data;
  const view = screen('screens/' + c.screen + '.tsx', f.modules); await view.flush();
  const text = node => typeof node === 'string' ? node : (node?.props?.children || []).map(text).join('');
  const action = view.nodes().find(node => node?.type === 'Button' && text(node) === c.button);
  assert.ok(action); await action.props.onPress(); await view.flush();
  assert.ok(view.nodes().some(node => node?.type === 'ErrorState'));
  assert.equal(view.alerts.length, 0); assert.equal(f.storageWrites.length, 0); assert.equal(f.rpcCalls(), 0);
});
test('Paraşüt failed data fetches remain failures rather than three successful empty datasets', async () => {
  const f = services(); f.modules['../services/parasut'].loadParasutSettings = async () => ({ enabled: true });
  const view = screen('screens/ParasutSettingsScreen.tsx', f.modules); await view.flush();
  const text = node => typeof node === 'string' ? node : (node?.props?.children || []).map(text).join('');
  const action = view.nodes().find(node => node?.type === 'Button' && text(node) === 'Verileri Getir');
  assert.ok(action); await action.props.onPress(); await view.flush();
  assert.equal(view.alerts.length, 1); assert.equal(view.alerts[0][0], 'Hata'); assert.match(view.alerts[0][1], /yapılandırılmadı/);
  assert.equal(f.storageWrites.length, 0); assert.equal(f.rpcCalls(), 0);
});
for (const c of [
  { screen: 'ErpConnectionFormScreen', list: 'listConnections', save: 'saveConnection' },
  { screen: 'IntegrationWebhookFormScreen', list: 'listWebhooksV2', save: 'saveWebhookV2' },
]) {
  test(c.screen + ': new/no-id form checks the service and exits loading into unavailable', async () => {
    const f = services(), view = screen('screens/' + c.screen + '.tsx', f.modules, true, { params: {} });
    await view.flush();
    assert.ok(f.reads.includes(c.list));
    assert.ok(view.nodes().some(node => node?.type === 'ErrorState'));
    assert.equal(view.nodes().some(node => ['Loading', 'TextInput', 'Button'].includes(node?.type)), false);
  });
  test(c.screen + ': successful empty read exits loading, rejected save preserves the draft, retry reads without replaying it', async () => {
    const f = services(), module = f.modules['../services/enterpriseIntegrations'];
    let checks = 0, submissions = 0;
    module[c.list] = async () => { checks++; return []; };
    const closedSave = module[c.save]; module[c.save] = (...args) => { submissions++; return closedSave(...args); };
    const view = screen('screens/' + c.screen + '.tsx', f.modules, true, { params: {} }); await view.flush();
    assert.equal(view.nodes().some(node => node?.type === 'Loading'), false);
    const inputs = view.nodes().filter(node => node?.type === 'TextInput'); assert.ok(inputs.length > 1);
    inputs[0].props.onChangeText('Synthetic preserved draft'); inputs[1].props.onChangeText('https://synthetic.invalid'); await view.flush();
    const text = node => typeof node === 'string' ? node : (node?.props?.children || []).map(text).join('');
    const action = view.nodes().find(node => node?.type === 'Button' && text(node) === 'Kaydet');
    assert.ok(action); await action.props.onPress(); await view.flush();
    const error = view.nodes().find(node => node?.type === 'ErrorState'); assert.ok(error); assert.equal(submissions, 1);
    assert.equal(view.navigation.length, 0); assert.equal(view.alerts.length, 0);
    await error.props.onRetry(); await view.flush();
    assert.equal(checks, 2); assert.equal(submissions, 1, 'Retry must not retain or replay a rejected business action');
    assert.ok(view.nodes().some(node => node?.type === 'TextInput' && node.props.value === 'Synthetic preserved draft'));
  });
}
test('advanced collection forecast keeps the existing role guard and performs no unauthorized service read', async () => {
  const f = services(), view = screen('screens/AdvCollectionForecastScreen.tsx', f.modules, true, { hasRole: false });
  await view.flush(); assert.equal(f.reads.length, 0); assert.equal(view.nodes().some(node => node?.type === 'ErrorState'), false);
});
test('every registered screen consuming a closed integration/advanced getter has an actual-service mount regression', () => {
  const tracked = new Map();
  for (const service of ['enterpriseIntegrations', 'extensions', 'integrations', 'parasut', 'advanced']) {
    const filename = path.join(sourceRoot, 'services', service + '.ts');
    const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    tracked.set(service, new Set(ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && node.body?.statements.length === 1 && ts.isThrowStatement(node.body.statements[0])).map(node => node.name.text)));
  }
  const tested = new Set(cases.map(([name]) => name + '.tsx'));
  const navigation = fs.readFileSync(path.join(sourceRoot, 'navigation/index.tsx'), 'utf8');
  for (const filename of fs.readdirSync(path.join(sourceRoot, 'screens')).filter(file => file.endsWith('.tsx'))) {
    if (!navigation.includes(filename.slice(0, -4))) continue;
    const ast = ts.createSourceFile(filename, fs.readFileSync(path.join(sourceRoot, 'screens', filename), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const closedImports = new Set();
    for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const service = node.moduleSpecifier.text.split('/').at(-1), closed = tracked.get(service);
      if (closed) for (const specifier of node.importClause.namedBindings.elements) if (closed.has((specifier.propertyName || specifier.name).text)) closedImports.add(specifier.name.text);
    }
    let usesClosedService = false;
    const visit = node => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && closedImports.has(node.expression.text)) usesClosedService = true; ts.forEachChild(node, visit); };
    visit(ast);
    if (usesClosedService) assert.ok(tested.has(filename), filename + ' needs a real closed-service screen test');
  }
});
