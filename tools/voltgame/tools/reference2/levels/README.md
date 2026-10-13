# tools/reference2/levels — bölüm seviye dosyaları (R1, kural sürümü 4: FİZİKSEL DÜNYA)

Her bölüm tasarımcısı yalnız kendi dosyasını düzenler: `ch0.js`, `ch1.js`, `ch2.js`, `ch3.js`.
Önce **`../PHYSICAL_GUIDE.md`** okunur (harita karakterleri, merdiven/iskele/kapı, fiziksel kapılar, amaç kapısı).

```js
'use strict';
// başlık yorumu ve yardımcı sabitler burada kalabilir (verify2 --stamp ilk "const X = [" öncesini korur)
const CH1 = [
  { id: 'M1', ad: '…', bolum: 1, kuralSurumu: 4, rehber: true, biyom: 'Volt Mahallesi', sinif: 'ogretici', ogretici: true,
    ogretir: '…', iddia: [], essential: ['noLoto'],
    isEmri: { no, kimden, konu, ozet /* ≤160, ilk ekranda */, metin, hedef?, telsiz?, odul? },
    sld: { node: {…}, el: {…} }, def: { …, is: { bolge: ['n'], ad: 'Ne yapılacak' } }, kanit: {…} },
];
module.exports = CH1;
```

- `kuralSurumu: 4` zorunlu; yoksa verify2 seviyeyi "dönüştürülmeli" diye reddeder.
- Doğrula / damgala: `node tools/reference2/verify2.js --file tools/reference2/levels/ch1.js [--stamp] [--id M4] [--ascii]`
- Varsayılan `node tools/reference2/verify2.js` bu dizindeki her `*.js` dosyasını `levels2.js` ve `daily2.js` ile birlikte doğrular.
- Build (`node tools/build.js`) `levels2.js` + bu dizini birleştirir; aynı kimlikte sonraki dosya kazanır;
  yalnız bölüm 0–3 gömülür. Sıra: bölüm, sonra dosyadaki sıra.
- Bu dizine `*.js` olarak yalnız seviye dizileri koyun (gen2 çıktısı JSON'ları başka yerde tutun).
- Kural sürümü 4 kanıt seviyeleri: P1 (ch0, merdiven), M1 (ch1, iskele), T1 (ch2, merdiven + kilitlemeli hücre kapısı).
