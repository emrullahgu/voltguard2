'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../../js/power-quality.js');

test('Harmonic model matches independent RMS integration and attenuation', () => {
  const result = calculate([30, 40, 0], 80);
  assert.equal(result.inputThd, 50);
  assert.ok(Math.abs(result.outputThd - 10) < 1e-12);
  let energy = 0;
  const n = 10000;
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / n;
    energy += (230 * Math.SQRT2 * (Math.sin(t) + .3 * Math.sin(3*t) + .4 * Math.sin(5*t))) ** 2;
  }
  assert.ok(Math.abs(Math.sqrt(energy / n) - result.inputRms) < 1e-8);
  assert.equal(calculate([0, 0, 0], 100).outputRms, 230);
  assert.equal(calculate([30, 40, 0], 100).outputThd, 0);
});

test('Harmonic model rejects missing, nonfinite and out-of-domain values', () => {
  for (const values of [[], [1, 2], [0, 0, NaN], [-1, 0, 0], [51, 0, 0], ['2', 0, 0]]) {
    assert.throws(() => calculate(values, 80), RangeError);
  }
  for (const value of [NaN, Infinity, -1, 101]) assert.throws(() => calculate([1, 2, 3], value), RangeError);
});
