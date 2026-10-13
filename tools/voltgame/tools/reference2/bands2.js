'use strict';
// ============================================================================
// PARALAKS: TEK HAT — bands2.js (kural sürümü 4) : §6.1 sınıf bantları (build kapısı; bant dışı seviye reddedilir).
// verify2 ve gen2 aynı tabloyu kullanır. Ölçüler:
//  par    : Hamle-opt (komut; dokun-yürü koşusu 1 — merdiven/iskele dahil fiziksel yürüyüş)
//  man    : Manevra-opt (en az anahtarlama işlemi; bir bölümü ayır-topraklama-geri ver fiziği gereği >= 4)
//  manK   : Kesinti-opt planının Manevra'sı (mühendisin gerçekte yürüteceği en az kesintili programın uzunluğu)
//  elec   : erişilen farklı ELEKTRİK yapılandırması sayısı (konum/görünüm hariç) — "boyut değil içgörü"
//  states : toplam durum (telefon Worker sınırı)
//  mash   : dokun-yürü rastgele oyuncunun 6·par+20 KOMUTTA kazanma oranı. Kural sürümü 4'te eşikler YENİDEN
//           ölçeklendi (§25.8): v3 menüsünde döndürme komutları rastgele oyuncuyu sulandırıyordu (v3 T1 %0,1 ->
//           döndürmesiz %19,4; M1 %14 -> %88,8). v4 eşikleri v3'ün sulandırılmamış değerlerinden SIKI.
//  walk   : Hamle-opt içindeki yürüyüş komutu payı (kural sürümü 4: bütün sınıflarda <= %55)
//  ess    : Hamle-opt'u değiştiren standart ablasyon sayısı (esaslı mekanik)
//  multi  : Hamle/Manevra/Kesinti optimum VEKTÖRLERİNDEN en az 2 farklı ya da bir cephe >= 2 nokta
//  free   : yürüyüş bedava iken (freeWalk) en az Hamle = saf karar sayısı alt sınırı
// ============================================================================
const BANDS = {
  ogretici: { ad: 'Öğretici', par: [4, 16], man: 2, manK: 2, elec: 6, states: 2e4, mash: 0.90, walk: 0.55, ess: 1, multi: false, free: 3 },
  cekirdek: { ad: 'Çekirdek', par: [10, 30], man: 4, manK: 5, elec: 16, states: 1.2e5, mash: 0.30, walk: 0.55, ess: 2, multi: false, free: 5 },
  zor:      { ad: 'Zor', par: [18, 50], man: 4, manK: 7, elec: 150, states: 1.2e5, mash: 0.08, walk: 0.55, ess: 3, multi: true, free: 10 },
  sinav:    { ad: 'Sınav', par: [24, 60], man: 6, manK: 12, elec: 300, states: 1.2e5, mash: 0.04, walk: 0.55, ess: 4, multi: true, free: 12 },
  gunluk:   { ad: 'Günlük', par: [10, 30], man: 4, manK: 5, elec: 16, states: 6e4, mash: 0.30, walk: 0.55, ess: 2, multi: false, free: 5 },
};
// m: {par, man, elec, states, mash, walk, ess, multi, free} -> ihlal listesi
function check(sinif, m) {
  const b = BANDS[sinif]; if (!b) return [`bilinmeyen sınıf ${sinif}`];
  const v = [];
  if (m.par < b.par[0] || m.par > b.par[1]) v.push(`par ${m.par} ∉ [${b.par}]`);
  if (m.man < b.man) v.push(`Manevra-opt ${m.man} < ${b.man}`);
  if (m.manK !== undefined && m.manK < b.manK) v.push(`Kesinti-opt planı Manevra ${m.manK} < ${b.manK}`);
  if (m.elec < b.elec) v.push(`elektrik yapılandırması ${m.elec} < ${b.elec}`);
  if (m.states > b.states) v.push(`durum ${m.states} > ${b.states}`);
  if (m.mash > b.mash) v.push(`basma ${(100 * m.mash).toFixed(2)}% > ${(100 * b.mash).toFixed(2)}%`);
  if (m.walk > b.walk + 1e-9) v.push(`yürüyüş payı ${(100 * m.walk).toFixed(0)}% > ${(100 * b.walk).toFixed(0)}%`);
  if (m.ess < b.ess) v.push(`esaslı mekanik ${m.ess} < ${b.ess}`);
  if (b.multi && !m.multi) v.push('çok amaçlı ölçüt yok (tek optimum vektörü, tek noktalı cepheler)');
  if (m.free < b.free) v.push(`saf karar (freeWalk) ${m.free} < ${b.free}`);
  return v;
}
module.exports = { BANDS, check };
