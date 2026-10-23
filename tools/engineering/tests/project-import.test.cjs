'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const core = require('../src/shared/engineering-core.js');
const read = file => fs.readFileSync(path.join(__dirname, '../src/shared', file), 'utf8');

test('Invalid prospective engineering projects preserve every current field and result', () => {
  const id = 'guc-ucgeni', tool = core.tools[id];
  const values = Object.fromEntries(tool.fields.map(field => [field.id, String(field.value)]));
  const inputs = Object.fromEntries(Object.entries(values).map(([key, value]) => ['eng-' + key, { value }]));
  let calculations = 0;
  const context = vm.createContext({ core, id, tool, $: key => inputs[key], calculate: () => calculations++ });
  const source = read('engineering-ui.js');
  vm.runInContext(source.slice(source.indexOf('function setState('), source.indexOf("form.addEventListener('submit'")), context);
  const before = JSON.stringify(inputs);
  for (const invalid of [{ P: '-1' }, { pf: '1.5' }, { kind: 'unsupported' }]) {
    assert.throws(() => context.setState({ version: 1, tool: id, values: { ...values, ...invalid } }));
    assert.equal(JSON.stringify(inputs), before);
    assert.equal(calculations, 0);
  }
  context.setState({ version: 1, tool: id, values: { ...values, P: '75' } });
  assert.equal(inputs['eng-P'].value, '75');
  assert.equal(calculations, 1);
});

test('A duplicate scalar snapshot cannot overwrite the validated native project model', async () => {
  const input = { id: 'eng-P', tagName: 'INPUT', type: 'number', value: '10', closest: () => null };
  const status = { textContent: '', dataset: {} };
  const window = { VoltGuardExportAdapter: { setState: value => { input.value = value.power; } } };
  const document = { readyState: 'loading', body: { dataset: { vgTool: 'fixture', vgStorageKeys: '[]' } }, getElementById: id => id === 'vg-export-status' ? status : input, querySelectorAll: () => [input], addEventListener() {} };
  const context = vm.createContext({ window, document, URL, location: { href: 'https://example.invalid/araclar/fixture/', pathname: '/araclar/fixture/' } });
  vm.runInContext(read('export.js'), context);
  const project = { format: 'voltguard-project', version: 1, tool: 'fixture', storage: {}, nativeState: { power: '75' }, fields: [{ id: 'eng-P', tag: 'INPUT', type: 'number', index: 0, value: '-999' }] };
  await window.VoltGuardExports.importProject({ size: 100, text: async () => JSON.stringify(project) });
  assert.equal(input.value, '75');
  assert.match(status.textContent, /Proje açıldı/);
});
