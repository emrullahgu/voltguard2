# PARALAKS: TEK HAT — Paralaks 2.0 yapım şartnamesi (build-ready spec)

> Alt başlık: **Görünür Ayırma** · Hikâye: **VoltCity — Karartmanın Ertesi**
> Durum: referans motor **kural sürümü 4 — FİZİKSEL DÜNYA** (§25; sahibin oyun testi kararı, 2026-10-13): merdiven/iskele ile gerçek yürüyüş, kamera yalnız görsel, izdüşüm seçicisi kaldırıldı. Kanıt seviyeleri P1, M1, T1, S1 doğrulandı; diğer kampanya seviyeleri dönüştürülüyor (§25.10). Önceki durum: kural sürümü 3 (`tools/reference2/`, `node verify2.js` → `ALL LEVELS VERIFIED`). Revizyon 3 üç bağımsız denetimin bulgularını işler; kararlar §23 Karar Kaydı'nda, oynanış/telefon/kapsam kararları §24'te.
> Bu belge v1 şartnamesinin (`docs/PARALAKS_SPEC.md`) yerine geçer. Kuralların **tek doğruluk kaynağı `tools/reference2/sim2.js`'tir**; bu belge ile kod çelişirse kod kazanır ve belge düzeltilir.
> Robotun adı her yerde **Volti**'dir (CANON §1). v1'deki "Volt" adı, "Kısa Devre" alt başlığı, piller, kırılgan "sigorta" karosu ve sandıklar kaldırıldı.

---

## 0. Karar özeti

### 0.1 Seçilen taban ve gerekçe
Dört aday konsept dört jüriden geçti (bulmaca derinliği, elektrik doğruluğu, bağlılık, yapılabilirlik). **TEK HAT** iki jüride birinci (derinlik 8, yapılabilirlik 8) ve tek konsept ki imza kuralı (ekranda değen kenarlar bağlıdır, görünmeyen yoktur) devrenin **içinde** iş görür: izdüşüm bir anahtarlama manevrasıdır (kural sürümü 3: kamera yalnız bakar, bağlantıyı açık "İzdüşümü uygula" komutu değiştirir). Diğer üç konseptte kamera yalnız erişimi değiştirir ve devre kuralın yanında durur; jüri bunu "yürüme vergisi" olarak puanladı.

Taban, elektrik jürisinin iki eleştirisi giderilerek alındı:
1. **İzdüşüm geçişi ÖNCE-KAPA-SONRA-AÇ'tır (make-before-break)** ve seçici kafası gerçek seçici gibi **açık konumda kilitlenebilir**. Gerçek çift bara transferinde kuplaj kesicisi kapalıyken önce yeni bara seçicisi kapanır, sonra eski açılır; `sim2.js` "İzdüşümü uygula" komutunda faz 1'i iki kümenin **birleşimi**, faz 2'yi yeni küme olarak alır. "Kuplajı kapa → izdüşümü uygula → kuplajı aç" birebir gerçek prosedürdür. Kural sürümü 3'te kamerayı döndürmek hiçbir şeyi anahtarlamaz.
2. **Fiziksel ayırıcı kuralı (R6b) akım ve potansiyel tabanlıdır** (kural sürümü 3, §2.6): ayırıcı/seçici yalnız ≤ ε akımı ya da istasyon içi paralel yolla komütasyon akımını açar/kapar; trafo ve kondansatör ayırıcıyla enerjilenmez; iki ayrı gerilimli bölüm ayırıcıyla paralellenemez (halka kapama ve paralelleme kesiciyle ya da yük ayırıcısıyla yapılır).
3. **İzdüşüm seçicisi tek kurgusal cihazdır ve öyle etiketlenir:** "İzdüşüm Seçici Ayırıcısı (VoltCity 1975 deneysel, görüş hattı telekumandalı)". Davranışı gerçek bir seçici ayırıcınınkidir; yalnız kumandası kurgusaldır. Saha El Kitabı'ndaki "Model Notları" sayfası bunu açıkça yazar (bkz. §4.3).

### 0.2 Aşılar (graft)
| Kaynak konsept | Alınan fikir | Durum |
|---|---|---|
| Kara Başlatma | E4 iş yüklemi: beş altın kural tek kesin test (ölü + kilitsiz her şey kapalı varsayıldığında kaynaksız + topraklı + yakın gerilimli kısım yok) | `sim2.zoneReady` + iş karosunda `passable` (uygulandı) |
| Kara Başlatma | İzdüşüm geçişi animasyonu: derinlik dikişinde Volti bakış ışını boyunca `k·(sx,1,sz)` ötelenir, ekranda tam görünmez → sıçrama/ışınlanma yok | Görüntüleyici kuralı §12.6 |
| Kara Başlatma | Worker tablosu hazır olana kadar yalnız-elektrik soyutlaması ile lamba | §12.8 |
| Kara Başlatma | Kayıp Ölçüm Noktaları (gözlenebilirlik sırları), 79 tekrar kapama, ATS, saat sayısı (vektör grubu) | Uzantı EXT-79, EXT-ATS, EXT-SAAT (§2.12) |
| Manevra | Çekmeli kesici arabası: dışarı çekmek hem görünür ayırma noktası hem geometri düzenlemesidir | Kilit kuralı uygulandı; geometri etkisi EXT-RACK |
| Manevra | "Açık sabit kesici ayırma noktası değildir" | Uygulandı: yalnız ayırıcı ve çekmeli kesici kilitlenir |
| Manevra | Açgözlü-bot farkı, seviye başına tasarımcı içgörü cümlesi, iddia edilen her kuralın ablasyonla kanıtı | §19 üretim hattı kapıları |
| Devreye Alma | Dürüst, sunucusuz histogram: doğrulanmış sınırlar + çözüm uzayı sayımı + yerel geçmiş | §5.2 |
| Devreye Alma | Empedans tabanlı koruma, ΔU, Ib ≤ In ≤ Iz (Atölye bölümleri) | EXT-ATOLYE (§2.12), Bölüm 6 sonrası |
| Tek Hat (kendisi) | R8 ölü ama topraksız iletken gerilimli sayılır; R9 görünmeyen açıklık ayırma sayılmaz; %80 izdüşüm×devre kapısı | Uygulandı ve `verify2.js` kapısı |
| Yeni (bu sentez) | G3 gövde görünürlüğü: Volti yalnız gövdesinin 6 kafes üçgeninin hepsi görünen karoda durur / döner | Uygulandı (`BODY_MIN = 6`) |

### 0.3 Kesilenler
- v1'in pilleri, kırılgan sigorta karosu, sandık itme/tırmanma, "Kısa Devre" markası, ark kıvılcımı geçiş efekti, "Pano yandı!" ve "Devre açık" metinleri.
- Kara Başlatma'nın 24×24×6 dünya merkezleri ve 1–3 M durumluk çalışma zamanı seviyeleri (telefon riski). Dünya haritası küçük dioramalardan oluşur (§8).
- Devreye Alma'nın ayrı "tasarım + saha" iki-katman oyunu ana kampanyadan çıktı; yalnız isteğe bağlı **Atölye** yan dalı olarak kalır (EXT-ATOLYE).
- Haftalık 1–3 M durumluk Usta bulmacası, küresel liderlik tablosu, gerçek oyuncu histogramı (ADR ve gizlilik incelemesi olmadan).
- 18 eleman ailesinin hepsi ilk sürümde değil: senkronoskop fazı, diyot/DC röle, RCD/kaçak, gerilim düşümü uzantı olarak planlandı (§2.12) ve her biri ancak `sim2.js`'e girip doğrulandıktan sonra seviyeye konur.

### 0.4 Kanıt (referans motor)
`node tools/reference2/verify2.js` 11 kanıt seviyesini sıfırdan doğrular; tablo §21'de. Öne çıkanlar (kural sürümü 3): 11/11 seviye §6.1 sınıf bandında; zor seviyeler 192–672 farklı elektrik yapılandırması ve 11–14 saf karar ister, dokun-yürü rastgele oyuncu ≤ %0,58 kazanır; beş zor seviyenin hepsinde Hamle-opt ile Kesinti-opt ayrı planlardır (4–7 noktalı Pareto cephesi); izdüşüm×devre kapısı 7/8 (seçiciler hangi görünümde dondurulursa dondurulsun optimum değişir); her altın defter güvenlik denetiminden geçer. **S3 Bara Transferi** amiral gemisi: kuplaj kapalıyken izdüşümü uygulayarak hastane Bara A'dan Bara B'ye **sıfır kesintiyle** aktarılır (Kesinti-opt `[32,7,0,0]`); en kısa plan `[23,4,54,0]` hastaneyi düşürür. v1'de en büyük seviye 820 durumdu, par ≤ 20, rastgele basma %72–87.

---

## 1. Kimlik ve hikâye

### 1.1 Tek cümle
VoltCity'nin karartmasından sonraki sabah, VoltGuard'ın saha robotu Volti hasarlı paralaks vizörüyle şehri bölge bölge geri enerjilendirir: her diorama gerçek bir manevra programıdır ve vizör yalnız gördüğünü bağlar.

### 1.2 Ton ve hedef kitle
- Hedef: elektrik mühendisleri, teknisyenler ve meraklılar. Oyun onları **zekâlarıyla** yakalar; çocuk dili, pil toplama, patlama ödülü yok.
- Ton: sakin, yetkin, sıcak. Işık geri geldikçe şehir canlanır. Güvenlik kültürü (beş altın kural, LOTO, yaklaşma sınırı) kazanma stratejisinin kendisidir.
- Kötü karakter yoktur; düşman **ihmaldir**: ertelenmiş bakım, yanlış ayarlı yük atma grupları, kaçak bağlantılar, sigortası sökülmüş bir akü bankası.

### 1.3 Hikâye mantığı (araştırmadan uyarlandı, kopyalanmadı)
| Perde | Olay | Oyun karşılığı | Ödül sahnesi |
|---|---|---|---|
| Prolog — Depo | Volti depo UPS'inin son enerjisiyle açılır, kendini test eder (LED, eklem, ölçü probu). İlk İş Emri gelen kutusuna düşer. Telsizde emekli usta **Hikmet Usta**'nın sesi (ipucu sesi). | Bölüm 0 | Depo aydınlatması yanar, kapı motoru açılır, Volti dışarı çıkar |
| 1. perde — Volt Mahallesi (AG) | Mahsur kalmış servis robotları (otomat, asansör robotu, trafik lambası robotu, fırının hamur makinesi) tek onarımla canlanır | Bölüm 1 | Her diorama bir pencere yakar; teşekkür sahnesi |
| Trafo (Kalp) | Ana trafo merkezi ilk günden haritada görünür ama ulaşılamaz. Her çözülen diorama ona bir enerji hüzmesi gönderir | Dünya haritası | Hüzmeler birikir |
| 2. perde — Trafo Merkezi | Geri besleme tuzakları, N-1 bakım | Bölüm 2 | Bir mahalle halkası yanar |
| 3. perde — Fabrika | Sanayi canlanır; kompanzasyon, mühürleme devreleri | Bölüm 3 | Konveyörler, fırın bacası duman |
| 4. perde — Baraj, kara başlatma | Yardımcı dizel → uyartım → ilk ada. Aşırı korumacı eski otomasyon **RÖLE-7** uyanır; Volti onu ayarlarını düzelterek "ikna eder" (kademe/eşik bulmacaları). İlk ada sınırlı: önce hastane ve su pompası mı, sanayi mi? Seçim yalnız sahnelerin sırasını değiştirir; sonunda herkes aydınlanır | Bölüm 4 | Türbin döner; ada ışıkları |
| 5. perde — Dağıtım Merkezi 34,5 kV | Çift bara, kuplaj transferleri, by-pass | Bölüm 5 | İletim hattı portalları yanar |
| 6. perde — Yenilenebilir + Metro | Kömür santrali emekli olur, güneş + depolama gelir; batarya konteyneri tramvayı yürütür ve perde geçişi olur | Bölüm 6 | Tramvay hareket eder |
| 7. perde — Kent Şebekesi, fırtına | Ring OG şebekesinde arıza bulma ve ayırma (FLISR), senaryolu fırtına (zamanlayıcı YOK) | Bölüm 7 | Mahalleler halka halka |
| Final — Kalp | Hastaneyi yanık tutmak için ana trafoyu kısa süreli aşırı yükleme kararı: patlama yok, sıcak nokta ve yaşlanma göstergesi maliyeti gösterir; ardından yük aktarılır | Final | Bütün şehir halka halka aydınlanır, 50 Hz uğultusu geri gelir |
| Epilog | İsteğe bağlı termal kamera işleri yalnız olumlu sahne ekler | Yan işler | Hiçbir şey sönmez |

Metaforlar (oyun kuralıyla aynı şey):
- **Gözlenebilirlik:** SCADA ölçüm noktalarını kaybetti ve göremediğini yok sayıyor; Volti'nin hasarlı vizörü de öyle. "Görünmeyen yoktur" kuralı hikâyenin kendisidir. Kayıp Ölçüm Noktası sırları bulundukça o bölgenin SCADA paneli geri gelir.
- **Senkronizasyon:** iki adayı ekranda hizalamak, senkronoskop ibresini 12'ye getirmenin görsel ikizidir.
- **Kıtlık ve öncelik:** sınırlı adada yük önceliği (Kesinti ağırlıkları w) ahlaki seçimin mekanik ikizidir; ama oyun kimseyi karanlıkta bırakmaz.

### 1.4 Güvenlik çerçevesi (zorunlu metinler)
- Açılışta ve El Kitabı'nda: "Volti'nin vizörü göremediğini bağlamaz. Gerçek elektrik kameraya bakmaz: gerçek sahada yalnız görünür, kilitli ve topraklı ayırma güvenlidir."
- CANON §16 güvenlik ipucu korunur. Ark ve kısa devre yalnız kilitlemenin (interlock) önlediği hatayı anlatan "Neden?" kartında, FlashGuard sınırları içinde, illüstrasyon olarak görünür. Asla ödül değildir.

---

## 2. Kurallar (kesin; `sim2.js` doğruluk kaynağı, kural sürümü 3)

> **Kural sürümü 4 (§25):** §2.2 geometri, §2.3 hareket/döndürme/izdüşüm, §2.10 görünürlük, §2.13 durumdaki `v`/`cs` ve §2.14/§2.15'teki `d±`/`p`/`gorunmez`/`kafa_temas` maddeleri §25 ile DEĞİŞTİRİLDİ. Elektrik maddeleri (§2.4–§2.9, §2.11, §2.12) aynen geçerlidir.

Bütün sayılar tamsayı ya da küçük kayan noktalıdır ve deterministiktir. Aynı kod Worker'da, build doğrulayıcıda ve testlerde çalışır (DOM yok, THREE yok). Kural sürümü 3, üç bağımsız denetçinin bulgularına göre yeniden yazıldı (§23 Karar Kaydı); her değişiklik `verify2.js` ile yeniden damgalandı.

### 2.1 Seviye verisi (`levels2.js` biçimi)
```js
{ id:'T2', ad:'Trafo N-1 Bakımı', bolum:2, biyom:'Trafo Merkezi', sinif:'zor', ogretici:false,
  ogretir:'…tasarımcı içgörü cümlesi (oyuncuya gösterilmez)…',
  iddia:[{t:'farkli'}, {t:'ret', err:'yuk', eylem:'izdusum'}],      // ogretir cümlesinin makinece kanıtı (§19 K8)
  essential:['noCommit','noBackfeed','noLoto'],                      // ablasyonu optimumu DEĞİŞTİRMESİ zorunlu
  def:{ map:'y0 katmanı | y1 katmanı | …',   // katman '|' (y=0 ilk), satır '/' (z), karakter x
        hucre:{A:'G1',B:'Q01',…},             // harf -> eleman id (ekipman küpü)
        gorunum:0, secici:0, kilit:3, yedek:0, set:false,
        dugum:{ o1:{kv:34.5}, a1:{} },        // kv yoksa 0.4
        el:[ …eleman listesi (§3)… ],
        is:{ bolge:['b1'] },                  // iş emri bölgesi (düğümler); 'w' karosu iş karosu
        hedef:{ yukler:['Y1','Y2'], gerilimli:['b1'], kapali:['Q01'], acik:['Q0K'],
                cosphi:{dugum:'bus', ind:200, kap:150} } },
  kanit:{ states, edges, elec, opt:{hamle:[h,m,k,o], manevra:[…], kesinti:[…], olay:[…]},
          cozum, cozumManevra, cozumKesinti, abl:{…}, frz:[…4 görünüm…], mash, dead, walk, free,
          goals, frontK, frontM, uzay } }
```
Harita karakterleri: `#` zemin bloğu, `s` başlangıç bloğu, `w` iş noktası bloğu, `.` boş, diğer her karakter `hucre` üzerinden bir eleman küpü. `kanit` alanını yalnız `verify2.js --stamp` yazar; elle düzenlenmez. Cihaz kodları IEC 81346 alışkanlığıyla: `-Q0x` kesici, `-Q1x/-Q2x` bara ayırıcısı, `-Q9x` hat ayırıcısı, `-Q8x` topraklama ayırıcısı, `-QLx` yük ayırıcısı, `-QCx` kondansatör kademe kontaktörü, `-F` sigorta, `-K` kontaktör/röle, `-S` buton, `-T` trafo, `-C` kondansatör, `-G` kaynak, `-W` kablo, `-X` izdüşüm seçici kafası (kurgusal), `Y` tüketici. Tek Hat paneli IEC 60617 sembolleriyle çizilir (§11.2).

### 2.2 Geometri (G1–G4) — kural sürümü 3 (YERİNE §25.2)
- **G1 İzdüşüm.** Görünüm `v ∈ {0,1,2,3}`, `(sx,sz) = [(1,1),(−1,1),(−1,−1),(1,−1)][v]`. Küp `(x,y,z)`: `a=sx·x, b=sz·z, A=a−y, B=b−y`, derinlik `d=a+y+b`. Küp altı kafes üçgenine adaydır: üst yüz `(A−1,B−1)` karesinin iki yarısı (t0,t1); yanlar `(A,B−1,t1)`, `(A,B,t0)`, `(A,B,t1)`, `(A−1,B,t0)`. Her üçgenin sahibi en büyük derinlikli küptür.
- **G2 Karo varlığı.** Bir blok küpün üstü boşsa ve üst karesinin **iki** üçgeninin de sahibi kendi üst yüzüyse, o küpün üstü görünüm v'de bir **karodur**. Kısmen örtülü karo yoktur. (v1'deki sıfır alanlı karo hatası yapısal olarak imkânsız.)
- **G3 Gövde görünürlüğü.** Karonun üstündeki hayali küp (Volti'nin gövdesi, derinlik `d+1`) altı üçgeninin hepsinin sahibi olmalıdır (`BODY_MIN = 6`). Volti yalnız `standOk` olan karoya yürür ve yalnız `standOk` kalacağı görünüme döner. Hiçbir erişilebilir durumda Volti kısmen gizli değildir (dikiş geçişi için §12.6).
- **G4 Temas (görüş hattı / izdüşüm bağı).** Görünüm v'de iki karo, ekran kareleri bir kenar paylaşıyorsa komşudur. Tek kural; merdiven istisnası yok. Her ekran yönünde en fazla bir komşu vardır (`metrics2.keyboard`).
- **Tıklama seçimi** aynı sahiplik tablosundan; bir küpün yan yüzüne dokunmak arkasındaki karoyu asla seçmez.

### 2.3 Hareket, döndürme ve izdüşüm komutu (kural sürümü 3; YERİNE §25.3)
- **Git** (`g<karo>`, dokun-yürü): o anki görünümde yürüyüş grafında (`standOk` ve geçilebilir karolar, §2.8) erişilebilen herhangi bir karoya **tek komut = 1 Hamle**. Yürüyüş elektrik durumunu asla değiştirmez. Çözücü, rastgele basma ölçümü ve oyuncu aynı birimi kullanır (v2'deki `wk` defter biti kaldırıldı: durum sayısını 1,7–1,95× şişiriyordu).
- **Döndür** (`d+`/`d−`): yalnız **gezinmedir**. Yeni görünümde `standOk(nv, p)` gerekir (döndürme kapısı). 0 Hamle, 0 Manevra, elektrik durumuna hiçbir etkisi yoktur. *Kamera hiçbir şeyi anahtarlamaz.* (Denetçi bulgusu: v2'de her döndürme seçicileri çeviriyordu; hastaneyi başını çevirmek için karartmak saçmaydı ve Kesinti/Manevra optimumlarının çoğu gezinme maliyetiydi.)
- **İzdüşümü uygula** (`p`): izdüşüm seçicilerinin bağlantı kümesini (`cs`) o anki görünümün kümesine çevirir. Tek bilinçli komuttur: 1 Hamle; bağlı çift kümesi değişirse 1 Manevra. Geçiş **iki fazlıdır (ÖNCE-KAPA-SONRA-AÇ)**: faz 1 `S_eski ∪ S_yeni`, faz 2 `S_yeni`; her faz R6b ile denetlenir (§2.6). Arayüz: döndürme sürüklemesi sırasında aday görünümün çiftleri, düşecek yükler ve Kesinti/Manevra değişimi önizlenir; "İzdüşümü uygula" düğmesi yalnız o görünüm farklı bir küme veriyorsa görünür.
- Seviye `secici` alanı başlangıçta seçili kümeyi verir (yoksa `gorunum`).

### 2.4 Elektrik ağı (E1)
Düğümler bara bölümü ya da kablo ucudur ve bir gerilim seviyesi taşır (`kv`: 154, 34.5, 0.4; kumanda 0.23). Kenar türleri: `kablo`, `trafo`, `kesici`, `ayirici`, `yuk_ayirici`, `sigorta`, `kontaktor`, `yardimci` (NA/NK), `buton` (NA/NK, anlık), `kuplor` (seçili izdüşüm kümesinden). Düğüm ekleri: `kaynak` (grup, `acil`), `yuk` (d, w, p, q, zorunlu), `toprak` (topraklama ayırıcısı), `bara` (açık iletken, yaklaşma yarıçapı r), `kafa` (izdüşüm seçici kafası, `kilitlenebilir`), `kondansator` (q, r, başlangıç şarjı), `ariza`.

### 2.5 Adım değerlendirmesi (E2) — her aday eylemden sonra
Anahtar `(seçili küme, cihaz bitleri, buton maskesi, taşınabilir topraklama)` ile önbelleklenir.
1. **Kapalı kenarlar:** kablo ve trafo hep kapalı; kesici/ayırıcı/yük ayırıcısı/sigorta/kontaktör bitlerinden; yardımcı kontak = sahibi cihazın biti XOR NK; buton = basılı XOR NK; seçici çiftleri seçili kümeden (kilitli kafa hariç).
2. **Galvanik bileşenler** (trafo hariç union-find) ve **istasyon bileşenleri** (yalnız anahtarlama elemanları + seçici; kablo ve trafo hariç) — R6b'nin komütasyon testi bunu kullanır.
3. **Kilitleme yüklemleri** — biri tutarsa eylem REDDEDİLİR, hatalı durum saklanmaz: `seviye` (bir galvanik bileşende iki kV), `senkron` (tek ağda iki kaynak grubu; 25), `toprak` (gerilimli düğüm topraklı: *topraklamaya kapama — ölümcül hata*; artık yalnız yedek denetimdir, çünkü R6c topraklamayı ayırmadan önce zaten reddeder), `cirpma` (kontaktör sabit noktası oturmuyor), `koruma_yok` (gerilimli bir arıza, yolunda açma eşikli kesici/sigorta olmadan beslenirdi).
4. **Enerjilendirme:** kaynaklı galvanik bileşenlerden trafolar üzerinden **iki yönde** BFS (geri besleme gerçek).
5. **Düğüm analizi (DC eşdeğeri, pu):** kaynaklar 1 pu ideal; kenar iletkenliği g (kapalı anahtar 1000, kablo/trafo 200); yükler d birimlik sabit akım; **arıza toprağa şönt iletkenliktir** (`G_ARIZA = 100`, `Ik = V·G_ARIZA`, yol empedansıyla sınırlı). K10 lint'i: koruma açmayan her erişilen yapılandırmada gerilimli düğümler ≥ 0,9 pu (negatif gerilim yok). HUD gerilim değil akım gösterir.
6. **Koruma yerleşmesi:** akımı **açma eşiğini** (`I`) aşan kesici/sigortalardan en düşük `kademe`'li olanlar aynı anda açar (seçicilik), her açma 1 **Olay**; sonra 1. adıma dön. K7 lint'i: erişilen her yapılandırmada akım ile eşik arasında ≥ 0,5 birim pay (tam eşitlik dahil bıçak sırtı yok; tamsayı olmayan akımda ≥ 1 birim) — oyuncu ampermetresiz, iş emri kartındaki tamsayı talepleri toplayarak karar verebilir.
7. **Türetilenler:** beslenen yükler, reaktif oran (yalnız hedef varsa), tehlike haritası.

### 2.6 Anahtarlama kuralları (R6)
- **R6a Kesici:** yük ve arıza akımı açıp kapatabilir. Arızaya kapama korumayı açtırır (Olay).
- **R6b Ayırıcı ve izdüşüm seçicisi (akım ve potansiyel tabanlı, ayrık):** *açma* ancak işlemden önce cihaz akımı ≤ ε ise **ya da** iki ucu işlemden sonra kapalı bir istasyon yoluyla (bara/kesici/ayırıcı/seçici; kablo ve trafo içermeyen) bağlı kalıyorsa (bara transferi komütasyonu) yasaldır. *Kapama* ancak iki uç zaten aynı istasyon bileşenindeyse **ya da** iki ayrı gerilimli galvanik bileşeni birleştirmiyor ve kapamadan sonra cihaz akımı ≤ ε ise yasaldır. Ayrıca hiçbir trafo ucunun ve kondansatörün enerji durumu değişemez (mıknatıslanma/şarj akımı modelde sıfırdır; kural açıktır) ve hiçbir koruma açamaz. Kontaktör bobini artık "yük" sayılmaz: bobini besleyen bir seçici/ayırıcı açılabilir, kontaktör düşer ve motoru AC-3 sınıfı kontaktör keser (düşük gerilim açması meşru bir olaydır). Hatalar: `yuk`, `paralel`, `trafo`, `kondans`, `asiri`.
- **R6c Topraklama (topraklama ayırıcısı ya da taşınabilir takım) — ÖNCE AYIR VE KİLİTLE:** kapama yalnız (i) düğüm ölü (gerilim yokluğu tespiti), (ii) bileşeninde şarjlı kondansatör yok ve (iii) düğüm **en kötü durum ayırma testini** geçiyorsa yasaldır: kilitsiz her anahtarlama elemanı ve her görünümün seçici çiftleri kapalı sayıldığında hiçbir kaynağa (trafolar iki yönlü) yol yoktur. Yani açık sabit kesici ya da kilitsiz çekmeli kesici arkasında topraklama yapılamaz (`ayrilmamis`). Taşınabilir takım takma/sökme 1 Manevra sayar (topraklama ayırıcısıyla aynı).
- **R6c' Geri verme sırası — ÖNCE TOPRAKLAMAYI SÖK:** takılı bir topraklamanın bölümünü en kötü durumda kaynağa açacak bir kilit kaldırılamaz (`once_toprak`).
- **R6d Sigorta:** aşırı akımda erir, kendiliğinden geri gelmez. `degistir` (NH sigorta bıçağı değişimi) yalnız iki ucu da ölüyken ve yedek bıçak varsa. Arıza sürüyorsa yenisi de erir (dürüst çıkmaz).
- **R6e Yük ayırıcısı** (`yuk_ayirici{a,b,Ikes}`, RMU): yük ve halka akımını açar/kapar, paralelleme ve ring kapama yapabilir (senkron kuralı geçerli), **arızaya kapanabilir** (koruma yukarıdaki kesicide/sigortada açar, 1 Olay) ama arıza beslerken (akım > Ikes) **açılamaz** (`kesemez`). Kilitlenebilir, görünür ayırma sayılır.
- **R6f Buton (`bas`):** anlık basma: önce basılı maske ile yerleşme, sonra bırakılmış maske ile. Mühürleme (NA 13-14) devreleri yardımcı kontaktan doğal olarak çıkar.

### 2.7 LOTO (R7)
- Seviye `kilit` adet asma kilit verir. Yalnız **açık ayırıcı**, **açık yük ayırıcısı** ya da **açık çekmeli kesici** (`cekmeli:true`, dışarı çekilmiş kabul) kilitlenebilir. OG'de **açık sabit kesici ayırma noktası değildir**. (AG'de IEC 60947-2 "ayırmaya uygun" kesici ve kilitlenebilir NH sigorta tabanı uzantıdır: EXT-AYIRMA, §2.12.)
- Kilitleme/kilit açma için cihaz Volti'nin erişiminde ve **görünür** olmalıdır (§2.10). Kilitli cihaz çalıştırılamaz. Kilitleme ve kilit açma 1 Hamle, 0 Manevra (simetrik; LOTO anahtarlama işlemi değildir).
- **Kilitlenebilir seçici kafası** (`kafa{kilitlenebilir:true}`): yalnız **seçili kümede** hiçbir çifte girmiyorken kilitlenir/kilidi açılır (`kafa_temas`); kilitliyken hiçbir kümede bağlanmaz ve en kötü durum ayırmada açık sayılır.

### 2.8 Yaklaşma bölgeleri (R8)
- Her yürünebilir karo için tehlike listesi: duruş hücresine Chebyshev mesafesi ≤ r olan her `bara` ve `kondansator`.
- Karo geçilmezdir eğer listedeki bir bara düğümü **gerilimliyse**, ya da **ölü ama sabit bağlantıyla topraklanmamışsa** (EN 50110: topraklanana kadar gerilimli say), ya da şarjlı kondansatörle aynı bileşendeyse; ya da listedeki kondansatörün şarjı > 0 ise.
- **Sabit topraklı** = düğümün yalnız kablolarla bağlı (rijit) bileşeninde uygulanmış bir topraklama var. Bir anahtarlama elemanı ya da izdüşüm seçicisi üzerinden gelen topraklama sayılmaz (denetçi bulgusu: kamera topraklamanın yerine geçemez).
- Volti'yi bölgede bırakacak her eylem `tehlike` ile reddedilir.

### 2.9 İş (R9) — "Görünmeyen açıklık ayırma sayılmaz"
`calis` yalnız `w` karosunda ve: (1) iş bölgesi ölü (`is_gerilim`) ve **sabit bağlantıyla** topraklı (`is_toprak`); (2) en kötü durum ayırması (§2.6 R6c ile aynı test) tutuyor (`is_kilit`); (3) iş karosu geçilebilir. Kamera hiçbir zaman ayırma noktası ya da topraklama yerine geçemez.

### 2.10 Erişim ve görünürlük (R5) — kural sürümü 4'te görünürlük şartı yok (§25.4)
Volti bir cihazı ancak duruş hücresine yatay komşu (aynı yükseklikte, y+1 katmanında) bir ekipman küpü ise ve küpün **üst karesi** mevcut görünümde görünürse çalıştırabilir. Arayüz bir cihaza dokunulunca `sim2.approachTile` ile o görünümde erişim karosuna yürür; yoksa "Bu görünümden erişilemez" der ve erişilebilen görünümleri işaretler.

### 2.11 Zaman, kondansatör ve hedef
- **Kondansatör (R10):** şarj `c ∈ {0..3}`; gerilimliyken 3; ölüyken Hamle sayan her komutta 1 azalır (birim: *karar*). `c>0` iken yeniden enerjileme ve topraklama reddedilir (`kond`). `bekle` (w) yalnız ölü ve şarjlı bir kondansatör varken sunulur, 1 Hamle.
- **Hedef (R12):** kilitleme ihlali yok; arızalı kesim ayrılmış (gerilimli arıza yok); iş yapıldı (varsa); hedef yükler beslenir; hiçbir topraklama takılı değil; hiç kilit takılı değil; `gerilimli` listesi (bakımı biten bölüm) yeniden gerilimli; `kapali/acik` listesi varsa **normal işletme konumu** sağlanmış; `acil:true` kaynaklar (dizel, UPS) yük taşımıyor; reaktif hedef varsa Türkiye sınırı: `−kap‰·P ≤ 1000·Q ≤ ind‰·P` (varsayılan endüktif %20, kapasitif %15; seviye parametresi, fact-owner onayı ister). Bunların dışında son topoloji serbesttir. Kazanma metni: **"Besleme sağlandı — İş emri kapatıldı"**.

### 2.12 Uzantılar (her biri sim2'ye girip `verify2` ile kanıtlanmadan seviyeye konmaz)
| Kod | Kural (kesin) | Bölüm |
|---|---|---|
| EXT-RACK | Çekmeli kesici `rack` biti: içeride → araba hücresi sabit; dışarıda → araba küpü koridordaki önceden tanımlı hücreye geçer. Yalnız kesici açıkken. Kilitlenebilirlik: dışarıda + açık. | 2, 5 |
| EXT-SYNC | Jeneratör kesicisi `sync:true`: farklı grupla birleşmeyi ancak `φ = 0` iken yapar; `φ` her Hamle'de `(φ+1) mod n`. | 4 |
| EXT-79 | Tekrar kapama: koruma açtıktan sonraki ilk Hamle sonunda kesici bir kez kapanır; arıza sürüyorsa yeniden açar ve kilitlenir. LOTO, "iş var" bayrağı ya da canlı çalışma varken 79 bloke. | 4, 7 |
| EXT-ATS | Otomatik transfer (NK yardımcı ile karşılıklı kilitli). | 3, 7 |
| EXT-SAAT | Trafo saat sayısı; kesiciyle kapanan döngüde saat toplamı ≢ 0 (mod 12) ise ret ("dolaşım akımı"). Yüksüz kademe değiştirici yalnız iki taraf ölüyken; OLTC yük altında. | 5 |
| EXT-DC | DC kumanda ağı (110 V akü): diyot tek yönlü; açma bobini DC beslemesiz açamaz. Akü boşalmışsa (hikâye) önce DC geri getirilir. | 4, 6 |
| EXT-RCD | `kacak:true` yük gerilimlenince, PE sağlamsa yolundaki en düşük IΔn'li RCD açar (S tipi bir kademe gecikir); PE kopuksa RCD açmaz ve gövde karoları dokunma gerilimi bölgesi olur. `sistem:'TN-C-S'|'TT'`; TN-C kesiminde RCD etkisiz uyarısı. | 1, 6 |
| EXT-VDROP | `V ≥ Vmin` olmayan yük beslenmiş sayılmaz. | 7 |
| EXT-TERMIK | `kesici{Ir, Ii}`: Ii aşılırsa anında, yalnız Ir aşılırsa Hamle sonunda hâlâ aşılıyorsa açar; `termik{ait, Ir}` 95-96 NK, el ile reset (1 Manevra). | 3 |
| EXT-AYIRMA | AG: `kesici{ayirmaUygun:true}` OFF konumda kilitlenebilir; `sigorta{kilitlenebilir:true}` bıçak çıkarılmış + taban kilitli = açık ayırma. OG'de kullanılmaz. | 1, 3 |
| EXT-2/3 | `uc_ikide_iki:[Q03,Q04,Q0K]`: üçünden en fazla ikisi kapalı (AG iki trafo + kuplaj); kısa süreli paralel yalnız açık bayrakla. | 2 |
| EXT-ATOLYE | Boş yuvalara bileşen/anma seçimi, sonra manevra. `Ik = U0/Zs`, MCB B/C/D eşikleri 5/10/20·In, `Ib ≤ In ≤ Iz`. | Yan dal |

### 2.13 Durum, anahtar, maliyetler
- Durum `s = {p, v, b, lk, sp, st, ch, w, cs}`: karo, görünüm, cihaz bitleri, kilit bitleri, kalan yedek, taşınabilir topraklama (0 ya da bara+1), kondansatör şarjları (taban 4), iş bayrağı, seçili izdüşüm kümesi (kanonik görünüm).
- Karışık radiksli tek tamsayı; `compile()` çarpım > 2^52 ise hata verir. **Elektrik yapılandırması** = durumdan konum ve görünüm çıkarılmış hâli (`sim2.elecKey`); sınıf bantları bunu da ölçer (boyut değil içgörü).
- Maliyet (komut başına): **Hamle** h (komut; dokun-yürü koşusu 1; döndürme 0), **Manevra** m (cihaz işlemi, topraklama takımı, sigorta değiştirme, buton, bağlantı kümesini değiştiren izdüşüm komutu), **Kesinti** k (Hamle sayan her komuttan sonra beslenmeyen zorunlu yüklerin w toplamı; birimi **ağırlıklı yük-komut**, "müşteri-dakika" denmez), **Olay** o (koruma açmaları). Optimumlar gerçek demet karşılaştırmalı sözlüksel Dijkstra ile hesaplanır (taşma yok).

### 2.14 Eylem dizgisi (Manevra Defteri, hayalet, meydan okuma kodu)
Boşlukla ayrılmış simgeler: `g<karo>` git, `d+ d−` döndür, `p` izdüşümü uygula, `o:ID` aç/kapa, `k:ID` kilitle, `a:ID` kilidi aç, `f:ID` sigorta bıçağı değiştir, `b:ID` butona bas, `s:ID` taşınabilir topraklama tak/sök, `c` çalış, `w` bekle. `decodeAct` katıdır (simge başına tam düzenli ifade, bilinen eleman, geçerli karo); `sim2.replay` güvenilmeyen dizgide **asla istisna atmaz**, `{ok:false, err:'dogrulanamadi'}` döner. `describe()` Türkçe manevra günlüğü üretir (örn. "Q0K (Bara kuplaj kesicisi) KAPATILDI", "Q81 gerilim yokluğu tespit edildi, topraklandı ve kısa devre edildi").

### 2.15 Ret nedenleri (`sim2.ERR`, oyuncuya aynen gösterilir)
| Kod | Metin |
|---|---|
| gorunmez | Volti yeni görünümde görünmüyor (döndürme kapısı). |
| yuk | Ayırıcı yük akımı kesemez ve yük alamaz: bu işlemde akım akardı ve paralel bir istasyon yolu (bara/kesici/seçici komütasyonu) yok. |
| paralel | Ayırıcı iki ayrı gerilimli bölümü paralelleyemez: halka kapama ve paralelleme kesiciyle ya da yük ayırıcısıyla yapılır. |
| trafo / kondans | Trafo (yüksüz bile olsa) / kondansatör bataryası ayırıcıyla ya da izdüşüm seçicisiyle enerjilenemez/ayrılamaz. |
| asiri | Bu manevra korumayı açtırır: ayırıcı/seçici aşırı akım altında işletilemez. |
| ayrilmamis | Önce ayır ve kilitle: bu bölüm kilitsiz bir yol (açık sabit kesiciler ve her görünümün seçicileri dahil) üzerinden bir kaynağa bağlanabilir. Topraklama yalnız görünür ve kilitli ayırmadan sonra yapılır. |
| once_toprak | Önce topraklamayı kaldır: bu kilit, topraklı bir bölümün ayırma noktası. |
| toprak | Bu manevra topraklı bölüme gerilim verirdi (topraklamaya kapama — ölümcül hata). Manevra programı reddedildi. |
| toprak_canli | Gerilim yokluğu tespit edilemedi: bölüm gerilimli, topraklanamaz. |
| koruma_yok | Bu manevra korumasız bir arızayı beslerdi: yolda açma eşiği olan kesici ya da sigorta yok. |
| kesemez | Yük ayırıcısı arıza akımını kesemez. |
| senkron / seviye | Senkron kontrol (25): farklı kaynak grupları paralel bağlanamaz. / İki farklı gerilim seviyesi doğrudan birleşemez. |
| cirpma | Kumanda devresi kararsız (kontaktör çırpması). |
| tehlike | Volti yaklaşma sınırı içinde kalırdı: gerilimli, topraksız ya da yüklü (kondansatör) iletken. |
| kond | Kondansatör hâlâ yüklü: deşarj süresi bitmeden enerji verilemez / topraklanamaz. |
| kilitli / kafa_temas / acik_degil | Cihaz kilitli (LOTO). / İzdüşüm seçicisi seçili kümede bağlı: kafa ancak görünür açıklıkta kilitlenir. / Yalnız AÇIK ayırma noktası kilitlenir. |
| kilit_yok / yedek_yok / gerilim | Boşta asma kilit kalmadı. / Yedek NH sigorta bıçağı kalmadı. / NH sigorta tabanı gerilimli: önce iki taraftan ayır. |
| is_gerilim / is_toprak / is_kilit | İş bölgesi gerilimli. / İş bölgesi sabit bağlantıyla topraklanmamış (anahtarlama elemanı ya da seçici üzerinden gelen topraklama sayılmaz). / Görünmeyen açıklık ayırma sayılmaz. |
| ulasilamaz / dogrulanamadi | Cihaza bu karodan ve bu görünümden erişilemez. / Bu defter doğrulanamadı. |

---

## 3. Devre elemanları

Her satır: oyun içi Türkçe ad · `sim2` tipi ve parametreleri · davranış · neden mühendis kabul eder · görsel · ses · ilk bölüm.

| Eleman | sim2 | Davranış | Elektriksel gerekçe | Görsel (prosedürel) | Ses | Bölüm |
|---|---|---|---|---|---|---|
| **Kaynak** (şebeke fideri, trafo AG, dizel, UPS) | `kaynak{dugum, grup}` | Sabit 1 pu düğüm; grup senkron kilidi | Gerçek seviyeler: 154/34,5/0,4 kV, 230/400 V 50 Hz. 1,5 V pil yok | Fider: portal + izolatör zinciri; UPS: kabin + LED; dizel: gövde + egzoz | 50 Hz uğultu (yük ile seviye) | 0 |
| **Yük** (hastane, okul, fırın, pompa, motor) | `yuk{d,w,p,q,zorunlu}` | Sabit akım çekişi d; beslenmesi = gerilimli | Yükler akım ve güç faktörü taşır; Kesinti müşteri önemine göre ağırlıklı | Bina dioraması; beslenince pencereler yanar (halka animasyonu) | Bina tipine göre ambiyans | 0 |
| **Kesici** (MCB/MCCB/ACB AG, SF6/vakum OG) | `kesici{a,b,I,kademe,cekmeli,kapali}` | Yük ve arıza akımı keser; I aşılınca açar; kademe seçicilik | Tam olarak bir kesicinin rolü; çekmeli tipte LOTO | Gövde + I/O bayrak penceresi (yeşil O / kırmızı I + metin); çekmeli: raylı araba | Kapama: mekanik "tok" + yay; açma: daha keskin "çat" | 0 |
| **Ayırıcı** | `ayirici{a,b,kapali}` | Yüksüz işlem (R6b) | "Ayırıcı yük altında açılmaz" — her şalt mühendisinin ilk kuralı, fiziksel olarak zorlanır | Bıçak kolu açısı durumu gösterir (yatay = kapalı, 70° = açık) | Bıçak "ttunk" | 1 |
| **İzdüşüm seçicisi (kafa)** | `kafa{dugum, kilitlenebilir}` | Seçili kümede (son "İzdüşümü uygula" görünümünde) üst kareleri ekran kenarı paylaşan kafalar bağlı; geçiş iki fazlı; kilitlenebilir kafa görünür açıklıkta kilitlenir | Tek kurgusal cihaz; davranışı gerçek seçici ayırıcı (R6b akım tabanlı, paralel istasyon yoluyla transfer, açık konumda kilitlenir) | Metal muhafazalı (GIS/RMU benzeri, topraklı gövde) kutu + vizör penceresi; seçili çiftler kalıcı dikiş çubuğu; tehlike bölgesi değildir | Kontak "tık" (faz başına) | 0 |
| **Sigorta** (NH bıçaklı) | `sigorta{a,b,I,kademe}` | Açma eşiği aşılınca erir; yedek NH sigorta bıçağı sınırlı; değişim iki taraf ölüyken (NH çekme kolu) | Yönsüz; eşik tabanlı seçicilik; "sigorta köprülenmez" | NH sigorta tabanı + NH sigorta bıçağı; eriyince gösterge kırmızı + metin "ERİDİ" | Kuru "pof" (patlama değil) | 1 |
| **Topraklama ayırıcısı** | `toprak{dugum}` | Yalnız ölü ve deşarjlı düğüme; topraklı bölüm enerjilenemez | Beş altın kuralın 3–4'ü, doğru sırayla | Sarı-yeşil çizgili kol; kapanınca kelepçe | Dedektör bip-bip + kelepçe "klak" | 1 |
| **Taşınabilir topraklama takımı** | `set:true`, `s:ID` (bara) | Bir takım; bara üstüne takılır | Saha pratiği | Sarı-yeşil kablolu üç kıskaç | Aynı | 2 |
| **Asma kilit + etiket (LOTO)** | `kilit:k`, `k:/a:` | Açık ayırıcı / çekmeli kesiciyi dondurur | VoltGuard'ın kilitleme-etiketleme kültürü | Kırmızı asma kilit + turuncu etiket "ÇALIŞMA VAR — KAPATMAYIN — VOLTİ"; Volti'nin kemerinde kalan kilitler | Kilit "klik" | 1 |
| **Açık bara** (yaklaşma sınırı) | `bara{dugum,r}` | Gerilimli ya da topraksızsa r yarıçapında karolar geçilmez | Yaklaşma mesafeleri; ölü ama topraksız = gerilimli say | Bakır/alüminyum bara + taralı yarı saydam hacim (desenli, renk tek ipucu değil) | Düşük 50 Hz + 100 Hz | 1 |
| **Trafo** (34,5/0,4 kV, kumanda trafosu) | `trafo{a,b}` | Seviyeleri bağlar, galvanik yalıtır, iki yönlü enerjilenir; ayırıcı/seçiciyle enerjilenmez (R6b) | AG'den geri besleme klasik ölümcül kaza senaryosu | Tank + radyatör kanatları + OG/AG buşingler + yağ göstergesi + Dyn11 levhası | 100/200/300 Hz manyetostriksiyon, yük ile seviye | 2 |
| **Kontaktör (AC-3) + yardımcı kontak (NA/NK) + buton** | `kontaktor{a,b,bobin}`, `yardimci{ait,nc}`, `buton{nc}` | Bobin düğümü gerilimliyse kapalı; sabit nokta; kontaktör çırpması ret; bobin düşmesi (düşük gerilim açması) meşru | Mühürleme (NA 13-14), karşılıklı kilitleme, yıldız-üçgen | DIN rayı, şeffaf kapak, hareketli kontak çubuğu | Kontaktör "klonk" | 3 |
| **Kondansatör bataryası (kompanzasyon kademesi)** | `kondansator{dugum,q,r,sarj}` | Q reaktif orana katkı; şarj 3→0 (karar birimi); şarjlıyken enerji/topraklama yok; metal muhafazalı, iç deşarj dirençli | Deşarj süresi kuralı; Türkiye reaktif sınırı endüktif %20 / kapasitif %15 (seviye parametresi, fact-owner onayı ister) | Silindir kutular + deşarj direnci; şarj halkası 3/2/1 (sayı + segment) | Hafif cızırtı azalarak | 3 |
| **Arıza** (kablo eki arızası) | `ariza{dugum}` | Toprağa şönt iletkenlik (G=100, `Ik = V·G`): gerilimlenince en düşük kademeli koruma açar; korumasız yol `koruma_yok` ile reddedilir | Bölümlendirme ile arıza bulma | Kablo ekinde is lekesi + röle bayrağı (sarı) | Röle bayrak düşmesi "tık" | 1 |
| **Yük ayırıcısı** (RMU) | `yuk_ayirici{a,b,Ikes,kapali}` | Yük ve halka akımını açar/kapar, arızaya kapanır (koruma yukarıda açar), arıza beslerken açılamaz (`kesemez`); kilitlenebilir | IEC 62271-103; OG dağıtımda ring kapama ve normalde açık noktanın taşınması | RMU hücresi, üç konumlu kol göstergesi | Yaylı "klak" | 1 |
| **Kablo** | `kablo{a,b,g}` | İletkenlik g | Paralel yollar empedansla paylaşır | Kablo kanalı / havai hat (katener) | — | 0 |
| **RÖLE-7** (hikâye otomasyonu) | kesici `I`/`kademe` ayarları | Aşırı hassas eşikler; ayar düzeltme bulmacası (EXT-79 ile) | Koruma koordinasyonu | Eski röle odası, amber ekran | Eski bip | 4 |

Uzantı elemanları (EXT-*) §2.12'deki kurallarla aynı tabloya, uygulandıkları gün eklenir.

---

## 4. İzdüşüm × devre (kural sürümü 3 — KALDIRILDI; yerine §25.6 fiziksel kapılar)

### 4.1 Yedi bağlantı (her biri bir ablasyon bayrağıyla ölçülür)
1. **İzdüşüm seçicisi = görünümle tanımlı seçici ayırıcı** (`noCouplers`, `noCommit`, `freeze`). Yük fideri kafası iki farklı görünümde iki farklı bara kafasına değer; bakılan görünüm adaydır, "İzdüşümü uygula" komutu seçimdir. Transfer: (1) kuplaj kesicisini kapa, (2) yeni görünüme dön ve izdüşümü uygula (önce kapa, sonra aç), (3) kuplajı aç. Kuplaj açıkken uygulama `paralel`/`yuk` ile reddedilir.
2. **Bakmak bedava, uygulamak manevradır.** Döndürme yalnız gezinmedir (G3 kapısı); hiçbir yükü düşürmez. Bir görünümün seçici kümesini uygulamak ise 1 Hamle + 1 Manevra'lık, R6b ile denetlenen bir anahtarlama işlemidir: Volti'nin uygulamak için o görünümde ve o karoda durması gerekir, bu da yol ile bakırın çatışmasını korur.
3. **İki katmanlı çatışma: yol ve bakır** (`noZones`, `noRotate`). Yürüyüş grafı görünüme, geçilebilirlik enerjiye bağlı. Volti'nin köprüsünü açan görünüm hastanenin kablosunu koparabilir ya da yolu kapatan barayı gerilimleyebilir.
4. **Görünmeyen açıklık ayırma sayılmaz** (`noLoto`). İş yüklemi ve topraklama (R6c) her görünümün seçici çiftlerini kapalı varsayar; topraklama yalnız sabit bağlantıyla sayılır.
5. **Görünürlükle kapılanan işlem** (`noVisOps`). Cihaz yalnız üst karesi görünürken çalıştırılır/kilitlenir. Bazı cihazlara yalnız bir görünümde var olan bir karodan erişilir.
6. **Görünümlerde kilitleme.** İki kV seviyesini, iki senkronsuz grubu, gerilimli ile topraklıyı birleştirecek ya da yük alacak/kesecek seçici kümesi o an uygulanamaz; "İzdüşümü uygula" önizlemesi hangi dikişin hata yapacağını gösterir.
7. **Elektriksel anlamda derinlik kısayolu** (EXT-VDROP). Uzak kafaları derinlikten birleştiren seçici elektrik yolunu kısaltır.

### 4.2 Kapı (build'de zorunlu)
Öğretici olmayan seviyelerin **en az %80'inde**, seçiciler 4 görünümün HER birinde ayrı ayrı dondurulduğunda (`freeze:v`, izdüşüm komutu yok) Hamle-opt ya da Kesinti-opt planı değişmeli ya da seviye çözümsüz olmalıdır (`verify2.js` kontrol 9). Bu, "hedef yük yalnız bir seçici üzerinden bağlı" türü kendini doğrulayan kanıtı dışlar: hangi görünüm seçilirse seçilsin kamera gerçek bir karardır. Seçicisiz seviye kapıdan kalır. Şu an 7/8 (%88). `noRotate` sayılmaz.

### 4.3 Model Notları (El Kitabı sayfası, oyuncuya açık)
- İzdüşüm seçicisi tek kurgusal cihazdır ("görüş hattı telekumandalı motorlu seçici ayırıcı"); diğer her şey gerçek davranır.
- Akım modeli DC eşdeğeri, pu; tek hat (3 faz yok); kaynaklar ideal; yükler sabit akım; arıza toprağa şönt iletkenlik. Doğrulayıcı her erişilebilir durumda akım ile açma eşiği arasında ≥ 0,5 birim pay (K7) ve gerilimli düğümlerde ≥ 0,9 pu (K10) arar. `I` anma akımı değil **açma eşiğidir** (termik/manyetik ayrım EXT-TERMIK).
- Yaklaşma mesafeleri ölçeklidir (1 hücre). Kondansatör bataryaları metal muhafazalı ve iç deşarj dirençlidir: deşarj süresi (3 karar) dolunca yaklaşılabilir; iş bölgesindeyse topraklama yine şarttır.
- Kesinti birimi "ağırlıklı yük-komut"tur (her komuttan sonra beslenmeyen zorunlu yüklerin öncelik ağırlığı toplamı); SAIDI/ENS değildir.
- Ağ çapındaki "topraklamaya kapama" reddi bir yedek denetimdir; birincil kural yereldir (önce ayır ve kilitle, sonra toprakla).
- Standarttan türeyen her değer (EN 50110-1, IEC 60364-5-52, IEC 60831, IEC 60076-7, Türkiye reaktif enerji sınırları, metro DC seviyeleri) yayından önce VoltGuard'da bir insan "fact-owner" tarafından onaylanır.

---

## 5. Bağlılık döngüsü (yalnız ustalık; karanlık desen yok)

### 5.1 Metrikler
Her seviye dört dik metrikle puanlanır; her biri için build zamanında **kesin optimum** hesaplanır (`solve2.optimum`, sözlüksel Dijkstra) ve seviye verisine damgalanır.

| Metrik | Tanım | Sunum | Neden mühendis için anlamlı |
|---|---|---|---|
| **Hamle** | Komut sayısı (yürüyüş koşusu 1, döndürme 0) | "Hamle 30" | Karar sayısı; yürüme mesafesini değil düşünceyi ölçer |
| **Manevra** | Cihaz işlemi + topraklama takımı + sigorta değişimi + buton + bağlantı kümesini değiştiren izdüşüm komutu | "Manevra 13" | Gerçek manevra programındaki işlem sayısı; az işlem = az risk |
| **Kesinti** | Hamle sayan her komuttan sonra beslenmeyen zorunlu yüklerin ağırlık toplamı | "Kesinti 72 yük-komut" | Önceliğe göre ağırlıklı kesinti (ENS'e benzer ama birimi açıkça oyun birimidir) |
| **Olay** | Koruma açmaları | "Olay 0 · Temiz İşçilik" | Arızaya kapama, seçicilik kaybı |

Kazanma panelinde oyuncunun vektörü `[Hamle, Manevra, Kesinti, Olay]` doğrulanmış optimumların yanında gösterilir; Pareto cephesi (Hamle×Kesinti, Hamle×Manevra; `solve2.front`, katmanlı DP, par+12 aralığı) küçük bir saçılım grafiğinde.

### 5.2 Histogramlar (dürüst, sunucusuz)
Her metrik çubuğu üç katmanı üst üste çizer:
1. **Doğrulanmış sınır** (dikey çizgi, "Mühendis optimumu") — yalnız ilk çözümden sonra açılır.
2. **Çözüm uzayı** (soluk çubuklar, "çözüm uzayı" etiketli): `metrics2.solutionSpace`, her Hamle değerinde (par…par+12) kaç farklı kazanma durumu olduğu — keşfedilen grafın kesin sayımı, simülasyon değil. (Kural sürümü 2'deki simüle popülasyon kaldırıldı: 11 seviyenin 7'sinde 400 ajandan hiçbiri bitirmiyordu.)
3. **Yerel geçmiş** (oyuncunun kendi çözümleri, noktalar) + kişisel en iyi (kalın işaret).
Küresel (topluluk) histogramı sonraki sürüm: ADR + gizlilik incelemesi, yalnız sayımlar, sıra numarası ve isim yok, opt-in.

### 5.3 Kişisel en iyiler, hayalet, defter
- Metrik başına ayrı kişisel en iyi; her biri Manevra Defteri dizgisiyle saklanır (§10).
- **Hayalet Volti:** kayıtlı dizgiyi yarı saydam ikinci rig ile 1×/2×/4× hızda oynatır; kendi denemenin yanında.
- **Meydan okuma kodu:** kopyalanabilir metin `PX2-<seviyeId>-<base64url(dizgi)>-<h.m.k.o>` + menüde "Kod yapıştır" (file:// ve telefonda çalışır); http(s) altında aynı kod URL parçası olarak da paylaşılır (§24.4). Alıcı `sim2.replay` ile yeniden doğrular (asla istisna atmaz); geçersizse "Bu defter doğrulanamadı".
- **Manevra Defteri görünümü:** `describe()` satırlarıyla gerçek Türkçe manevra günlüğü (numaralı), kopyalanabilir metin. Mühendislerin paylaşmak isteyeceği şey budur.

### 5.4 Mühürler (yalnız kozmetik ödül: Volti kask çıkartması, eldiven şeridi, pano isim levhası)
| Mühür | Koşul |
|---|---|
| Mühendis Mührü | Aynı koşuda Hamle, Manevra ve Kesinti optimumlarının üçü de (ya da cephedeki bir nokta + diğer ikisinin optimumu; seviye verisi hangisinin mümkün olduğunu söyler) |
| Sıfır Kesinti | Kesinti = 0 (yalnız mümkün olan seviyelerde gösterilir) |
| Temiz İşçilik | Olay = 0 ve ipucusuz |
| Tek Bakış | En az izdüşüm komutu (build'de son demet ölçütü olarak hesaplanır) |
| Kitap Gibi | Beş altın kuralı kanonik sırayla, fazla işlem olmadan |
| Pareto Noktası | Tek-metrik optimumu olmayan bir cephe noktasına tam isabet |
| Gizli Bağ | Bölgedeki gizli izdüşüm bağlarından birini kullanan çözüm (yerleri asla gösterilmez; bölge panosunda yalnız "3/5") |

### 5.5 Günün Manevrası (günlük bulmaca)
- 366 seviyelik havuz build'de üretilip doğrulanır (§19); gün indeksi `gün = floor((Europe/Istanbul yerel tarih − 2027-01-01)/1 gün) mod 366`. Herkes aynı bulmacayı alır.
- Tam arşiv; kaybedilecek seri yok; bildirim yok. Tek sayaç: "N gün oynandı". Çözünce o günün Pareto cephesi açılır.

### 5.6 İpuçları (iki kademe, cezasız)
İpuçları oyuncunun seçtiği metriği izler (sayaçların yanında seçici; varsayılan Hamle). Hamle tablosu ters 0-1 BFS, Kesinti tablosu ters demet Dijkstra (`solve2.toGoalLex`, Kesinti sonra Hamle).
1. **Kural dürtmesi:** sıradaki optimum eylemin türü ve nedeni; metin şablondan üretilir: denenen ya da denenecek eylemin `apply` ret kodu (`sim2.ERR`) + `describe` adları ("Önce paralel yol kur: Q0K kapalı değilken bu izdüşüm uygulanamaz — ayırıcı yük alamaz").
2. **Hayalet adım:** seçili metriğin tablosundan bir sonraki segmentin (dokun-yürü + işlem) hayalet Volti ile gösterimi; yalnız yasal eylemler.
İpucu skoru engellemez; yalnız "ipuçlu" bayrağı koşar ve Temiz İşçilik/Mühendis Mührü o koşuda verilmez. Çıkmazda ipucu istemek ücretsizdir ve sayılmaz.

### 5.7 Kalıcı ilerleme
Çözülen dioramanın bölgesi kalıcı olarak yanar; oyuncu yokken hiçbir şey sönmez, çürümez, beklemez. Hiç zamanlayıcı, enerji sayacı, reklam, uygulama içi satın alma, ganimet kutusu, FOMO etkinliği, kaybedilebilir seri yok.

---

## 6. Zorluk felsefesi ve sayısal hedefler

İlke: zorluk **içgörüden** gelir, boyuttan değil. Her seviye bir tasarımcı içgörü cümlesi taşır (`ogretir`, oyuncuya gösterilmez) ve iddia ettiği her mekaniği ablasyonla kanıtlar.

### 6.1 Sınıf bantları (build kapısı; `bands2.js`, bant dışı seviye reddedilir)
| Sınıf | Hamle par | Durum (tavan) | Elektrik yapılandırması | Manevra-opt | Kesinti-opt planı Manevra | Basma (dokun-yürü) | Yürüyüş payı | Saf karar (freeWalk) | Esaslı mekanik | Çok amaçlı |
|---|---|---|---|---|---|---|---|---|---|---|
| Öğretici | 4–16 | 2·10⁴ | ≥ 6 | ≥ 2 | ≥ 2 | ≤ %60 | ≤ %60 | ≥ 3 | ≥ 1 | — |
| Çekirdek | 10–30 | 1,2·10⁵ | ≥ 16 | ≥ 4 | ≥ 5 | ≤ %10 | ≤ %60 | ≥ 5 | ≥ 2 | — |
| Zor / Usta | 18–50 | 1,2·10⁵ | ≥ 150 | ≥ 4 | ≥ 7 | ≤ %1 | ≤ %55 | ≥ 10 | ≥ 3 | zorunlu |
| Sınav (bölüm sonu) | 24–60 | 1,2·10⁵ | ≥ 300 | ≥ 6 | ≥ 12 | ≤ %0,5 | ≤ %55 | ≥ 12 | ≥ 4 | zorunlu |
| Günlük | 10–30 | 6·10⁴ | ≥ 16 | ≥ 4 | ≥ 5 | ≤ %10 | ≤ %60 | ≥ 5 | ≥ 2 | — |

Tanımlar: *basma* = 10 000 koşu, `6·par+20` KOMUT, dokun-yürü rastgele oyuncu (yürüyüş otomatik; her adımda erişilebilir karolardan yapılabilen farklı yürüyüş-dışı komutlardan biri eşit olasılıkla), sabit tohum. *Esaslı* = Hamle-opt'u ya da Kesinti-opt planını değiştiren standart ablasyon (`noRotate` hariç). *Çok amaçlı* = Hamle/Manevra/Kesinti optimum VEKTÖRLERİNDEN en az ikisi farklı ya da bir Pareto cephesi ≥ 2 nokta (yol dizgisi farkı sayılmaz). *Manevra-opt* tabanı bilerek düşüktür: bir bölümü ayır-kilitle-toprakla-geri ver fiziği gereği ≥ 4 işlemdir ve bu sayıyı büyütmek için devreye anlamsız cihaz eklemek boyutu ödüllendirirdi; zorluk, mühendisin gerçekte yürüteceği en az kesintili programın uzunluğuyla (Kesinti-opt planı Manevra), elektrik yapılandırması sayısıyla ve saf karar sayısıyla ölçülür.

Ortak kapılar: K7 koruma payı (≥ 0,5 birim; tam eşitlik yok; tamsayı olmayan akımda ≥ 1), K9 gerçekçilik, K10 gerilim ≥ 0,9 pu, altın defterlerin güvenlik denetimi, `iddia` önermeleri, izdüşüm×devre kapısı (§4.2), çıkmaz kesri yalnız dürüst kaynaklarda (yedek sigorta) > 0. Açgözlü-bot farkı (K6) henüz kodda değil (§22).

### 6.2 Akıl yürütme türleri (her bölüm en az ikisini ister)
Sıralama (manevra programı yazmak) · kesit (cut-set) düşüncesi (k kilitle bütün yolları kesmek, geri besleme ve her görünümün seçici çiftleri dahil) · komütasyon (paralel yolla yüksüz cihazın yük taşıması) · seçicilik (hangi cihaz önce açar) · zamanlama (deşarj beklemesini işle doldurmak) · geometri (hangi görünüm Volti için var, hangisi elektrikçe yasal, hangi karo/görünüm çifti hangi cihaza erişir) · çok amaçlı değiş tokuş (min-Hamle planı hastaneyi düşürür; min-Kesinti ekstra transfer ister).

### 6.3 Sıkıcı giriş olmadan rampa
- Her yeni kural 10 saniyelik bir kural kartı (mini tek hat şeması) ile gelir; ardından gelen seviye **karşı örnektir**: saf yaklaşım belirgin şekilde başarısız olur ve "Neden?" kartı fiziği anlatır.
- Her bölüm isteğe bağlı bir **Usta Girişi** sınavıyla açılır: par'da çözmek bölümün öğretici seviyelerini "tamam" sayar; deneyimli mühendis doğrudan atlar.
- Yalnız yürümeyi öğreten seviye yoktur; yürüyüş ilk manevra seviyesinin içinde öğrenilir.

---

## 7. Bölüm ve biyom planı (55 seviye + günlük + sırlar)

Her satır paralel seviye tasarımcısının (insan ya da ajan) üretebileceği kadar kesindir: şablon (`templates2.js` adı ya da yeni şablon tarifi), esaslı ablasyonlar, sınıf. ✔ = `levels2.js`'te doğrulanmış kanıt seviyesi var. "Yeni şablon" satırları önce `templates2.js`'e eklenir. EXT gerektiren seviyeler o uzantı sim2'ye girmeden üretilmez.

### Bölüm 0 — Prolog: VoltGuard Deposu (AG, 4 seviye)
| # | Ad | Öğrettiği / sınadığı | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 0.1 ✔P1 | İlk Manevra | İzdüşüm seçicisi yük alamaz/kesemez: kesiciyi aç, izdüşümü uygula, kesiciyi kapat. Yürüme ve döndürme burada öğrenilir | ilk_manevra | noCommit, noAyiriciKurali | Öğretici |
| 0.2 | Görünmeyen Yoktur | G2/G3: bir karo yalnız tam görünüyorsa vardır; cihaz yalnız üst karesi görünürken çalışır | ilk_manevra + `noVisOps` esaslı | noVisOps, noCommit | Öğretici |
| 0.3 | Kesici mi, Ayırıcı mı? | Ayırıcıyla yük kesilemez; kesici → ayırıcı sırası | bes_kural (işsiz varyant) | noAyiriciKurali | Öğretici |
| 0.4 | Depo Kapısı (Sınav) | Üçünün birleşimi; kapı motoru + aydınlatma iki bara kafasında | ilk_manevra genişletilmiş (4 kafa, 2 kesici) | noCouplers, noAyiriciKurali | Çekirdek |

### Bölüm 1 — Volt Mahallesi (AG şebeke, 8 seviye)
| # | Ad | Öğrettiği | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 1.1 ✔M1 | Beş Altın Kural | Ayır (kesici sonra ayırıcı), kilitle, gerilim yokluğu + topraklama, çalış; ters sırayla geri ver | bes_kural | noZones, noLoto, noAyiriciKurali | Öğretici |
| 1.2 | Ölü Ama Topraksız | Topraklanmamış bara gerilimli sayılır: koridor ancak topraklayınca açılır | bes_kural (koridor varyantı) | noZones | Öğretici |
| 1.3 ✔M2 | Yedek Bıçak | NH sigorta bıçağı yalnız iki taraf ölüyken değişir; senkron olmayan Trafo-2 tarafına yükü seçiciyle ancak ölüyken aktar | secicilik | noCommit, noAyiriciKurali | Çekirdek |
| 1.4 | Seçici Koruma | En düşük kademeli aşırı yüklü cihaz açar (K7 paylı, tamsayı talepler); arıza sürüyorsa yeni NH bıçağı da erir (dürüst çıkmaz) | secicilik + `ariza` | noProtection | Çekirdek |
| 1.5 ✔M3 | Ring Arızası | Arızalı kablo ekini iki RMU yük ayırıcısıyla iki taraftan ayır; hastaneyi halkanın öbür ucundan, seçici yüksüzken bağlayarak besle (34,5 kV) | ariza_ayirma | noCommit, noAyiriciKurali, noProtection:kesinti | Çekirdek |
| 1.6 | Normalde Açık Nokta | Ring kapama yalnız kesiciyle (R6b paralel kuralı); açık noktayı taşı | ariza_ayirma (iki kaynak, aynı grup) | noAyiriciKurali, noCouplers | Çekirdek |
| 1.7 | İki Kilit, Üç Sınır | Kesit düşüncesi: bölgeyi küçült ki k kilit yetsin | bes_kural (3 sınır, kilit 2) | noLoto, noCouplers | Zor |
| 1.8 | Mahalle Sınavı | 1.1–1.7 hepsi | yeni: `mahalle_sinav` (ring + bara + sigorta + 2 kilit) | ≥ 4 | Sınav |
Usta Girişi: 1.8'in kısa varyantı. Uzantı seviyesi (EXT-RCD hazır olunca): 1.U "Kaçak Avı".

### Bölüm 2 — Trafo Merkezi (34,5/0,4 kV, 8 seviye)
| # | Ad | Öğrettiği | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 2.1 | Trafo Ayırıcıyla Enerjilenmez | Yüksüz trafo bile ayırıcıyla enerjilenemez (R6b) | yeni: `trafo_giris` | noAyiriciKurali | Öğretici |
| 2.2 ✔T1 | Geri Besleme | AG tarafından geri besleme; TR1 AG çekmeli kesicisini çek-kilitle; sıfır kesinti için hastaneyi önce seçicilerle TR2'ye yüksüz aktar; normal konuma dön | geri_besleme_k | noCommit:kesinti, noAyiriciKurali, noZones, noLoto, noBackfeed | Zor |
| 2.3 | Taşınabilir Topraklama | `set` ile baraya takılan tek takım (1 Manevra); yalnız görünür ve kilitli ayırmadan sonra | geri_besleme_k + `set:true` | noZones, noLoto | Çekirdek |
| 2.4 | Uzak Taraftan Topraklama | Topraklama anahtarının padına ulaşılamıyor: A2'yi kapatıp bölgeleri birleştir, öbür uçtan toprakla | yeni: `uzak_toprak` | noCouplers, noZones | Çekirdek |
| 2.5 ✔T2 | Trafo N-1 Bakımı | Hastane ve fırını seçicilerle TR2 tarafına yüksüz aktar, kondansatör deşarjı, AG çekmeli kesici kilidi; iki trafo da servise döner | usta_merkez | noCommit, noAyiriciKurali, noLoto, noBackfeed | Zor |
| 2.6 | Hastane Kesintisiz | 2.5 ile aynı şebeke, `iddia:{t:'kesintisiz', yukler:['Y1']}` ile Kesinti-opt yolunda hastane hiç düşmez | usta_merkez + hedef | noCommit:kesinti | Zor |
| 2.7 | Çekmeli Araba (EXT-RACK) | Arabayı çekmek hem görünür ayırma hem koridordaki küp | trafo_n1 + rack | noRack, noLoto | Zor |
| 2.8 | Trafo Merkezi Sınavı | Hepsi | usta_merkez genişletilmiş | ≥ 5 | Sınav |

### Bölüm 3 — Fabrika (AG motor kontrol, kompanzasyon; 7 seviye)
| # | Ad | Öğrettiği | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 3.1 ✔F1 | Mühürleme | START bırakılınca NA 13-14 mühürleme kontağı tutar; aydınlatma kablosunu bağlayan seçici yükü ancak fider kesicisi açıkken alır | muhurleme | noCommit, noAyiriciKurali | Öğretici |
| 3.2 | Karşılıklı Kilitleme | İki kontaktör NK yardımcılarla kilitli (ileri/geri motor; faz değişimi tek hatta görünmez — El Kitabı notu) | yeni: `ters_yon` | noCommit | Çekirdek |
| 3.3 | Kumanda Gerilimi | Kumanda barasını ölü yapmak başka yerde kontaktörü düşürür (düşük gerilim açması); geri kendiliğinden kapanmaz | pompa_ist | noAyiriciKurali, noCapLock | Çekirdek |
| 3.4 ✔F2 | Kompanzasyon Kademeleri | Seçici kondansatör anahtarlayamaz; deşarj; endüktif %20 / kapasitif %15 sınırı için kademe bileşimi (kesintili kısa plan ya da az kesintili uzun plan) | kademe_k | noCommit, noAyiriciKurali, noZones, noCapLock | Çekirdek |
| 3.5 | Deşarjı Verimli Bekle | Bekleme süresini başka işlerle doldur (Hamle optimumu bekle'siz) | kademe_k + iş bölgesi | noCapLock | Zor |
| 3.6 | Yıldız-Üçgen | Kontaktör sırası (EXT-ATS mantığıyla aynı sabit nokta) | yeni: `yildiz_ucgen` | noCouplers | Çekirdek |
| 3.7 | Fabrika Sınavı | Hepsi | pompa_ist genişletilmiş | ≥ 4 | Sınav |

### Bölüm 4 — Baraj: Kara Başlatma (6 seviye; EXT-SYNC, EXT-79, EXT-DC gerekir)
| # | Ad | Öğrettiği | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 4.1 | Önce DC | İstasyon aküsü ve redresör olmadan kesici açma bobini çalışmaz | yeni: `dc_once` (EXT-DC) | noDC | Öğretici |
| 4.2 | İlk Ada | Dizel → yardımcılar → uyartım; ada kapasitesi (yük sırası Kesinti'yi belirler) | yeni: `ilk_ada` | noCouplers, noProtection | Çekirdek |
| 4.3 | RÖLE-7 | Aşırı hassas kademe/eşik; tekrar kapama kilitlenmesi (EXT-79) | yeni: `role7` | no79, noProtection | Çekirdek |
| 4.4 | Senkronoskop | φ=0'a tam isabet; beklemeyi işle doldur (EXT-SYNC) | yeni: `senkron` | noSync, noCouplers | Zor |
| 4.5 | İki Ada | İki adayı senkronlayıp birleştir; ekranda hizalama = ibre 12 | `senkron` genişletilmiş | noSync, noCouplers | Zor |
| 4.6 | Baraj Sınavı | Hepsi | — | ≥ 5 | Sınav |

### Bölüm 5 — Dağıtım Merkezi 34,5 kV, çift bara (8 seviye; R2)
| # | Ad | Öğrettiği | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 5.1 | Kuplaj Önce | Kuplaj açıkken yük taşıyan izdüşüm uygulanamaz (`paralel`/`yuk`) — karşı örnek | secici_gorus (kısa) | noCommit, noAyiriciKurali | Öğretici |
| 5.2 ✔S3 | Bara Transferi | Gerçek çift bara transferi: Q0K kapalıyken izdüşümü uygula (önce kapa sonra aç), Bara A seçici kafasını görünür açıklıkta kilitle; Sıfır Kesinti; normal konum | bara_transfer | noCommit:kesinti, noAyiriciKurali:kesinti, noLoto | Zor |
| 5.3 ✔S2 | Seçici Görüş | Seçicilerle bara seçimi; Bara A bakımı için kesit seçimi; kısa ama kesintili plan ile komütasyonlu uzun plan arasında 7 noktalı cephe | secici_gorus | noCommit, noAyiriciKurali, noZones, noLoto | Zor |
| 5.4 ✔S1 | Çift Bara Transferi | Fiziksel bara ayırıcılarıyla kesintisiz transfer (Q0K kapa → Q12 kapa → Q11 aç → Q0K aç) ve normal işletme konumuna dönüş | cift_bara | noAyiriciKurali:kesinti, noZones, noLoto | Zor (seçicisiz) |
| 5.5 | By-pass | Fider kesicisini by-pass ayırıcısıyla bakıma al | yeni: `bypass` | noCouplers, noAyiriciKurali | Çekirdek |
| 5.6 | Saat Sayısı (EXT-SAAT) | Dyn11 ile Dyn5 paralel olmaz; döngü toplamı mod 12 | yeni: `saat` | noSaat | Çekirdek |
| 5.7 | Kademe Eşle | Off-circuit kademe yalnız iki taraf ölüyken; eşit olmayan kademede paralel → dolaşım | yeni: `kademe_esle` | noSaat, noCouplers | Zor |
| 5.8 | Şalt Sahası Sınavı | Hepsi | — | ≥ 5 | Sınav |

### Bölüm 6 — Yenilenebilir + Metro (6 seviye)
| # | Ad | Öğrettiği | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 6.1 | Gündüz Kaynağı | PV dizisi gündüz hep kaynaktır: LOTO tuzağı | yeni: `pv_geri` | noBackfeed, noLoto | Çekirdek |
| 6.2 | Ada Önleme | İnverter ada algılayınca kendini ayırır (EXT-ATS mantığı) | yeni: `ada_onleme` | noCouplers | Çekirdek |
| 6.3 | Batarya Konteyneri | Konteyner tramvayı besler (perde geçişi); DC seviye ayrımı | yeni: `konteyner` (EXT-DC) | noDC, noCouplers | Çekirdek |
| 6.4 | Üçüncü Ray | Uzun yaklaşma bölgesi; kesim izolatörleri; yanda trenler çalışmaya devam | yeni: `ray` (bara r=2) | noZones, noLoto | Zor |
| 6.5 | Rejeneratif Geri Besleme | Fren enerjisi rayı besler | `ray` + kaynak | noBackfeed | Zor |
| 6.6 | Sınav | Hepsi | — | ≥ 5 | Sınav |

### Bölüm 7 — Kent Şebekesi: Fırtına (6 seviye)
| # | Ad | Öğrettiği | Şablon | Esaslı | Sınıf |
|---|---|---|---|---|---|
| 7.1 | Röle Bayrağı | Hangi fider açtı? En az Olay ile arıza yeri (böl ve fethet) | ariza_ayirma genişletilmiş | noProtection | Çekirdek |
| 7.2 | FLISR | Arızalı kesimi ayır, iki uçtan geri ver | yeni: `flisr` (RMU zinciri; `yuk_ayirici` uzantısı = kesici gibi ama arızaya kapanamaz) | noCouplers, noProtection | Zor |
| 7.3 | Soğuk Yük | Uzun kesintiden sonra yük 2× çeker (EXT; `soguk` katsayı bir Hamle) | yeni | noCouplers | Zor |
| 7.4 | Hastane ATS | ATS kilitlemesini bilerek kullan, yedek tarafta çalışmadan önce ATS'yi kilitle | yeni: `ats` (EXT-ATS) | noATS, noLoto | Zor |
| 7.5 | Gerilim Düşümü | Derinlik kısayolu kaliteyi iyileştirir (EXT-VDROP) | yeni | noCouplers, noVdrop | Zor |
| 7.6 | Fırtına Sınavı | Hepsi; zamanlayıcı yok | — | ≥ 6 | Sınav |

### Final — Kalp (2 seviye)
| # | Ad | Öğrettiği | Not |
|---|---|---|---|
| F.1 | Aşırı Yük Bütçesi | Trafo kısa süreli aşırı yükü tamsayı yaşlanma bütçesi olarak (S üstündeki her Hamle bütçeden düşer; değerler IEC 60076-7 fact-owner onayı) | Patlama yok; sıcak nokta göstergesi |
| F.2 | Kalp | Yükü aktar, bütün şehri halka halka geri ver | Kıvılcım senkron referansı olarak döner (CANON §18, ADR) |

### Sırlar ve yan işler
- **Gizli Bağ** (her bölgede 3–5): çözülmüş bir dioramanın belirli bir elektrik durumunda beliren izdüşüm bağları (§24.7); daha kısa çözüm açar. Sayı gösterilir, yer asla.
- **Kayıp Ölçüm Noktası** (7 adet, dünya haritasında): yalnız belirli açıdan hizalanınca görünen ölçüm kutusu; bulununca o bölgenin canlı tek hat paneli SCADA'ya eklenir.
- **Hikmet Usta'nın kasetleri** (1975 / 1995 / 2015, 12 adet): perspektifle ulaşılan yerlerde; gerçek saha pratiği anlatır.
- **Optimizasyon talepleri:** çözülmüş dioramanın farklı hedefli tekrarı ("Kesinti −%30, Manevra ≤ 14").
- **Atölye** (EXT-ATOLYE, 10–20 tasarım seviyesi): boş yuvaya bileşen/anma seç, sonra manevra; Maliyet ₺ metriği; kesin optimum build'de tasarım sayımıyla.

---

## 8. Dünya haritası (overworld)

- VoltCity, küçük dioramalardan oluşan bir **bölge haritasıdır** (her bölge en çok 9×9×5 hücre); aynı G1–G4 kuralına uyar: Volti bölgede yürür, döndürmek sokakları bağlar. Bölge haritası **elektrik içermez** (yalnız yürüyüş + sır), böylece durum uzayı küçük kalır (< 2 000).
- Her bina bir İş Emri'dir; kapısına yürüyüp dokununca diorama açılır (≤ 300 ms geçiş, §12).
- **Işıyan hat pusulası:** son çözülen dioramadan sıradaki iş emrine akan kesikli ışık çizgisi yerde çizilir; HUD oku yok. Yalnız görünen segmentlerde çizilir.
- Ana trafo merkezi ("Kalp") her bölgeden görünür; her çözülen diorama ona bir hüzme gönderir.
- Bölgeler: Depo → Volt Mahallesi → Trafo Merkezi → Fabrika → Baraj → Şalt Sahası → Yenilenebilir/Metro → Kent Merkezi. Bölgeler arası geçiş tramvayla (batarya konteyneri perde 6'dan sonra görsel olarak).
- Kilit açma: bir bölgenin Sınav'ı ya da Usta Girişi bir sonraki bölgeyi açar; bölge içinde seviyeler serbest sırada (ilk ikisi hariç).

---

## 9. Araç / yetenek ağacı

Araçlar yeni bir **fiil** ekler ve yeni seviye türlerini açar; eski bulmacaları önemsizleştirmez. Ana yolun her aracı hikâyede bir iş emrinden gelir.

| Araç | Açılış | Etki (sim karşılığı) |
|---|---|---|
| Gerilim dedektörü | Prolog sonu | Topraklama ritüelinin ilk vuruşu; ölü test animasyonu (her topraklamada zaten zorunlu) |
| LOTO seti (kilit ×1 → ×2 → ×3 → ×4) | Bölüm 1, 2, 4, 6 | `kilit` sayısının seviye üst sınırı |
| Taşınabilir topraklama takımı | Bölüm 2 | `set:true` seviyeleri |
| Pens ampermetre | Bölüm 3 | Tek hat panelinde kenar akımları görünür (`E.cur`); kademe tahmini kolaylaşır; Kaçak Avı yan işleri |
| Deşarj çubuğu | Bölüm 3 | 2 vuruşluk ritüel `c := 0` (Hamle 1, Manevra 1); kondansatör seviyelerinde yeni Pareto noktası |
| Senkronoskop | Bölüm 4 | EXT-SYNC seviyeleri |
| Termal kamera | Bölüm 5 | Sıcak ek yan işleri (yalnız görsel ipucu) |
| İzolasyon ölçer (megger) | Bölüm 7 | Arıza yerini Olay harcamadan ölçme eylemi (EXT, `olc:ID`, Hamle 1) |
| Kademe anahtarı | Bölüm 5 | EXT-SAAT kademe değiştirme |
Usta rozeti: yeni araç eski bir dioramada yeni bir Pareto noktası açarsa bina üstünde küçük "Usta" işareti çıkar (ne olduğu söylenmez).

---

## 10. Kayıt biçimi

`localStorage` anahtarı `paralaks2.kayit` (her okuma/yazma try/catch; `?nostorage` ile devre dışı; erişilemezse oyun bellekte çalışır ve "Kayıt kapalı" der). JSON, sürümlü:
```json
{ "v": 1,
  "ayar": { "ses": 0.5, "muzik": 0.3, "hareketAzalt": false, "isikAzalt": false, "kalite": "oto",
            "etiketler": true, "tekDokunusYuru": true, "dil": "tr" },
  "seviye": { "T1": { "cozuldu": true, "ipuclu": false,
                       "en": { "h": [30, "d+ d+ y3 …"], "m": [13, "…"], "k": [72, "…"], "o": [0, "…"] },
                       "gecmis": [[30,16,72,0],[33,15,70,0]],      // en çok 32 kayıt, FIFO
                       "muhur": ["temiz","muhendis"], "son": "…yarım kalmış dizgi…" } },
  "gunluk": { "2027-03-14": { "cozuldu": true, "en": [21,8,30,0] } },
  "arac": ["dedektor","loto2","set"], "bolge": { "mahalle": 7 }, "sir": { "gizliKuplor": ["M1:3"], "kaset": [1,5] },
  "kozmetik": { "kask": "sari", "serit": "ikili" }, "istat": { "gunSayisi": 12 } }
```
Göç: `v` artarsa `migrate[v]` işlevleri sırayla uygulanır; tanınmayan anahtarlar korunur. Yarım kalmış seviye (`son`) dizgi olarak saklanır ve açılışta `replay` ile geri kurulur (geçersizse atılır).

---

## 11. Arayüz ve Türkçe metinler

### 11.1 Ekranlar
Açılış (Volti öz-testi = yükleme ekranı, materyal derleme burada) → Dünya haritası → İş Emri kartı (tek hat önizleme, hedef, kilit/yedek sayısı, metrik hedefleri) → Diorama → Kazanma paneli (metrikler, histogram, Pareto, defter, hayalet) → Dünya haritası. Duraklat menüsü: Kural Kitabı (sözlük + diyagramlar), Saha El Kitabı, Ayarlar, Seviye Seç.

### 11.2 HUD
- Üst sol: seviye adı + iş emri no. Üst sağ: çözülebilirlik lambası — **"Çözüm mümkün"** (yeşil + onay simgesi) / **"Çıkmaz"** (kırmızı + çarpı simgesi, "Geri Al?" düğmesi) / **"Hesaplanıyor…"** (gri dönen simge).
- Sayaçlar (sunum durumuyla animasyon adımı başına ilerler): **Hamle**, **Manevra**, **Kesinti**, **Olay**; yanlarında doğrulanmış optimum ilk çözümden sonra.
- Volti'nin kemeri + HUD: kalan kilit simgeleri, yedek sigorta sayısı, takılı taşınabilir topraklama.
- Alt: **Tek Hat paneli** (dikey ekranda çekilebilir alt sayfa: kapalı 64 px, açık %40; yatayda sağ sütun). Düğümler desen + ikon + etiket: **CANLI** (akan kesikli çizgi), **ÖLÜ — TOPRAKSIZ (gerilimli say)** (soluk + çapraz tarama), **TOPRAKLI** (toprak sembolü), **KİLİTLİ** (kilit), **GÖZLENEMİYOR** (gri tarama; seçili olmayan izdüşüm çiftleri). Semboller IEC 60617 (§24.2).
- Düğmeler (≥ 44 px, alt %40): Geri Al, Yinele, Döndür ⟲ ⟳, İpucu, Defter, Menü.

### 11.3 Metin tablosu (`STR`, tamamı)
| Anahtar | Metin |
|---|---|
| oyunAdi | PARALAKS: Tek Hat |
| altBaslik | Görünür Ayırma |
| basla / devam | Başla / Devam et |
| isEmri | İş Emri |
| hedef | Hedef: {yukler} beslensin{cosphi? ", cos φ ≥ 0,95"}{is? ", bakım yapılsın"} |
| kazandi | Besleme sağlandı — İş emri kapatıldı |
| cozumMumkun / cikmaz / hesaplaniyor | Çözüm mümkün / Çıkmaz / Hesaplanıyor… |
| geriAl / yinele / sifirla | Geri Al / Yinele / Baştan |
| ipucu1 / ipucu2 | Kural dürtmesi / Hayalet adım |
| hamle / manevra / kesinti / olay | Hamle / Manevra / Kesinti (yük-komut) / Olay |
| optimum | Mühendis optimumu |
| kisiselEn | Kişisel en iyi |
| simulasyon | Simülasyon (gerçek oyuncu verisi değil) |
| defter | Manevra Defteri |
| hayalet | Hayalet Volti |
| meydanOkuma | Meydan okuma bağlantısını kopyala |
| dogrulanamadi | Bu defter doğrulanamadı. |
| neden | Neden? |
| eylem.ac / kapat / kilitle / kilidiAc / topraklaTak / topraklaSok / sigortaDegistir / bas / calis / bekle | Aç / Kapat / Kilitle ve etiketle / Kilidi kaldır / Topraklamayı tak / Topraklamayı sök / Sigortayı değiştir / Bas / İşi yap / Bekle (deşarj) |
| canli / olu / toprakli / kilitli / gozlenemiyor | CANLI / ÖLÜ / TOPRAKLI / KİLİTLİ / GÖZLENEMİYOR |
| erisilemez | Bu görünümden erişilemez |
| guvenlikNotu | Volti'nin vizörü göremediğini bağlamaz. Gerçek elektrik kameraya bakmaz: sahada yalnız görünür, kilitli ve topraklı ayırma güvenlidir. |
| modelNotlari | Model Notları |
| kayitKapali | Kayıt kapalı: ilerleme bu oturumla sınırlı. |
| gunluk | Günün Manevrası |
| gunSayisi | {n} gün oynandı |
| usta | Usta Girişi |
| sinav | Sınav |
| muhur.* | Mühendis Mührü / Sıfır Kesinti / Temiz İşçilik / Tek Bakış / Kitap Gibi / Pareto Noktası / Gizli Bağ |
| ERR.* | §2.15 tablosu |
| kural.* | Kural kartları (her kural için başlık + 1 cümle + mini şema), §2'deki metinlerden |
Bütün metinler yayından önce bir elektrik mühendisinin incelemesinden geçer (kesici, ayırıcı, sigorta, bara, kuplaj, topraklama, kompanzasyon, kaçak akım, NAÇ terimleri).

---

## 12. Kamera, girdi ve AKICILIK STANDARDI

v1 dokunma şeması (dokun-yürü, kaydır-döndür) korunur; girdi katmanı v1 audit bulgularına göre **yeniden yazılır** (v1 `enqueue/pump` yeniden kullanılmaz).

### 12.1 Jest durum makinesi (`input/gesture.js`)
```
BOŞ --pointerdown--> BASILI(t0, x0, y0, az0 = kamera.azAnlık, hız 0)
BASILI --hareket > 10 CSS px (yatay baskın)--> SÜRÜKLE   // meşgul olsa da: sürükleme ASLA dokunmaya dönmez
BASILI --hareket > 10 px (dikey baskın)--> İPTAL (alt sayfa / kaydırma kullanır)
BASILI --pointerup, < 10 px, < 350 ms--> DOKUN(x, y)
BASILI --450 ms sabit--> UZUN_BAS (cihaz kartı)
SÜRÜKLE --pointerup--> BIRAK(dx, vx)
iki parmak dokunma (< 250 ms) --> GERİ_AL
```
- Sürükleme kameranın **her an** yeniden yakalanmasına izin verir: tween sırasında pointerdown anlık açıyı ve hızı alır, dx yakalama noktasından ölçülür (sıçrama yok).
- Volti yürürken sürükleme kamerayı döndürür; mantıksal görünüm değişimi sıradaki karo sınırında uygulanır ve kalan yol yeni görünümde yeniden planlanır (kural sürümü 3: döndürme elektriği değiştirmez, yasallığı yalnız G3 kapısına bağlıdır; §24.3).
- Açı ölçeği: 90° = `clamp(180, 0.45·min(genişlik, yükseklik), 260)` CSS px (masaüstü genişliğinden bağımsız). Fırlatma: hız ≥ 0,9 px/ms normalize (×375/min(g,y)) ve dx ≥ 30 px ise bir adım.
- Bırakınca hedef `q = round(lastikliAçı / 90°)`, **o anki karoda G3 kapısını geçen** görünümlere kırpılır. Sürükleme sırasında aday görünümün seçici kümesi, düşecek yükler ve Kesinti/Manevra değişimi "İzdüşümü uygula" önizlemesi olarak gösterilir (`PX.game.preview({t:'izdusum'})`); düğme yalnız aday küme farklıysa görünür.
- Yasak yönde lastik bant: en çok 19°, direnç `θ' = 19°·tanh(θ/19°)`; lastik bant gösteren bir bırakma **sessizce** geri yaylanır (ikinci zıplama, toast, kilit yok). Neden çizgisi (örten küpler ya da `paralel`/`yuk` dikişi) lastik bant sırasında gösterilir.

### 12.2 Komutlar ve tampon
- Ayrık komutlar (ok tuşu, döndür düğmesi, Q/E, eylem çipi) **sınırlı FIFO (en çok 3)**; her biri **öngörülen** duruma karşı `apply` ile çözülür; geçersiz olan tampona girmez, ret geri bildirimi anında oynar. Dördüncü girdi en eskiyi değil **yenisini** reddeder ve çip titrer.
- Dokun-yürü: yeni dokunuş yalnız **başlamamış** dokunuşun yerini alır; yürüyen bir yol bir sonraki karo sınırında yeniden planlanır (hedef değiştirme). Değiştirilen hedef halkası 120 ms söner.
- Yürüyüş elektrik durumunu değiştirmediği için dokun-yürü her zaman güvenlidir; geri dönüşsüz eylem (yedekten sigorta değişimi) yalnız açık bir çiple yapılır ve çip "yedek: 1 → 0" önizlemesi gösterir.
- Klavye: ok tuşları hedef karonun **ekrandaki** yer değiştirmesine göre eşlenir (G4 yön başına ≤ 1 komşu garantisi); hangi tuşun hangi karoya gideceği imleç önizlemesiyle gösterilir. Q/E döndür, Z geri al, Y yinele, H ipucu, Boşluk eylem çipi, 1–9 çip seçimi. Fare tekerleği/izleme dörtgeni yatayı döndürür.

### 12.3 Akıcılık standardı (sayısal; `tools/test` "flow" paketi eşik olarak uygular)
Ölçüm: CDP harness, telefon 375×667 DPR2 dokunma, CPU 1× ve 4× kısma.

| Ölçü | Hedef (1×) | Sınır (4×) |
|---|---|---|
| Girdi → ilk görünür hareket (dokun-yürü, döndür düğmesi, geri al) | ≤ 34 ms (≤ 2 kare) | ≤ 70 ms |
| Herhangi bir girdinin kilitlenme süresi (kabul edilmeyen girdi penceresi) | 0 ms (tamponlanır) | 0 ms |
| Ret geri bildirimi (lastik bant / çip titremesi) girişi engelleme | 0 ms (ayrı FX kanalı) | 0 ms |
| Yürüyüş hızı | 4,5 karo/s başlangıç, uzun yolda 150 ms'de 7 karo/s'ye rampa; yol sonunda 120 ms yavaşlama | — |
| Dönüş (yaw) | Karoyu terk etmeden önce kritik sönümlü yay, ~70 ms | — |
| Yürüme içi duraklama | Ara karolarda 0 (tek yol izleyici; ezilme/çömelme yalnız ilk ve son karoda) | — |
| İzdüşüm geçişi (derinlik dikişi) | Ekran yolu C0 sürekli; 3B ötelemesi tek karede, bakış ışını boyunca | — |
| Döndürme tamamlanma (90°, düğme) | 260–300 ms, kritik sönümlü yay | ≤ 340 ms |
| Sürükleme sonrası yaylanma | Bırakma hızıyla tohumlanmış yay; kalan < 15° → 120–200 ms | — |
| Kamera takibi | Yalnız zemin düzlemi, ölü bölge %25, son girdiden 300 ms sonra; telefonda sabit çerçeve varsayılan | — |
| Seviye doğuşu (spawn) | ≤ 450 ms, herhangi bir dokunuş atlar | — |
| Kazanma kutlaması | 900 ms, dokunuş atlar; panel kutlama sırasında 200 ms'de kayarak gelir | — |
| Kaplama/menü geçişleri | 150–220 ms opaklık+öteleme, kesilebilir, `prefers-reduced-motion` ile 0 | — |
| "Tekrar" / "Baştan" | Doğuş yok, ≤ 100 ms | — |
| Sonraki seviye hazır | Panel açıkken önceden derlenir; "Sonraki" → oynanabilir ≤ 300 ms | ≤ 500 ms |
| Kare CPU (ana iş parçacığı, sabit durum) | ≤ 6 ms | ≤ 16 ms |
| Uzun görev (> 50 ms) açılıştan sonra | 0 | 0 |
| Sabit durum bellek ayırma | ≤ 1 KB/kare (`performance.memory` eğimi) | — |
| Ana iş parçacığında çözücü | 0 (yalnız O(1) tablo okumaları) | — |
| Mesafe tablosu hazır (Worker) | ≤ 1,5 s (85 k durum) | ≤ 5 s |

### 12.4 Zaman ve tween kuralları
- `dt` 100 ms'ye kırpılır; etkileşimsiz FX duvar saatine göre tamamlanır (takılmadan sonra ağır çekim yok).
- Tween zincirlerinde artan dt sonraki tween'e devredilir. Global zaman ölçeği (v1'in 3× hızlandırması) yoktur; yalnız Volti'nin yer hızı rampalanır.
- Her FX bir etiket taşır (`TW.add(tag, …)`); geri al / baştan `TW.cancel(tag)` çağırır ve ardından görsel durum mantıksal durumdan **saf fonksiyonla** yeniden kurulur (v1'in görünmez sigorta karosu hatası yapısal olarak imkânsız).

### 12.5 HUD sunum durumu
Mantıksal durum komutla anında ilerler (`G.s`), ama HUD sayaçları, lamba ve tek hat paneli **sunum olaylarından** (`anim:step`) beslenir: her animasyon adımı bir sayaç tıklaması ve sesi üretir.

### 12.6 İzdüşüm geçişi (derinlik bağı animasyonu)
Δy = k ≠ 0 olan temas: Volti karo 1'de dikiş ortasına yürür; o karede `(x,y,z) += k·(sx,1,sz)` ötelenir (ortografik izdüşümde ΔA = ΔB = 0, ekranda görünmez; yalnız derinlik değişir); karo 2'de devam eder. İkinci render geçişi ve `clearDepth` yoktur. Test: her dikiş geçişinde Volti'nin ekran konumu süreklidir (`flow` paketi, ≤ 0,5 px sıçrama).

### 12.7 Seçim (picking)
Dokunma noktası → dünya ışını → görünüm kafes koordinatı `(U,V,t)` → `views[v].owner(U,V,t)` (sim ile aynı tablo). Sahip bir karonun üstüyse yürüyüş hedefi; bir ekipman küpüyse cihaz çipleri; boşsa 24 px dalga halkası (sessiz yok sayma yok).

### 12.8 Worker ve lamba
- Seviye yüklenince satır içi Blob Worker (`file://`'da çalışır) seviyeyi keşfeder: açık adresli tipli dizi hash (Map değil), CSR kenarları, ters 0-1 BFS mesafe tablosu (`Uint8Array`, 255 = sonsuz). Ana iş parçacığı yalnız `dist[key]` okur.
- Tablo hazır olana kadar: lamba "Hesaplanıyor…"; ipucu yalnız-elektrik soyutlamasıyla (konum/görünüm yok sayılır, < 50 ms) "sıradaki cihaz" önerir; asla yanlış "Çıkmaz" demez.
- Her istek eylem-geçmişi hash'i taşır; eski sonuçlar atılır. İptal: yeni seviye yüklenince `terminate()`.
- Build en büyük seviyeler için (> 200 k durum) önceden hesaplanmış, sıkıştırılmış mesafe tablosunu (durum başına 1 bayt, deflate değil RLE) gömebilir.

---

## 13. Mantık tutarlılığı: v1 audit → v2 düzeltmesi

| # | v1 bulgusu (önem) | v2 düzeltmesi | Nasıl kanıtlanır |
|---|---|---|---|
| 1 | Sıfır alanlı karolar görünür sayılıyor; L10 hedefi gizli (kritik) | G2 tam üçgen sahipliği; kısmen örtülü karo yok | `metrics2.parity` ışın izleme 9×9/üst yüz, her seviye/görünüm; build kapısı |
| 2 | Dokun-yürü sigortaları yakıyor (kritik) | Yürüyüş elektrik durumunu asla değiştirmez; tüketilebilir karo yok | sim2 `git` yalnız p değiştirir (kod incelemesi + birim testi) |
| 3 | Sigorta = kırılgan karo (kritik, elektrik) | Gerçek aşırı akım sigortası, yedek, iki taraf ölüyken değişim; kesici ayrı | §2.6 R6d, M2 seviyesi |
| 4 | Pil topla → Pano (kritik, elektrik) | Hedef: yükleri geçerli devreyle beslemek + iş emri | §2.11 |
| 5 | "Kısa Devre" markası, ark efekti (kritik) | Bağlantı adı "izdüşüm bağı"/"izdüşüm seçicisi"; "kuplaj" yalnız Q0K için; ark yalnız ret kartında | §1.4, §3 |
| 6 | "Pano yandı!", "Devre açık" (majör) | "Besleme sağlandı — İş emri kapatıldı", "Çözüm mümkün", "Çıkmaz" | §11.3 |
| 7 | Döndürme kapısı tutarsız (majör) | G2 + G3 (gövde 6/6 üçgen); kural sürümü 3'te döndürme elektriği değiştirmez, bağlantı yalnız "İzdüşümü uygula" ile | `standOk`; G3 eşiği optimumları değiştirmiyor |
| 8 | Sıçramalar ışınlanma, katılardan geçiyor (majör) | İzdüşüm geçişi: bakış ışını boyunca görünmez öteleme | §12.6, flow testi |
| 9 | Merdiven kuralı ihlal (majör) | Tek temas kuralı; düz dünya merdiveni asla değmez | G4; `metrics2.keyboard` |
| 10 | Girdi düşüyor (majör) | FIFO 3, öngörülen duruma karşı çözüm | §12.2, flow testi "4 hızlı ok = 4 adım" |
| 11 | Sandık: itme tırmanmanın yerine geçiyor (majör) | Sandık yok; her cihaz açık eylem çipi | §3 |
| 12 | Klavye iki koordinat sistemi (majör) | Ekran yer değiştirmesine göre eşleme + imleç önizlemesi | `metrics2.keyboard` (yön başına ≤ 1) |
| 13 | Çocuk oyunu derinliği (majör) | Sınıf bantları; kanıt seviyeleri 85 754 duruma, par 34'e, basma %0'a ulaşıyor | §6, §21 |
| 14 | Elektrik modeli ve güvenlik kültürü yok (majör) | Beş altın kural, LOTO, yaklaşma, görünür ayırma = kazanma stratejisi | §2.6–2.9 |
| 15 | Kısmen örtülü karolar, seçim arkadakini seçiyor (minör) | Seçim sahiplik tablosundan | §12.7 |
| 16 | Boşta demo bayrak hatası, yasak döndürme gösterimi (minör) | Demo = mesafe tablosundan sıradaki yasal segmentin hayaleti, yükleme başına bir kez | §5.6 |
| 17 | Sürükleme > 180° → 348° dönüş (minör) | Hedef `az0 + q·90°`, yasal aralığa kırpılmış | §12.1 |
| 18 | Kurallar L17'ye kadar öğretilmiyor (minör) | İlk karşılaşmada kural kartı + Kural Kitabı | §6.3, §11 |
| 19 | İpucu halkası, çıkmazda ipucu sayılıyor, yanlış Pano uyarısı (minör) | İşaretçi cihazın üstünde; çıkmaz ipucu ücretsiz; uyarı yalnız dokunulan hedef için | §5.6 |
| F1 | Geri al sırasında FX görünmez karo bırakıyor (kritik, akış) | Etiketli FX iptali + saf yeniden kurulum | §12.4; flow testi "FX ortasında geri al → çizilen = mantık" |
| F2 | Meşgulken kaydırma dokunuşa dönüşüyor (kritik) | Eşik meşguliyetten bağımsız | §12.1 |
| F3 | Çok adımlı sürükleme geçerli ilk adımı atıyor (kritik) | Yasal aralığa kırp, en uzak yasal adımı işle | §12.1 |
| F4 | Animasyonda kamera tutulamıyor; zincir kaydırmalar düşüyor | Her an yeniden yakalama, döndürme kuyruğu | §12.1 |
| F5 | Yaylanma hissi (ölü durup yavaş varış) | Hız tohumlu yay | §12.3 |
| F6 | Yol hissi (dur-kalk, yan kayma) | Tek yol izleyici, önce dön sonra yürü | §12.3 |
| F7 | Hedef değiştirme yok, global 3× hız | Karo sınırında yeniden planlama; yalnız yer hızı rampası | §12.2 |
| F8 | Takip kamerası titremesi | Zemin düzlemi + ölü bölge; telefonda sabit | §12.3 |
| F9 | Doğuş/kutlama/geçiş temposu | ≤ 450 ms atlanabilir doğuş, atlanabilir kutlama, ön derleme | §12.3 |
| F10 | İlk kullanım shader derleme takılmaları | Açılışta her materyal ve FX nesnesi görünür hâlde `renderer.compile` | §17 |
| F11 | Kare başına GC | Önceden ayrılmış geçici nesneler, ikinci render geçişi yok, kirli örnek aralıkları | §17 |
| F12 | Ana iş parçacığında çözücü | Worker + mesafe tablosu | §12.8 |
| F13 | Masaüstü sürükleme ölçeği | Genişlikten bağımsız ölçek, tekerlek | §12.1 |
| F14 | HUD animasyondan önde | Sunum durumu | §12.5 |
| F15 | Olumsuz geri bildirim kuyruğu kilitliyor | Ayrı FX kanalı, kilit yok | §12.3 |
| F16 | Menü geçişleri, `setSize` her ekran değişiminde | Geçişler + yalnız boyut değişince `setSize`, debounce | §17 |
| F17 | Ses: limiter yok, ilk sfx düşüyor, pop | Kompresör, ses sınırı, `resume()` sonrası kuyruk, 30 ms sönüm | §16 |
| F18 | Uyarlanır kalite tek yönlü, oyun ortasında | Histerezisli, iki yönlü, yalnız seviyeler arası | §14.3 |
| F19 | Boş dokunuşlara geri bildirim yok | Dalga halkası; kutlamada dokunuş atlar | §12.7 |
| F20 | Test harness 15–30 Hz kaydırma | Zaman damgalı dokunma, CPU kısma, kare izi, "flow" paketi | §20 |

---

## 14. Görsel sanat yönü

### 14.1 Genel dil
Yüzen izometrik dioramalar: gerçek enerji altyapısı, prosedürel Three.js r128 geometrisi (kutu, silindir, torna `LatheGeometry`, ekstrüzyon), kanvasla üretilen dokular (etiket, levha, uyarı şeridi), harici varlık dosyası yok. Gece başlar; çözüm ilerledikçe ışık sıcaklığı ve pencere ışıkları geri gelir.

Durum asla yalnız renkle gösterilmez: CANLI = akan kesikli ışık + 50 Hz uğultu; ÖLÜ = düz soluk; TOPRAKLI = sarı-yeşil kelepçe + toprak sembolü; KİLİTLİ = kilit + etiket metni; bölge = taralı hacim. Faz renkleri IEC 60445 (L1 kahverengi, L2 siyah, L3 gri, N mavi, PE sarı-yeşil) + 1/2/3 şerit işareti. Renk körü güvenli palet; FlashGuard: geniş alanda saniyede 3'ten fazla parlama yok; "Işık efektlerini azalt" seçeneği.

### 14.2 Biyomlar (prosedürel kit notları)
| Biyom | Palet | Kit (her biri tek `BufferGeometry` birleşimi, paylaşımlı materyal) |
|---|---|---|
| Depo | Soğuk mavi acil ışık → sıcak | Raf (kutu dizisi), UPS kabini (kutu + LED satırı `InstancedMesh`), akü rafı |
| Volt Mahallesi | Gece laciverdi → amber sokak ışığı | Beton direk (silindir + konik başlık), AG havai hat (katener eğrisi `TubeGeometry`), kofre, sayaç panosu (kapaklı kutu), ev blokları (pencere `InstancedMesh`, emissive dokuyla yanar) |
| Trafo Merkezi | Beton gri + bakır | Beton köşk, RMU (3 hücreli kutu + mimik şema dokusu), trafo (tank + radyatör kanatları dizisi + OG/AG buşing torna profilleri + konservatör silindir), AG pano (çekmeli ACB rayları) |
| Fabrika | Endüstriyel sarı + çelik | MCC hücreleri, DIN rayı + kontaktörler, kompanzasyon panosu (silindir kondansatör kutuları + reaktif röle ekranı dokusu), motorlar (silindir + kanatlı fan dönüyor) |
| Baraj | Beton + su mavisi | Baraj gövdesi (ekstrüzyon), cebri boru, türbin salonu, dizel jeneratör (gövde + egzoz), uyartım kabini, senkronoskop (ibre döner) |
| Dağıtım Merkezi 34,5 kV | Çakıl gri + gökyüzü | Portal kafes (kutu çubuk birleşimi), izolatör zinciri (torna diskler `InstancedMesh`), pantograf ve orta açmalı ayırıcı (animasyonlu kollar), SF6 kesici kutupları, CT/VT kolonları, çift bara boruları |
| Yenilenebilir | Gündüz sarısı | PV masaları (eğik düzlem dizisi), inverter kızakları, batarya konteyneri, rüzgar türbini (kanatlar döner), arka planda emekli kömür bacası |
| Metro | Tünel turuncusu | Tünel kesiti, üçüncü ray (taralı bölge), redresör merkezi, tren (kutu + pencere şeridi) |
| Kent Şebekesi | Islak asfalt yansıması | RMU köşk zinciri, kablo kanalı kapakları, hastane (ATS dolabı) |

### 14.3 Kalite katmanları (kare başına bütçe)
| Katman | Draw call | Üçgen | Işık | Gölge | Son işleme | Piksel oranı |
|---|---|---|---|---|---|---|
| Düşük (telefon varsayılanı, eski cihaz) | ≤ 60 | ≤ 60 k | 1 yönlü + yarıküre | Yok (sahte blob gölge dokusu) | Yok | ≤ 1,0 |
| Orta (telefon iyi, masaüstü entegre) | ≤ 90 | ≤ 150 k | 1 yönlü + yarıküre | 1 yönlü, 1024², PCF | Yok (parıltı = toplamalı sprite) | ≤ 1,5 |
| Yüksek (masaüstü) | ≤ 140 | ≤ 300 k | 1 yönlü + yarıküre + ≤ 2 nokta (yalnız kutlama) | 2048², PCF yumuşak | İsteğe bağlı bloom: `cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js` ve bağımlılıkları | ≤ 2,0 |
Otomatik katman: açılışta 60 karelik ölçüm; ortalama CPU+GPU kare > 20 ms ise bir katman düşür, < 9 ms ve 3 seviye boyunca kararlıysa bir katman yükselt; değişim yalnız seviyeler arasında.

---

## 15. Volti rig v2 ve animasyonlar

- v1 prosedürel rig (23 mesh) korunur; eklenenler: kask + vizör (vizör hasar çatlağı dokusu, perde ilerledikçe onarılır), izolasyon eldivenleri, alet kemeri (kalan asma kilitler tek tek görünür), sırtta gerilim dedektörü, ikinci rig örneği = hayalet (yarı saydam, aynı geometri, ayrı materyal).
- Hareket: tek yol izleyici (§12.3). Kare döngüsünde dizi/kapanış ayırma yok (`relaxLimbs`, göz güncelleme önceden ayrılmış).

| Klip | Süre | Vuruşlar | Not |
|---|---|---|---|
| Yürü / koş | sürekli | Yürüme döngüsü hıza bağlı faz | Ara karolarda duraklama yok |
| Dikiş geçişi | 0 (yürüme içinde) | Dikişte tek kare öteleme | §12.6 |
| Kesici kapat/aç | 380 ms | Uzan → kola bas → bayrak döner | Ses kola basışta |
| Ayırıcı kolu | 520 ms | İki elle kol, bıçak açısı tween | |
| Kilitle ve etiketle | 600 ms | Kemerden kilit al → as → etiket sallanır | Kemerdeki kilit sayısı azalır |
| Gerilim yokluğu + topraklama | 900 ms | Dedektör uç teması (bip ×2) → kelepçe → onay | Tek akıcı ritüel |
| Taşınabilir topraklama | 900 ms | Aynı + kablo açılır | |
| Sigorta değiştir | 700 ms | Buşon çekme kolu → yeni buşon | Yedek sayısı azalır |
| Butona bas | 250 ms | İşaret parmağı | |
| Bekle (deşarj) | 400 ms | Saat bileğine bakar, şarj halkası bir dilim azalır | |
| Ölçüm oku (pens ampermetre) | 500 ms | Pensi kabloya kapa, ekran sayısı | Araç açıldıysa |
| Reddedildi | 300 ms | Elini geri çeker, başını sallar; ret yaklaşma bölgesiyse güvenli geri adım ("çarpılma" yok, yalnız kart illüstrasyonu) | Girdi kilitlemez |
| Taşı (kablo makarası / buşon) | yürüme katmanı | Kollar taşıma pozunda | |
| Kutlama | 900 ms | Vizör parlar, kask selamı, yükler halka halka yanar | Dokunuş atlar |
| Boşta | 6–12 s rastgele | Vizör tarar, kemerdeki kilitleri sayar | Bellek ayırmasız |

---

## 16. Ses (WebAudio sentez, dosya yok)

- Zincir: kaynaklar → kanal kazançları (sfx, ortam, uğultu) → `DynamicsCompressor` (eşik −18 dB, oran 4) → ana kazanç. Ses sınırı: aynı anda 12 kaynak, aynı türden 3; fazlası en eskiyi 20 ms'de söndürür.
- `resume()` çözülene kadar sfx kuyruklanır (ilk ses düşmez). Bulanıklaşma/görünmezlikte ana kazanç 30 ms'de 0'a, sonra `suspend()`.
- Sesler: kesici kapama (gürültü patlaması + 180 Hz düşen sinüs, 120 ms), açma (daha keskin, 80 ms), ayırıcı bıçak (metalik rezonans 2 kHz bant), kontaktör "klonk" (düşük kare + gürültü), kilit klik, dedektör bip (1,8 kHz ×2), sigorta "pof" (filtrelenmiş gürültü, patlama değil), izdüşüm seçicisi teması (kısa tık; yalnız "İzdüşümü uygula" bağlı kümeyi **değiştirince**, faz başına), ret (yumuşak iki ton aşağı), 50 Hz şebeke uğultusu (100/200/300 Hz bileşenleri; seviye canlı yük toplamıyla orantılı; şehir aydınlandıkça güçlenir), trafo 100 Hz manyetostriksiyon (yükle), kutlama arpejı (ana kazanç ≤ 0,5).
- Döndürme sfx süresi kamera hareket süresine eşlenir; gürültü tamponu rastgele ofsetle başlar.

---

## 17. Performans bütçesi

| Kalem | Bütçe |
|---|---|
| İlk açılış → oynanabilir (orta telefon, sıcak önbellek) | ≤ 2,5 s (öz-test ekranı sırasında `renderer.compile`) |
| JS boyutu (index.html, three.js hariç) | ≤ 450 KB sıkıştırılmamış |
| Seviye verisi | toplam ≤ 200 KB, kompakt kodlama (§24.5); tam `kanit` yalnız test kenar dosyasında |
| Worker bellek | ≤ 24 MB (400 k durum × ~4 kenar, Int32 + Uint8 tablo) |
| Kare (sabit durum, Orta katman) | CPU ≤ 6 ms, ayırma ≤ 1 KB |
| Örnek güncelleme | Yalnız kirli aralıklar (`updateRange`) |
| Render | Tek geçiş; Volti-üstte ikinci geçiş yok; isteğe bağlı bloom yalnız Yüksek |
| Boyut | `setSize` yalnız boyut değişince; ResizeObserver 100 ms debounce; `getBoundingClientRect` yalnız yeniden boyutta önbelleklenir |

---

## 18. Modül mimarisi (paralel yapım için)

### 18.1 Dosyalar (`tools/src2/`) ve sahipler
Tek global ad alanı `PX` (her modül `PX.<ad> = …` atar; başka global yok). Modüller `tools/src2/manifest.json`'daki sırayla tek `<script>` içinde birleştirilir.

| Dosya | Sorumluluk | Bağımlı | Ekip |
|---|---|---|---|
| `shell/head.html` | CSS, HTML iskeleti, HUD DOM, alt sayfa, kaplamalar | — | UI |
| `core/sim2.js` | **Üretilmez**: build `tools/reference2/sim2.js`'i satır içi alır, `module.exports` satırını `PX.SIM = {…}` ile değiştirir | — | Kurallar |
| `core/levels.js` | Build `levels2.js` + günlük havuzu gömer → `PX.LEVELS`, `PX.DAILY` | — | Kurallar |
| `core/worker_src.js` | Worker gövdesi (sim2 + keşif + mesafe tablosu); build bunu bir dizgi olarak Blob'a koyar | sim2 | Kurallar |
| `core/solverClient.js` | Worker yaşam döngüsü, istek/yanıt, stale guard | worker_src | Kurallar |
| `app/bus.js` | Olay veriyolu | — | Çekirdek |
| `app/store.js` | Kayıt (§10), göç, `?nostorage` | bus | Çekirdek |
| `app/strings.js` | `PX.STR` (§11.3) | — | UI |
| `game/controller.js` | Komut hattı, FIFO, sunum durumu, geri al/yinele, kazanma | sim2, bus, solverClient | Oyun |
| `game/hint.js` | İki kademeli ipucu, hayalet segment | solverClient | Oyun |
| `input/gesture.js` | Jest makinesi (§12.1) | bus, camera | Girdi |
| `input/keyboard.js` | Ekran yönlü eşleme, imleç önizlemesi | sim2, camera | Girdi |
| `render/scene.js` | Renderer, katmanlar, ışık, kalite, `compile` | — | Render |
| `render/camera.js` | Görünüm açıları, yaylar, `worldToClient`, `pick` | sim2 | Render |
| `render/diorama.js` | Bloklar (`InstancedMesh`), karo vurguları, bölge hacimleri | scene | Render |
| `render/kit/*.js` | Biyom başına ekipman modelleri (`PX.KIT[tip](el, biyom) → Object3D`) | scene | Sanat |
| `render/flow.js` | Akan enerji çizgileri, seçili izdüşüm çiftlerinin kalıcı dikiş çubuğu, şarj halkaları | scene | Render |
| `render/volti.js` | Rig, yol izleyici, klipler, hayalet | scene | Animasyon |
| `render/fx.js` | Etiketli FX + `TW` tween yöneticisi (iptal, dt devri) | — | Animasyon |
| `ui/hud.js` | Sayaçlar, lamba, kilit/yedek ikonları, çipler | bus, STR | UI |
| `ui/sld.js` | Tek hat paneli (SVG), çapraz vurgu | sim2, bus | UI |
| `ui/screens.js` | Menüler, iş emri kartı, kazanma paneli, histogram, Pareto, defter | bus, store | UI |
| `ui/cards.js` | Neden kartları, kural kartları, Kural Kitabı | STR | UI |
| `audio/audio.js` | §16 | bus | Ses |
| `meta/world.js` | Dünya haritası (aynı geometri kuralı, elektriksiz) | sim2, render | Meta |
| `meta/daily.js`, `meta/ghost.js` | Günlük seçim, hayalet oynatma, meydan okuma bağlantısı | sim2, store | Meta |
| `debug/game_api.js` | `window.Game` test API'si (§18.4) | hepsi | Test |
| `main.js` | Önyükleme sırası, kare döngüsü | hepsi | Çekirdek |

### 18.2 Arayüzler (imzalar)
```js
// --- Kurallar (PX.SIM = sim2.js dışa aktarımları, değiştirilmeden) ---
PX.SIM.compile(def, opt?) -> L            PX.SIM.initState(L) -> s
PX.SIM.apply(L, s, a) -> {s, c:{h,m,k,o}, trips:[elIdx]} | {err, msg}
PX.SIM.candidates(L, s) -> a[]            PX.SIM.won(L, s) -> bool
PX.SIM.key(L, s) -> number                PX.SIM.stateE(L, s) -> E {live, gal, earthG, loadMask, cur, V}
PX.SIM.encodeAct(L, s, a) -> 'g12'|'p'|'o:Q01'… PX.SIM.decodeAct(L, s, tok) -> a | null (katı; asla istisna atmaz)
PX.SIM.replay(L, str) -> {ok, won, s, tot, log}   PX.SIM.describe(L, s, a, r) -> string|null
PX.SIM.activePairs(L, cs, bits) -> [[düğümA, düğümB, bitA, bitB, hi, hj, anahtar]]   // cs: 0..3 seçili küme, 4+4c+v izdüşüm geçişi faz 1 (birleşim)
L.views[v] = {vis, nb, sqU, sqV, owner(U,V,t), body}   L.standOk(v, c)   L.reach[c]   L.hazards[c]

// --- Çözücü istemcisi ---
PX.solver.load(levelId, def) -> Promise<{states, ms}>         // Worker keşif + mesafe tablosu
PX.solver.dist(s) -> number | -1 (çıkmaz) | null (hazır değil)
PX.solver.hint(s, tier) -> Promise<{tier, acts:[tok], why:string}>
PX.solver.abstractHint(s) -> {el:id, why}                       // ana iş parçacığı, < 2 ms, yalnız elektrik

// --- Kontrolcü ---
PX.game.load(levelId | {daily:date} | {def})       PX.game.command(cmd) -> bool (FIFO'ya kabul)
//   cmd = {t:'tap', U,V,tri} | {t:'walk', dir:0..3} | {t:'rot', d:±1} | {t:'act', a} | {t:'undo'} | {t:'redo'} | {t:'reset'} | {t:'hint', tier}
PX.game.state() -> {s, view, tot:{h,m,k,o}, won, presentation:{tot, s}}
PX.game.preview(a) -> {ok, err?, msg?, olu:[node], kesintiDelta, yedekDelta}   // çip önizlemesi, sim2.apply ile

// --- Render ---
PX.render.setLevel(L, s)            PX.render.sync(s, E)           // saf yeniden kurulum
PX.render.animate(step) -> Promise  // step = presentation event (aşağıda)
PX.camera.snapTo(v, {vel}) ; PX.camera.drag(dxPx) ; PX.camera.release(vx) -> q ; PX.camera.pick(clientX, clientY) -> {kind:'tile'|'el'|'none', cell, el}
PX.volti.followPath(cells[], opts) -> Promise ; PX.volti.play(clip, opts) -> Promise ; PX.volti.cancel()
PX.TW.add(tag, dur, fn, ease) ; PX.TW.cancel(tag) ; PX.TW.update(dt)
```

### 18.3 Olaylar (`PX.bus.emit(type, payload)`)
| Tür | Yük |
|---|---|
| `level:loaded` | `{id, L, s, view}` |
| `cmd:accepted` / `cmd:rejected` | `{cmd, a?}` / `{cmd, err, msg, cells?:[c], seam?:{a,b}}` |
| `anim:step` | `{kind:'walk'|'rot'|'op'|'lock'|'unlock'|'earth'|'fuse'|'press'|'work'|'wait', a, tok, before:s, after:s, c:{h,m,k,o}, trips:[id], log:string|null}` |
| `anim:done` | `{queueLen}` |
| `elec:changed` | `{E, liveNodes:[n], fedLoads:[id], couplers:[[a,b]]}` |
| `lamp` | `{state:'ok'|'dead'|'busy', dist}` |
| `win` | `{id, tot, opt, front, seals:[], ghost:str}` |
| `undo` / `redo` / `reset` | `{s}` |
| `ui:chip` | `{el, actions:[{a, label, preview}]}` |
| `solver:ready` | `{id, states, ms}` |
Olay yükleri her karede ayrılmaz; yalnız komut/olay anında oluşur.

### 18.4 Test API'si (`window.Game`, yalnız `?debug` ya da harness)
`Game.load(id)`, `Game.cmd(cmd)`, `Game.state()`, `Game.visibleTiles()`, `Game.screenOfTile(c)`, `Game.ownerAt(clientX, clientY)`, `Game.replay(str)`, `Game.drawnScale(cell)` (FX/mantık eşliği), `Game.frameStats()`.

### 18.5 Build (`tools/build.js` genişletmesi)
```
node tools/build.js            -> index.html (v1) — değişmez
node tools/build.js --v2       -> index.html'i src2 ile üretir (v2 yayına alınınca varsayılan)
```
Adımlar: (1) `node tools/reference2/verify2.js` çalıştır; başarısızsa dur. (2) `manifest.json` sırasıyla dosyaları oku; `sim2.js`'ten `module.exports` satırını `PX.SIM = {…}` ile değiştir; `worker_src.js`'i JSON dizgisi olarak `PX.WORKER_SRC`'ye göm. (3) three.js r128 `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js">`; bloom yalnız Yüksek katmanda dinamik eklenir. (4) Boyut bütçesi kontrolü (§17).

---

## 19. Seviye üretim hattı (`tools/reference2`)

1. **Şablon:** Bölümün tek hat şeması `templates2.js`'e (gerçek bir manevra senaryosu; `cells`, `essential`, `W,D,MAXH`, `minPar/maxPar`, `work`, `hard`). İsteğe bağlı geometri koşulları: `needPairs: [[düğümA, düğümB, 'bas'?]]` (bu seçici çifti bir görünümde — `'bas'` ise başlangıç görünümünde — bulunmalı), `needAdj: [[a1,b1],[a2,b2]]` (iki çift komşu görünümlerde: tek döndürmeyle önce-kapa-sonra-aç transferi mümkün), `zeroKesinti: true` (tam keşifle Kesinti-optimumu 0 olan geometri ödüllenir).
2. **Üretim:** `node gen2.js <şablon> <tohum> <saniye> out.json` — tepe tırmanışı yalnız geometriyi arar (yükseklik haritası, ekipman sütunları, başlangıç/iş karosu, görünüm). Amaç: cihaz işlemleri ödüllenir, yürüyüş payı > %45 cezalanır, her `essential` ablasyonu optimumu değiştirmezse −15. 4 tohum × 180–300 s paralel.
3. **Eleme (kapılar, hepsi zorunlu):**
   - K1 parite (ışın izleme) ve klavye (yön başına ≤ 1 komşu);
   - K2 sınıf bandı (§6.1);
   - K3 `essential` ablasyonlarının her biri esaslı;
   - K4 izdüşüm×devre: bölümdeki öğretici olmayan seviyelerin ≥ %80'i `noCouplers`/`noVisOps` esaslı;
   - K5 Olay=0 çözüm vardır;
   - K6 açgözlü-bot farkı ≥ %30 (yapılacak: `gen2` içine "bariz ayırma" botu);
   - K7 bıçak sırtı akım payı ≥ 0,05 (`verify2` kontrol 11, uygulandı);
   - K8 hikâye kısıtı: iş emri "hastane kesintisiz" diyorsa Kesinti-opt yolunda hastane hiç düşmez (yapılacak: `hedef.kesintisiz:[id]` + verify kontrolü);
   - K9 gerçekçilik lint'i (`lint2.realism`): tüketici ≤ 34,5 kV, acil/dizel ≤ 6,3 kV, her kesici/sigortada açma eşiği, her kaynak→arıza yolunda koruma, bobin kumanda seviyesinde; K10 gerilim ≥ 0,9 pu (`lint2.voltage`); K7 pay (`lint2.margin`); §6.1 bantları (`bands2.js`); K8 iddialar (`iddia`).
4. **Kürasyon:** tasarımcı içgörü cümlesini (`ogretir`) yazar, haritayı elle rötuşlar (estetik), `verify2.js --stamp` ile kanıtı damgalar.
5. **Doğrulama:** `node verify2.js` → `ALL LEVELS VERIFIED`; build bunu ön koşul yapar.
6. **Günlük havuz:** `gen2` + şablon başına tohum aralığı → 366 seviye; aynı kapılar (Günlük bandı); `daily2.json`'a damgalı.

Bölüm başına şablon eşlemesi §7 tablolarında. Yeni EXT kuralları: önce `sim2.js` (yeni ablasyon bayrağıyla), sonra `verify2.js` ABL listesine bayrak, sonra şablon.

---

## 20. Test ve kabul

### 20.1 Otomatik paketler (`tools/test/run.js`)
- **verify** — `verify2.js` (kurallar, kanıtlar, kapılar).
- **parity** — oyunda çizilen karo üçgen kimlikleri (renderer kimlik tamponu) = `views[v].vis` her seviye/görünüm.
- **flow** — §12.3 tablosunun her satırı eşik olarak; zaman damgalı dokunma; CPU 1×/4×; "4 hızlı ok tuşu = 4 adım"; "meşgulken kaydırma dokunuş değildir"; "FX ortasında geri al → `Game.drawnScale` = mantık"; "dikiş geçişinde ekran sürekliliği ≤ 0,5 px".
- **replay** — her seviyenin altın dizgisi oyunda `Game.replay` ile kazanır ve aynı toplamları verir.
- **leak** — 20 seviye yükle/boşalt sonrası yığın büyümesi ≤ 2 MB.
- **storage** — `?nostorage`, bozuk kayıt, göç.
- **touchplay** — telefon emülasyonunda P1 ve M1 yalnız dokunarak çözülür.

### 20.2 Kabul listesi
- [ ] `node tools/reference2/verify2.js` → ALL LEVELS VERIFIED (kapı 9 dahil).
- [ ] Bütün kampanya seviyeleri §6.1 bantlarında; zor seviyelerde basma 0/10 000.
- [ ] Hiçbir erişilebilir durumda Volti kısmen gizli değil (G3), hiçbir hedef/iş karosu sıfır alanlı değil (G2).
- [ ] Yürüyüş ve döndürme hiçbir elektrik durumunu değiştirmez (birim testi: her seviyede her `git`/`dondur` sonrası `b, lk, sp, st, cs` aynı).
- [ ] Kuplaj açıkken yük taşıyan izdüşüm uygulaması `paralel` ya da `yuk` ile reddedilir (S3 `iddia` ile doğrulanıyor); döndürme hiçbir koşulda elektrik durumunu değiştirmez (birim testi).
- [ ] Yüksüz trafo ayırıcıyla enerjilenemez (T1'de birim testi).
- [ ] §12.3 akıcılık eşiklerinin hepsi flow paketinde yeşil (1× ve 4×).
- [ ] Açılıştan sonra 50 ms'yi aşan uzun görev yok; sabit durum ≤ 1 KB/kare.
- [ ] Bütün Türkçe metinler elektrik mühendisi incelemesinden geçti; "Pano yandı", "Devre açık", "Kısa Devre" hiçbir yerde yok.
- [ ] Standarttan türeyen her değer fact-owner tarafından onaylandı (§4.3).
- [ ] Karanlık desen yok: zamanlayıcı, enerji sayacı, reklam, IAP, ganimet, FOMO, kaybedilebilir seri, bildirim yok.
- [ ] Çift tıklama ile `file://` üzerinden açılıyor; telefon dikey + yatay; dokun-yürü + kaydır-döndür.
- [ ] Meydan okuma bağlantısı başka bir tarayıcıda açılıp doğrulanıyor.

---

## 21. Kanıt seviyeleri (referans motor, `levels2.js`, kural sürümü 3)

> Kural sürümü 4 kanıt tablosu: §25.9. Aşağıdaki tablo tarihseldir.

`node tools/reference2/verify2.js` (Node 24, Windows 11 masaüstü; tüm çalıştırma ~25 s, ablasyonlar dahil). Optimum vektörleri `[Hamle, Manevra, Kesinti, Olay]`. **Elek** = erişilen farklı elektrik yapılandırması (konum/görünüm hariç). **Basma** = dokun-yürü rastgele oyuncunun 10 000 koşuda `6·par+20` KOMUTTA kazanma oranı (yürüyüş otomatik; denetçinin a3.js ölçüsü). **Yürü** = Hamle-opt içindeki yürüyüş komutu payı. **Saf** = yürüyüş bedavayken en az komut (saf karar sayısı). **Esas** = Hamle-opt'u ya da Kesinti-opt planını değiştiren standart ablasyon sayısı. Çöz = keşif + 4 optimum + mesafe tablosu (ms).

| id | Ad | Bölüm | Sınıf | Hamle-opt | Manevra-opt | Kesinti-opt | Durum | Elek | Basma | Yürü | Saf | Esas | Çıkmaz | Cephe Hamle×Kesinti | Zorunlu (essential) ablasyonlar | Çöz ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | İlk Manevra | 0 | Öğretici | [6,3,10,0] | [6,3,10,0] | [6,3,10,0] | 262 | 6 | %37,41 | %50 | 3 | 3 | 0 | [[6,10]] | noCommit, noAyiriciKurali | 15 |
| M1 | Beş Altın Kural | 1 | Öğretici | [16,6,14,0] | [16,6,14,0] | [16,6,14,0] | 1 365 | 16 | %14,14 | %44 | 9 | 3 | 0 | [[16,14]] | noAyiriciKurali, noZones, noLoto | 33 |
| M2 | Yedek Bıçak | 1 | Çekirdek | [12,6,35,0] | [12,6,35,0] | [12,6,35,0] | 1 011 | 16 | %5,34 | %50 | 6 | 3 | 0 | [[12,35]] | noCommit, noAyiriciKurali | 15 |
| M3 | Ring Arızası | 1 | Çekirdek | [11,6,30,0] | [11,6,30,0] | [11,6,30,0] | 1 185 | 21 | %7,98 | %46 | 6 | 4 | 0 | [[11,30]] | noCommit, noAyiriciKurali, noProtection:kesinti | 12 |
| T1 | Geri Besleme | 2 | Zor | [27,8,72,0] | [27,8,72,0] | [34,11,0,0] | 12 628 | 320 | %0,17 | %52 | 13 | 6 | 0 | [[27,72],[30,69],[32,6],[34,0]] | noCommit:kesinti, noAyiriciKurali, noZones, noLoto, noBackfeed | 54 |
| T2 | Trafo N-1 Bakımı | 2 | Zor | [29,9,101,0] | [29,9,101,0] | [36,11,19,0] | 15 088 | 345 | %0,00 | %52 | 14 | 5 | 0 | [[29,101],[30,85],[31,84],[35,41],[36,19]] | noCommit, noAyiriciKurali, noLoto, noBackfeed | 144 |
| F1 | Mühürleme | 3 | Öğretici | [8,4,13,0] | [8,4,13,0] | [8,4,13,0] | 845 | 16 | %4,61 | %50 | 4 | 3 | 0 | [[8,13]] | noCommit, noAyiriciKurali | 16 |
| F2 | Kompanzasyon Kademeleri | 3 | Çekirdek | [15,5,12,0] | [15,5,12,0] | [17,5,6,0] | 17 130 | 613 | %2,32 | %47 | 8 | 5 | 0 | [[15,12],[16,8],[17,6]] | noCommit, noAyiriciKurali, noZones, noCapLock | 108 |
| S1 | Çift Bara Transferi | 5 | Zor | [23,4,42,0] | [23,4,42,0] | [36,12,0,0] | 31 606 | 672 | %0,58 | %52 | 11 | 3 | 0 | [[23,42],[24,39],[25,36],[27,33],[29,30]] | noAyiriciKurali:kesinti, noZones, noLoto | 153 |
| S2 | Seçici Görüş | 5 | Zor | [26,7,85,0] | [26,7,85,0] | [42,14,42,0] | 9 705 | 192 | %0,00 | %54 | 12 | 5 | 0 | [[26,82],[27,62],[28,60],[29,58],[30,47],[31,45],[34,44]] | noCommit, noAyiriciKurali, noZones, noLoto | 40 |
| S3 | Bara Transferi | 5 | Zor | [23,4,54,0] | [23,4,54,0] | [32,7,0,0] | 19 423 | 222 | %0,00 | %52 | 11 | 4 | 0 | [[23,54],[24,45],[27,36],[30,15],[32,0]] | noCommit:kesinti, noAyiriciKurali:kesinti, noLoto | 174 |

Kapılar: 11/11 seviye §6.1 bandının içinde; K7 koruma payı en düşük 1,0 birim (tam eşitlik yok, tamsayı olmayan akım yok); K10 en düşük gerilim 0,977 pu; altın Hamle-, Manevra- ve Kesinti-opt defterlerinin hepsi güvenlik denetimini geçiyor (ayırmadan önce topraklama yok, topraklama takılıyken kilit kaldırma yok); 36 tasarımcı iddiası makinece doğrulandı; izdüşüm×devre kapısı 7/8 (%88; seçicisiz S1 kapıdan kalan tek seviye).

Yorumlar:
- **Zor seviyelerin hepsi gerçek iki amaçlıdır:** Hamle-opt hastaneyi düşürür, Kesinti-opt ek transfer ister (T1 ve S1, S3'te **Sıfır Kesinti**). Cepheler 4–7 noktalıdır; T1'de `[32,6]` ile `[34,0]` arasındaki 2 Hamle'lik fark "hastaneyi trafo değiştirmeden mi, önce aktararak mı" kararıdır.
- **S3 Bara Transferi** (amiral gemisi): Kesinti-opt defteri "Q0K KAPATILDI → İzdüşüm seçicileri görünüm 2'ye çevrildi (önce-kapa-sonra-aç) → Q0K AÇILDI, kilitlendi → XA (Bara A seçici kafası) görünür açıklıkta kilitlendi → Q01 AÇILDI, kilitlendi → Q81 gerilim yokluğu tespit edildi, topraklandı ve kısa devre edildi → iş → geri ver → normal konum" — Kesinti 0. Seçicisiz Kesinti-opt planı `noCommit` ile 30'a çıkar.
- **S1 Çift Bara Transferi**: kesintisiz plan klasik "Q0K kapa → Q12 kapa → Q11 aç → Q0K aç" komütasyonudur; `noAyiriciKurali` ile bu plan 29 Hamle'ye kısalır (ayırıcıyla yük kesmek), yani ayırıcı kuralı kesintisiz planın esaslı parçasıdır. Hedef normal işletme konumunu ister (fider Bara A'da, kuplaj açık).
- **Boyut değil içgörü:** zor seviyeler 192–672 elektrik yapılandırması ve 11–14 saf karar ister; durum sayıları 9 705–31 606 (v2'nin 53–86 bin durumunun yarısı `wk` defter biti ve kameranın anahtarlamasından geliyordu).
- Dokun-yürü basma ölçüsü dürüst: öğreticilerde %5–37 (amaçlı olarak bağışlayıcı), çekirdekte %2–8, zor seviyelerde ≤ %0,58.
- `noVisOps` (görünürlükle kapılanan işlem) hâlâ hiçbir kanıt seviyesinde esaslı değil; 0.2 "Görünmeyen Yoktur" bunun için tasarlanmalı (§22).
- Prototip karşılaştırması: v1 en büyük seviye 820 durum, par ≤ 20, rastgele basma %72–87 (v1 basma ölçüsü adım düzeyindeydi; v3 ölçüsü komut düzeyinde ve daha cömert).

---

## 22. Açık konular

1. **Fact-owner onayı** (insan, VoltGuard): EN 50110-1 yaklaşma/prosedür, IEC 60831 deşarj süresi, EPDK reaktif enerji sınırları (endüktif %20 / kapasitif %15; seviye parametresi), IEC 60364-5-52, IEC 60076-7, metro DC seviyeleri, NH/MCB eğri tabloları, IEC 60617 sembol çizimleri.
2. **İzdüşüm seçicisi kurgusunun oyun testi:** kural sürümü 3'te kamera artık hiçbir şeyi anahtarlamıyor (yalnız "İzdüşümü uygula" komutu). Saf mühendislerin "görüş hattı telekumandalı motorlu seçici ayırıcı" çerçevesine tepkisi ölçülmeli.
3. **Kanıtlanmamış iddia:** `noVisOps` hiçbir kanıt seviyesinde optimumu değiştirmiyor; 0.2 "Görünmeyen Yoktur" bunu esaslı yapacak biçimde üretilmeli.
4. **Uygulanmamış uzantılar:** EXT-RACK, SYNC, 79, ATS, SAAT, DC, RCD, VDROP, TERMIK, AYIRMA, 2/3, ATOLYE, deşarj çubuğu, megger. R2/R3 sürümlerine bağlı (§24.1). Yük ayırıcısı (R6e) artık uygulandı (M3).
5. **Üretim kapıları:** K6 (açgözlü bot) henüz kodda yok. K7, K8 (iddialar), K9, K10 ve §6.1 bantları `verify2.js`'te zorunlu.
6. **Telefon Worker süresi:** en büyük kanıt seviyesi artık 31 606 durum; Node'da keşif+optimum+mesafe 153 ms. Tipli dizi Worker'ı referans orta sınıf Android'de ölçülmeden içerik kilidi yok; bant tavanı 1,2·10⁵ durum.
7. **Yürüyüş payı** zor seviyelerde %52–54 (bant ≤ %55). Kampanya seviyeleri elle rötuşlanırken %45'in altına indirilmeli.
8. **Kıvılcım, seviye editörü, VoltReplay klipleri, topluluk histogramları:** ertelendi; her biri ADR ister.
9. **Seçicisiz zor seviye (S1):** izdüşüm×devre kapısından kalıyor (kapı %88 ile geçiyor). Kampanyada S1, Bölüm 5'in "kamerasız temel" seviyesi olarak kalacak ya da bir seçici kafası eklenerek yeniden üretilecek.
10. **Çekirdek seviyelerde çok amaçlılık:** M2 ve M3'te üç optimum aynı vektör; çekirdek bandı bunu istemiyor ama kampanya sürümünde her çekirdek seviyeye en az bir "optimizasyon talebi" (§24.6) eklenmeli.

---

## 23. Karar Kaydı / Decision log (kural sürümü 3 revizyonu)

Üç bağımsız denetim (kural kırma, elektrik doğruluğu, oyuncu deneyimi/telefon/kapsam) raporlarına verilen yanıtlar. **D** = düzeltildi (kod ve/veya şartname), **K** = kısmen kabul, **R** = reddedildi (gerekçeli), **E** = ertelendi (kapsam kararıyla).

### 23.1 Kural kırma denetimi
| # | Bulgu | Karar | Ne yapıldı / gerekçe |
|---|---|---|---|
| 1 | Kamera gezinmesi kesintiye yol açıyor (kritik) | **D** | Döndürme yalnız gezinme (0 Hamle, 0 Manevra, elektrik etkisi yok). Seçiciler yalnız açık `p` "İzdüşümü uygula" komutuyla, iki fazlı önce-kapa-sonra-aç geçişle çevrilir (§2.3). Durum anahtarına `cs` eklendi. T1, T2, S2 yeniden üretildi. |
| 2 | Optimum planlar ayırmadan önce topraklıyor (kritik) | **D** | R6c: topraklama yalnız en kötü durum ayırma testi geçince (`ayrilmamis`). R6c': topraklama takılıyken ayırma kilidi kaldırılamaz (`once_toprak`). verify2 her altın defteri güvenlik denetiminden geçirir. |
| 3 | Zor seviyeler boyuttan zor | **D** | `wk` biti kaldırıldı (dokun-yürü = 1 komut). Bantlara elektrik yapılandırması sayısı ve freeWalk saf karar sayısı eklendi; yürüyüş payı zorunlu. S1 artık bant içinde (yeniden üretildi). |
| 4 | Rastgele basma yanlış birimde | **D** | `solve2.mash` komut düzeyinde dokun-yürü oyuncusu (denetçinin a3.js modeli); bütçe `6·par+20` komut. Ayrıca `metrics2`'deki bütçe hatası (`par` geçiriliyordu) düzeltildi. M2/M3 çekirdek bandında (≤ %10), F1 öğretici yapıldı. |
| 5 | Kapı 9 kendini doğruluyor | **D** | Yeni kapı: seçiciler 4 görünümün HER birinde dondurulduğunda Hamle-opt ya da Kesinti-opt planı değişmeli (`frz`). Seçicisiz seviye kapıdan kalır. Sonuç 7/8. |
| 6 | S1 hedefi Bara A ölü ve hastane dizelde | **D** | R12'ye eklendi: `acil` kaynak yükte değil, `gerilimli` (bakımı biten bölüm yeniden gerilimli), isteğe bağlı `kapali/acik` normal işletme konumu. S1 dizelsiz yeniden kuruldu; T1, T2, S1, S2, S3 normal konum ister. |
| 7 | Kamera topraklama sağlayabiliyor | **D** | İş bölgesi ve yaklaşma bölgesi için topraklama yalnız *sabit* (kablo) bağlantıyla sayılır (`rigidEarthed`). |
| 8 | §6.1 bantları uygulanmıyor | **D** | `bands2.js` + verify2 kontrol 8 zorunlu; tüm seviyeler bant içinde. Çok amaçlılık farklı optimum VEKTÖRLERİ ya da ≥ 2 noktalı cepheyle ölçülür. |
| 9 | Görünmeyen akım bölüşümü | **D** | K7: erişilen her yapılandırmada eşiğe ≥ 0,5 birim pay, tam eşitlik yasak, tamsayı olmayan akımda ≥ 1 birim. Talep ve açma eşiği iş emri kartında ve cihaz adında. |
| 10 | `ogretir` cümleleri veriyle çelişiyor | **D** | `iddia` alanı + verify2 kontrol 11 (farkli, kesintisiz, ret, zorunlu). Bütün cümleler yeniden yazıldı; 36 iddia doğrulandı. |
| 11 | Korumasız arıza kazanma durumu olabiliyor | **D** | `koruma_yok` kilitlemesi; hedef "gerilimli arıza yok" ister; K9 lint'i her kaynak→arıza yolunda koruma ister. |
| 12 | Replay güvenilmeyen dizgide istisna atıyor | **D** | Katı `decodeAct` (düzenli ifade, bilinen eleman, geçerli karo); `replay` hiçbir koşulda istisna atmaz. |
| 13 | Manevra sayımı tutarsız | **D** | Döndürme 0 Manevra; izdüşüm komutu yalnız bağlı küme değişirse 1; kilit/kilit açma simetrik 0; taşınabilir topraklama 1. |
| 14 | Anlık açma, bobin "yük" sayılıyor | **K** | Bobin hassas listeden çıktı (R6b akım tabanlı). `I` her yerde "açma eşiği" olarak adlandırıldı (anma akımı değil). Termik/manyetik ayrım EXT-TERMIK olarak ertelendi. |
| 15 | Zaman modeli | **D** | Kesinti birimi "ağırlıklı yük-komut", deşarj birimi "karar"; döndürme zaman ilerletmez; `bekle` yalnız ölü+şarjlı kondansatör varken. |
| 16 | Çözücü ağırlık taşması | **D** | `solve2.optimum` gerçek demet karşılaştırmalı sözlüksel Dijkstra. |

### 23.2 Elektrik denetimi
| # | Bulgu | Karar | Ne yapıldı / gerekçe |
|---|---|---|---|
| 1 | LOTO sırası (kritik) | **D** | 23.1-2 ile aynı. Ağ çapındaki `toprak` kilitlemesi yalnız yedek denetim olarak kaldı. |
| 2 | R6b akıma bakmıyor | **D** | R6b akım ve potansiyel tabanlı: açma ≤ ε akımda ya da istasyon (kablo/trafo içermeyen) paralel yol varken; kapama aynı istasyon bileşeninde ya da kapamadan sonra ≤ ε akımda. |
| 3 | Bobin "yük" | **D** | Bobin düğümleri artık hassas değil; düşük gerilim açması meşru olay. |
| 4 | Sabit akımlı arıza, negatif gerilimler | **D** | Arıza toprağa şönt iletkenlik (`G_ARIZA=100`). Yükler sabit akım kalır ama K10 lint'i koruma açmayan her yapılandırmada V ≥ 0,9 pu ister (ölçülen en düşük 0,977); HUD gerilim göstermez. |
| 5 | "154 kV" sahada hastane ve dizel | **D** | Bölüm 5 "34,5 kV dağıtım merkezi, çift bara" oldu; düğümler `kv:34.5`; dizel kaldırıldı; K9 lint'i tüketici ≤ 34,5 kV, acil/dizel ≤ 6,3 kV. M3 RMU halkası 34,5 kV. |
| 6 | cos φ 0,95 eski sınır | **D** | `−kap‰·P ≤ 1000·Q ≤ ind‰·P`, varsayılan %20/%15, seviye parametresi; HUD "Endüktif %x / Kapasitif %y". F2 yeniden doğrulandı. |
| 7 | Yük ayırıcısı ve ring kapama | **D** | `yuk_ayirici{Ikes}`: yük/halka akımını açar-kapar, arızaya kapanır, arıza beslerken açılamaz (`kesemez`), kilitlenebilir. ERR.paralel metni düzeltildi. M3 RMU yük ayırıcılarıyla. |
| 8 | Her şeyi gören topraklama kilitlemesi | **K** | Yerel "önce ayır-kilitle" kuralı (R6c) birincil oldu; ağ çapındaki kontrol yedek olarak kaldı ama metni "topraklamaya kapama — ölümcül hata, manevra programı reddedildi" ve Neden? kartı geri besleme kazasını anlatır. Tamamen kaldırılmadı: oyuncunun ölümcül bir hatayı *yapabilmesi* yerine reddedilip açıklanması, hedef kitleye öğretim açısından daha değerli (kazayı simüle eden "kayıp" durumu yoktur). |
| 9 | IEC 60617 / 81346 | **D** | Cihaz kodları -Q0/-Q1/-Q9/-Q8/-QL/-QC/-F/-K/-S/-T/-C/-G/-X; Tek Hat sembol tablosu §24.2. |
| 10 | Çift bara seçici kilitlemesi | **K** | İzdüşüm geçişi zaten iki fazlı ve R6b akım tabanlı (iki ayrı gerilimli bileşen birleşemez). Fider kafasının iki bara kafasına aynı anda değdiği "kalıcı köprü" kümesi için `kuplaj_yok` kuralı EXT-2/3 ile birlikte gelecek; mevcut kanıt seviyelerinde böyle bir küme yok (`csetPairs` taraması). |
| 11 | Kondansatör yaklaşması topraksız | **R** | Bataryalar IEC 60831 iç deşarj dirençli **metal muhafazalı** kabul edilir; deşarj süresi sonunda yaklaşma (dokunma değil) güvenlidir. İş bölgesi bir kondansatör içerirse R9 zaten sabit topraklama ister. Kural Model Notları'nda açıkça yazılır. |
| 12 | AG ayırmaya uygun kesici, kilitlenebilir NH tabanı | **E** | EXT-AYIRMA (§2.12); OG'de "açık sabit kesici ayırma değildir" dersi korunur. |
| 13 | Topraklama iş yerine yakın / iki taraflı | **E** | EXT olarak (kablo seviyeleri, Bölüm 7). Mevcut seviyelerde iş bölgesi tek bara ve topraklama o baranın rijit bileşeninde. |
| 14 | Termik/manyetik, termik röle | **E** | EXT-TERMIK (§2.12), Bölüm 3 kampanya sürümü. |
| 15 | Türkçe terimler | **D** | NA/NK; "NH sigorta bıçağı/tabanı"; "kontaktör çırpması" (`cirpma`); "Kademe-1 kondansatör kontaktörü"; kurgusal cihaz her yerde "izdüşüm seçicisi", "kuplaj" yalnız Q0K; trafo uğultusu 100/200/300 Hz; "gerilim yokluğu tespit edildi, topraklandı ve kısa devre edildi"; "yüksüz kademe değiştirici"; R12 metni "kilitleme ihlali yok; arızalı kesim ayrılmış". |
| 16 | EXT-RCD belirsiz | **D** | Kural yeniden yazıldı (PE sağlam → RCD açar; PE kopuk → açmaz, dokunma gerilimi; `sistem` alanı, TN-C uyarısı). |
| 17 | Normal işletme konumu | **D** | `hedef.kapali/acik`; beş zor seviyenin hepsinde zorunlu. |
| 18 | Açıkta bakır seçici kafası | **D** | Kafalar metal muhafazalı (GIS/RMU benzeri, topraklı gövde, vizör penceresi) çizilir ve tehlike sayılmaz (§3). |
| 19 | K9 lint, 2/3 kilitlemesi, EXT-DC/79 metinleri | **D/E** | Korumasız arıza yolu lint'i ve `koruma_yok` uygulandı; EXT-2/3 eklendi; EXT-DC ve EXT-79 metinleri düzeltildi; UPS/dizel `Ik` sınırı EXT-ATOLYE ile. |

### 23.3 Oyuncu deneyimi, telefon ve kapsam denetimi
| # | Bulgu | Karar | Ne yapıldı / gerekçe |
|---|---|---|---|
| 1 | Kapsam tek kilometre taşına sığmıyor (kritik) | **D** | Üç sürüm: R1 = Bölüm 0–3, 3 biyom, yalnız sim2'deki kurallar; R2 = Bölüm 5 + EXT-RACK/SAAT; R3 = Bölüm 4, 6, 7 + uzantılar. Modül→sürüm matrisi §24.1. F.1 yaşlanma bütçesi ve F.2'nin Kıvılcım bağımlılığı R3'e kadar kesildi. |
| 2 | Telefonda okunabilirlik / SLD yerleşimi (kritik) | **D** | Seviye verisine elle yazılmış `sld` ızgarası; kit sözleşmesi `setState({closed,locked,live,earthed,charge,blown,tripped})`; kapalı panelde her zaman görünen şerit; seçili izdüşüm çiftleri kalıcı dikiş çubuğu (§24.2). |
| 3 | Bantlar doğrulanmıyor | **D** | 23.1-8. |
| 4 | Simüle histogramlar boş | **D** | Simüle popülasyon kaldırıldı. Yerine dürüst **çözüm uzayı** (her Hamle değerinde kaç farklı kazanma durumu), doğrulanmış Pareto cephesi ve oyuncunun kendi geçmişi (§5.2). |
| 5 | Tek optimum, optimizasyon derinliği yok | **K** | Zor bantta çok amaçlılık zorunlu (5/5 zor seviyede 4–7 noktalı cephe, ayrı Kesinti-opt planı). Çekirdek seviyeler için "optimizasyon talepleri" (ör. Kesinti=0 ile en az Hamle) kampanya sürümünde (§24.6); öğreticilerde tek optimum kasıtlıdır. |
| 6 | İpuçları yalnız Hamle | **D** | İpucu ve hayalet oyuncunun seçtiği metriği izler; `solve2.toGoalLex` (Kesinti, sonra Hamle) Worker'da ikinci tablo. Kural dürtmesi metni, sıradaki optimum eylemin `apply` ret koduna ve `describe` adlarına dayalı şablondan üretilir (§5.6). |
| 7 | Döndürme önizlemesi yok, yürürken döndürme | **D** | Döndürme artık elektriği değiştirmediği için yürürken döndürmek güvenli; görüş değişimi sıradaki karo sınırında uygulanır, yol yeni grafta yeniden planlanır. Elektrik önizlemesi "İzdüşümü uygula" düğmesine bağlı: sürükleme sırasında aday kümenin çiftleri, düşecek yükler, Kesinti/Manevra değişimi gösterilir. |
| 8 | Telefon girdisi: cihaza yürüme, hedef boyutu, zoom, jestler | **D** | Cihaza dokununca `sim2.approachTile` ile erişim karosuna yürüme; 20 CSS px içinde en yakın geçerli sahip; iki kademeli kıstırma zoom; iki parmak geri alma < 10 px hareket ister; geri alma birimi 1 komut (§24.3). |
| 9 | Dikiş geçişinde Volti örtülmesi | **D** | Öteleme anı dikiş yönüne göre seçilir (k>0 ilk örtüşmede, k<0 kaynaktan çıkışta) + nesne başına `polygonOffset`; akıcılık testi: geçiş boyunca görünür piksel ≥ %95 (§24.3). |
| 10 | file:// telefonda çalışmaz, paylaşım | **D** | file:// masaüstü/çevrimdışı yol; telefon yolu statik HTTPS barındırma (ya da yayımlanmış artifact). Meydan okuma kopyalanabilir metin kodu `PX2-<seviye>-<base64url>-<h.m.k.o>` + menüde "Kod yapıştır"; URL parçası yalnız http(s)'de (§24.4). |
| 11 | Boyut bütçeleri çelişkili | **D** | Seviye verisi kodla ayrı bütçelenir (≤ 200 KB); kompakt kodlama (RLE harita, eleman demetleri, kanıttan yalnız opt vektörleri + altın dizgi); tam `kanit` yalnız testlerde. Günlük havuz 60 seçilmiş seviye ya da kampanya seviyelerinde kısıtlı optimizasyon talepleri (§24.5). |
| 12 | Worker durum sayısı | **D** | Bant tavanı 4·10⁵ → 1,2·10⁵; en büyük kanıt seviyesi 31 606. Tipli dizi Worker ölçümü içerik kilidinden önce (§22-6). |
| 13 | Çizim bütçesi | **D** | Volti ≤ 4 çizim çağrısı (malzeme başına birleştirilmiş geometri), hayalet Orta+ katmanda ya da siluet, etiketler tek atlas + InstancedMesh, tehlike bölgeleri zemin çıkartması (hacim değil), otomatik katman rAF aralığı + histerezis (§24.5). |
| 14 | Araçlar eski seviyelerin kurallarını değiştiriyor | **D** | Araçlar yalnız YENİ seviyeler açar, mevcut seviyenin eylem kümesini asla değiştirmez; akım okumaları araç değil erişilebilirlik ayarı (§24.6). |
| 15 | Overworld bir angarya | **D** | Kazanınca varsayılan "Sonraki"; harita isteğe bağlı, binaya dokununca anında geçiş; yürüyüş yalnız sırlar için; sırlar çözülmüş bir dioramanın belirli bir elektrik durumunda beliren izdüşüm bağına bağlı (§24.7). |
| 16 | ÖLÜ ama topraksız | **D** | Beşinci durum "ÖLÜ — TOPRAKSIZ (gerilimli say)" kendi deseni ve ikonuyla; `tehlike` kartı düğümü ve nedeni adlandırır. |
| 17 | Kesinti birimi | **D** | "Ağırlıklı yük-komut"; Model Notları'nda açıklanır. |
| 18 | Ton | **D** | Servis robotlarının "teşekkür sahnesi" kesildi; gerçek yükler (pompa istasyonu, yoğun bakım, sinyalizasyon kontrolörü, soğuk hava deposu) ve kısa diegetik ödül (pencereler yanar, uğultu döner) (§24.8). |
| 19 | Açılışta tüm shader derlemesi | **D** | Açılışta yalnız ortak malzemeler + o anki biyom; sonraki biyom kazanma panelinde, katman değişince geçişte (§24.9). |

### 23.4 Kural sürümü 4: sahibin oyun testi (2026-10-13)
| # | Bulgu (sahip) | Karar | Ne yapıldı / gerekçe |
|---|---|---|---|
| 1 | "Döndürünce atlama gibi saçma şeyler": ekran temasıyla komşuluk, dikiş geçişi | **D** | Geometri fiziksel: 4 komşu, aynı yükseklik. Yükseklik yalnız merdivenle (`> < v ^`) ve iskeleyle (`=`) değişir. Üçgen sahipliği ve ekran teması kaldırıldı (§25.2–25.3) |
| 2 | "Takılıp kalıyor, üst bloğa nasıl geçecek yok" | **D** | Fiziksel kapılar F1–F6 (yol yok asla, her karo/cihaz erişilir, merdiven gerekli, tuzak yok) verify2 ve gen2'de zorunlu (§25.6). Yol sürekliliği birim testi (`rules_physical.js`) |
| 3 | "Çıkacağı yerlere merdiven olsun" | **D** | Merdiven ve iskele, derlemede doğrulanan gerçek geometridir: sahanlık, destek, baş boşluğu, duvar (§25.2) |
| 4 | Kamera mantığı değiştiriyor | **D** | Kamera yalnız görsel ve durumda görünüm yok. Görünürlük hiçbir kuralı kapılamaz. Örtücüler yarı saydam (`occluders`) |
| 5 | İzdüşüm seçicisi kurgusu mühendise saçma | **D** | `kafa`, `p` ve `cs` kaldırıldı. Kuplörler sahada gerçek kesici/ayırıcı/yük ayırıcısı oldu; şablonlar dönüştürüldü (§25.11) |
| 6 | "Mantıken burada nasıl yukarı çıkacak ve ne yapacak" | **D** | Amaç kapısı: işlev adları, `isEmri.ozet`, `def.is.ad`, eski metin yasağı. `checklist`, `labelOf`, `deviceState` ve `explain` (engeli adıyla) sim'de. `rehber` ilk seviyelerde sıradaki hedefi vurgular (§25.7) |
| 7 | Erişimin elektrikle bağı açıklanmalı | **D** | Bağ yalnız iki mekanizmayla kurulur: yaklaşma bölgesi (R8) ve hücre kapısı kilitlemesi (`kapi`, `kapi_icerde`). Her ret engeli adlandırır (§25.4) |
| 8 | Zorluk yetişkin kalmalı | **D** | Bantlar korundu. Yürüyüş payı her sınıfta ≤ %55. Basma eşikleri sulandırılmamış ölçüye göre yeniden ölçeklendi ve v3'ün etkin değerlerinden sıkı (§25.8). T1'de 4 noktalı Hamle×Kesinti cephesi var, basma %0,70 |
| 9 | Elektrik kuralları | **R** (değişiklik yok) | R6/R6b/R6c/R6c'/R7/R8/R9/R10/R12 ve Kesinti aynen. Yalnız seçici yolları (en kötü durum ayırmadaki çiftler) kalktı |

---

## 24. Revizyon 3: oynanış, telefon ve kapsam kararları (§8–§18 ile çelişirse bu bölüm kazanır)

### 24.1 Sürümler ve modül matrisi
| Sürüm | İçerik | Kurallar | Biyomlar | Modüller |
|---|---|---|---|---|
| **R1** | Bölüm 0–3 (~27 seviye), düz seviye seçme haritası, 30–60 seçilmiş günlük | yalnız `sim2` kural sürümü 3 (yük ayırıcısı dahil) | Depo, Mahalle, Trafo Merkezi/Fabrika | core, sim Worker, ui/sld, ui/hud, input, render (3 kit), meta (kayıt, defter, kod), test |
| **R2** | Bölüm 5 (34,5 kV dağıtım merkezi) | + EXT-RACK, EXT-SAAT, EXT-2/3 | + Dağıtım Merkezi | + kit, overworld (isteğe bağlı) |
| **R3** | Bölüm 4, 6, 7, Final | + SYNC, 79, ATS, DC, RCD, VDROP, TERMIK, AYIRMA | + Baraj, Yenilenebilir, Metro, Kent | + araç ağacı yeni seviyeleri, Atölye |

### 24.2 Tek Hat paneli ve kit sözleşmesi
- Seviye verisine `sld:{node:{id:[sütun,satır]}, el:{id:[sütun,satır,yön]}}` eklenir (elle yazılır, verify2 lint: her düğüm/eleman yerleşik, çakışma yok).
- Semboller IEC 60617: kesici, ayırıcı, yük ayırıcısı, topraklama ayırıcısı, sigorta / sigortalı yük ayırıcısı, çekmeli araba, trafo (iki daire + Dyn11), kondansatör, jeneratör G, bara (kalın hat), NA/NK kontak, buton, bobin, toprak. Açık/kapalı konum çizimle de gösterilir. İzdüşüm seçicisi için IEC'de olmayan, ayırt edici bir sembol (göz + bıçak).
- Durumlar: CANLI / ÖLÜ — TOPRAKSIZ (gerilimli say) / TOPRAKLI / KİLİTLİ / GÖZLENEMİYOR; renk tek ipucu değildir (desen + ikon).
- Kit sözleşmesi: `PX.KIT[tip](el, biyom) -> {obj, setState({closed,locked,live,earthed,charge,blown,tripped}), anchor, hit}`.
- Kapalı panelde her zaman görünen şerit: beslenen/beslenmeyen yükler, iş bölgesi durumu, tehlike sayısı. Panel açılınca kamera boş görüş alanına yeniden çerçevelenir. Diorama içi cihaz kodları DOM kaplaması olarak açılıp kapanır. Seçili izdüşüm çiftleri kalıcı dikiş çubuğu (yanıp sönme değil).
- Kabul: durum türü başına 375×667 ekran görüntüsü testi.

### 24.3 Telefon girdisi ve akıcılık
- Cihaza dokun: `approachTile` → yürü → cihaz çipleri. Erişilemezse "Bu görünümden erişilemez" + erişilebilen görünümlerin işareti.
- Seçim toleransı 20 CSS px; iki kademeli kıstırma zoom; iki parmak dokunuşu geri alma yalnız < 10 px hareket ve < 250 ms ise; geri alma birimi bir komut (bir dokun-yürü koşusu, bir izdüşüm komutu, bir işlem).
- Yürürken sürükleme: kamera hemen döner, mantıksal görüş sıradaki karo sınırında; kalan yol yeni görünümde yeniden planlanır, planlanamazsa durulur. Elektrik değişmediği için geri yaylanma yok.
- Dikiş geçişi: öteleme anı k>0 ise gövde hedef bölgeyle ilk örtüştüğünde, k<0 ise kaynak bölgeden çıktığında; Volti'ye nesne başına `polygonOffset`. Akıcılık testi ID-tampon geçişiyle görünür pikseli ölçer (≥ %95).

### 24.4 Dağıtım ve paylaşım
- file:// = masaüstü çift tıklama ve çevrimdışı. Telefon = aynı `index.html`'in statik HTTPS kopyası. İkisi de test edilir.
- Meydan okuma kodu: `PX2-<seviye>-<base64url(dizgi)>-<h.m.k.o>`; menüde "Kod yapıştır". Alıcı `sim2.replay` ile doğrular; geçersizse "Bu defter doğrulanamadı". URL parçası yalnız http(s) altında.
- Kod, kural sürümünü (`RULES_VERSION`) taşır; eski sürüm kodları "eski kural sürümü" olarak işaretlenir.

### 24.5 Bütçeler
- JS ≤ 450 KB (three.js hariç), seviye verisi ayrıca ≤ 200 KB; `build.js` bütçeyi üretilen `index.html` üzerinde sayar.
- Seviye kodlaması: RLE harita, eleman demetleri, kanıttan yalnız `opt` vektörleri + altın dizgiler; tam `kanit` yalnız test kenar dosyasında.
- Çizim: Volti ≤ 4 çizim çağrısı; hayalet yalnız Orta+ (Düşük'te siluet); etiketler tek atlas + InstancedMesh; enerjili hat kesik çizgisi tek ShaderMaterial + köşe başına "live" özniteliği; tehlike = zemin çıkartması + çit kenarı. Otomatik katman rAF aralığıyla, histerezisli. Akıcılık paketinde biyom başına çizim çağrısı/üçgen sayacı.

### 24.6 Araçlar, seviye kimliği ve optimizasyon talepleri
- Bir araç (deşarj çubuğu, megger…) yalnız YENİ seviyeler ve yeni "optimizasyon talepleri" açar; çözülmüş bir seviyenin eylem kümesi, optimumu, hayaleti ve kodu asla değişmez.
- Pens ampermetre araç değildir: Tek Hat panelinde akım okumaları bir erişilebilirlik/ayar seçeneğidir.
- Optimizasyon talebi = aynı seviye + kısıt (ör. "Kesinti = 0 iken en az Hamle", "Q0K'ya dokunmadan"), build'de ayrı ayrı doğrulanır; günlük bulmaca havuzu bunlardan da beslenir. Seviye başına "X/Y cephe noktası bulundu" uzun soluklu hedeftir.

### 24.7 Ekran akışı ve dünya haritası
- Kazanma paneli: **Sonraki** (varsayılan, ≤ 300 ms oynanabilir) ve **Harita**. Harita isteğe bağlıdır; binaya dokununca anında geçiş. Haritada yürüyüş yalnız sırlar içindir.
- Sırlar çözülmüş bir dioramanın belirli bir elektrik durumunda (ör. kuplaj kapalı + belirli seçici kümesi) beliren izdüşüm bağlarına bağlıdır; dört görünümü döndürerek bulunmaz.

### 24.8 Ton
- Gerçek yükler ve gerçek riskler: su pompa istasyonu, hastane yoğun bakım, sinyalizasyon kontrolörü, soğuk hava deposu. Ödül sahneleri kısa ve diegetik (pencereler yanar, uğultu döner, sayaç döner); teşekkür animasyonu yok. Terimler ve ton bir VoltGuard mühendisince gözden geçirilir.

### 24.9 Açılış
- Açılışta yalnız ortak malzemeler ve o anki biyom derlenir; sonraki biyom kazanma panelinde, katman değişince seviye geçişinde. Akıcılık testi: biyom başına ilk cihaz etkileşiminde > 50 ms uzun görev yok.

### 24.10 Kural sürümü 4 (fiziksel dünya): oynanış ve telefon kararları
- Döndürme yalnız kameradır: hiçbir zaman reddedilmez, yürürken serbesttir, geri alma geçmişine girmez. §24.3'teki "mantıksal görüş sıradaki karo sınırında" ve "yol yeni görünümde yeniden planlanır" maddeleri ile §12.6 dikiş geçişi kalktı.
- Örtme: Volti, seçili cihaz, yol önizlemesi ve iş karosu önündeki bloklar yarı saydamdır. Dokunuş seçimi saydam blokları atlar (`ownerAt`).
- Dokunuş akışı: cihaza dokun → `approachTile` → yürü (merdiven/iskele dahil) → çipler. Erişilemezse `explain` kartı açılır (engel adı + vurgu); sessiz takılma yok. İlk seviyelerde (`rehber`) sıradaki hedef vurgulanır.
- Açılış: iş emrinin tek cümlesi (`isEmri.ozet`) ve kalıcı iş listesi (beş altın kural + hedefler, `checklist`). Cihaz etiketleri gerçek işlevle görünür ve durum rozeti taşır.
- Meydan okuma kodu `-r4` ile biter. v3 kodları "eski kural sürümü" olarak işaretlenir (§24.4).

---

## 25. Fiziksel dünya (kural sürümü 4)

> Bu bölüm §2.2, §2.3, §2.10, §4, §12.6, §21 ve §2.15'in görünüm/izdüşüm maddelerinin YERİNE geçer; çelişkide §25 kazanır.
> Kod: `tools/reference2/sim2.js` (`RULES_VERSION = 4`), `site2.js`, `lint2.js` (`physical`, `purpose`), `verify2.js`, `gen2.js`.
> Tasarımcı rehberi: `tools/reference2/PHYSICAL_GUIDE.md`. İstemci geçişi: `tools/src2/_requests/rules-v4.md`.

### 25.1 Karar
Sahip (elektrik mühendisi) R1'i oynadı ve perspektif mekaniğini reddetti. Sözleri: "çıkacağı yerlere merdiven olsun,
biraz daha mantıklı olsun, döndürünce atlama gibi saçma şeyler olmasın"; "takılıp kalıyor, üst bloğa nasıl geçecek yok";
"mantıken burada nasıl yukarı çıkacak ve ne yapacak, çok saçma". Seçilen yol tamamen fiziksel bir dünyadır:
1. Volti yalnız fiziksel olarak bitişik karolar arasında yürür: 4 komşu, aynı yükseklik. Yükseklik yalnız haritadaki
   gerçek merdiven ve iskele geometrisiyle değişir. Atlama, düşme, ekran teması, derinlik dikişi yoktur.
2. Kamera (4 izometrik görünüm) YALNIZ GÖRSELDİR. Komşuluğu, erişimi, elektriği, yasallığı değiştirmez ve durumda yer
   almaz. Örten bloklar yarı saydam yapılır; hiçbir önemli şey gizli kalmaz.
3. İzdüşüm seçicisi ("İzdüşümü uygula", `p`, `cs`, `kafa`) KALDIRILDI. Eski kuplörler sahada gerçek anahtarlama
   cihazıdır (kuplaj kesicisi, bara seçici ayırıcısı, yük ayırıcısı) ve yanına yürünerek çalıştırılır.
4. Her cihazın ve her hedefin bir yaklaşma karosu vardır. Erişim, elektrik durumuna yalnız açıklanmış fiziksel
   mekanizmalarla bağlıdır: yaklaşma bölgesi (R8) ve hücre kapısı kilitlemesi. Oyun her zaman NEDEN erişilemediğini ve
   engelin ADINI söyler.
5. Elektrik kuralları (R6 akım tabanlı ayırıcı kuralı, en kötü durum ayırması, LOTO sırası, koruma, kondansatör, trafo,
   normal işletme konumu, Kesinti) kural sürümü 3 ile AYNIDIR.

### 25.2 Geometri ve harita
- Hücre türleri (`S.KIND`): `.` boş · `#`/`s`/`w` blok · harf: eleman küpü · `>` `<` `v` `^` merdiven (ok yukarı çıkış
  yönü; metinde sağ = +x, aşağı satır = +z) · `=` iskele basamağı · `%` duvar/çit (dolu, üstü karo değil) · harf
  (`t:'kapi'`): hücre kapısı (geçilebilir eşik).
- **Karo** = üstü boş (ya da iskele ayağı, ya da kapı) blok. Volti karonun bir üst hücresinde durur.
- **Düz adım:** karo (x,y,z) ↔ karo (x±1,y,z) / (x,y,z±1).
- **Merdiven** hücresi S, yön d: altında blok ya da duvar olmalı; alt sahanlık S−d (bir alt katta karo), üst sahanlık S+d
  (aynı katta karo) olmalı; üstü boş olmalı. Merdiven alt sahanlıkla üst sahanlığı bağlar (+1 kat) ve Volti üzerinde durmaz.
- **İskele:** bir bloğun üstünde başlayan dikey `=` sütunudur. Tam bir yanında, her basamak katmanında dolu olan ve tepesi
  son basamak katmanında olan bir duvar/blok bulunur; bu tepe üst sahanlıktır. İskele ayak karosunu üst sahanlığa
  bağlar (+1..2 kat). Yön belirsizse derleme hatası verir.
- **Ekipman ve kapı** bir bloğun üstüne oturur; havada eleman derleme hatasıdır.
- Derleme hataları Türkçedir ve hücreyi adlandırır (ör. "merdiven (x3 y1 z1): alt sahanlık yok …").
- `site2.js` sütun tabanlı saha tanımını (h, duvar, eq, st, ld, kapılar, başlangıç, iş) haritaya çevirir (`build`), haritayı
  sahaya çözer (`parse`) ve üstten görünüş basar (`ascii`).

### 25.3 Hareket ve kamera
- `git` (dokun-yürü) fiziksel BFS'te (`walkTargets`) ulaşılan herhangi bir karoya gider ve 1 Hamle'dir. Koşunun
  uzunluğu ve kullandığı merdiven/iskele sayısı önemsizdir: rota planlaması kaç AYRI gidiş gerektiğiyle ölçülür.
  Yürüyüş elektriği değiştirmez.
- `walkPath(L, s, to)` deterministik en kısa fiziksel yoldur (karo / merdiven / iskele adımları, ayak yüksekliği `h`).
  Animasyon, yol önizlemesi ve hayalet bunu izler. `rules_physical.js` her yolun sürekli olduğunu doğrular.
- Döndürme (d+/d−) sim eylemi değildir: istemci kamerasıdır, hiçbir zaman reddedilmez, geri alma geçmişine girmez.
- `occluders(L, v, hedefler)` görünüm v'de hedeflerin önündeki hücreleri verir; bu hücreler yarı saydam yapılır.
  Hedefler Volti gövdesi, seçili cihaz, yol önizlemesi ve iş karosudur. `ownerAt(L, v, U, V, t, saydam)` dokunuş seçimidir;
  saydam örtücüleri atlar. `screenToDir` ve `stepToward` klavye adımıdır. Görünürlük hiçbir kuralı kapılamaz.

### 25.4 Erişim ve açıklama
- Cihaz, Volti'nin gövde katmanındaki 4 yatay komşu karodan (yaklaşma karoları, `L.approach[e]`) çalıştırılır.
  `approachTile` şu an geçilebilir yoldan en yakın yaklaşma karosunu verir.
- **Yaklaşma bölgesi (R8)** aynen geçerlidir ve artık merdiven/iskele hücrelerine de uygulanır.
- **Hücre kapısı** `{t:'kapi', toprak:'Q8x' | kilitli:'Q1x', ad}`: koşul sağlanınca geçilir. Mekanik kilitleme gereği,
  Volti iç bölgede ya da eşikteyken kapıyı kilitleyecek manevra (`kapi_icerde`) reddedilir. İç bölge, kapı karosu
  olmadan başlangıçtan ulaşılamayan karolardır.
- `explain(L, s, {e}|{tile})`, erişilemeyen hedef için en az engelli fiziksel yolu bulur, engelleri (`kapi_kilitli`,
  `bolge_gerilimli`, `bolge_topraksiz`, `bolge_kond`) cihaz adıyla döner ve engelli hücreleri listeler. Örnek:
  "Hücre kapısı kilitli: K1 (TR1 OG bara hücresi kapısı — Q81 kilitlemeli). Kapı kilitlemesi: önce Q81 (TR1 OG bara
  topraklama ayırıcısı) kapatılmalı." Yaklaşma karosunda olmayan cihaz işlemi `uzak` ile reddedilir; `yol_yok` F1 kapısı
  sayesinde dönüştürülmüş seviyelerde hiç görülmez.
- `tehlike` metni bölgeyi adlandırır. Ret kodu tablosu `rules-v4.md` §2'dedir. `gorunmez` ve `kafa_temas` kaldırıldı.

### 25.5 Durum, eylem, simge, maliyet
- Durum `{p, b, lk, sp, st, ch, w}`: görünüm `v` ve izdüşüm kümesi `cs` yok. Durum sayısı v3'ün aynı geometrisine göre
  ×4 (görünüm) × |cs| küçülür, ama artık her karo erişilebilir olduğundan fiziksel sahalar daha çok karo taşır.
- Eylemler `git op kilit kilitac degistir bas set calis bekle`. Simgeler `g<n> o: k: a: f: b: s: c w`. `d±` ve `p`
  simgeleri reddedilir (`dogrulanamadi`). Maliyet `{h, m, k, o}`. Meydan okuma kodu `-r4`.

### 25.6 Fiziksel kapılar (§4.2 izdüşüm×devre kapısının yerine; `lint2.physical`, verify2 kontrol 9)
| | Kural |
|---|---|
| F1 | Her çalıştırılabilir cihazın ve iş noktasının fiziksel yolu var. "Yol yok: merdiven gerekiyor" hiçbir yayımlanan seviyede yok |
| F2 | Her cihaz ve iş noktası en az bir erişilebilir durumda Volti'nin erişiminde |
| F3 | Yürünebilir görünen her karo bir erişilebilir durumda ziyaret edilir. Yalnız hep gerilimli iletken yanındaki kalıcı yaklaşma bölgesi karosu muaftır (taralı; raporlanır). Dekor ızgaranın dışındadır; ızgara içinde yürünmeyen dolu blok `%` duvardır |
| F4 | Her merdiven/iskele bir altın çözümde (Hamle/Manevra/Kesinti-opt, talepler; deterministik `walkPath`) kullanılır ya da kaldırılınca erişim daralır. Gereksiz merdiven reddedilir |
| F5 | Her kapı bir bölmeyi gerçekten kapatır ve en az bir erişilebilir durumda açılır |
| F6 | Fiziksel tuzak yok: aynı elektrik yapılandırmasında başka konumdan çözülebilirken Volti'nin konumu yüzünden çıkmaza giren durum yoktur |
Ayrıca derleme: merdiven sahanlıkları, iskele duvarı, ekipman ve kapı desteği. Birim testi (`rules_physical.js`): yol
sürekliliği, yürüyüşün elektriksizliği, açıklamasız ret yok.

### 25.7 Amaç kapısı (`lint2.purpose`, verify2 kontrol 16)
- A1: `kablo` ve `yardimci` dışındaki her elemanın gerçek işlev adı (`ad`) var. Oyunda `labelOf` = "Q01 Okul fideri
  kesicisi" görünür.
- A2: R1 seviyelerinde `isEmri.ozet` alanı var: en fazla 160 karakterlik, düz mühendislik Türkçesiyle açılış cümlesi.
- A3: iş noktası olan seviyede `def.is.ad` var (iş karosu altyazısı).
- A4: oyuncu metninde izdüşüm/kamera kalıntısı yok.
- `sim2.checklist(L, s)`: beş altın kural (1 Ayır · 2 Kilitle ve etiketle · 3 Gerilim yokluğunu tespit et ·
  4 Topraklayıp kısa devre et · 5 Yaklaşma bölgesi güvenli), iş, geri verme ve hedefler (yükler, yeniden gerilimli bölüm,
  normal konum, arıza, cos φ, acil kaynak). Her komuttan sonra hesaplanır; kazanılan her durumda hepsi `done` olur
  (birim testi).
- `deviceState` canlı/ölü/topraklı/kilitli rozetlerini verir. `rehber: true` seviyelerinde sıradaki hedef vurgulanır.

### 25.8 Bantlar ve ablasyonlar
- Yürüyüş payı bütün sınıflarda ≤ %55.
- Basma eşikleri yeniden ölçeklendi. v3 ölçüsünde döndürme komutları rastgele oyuncunun menüsünü sulandırıyordu.
  Aynı v3 seviyeleri döndürmesiz (yürüyüş ve döndürme bedava) ölçüldüğünde:

  | Seviye | v3 | Sulandırılmamış |
  |---|---|---|
  | M1 | %14,1 | %88,8 |
  | T5 | %1,07 | %50,4 |
  | M7 | %0 | %49,9 |
  | T2 | %0 | %21,7 |
  | T1 | %0,1 | %19,4 |
  | T6 | %0 | %10,1 |
  | M8 | %0 | %3,9 |
  | F7 | %0 | %1,2 |

  v4 eşikleri: öğretici ≤ %90, çekirdek ≤ %30, zor ≤ %8, sınav ≤ %4, günlük ≤ %30. Zor ve sınav eşikleri v3'ün
  sulandırılmamış değerlerinden sıkıdır.
- Diğer ölçüler (par, Manevra-opt, Kesinti-opt Manevra, elektrik yapılandırması, durum, esaslı mekanik, çok amaçlılık,
  saf karar) değişmedi.
- Ablasyonlar: noAyiriciKurali, noZones, noLoto, noBackfeed, noProtection, noSync, noCapLock, **noDoors** (yeni).
  Kaldırılanlar: noCouplers, noCommit, noVisOps, noRotate, freeze. Esaslı sayı bu 8 bayrağın Hamle-opt ya da
  Kesinti-opt'u değiştirenleridir.
- Yeni iddia türü `engel`: bir erişilebilir durumda hedefe (cihaz ya da `w`) erişim, adı geçen engel koduyla reddedilir.

### 25.9 Kanıt seviyeleri (kural sürümü 4)
| id | Ad | Sınıf | Saha | Hamle-opt | Manevra-opt | Kesinti-opt | Durum | Elek | Basma | Yürü | Saf | Esas | Cephe H×K |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | İlk Manevra | Öğretici | asma kat + merdiven | [9,5,23,0] | [9,5,23,0] | [9,5,23,0] | 515 | 28 | %45,2 | %44 | 5 | 2 | [[9,23]] |
| M1 | Beş Altın Kural | Öğretici | sokak kutusu + iskele | [16,6,14,0] | [16,6,14,0] | [16,6,14,0] | 415 | 16 | %88,8 | %44 | 9 | 3 | [[16,14]] |
| T1 | Geri Besleme | Zor | OG galerisi + merdiven + kilitlemeli kapı | [18,6,36,0] | [18,6,36,0] | [28,12,22,0] | 61 695 | 2 650 | %0,70 | %39 | 11 | 4 | [[18,36],[26,24],[27,23],[28,22]] |
| S1 | Çift Bara Transferi (R2) | Zor | gen2 galeri, 2 merdiven | [18,6,46,0] | [19,4,30,0] | [29,12,0,0] | 21 940 | 1 040 | %3,17 | %39 | 11 | 3 | [[18,46],[19,30],[29,0]] |

Bütün fiziksel kapılar, amaç kapısı, K7/K9/K10, güvenlik denetimi, iddialar ve talepler geçer. T1 talepleri:
T1-a "Hastane hiç kararmadan" [26,12,24,0] ve T1-b "AG kuplajına dokunmadan" [20,8,54,0].
- **P1:** UPS kesicisi 3,5'ta açar. Önce kesici açılır; asma kattaki panoda forklift şarjı ayrılır, aydınlatma ve kapı
  motoru bağlanır; sonra kesici kapanır. Esaslı mekanikler: noAyiriciKurali 9→5, noProtection 9→7.
- **M1:** iş noktası bara yaklaşma bölgesindedir. Topraklama kolu bölgenin dışındadır; topraklamayı açmadan önce bölgeden
  çıkılır (noZones 16→14).
- **T1:** iki eşdeğer AG ayırma noktası var. En kısa plan zaten açık olan çekmeli kuplajı kilitler ve hastaneyi karartır.
  Kesintisiz plan kuplajı kapatır, okulu ayırır (TR2 AG 3,5 < 2+2) ve TR1 AG kesicisini kilitler. Bara hücresi kapısı
  Q81'e kilitlidir. Esaslı mekanikler: noAyiriciKurali, noLoto, noBackfeed, noProtection:kesinti.

### 25.10 Geçiş durumu
- verify2, `kuralSurumu: 4` taşımayan seviyeyi "fiziksel dünyaya dönüştürülmeli" ile reddeder. Şu an 24 kampanya
  seviyesi ve 37 günlük bulmaca dönüştürülmeli: bölüm tasarımcıları ve entegratör.
- `build.js --dev/--no-verify` bu seviyeleri uyarıyla atlar. Sürüm build'i durur.
- R2 kanıtları: S1, gen2 ile fiziksel olarak yeniden üretildi. v3 S2 "Seçici Görüş" ve S3 "Bara Transferi" izdüşüm
  seçicisine dayanıyordu; fiziksel dünyadaki karşılıkları S1'in kuplajla önce-kapa-sonra-aç transferidir. Bu yüzden
  ikisi kaldırıldı. İki fiderli çift bara şablonu `cift_bara_iki_fider` Bölüm 5 tasarımına bırakıldı (gen2 adayı
  esaslı 2 < 3 ile bandın dışında kaldı).
- Worker (`core/worker_src.js`) v4'e geçirildi (102/102). İstemci modüllerinin geçişi `rules-v4.md`'dedir.

### 25.11 Üretici (`gen2.js`)
Şablon alanı `saha` (`duz`, `asma_kat`, `galeri`, `kosk`, `kanal`) ilk sahayı kurar. Mutasyonlar: yükseklik, 2×2 platform,
duvar, ekipman/kapı taşıma, merdiven ekle/kaldır, iskele ekle/kaldır, başlangıç/iş. Normalleştirme geçersiz
merdiven/iskeleyi düşürür. Hızlı kapılar: kopuk karo, yaklaşma karosu yok, işlevsiz kapı. Tam değerlendirme:
- fiziksel kapılar (her ihlal −15);
- bant ihlalleri (−10);
- essential ablasyonları ve esaslı mekanik alt sınırı;
- çok katlı sahada kullanılan merdiven/iskele ödülü (hiç kullanılmazsa −6).

`templates2.js` kafa elemanlarını gerçek cihazlara çevirdi: bara seçici ayırıcıları, transfer ayırıcıları, ring normalde
açık nokta yük ayırıcısı, kumanda MCB'si, kompanzasyon panosu ayırıcısı. `pxc`/`needPairs`/`needAdj`/`forbid*` yok sayılır.

### 25.12 Açık konular
1. Fiziksel sahalarda durum sayısı arttı (T1: 61 695; v3 T1: 12 700). Bunun nedeni, her karonun her durumda erişilebilir
   olmasıdır. Bant tavanı 1,2·10⁵ korunuyor; telefon Worker ölçümü yeniden yapılmalı.
2. Merdiven/iskele/kapı kitlerinin 375 px okunabilirliği ve Volti tırmanma animasyonu render ekibindedir.
3. Fiziksel v4 yayını parser tabanlı küçültmeyle yaklaşık 470 KB JS içerir; kaynak incelemesi ve yayın
   düzeltmelerinden sonra bütçe 500 KB olarak güncellenmiştir (§25.13). Seviye verisi sınırı 200 KB korunur.
4. Kapı yalnız topraklama ayırıcısına ya da kilide bağlıdır. Çekmeli araba konumu (EXT-RACK) ile bağlantısı R2'dedir.

### 25.13 Yayın bakımı (2026-10-13)

27 kampanya seviyesi ve 37 günlük bulmaca fiziksel v4 kurallarıyla yayınlanır. Kamera yalnız görünümü değiştirir;
eski izdüşüm günlükleri fiziksel saha varyantları olarak yeniden üretilip doğrulanmıştır. Kaynak ile `index.html`
aynı kuralları kullanır. Three.js r128 doğrulanmış yerel kopyadan HTML'e gömülür; tek dosyalı ilk açılış çevrimdışı çalışır.

Önceki v3'ün 450 KB JS sınırı, fiziksel erişim açıklamaları ve merdiven/iskele çizimi dahil v4 için 500 KB olarak
güncellenmiştir. Bu bir optimizasyon başarısı iddiası değildir: parser tabanlı küçültme kodu azaltır, fakat eski
450 KB hedefi hâlâ karşılanmaz. Build 500 KB JS ve 200 KB seviye verisi sınırlarını uygular; başarısız build mevcut
yayını değiştirmez. Önceki bölümlerdeki 450 KB/CDN yükleme ifadelerinin yerine bu yayın kararı geçer.
