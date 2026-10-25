'use strict';
// tools/perf/results/{mobile,desktop}-{before,after,paired}.json (web-perf.cjs --compare) → Markdown önce/sonra tablosu
//   node tools/perf/report-table.cjs [klasör]
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(process.argv[2] || path.join(__dirname, 'results'));
const NAMES = { home: 'Ana sayfa', hizmet: 'Hizmet (elektrik-projesi)', araclar: 'Araç listesi (/araclar/)', iletisim: 'Teklif formu (/#iletisim)',
  teklif: 'Teklif araçları', voltsim: 'VoltSim ana sayfa', 'vs:trafo': 'VoltSim trafo (en ağır)', 'vs:yangin-algilama': 'VoltSim yangın' };
const fmt = (v, d = 0) => v == null ? '–' : Number(v).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const arrow = (a, b, d = 0) => a == null || b == null ? fmt(b, d) : fmt(a, d) + ' → **' + fmt(b, d) + '**';
for (const prof of ['mobile', 'desktop']) {
  const f = n => path.join(dir, prof + '-' + n + '.json');
  if (!fs.existsSync(f('before')) || !fs.existsSync(f('after'))) continue;
  const B = JSON.parse(fs.readFileSync(f('before'), 'utf8')), A = JSON.parse(fs.readFileSync(f('after'), 'utf8'));
  const P = fs.existsSync(f('paired')) ? JSON.parse(fs.readFileSync(f('paired'), 'utf8')).paired : {};
  const sgn = v => v == null ? '–' : (v > 0 ? '+' : '') + fmt(v);
  console.log('\n### ' + (prof === 'mobile' ? 'Mobil' : 'Masaüstü') + ' — ' + A.env.profileLabel + ', ' + A.env.runs + ' tekrar, medyan\n');
  console.log('| Sayfa | LCP ms | CLS | INP~ ms | TBT ms | İlk yükleme KB (istek) | 3D hazır ms | Eşleşmiş fark LCP / INP / TBT ms | Makine CPU % |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const k of Object.keys(A.pages)) {
    const b = B.pages[k] || {}, a = A.pages[k];
    console.log('| ' + (NAMES[k] || k) + ' | ' + arrow(b.lcp, a.lcp) + ' | ' + arrow(b.cls, a.cls, 3) + ' | ' + arrow(b.inp, a.inp) + ' | ' + arrow(b.tbt, a.tbt) +
      ' | ' + arrow(b.kbInitial && b.kbInitial.total, a.kbInitial.total, 1) + ' (' + (b.requestsInitial ?? '–') + ' → ' + a.requestsInitial + ') | ' + (a.ready3d ? arrow(b.ready3d, a.ready3d) : '–') + ' | ' +
      (P[k] ? sgn(P[k].lcp) + ' / ' + sgn(P[k].inp) + ' / ' + sgn(P[k].tbt) : '–') + ' | ' + (a.machineCpuBusyPct ?? '–') + ' |');
  }
}
