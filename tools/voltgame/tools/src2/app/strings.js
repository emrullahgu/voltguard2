// ============================================================================
// app/strings.js — PX.STR (§11.3, tamamı) + PX.t(anahtar, değişkenler)     sahip: UI
// Bütün oyuncuya görünen metinler buradan. Ret metinleri (§2.15) sim2.ERR'den gelir (tek doğruluk kaynağı);
// burada yalnız "Neden?" kartlarının fizik açıklamaları ve kural kartları eklenir.
// v1'in yasaklı sloganları (§13 madde 5–6, §20.2) hiçbir yerde yoktur; topraklama ritüelinin teknik adı yalnız
// edilgen kalıpla ("… topraklanır ve kısa devre edilir/edildi") geçer. smoke paketi build'i tarar.
// Bütün metinler yayından önce bir elektrik mühendisinin incelemesinden geçer (§11.3 son satır).
//   PX.STR      tablo          PX.t('eylem.ac') / PX.t('gunSayisi', {n: 3})   ({ad} yer tutucuları)
// ============================================================================
const STR = {
  oyunAdi: 'PARALAKS: Tek Hat',
  altBaslik: 'Görünür Ayırma',
  marka: 'VoltGuard',
  basla: 'Başla', devam: 'Devam et',
  isEmri: 'İş Emri',
  hedef: 'Hedef: {yukler} beslensin{cosphi}{is}',
  hedefCosphi: ', cos φ ≥ 0,95', hedefIs: ', bakım yapılsın',
  hedefReaktif: ', reaktif güç sınırda kalsın (endüktif ≤ %{ind}, kapasitif ≤ %{kap})',
  hedefGerilimli: 'Bakımı biten bölüm yeniden gerilimli olsun: {liste}',
  hedefKapali: 'Normal işletme konumu — kapalı: {liste}',
  hedefAcik: 'Normal işletme konumu — açık: {liste}',
  hedefAcil: 'Acil kaynak ({liste}) sonunda yük taşımasın',
  hedefTemiz: 'Bitişte takılı topraklama ve asma kilit kalmasın; arızalı kesim ayrılmış olsun.',
  kazandi: 'Besleme sağlandı — İş emri kapatıldı',
  cozumMumkun: 'Çözüm mümkün', cikmaz: 'Çıkmaz', hesaplaniyor: 'Hesaplanıyor…',
  geriAl: 'Geri Al', yinele: 'Yinele', sifirla: 'Baştan',
  geriAlSoru: 'Geri Al?',
  ipucu: 'İpucu',
  ipucu1: 'Kural dürtmesi', ipucu2: 'Hayalet adım',
  ipucuNot: 'İpucu cezasızdır; bu koşu yalnız "ipuçlu" işaretlenir (Temiz İşçilik ve Mühendis Mührü bu koşuda verilmez). Çıkmazda ipucu sayılmaz.',
  ipucuMetrik: 'İpucu hangi ölçütü izlesin?',
  ipucuBekle: 'İpucu hazırlanıyor…',
  hamle: 'Hamle', manevra: 'Manevra', kesinti: 'Kesinti (yük-komut)', olay: 'Olay',
  hamleK: 'Hamle', manevraK: 'Manevra', kesintiK: 'Kesinti', olayK: 'Olay',
  optimum: 'Mühendis optimumu',
  optimumKisa: 'opt.',
  optimumKapali: 'Doğrulanmış optimumlar ilk çözümden sonra açılır.',
  kisiselEn: 'Kişisel en iyi',
  senin: 'Senin',
  simulasyon: 'Simülasyon (gerçek oyuncu verisi değil)',
  cozumUzayi: 'Çözüm uzayı',
  cozumUzayiNot: 'Soluk çubuklar: her Hamle değerinde kaç farklı kazanma durumu olduğu — seviye grafının kesin sayımı; simülasyon ya da oyuncu verisi değil. Noktalar: bu cihazdaki kendi çözümlerin.',
  pareto: 'Pareto cephesi',
  paretoNot: 'Doğrulanmış cephe: birini iyileştirmek için ötekinden vazgeçmek gereken planlar (katmanlı DP, par…par+12).',
  gecmis: 'Geçmiş çözümlerin',
  defter: 'Manevra Defteri',
  defterBos: 'Henüz manevra yok. Yürüyüş deftere yazılmaz; yalnız cihaz işlemleri, topraklama, kilitler ve iş yazılır.',
  defterDizgi: 'Eylem dizgisi',
  kopyala: 'Kopyala', kopyalandi: 'Panoya kopyalandı.', kopyalanamadi: 'Kopyalanamadı: metni seçip elle kopyalayın.',
  hayalet: 'Hayalet Volti',
  hayaletYok: 'Hayalet oynatıcı bu sürümde henüz hazır değil.',
  meydanOkuma: 'Meydan okuma bağlantısını kopyala',
  meydanOkumaKod: 'Meydan okuma kodunu kopyala',
  kodYapistir: 'Kod yapıştır',
  kodYapistirNot: 'Bir meydan okuma kodu (PX2-…) yapıştır. Kod bu cihazda kurallarla yeniden oynatılarak doğrulanır; sunucu yok.',
  kodDogrula: 'Doğrula',
  kodGecerli: 'Doğrulandı: {id} · Hamle {h} · Manevra {m} · Kesinti {k} · Olay {o}',
  kodSeviyeAc: 'Seviyeyi aç',
  eskiKural: 'eski kural sürümü (bugünkü kurallarla yeniden doğrulandı)',
  arsiv: 'Arşiv', arsivNot: 'Bütün geçmiş günler açık; kaçırılan gün kaybolmaz.',
  dogrulanamadi: 'Bu defter doğrulanamadı.',
  neden: 'Neden?',
  kapat: 'Kapat', tamam: 'Tamam', geri: 'Geri',
  // topraklaTak/Sok: taşınabilir topraklama TAKIMI (bara 'set' eylemi). Sabit topraklama ayırıcısı (el.t 'toprak') bir
  // anahtardır: kapatılır/açılır (defter: "topraklandı" / "AÇILDI"; ipucu: "kapatılmalı") -> toprakKapat/toprakAc.
  eylem: { ac: 'Aç', kapat: 'Kapat', kilitle: 'Kilitle ve etiketle', kilidiAc: 'Kilidi kaldır', topraklaTak: 'Topraklama takımını tak',
    topraklaSok: 'Topraklama takımını sök', toprakKapat: 'Kapat (toprakla)', toprakAc: 'Aç (topraklamayı kaldır)',
    sigortaDegistir: 'Sigortayı değiştir', bas: 'Bas', calis: 'İşi yap', bekle: 'Bekle (deşarj)' },
  canli: 'CANLI', olu: 'ÖLÜ', toprakli: 'TOPRAKLI', kilitli: 'KİLİTLİ', kapaliK: 'KAPALI', acikK: 'AÇIK', yuklu: 'YÜKLÜ',
  oluTopraksiz: 'ÖLÜ — TOPRAKSIZ (gerilimli say)', oluTopraksizK: 'ÖLÜ·TOPRAKSIZ',
  eridi: 'ERİDİ', acti: 'AÇTI',
  erisilemez: 'Volti oraya şu an ulaşamıyor.',
  guvenlikNotu: 'Kamera yalnız bakmak içindir: döndürmek hiçbir bağlantıyı, erişimi ya da elektriği değiştirmez. Sahada yalnız görünür, kilitli ve topraklı ayırma güvenlidir.',
  // ---- amaç arayüzü (iş emri, iş listesi, neden kartı, rehber) ----
  isListesi: 'İş listesi', isListesiAc: 'İş listesini aç', isListesiKapat: 'İş listesini kapat', siradaki: 'Sıradaki', tamamlandi: 'Tamamlandı',
  ayrinti: 'Ayrıntı', ayrintiGizle: 'Ayrıntıyı gizle',
  isNoktasi: 'İş noktası', hedefRozet: 'HEDEF',
  erisimYok: 'Erişilemiyor', engeller: 'Engel', engeliGoster: 'Engeli göster', tekHatGoster: 'Tek Hat\'ta göster', oraGit: '{id} yanına git',
  voltiGonder: 'Volti\'yi gönder', yerindeYok: 'Volti\'nin bu cihazda yapacağı bir işlem yok; durumu Tek Hat\'ta izlenir.',
  kapiAcik: 'açık', kapiKapali: 'kapalı (kilitlemeli)', kapiKosul: 'Kapı kilitlemesi',
  guvenlikBaslik: 'Güvenlik notu',
  modelNotlari: 'Model Notları',
  kayitKapali: 'Kayıt kapalı: ilerleme bu oturumla sınırlı.',
  kayitAcik: 'Kayıt açık: ilerleme yalnız bu cihazda saklanır.',
  gunluk: 'Günün Manevrası',
  gunlukNot: 'Herkes aynı bulmacayı alır. Seri, sayaç ya da bildirim yok; kaçırılan gün kaybolmaz.',
  gunSayisi: '{n} gün oynandı',
  usta: 'Usta Girişi',
  sinav: 'Sınav',
  muhur: { muhendis: 'Mühendis Mührü', sifirKesinti: 'Sıfır Kesinti', temiz: 'Temiz İşçilik', tekBakis: 'Tek Bakış',
    kitapGibi: 'Kitap Gibi', pareto: 'Pareto Noktası', gizliBag: 'Gizli Bağ' },
  muhurAcik: { muhendis: 'Hamle, Manevra ve Kesinti optimumları aynı koşuda.', sifirKesinti: 'Hiçbir zorunlu yük düşmedi.',
    temiz: 'Koruma açması yok, ipucu yok.', tekBakis: 'En kısa saha rotası.', kitapGibi: 'Beş altın kural kanonik sırayla.',
    pareto: 'Tek-metrik optimumu olmayan bir cephe noktasına tam isabet.', gizliBag: 'Az bilinen bir saha geçidi kullanıldı.' },
  muhurler: 'Mühürler',
  // ---- arayüz ----
  sonraki: 'Sonraki', harita: 'Harita', menu: 'Menü', seviyeSec: 'Seviye Seç', dondurSol: 'Sola döndür', dondurSag: 'Sağa döndür',
  tekrar: 'Tekrar', anaEkran: 'Ana ekran', duraklat: 'Duraklatıldı',
  kuralKitabi: 'Kural Kitabı', elKitabi: 'Saha El Kitabı', ayarlar: 'Ayarlar', sozluk: 'Sözlük',
  tamponDolu: 'Komut tamponu dolu', yukleniyor: 'Yükleniyor…', threeYok: '3B grafik bileşeni yüklenemedi. Sayfayı yeniden açın.',
  tekHat: 'Tek Hat', tekHatAc: 'Tek Hat panelini aç', tekHatKapat: 'Tek Hat panelini kapat',
  yukler: 'Yükler', isBolgesi: 'İş bölgesi', isKisa: 'İş:', tehlike: 'Tehlike', tehlikeYok: 'Tehlike yok',
  isHazir: 'ayrıldı, kilitli, topraklı', isYapildi: 'iş yapıldı', isKilitsiz: 'kilitsiz yol var', isTopraksiz: 'sabit topraklama yok',
  reaktifSerit: 'Endüktif %{ind} · Kapasitif %{kap}', reaktifSeritKisa: 'End. %{ind} · Kap. %{kap}',
  tekHatSigdir: 'Tek Hat: tamamını sığdır', tekHatYakin: 'Tek Hat: okunur boyut',
  kemer: 'Kemer', kilitKalan: 'Asma kilit: {n}/{top}', yedekKalan: 'Yedek NH bıçağı: {n}', setTakili: 'Taşınabilir topraklama: takılı ({b})', setBosta: 'Taşınabilir topraklama: kemerde',
  hikaye: 'Durum', kaynaklar: 'Elindekiler', korumalar: 'Koruma ayarları', talep: 'talep', oncelik: 'öncelik', esik: 'açma eşiği', kademe: 'kademe',
  zorunlu: 'zorunlu', istege: 'isteğe bağlı',
  yeniKural: 'Yeni kural', yeniKurallar: 'Bu iş emrinde yeni',
  sinif: { ogretici: 'Öğretici', cekirdek: 'Çekirdek', zor: 'Zor', usta: 'Usta', sinav: 'Sınav', gunluk: 'Günlük' },
  bolum: { 0: 'Prolog — VoltGuard Deposu', 1: 'Volt Mahallesi (AG şebeke)', 2: 'Trafo Merkezi (34,5/0,4 kV)', 3: 'Fabrika (AG motor kontrol)' },
  bolumKisa: { 0: 'Depo', 1: 'Volt Mahallesi', 2: 'Trafo Merkezi', 3: 'Fabrika' },
  bolumHikaye: {
    0: 'Karartmanın ertesi sabahı. Volti depo UPS\'inin son enerjisiyle açıldı ve öz-testini bitirdi: LED, eklemler, ölçü probu, tırmanma tutamakları tamam. Gelen kutusunda ilk İş Emri var. Telsizde emekli usta Hikmet Usta: "Önce bak, sonra dokun evlat. Panoya merdivenden çıkılır, kestirme yok."',
    1: 'Volt Mahallesi\'nin AG şebekesi karanlık. Ertelenmiş bakım, eriyip yerine konmamış NH bıçakları, yanlış ayarlanmış koruma. Fırın, okul, sağlık ocağı sırayla geri gelmeli — kimseyi tehlikeye atmadan.',
    2: 'Trafo merkezinde geri besleme tuzakları var: AG tarafından gelen gerilim trafoyu ters yönden enerjilendirebilir. N-1 bakımı sırasında hastane karanlıkta kalmamalı.',
    3: 'Fabrikada kumanda devreleri, mühürleme kontakları ve kompanzasyon kademeleri. Kondansatör bataryaları ayrıldıktan sonra bir süre yüklü kalır; motorlar ve pompa istasyonu sırayla devreye girmeli.',
  },
  bolumKilit: 'Bu bölge, önceki bölgenin Sınavı ya da bütün iş emirleri çözülünce açılır.',
  seviyeKilit: 'Önce "{ad}" iş emrini çöz.',
  kalp: 'Kalp — Ana Trafo Merkezi',
  kalpNot: '{n} hüzme ulaştı. Kalp ilk günden görünür; şehir halka halka geri geldikçe hüzmeler birikir.',
  cozuldu: 'çözüldü', cozulmedi: 'çözülmedi', ipuclu: 'ipuçlu',
  isEmriNo: 'İE {no}',
  oztest: ['Güç: depo UPS — %12', 'LED dizisi … tamam', 'Eklem sürücüleri … tamam', 'Ölçü probu … tamam', 'Tırmanma tutamakları (merdiven/iskele) … tamam'],
  ayar: {
    kalite: 'Görüntü kalitesi', kaliteSec: { oto: 'Otomatik', dusuk: 'Düşük', orta: 'Orta', yuksek: 'Yüksek' },
    kaliteNot: 'Kalite yalnız seviyeler arasında değişir.',
    ses: 'Ses efektleri', muzik: 'Ortam / şebeke uğultusu', titresim: 'Titreşim (ret geri bildirimi)',
    hareketAzalt: 'Hareketi azalt', isikAzalt: 'Işık efektlerini azalt (FlashGuard)', etiketler: 'Dioramada cihaz kodları',
    akim: 'Tek Hatta akım değerleri', solak: 'Solak düzeni (düğmeler sola)',
    sifirla: 'İlerlemeyi sil', sifirlaOnay: 'Bütün ilerleme, kişisel en iyiler ve ayarlar bu cihazdan silinecek. Emin misin?', sifirlaEvet: 'Evet, sil', silindi: 'İlerleme silindi.',
    acik: 'Açık', kapali: 'Kapalı',
  },
  // ---- iş emri kartı / optimizasyon talepleri (§24.6) ----
  asmaKilitN: 'asma kilit × {n}', asmaKilitYok: 'Bu işte asma kilit gerekmiyor',
  kimden: 'Kimden', konu: 'Konu', telsiz: 'Telsiz', odul: 'İş kapanınca',
  durumBeslenmeyen: 'Şu an beslenmeyen: {liste}.', durumHepsi: 'Bütün yükler şu an besleniyor.',
  durumBakim: ' Bakım: {liste} bölümünde iş yapılacak — beş altın kural.',
  talepler: 'Optimizasyon talepleri', talepNot: 'İsteğe bağlı uzun soluklu hedefler. Her biri build\'de kesin olarak doğrulanmıştır; seviyeyi kazanmak için gerekmez.',
  talepOk: 'karşılandı', talepYakin: 'kısıt sağlandı', talepYok: 'karşılanmadı', talepKac: '{n}/{top} talep karşılandı',
  enAzH: 'en az Hamle', enAzM: 'en az Manevra', enAzK: 'en az Kesinti',
  kisitK: 'Kesinti ≤ {n}', kisitH: 'Hamle ≤ {n}', kisitM: 'Manevra ≤ {n}',
  kisitKesintisiz: '{liste} hiç düşmesin', kisitYasak: 'dokunma: {liste}', kisitAgirlik: 'önce: {liste}',
  agirlikliKesinti: 'ağırlıklı kesinti',
  seninDeger: 'senin: {v}',
  // ---- kazanma paneli ----
  planlar: 'Doğrulanmış optimum planlar', hamleOpt: 'Hamle-opt', kesintiOpt: 'Kesinti-opt', manevraOpt: 'Manevra-opt',
  yeniEn: 'yeni kişisel en iyi',
  planTek: 'Tek bir plan dört ölçütü birden en iyiler: {v} (Hamle · Manevra · Kesinti · Olay).',
  paretoTek: 'Bu seviyede cephe tek noktadır: Hamle ve Kesinti (ya da Manevra) arasında ödünleşim yok.',
  dusar: 'düşer: {liste}', gelir: 'gelir: {liste}',
  // ---- Tek Hat lejantı ----
  lejant: {
    canli: 'Gerilimli iletken (akan kesikli çizgi)', oluTopraksiz: 'Ölü ama topraksız: gerilimli say (çapraz tarama)',
    toprakli: 'Topraklı ve kısa devre edilmiş (toprak sembolü)', kilitli: 'Kilitli ve etiketli ayırma noktası (asma kilit)',
  },
  // ---- §2.15 ret metinleri: sim2.ERR'den doldurulur ----
  ERR: {},
  // ---- Neden? kartları: başlık + fizik açıklaması (ret metnine EK) ----
  nedenKart: {
    yuk: ['Ayırıcı yük altında işletilmez', 'Ayırıcının ark söndürme düzeni yoktur. Akım taşıyan bıçak ayrılırken kontaklar arasında ark oluşur; ark bıçak açıldıkça uzar, hücreye ve operatöre zarar verir. Önce kesici açılır (akım sıfırlanır), sonra ayırıcı; geri verirken sıra terstir. Paralel bir istasyon yolu varsa (ör. kuplaj kesicisi kapalı bara) akım o yola geçer ve ayırıcı yüksüz kalır: bara transferi böyle yapılır.'],
    paralel: ['Ayırıcıyla paralelleme yapılmaz', 'İki ayrı gerilimli bölüm arasında kapama anında gerilim ve faz farkı olabilir; dengeleme akımı ayırıcının kapama yeteneğini aşar. Halka kapama ve paralelleme kapama yeteneği olan bir kesiciyle ya da yük ayırıcısıyla yapılır.'],
    trafo: ['Trafo ayırıcıyla enerjilenmez', 'Yüksüz bir trafo bile enerjilenirken mıknatıslanma (inrush) akımı çeker; ayrılırken endüktif akım kesilir. Bu akımları kesici keser. Ayırıcı trafonun enerji durumunu değiştiremez.'],
    kondans: ['Kondansatör kademe kesicisiyle anahtarlanır', 'Kondansatör bataryası enerjilenirken yüksek ani şarj akımı çeker, ayrılırken yeniden tutuşma riski vardır. Batarya yalnız kademe kesicisi/kontaktörüyle bağlanır ve ayrılır.'],
    asiri: ['Aşırı akım altında ayırıcı işletilmez', 'Bu işlem bir korumanın açma eşiğini aşan akım geçişi yaratırdı. Ayırıcı bu akımı taşıyamaz ve kesemez; önce yükü bir kesiciyle ayır.'],
    ayrilmamis: ['Önce ayır ve kilitle', 'Beş altın kural sırayla uygulanır: 1) ayır, 2) tekrar kapanmaya karşı kilitle ve etiketle, 3) gerilim yokluğunu tespit et, 4) topraklanır ve kısa devre edilir, 5) yakındaki gerilimli bölümlere karşı önlem al. Açık bir sabit kesici ayırma noktası değildir: uzaktan ya da yanlışlıkla kapanabilir. Oyun bunu en kötü durum testiyle sınar: kilitsiz her anahtar (açık sabit kesiciler dahil) kapalı sayılır.'],
    once_toprak: ['Geri verirken önce topraklama', 'Topraklama takılıyken ayırma kilidini kaldırmak topraklı bölümü bir kaynağa açık bırakır. Geri verme sırası: önce topraklama sökülür, sonra kilit ve etiket kaldırılır, en son ayırıcı ve kesici kapatılır.'],
    toprak: ['Topraklamaya kapama', 'Topraklı bir bölüme gerilim vermek en ağır manevra hatasıdır: arıza akımı topraklama takımı üzerinden akar ve ark oluşur. Kilitleme bu hatayı reddeder; gerçek sahada bunu yalnız doğru manevra sırası önler.'],
    toprak_canli: ['Önce gerilim yokluğu', 'Topraklamadan önce gerilim yokluğu uygun bir dedektörle tespit edilir. Bölüm gerilimliyken topraklama ayırıcısı kapatılmaz.'],
    koruma_yok: ['Korumasız arıza beslenmez', 'Arızalı bir kesim ancak yolda açma eşiği olan bir kesici ya da sigorta varsa beslenebilir; aksi hâlde arıza akımını kesecek bir cihaz yoktur.'],
    kesemez: ['Yük ayırıcısı arıza akımı kesmez', 'Yük ayırıcısı yük ve halka akımını keser, arızaya kapanabilir; ama arıza akımını kesme yeteneği yoktur. Arızayı önce yukarıdaki kesici ya da sigorta temizler, yük ayırıcısı ondan sonra açılır.'],
    senkron: ['Senkron kontrol (25)', 'Farklı kaynak gruplarının (ör. iki ayrı OG fiderinden beslenen trafoların) arasında faz ve frekans farkı olabilir. Senkron kontrol olmadan paralel bağlanmazlar; yük, bir taraf ölüyken aktarılır.'],
    seviye: ['Gerilim seviyeleri', 'Farklı gerilim seviyeleri yalnız trafo üzerinden bağlanır.'],
    cirpma: ['Kontaktör çırpması', 'Kumanda devresi kararlı bir duruma oturmuyor: kontaktör kendi bobin beslemesini keserek sürekli açıp kapanırdı.'],
    tehlike: ['Yaklaşma sınırı', 'Bu manevradan sonra Volti gerilimli, topraklanmamış (ölü ama topraksız iletken gerilimli sayılır) ya da yüklü kondansatörlü bir iletkenin yaklaşma sınırı içinde kalırdı. Önce bölgeden çık ya da bölgeyi önce ayır, kilitle ve topraklayıp kısa devre et.'],
    kond: ['Deşarj süresi', 'Ayrılan kondansatör bataryası bir süre yüklü kalır; iç deşarj dirençleri onu belirli sürede (burada 3 karar) boşaltır. Bu sürede yeniden enerji verilmez ve topraklanmaz. Beklemeyi başka işlerle doldurmak verimlidir.'],
    kilitli: ['Kilitli cihaz', 'Asma kilit ve etiket (LOTO) takılı cihaz çalıştırılmaz. Kilidi takan kaldırır; geri vermeden önce topraklamalar sökülür.'],
    acik_degil: ['Yalnız açık ayırma kilitlenir', 'Kilit, açık konumdaki ayırma noktasını o konumda tutar. Kapalı bir ayırıcıyı kilitlemek ayırma sağlamaz.'],
    kilit_yok: ['Asma kilit kalmadı', 'Kemerdeki bütün kilitler kullanıldı. Bölgeyi daha az ayırma noktasıyla kesmeyi dene (kesit düşüncesi).'],
    yedek_yok: ['Yedek bıçak kalmadı', 'Yedek NH sigorta bıçağı bitti. Eriyen bir sigortayı köprülemek yoktur.'],
    gerilim: ['NH sigortası gerilim altında değiştirilmez', 'NH bıçağı ancak tabanın iki tarafı da ölüyken, çekme koluyla değiştirilir.'],
    is_gerilim: ['İş bölgesi gerilimli', 'Çalışma ancak bölge ayrılıp gerilimsiz bırakıldıktan sonra başlar.'],
    is_toprak: ['Sabit topraklama yok', 'İş bölgesi, kendisine yalnız kablolarla (rijit) bağlı bir topraklamayla topraklanmalı. Bir anahtar (ör. kuplaj kesicisi) üzerinden gelen topraklama sayılmaz: o anahtar açılırsa bölge topraksız kalır.'],
    is_kilit: ['Kilitsiz yol ayırma sayılmaz', 'İş bölgesini besleyebilecek her yol görünür biçimde açık ve kilitli olmalı. Açık bir sabit kesici ayırma noktası değildir: uzaktan ya da yanlışlıkla kapanabilir.'],
    ulasilamaz: ['Erişim', 'Cihazı çalıştırmak için Volti cihazın yanındaki yaklaşma karosunda durmalıdır. Karoya giden yol düz zemin, merdiven ya da iskeleden geçer.'],
    erisilemez: ['Erişilemiyor', 'Volti hedefe giden fiziksel yolda ilerleyemiyor. Kartta engel adıyla yazılır: kilitli bir hücre kapısı ya da girilmemesi gereken bir yaklaşma bölgesi. Önce engeli kaldıran manevrayı yap.'],
    uzak: ['Önce yanına yürü', 'Cihaz yalnız yanındaki yaklaşma karosundan işletilir. Cihaza dokun: Volti en kısa fiziksel yoldan yürür, varınca işlemler çıkar.'],
    zaten: ['Zaten orada', 'Volti zaten bu karoda.'],
    gecersiz: ['Bu cihaza uymaz', 'Bu işlem bu cihaz türünde ya da şu anki konumunda yapılamaz (ör. sağlam bir sigortayı değiştirmek, takılı olmayan bir kilidi kaldırmak).'],
    kilitlenemez: ['Kilitlenemez', 'Asma kilit ve etiket yalnız görünür ayırma sağlayan cihazlara takılır: ayırıcı, yük ayırıcısı ve çekmeli kesici (arabası dışarıda). Sabit kesici kilitlenmez: kontakları görünmez ve uzaktan kapanabilir.'],
    kapi_kilitli: ['Hücre kapısı kilitlemesi', 'Metal muhafazalı hücrenin kapısı mekanik kilitlemelidir: topraklama ayırıcısı kapanmadan (ve/veya ayırma noktası açık konumda kilitlenmeden) kapı açılmaz. Böylece kimse gerilimli bölmeye giremez. Kapıyı açan manevrayı yap; Volti sonra içeri yürür.'],
    kapi_icerde: ['Önce hücreden çık', 'Kapı kilitlemesi iki yönlüdür: kapı açıkken (biri içerideyken) topraklama açılamaz ve kilit kaldırılamaz. Volti önce hücreden çıkmalı; sonra manevra serbest kalır.'],
    bolge_gerilimli: ['Yaklaşma bölgesi gerilimli', 'Açık baranın ya da iletkenin yaklaşma sınırı içine, iletken gerilimliyken girilmez. Bölgeyi besleyen yolları ayır ve kilitle, gerilim yokluğunu tespit et, topraklayıp kısa devre et; sonra yaklaş.'],
    bolge_topraksiz: ['Topraksız iletken gerilimli sayılır', 'Ayrılmış ama topraklanmamış bir iletken yeniden enerjilenebilir, endüklenmiş gerilim ya da kapasitif yük taşıyabilir. Beş altın kural: yaklaşmadan önce topraklanır ve kısa devre edilir.'],
    bolge_kond: ['Kondansatör deşarjı', 'Ayrılan kondansatör bataryası iç deşarj dirençleri boşaltana kadar (burada 3 karar) yüklüdür. Yaklaşmak için deşarjı bekle; beklemeyi başka işlerle doldurmak verimlidir.'],
    duvar: ['Duvar tepesi', 'Duvarın tepesi yürüme yüzeyi değildir (korkuluk, parapet ya da beton başlık). Üst kata yalnız merdivenden ya da iskeleden çıkılır.'],
    saglam: ['Sigorta sağlam', 'Bu NH sigortanın bıçağı erimemiş: değiştirmek gerekmez. Yedek bıçaklar yalnız eriyen sigortalar içindir.'],
    dogrulanamadi: ['Doğrulanamadı', 'Defter kurallarla yeniden oynatıldı ve aynı sonucu vermedi.'],
    yol_yok: ['Yol yok', 'Bu noktaya çıkan bir merdiven ya da iskele yok. Bu bir seviye verisi hatasıdır; lütfen bildir.'],
    yon_yok: ['Bu yönde yer yok', 'Bu yönde bitişik bir karo, merdiven ya da iskele yok (boşluk ya da duvar). Kat değiştirmek için merdivene ya da iskeleye doğru yürü.'],
  },
  // ---- Kural kartları (§6.3): başlık + tek cümle; mini şema cards.js'te ----
  kural: {
    merdiven: ['Merdiven ve iskele', 'Volti yalnız bitişik karolara yürür; kat değiştirmek için merdivenden ya da iskeleden geçer (her biri sıradan bir yürüyüş adımıdır). Kamerayı döndürmek yalnız bakış açısını değiştirir.'],
    kapi: ['Hücre kapısı kilitlemesi', 'Hücre kapısı, topraklama ayırıcısı kapanmadan ya da ayırma noktası kilitlenmeden açılmaz. Volti içerideyken kapıyı kilitleyecek manevra yapılamaz.'],
    kesici: ['Kesici', 'Kesici yük ve arıza akımını keser; açma eşiği aşılınca kendiliğinden açar (Olay). Açık sabit kesici ayırma noktası değildir.'],
    ayirici: ['Ayırıcı', 'Ayırıcı yalnız yüksüzken işletilir: açarken önce kesici, sonra ayırıcı; kaparken önce ayırıcı, sonra kesici.'],
    yuk_ayirici: ['Yük ayırıcısı (RMU)', 'Yük ve halka akımını açıp kapar, arızaya kapanabilir; arıza beslerken açılamaz. Kilitlenebilir, görünür ayırmadır.'],
    loto: ['Kilitle ve etiketle (LOTO)', 'Yalnız AÇIK ayırıcı, yük ayırıcısı ya da çekilmiş çekmeli kesici kilitlenir. Kilit sayısı kemerdeki kadardır.'],
    toprak: ['Topraklama', 'Önce ayır ve kilitle, sonra gerilim yokluğunu tespit et; bölüm topraklanır ve kısa devre edilir. Geri verirken önce topraklama sökülür.'],
    bara: ['Yaklaşma bölgesi', 'Açık bara çevresindeki karolar bölgedir: bara gerilimliyken ya da ölü ama topraksızken girilmez. Önce ayır ve kilitle, sonra topraklayıp kısa devre et.'],
    is: ['İş emri (beş altın kural)', 'İş karosunda "İşi yap" ancak bölge ölü, sabit bağlantıyla topraklı ve her yoldan görünür biçimde kilitli ayrılmışsa yapılır.'],
    sigorta: ['NH sigorta', 'Açma eşiği aşılınca erir, kendiliğinden geri gelmez. Yedek bıçakla yalnız iki taraf ölüyken değiştirilir.'],
    trafo: ['Trafo ve geri besleme', 'Trafo iki yönlü enerjilenir: AG tarafından geri besleme gerçektir. Trafo ayırıcıyla enerjilenmez; kesiciyle verilir ve alınır.'],
    kondansator: ['Kondansatör bataryası', 'Ayrıldıktan sonra 3 karar boyunca yüklü kalır; bu sürede enerji verilmez, topraklanmaz, yanına girilmez.'],
    kontaktor: ['Kontaktör ve mühürleme', 'Bobin gerilimliyse kapanır. START bırakılınca NA 13-14 mühürleme kontağı devreyi tutar; STOP (NK) bobini düşürür.'],
    ariza: ['Arıza ve seçicilik', 'Arızalı kesim beslenirse en düşük kademeli koruma açar (Olay). Arızayı iki taraftan ayır, kalanları geri ver.'],
    hedef: ['Normal işletme konumu', 'İş bitince bakımı biten bölüm yeniden gerilimli, topraklama ve kilitler sökülmüş, anahtarlar normal konumunda olmalı.'],
    reaktif: ['Kompanzasyon', 'Reaktif güç sınırda kalmalı: endüktif ve kapasitif oran seviyedeki sınırı aşmamalı. Kademeleri bileşimle seç.'],
  },
  kuralSira: ['merdiven', 'kesici', 'ayirici', 'loto', 'toprak', 'bara', 'is', 'yuk_ayirici', 'sigorta', 'ariza', 'trafo', 'hedef', 'kapi', 'kontaktor', 'kondansator', 'reaktif'],
  // ---- Sözlük ----
  sozlukListe: [
    ['Kesici (-Q0x)', 'Yük ve arıza akımını kesebilen anahtarlama cihazı. Çekmeli tipi arabası dışarı çekilince görünür ayırma noktası olur.'],
    ['Ayırıcı (-Q1x, -Q9x)', 'Yüksüz işletilen, açıkken görünür ayırma sağlayan cihaz. Akım kesmez.'],
    ['Yük ayırıcısı (-QLx)', 'RMU hücresinde yük ve halka akımını açıp kapayan, arıza akımını kesemeyen cihaz.'],
    ['Topraklama ayırıcısı (-Q8x)', 'Ölü ve ayrılmış bölümü toprağa bağlar; bölüm topraklanır ve kısa devre edilir.'],
    ['NH sigorta (-F)', 'Bıçaklı alçak gerilim sigortası; eriyince yedek bıçakla iki taraf ölüyken değiştirilir.'],
    ['Kontaktör (-K)', 'Bobinle kumanda edilen AC-3 sınıfı anahtar; NA/NK yardımcı kontakları vardır.'],
    ['NA / NK', 'Normalde açık / normalde kapalı kontak.'],
    ['Bara', 'Birden çok fiderin bağlandığı iletken. Açık barada yaklaşma sınırı vardır.'],
    ['Kuplaj', 'İki bara bölümünü bağlayan kesici ya da ayırıcı (-Q0K). Sahadaki hücresine yürünerek işletilir.'],
    ['Merdiven / iskele', 'Katlar arasındaki tek geçit. Çelik merdiven korkuluklu, iskele (el merdiveni) kafeslidir; her biri sıradan bir yürüyüş adımıdır.'],
    ['Hücre kapısı kilitlemesi', 'Metal muhafazalı hücrenin kapısı, topraklama kapanmadan ya da ayırma kilitlenmeden açılmaz (mekanik kilitleme).'],
    ['Yaklaşma bölgesi', 'Açık iletken çevresindeki, gerilimliyken ya da topraksızken girilmeyen alan (EN 50110-1 yaklaşma mesafesinin ölçekli karşılığı).'],
    ['LOTO', 'Kilitleme-etiketleme: ayırma noktası asma kilit ve "ÇALIŞMA VAR — KAPATMAYIN" etiketiyle sabitlenir.'],
    ['Geri besleme', 'Bir bölümün beklenmeyen taraftan (ör. AG tarafından trafo üzerinden) enerjilenmesi.'],
    ['Normal işletme konumu', 'Şebekenin bakım dışındaki standart anahtar konumları.'],
    ['Hamle', 'Komut sayısı: dokun-yürü koşusu 1 (merdiven ve iskele dahil, ne kadar uzun olursa olsun), cihaz işlemi 1, kamera döndürme 0.'],
    ['Manevra', 'Cihaz işlemi, topraklama takımı, sigorta değişimi ve buton.'],
    ['Kesinti', 'Her Hamle sonrasında beslenmeyen zorunlu yüklerin öncelik ağırlığı toplamı (ağırlıklı yük-komut).'],
    ['Olay', 'Koruma açması (kesici açtı, sigorta eridi).'],
  ],
  // ---- Model Notları (§4.3) ----
  modelNotlariListe: [
    'Saha fizikseldir: Volti yalnız bitişik karolar arasında yürür, kat değiştirmek için merdiven ya da iskele kullanır. Kamera yalnız bakmak içindir: döndürmek hiçbir bağlantıyı, erişimi ya da elektriği değiştirmez. Önündeki bloklar şeffaflaşır; hiçbir şey gizlenmez.',
    'Akım modeli DC eşdeğeridir (pu); tek hat (3 faz yok); kaynaklar ideal; yükler sabit akım; arıza toprağa şönt iletkenliktir. Doğrulayıcı her erişilebilir durumda akım ile açma eşiği arasında en az 0,5 birim pay ve gerilimli düğümlerde en az 0,9 pu arar.',
    'Kesici ve sigortadaki I anma akımı değil, açma eşiğidir. Termik/manyetik ayrım bu sürümde yoktur.',
    'Yaklaşma mesafeleri ölçeklidir (1 hücre). Kondansatör bataryaları metal muhafazalı ve iç deşarj dirençlidir: deşarj süresi (3 karar) dolunca yaklaşılabilir; iş bölgesindeyse topraklama yine şarttır.',
    'Kesinti birimi "ağırlıklı yük-komut"tur (her komuttan sonra beslenmeyen zorunlu yüklerin öncelik ağırlığı toplamı); SAIDI/ENS değildir.',
    'Ağ çapındaki "topraklamaya kapama" reddi bir yedek denetimdir; birincil kural yereldir: önce ayır ve kilitle, sonra toprakla.',
    'Standarttan türeyen her değer (EN 50110-1, IEC 60364-5-52, IEC 60831, Türkiye reaktif enerji sınırları) yayından önce VoltGuard\'da bir insan tarafından onaylanır.',
  ],
};
// §2.15 ret metinleri: sim2.ERR tek kaynak
if (PX.SIM && PX.SIM.ERR) for (const k in PX.SIM.ERR) STR.ERR[k] = PX.SIM.ERR[k];
STR.ERR.tampon = STR.tamponDolu;
STR.ERR.erisilemez = STR.erisilemez;
// controller ek ret anahtarları (kural sürümü 4)
STR.ERR.yon_yok = 'Bu yönde yürünecek yer yok: boşluk ya da duvar. Kat değiştirmek için merdiven ya da iskele kullan.';
STR.ERR.duvar = 'Duvarın tepesi yürüme yüzeyi değil (korkuluk/parapet). Üst kata merdivenden ya da iskeleden çıkılır.';
STR.ERR.saglam = 'Sigorta sağlam: değiştirilecek eriyik bıçak yok.';
STR.ERR.bilinmeyen = 'Bilinmeyen komut.';

// PX.t('hedef', {yukler:'Y1'}) ; noktalı anahtar: PX.t('eylem.ac')
function t(key, vars) {
  let v = STR; const ps = String(key).split('.');
  for (let i = 0; i < ps.length; i++) { v = v == null ? undefined : v[ps[i]]; }
  if (typeof v !== 'string') return String(key);
  if (!vars) return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null) ? '' : String(vars[k]));
}
// Türkçe sayı biçimi (ondalık virgül)
function num(x, d) { if (typeof x !== 'number' || !isFinite(x)) return '—'; const s = d ? x.toFixed(d) : String(Math.round(x)); return s.replace('.', ','); }
// sim2.describe satırlarının Türkçe düzeltmesi (yalnız gösterim; kurallar ve dizgiler değişmez):
//  1) "N'e" -> ünlü uyumuna göre ek (1'e, 2'ye, 3'e, 4'e; son rakama göre)
//  2) ad zaten "… topraklama ayırıcısı" ise "Q81 (Bara topraklama ayırıcısı) topraklama ayırıcısı AÇILDI" tekrarı atılır
const EK = { 0: "'a", 1: "'e", 2: "'ye", 3: "'e", 4: "'e", 5: "'e", 6: "'ya", 7: "'ye", 8: "'e", 9: "'a" };
function trLine(l) {
  if (l === null || l === undefined) return l;
  return String(l).replace(/(\d)'e(?![a-zçğıöşü])/g, (m, d) => d + EK[d])
    .replace(/\(([^()]*topraklama ayırıcısı[^()]*)\) topraklama ayırıcısı /g, '($1) ');
}
PX.STR = STR;
PX.t = t;
PX.trLine = trLine;
PX.tnum = num;
