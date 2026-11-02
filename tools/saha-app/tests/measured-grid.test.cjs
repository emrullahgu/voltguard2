'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '../src/portal', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  }, { filename });
  return module.exports;
}

const grid = load('gridLayout.ts');
const { calculateGridLayout } = grid;

test('narrow employee modules keep full-width, readable cards', () => {
  for (const width of [0, 240, 288, 320, 360, 390, 519.99]) {
    const result = calculateGridLayout(width);
    assert.equal(result.columns, 1);
    assert.equal(result.tileWidth, Math.floor(width));
  }
});

test('column changes use the actual content width at both boundaries', () => {
  for (const [width, columns] of [[519.99, 1], [520, 2], [899.99, 2], [900, 4]]) {
    assert.equal(calculateGridLayout(width).columns, columns, String(width));
  }
  // A 920px host can leave only 873px after padding and a Windows scrollbar.
  assert.equal(calculateGridLayout(873).columns, 2);
  assert.equal(calculateGridLayout(873).tileWidth, 430);
});

test('percentage gaps fit all four desktop cards in the same row', () => {
  const result = calculateGridLayout(1000, { gap: '2%' });
  assert.equal(result.columns, 4);
  assert.equal(result.tileWidth, 235);
  assert.equal(result.tileWidth * 4 + 20 * 3, 1000);
});

test('numeric and percentage gaps never push the last tile past a fractional edge', () => {
  for (const gap of [8, 12, '2%']) {
    for (let width = 1.25; width <= 1920; width += 0.5) {
      const result = calculateGridLayout(width, { gap });
      const gapWidth = typeof gap === 'number' ? gap : width * 0.02;
      const occupied = result.tileWidth * result.columns + gapWidth * (result.columns - 1);
      assert.ok(occupied <= width + 0.00001, `${width}px / ${gap} overflowed`);
      assert.ok(width - occupied < result.columns + 0.00001, `${width}px / ${gap} wasted a column`);
    }
  }
});

test('specialized three-column and admin layouts preserve their own breakpoints', () => {
  const threeColumn = { gap: '2%', breakpoints: [[900, 3], [520, 2]] };
  assert.equal(calculateGridLayout(899, threeColumn).columns, 2);
  assert.equal(calculateGridLayout(900, threeColumn).columns, 3);
  const admin = { gap: 12, breakpoints: [[520, 2], [1100, 4], [750, 3]] };
  for (const [width, columns] of [[519, 1], [520, 2], [749.99, 2], [750, 3], [1099.99, 3], [1100, 4]]) {
    assert.equal(calculateGridLayout(width, admin).columns, columns);
  }
});

test('hidden or unmeasurable grids do not create negative or infinite tile widths', () => {
  for (const width of [-100, NaN, Infinity, -Infinity]) {
    const result = calculateGridLayout(width);
    assert.equal(result.columns, 1);
    assert.equal(result.tileWidth, 0);
  }
});

test('the hook updates from grid layout events instead of outer window dimensions', () => {
  let measured = null;
  let outerWidth = 1440;
  const { useMeasuredGrid } = load('useMeasuredGrid.ts', {
    react: {
      useState: () => [measured, value => { measured = value; }],
      useCallback: callback => callback,
    },
    './gridLayout': grid,
    './moduleDimensions': { useModuleDimensions: () => ({ width: outerWidth }) },
  });
  const render = () => useMeasuredGrid({ gap: 12, horizontalPadding: 16, maxWidth: 1200 });
  assert.equal(render().tileWidth, 291);
  render().onGridLayout({ nativeEvent: { layout: { width: 985 } } });
  assert.equal(render().tileWidth, 237);
  outerWidth = 1600;
  assert.equal(render().tileWidth, 237);
  render().onGridLayout({ nativeEvent: { layout: { width: 519.5 } } });
  assert.equal(render().columns, 1);
  assert.equal(render().tileWidth, 519);
  render().onGridLayout({ nativeEvent: { layout: { width: NaN } } });
  assert.equal(render().tileWidth, 519);
});
