'use strict';
// Kurallar: Worker kaynağı kurulumu. Build çıktısındaki PX.WORKER_SRC'den sim2 tanımı ÇIKARILDIĞINDA (worker.lib
// isteği, _requests/rules.md) solverClient'in sim2'yi ana betiğin //#SIM2-BEGIN…END bölgesinden geri kurduğunu,
// ve kurulan Worker kaynağının Node'da çalışıp gerçek tabloları ürettiğini doğrular.
//   node tools/test/unit/rules_worksrc.js [--file dev/v2-rules.html]
const fs = require('fs');
const path = require('path');
const T = require('./rules_lib.js');
const { ok } = T;
const arg = process.argv.find(a => a.startsWith('--file=')) || '';
const argIndex = process.argv.indexOf('--file');
const FILE = path.resolve(arg ? arg.slice(7) : argIndex >= 0 && process.argv[argIndex + 1] ? process.argv[argIndex + 1] : path.join(T.ROOT, 'index.html'));
const html = fs.readFileSync(FILE, 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const wStart = script.indexOf('window.PX.WORKER_SRC = ') + 'window.PX.WORKER_SRC = '.length;
const full = JSON.parse(script.slice(wStart, script.indexOf(';\n//#WORKER-END')));
// sim2 tanımını çıkar (build worker.lib'den sim2.js'i kaldırmış gibi)
const a = full.indexOf('__defs["sim2.js"]'), b = full.indexOf('\n__defs["', a + 10) >= 0 ? full.indexOf('\n__defs["', a + 10) : full.indexOf('\n// ---- ');
const stripped = a >= 0 ? full.slice(0, a) + full.slice(b + 1) : full;
ok(stripped.indexOf('__defs["sim2.js"]') < 0, 'sim2 tanımı çıkarıldı');
const document = { scripts: [{ textContent: '' }, { textContent: script }] };
const PX = { WORKER_SRC: stripped, SIM: T.S, bus: { on() {} } };
const src = fs.readFileSync(path.join(T.SRC2, 'core', 'solverClient.js'), 'utf8').replace(/PX\.solver = \{/, 'PX.__ws = workerSource; PX.solver = {');
new Function('PX', 'document', "'use strict';\n" + src)(PX, document);
const ws = PX.__ws();
ok(ws.indexOf('__defs["sim2.js"]') >= 0, 'sim2 sayfadan geri kuruldu');
ok(PX.__ws.call(null) === ws, 'kararlı');
// kurulan kaynağı Worker gibi çalıştır
const out = [];
const fn = new Function('postMessage', ws + '\n;return onmessage;');
const onmessage = fn(m => out.push(m));
const lv = T.allLevels().find(l => l.id === 'M1');
onmessage({ data: { t: 'load', req: 1, id: lv.id, gen: 1, def: lv.def } });
setTimeout(function wait() {
  const r = out.find(m => m.req === 1);
  if (!r) return setTimeout(wait, 20);
  ok(r.t === 'ready' && r.states === lv.kanit.states, 'geri kurulan Worker doğru tablo üretir (' + r.t + ' ' + r.states + ')');
  // tam (değiştirilmemiş) kaynak olduğu gibi kullanılır
  PX.WORKER_SRC = ws; ok(PX.__ws() === ws, 'sim2 içeren kaynak değiştirilmez');
  T.done('rules_worksrc'); process.exit(process.exitCode || 0);
}, 20);
