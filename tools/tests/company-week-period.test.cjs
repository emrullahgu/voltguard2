'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const helper = pathToFileURL(path.resolve(__dirname,'../staff-app/src/weekPeriod.mjs')).href;

test('weekly report periods cross months, leap days and years without changing the input date',()=>{
  const source = `
    import assert from 'node:assert/strict';
    import {currentWeekPeriod} from ${JSON.stringify(helper)};
    const cases = [
      ['2026-11-01T12:00:00+03:00','2026-10-26','2026-11-01'],
      ['2027-01-01T12:00:00+03:00','2026-12-28','2027-01-03'],
      ['2027-01-04T12:00:00+03:00','2027-01-04','2027-01-10'],
      ['2028-03-01T12:00:00+03:00','2028-02-28','2028-03-05'],
      ['2026-10-25T21:30:00Z','2026-10-26','2026-11-01'],
      ['2026-12-31T22:30:00Z','2026-12-28','2027-01-03']
    ];
    for (const [value,start,end] of cases) {
      const input = new Date(value), before = input.getTime();
      assert.deepEqual(currentWeekPeriod(input),{start,end},value);
      assert.equal(input.getTime(),before,'caller date was mutated');
    }
    assert.throws(()=>currentWeekPeriod(new Date('invalid')),RangeError);
    console.log(cases.length+' local-calendar regressions passed');
  `;
  const result = spawnSync(process.execPath,['--input-type=module','-e',source],{env:{...process.env,TZ:'Europe/Istanbul'},encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/6 local-calendar regressions passed/);
});
