'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('../saha-app/node_modules/typescript');

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function fixture(service) {
  const states = [];
  let cursor = 0, onFocus, cleanup, tree;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useCallback: callback => callback,
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
  };
  const dependencies = {
    react,
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity', FlatList: 'FlatList', StyleSheet: { create: value => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '@react-navigation/native': { useFocusEffect: callback => { onFocus = callback; }, useNavigation: () => ({ navigate() {} }) },
    '../theme': { colors: { bg: {}, text: {}, border: {} }, spacing: {}, radius: {}, typography: {} },
    '../services/extensions': { ...service, EXT_STATUS_COLOR: {}, EXT_STATUS_LABEL: {}, EXT_STATUS_ICON: {}, EXT_CATEGORY_LABEL: {} },
    '../components/EmptyState': { default: 'EmptyState', __esModule: true },
    '../components/ErrorState': { default: 'ErrorState', __esModule: true },
    '../utils/perf': { FLATLIST_DEFAULTS: {} },
  };
  const filename = path.resolve(__dirname, '../saha-app/src/screens/ExtHubScreen.tsx');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name);
    return dependencies[name];
  }, Error, Promise, Object, console }, { filename });
  const render = () => { cursor = 0; tree = module.exports.default(); return tree; };
  const list = () => tree.props.children[0];
  return { render, list, focus: () => { cleanup?.(); cleanup = onFocus(); }, blur: () => cleanup?.() };
}

test('Unconfigured external services show their failure and a retry instead of an empty list or unhandled rejection', async () => {
  let calls = 0;
  const message = 'Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.';
  const screen = fixture({ listExtIntegrations: async () => { calls++; throw Error(message); }, getExtSummary: async () => { throw Error('Summary must not run after failed listing'); } });
  screen.render(); screen.focus(); await flush(); screen.render();
  const notice = screen.list().props.ListEmptyComponent;
  assert.equal(notice.type, 'ErrorState');
  assert.equal(notice.props.title, 'Dış hizmetler kullanılamıyor');
  assert.equal(notice.props.message, message);
  assert.equal(screen.list().props.data.length, 0);
  notice.props.onRetry(); screen.render(); screen.focus(); await flush(); screen.render();
  assert.equal(calls, 2);
  assert.equal(screen.list().props.ListEmptyComponent.props.message, message);
  screen.blur();
});

test('A late external service result does not update a screen after it loses focus', async () => {
  let finish;
  const screen = fixture({ listExtIntegrations: () => new Promise(resolve => { finish = resolve; }), getExtSummary: async () => ({ total: 1 }) });
  screen.render(); screen.focus(); screen.blur();
  finish([{ id: 'synthetic-connection', category: 'messaging' }]); await flush(); screen.render();
  assert.equal(screen.list().props.data.length, 0);
  assert.equal(screen.list().props.ListEmptyComponent.type, 'Text');
});
