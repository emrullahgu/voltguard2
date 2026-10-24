# VoltSim ve VoltGame 3D incelemesi

İnceleme tarihi: 23 Ekim 2026. Kapsam: `js/voltsim`, VoltSim sayfa üreticisi, VoltGame kaynak renderer/kare döngüsü/ses yaşam döngüsü ve yayımlanan oyun çıktıları.

## Bulgular ve tamamlanan işler

- [x] **GPU kaynak sızıntısı:** VoltSim sahnesinin yeniden kurulması eski geometri, material, texture, saydam kabuk kopyaları ve InstancedMesh kaynaklarını serbest bırakmıyordu. Kaynaklar tekrarları ayıklanarak temizleniyor; yeniden kurulum yeni bir yardımcı kit oluşturuyor. Bu yöntem GES ve trafo modüllerinin kit üzerinden sakladığı varlıkları da yeniliyor.
- [x] **Seçim sızıntısı:** Seçim kutusu her tıklamada yeniden üretilirken önceki kutunun GPU verisi tutuluyordu. Kutu kaldırılırken geometri ve material temizleniyor.
- [x] **Çizim tamponu maliyeti:** Sürekli `preserveDrawingBuffer` kaldırıldı. PDF/rapor görüntüsü, render ile aynı görev içinde alınmaya devam ediyor. Gereksiz deneme WebGL context'i de kaldırıldı.
- [x] **Çevre haritası:** PMREM üretiminde kullanılan geçici sahne kaynakları ve son render target için açık temizleme eklendi.
- [x] **Görünmeyen uygulamalar:** VoltSim uygulaması sayfa dışına çıktığında, sekme gizlendiğinde veya sayfa bfcache'e girdiğinde ana RAF iptal ediliyor. Dönüşte zaman sayacı sıfırlanıyor; gizli kalınan süre simülasyona atlamıyor. VoltGame iframe'i görünmediğinde oyun kareleri ve ses askıya alınıyor.
- [x] **Yüksek yenileme hızı / DPR:** Çizim işi yaklaşık 60 kare/s üst sınırına bağlandı. 90/120/144 Hz ekranlarda süreye bağlı hareket korunuyor. Framebuffer için masaüstünde yaklaşık 2,4 milyon, düşük kaliteli/mobil VoltSim ve mobil VoltGame'de yaklaşık 1,2 milyon piksel bütçesi getirildi. Boyut ve DPR değişmediyse renderer tekrar boyutlandırılmıyor.
- [x] **Düşük kaliteli oyun:** Telefonların düşük kalite başlangıcında gereksiz çoklu örnekli kenar yumuşatma kapatıldı.
- [x] **WebGL kesintisi:** VoltSim grafik bağlantısı kaybolduğunda hesaplar 2D şemada kullanılabilir kalıyor. Bağlantı döndüğünde 3D araçlar yeniden açılıyor. VoltGame geçici durum mesajı gösterip döngüyü durduruyor; geri geldiğinde shader'ları derleyerek mevcut oyuna devam ediyor.
- [x] **Gözlemci / olay temizliği:** VoltSim resize ve intersection gözlemcileri, dış olay dinleyicileri, bekleyen hesap/animasyon RAF'ları ve zamanlayıcılar için idempotent `dispose` eklendi. Son oturum verisi kapanışta kaydediliyor.
- [x] **Dokunmatik kontrol:** İki parmak hareketinden tek parmağa dönünce kalan işaretçinin konumu yeniden temel alınıyor; kamera sıçraması giderildi. Kayıp pointer capture da sürüklemeyi sonlandırıyor.
- [x] **Mobil 2D geri dönüşü:** WebGL durum mesajı şemanın üstüne binmek yerine ayrı alan kaplıyor. Mobil sekme etkin görünümü “2D Şema” olarak gösteriyor; o modda kullanılamayan 3D düğmeleri klavye sırasından da kaldırılıyor. Mobil görünüm araçları ve sekmeler en az 44 piksel dokunma hedefi kullanıyor.
- [x] **Kesilebilir patlatılmış görünüm:** Aynı düğmeye hızlı basıldığında paralel animasyonlar oluşması engellendi.
- [x] **Hareketi azalt tercihi:** İşletim sistemindeki değişiklik çalışma sırasında okunuyor. Kamera ataleti ve enerji parçacığı hareketleri duruyor; RES ana/park rotorları tercihe uyuyor. Yangın simülasyonunda normal dedektör LED'leri de bu tercihte sabit görünüyor.
- [x] **Kare başına atık:** Etiket vektörü ve şarj simülasyonunun renk nesnesi tekrar kullanılıyor. Yangın duman dokusu aynı grid için tekrar taranmıyor; toplam yoğunluğu aynı kalan farklı dağılımlar da doğru yeniden çiziliyor.
- [x] **Önbellek tutarlılığı:** VoltSim sayfa üreticisi, sabit bir tarih yerine CSS/çekirdek/hesap/modül kaynaklarından içerik hash'i üretiyor. Değişen kaynaklar yeni varlık URL'si alıyor.
- [x] **Dağıtım:** VoltGame aynı kaynaklardan barındırılan HTML, kendi kendine yeten çevrimdışı HTML ve sürüm manifesti olarak yeniden derlendi. Derleyicinin bütün seviye doğrulaması geçti: 27 kampanya, 37 günlük bulmaca; JS 472,9 KB / 500 KB bütçe.

## Doğrulama

- VoltSim hesap, modül senaryosu ve görev testleri: **127/127 geçti**.
- İlk standart tarayıcı turunda pano, GES ve motor/otomasyon: masaüstü 3D, senaryo/görev, kontrol değişimi, 2D, proje kaydet/yükle, CSV ve mobilde yatay taşma kontrolleri geçti.
- Aynı standart pakette kompanzasyon, RES, şarj istasyonu ve topraklama da geçti. Kalan geniş tur, ana incelemenin tüm sayfa taramasıyla aynı anda makineyi zorladığı için ana görevle koordine edilerek durduruldu; bu tur için on sayfanın tümü geçti iddiası yoktur. Pano PDF üretimi ayrıca geçti.
- Gerçek WebGL tekrar kurulum testinde sekiz kurulum ve otuz ekipman seçimi sonrasında pano **83 geometri / 7 texture**, GES **62 / 17**, trafo **84 / 12** değerlerinde sabit kaldı. Eski seçim yardımcıları bellek sayısını artırmadı.
- DPR 3 ortamında bu üç sahnenin framebuffer boyutu **2.249.600 piksel**; bütçe içinde. JPEG snapshot'lar dolu ve görünür görüntü içerdi. Pano WebGL kesintisi → 2D → geri yükleme ve çalışma sırasında hareket tercihi değişimi geçti.
- Ek yaşam döngüsü regresyonu: `node tools/tests/3d-lifecycle-browser.cjs`. Standart VoltSim tarayıcı paketi: `node tools/tests/voltsim-browser.cjs --no-pdf`. VoltGame paketi: `node tools/tests/voltgame-browser.cjs --skip-narrow`.
- VoltGame yayımlanmış artefakt testleri **5/5 geçti**. Tam işlev tarayıcı paketi; 27 kampanya/37 günlük içerik, CSP altında Worker ve ipucu, kazanma/geri al/yinele/kayıt, paylaşım, tam ekran geri dönüşü ve çevrimdışı indirmeyi doğruladı.
- Yaşam döngüsü testinin son oyun ve fallback turu geçti: görünmeyen iframe'de kare sayısı sabit; görünürken devam ediyor; context kaybı/geri yükleme çalışıyor. WebGL kapalı 390 piksel mobil panoda geçerli hesap/2D, yatay taşma **0 piksel**, durum mesajı ile şema örtüşmesi **0 piksel**. Kanıt: `.qa/3d-lifecycle/report.json`, `.qa/3d-lifecycle/fallback-mobile.png`, `.qa/voltgame/functional-report.json`.

## Sınırlar

Tarayıcı kontrolleri izole Chrome profili ve SwiftShader ile yapılır; kullanıcının kayıtlarına veya canlı sisteme yazmaz. Bunlar işlev, kaynak yaşam döngüsü ve yerleşim regresyonlarıdır; her fiziksel telefonda sabit FPS garantisi veya uzun süreli termal/batarya ölçümü değildir. Gerçek cihazlarda GPU sürücüsü, düşük bellek ve termal kısma koşullarına ilişkin saha ölçümleri ayrıca gerekir.

Simülasyon hesapları için mevcut eğitim/ön değerlendirme kapsamı korundu. Bir görsel modelin çalışması; yetkili proje, üretici seçicilik tablosu, akredite test veya mevzuata uygunluk belgesi yerine geçmez. Bu inceleme bir sertifikasyon beyanı değildir.
