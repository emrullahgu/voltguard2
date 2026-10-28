# VoltGuard web sitesi

VoltGuard kurumsal sitesi; hizmet sayfaları, bilgi bankası, akademi, 17 mevcut hesaplayıcı, mühendislik form kütüphanesi ve PHP üyelik sistemi içerir. `voltguardekleyelim` içindeki 51 açık erişimli mühendislik uygulaması aynı siteye `/araclar/` altında eklenmiştir.

## Çalıştırma ve kontrol

Node.js 24 veya üstü ile, proje kökünde:

```text
npm run setup:staff
npm ci --prefix tools/saha-app --ignore-scripts --no-fund
npm run setup:game
npm run build
npm test
npm run preview
```

Önizleme: `http://127.0.0.1:4173/araclar/`. Statik sayfalar, araçlar ve gerçek yayın güvenlik politikasıyla çalışır. PHP bulunduğunda üyelik, topluluk ve çalışan API'leri aynı adreste etkinleşir; `VG_PHP` ile PHP çalıştırıcısının tam yolu belirtilebilir. Bu cihazdaki doğrulanmış PHP çalıştırıcısı `.qa/php/runtime/php.exe` altındadır ve Git'e dahil değildir. PHP yoksa özel bölüm erişimi kapanır. İletişim formu canlı PHP sunucusu gerektirir. `npm run test:browser` Playwright ve Chrome bulunan ortamda araç tarayıcı kontrollerini çalıştırır.

Windows önizlemesinin üyelik, topluluk, çalışan hesabı ve özel PDF kayıtları `%LOCALAPPDATA%/VoltGuard/preview-data/<proje-özeti>` altında, web kökünün dışında tutulur. Şirket uygulaması Ubuntu bağlantısı yapılandırıldığında mevcut merkezi iş verilerini kullanır; bu bölümde yapılan gerçek kayıt değişiklikleri Ubuntu veritabanına yazılır. Testler ayrı geçici dizinler ve izole sentetik veritabanları kullanır; gerçek kullanıcıya, bordroya veya operasyon kaydına demo veri eklemez. Gerçek ilk yönetici daveti özel terminalden oluşturulur; kurulum için `api/STAFF.md` dosyasına bakın.

## Dosya düzeni

- `index.html`, `hizmetler/`, `bilgi/`, `akademi/`, `hesaplama/`, `mm/`: mevcut kurumsal sayfalar.
- `ekibimiz.html`: ana menü, kurumsal alt menü ve ana sayfadan ulaşılan fotoğraflı ekip ve çalışma ağacı. Yayın için seçilen portreler `public/ekibimiz/` altında bulunur; `vesikalar/` içindeki ham kaynaklar yayımlanmaz.
- `voltgame.html`, `public/voltgame/`: VoltGame içindeki tam PARALAKS: Tek Hat oyunu, siteye uyarlanmış yayın dosyaları ve tek dosyalık çevrimdışı indirme.
- `tools/voltgame/`, `tools/build-voltgame.cjs`: oyunun seçilmiş kaynakları ve doğrulamalı derlemesi. Özgün `VoltGame/` klasörü korunur; web erişimine kapalıdır ve yayımlanmaz.
- `tools/shell/`: ortak başlık, menü ve altbilgi kaynakları; `python tools/shell.py` ile mevcut sayfalara uygulanır.
- `api/`: PHP üyelik ve hesap verisi API'si; kurulum ve depolama ayrıntıları `api/README.md` içindedir.
- `topluluk.html`, `api/community.php`: herkesin okuyup üyelik olmadan yorum ve yanıt yazabildiği bölüm. Moderatör kurulumu `api/COMMUNITY.md` içinde.
- `calisan/`, `api/staff.php`: davetli çalışan sistemi, zorunlu doğrulayıcı uygulama, kişiye özel bordro ve PDF erişimi. `api/STAFF.md` kurulum ve yetkileri açıklar.
- `tools/staff-app/`, `tools/saha-app/`, `tools/employee-modules.json`, `calisan/uygulama/`, `api/company.php`: tek çalışan portalının kaynakları, ortak modül/rol kataloğu ve korumalı yayını. Kaynak modüller 37 iş alanında birleştirilir; eski projenin ayrı uygulaması, menüsü veya iframe'i açılmaz. `api/lib/company-ubuntu.php` özel SSH bağlantısını, `tools/ubuntu-company-bridge.py` mevcut şirket verilerini, `tools/ubuntu-saha-source.py` ise mevcut saha iş tablolarına canlı erişimi sağlar. `tools/saha-source-schema.json`, PHP alan izinlerinden üretilen şema bildirimidir; iş verisi içermez. `api/COMPANY.md` kurulum ve yetkileri, `tools/staff-app/FEATURES.md` kaynak özelliklerinin envanterini açıklar.
- `tools/engineering/`: yeni araçların düzenlenebilir, seçilmiş kaynakları, kaynak/lisans kayıtları ve regresyon kontrolleri.
- `tools/build-engineering.cjs`: kaynakları derler, ana alan adına ve düz araç yollarına uyarlar; yayın dosyalarını ve çevrimdışı ZIP paketini üretir.
- `araclar/`: doğrudan yayınlanabilir çıktı. Bu klasördeki değişiklikleri kaynak tarafında yapıp yeniden derleyin.
- `voltguardekleyelim/`: orijinal aktarım; bağımsız Git geçmişi ve şirket operasyon dosyaları içerdiği için ana depoda ve yayında kullanılmaz.

## Referanslarımız ve kurumsal logo

Ana sayfadaki `/#referanslar` bölümünde DİMES, ROKETSAN, TUSAŞ, TÜBİTAK, Ege Üniversitesi, ERDEMİR, VESTEL, HABAŞ ve EKTAM gösterilir. Referans listesi kullanıcının sağladığı kurum adlarına dayanır; kurumların resmî siteleri yalnızca özgün logoların kaynağıdır. DİMES için yalnızca kurum adı ve logo yayımlanır; hizmet anlatımı veya şirket içi rapor verileri eklenmez. Logolar `public/referanslar/` altında, kaynak adresleri ve dosya doğrulama bilgileri `tools/reference-logos.json` içinde tutulur.

Ortak menü ve altbilgi, `public/logo.png` içindeki özgün VoltGuard ambleminin web için hazırlanan `public/voltguard-logo.webp` sürümünü kullanır. Referans logoları özgün renk ve oranlarıyla sunulur.

## VoltGame

`/voltgame.html` adresindeki eski mini oyun, PARALAKS: Tek Hat R1 ve fiziksel kural sürümü 4 ile değiştirilmiştir. 27 kampanya seviyesi, 37 günlük bulmaca, iş emirleri, Tek Hat şeması, ipuçları, geri al/yinele, hareket defteri, meydan okuma ve hayalet kodları, ses, kalite ve erişilebilirlik ayarları birlikte korunur. İlerleme yalnızca tarayıcıdaki `paralaks2.kayit` kaydında tutulur; üyelik gerektirmez.

Oyun site menüsünün altında kendi alanında çalışır; tam ekran düğmesi desteklenmeyen cihazlarda sayfayı büyütür. `?lvl`, `?daily`, `?kalite` ve `#PX2-…` bağlantıları oyuna aktarılır, paylaşım adresleri `/voltgame.html` üzerinden açılır. Site renkleri, gerçek logo ve yerel yazı tipleri kullanılır. Çözücü aynı kökenden `/public/voltgame/solver-worker.js` dosyasını yükler; sitenin güvenlik politikası genişletilmez. İndirilen tek HTML dosyası grafik bileşenini, seviyeleri ve çözücüyü içerdiği için ilk açılışta internet gerektirmez.

`npm run build:game` tüm seviyeleri doğrulayıp yayın ve indirme dosyalarını yeniden üretir. `npm test` yayın bütünlüğünü ve gerçek çözücüyü, `npm run test:game-browser` ise ayrı geçici tarayıcıda güvenlik politikası, oyun akışları, kayıt, paylaşım, mobil düzen ve çevrimdışı dosyayı kontrol eder. Kaynak kayıtları `tools/voltgame/provenance.json`, yayın bilgileri `public/voltgame/release.json` içindedir. İlk kaynak performans ölçümlerinin sınırları `tools/voltgame/UPSTREAM-README.md` dosyasında korunur.

## Netlify yayını

`netlify.toml`, Node 24 ile `tools/build-netlify.cjs` dosyasını çalıştırır ve `.netlify-publish/` klasörünü yayımlar. Derlenip kontrol edilmiş, Git'teki statik çıktılar kullanılır; oyunun dosya boyutları ve çözücü özeti yayın öncesinde doğrulanır. PHP, çalışan uygulamasının özel dosyaları, geliştirme kaynakları, ham aktarımlar ve yerel test verileri bu klasöre kopyalanmaz. Bu deponun bağlı projesi `voltguard2.netlify.app`, üretim dalı `main`'dir. Çalışan hesabı, topluluk yazımı ve iletişim formu PHP sunucusu gerektirir; Netlify bu işlevleri çalıştırmaz.

## Entegrasyonda alınan kararlar

51 araç `/araclar/<arac-adi>/` adreslerinden açılır. Kategori ve metin araması, yerel favoriler, PDF rapor, JSON proje yedeği ve çevrimdışı HTML/ZIP indirme özellikleri korunur. ENH, AG/OG dağıtım, GES, motor, devre, sinyal/RF, PCB ve sembol/şema araçları aynı katalogda bulunur. Kaynak ve yöntem açıklamaları ile lisans bildirimleri araçlarla birlikte yayınlanır.

Mevcut `/hesaplama/` ve `/hesaplama-araclari/` adresleri korunur. Ana menü, Mühendis Merkezi ve Hesap Araçları sayfasından yeni kataloğa ulaşılır. Canonical ve sosyal paylaşım adresleri `https://voltguard.com.tr/araclar/` temelini kullanır; araç sayfaları kök site haritasına eklenir.

Yeni araçların proje durumu ve favorileri tarayıcıda saklanır. Bu veriler mevcut PHP hesabına otomatik aktarılmaz; JSON veya HTML indirmeleriyle yedeklenebilir. Mevcut hesaplayıcıların hesap senkronizasyonu kendi sistemiyle devam eder.

Orijinal aktarımın şirket uygulaması, operasyon dosyaları, arşivleri ve özel sunucu bağlantısı açık erişimli araç paketine dahil edilmemiştir. Bu sitede sıfırdan kurulan yeni çalışan sistemi bağımsız `VGSTAFF` oturumu ve web kökü dışındaki `staff/` deposunu kullanır; herkese açık üyelik çalışan yetkisi vermez. Kullanıcı şifresini tek kullanımlık, 24 saat geçerli davet bağlantısından belirler ve doğrulayıcı uygulamasını bağlar. Herhangi bir varsayılan şifre veya örnek bordro bulunmaz.

## Şirket çalışanı uygulamaları

`/calisan/` panelinden **Çalışan uygulamalarını aç** bağlantısı ile `/calisan/uygulama/` adresine ulaşılır. Teklif ve keşif-metraj, GES, görev/iş/ürün takibi, akaryakıt, OSOS dosya raporları, haftalık enerji raporları, periyodik kontrol, mavi ve beyaz yaka bordro, profil ve çalışan yönetimi birlikte çalışır. İş verileri mevcut Ubuntu/PostgreSQL veritabanından, fatura ürünleri, kablo fiyatları ve hazır paketler Ubuntu’daki özel katalog dosyalarından alınır; tarayıcı paketine veya Git’e gerçek fiyat satırları gömülmez.

Varsayılan `?module=uygulamalar` ekranı 37 iş alanını aranabilir, kategorili kartlarla sunar. Müşteriler, iş emirleri, stok, filo, ofis, takvim ve diğer iş alanları aynı **Modüller** menüsünden doğrudan açılır; aynı alandaki eski ve yeni işlevler bölüm sekmelerinde birlikte bulunur. Katalogdaki 61 ekran girişi tüm 46 modül merkezini ve `Employees` personel listesini kapsar. `?module=musteriler&bolum=liste` gibi bağlantılar seçili iş alanını ve bölümünü korur. Görünür modüller, bölümler ve izinler `tools/employee-modules.json` kataloğundan gelir. Farklı kaynaklardaki kayıtlar ada, plakaya veya benzer tablo adına göre otomatik birleştirilmez. Personel ve hesap bağlantıları bölümü mevcut personel detayındaki ücret, puantaj ve açık hesap eşleme akışını kullanır. Kurulmamış yapay zekâ bağlantısı görünür bir çalışma modülü gibi sunulmaz.

Aktarılan ekranlar mevcut sayfanın DOM'unda açık bir ShadowRoot içine bağlanır; iframe, ikinci oturum ve eski projenin ayrı giriş/ana menü kabuğu kullanılmaz. `EmployeeModule.jsx` doğrulanmış özel modül varlıklarını yükleyip seçili ekranı açar; stiller mevcut siteyi etkilemeden ayrılır. Eski `/calisan/uygulama/saha.php` adresi çalışan doğrulamasından sonra uygulama kartlarına yönlenir. Runtime dosyalarının listesi yalnız oturum ve MFA gerektiren `/api/company.php?action=module_assets` üzerinden alınır; ham manifest webden okunamaz.

Aktarılan operasyon modülleri, Ubuntu’daki `sb-sahatakip-db` konteynerinin mevcut izinli `public` iş tablolarını `tools/ubuntu-saha-source.py` üzerinden doğrudan okur ve günceller. Müşteri, iş emri, teklif ve teklif satırları için ayrı bir başlangıç aktarımı veya yeni boş veri deposu kullanılmaz. Kaynakta bulunmayan kayıtlar, ortak modül kayıtları, özel dosyalar ve tercihler aynı veritabanının `voltguard_site` özel şemasında tutulur. Eski Auth hesapları ve profil kayıtları yeni çalışan sistemine kopyalanmaz; native profilin UUID/rol izdüşümü ve kaynak ilişkisine bağlı özel kimlik eşlemeleri korunur. `app_saha_*` adları ve depo anahtarları görünen menüden bağımsız veri sözleşmesidir.

İzinli şema 72 koleksiyondur. Kaynakta bulunmayan `visits`, özel uzantıda tutulur; ziyaret giriş/çıkışı ve `location_checkins` olayları tek sunucu işleminde kaydedilir. Aktif ziyaret yeniden açılışta yüklenir; sahiplik, sürüm karşılaştırması ve tekrar gönderim denetlenir. Ekipman, enerji ölçümü, satış ziyareti, form yanıtı ve araç akışları reddedilen sunucu yazmasını önbellek başarısına çeviremez; okuma hatası boş veri sayılmaz.

Operasyon kayıtları şirket çalışanları arasında paylaşılır. Normal çalışan kendi bordrosunu okur; yönetici ve bordro sorumlusu bordroları yönetir. Hesap açma/yetki verme yalnızca yöneticidedir. Özel uygulamanın HTML, JavaScript, logo ve yazı tipleri dahil bütün dosyaları çalışan oturumu ve tamamlanmış doğrulama gerektirir. Bu bölüm çevrimdışı önbelleğe girmez.

Ubuntu bağlantısı PHP sunucusundan imzalı HTTPS veya özel SSH üzerinden yapılır; anahtar, bağlantı ayarı ve veritabanı yetkisi tarayıcıya gönderilmez. Davet, şifre, zorunlu MFA, çalışan yetkileri ve `/calisan/` panelinin özel PDF deposu yeni site sisteminde kalır. Eski Supabase hesabı yeni çalışan hesabı yerine kullanılmaz. Eski personel kaydını yeni çalışan hesabına yalnızca yetkili bordro yöneticisi açıkça bağlayabilir; e-posta veya ad benzerliği bordro erişimi vermez.

Ubuntu modu yapılandırılmışken bağlantı hatası yerel boş kayda geçiş yapmaz; uygulama hatayı bildirir ve kayıt başarısı göstermez. Yerel dosya deposu yalnızca ayrı, açıkça yerel kurulmuş ortamlar ve sentetik testler içindir. Ubuntu’daki kayıtlarda sürüm karşılaştırması ve atomik işlemler eski uygulamada aynı anda yapılan değişikliklerin ezilmesini önler.

Dosya içe aktarma çalışır. Canlı OSOS/KOSBİ collector ve WorkTracker bağlantıları servis kurulana kadar kapalıdır; merkezi Ubuntu veritabanını kullanmak bu harici servisleri açmaz. Teklif/e-posta yardımları düzenlenebilir şablonlardır. Kaynakta etkin olan PDF, Word, Excel, HTML ve yazdırma akışları korunur. Bordro, avans ve belge kayıtları sürüm çakışması ve tekrar gönderim kontrolleriyle kaydedilir.

`npm run setup:staff` kilitli bağımlılıkları kurar. `npm run test:staff-browser` giriş, modül yerleşimleri, dosya çıktıları ve gerçek PHP üzerinde kayıt akışlarını geçici sentetik verilerle kontrol eder. Ubuntu bağlantısının SQL kontrolleri yalnızca ayrı, `vg_bridge_qa_` önekli boş test veritabanında sentetik kayıtlarla çalıştırılır. Gerçek yönetici hesabına veya bordrolara test kaydı yazılmaz. Özel bağlantı, katalog ve yerel kurulum ayrıntıları `api/COMPANY.md` içindedir.

## Yayın

`npm run build` çıktısı `araclar/` ve korumalı `calisan/uygulama/` altında tutulur ve cPanel yayın listesine eklenmiştir. cPanel'deki yayın işlemi hazır statik çıktıyı kopyalar; sunucuda Node kurulumu gerektirmez. Araç kaynakları değiştiğinde çıktıyı yeniden üretip kaynak ve yayın dosyalarını birlikte sürümleyin.

Apache/LiteSpeed yönlendirmeleri `.htaccess`, Netlify karşılıkları `netlify.toml` içindedir. Dizinlerin `index.html` adresleri sonu `/` olan canonical adrese yönlenir. `tools/` ve orijinal aktarım klasörü doğrudan web erişimine kapalıdır. Netlify PHP çalıştırmadığı için üyelik, topluluk, iletişim ve çalışan bölümü için cPanel/PHP kurulumu gerekir. Çalışan hesabı ve PDF verileri web kökünün dışındaki özel dizinde bulunmalı; canlı sunucuda ilk yönetici ayrıca kurulmalıdır. Yerel davet ve oturumlar canlı sunucuya taşınmaz.

Ubuntu verilerini kullanan cPanel için özel `company/ubuntu.json` sürüm 2, PHP'den imzalı HTTPS köprüsünü seçer; `proc_open`, SSH veya Tailscale istemcisi gerektirmez. Yalnız loopback dinleyen `tools/ubuntu-company-http.py`, mevcut HTTPS ters vekilindeki tam bir yoldan erişilir; imza, zaman, kalıcı nonce ve sabit yardımcı/yetki denetimleri kullanılır. Mevcut SSH sürüm 1 ayrıca korunur; bu taşıma için yayın sunucusunda SSH ve doğrulanmış `known_hosts` gerekir. Geliştirme bilgisayarının bağlantı ayarı cPanel'e kendiliğinden taşınmaz. Kaynak modüllerinde canlı bağlantı ayarı yoksa boş yerel kayıtlar gösterilmez. Özel bağlantı dosyası web kökünün dışında tutulur ve site dosyalarıyla yayımlanmaz. Kurulum ve doğrulama `api/COMPANY.md` içindedir.

Operasyon modüllerinin PHP API, Ubuntu yardımcıları ve alan şeması uyumlu tutulur; mevcut `config.json`, `saha-config.json`, katalog yolları ve PHP `helper`/`site` değerleri korunur. Kaynak yardımcısının adı `saha_store.py` olarak kalır. Mevcut kuruluma 72. ziyaret koleksiyonunu ekleyen güncelleme yalnız güncel `company_store.py` ve `saha-source-schema.json` dosyalarını doğrulanmış özet ve yedekle değiştirir; SQL kurulumu veya gerçek kayıt yazımı gerektirmez. Ayrıntılı kurulum `api/COMPANY.md` içindedir. Netlify bu özel dosyaları yayımlamaz; çalışan portalı cPanel/PHP sunucusunda çalışır.

Yeni araçlar mevcut kök `sw.js` önbelleğini kullanır; ikinci bir service worker kurulmaz. PDF ve Excel bağımlılıkları yereldir, uzak Google Fonts çağrıları kaldırılmıştır. Araçların mühendislik yöntemleri ve geçerlilik sınırları `/araclar/yontem/` sayfasında açıklanır.

Yeni bölümün tüm 55 sayfası sitenin gerçek ortak menüsünü, özgün VoltGuard amblemini (`public/voltguard-logo.webp`) ve altbilgisini kullanır. Lacivert/kehribar renkleri, Outfit başlık ve Inter metin yazı tipleri, kartlar, düğmeler ve form alanları mevcut siteyle eşleştirilmiştir. Araçların özgün stilleri `#vg-tool-workspace` içinde sınırlandırılır; ortak menüye sızmaz. `assets/host-theme.css` ortak görsel düzeni uygular. Çevrimdışı ZIP aynı yerel yazı tiplerini ve menü varlıklarını içerir; PDF raporlarına site menüsü eklenmez.

## Entegrasyon doğrulaması

13 Ekim 2026 kontrolünde 103 otomatik hesaplama, aktarım, lisans, stil yalıtımı ve entegrasyon testi geçti. 51 araç gerçek yayın CSP başlığıyla tarayıcıda açıldı; yerel varlıklar, arama, kategori filtreleri ve kalıcı favoriler kontrol edildi. Tüm 55 mobil sayfanın menü, yazı tipi, renk ve taşma kontrolleri geçti. Köşk ayar çekmecesinin açılıp kapanması ve Kablo Kanal Planı sekmelerinin ortak görünümü koruması ayrıca doğrulandı. JSON kaydetme/geri yükleme, PDF, Excel ve DXF indirmeleri doğrulandı; tek dosyalık HTML ağ erişimi kapalıyken yeniden açılıp proje verisini geri yükledi.

İki ardışık derleme yayın dosyalarını, çevrimdışı ZIP'i ve site haritasını birebir aynı üretti. Bu kontroller yayın sunucusunda bir dağıtım veya tüm mühendislik standartlarının bağımsız doğrulaması anlamına gelmez; hesap yöntemlerinin sınırları araç sayfalarında korunur.

İkon altkümesi de günceldir. Mevcut varlık denetiminin `--strict` seçeneği, `services.css` içindeki ok ve onay ikonlarını regular fontta da aradığı için iki uyarı üretir. Bu seçiciler solid fontu (`font-weight: 900`) kullanır ve ilgili glyph'ler solid altkümede vardır; bu entegrasyonda ikon dosyaları değiştirilmemiştir.

## Topluluk ve çalışan doğrulaması

`npm test` araç testlerine ek olarak gerçek PHP sunucusunda topluluk, çalışan ve önizleme bağlantısı testlerini çalıştırır. `VG_PHP` yoksa bu testler doğrulanmış yerel `.qa/php/runtime/php.exe` yolunu kullanır; başka cihazlarda PHP kurulmalıdır. Testler üyelik ile çalışan yetkisinin ayrımını, misafir yorum sahipliğini, CSRF/Origin, davet süresi ve tek kullanımı, zorunlu MFA, kod tekrarını, başka çalışanın bordrosuna/PDF'ine erişim reddini, kapatılmış oturumu, hız sınırını ve bozuk/yanlış konumlanmış özel depoda erişimin kapanmasını denetler.

`node tools/tests/staff-browser.cjs` davet/şifre/doğrulayıcı, yönetici ve çalışan ekranlarını ayrı fixture verileriyle kontrol eder. Bu veri, önizleme veya canlı kayıt değildir. Anonim kullanıcı veya sadece genel üye oturumu `/calisan/` ve özel PDF'leri açamaz. Çalışan sayfaları service worker ve tarayıcı belleğine geri dönüşte özel içeriği tekrar doğrular.

Yerel önizlemenin Ubuntu veri bağlantısı, kurumsal sitenin genel alan adında yayımlandığı anlamına gelmez. Yayın sunucusunda HTTPS, saat, özel dizin izinleri, Ubuntu erişimi ve yedek kapsamı ayrıca doğrulanmalıdır. Özel veritabanı eşlemeleri, tercihler ve işlem kayıtlarını içeren `voltguard_site` şeması da Ubuntu veritabanı yedeğine dahil edilmelidir; çalışan kimlik/PDF deposu ayrı yedeklenir.
