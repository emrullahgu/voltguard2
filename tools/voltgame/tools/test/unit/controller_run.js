'use strict';
// tools/test/unit/controller_run.js — controller ekibinin tüm birim testleri: node tools/test/unit/controller_run.js
(async () => {
  let fail = 0;
  for (const f of ['./controller_game', './controller_input', './controller_hint']) { const r = await require(f)(); console.log(`${r.name}: ${r.pass} ok, ${r.fail} fail\n`); fail += r.fail; }
  console.log(fail ? 'CONTROLLER UNIT: FAIL' : 'CONTROLLER UNIT: ALL PASS'); process.exit(fail ? 1 : 0);
})();
