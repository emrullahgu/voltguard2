# tools/reference2/templates — bölüm şablonları (kural sürümü 4: FİZİKSEL DÜNYA)

`gen2.js`, `templates2.js` ile birlikte bu dizindeki her `*.js` dosyasını (ada göre sıralı) yükler.
Her dosya `module.exports = { sablonAdi: { ch, W, D, MAXH, minPar, maxPar, sinif, saha, base:{dugum, el, …}, cells,
essential, work?, hard?, zeroKesinti? } }` dışa aktarır (biçim: `templates2.js` başlığı, spec §19 ve §25).
Aynı ad iki yerde varsa sonraki kazanır ve uyarı basılır. Kullanım:

```
node tools/reference2/gen2.js <sablonAdi> <tohum> <saniye> out.json [tohumSeviyeDosyası#id]
```

Kural sürümü 4 değişiklikleri:
- `kafa` (izdüşüm seçicisi) elemanı YOK: gen2 böyle bir şablonu reddeder. Eski kafa çiftlerini sahada gerçek cihaza çevirin
  (bara seçici ayırıcısı, transfer ayırıcısı, ring normalde açık nokta yük ayırıcısı, kumanda MCB'si) — örnekler `templates2.js`.
- `pxc`, `needPairs`, `needAdj`, `forbidPairs`, `forbidStart` alanları yok sayılır (uyarı basılır).
- `essential` yalnız şu bayrakları alır: noAyiriciKurali, noZones, noLoto, noBackfeed, noProtection, noSync, noCapLock, noDoors
  (`:kesinti` son eki Kesinti-opt planı için).
- `saha`: 'duz' | 'asma_kat' | 'galeri' | 'kosk' | 'kanal' — çok katlı saha arketipi (merdiven/iskele yerleşimi).
- `base.el` içinde `{ t:'kapi', toprak:'Q81' | kilitli:'Q11', ad }` hücre kapısı varsa gen2 onu da yerleştirir.
- Her elemanın `ad` alanı oyuncuya gösterilen GERÇEK işlevidir (amaç kapısı).
