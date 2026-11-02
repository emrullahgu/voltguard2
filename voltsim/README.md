# VoltSim geliştirme rehberi

VoltSim, hesapları tarayıcıda çalışan 18 mühendislik simülasyonundan oluşur. Hesap sonucu sahneyi besler; animasyon veya sahnedeki nesnelerin konumu hesap verisi sayılmaz. Sonuçlar, her modülde açıklanan veri, yöntem ve varsayımlarla sınırlı ön hesaplardır.

## Kaynak ve yayın dosyaları

| Konum | Sorumluluk |
| --- | --- |
| `tools/build-voltsim.cjs` | Modül kataloğu, sayfa metinleri, kaynak bağımlılıkları ve HTML üretimi |
| `js/voltsim/engine.js` | Ortak yardımcılar, sayısal girdi doğrulaması ve temel hesap motorları |
| `js/voltsim/calc/<id>.js` | DOM ve WebGL'den bağımsız modül hesapları ve durum makineleri |
| `js/voltsim/mod/<id>.js` | Varsayılanlar, kontroller, senaryolar, görevler, analiz ve 2D/3D sunumu |
| `js/voltsim/core.js` | Uygulama yaşam döngüsü, görünüm, denetimler, çizimler, proje dosyaları ve raporlar |
| `js/voltsim/identity.js` | Hesap kimlikleri, girdiler, varsayımlar, kaynaklar ve sonuç durumları |
| `js/voltsim/regulations.js` | Kaynak/mevzuat kayıtları; bunların tarih ve kapsam bilgisi |
| `css/voltsim.css` | Ortak simülasyon arayüzü |
| `voltsim/index.html`, `voltsim/<slug>/index.html` | Üretilen yayın dosyaları |

Yukarıdaki yollar depo köküne göredir. Üretilen HTML'de kalıcı değişiklik yapmayın; üreticiyi veya ilgili JS/CSS kaynağını değiştirin. Ortak site başlığı ve altbilgisi `tools/shell.py` ile eklenir.

## Hesap ve arayüz arasındaki sözleşme

Hesap fonksiyonları değerlerin yanında `ok`, `errors`, `warnings` ve denetim sonuçlarını döndürür. Geçersiz veri başarılı bir sayı gibi sunulmamalıdır. Birimleri, geçerli aralıkları, sıfır yük/üretim durumlarını ve modelin uygulanamayacağı koşulları hesap katmanında ele alın.

Ek hesap dosyaları tarayıcıda `VoltSimEngine.ext.<id>` üzerinden, Node testlerinde `require()` ile kullanılır. Modül dosyası `VoltSim.register(...)` ile tanımını kaydeder. Yeni bir hesap, sırf arayüzde kullanılacağı için DOM veya Three.js bağımlılığı almamalıdır.

Kontrollerdeki `min`/`max` nitelikleri kullanıcıya yardımcı olur; hesap motorunun doğrulamasının yerine geçmez. Proje yükleme de hesap ve sürüm kontrollerinden geçer. Mevcut projelerde alan biçimi değişiyorsa modülün `schema` ve gerektiğinde `migrate` davranışını birlikte değerlendirin; eski dosyaları sessizce farklı yorumlamayın.

## Bağımlılık yükleme ve 3D yaşam döngüsü

Üretici, simülasyon sayfasına ortak çekirdeği, ilgili modülün `calc`/`mod` dosyalarını ve katalogdaki açık ek bağımlılıkları ekler. Bütün modül dosyaları her sayfaya yüklenmez. Tanıtım ve hesap kimlikleri sayfaları Three.js yüklemez.

3D simülasyon sayfalarında yerel `js/vendor/three-r128.min.js` halen `defer` ile indirilir. **Kütüphanenin indirilmesi ile sahnenin kurulması farklı aşamalardır:** çekirdek hesapları ve kontrolleri açar; sahne alanı görüşe yaklaşınca `IntersectionObserver` ve ilk boyama sonrası ayrı görev üzerinden WebGL kurulumu yapılır.

Görünmeyen/arka plandaki uygulamaların çizim döngüleri durdurulur; değişmeyen sahne sürekli yeniden çizilmez. Düşük kalite, azaltılmış hareket ve 2D şema desteği korunmalıdır. WebGL kurulamazsa hesaplar ve 2D görünüm kullanılabilir; bağlam kaybı/geri dönüş ve kaynak temizliği de yaşam döngüsünün parçasıdır.

Three.js sürümünü veya yükleme biçimini değiştirmek yalnız dosya adını değiştirmek değildir. Modül kaydı, ilk sahne, kalite değişimi, seçim, yeniden kurulum, bağlam kaybı ve WebGL'siz geri dönüş birlikte doğrulanmalıdır.

## Proje ve rapor işlemleri

- **CSV:** sonuçların `text/csv;charset=utf-8` türüyle indirilmesi.
- **JSON:** `voltsim-project` biçimindeki proje/girdi dosyasının kaydedilmesi ve yüklenmesi. Dosya seçicisinde 2 MiB sınırı vardır; modül ve şema denetlenir.
- **PDF:** teknik raporun yerel PDF araçlarıyla oluşturulması.
- **Yerel çalışma:** modüle ait çalışma tarayıcı depolamasında tutulur; ölçüm olaylarına proje içeriği veya hesap değerleri eklenmez.

Yeni modülün raporu girdileri, birimleri, kaynakları ve varsayımları içermelidir. Ekrandaki görsel veya varsayılan senaryo, saha ölçümü/uygunluk onayı gibi adlandırılmamalıdır.

## Çevrimdışı kullanım ve sunucu bağlantıları

Site tek bir ortak `/sw.js` kullanır; VoltSim için ikinci bir service worker kurulmaz. Ziyaret edilen herkese açık sayfalar ve yerel statik varlıklar önbellek kuralları kapsamında çevrimdışı açılabilir. İlk kez açılacak her modülün çevrimdışı hazır olduğu varsayılmaz.

API, PHP, çalışan/hesap sayfaları ve özel dosya yolları önbelleğe alınmaz. Service worker'ı değiştirirken bu sınırları koruyun; genel site için performans iyileştirmesi özel verilerin saklanmasını gerektirmez.

GES ekranındaki PVGIS ve NASA POWER sorguları `/api/integrations.php` üzerinden PHP sunucusuna gider. Sağlayıcı dönemleri, birimler ve onaylanan sorgu girdileri sonuçla birlikte korunur. PVGIS'in nihai AC üretimine yerel kayıp veya inverter verimi ikinci kez uygulanmaz; NASA iklim ortalaması anlık hava tahmini sayılmaz.

Netlify yayını statiktir ve bu PHP uç noktasını çalıştırmaz. Manuel girdilerle yapılan simülasyonlar çalışır; sunucu verisi gerektiren özellikler PHP yayınına ve ilgili yapılandırmaya bağlıdır. API anahtarlarını modül JS'ine, proje JSON'una veya tarayıcı depolamasına eklemeyin. Yapılandırma ayrıntıları için `api/README.md` içindeki bağlantı bölümüne bakın.

## Yeni modül ekleme

1. Sabit bir modül `id`'si ve yayın `slug`'ı seçin. `tools/build-voltsim.cjs` kataloğuna başlık, açıklama, hizmet/kaynak bağlantıları ve gerekli ek hesap bağımlılıklarını ekleyin.
2. Temel hesap gerekiyorsa `engine.js` içinde, ek hesap/durum makinesi gerekiyorsa `calc/<id>.js` içinde DOM'suz fonksiyonlar oluşturun. Doğrulama, birim ve sınır koşullarını bu aşamada tanımlayın.
3. `mod/<id>.js` içinde `defaults`, `compute`, kontroller ve analiz görünümünü kaydedin. 2D görünümü ve WebGL'siz davranışı tanımlayın; 3D sahne yalnız doğrulanmış sonucu görselleştirsin.
4. En az dört geçerli senaryo ve dört görev ekleyin. Görevlerin benzersiz kimliği, hedefi ve ipucu olsun; başlangıç durumları görevi kendiliğinden çözmesin. Bu sözleşme `voltsim-tasks.test.cjs` tarafından denetlenir.
5. `identity.js` içine hesap kimliğini, birimleri, kaynakları, gerekli saha/katalog verilerini, varsayımları ve test bağlantılarını ekleyin. `reviewedWith`, ilgili motor sürümüyle uyumlu olsun. Mevzuat kaydı gerekiyorsa `regulations.js` içinde gerçek kaynak ve kapsamla ekleyin.
6. `tools/tests/voltsim-<id>.test.cjs` altında saf fonksiyon testlerini yazın. Bilinen sonuçlar, uç/geçersiz girdiler ve durum geçişleri için bağımsız beklentiler kullanın; yalnız uygulamanın formülünü test içine kopyalamayın.
7. Aşağıdaki derlemeyi ve uygun kontrolleri çalıştırın. Kaynaklarla birlikte üretilen yayın dosyalarını da sürümleyin; tarayıcı testleri devam ederken aynı dosyaları yeniden derlemeyin.

## Komutlar

Depo kökünden, kurulmuş proje bağımlılıklarıyla:

```text
npm run build:voltsim
npm test
node --test tools/tests/voltsim-engine.test.cjs tools/tests/voltsim-trafo.test.cjs
node --test tools/tests/calc-reference.test.cjs tools/tests/calc-edge.test.cjs tools/tests/calc-identity.test.cjs
node tools/tests/voltsim-browser.cjs trafo --no-pdf
node tools/tests/3d-lifecycle-browser.cjs --voltsim-only
```

`build:voltsim`, sayfaları üretir ve ortak kabuğu uygular. `npm test`, `tools/tests` altındaki bütün `*.test.cjs` dosyalarını; dolayısıyla VoltSim modül, motor ve görev testlerini de çalıştırır. Tarayıcı kontrolleri ayrı komutlardır; Playwright ve Chrome/Edge kurulumu gerekir. `--no-pdf` hızlı kontrol içindir; rapor değişikliğinde PDF akışını da çalıştırın.

Varlık sürümleri içerikten türetilir; Windows CRLF ve Linux LF farkları sürüm hesaplarında normalleştirilir. Tam yayın öncesinde depo kökündeki derleme/yayın yönergelerini izleyin ve `npm run sync:versions` ile başvuruların güncel olduğunu doğrulayın.
