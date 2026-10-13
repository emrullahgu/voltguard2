# PARALAKS: TEK HAT — fiziksel dünya (R1, kural sürümü 4)

VoltGuard saha robotu Volti ile tarayıcıda oynanan elektrik manevra bulmacası.
27 kampanya seviyesi ve 37 Günün Manevrası bulmacası içerir. Volti bitişik karolarda yürür;
katlar arasında haritadaki merdiven ve iskeleyi kullanır. Kamerayı döndürmek yalnız bakış açısını değiştirir.
Başarı Hamle, Manevra, Kesinti ve Olay ölçütleriyle değerlendirilir.

## Oyunu aç

`index.html` dosyasına çift tıklayın. Grafik bileşeni dosyaya gömülüdür; ilk açılışta internet gerekmez.
Telefonda aynı tek dosyayı bir statik HTTPS sunucusuna koyabilirsiniz.
Meydan okuma kodu Menü → Kod yapıştır ile açılır; bağlantılar HTTP(S) altında paylaşılır.

| İşlem | Telefon | Masaüstü |
|---|---|---|
| Yürü | Karoya dokun | Karoya tıkla veya ok tuşlarını kullan |
| Kamera | Yatay kaydır | Sürükle, tekerlek, Q/E veya Sola/Sağa |
| Cihaz | Cihaza dokun, eylem çipini seç | Tıkla; Boşluk ilk çipi, 1–9 ilgili çipi seçer |
| Geri al / yinele | Düğmeler; iki parmak dokunuşu geri alır | Z/Y veya Ctrl+Z/Ctrl+Y |
| İpucu | İpucu düğmesi | H |
| Cihaz bilgisi | Uzun bas | Fareyle basılı tut |
| Yakınlaştır | İki parmakla kıstır | — |
| Tek Hat | Alt şeride dokun | Sağ panel |

Erişilemeyen hedefler engelin ve çözüm cihazının adıyla açıklanır. Kayıt tarayıcıda saklanır;
kayıt desteklenmezse oyun oturum içinde devam eder.

## Kaynaklar ve geliştirme

`index.html` üretilmiş yayın dosyasıdır. Değişiklikler `tools/src2/` ve `tools/reference2/`
kaynaklarında yapılır, ardından yayın yeniden derlenir. Eski oyunlar `legacy/` içindedir;
`dev/` dosyaları geliştirme kopyalarıdır ve güncel yayın yerine kullanılmamalıdır.

- `docs/PARALAKS2_SPEC.md`: şartname; çelişkide fiziksel dünya bölümü §25 geçerlidir.
- `tools/src2/manifest.json`: modül sırası, grafik bileşeni ve boyut bütçeleri.
- `tools/reference2/sim2.js`: kural motoru; `solve2.js`, `talep2.js`, `verify2.js`: çözücü ve doğrulama.
- `tools/reference2/levels/ch0..ch3.js`: kampanya; `daily2.js`: 37 fiziksel günlük seviye.
- `tools/reference2/migrate_daily4.js`: günlük saha varyantlarını yeniden üretip doğrular.
- `tools/test/`: birim, tarayıcı, dokunma, yerleşim ve performans kontrolleri.

Node 24 gerekir. Derleme için kilit dosyasındaki araç bağımlılıklarını bir kez kurun:

```sh
npm ci --prefix tools
node tools/reference2/verify2.js
node tools/build.js
node tools/build.js --dev --out dev/x.html
node tools/test/run.js all
```

Başarısız bir yayın derlemesi mevcut `index.html` dosyasını değiştirmez. JavaScript,
[Terser](https://terser.org/docs/api-reference/) ile ayrıştırılarak küçültülür; kamu özellik adları
korunur. Parametre başlangıç ifadeleri bulunan modüllerde kapsamı korumak için yalnız biçim küçültme
uygulanır. Three.js r128 yerel kopyasının SHA-256 değeri derlemede doğrulanır; MIT lisansı
`tools/vendor/three.LICENSE` dosyasındadır.

Fiziksel v4 yayını yaklaşık 472 KB oyun JavaScript'i ve 178 KB seviye verisi içerir.
Önceki v3'ün 450 KB JS hedefi karşılanmıyor: yeni fiziksel model için yayın sınırı açıkça
500 KB olarak güncellendi (§25.13). Seviye sınırı 200 KB; gömülü three.js bu ölçümlere dahil değildir.

## Bakımda giderilen sorunlar (2026-10-13)

- Kaynaklarla eski yayın arasındaki sürüm farkı ve çalışmayan günlük havuz giderildi.
- İpucu hesaplanırken ve ücretsiz çıkmaz ipucunda başarı mühürlerinin kaybolması düzeltildi.
- Tekerlek/dokunma geçişleri, eski zamanlayıcılar ve yanlış iki parmak geri almaları düzeltildi.
- Bozuk kayıtlar onarılıyor; günlük meydan okumalar, hayalet iptali ve ayar sıfırlama tutarlı çalışıyor.
- Kayıtlar kural sürümünü taşır. Uyumsuz eski skorlar/mühürler ve günlük tamamlanmalar arşivlenir;
  özgün kayıt ayrıca yedeklenir. Doğrulanabilir v4 başarıları, ayarlar, kozmetikler ve önceki erişim korunur.
- Buton darbesinde kondansatör şarjı, geçici güvenlik kontrolü ve çoklu koruma Olay sayımı düzeltildi.
- Çözümsüz optimizasyon taleplerinin sonsuz araması, uzun Pareto yolları ve keşif sınırları düzeltildi.
- Worker önbelleği devre tanımını doğruluyor; başlatma/çalışma hataları bekleyen istekleri sonuçlandırıyor.
- Animasyon havuzundaki iptal yarışı ve bulanıklaşma/odaklanma sırasında sesin kapalı kalması düzeltildi.
- Dar ekranlarda cihaz etiketleri çakışmıyor. Başlatma hatası anlaşılır biçimde gösteriliyor.
- Normal cihazlar ile örneklenmiş duvar/korkuluklar ayrı malzeme kullanıyor; her karede gereksiz shader
  seçimi kaldırıldı. Yeni seviyelerin gizli çizim türleri ilk dokunuştan önce hazırlanıyor.
- İlk açılış, ayrı klasöre kopyalanmış tek HTML üzerinde bütün ağ bağlantıları engellenerek doğrulandı.

## Doğrulama ve sınırlar

28 kampanya/ek kanıt seviyesi ve 37 günlük bulmaca için `ALL LEVELS VERIFIED`.
Fiziksel kurallar 224/224, Worker 678/678, istemci 477/477, kayıt/günlük/hayalet 348/348,
controller 48/48 ve render 48/48 kontrollerini geçti. Derleme anlamını ve hata sırasında
mevcut yayının korunmasını sınayan yeni regresyonlar da geçti.

Tarayıcı paketleri: smoke, storage, replay, daily (111/111 günlük çözüm), parity, reach, grounding,
touchplay, ui ve leak geçti. Shader regresyonu 120 sabit karede sıfır yeniden program seçimi ve
ilk yürüyüşte sıfır yeni program derlemesi doğruladı. Son sızıntı denetiminde geometri/doku sayıları sabit,
yığın artışı 0,97 MB idi (sınır 2 MB).

Sıkı flow paketi tamamen yeşil değildir: bütün sayfanın kare başına bellek ayırması 1 KB hedefinin
üzerindedir. Shader düzeltmesinden sonraki koşularda yaklaşık 7–12,5 KB/kare ölçüldü; ölçüm test örneklemesini de içerir.
Volti'nin ayrı örnekleme payı 79 B/kareye indi. SwiftShader'da ilk dokunuş ve 4× CPU uzun görev ölçümleri
bazen sınırı aşar. Bu performans eşikleri değiştirilmedi.

Tarayıcı denetimleri Windows'ta headless Chrome ve SwiftShader ile yapılır. Gerçek telefon,
iOS Safari ve gerçek GPU ölçümleri yapılmadı. Sıkı performans eşikleri makine yükünden etkilenebilir;
seslerin rastgele sentezine bağlı gömülü TRIM kalibrasyon testi A2b zaman zaman ±2 dB/tepe sınırını aşar.
Ses çıkışındaki sınırlayıcı korunur. Bu testte eşikler gevşetilmedi.

Oyun gerçek tesis işletme talimatının yerine geçmez; elektrik modeli eğitim amaçlı sadeleştirilmiştir.
