# Çalışan uygulaması ve mühendislik araçları incelemesi

Tarih: 23 Ekim 2026. Bu rapor `tools/staff-app/` ve `tools/engineering/` kapsamındaki kaynak, veri aktarımı, hesap ve üretim çıktısı kontrollerini kaydeder. Gerçek personel, bordro, müşteri ve sayaç kayıtları okunmadı; canlı Ubuntu sunucusuna işlem gönderilmedi. Çalışan kimliği ve kalıcı kayıtların mevcut PHP şirket API'sinden geldiği doğrulandı. `supabaseClient.js` eski arayüzle uyumluluk sağlayan bu API istemcisidir; yeni bir bulut veri kaynağı kurulmadı.

## Öncelikli bulgular ve tamamlanan işler

| Öncelik | Bulgu | Yapılan düzeltme |
| --- | --- | --- |
| P1 | OSOS son 20 kaydı tesis ve sayaç ayrımı yapmadan tek grafik gibi gösteriyordu. | Tesis/sayaç seçimi ve sunucuda iki alana göre filtre eklendi. Aynı tesisin farklı sayaçları ve sayaç numarası olmayan kayıtları ayrı tutuluyor. Son 1.000 kayıtta olmayan eski bir kaynak da tesis/sayaç bilgisiyle aranabiliyor. |
| P1 | Sorgular 5 saniyelik sabit aralıkla üst üste binebiliyor, sekme kapansa da çalışabiliyordu. | Bir sorgu tamamlandıktan sonra zamanlanan yenileme eklendi. Görünmeyen sekmede yeni sorgu başlatılmıyor; kaynak değişince eski yanıt yeni kaynağı değiştiremiyor. Başarısız yenilemede mevcut ölçümler korunuyor. |
| P1 | Yanlış yazılmış binlik ayraçları geçerli paraya dönüşebiliyor, farklı fiyatlı/KDV'li aynı adlı keşif ürünleri birleşebiliyordu. | Sayı grupları doğrulanıyor. Kalemler kimlik, birim, fiyat, vergi ve açıklaması aynıysa birleşiyor. Negatif miktar ve hesap taşması açık hatayla reddediliyor. |
| P1 | `reactive` veya `11.8.0`, yanlışlıkla aktif enerji kabul edilebiliyordu. | Enerji türü ve OBIS sınırları tam eşleştiriliyor. Birden çok kategori içeren belirsiz satır otomatik sınıflanmıyor. |
| P1 | Geçersiz çarpan 1'e düşebiliyor; aynı zamanlı endeksler ve taşan endeks çarpımı gerçek tüketim gibi işlenebiliyordu. | Bozuk çarpan/endeks/tüketim, tekrarlanan zaman, negatif endeks ve sayısal taşma reddediliyor. Tek endeksle tüketim hesaplandı izlenimi verilmiyor. Anlık ölçüm dosyasında aynı sayaç/zaman tekrarına da izin verilmiyor. |
| P1 | Mühendislik proje içe aktarımında fiziksel olarak geçersiz değerler mevcut formu değiştirebiliyordu. | 18 ortak modelde bütün gelecek girdiler önce hesap çekirdeğinde doğrulanıyor; başarısız projede mevcut form ve sonuç korunuyor. |
| P1 | Projedeki ikinci, skaler alan kopyası doğrulanmış modelin üzerine yazıp ekrandaki sonuçla girdiyi farklılaştırabiliyordu. | Yerel model adaptörü varsa doğrulanmış model esas alınıyor; ikinci kopyayla üzerine yazılmıyor. Çevrimdışı proje açma hatası da durum alanında açıklanıyor. |
| P2 | Eksik OSOS değerleri kırmızı alarm rengiyle gösteriliyor; gerilim grafiği sabit 200–250 V aralığıyla çiziliyordu. | Eksik değer nötr, ölçüm dışı değer uyarı rengiyle gösteriliyor; gerilim ekseni gerçek veriye göre ölçekleniyor. Doğrusal ve animasyonsuz grafik kullanılıyor. Tek anlık değerden kompanzasyon tavsiyesi çıkarılmıyor. |
| P2 | Her şirket modülü ve PDF/Word kitaplıkları ilk açılışta indiriliyordu. | 11 modül ihtiyaç halinde yükleniyor. PDF, tablo PDF, HTML ekran yakalama ve Word kitaplıkları yalnız çıktı istendiğinde yükleniyor. Erişilebilir yükleme durumu eklendi. |
| P2 | Sunucu sağlık kontrolü genel bir HTTP 200 HTML sayfasını sağlıklı şirket API'si sayabiliyordu. | API kimliği, JSON sözleşmesi ve çevrimiçi alanı doğrulanıyor. Sağlık sorgularında çakışma, arka plan döngüsü ve ayrılmış bileşene geç yanıt önlendi. |
| P2 | İçe aktarmada başlıklar her satır için tekrar tekrar yerel harf dönüşümünden geçiriliyordu. Büyük dosyalar donma yaratıyordu. | Başlık takma adları önbelleğe alındı; Türkçe harf eşleştirmesi hafifletildi. 150.000 satırlık regresyon dosyası yayma operatörünün çağrı yığını sınırına çarpmadan hesaplanıyor. |
| P3 | Yapılandırılmamış bağlantı için etkinmiş izlenimi veren düğmeler ve eski demo/CORS açıklamaları bulunuyordu. | Ölçüm izlemedeki kullanılamayan bağlantı düğmeleri kaldırıldı; kaynak ve ölçüm kapsamı sade mesleki dille anlatıldı. Teknik sunucu işletim sistemi kullanıcı etiketinden çıkarıldı. |

## Üretim paketi karşılaştırması

`node tools/build-company.cjs` başarılı. Yetkilendirilmiş PHP uygulama/varlık kapısı korundu; eski derlenmiş varlıklar build tarafından temizlendi.

| Ölçüm | Önce | Sonra | Azalma |
| --- | ---: | ---: | ---: |
| Ana şirket uygulaması JS parçası | 2.694,16 kB | 747,37 kB | %72,3 |
| Aynı parçanın gzip boyutu | 746,77 kB | 229,77 kB | %69,2 |

İlk React giriş parçası yaklaşık 156,66 kB / 51,19 kB gzip olarak kaldı. Rapor, grafik ve operasyon modülleri kendi gerektiğinde yüklenen parçalara ayrıldı. Bu değerler yerel Vite build çıktısıdır; canlı ağ gecikmesi veya tüm site Core Web Vitals ölçümü değildir.

## Doğrulama

- Mühendislik araçları + çalışan hesap/üretim/istemci regresyonları birlikte: 101 test geçti. Buna önceki 89 mühendislik kontrolü, iki yeni proje aktarım kontrolü ve çalışan testleri dahildir; istemci dosyası kendi içinde 64 sözleşme kontrolü yapar.
- Son kaynak düzeltmeleri sonrası çalışan hesap/üretim/istemci ve yeni mühendislik aktarım testleri: 12 test geçti.
- Son üretim build'i ve ortak menü eşitlemesi sonrası özel uygulama yetkilendirme/derlenmiş varlık/SEO dışlama ve shell kontrolleri dahil 15 test geçti.
- Yeni regresyonlar: bozuk para grupları, fiyat/KDV/birim farkları, taşma, OBIS kategori karışması, tek/tekrarlı endeksler, bozuk çarpan, 150.000 satır enerji hesabı, tesis/sayaç ayrımı, eksik ölçümler, HTML sağlık yanıtı, hatalı mühendislik projesinde mevcut formun korunması.
- Tarayıcı fixture testi yeni tesis/sayaç seçimi ve sade kullanıcı etiketlerine güncellendi. Bu ajan tarayıcı testi başlatmadı; makine yükü nedeniyle son bütünleşik tarayıcı doğrulaması kök görevde sıralı yürütülür.

## Açık sınırlar ve takip listesi

- [x] Yanlış ölçüm birleştirme ve yanlış başarılı içe aktarım nedenleri düzeltildi.
- [x] Başlangıç indirmesi küçültüldü; kaynak ve üretim çıktısı eşitlendi.
- [x] Yeni hesap/veri ayrımı regresyonları ve mevcut özel erişim kontrolleri geçti.
- [ ] Son bütünleşik tarayıcı çalıştırmasında 320/390 px modüller, OSOS sayaç geçişi ve ertelenmiş PDF/Word/Excel çıktıları birlikte doğrulanmalı. Kök görevin son doğrulama adımıdır.
- [ ] Harici OSOS/KOSBİ otomatik veri toplama hizmeti mevcut kurulumda yapılandırılmamış. Gerçek dosya ve şirket kayıtları çalışır; otomatik veri toplama tamamlanmış olarak sunulamaz. Gerçek servis sözleşmesi/erişim bilgisi olmadan bağlantı uydurulmadı.
- [ ] Mevcut 2026 ücret tabloları ve rapor eşikleri bu değişiklikle yeni mevzuat/standart onayı kazanmış değildir. Kontrol raporunda uzman değerlendirmesi ve ölçüm bağlamı korunur. Yürürlükteki tarife sürümü ve saha test kapsamı yayın öncesi işletme tarafından eşleştirilmelidir.
- [ ] Üretim verisinin yedekten geri dönüşü, gerçek cihaz bağlantısı ve canlı yetki matrisi yalnız yetkilendirilmiş dağıtım ortamında uçtan uca doğrulanabilir; bu çalışma canlı kayıtlara yazmadı.
