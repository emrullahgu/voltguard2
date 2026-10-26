'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tep-calculator.js');
const empty = () => ({electricityKwh:0,naturalGasM3:0,dieselKg:0,lpgKg:0});
const near = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-12, `${actual} != ${expected}`);

test('TEP results match independent ETKB Ek-3 rows 56/38/29/52 with explicit units', () => {
  // ETKB row56: 1 kWh=860 kcal => 1,000 kWh=0.086 TEP (not 86 TEP).
  near(T.calculate({...empty(),electricityKwh:1000}).totalTep,0.086);
  // Row38: 1 m³=8,250 kcal => 10,000 m³=8.25 TEP.
  near(T.calculate({...empty(),naturalGasM3:10000}).totalTep,8.25);
  // Row29: 1 ton diesel=1.02 TEP; row52: 1 ton LPG=1.09 TEP.
  near(T.calculate({...empty(),dieselKg:1000}).totalTep,1.02);
  near(T.calculate({...empty(),lpgKg:1000}).totalTep,1.09);
  near(T.calculate({...empty(),dieselKg:1}).totalTep,0.00102);
  near(T.calculate({...empty(),lpgKg:1}).totalTep,0.00109);
});

test('TEP total adds four separately identifiable energy sources without density assumptions', () => {
  const input={electricityKwh:100000,naturalGasM3:10000,dieselKg:1000,lpgKg:1000};
  const result=T.calculate(input);
  assert.equal(result.ok,true); near(result.totalTep,18.96);
  assert.deepEqual(result.breakdown.map(row=>row.tep),[8.6,8.25,1.02,1.09]);
  assert.deepEqual(result.breakdown.map(row=>row.unit),['kWh','m³','kg','kg']);
  assert.deepEqual(input,{electricityKwh:100000,naturalGasM3:10000,dieselKg:1000,lpgKg:1000});
  assert.equal(T.calculate(empty()).totalTep,0);
});

test('TEP rejects invalid or missing amounts with no old result in the error object', () => {
  for(const value of [-1,NaN,Infinity,-Infinity,'1','',null,undefined]) for(const key of Object.keys(empty())) {
    const result=T.calculate({...empty(),[key]:value});
    assert.equal(result.ok,false,key+' '+String(value));
    assert.equal('totalTep' in result,false);
    assert.equal('breakdown' in result,false);
    assert.ok(result.error);
  }
  for(const input of [null,undefined,{},[],42]) assert.equal(T.calculate(input).ok,false);
  // The tool bounds each input before producing an enormous, unusable UI/PDF value.
  const huge=T.calculate({electricityKwh:Number.MAX_VALUE,naturalGasM3:Number.MAX_VALUE,dieselKg:Number.MAX_VALUE,lpgKg:Number.MAX_VALUE});
  assert.equal(huge.ok,false); assert.equal('totalTep' in huge,false);
  assert.equal(T.calculate({...empty(),electricityKwh:1e12}).ok,true);
  assert.equal(T.calculate({...empty(),electricityKwh:1e12+1}).ok,false);
});

test('TEP coefficients retain their verified primary source and exclude volume-density shortcuts', () => {
  assert.equal(T.checked,'2026-10-26');
  assert.match(T.source,/^https:\/\/enerji\.gov\.tr\/.+\/Ek-3\.xlsm$/);
  assert.deepEqual(T.fuels.map(f=>f.key),['electricityKwh','naturalGasM3','dieselKg','lpgKg']);
  assert.ok(Object.isFrozen(T.fuels)&&T.fuels.every(Object.isFrozen));
});
