# Fiziksel dünya — bölüm tasarımcısı rehberi (kural sürümü 4)

Sahibin kararı: **"Çıkacağı yerlere merdiven olsun, döndürünce atlama gibi saçma şeyler olmasın; oyuncu nereye nasıl
çıkacağını ve ne yapacağını her an bilsin."** Kural sürümü 4'te Volti yalnız fiziksel olarak yürür. Kamera yalnız bakar.
İzdüşüm seçicisi ("İzdüşümü uygula", `p`, `kafa`) yoktur. Elektrik kuralları kural sürümü 3 ile aynıdır.

Kural kaynağı `sim2.js`, şartname `docs/PARALAKS2_SPEC.md` §25. Kanıt seviyeleri: **P1** (merdiven, `levels/ch0.js`),
**M1** (iskele, `levels/ch1.js`), **T1** (merdiven + kilitlemeli hücre kapısı, `levels/ch2.js`), **S1** (gen2 ile üretilmiş
OG galerisi, `levels2.js`).

---

## 1. Harita karakterleri

`def.map` katmanlardan oluşur: katmanlar `|` ile ayrılır (y=0 en altta), satırlar `/` ile (z), karakterler x'tir.
Bir karo, üstü boş bir bloktur. Volti karonun bir üst hücresinde (gövde katmanında) durur.

| Kar. | Anlam | Not |
|---|---|---|
| `#` | blok (zemin, döşeme, platform) | üstü boşsa karodur |
| `s` / `w` | başlangıç bloğu / iş noktası bloğu | ikisi de karo olmalı |
| `%` | **duvar / çit** (üstü yürünmez) | bölme, korkuluk, kapalı alan. Yürünebilir görünmeyen tek dolu blok |
| `.` | boş | |
| `>` `<` `v` `^` | **merdiven** — ok YUKARI çıkış yönünü gösterir (metinde sağ = +x, aşağı satır = +z) | aşağıya bakın |
| `=` | **iskele** (el merdiveni) basamağı | aşağıya bakın |
| harf/rakam | `hucre` üzerinden eleman küpü (kesici, ayırıcı, bara…) ya da **kapı** (`t:'kapi'`) | `s w v %` ve semboller harf olamaz |

**Merdiven**, gövde katmanında bir hücreyi kaplar ve iki belirli komşuyu bağlar. Örneğin `>` hücresi (x,y,z) için:
- altında blok (ya da duvar) vardır, havada durmaz;
- **alt sahanlık** (x−1, y−1, z) bir karodur: Volti y katmanında durur ve merdivene yürür;
- **üst sahanlık** (x+1, y, z) bir karodur: Volti y+1 katmanına çıkar;
- üstü (x, y+1, z) boştur (baş boşluğu).

Merdiven adımı sıradan bir yürüyüş adımıdır. Ayrı bir Hamle sayılmaz; bir dokun-yürü koşusu ne kadar uzarsa uzasın 1 Hamle'dir.
Volti merdivende durmaz. Merdivenin yanlarından giriş yoktur.

**İskele** (el merdiveni) bir duvar boyunca dikey bir `=` sütunudur:
- en alttaki `=`, bir bloğun üstündedir. O blok **iskele ayağı** karosudur ve Volti orada durabilir;
- basamaklar y0..y1 katmanlarında üst üste dizilir. Tam bir yanda duvar ya da blok tepesi vardır: o sütun her basamak
  katmanında doludur, tepesi y1 katmanındadır ve üstü boştur. Bu tepe **üst sahanlıktır**;
- birden fazla yanda uygun bir tepe varsa derleme "yönü belirsiz" hatası verir: fazla yanı kapatın.

İskele 1–2 kat çıkar. Kullanım yerleri: trafo köşkü çatısı, pano odası, kule.

**Kapı** (hücre kapısı, mekanik kilitleme) bir elemandır:
`{ id:'K1', t:'kapi', toprak:'Q81' | kilitli:'Q11', ad:'TR1 OG bara hücresi kapısı — Q81 kilitlemeli' }`.
- Kapı bir bloğun üstündeki hücreye yerleşir. O blok **kapı karosudur**: Volti eşikte durabilir.
- Kapı yalnız koşulu sağlanınca geçilir. `toprak:` koşulunda topraklama ayırıcısı kapalı olmalı, `kilitli:` koşulunda
  ayırma noktası açık konumda kilitli olmalı. İkisi birden verilirse ikisi de gerekir.
- Kapı bir bölmeyi kapatmalıdır: kapı karosu olmadan başlangıçtan ulaşılamayan bir "iç" bölge olmalı (F5).
- **Kapı kilitlemesi:** Volti içerideyken ya da eşikteyken kapıyı kilitleyecek manevra (örneğin topraklamayı açmak)
  reddedilir (`kapi_icerde`). Bu yüzden topraklama ayırıcısının kolunu kapının **dışına** koyun.

**Ekipman** (eleman küpü) bir bloğun üstüne oturur; havada eleman derleme hatasıdır. Volti bir cihazı ancak aynı
gövde katmanındaki 4 yatay komşu karodan biriyle (**yaklaşma karosu**) çalıştırır. Çapraz erişim, aşağıdan erişim ve
merdivenden erişim yoktur.

Merdiven, iskele ve rampa dışında yükseklik değişmez: atlama, düşme ve boşluk üstünden geçiş yoktur.

## 2. Saha ile çalışmak: `site2.js` ve `gen2.js`

Haritayı elle yazmak yerine sütun tabanlı "saha" tanımı kullanın (`site2.js`):

```js
const ST = require('./site2.js');
const W = 6, D = 6, C = (x, z) => x + W * z, h = new Array(W * D).fill(1);
for (let z = 0; z <= 2; z++) for (let x = 0; x < W; x++) h[C(x, z)] = 2;      // pano katı (h=2)
const duvar = new Array(W * D).fill(false); h[C(5,0)] = 3; duvar[C(5,0)] = true; // köşe duvarı
const b = ST.build({ W, D, h, duvar,
  eq: { Y1: C(0,0), Q11: C(3,0), B1: C(4,0), Q81: C(5,1), G1: C(0,5), Q01: C(1,5) },
  st: {},                 // merdiven: { sütun: yön } (0 +x, 1 −x, 2 +z, 3 −z = yukarı çıkış yönü)
  ld: { [C(1,3)]: 3 },    // iskele: { ayak sütunu: duvar yönü }
  start: C(5,4), work: C(4,1) }, null, /* kapılar: */ {});
// b.map, b.hucre -> def.map, def.hucre
console.log(ST.ascii({ map: b.map, hucre: b.hucre, el: [] }));   // üstten görünüş: yükseklik + içerik
```

`node tools/reference2/verify2.js --file levels/chN.js --id X --ascii` her seviyenin üstten görünüşünü basar
(`2Q11` = 2 yükseklikte Q11 küpü, `1>` merdiven, `1=^` iskele ayağı, `3%` duvar, `2K1⌂` kapı).

Üretici: `node tools/reference2/gen2.js <şablon> <tohum> <saniye> out.json`. Şablonun `saha` alanı ilk sahayı kurar
(`asma_kat`, `galeri`, `kosk`, `kanal`, `duz`). Tırmanış fiziksel kapıları ve bantları ödüllendirir. Çıktıyı ŞEKİL
için başlangıç noktası sayın, sonra elle güzelleştirin. Kanıt seviyeleri P1, M1 ve T1 elle yazıldı. S1 gen2'nin ham çıktısıdır.

## 3. Kapılar (verify2 hepsini zorunlu tutar)

**Fiziksel kapılar (`lint2.physical`):**

| Kod | Kural | Kalırsa ne yapmalı |
|---|---|---|
| F1 | Her çalıştırılabilir cihazın ve iş noktasının fiziksel bir yolu var. "Yol yok: merdiven gerekiyor" hiçbir seviyede çıkmaz | merdiven/iskele ekleyin ya da cihazı taşıyın |
| F2 | Her cihaz ve iş noktası en az bir erişilebilir durumda Volti'nin yanında | elektrik/kapı koşulu hiç sağlanmıyorsa düzeltin |
| F3 | Yürünebilir görünen her karo bir durumda ziyaret edilir. Tek istisna: hep gerilimli bir iletkenin yaklaşma bölgesindeki karo (taralı zemin; not olarak raporlanır) | kapalı köşeyi `%` duvar yapın, ekipman koyun ya da yol açın |
| F4 | Her merdiven/iskele bir altın çözümde kullanılır **ya da** kaldırılınca bir yere erişim kaybolur | gereksiz merdiveni kaldırın |
| F5 | Kapı gerçekten bir bölmeyi kapatır ve bir durumda açılır | kapının yanlarını kapatın |
| F6 | Yalnız Volti'nin konumu yüzünden çözümsüz durum (fiziksel tuzak) yoktur | tek yönlü bölmeyi, kapı içi cihazı düzeltin |

**Amaç kapısı (`lint2.purpose`).** Oyuncu her an ne yapacağını ve nedenini bilmelidir.

| Kod | Kural |
|---|---|
| A1 | `kablo` ve `yardimci` dışındaki her elemanın `ad` alanı var ve bu alan gerçek işlevi söyler. Oyunda "Q01 Okul fideri kesicisi" olarak görünür, yalnız -Q01 olarak değil |
| A2 | R1 seviyelerinde (bölüm 0–3) `isEmri.ozet` alanı var ve en fazla 160 karakterdir. Düz mühendislik Türkçesiyle, açılışta gösterilen tek cümledir. Örnek: "Okul fiderinde bakım: fideri ayır, topraklayıp kilitle, işi bitir, normale dön; hastane beslemesi kesilmesin." |
| A3 | İş noktası olan seviyede `def.is.ad` alanı var ve ne yapılacağını söyler. Örnek: "TR1 OG barası mesnet izolatörü değişimi". İş noktası işaretinin altyazısıdır |
| A4 | Oyuncu metninde izdüşüm/kamera kalıntısı yok: "izdüşüm", "seçici kafa", "dikiş", "görünümde", "döndür", "kamera" |

İsteğe bağlı `rehber: true` alanı, ilk seviyelerde sıradaki hedefin (cihaz/karo) vurgulanmasını açar. Metin duvarı
yoktur. İş listesi (beş altın kural + hedefler) `sim2.checklist(L, s)` ile her durumda hesaplanır; seviyeye yazılmaz.

**Sınıf bantları (`bands2.js`).** Kural sürümü 4'te iki değişiklik var. Yürüyüş payı her sınıfta en fazla %55'tir.
Basma (rastgele oyuncu) eşikleri yeniden ölçeklendi: öğretici ≤ %90, çekirdek ≤ %30, zor ≤ %8, sınav ≤ %4,
günlük ≤ %30. Gerekçe: v3 menüsündeki döndürme komutları rastgele oyuncuyu sulandırıyordu. Döndürmeler çıkarılınca
v3'te T1 %0,1'den %19,4'e, M1 %14'ten %88,8'e çıkıyor. v4 eşikleri v3'ün sulandırılmamış değerlerinden daha sıkıdır.
Diğer bant ölçüleri (par, Manevra, elektrik yapılandırması, durum, esaslı mekanik, çok amaçlılık, saf karar) aynıdır.

**Ablasyon bayrakları (`essential`).** noAyiriciKurali, noZones, noLoto, noBackfeed, noProtection, noSync,
noCapLock ve **noDoors** (yeni). `:kesinti` son eki Kesinti-opt planı içindir. noCouplers, noCommit, noVisOps, noRotate
ve freeze kaldırıldı.

**İddialar (`iddia`).** `ret` iddiasında `eylem:'izdusum'` ve `'dondur'` geçersizdir. Yeni iddia türü:
`{ t:'engel', err:'bolge_gerilimli'|'bolge_topraksiz'|'bolge_kond'|'kapi_kilitli', hedef:'Q81'|'w' }`. Bu iddia, bir
erişilebilir durumda o hedefe dokunuşun o engelle ve engelin adıyla reddedildiğini kanıtlar.

## 4. Kural sürümü 3 seviyesini dönüştürme (kontrol listesi)

1. `kuralSurumu: 4` ekleyin. `def.secici` alanını silin. `def.gorunum` yalnız ilk kamera açısıdır ve kuralı etkilemez.
2. Her `kafa` elemanını sahada gerçek bir cihaza çevirin. Örnekler `templates2.js` içindedir:
   - fider kafası + bara kafası, bara seçimi için: **bara seçici ayırıcıları** `Q11 (b1–f)` / `Q12 (b2–f)`;
     transfer kuplajla önce-kapa-sonra-aç yapılır;
   - iki trafonun AG kafaları: **AG kuplaj kesicisi** `Q0K` (çekmeli ise kilitlenebilir ayırma noktası olur);
   - ring uçlarındaki kafalar: **normalde açık nokta yük ayırıcısı** `QL4`;
   - kumanda devresindeki kafalar: **kumanda MCB'si** (açma eşikli kesici);
   - yük fideri kafası: **fider ayırıcısı** (yükü kesici keser).
3. Haritayı fiziksel sahaya yeniden yazın (bölüm 5'teki desenler). Görünüme bağlı "üst kare görünürlüğü" hilelerini
   kaldırın: her cihazın bir yaklaşma karosu ve oraya giden merdivenli bir yolu olsun.
4. `essential` listesinden kaldırılmış bayrakları silin. `iddia` içindeki izdüşüm reddini fiziksel bir `engel` ya da `ret`
   iddiasıyla değiştirin.
5. Metinlerdeki izdüşüm/kamera anlatımını silin (A4). `isEmri.ozet` ve `def.is.ad` alanlarını ekleyin.
   Talepleri (`talep`) yeniden üretin: `talep2.stampOne` ya da verify2 hata mesajı opt/cozum değerini verir.
6. `sld` alanını yeni cihazlarla güncelleyin. Kapı (`kapi`) Tek Hat'a çizilmez.
7. `node tools/reference2/verify2.js --file levels/chN.js --id X --stamp`, ardından `--id X` ile damgasız tekrar
   çalıştırın. Hedef: ALL LEVELS VERIFIED.

## 5. Desenler: inandırıcı çok katlı sahalar

- **Asma kat dağıtım panosu (P1):** zemin h=1, pano platformu h=2 ve bir merdiven. Kesici zeminde, ayırıcılar katta.
  "Önce kesiciyi aç" dersi gerçek bir yürüyüş kararına dönüşür.
- **Sokak kutusu + pano katı (M1):** fider kesicisi sokaktaki dağıtım kutusunda, pano üst katta, iskeleyle çıkılır.
  Bara yaklaşma bölgesi yalnız topraklamadan sonra girilebilir. Topraklama kolu bölgenin dışında, iş noktası içindedir.
  Topraklamayı açmadan önce bölgeden çıkmak gerekir; noZones ablasyonu bunu ölçer.
- **OG hücre galerisi + AG avlusu (T1, S1):** OG kesici/ayırıcı/topraklama kolları galeride, bara hücresi kilitlemeli
  kapının arkasında. AG panosu avluda tek bir ön karodan (3 cihaz) erişilir. Trafolar avluda durur ve çalıştırılamaz.
- **Trafo köşkü çatısı (`saha:'kosk'`):** köşk h=3, çatıya iskele. Çatıdaki havai hat ayırıcısı/parafudr için kullanın.
- **Kablo kanalı (`saha:'kanal'`):** döşeme h=2, kanal h=1, iki uçta basamak. Kanaldaki kablo eki arızası/yük ayırıcısı için.

**Yetişkin derinliği.** Yürüyüş koşusu 1 Hamle'dir; uzaklık değil, **kaç ayrı gidiş** gerektiği sayılır. Bir karodan
birden çok cihaza erişmek (AG ön karosu) gidişi azaltır. Bölge ve kapı sırayı zorlar. Kapasite sınırı
(T1: TR2 AG kesicisi 3,5 < hastane 2 + okul 2) Kesinti ödünleşimi doğurur. Kilitlenebilir alternatif ayırma noktası
(T1: kuplaj ya da TR1 AG kesicisi) ikinci bir karar daha getirir. Normal işletme konumu (`hedef.kapali/acik`) her zor
seviyede zorunludur. Basmayı düşürmek için serbestçe kapatılıp açılabilen ama sonunda normal konumda olması gereken
gerçek cihazlar (TR2 OG ayırıcısı Q92 gibi) ve kilit sayısı sınırı (`kilit`) etkilidir.

## 6. Komutlar

```
node tools/reference2/verify2.js --file tools/reference2/levels/ch1.js --id M4 --stamp   # damgala
node tools/reference2/verify2.js --file tools/reference2/levels/ch1.js --ascii           # doğrula + üstten görünüş
node tools/reference2/gen2.js bes_kural 7 120 out.json                                   # saha üret
node tools/test/unit/rules_physical.js --id=M4                                           # yol sürekliliği, açıklamalı ret
node tools/test/unit/rules_worker.js --id=M4                                             # Worker eşdeğerliği
```
