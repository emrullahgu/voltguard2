'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../src2/main.js'), 'utf8');
for (const failing of ['scene', 'camera', 'diorama', 'flow', 'volti', 'gesture', 'keyboard', 'game']) {
  const frames = [], overlays = [], PX = { STR: {} };
  for (const name of ['store','scene','camera','diorama','flow','volti','hud','sld','cards','screens','world','audio','gesture','keyboard','game','debug']) {
    PX[name] = { init() { if (name === failing) throw new Error('simulated failure'); }, setViewport() {}, install() {} };
  }
  const context = {
    PX, THREE: {}, console: { error() {} }, Float32Array, performance: { now: () => 1 },
    requestAnimationFrame: fn => frames.push(fn), window: {}, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return {}; },
      createElement() { return { dataset: {}, style: {} }; }, body: { appendChild: el => overlays.push(el) } },
  };
  vm.runInNewContext(source, context);
  PX.main.boot(); PX.main.boot();
  assert.equal(overlays.length, 1, failing + ': actionable startup error shown once');
  assert.equal(overlays[0].dataset.testid, 'startup-error');
  assert.equal(frames.length, 0, failing + ': failed startup does not start a broken animation loop');
}
console.log('runtime regressions: 24 checks passed');
