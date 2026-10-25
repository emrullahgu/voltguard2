'use strict';
// araclar/ denetim düzeltmeleri: araç sayfalarındaki saf hesap fonksiyonları sahte DOM ile çalıştırılır ve
// BAĞIMSIZ el hesabı değerleriyle karşılaştırılır (beklenen değerler test edilen koddan üretilmez).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = path.resolve(__dirname, '../engineering/src/tools');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} beklenen ${b} ± ${tol}, bulunan ${a}`);
/** Kaynaktan "function ad(" ile başlayan fonksiyonu süslü parantez dengesine göre çıkarır. */
function fn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' bulunamadı');
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1); }
  throw new Error(name + ' kapanmıyor');
}
const fakeDoc = values => ({ getElementById: id => (id in values ? { value: String(values[id]) } : null) });

test('Adım gerilimi: IEEE 80 yüzey tabakası katsayısı Cs (ρ 100, çakıl 3000, hs 0,1 m → Cs 0,700)', () => {
  const src = read('Adım_Gerilimi.html');
  const run = vals => vm.runInNewContext(fn(src, 'surfaceCs') + fn(src, 'stepLimit') + ';({ cs: surfaceCs(), lim: stepLimit() })', { document: fakeDoc(vals), Math });
  // tabaka yok: Cs = 1, ρs = ρ = 100 → (1000 + 600)·0,116/√0,5 = 262,48 V
  const a = run({ tsInput: 0.5, rhoInput: 100, kgInput: 0.116, layerInput: 0, hsInput: 0.1 });
  near(a.cs.Cs, 1, 0); near(a.lim, 262.48, 0.01);
  // çakıl: Cs = 1 − 0,09·(1 − 100/3000)/(0,2 + 0,09) = 1 − 0,087/0,29 = 0,7000 → (1000 + 6·0,7·3000)·0,116/0,70711 = 2231,07 V
  const b = run({ tsInput: 0.5, rhoInput: 100, kgInput: 0.116, layerInput: 3000, hsInput: 0.1 });
  near(b.cs.Cs, 0.7, 1e-9); near(b.lim, 2231.07, 0.05);
  // eski hata: ρs = 3000 doğrudan, Cs = 1 → 3116,9 V (iyimser); düzeltme sonrası daha düşük olmalı
  assert.ok(b.lim < 3116);
});

test('GES tasarım: DC kablo iletkenliği 70 °C iletken sıcaklığına düzeltilir (Cu 56 → 46,80; Al 35 → 29,13)', () => {
  const src = read('GES_Tasarım_Similatörü.html');
  const code = 'var DC_TCOND=70;var B1PVC={"30":1,"35":0.94};' + fn(src, 'dcFactorsNow') + ';dcFactorsNow()';
  const doc = mat => ({ getElementById: id => ({ dcMat: { value: mat }, dcTamb: { value: '35' }, dcCrit: { value: '2' }, dcImpp: { value: '13' }, isc: { value: '14' }, vmpp: { value: '41' } }[id]) });
  // 56 / (1 + 0,00393·50) = 56 / 1,1965 = 46,803; 35 / (1 + 0,00403·50) = 35 / 1,2015 = 29,130
  near(vm.runInNewContext(code, { document: doc('cu'), parseFloat, Object, Number }).K, 46.80, 0.005);
  near(vm.runInNewContext(code, { document: doc('al'), parseFloat, Object, Number }).K, 29.13, 0.005);
});

test('AG kısa devre: c_max seçilebilir (1,05 / 1,10) ve hesapta sabit 1,05 kalmaz', () => {
  const src = read('AG_Kısa_Devre_Simülatörü.html');
  const cmax = v => vm.runInNewContext('var sel=id=>({value:"' + v + '"});' + fn(src, 'CMAX') + ';CMAX()', { Number });
  assert.equal(cmax('1.05'), 1.05); assert.equal(cmax('1.10'), 1.1); assert.equal(cmax('x'), 1.05);
  assert.doesNotMatch(src, /1\.05\*t\.Un|0\.95\*t\.Un/);
  // 1000 kVA (ZT = 18 mΩ, örnek): 1,10·400/(√3·18) = 14,11 kA; 1,05 ile 13,47 kA
  near(1.1 * 400 / (Math.sqrt(3) * 18), 14.11, 0.005);
});

test('OG kısa devre: trafo direnci girilebilir; faz-toprak ve iki faz-toprak karmaşık toplamla, k ≥ 1 için de tanımlı', () => {
  const src = read('OG_Kisa_Devre_Simulatoru.html');
  assert.match(src, /id="tPk"/); assert.match(src, /id="dPk"/);
  assert.doesNotMatch(src, /k2<1 \? 3\/\(1\+2\*k2\)\*Ik04 : NaN/, '2 faz-toprak k ≥ 1 iken NaN olmamalı');
  assert.match(src, /3\*cAG\/Math\.hypot\(R1_2\+2\*Z0_2R, X1_2\+2\*Z0_2X\)/);
  assert.match(src, /3\*cAG\/Math\.hypot\(2\*R1_2\+Z0_2R, 2\*X1_2\+Z0_2X\)/);
  // el hesabı: 630 kVA, uk %4,5, Pk 6,5 kW, 100 MVA baz → zT = 7,1429 pu, rT = (6,5/630)·158,73 = 1,6377 pu, xT = 6,9526 pu
  const zt = 0.045 * 100 / 0.63, rt = (6.5 / 630) * (100 / 0.63);
  near(rt, 1.6377, 1e-4); near(Math.sqrt(zt * zt - rt * rt), 6.9526, 1e-4);
});

test('Sabit kondansatör: değişken yükte k² ortalaması için biçim katsayısı; "üst kademe uygundur" hükmü yok', () => {
  const src = read('Sabit_Kondansatör_Hesabı.html');
  assert.match(src, /id="ff"/);
  assert.match(src, /E\[k²\] ≥ E\[k\]²/);
  assert.doesNotMatch(src, /üst kademe uygundur/);
  // el hesabı: QL2 = 73,70 kVAr (örnek), k = 0,6128 → k²·QL2 = 27,67; F = 1,2 → (0,73536)²·73,70 = 39,85 kVAr
  near(0.6128 ** 2 * 73.70, 27.68, 0.02); near((0.6128 * 1.2) ** 2 * 73.70, 39.85, 0.03);
});
