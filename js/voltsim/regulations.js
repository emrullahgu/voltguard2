/* VoltSim mevzuat ve standart kayıtları.
 * Kaynaklar: mevzuat.gov.tr, resmigazete.gov.tr, epdk.gov.tr, webstore.iec.ch, iso.org, standards.ieee.org (son kontrol 23.10.2026).
 * binding: true → kanun/yönetmelik/kurul kararı (bağlayıcı); false → standart/rehber (atıf yapılmadıkça gönüllü).
 * needsCheck: doğrulanamayan veya ücretli metne bağlı bilgi → arayüzde "Güncel mevzuat doğrulaması gereklidir" uyarısı.
 * Standart metinleri telif korumalıdır; burada yalnızca kısa açıklama bulunur. */
(function (root, factory) {
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  else { root.VoltSimRegs = data; root.VoltSimRegsChecked = data.checkedText; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const list = [
 {
  "id": "eity",
  "name": "Elektrik İç Tesisleri Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "04.11.1984 / 18565",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=10391&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Başlıca değişiklikler: 30.11.1995/22479 (Madde 57 gerilim düşümü dahil), 25.10.1996/22798, 12.07.1998/23400, 08.12.2000/24254, 16.06.2004/25494 (Madde 18 sayaç/koruma). Lexpera konsolide listesine göre son değişiklik 12.01.2020/31006 (Madde 7, 19, 24). mevzuat.gov.tr metni yalnızca .doc ek olarak sunuyor; madde metinleri bir kamu (MEB) kopyasından okundu.",
  "articles": [
   {
    "ref": "Madde 57 a.3-i",
    "summary": "Yapı bağlantı kutusu ile tüketim araçları arasındaki gerilim düşümü, sürekli en büyük işletme akımında aydınlatma ve priz devrelerinde %1,5'i, motor devrelerinde %3'ü geçmemelidir (değişik: RG 30.11.1995/22479).",
    "verified": true
   },
   {
    "ref": "Madde 57 a.3-ii",
    "summary": "Yapı veya yapı kümesi kendi transformatöründen besleniyorsa, transformatör çıkış uçları ile yapı bağlantı kutusu arasındaki gerilim düşümü %5'i geçmemelidir.",
    "verified": true
   },
   {
    "ref": "Madde 18",
    "summary": "Yapı bağlantı kutusuna yangın koruma amaçlı, sayaç kolon devrelerine hayat koruma eşikli kaçak akım düzeni ile termik-manyetik şalter/otomatik sigorta konulması ve koruma düzenleri arasında seçicilik sağlanması istenir; mA değeri yazılmaz (değişik: RG 16.06.2004/25494).",
    "verified": true
   },
   {
    "ref": "Madde 39",
    "summary": "Hata akımı koruma düzeni arızalı devreyi 0,2 s içinde açmalı, korunan aygıtların topraklama direnci R ≤ 50 V / IΔn olmalı; özellikle banyo gibi tehlikeli yerlerdeki priz devrelerinde hata akımı korumanın kullanılması 'tavsiye edilir'.",
    "verified": true
   }
  ],
  "applies": [
   "pano",
   "topraklama",
   "motor",
   "ups",
   "selektivite"
  ],
  "note": "Bina içi alçak gerilim tesisatının temel yönetmeliğidir. Gerilim düşümü sınırları sayaçtan değil yapı bağlantı kutusundan itibaren tanımlanır; yönetmelikte sayısal bir 30 mA şartı bulunmaz.",
  "needsCheck": true
 },
 {
  "id": "eitphy",
  "name": "Elektrik İç Tesisleri Proje Hazırlama Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "03.12.2003 / 25305",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=9721&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "applies": [
   "pano",
   "topraklama",
   "komp",
   "yangin"
  ],
  "note": "İç tesisat projelerinin (kuvvet, aydınlatma, kompanzasyon, koruma, yangın algılama vb.) nasıl hazırlanacağını düzenler. İş Ekipmanları Yönetmeliği, projesi olmayan elektrik tesisatının bu yönetmeliğe göre projelendirilmesini ister.",
  "needsCheck": true
 },
 {
  "id": "topraklama",
  "name": "Elektrik Tesislerinde Topraklamalar Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "21.08.2001 / 24500",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=10392&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Konsolide metinde görülen değişiklik: 04.12.2019/30968 (Madde 2 Dayanak).",
  "articles": [
   {
    "ref": "Madde 5-d ve Şekil-6",
    "summary": "YG şebekelerindeki toprak hataları için izin verilen en yüksek dokunma gerilimi (UTp) hata süresine bağlı bir eğri olarak Şekil-6'da verilir; akım eğridekinden uzun sürerse UTp için 75 V kullanılabilir. Bu bir ek değil, Madde 5 içindeki şekildir.",
    "verified": true
   },
   {
    "ref": "Ek-C",
    "summary": "Dokunma gerilimi ile vücut akımı ilişkisini ve ayakkabı, yüzey kaplaması gibi ek dirençlerin hesaba katılma yöntemini açıklar.",
    "verified": true
   },
   {
    "ref": "Ek-P",
    "summary": "Önerilen muayene/ölçme periyotları: üretim-iletim-dağıtım tesisleri 2 yıl, hatlar 5 yıl; sanayi ve ticaret merkezlerinde topraklama direnci ölçümü 1 yıl, diğer kontroller 2 yıl; parlayıcı-patlayıcı ve ıslak ortamlarda en fazla 1 yıl.",
    "verified": true
   }
  ],
  "applies": [
   "topraklama",
   "trafo",
   "ges",
   "res",
   "pano",
   "yildirim"
  ],
  "note": "YG/AG topraklama tasarımı, dokunma/adım gerilimi ve periyodik ölçümler için temel yönetmeliktir. İzin verilen dokunma gerilimi-süre ilişkisi Şekil-6'dadır.",
  "needsCheck": false
 },
 {
  "id": "ekat",
  "name": "Elektrik Kuvvetli Akım Tesisleri Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "30.11.2000 / 24246",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=9949&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Konsolide metinde değişiklikler: 08.02.2007/26428, 23.01.2018/30310, 12.01.2020/31006, 11.05.2023/32187.",
  "articles": [
   {
    "ref": "Madde 38",
    "summary": "Her dağıtım transformatörünün AG çıkışına termik-manyetik açıcılı ana kesici konulmalı; belirli koşullarda dağıtım şirketleri bundan muaf tutulabilir.",
    "verified": true
   },
   {
    "ref": "Madde 40-a",
    "summary": "400 kVA'ya kadar dağıtım trafoları giriş tarafında sigortalı ayırıcı ile korunur; 400 kVA üstünde röleli kesici, 1600 kVA'ya kadar ise uygun sigortalı yük ayırıcısı da kullanılabilir.",
    "verified": true
   },
   {
    "ref": "Madde 40-b",
    "summary": "Ölçü transformatörü sınıfları: enerji ölçümünde akım trafosu 0,5, gerilim trafosu 1; koruma için en az 3 sınıfı.",
    "verified": true
   },
   {
    "ref": "Madde 60",
    "summary": "Tüm YG kuvvetli akım tesislerinde teknik konulardan sorumlu bir elektrik mühendisi bulunmalı; 154 kV ve üstü tesislerde en az bir elektrik mühendisi işletme sorumlusu olmalıdır.",
    "verified": true
   }
  ],
  "applies": [
   "trafo",
   "pano",
   "topraklama",
   "ges",
   "res",
   "yildirim"
  ],
  "note": "1 kV üstü tesislerin (trafo merkezleri, hücreler, hatlar) kuruluş ve işletme kurallarını içerir. Trafo koruma seçimi ve YG işletme sorumluluğu buradan kaynaklanır.",
  "needsCheck": false
 },
 {
  "id": "et-proje",
  "name": "Elektrik Tesisleri Proje Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "30.12.2014 / 29221 (mükerrer)",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=20383&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Değişiklikler: 07.11.2015/29525, 25.01.2019/30666, 09.04.2021/31449, 10.05.2021/31480, 09.05.2024/32541, 09.02.2025/32808.",
  "articles": [
   {
    "ref": "Madde 5",
    "summary": "Tasarımda TS, EN, IEC/ISO standartları, IEEE vb. uluslararası kodlar, ilgili mevzuat ve kamu şartnameleri esas alınır.",
    "verified": true
   },
   {
    "ref": "Madde 8",
    "summary": "Proje onayı, kabul ve tutanak onay/teslim yetkisi Bakanlığa aittir; Bakanlık bu yetkiyi kurum/kuruluş veya tüzel kişilere devredebilir.",
    "verified": true
   },
   {
    "ref": "Madde 9 (2)-(4)",
    "summary": "Proje onayı yapılmamış tesise enerji verilemez, kabulü yapılamaz ve işletilmesi yasaktır.",
    "verified": true
   }
  ],
  "applies": [
   "ges",
   "res",
   "trafo",
   "sarj",
   "pano"
  ],
  "note": "Üretim, iletim, dağıtım ve YG tesislerinin proje onay ve kabul süreçlerini düzenler. Onaysız projeyle kurulan tesise enerji verilmez.",
  "needsCheck": false
 },
 {
  "id": "is-ekipmanlari",
  "name": "İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ÇSGB",
  "binding": true,
  "rg": "25.04.2013 / 28628",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=18318&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Değişiklikler: 02.05.2014/28988, 23.07.2016/29779, 24.04.2017/30047, 18.02.2022/31754, 04.02.2024/32450, 23.12.2025/33116 (Madde 7 ve EK-III'te değişiklikler; değişiklik gerçektir).",
  "articles": [
   {
    "ref": "Madde 7",
    "summary": "EK-III tablolarındaki ekipmanlar yetkili kişilerce periyodik kontrole tabidir; usul ve esaslar EK-III'tedir (değişik: 23.12.2025/33116).",
    "verified": true
   },
   {
    "ref": "EK-III 2.3.1–2.3.2",
    "summary": "İlgili standartta aksi yoksa tesisatlar yılda bir kontrol edilir; elektrik, topraklama, yıldırımdan korunma, akü, trafo, jeneratör tesisatlarını yetkili elektrik mühendisi/tekniker vb. kontrol eder.",
    "verified": true
   },
   {
    "ref": "EK-III 2.3.7",
    "summary": "Elektrik, topraklama ve yıldırımdan korunma tesisatlarında kontrolde proje aranır; projesi olmayan tesisat işverence projelendirilmelidir.",
    "verified": true
   },
   {
    "ref": "EK-III Tablo-3",
    "summary": "Elektrik ve topraklama tesisatı, yıldırımdan korunma, jeneratör (TS ISO 8528), yangın algılama (TSE CEN/TS 54-14) için standartta süre yoksa en fazla 1 yıl; akümülatör ve transformatör için 1 yıl.",
    "verified": true
   }
  ],
  "applies": [
   "pano",
   "topraklama",
   "trafo",
   "ups",
   "yangin",
   "motor",
   "komp"
  ],
  "note": "İşyerlerinde elektrik ve topraklama tesisatının yıllık periyodik kontrolünün yasal dayanağıdır. 23.12.2025 değişikliği Madde 7 ve EK-III'ü yeniden düzenlemiştir.",
  "needsCheck": false
 },
 {
  "id": "k6446",
  "name": "Elektrik Piyasası Kanunu (6446)",
  "kind": "Kanun",
  "issuer": "TBMM",
  "binding": true,
  "rg": "30.03.2013 / 28603",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6446&MevzuatTur=1&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Konsolide metinde en son işlenen değişiklikler 2025 tarihli 7552 ve 7554 sayılı kanunlarla.",
  "articles": [
   {
    "ref": "Madde 14 (1)",
    "summary": "Lisans ve şirket kurma yükümlülüğünden muaf faaliyetleri sayar: imdat grupları, şebekeye bağlı olmayan üretim, en fazla 1 MW YEK tesisi, üretim-tüketimi aynı ölçüm noktasında olan ve şebekeye enerji vermeyen YEK tesisi, sözleşme gücüyle (belediye/sanayi/tarımsal sulama için iki katı) sınırlı YEK tesisi vb.",
    "verified": true
   },
   {
    "ref": "Madde 14 (2)",
    "summary": "Cumhurbaşkanı, lisanssız YEK kurulu güç üst sınırını kaynak bazında beş katına kadar artırabilir.",
    "verified": true
   },
   {
    "ref": "Madde 14 (3)-(4)",
    "summary": "Lisanssız üreticinin ihtiyaç fazlası 5346 sayılı Kanun fiyatlarından alınır; bağlantı ve satış usulleri EPDK yönetmeliğiyle düzenlenir.",
    "verified": true
   }
  ],
  "applies": [
   "ges",
   "res",
   "sarj"
  ],
  "note": "Elektrik piyasasının çerçeve kanunudur; lisanssız (öz tüketim) üretimin yasal dayanağı Madde 14'tür.",
  "needsCheck": false
 },
 {
  "id": "k5346",
  "name": "Yenilenebilir Enerji Kaynaklarının Elektrik Enerjisi Üretimi Amaçlı Kullanımına İlişkin Kanun (5346)",
  "kind": "Kanun",
  "issuer": "TBMM",
  "binding": true,
  "rg": "18.05.2005 / 25819",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=5346&MevzuatTur=1&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Konsolide metinde son değişiklikler: 02.05.2024 tarihli 7501 s. Kanun (md. 6), 19.07.2025 tarihli 7554 s. Kanun (Ek Madde 1 eklendi).",
  "articles": [
   {
    "ref": "Madde 6",
    "summary": "31.12.2020'ye kadar işletmeye girenler için I sayılı Cetvel fiyatları 10 yıl uygulanır; sonrasında işletmeye girecek YEK Belgeli tesislerin fiyat ve süreleri Cumhurbaşkanınca belirlenir.",
    "verified": true
   }
  ],
  "applies": [
   "ges",
   "res"
  ],
  "note": "YEKDEM destek mekanizmasının dayanağıdır; lisanssız üreticilerin ihtiyaç fazlası enerji bedeli de bu çerçevede belirlenir.",
  "needsCheck": false
 },
 {
  "id": "lisanssiz",
  "name": "Elektrik Piyasasında Lisanssız Elektrik Üretim Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "EPDK",
  "binding": true,
  "rg": "12.05.2019 / 30772",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=31502&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Çok sayıda değişiklik; son olanlar 17.12.2024/32755, 25.11.2025/33088, 02.04.2026/33212 (mahsuplaşma, OSB/EB, depolama hükümleri geniş biçimde yenilendi) ve 19.10.2026/33405 (acil durumda uzaktan kontrol, dengeleme talimatına uymayana ödeme yapılmaması, depolama kapasite sınırının kaldırılması).",
  "articles": [
   {
    "ref": "Madde 5 (1)",
    "summary": "Lisanssız kurulabilecek tesisleri sayar; (c) bendi 1 MW veya Cumhurbaşkanınca belirlenen üst sınıra kadar YEK, (ç) üretim-tüketim aynı ölçüm noktasında ve şebekeye vermeyen YEK, (h) sözleşme gücüyle (belediye/sanayi/tarımsal sulama için iki katı) sınırlı ve aynı ya da farklı ölçüm noktasındaki YEK tesisleri.",
    "verified": true
   },
   {
    "ref": "Madde 5 (6)",
    "summary": "(c) bendi dışındaki bentler (a, b, ç, d, f, g, ğ, h, ı, i) için kurulu güç üst sınırı uygulanmaz.",
    "verified": true
   },
   {
    "ref": "Madde 26 (1),(4)",
    "summary": "12.05.2019 sonrası çağrı mektubu alanlar ve (ç)/(d) tesislerinde mahsuplaşma saatlik yapılır; (c),(h) vb. tesislerde her saatte şebekeye verilen ihtiyaç fazlası görevli tedarik şirketince 10 yıl satın alınır.",
    "verified": true
   },
   {
    "ref": "Madde 26 (5)",
    "summary": "(ç) ve (d) bendi tesislerinde mahsuplaşma sonrası şebekeye verilen enerji için ödeme yapılmaz, YEKDEM'e bedelsiz katkı sayılır.",
    "verified": true
   },
   {
    "ref": "Madde 26 (17)",
    "summary": "Yıllık üretim, ilişkili tüketimin (bir önceki takvim yılı esas) iki katını geçemez; sınır üstü ihtiyaç fazlası bedelsiz YEKDEM katkısıdır; mesken abonelerine uygulanmaz.",
    "verified": true
   },
   {
    "ref": "Ek Madde 3",
    "summary": "Lisanssız üretim tesisine bütünleşik depolama, üretim tesisinin elektriksel gücüne kadar kurulabilir (19.10.2026'da 'kapasite sınırlaması olmaksızın' ibaresi eklendi); depodan verilen ihtiyaç fazlasına ödeme yapılmaz.",
    "verified": true
   }
  ],
  "applies": [
   "ges",
   "res"
  ],
  "note": "Çatı/arazi GES ve küçük RES'lerin öz tüketim kurallarını belirler: saatlik mahsuplaşma, 10 yıl alım ve yıllık tüketimin iki katı üretim sınırı. 2026'da iki kez kapsamlı değiştiği için hesaplar güncel metne göre kontrol edilmelidir.",
  "needsCheck": false
 },
 {
  "id": "sarj",
  "name": "Şarj Hizmeti Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "EPDK",
  "binding": true,
  "rg": "02.04.2022 / 31797",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=39454&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Değişiklikler: 06.09.2022/31945, 28.07.2023/32262, 09.08.2023/32274, 17.08.2023/32282, 23.10.2024/32701, 23.03.2026/33202 (Madde 5 muafiyetler ve Madde 30, 32 değişti; yeni geçici maddeler).",
  "articles": [
   {
    "ref": "Madde 3 (tanım)",
    "summary": "Şarj hizmeti, elektrikli araçların ticari amaçla ve bedel karşılığında şarj edilmesidir.",
    "verified": true
   },
   {
    "ref": "Madde 4",
    "summary": "Şarj ağı işletmeciliği EPDK'dan alınan şarj ağı işletmeci lisansıyla yapılır; tarifesi düzenlemeye tabi lisans sahipleri başvuramaz.",
    "verified": true
   },
   {
    "ref": "Madde 5",
    "summary": "Ticari faaliyet göstermeyen özel şarj istasyonları ve kullanıcının yalnızca kendi ihtiyacı için kurduğu şarj ünitelerinin şarj ağına bağlanması zorunlu değildir (değişik: 23.03.2026/33202).",
    "verified": true
   },
   {
    "ref": "Madde 32 (4)",
    "summary": "Şarj ağına bağlı olmadan ticari amaçla şarj yapılması Tüketici Hizmetleri Yönetmeliği md.48/1-c kapsamında değerlendirilir ve yetkili mercilere bildirilir.",
    "verified": true
   }
  ],
  "applies": [
   "sarj"
  ],
  "note": "Ev/işyeri için kendi kullanımına kurulan şarj ünitesi lisans veya şarj ağı gerektirmez; ücret karşılığı herkese hizmet ise lisanslı bir şarj ağına bağlı olmalıdır.",
  "needsCheck": false
 },
 {
  "id": "otopark",
  "name": "Otopark Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ÇŞİDB",
  "binding": true,
  "rg": "22.02.2018 / 30340",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=24408&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Elektrikli araç hükümleri 25.03.2021/31434 ile eklendi; sonraki değişiklikler 16.06.2022/31868, 12.08.2023/32277, 27.12.2025/33120 (EV oranlarını değiştirmemiş görünüyor).",
  "articles": [
   {
    "ref": "Madde 5 (1)-j",
    "summary": "Zorunlu otopark sayısı 20 ve üzeri olan yeni yapıların ruhsat başvurularında otopark yerlerinin en az %5'i (en az 1 adet) şarj ünitesi dahil elektrikli araca uygun düzenlenmelidir.",
    "verified": true
   },
   {
    "ref": "Madde 6 (5)",
    "summary": "Yeni bölge/genel otoparklar ile AVM otoparklarında en az %10 elektrikli araca uygun yer; 30.000 m² üstü AVM'lerde en az 1, 70.000 m² üstünde en az 2 hızlı şarj ünitesi gerekir.",
    "verified": true
   },
   {
    "ref": "Geçici Madde 4 (2)-(3)",
    "summary": "%5 oranı 01.01.2023'e kadar %2, %10 oranı aynı tarihe kadar %5 uygulanmıştı (geçiş dönemi sona erdi).",
    "verified": true
   }
  ],
  "applies": [
   "sarj"
  ],
  "note": "Yeni binalarda ve AVM/genel otoparklarda asgari elektrikli araç şarj yeri oranlarını belirler.",
  "needsCheck": false
 },
 {
  "id": "lisans",
  "name": "Elektrik Piyasası Lisans Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "EPDK",
  "binding": true,
  "rg": "02.11.2013 / 28809",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=18985&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Sık değişen yönetmelik; son değişiklikler 25.07.2025/32966, 29.12.2025/33122, 29.04.2026/33238, 19.10.2026/33405.",
  "applies": [
   "ges",
   "res"
  ],
  "note": "Lisanslı (önlisans/üretim lisansı) santraller için başvuru ve lisans süreçlerini düzenler. Lisanssız sınırları aşan GES/RES projeleri bu yönetmeliğe tabidir.",
  "needsCheck": true
 },
 {
  "id": "sebeke",
  "name": "Elektrik Şebeke Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "EPDK",
  "binding": true,
  "rg": "28.05.2014 / 29013 (mükerrer)",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=19722&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Son değişiklikler: 17.12.2024/32755 (Ek-18 kapsam ve RİTM izleme), 21.01.2025/32789 (Madde 14 ve E.18.4 frekans tepkisi), 29.12.2025/33122.",
  "articles": [
   {
    "ref": "Madde 14 (1)",
    "summary": "İletim sistemine doğrudan bağlı tüketiciler ve dağıtım şirketleri için aylık endüktif reaktif/aktif oranı %20'yi, kapasitif reaktif/aktif oranı %15'i geçemez.",
    "verified": true
   },
   {
    "ref": "Madde 19 (f)",
    "summary": "Rüzgar ve güneş (fotovoltaik) üretim tesislerinin sisteme bağlantısında Ek-18 hükümleri uygulanır.",
    "verified": true
   },
   {
    "ref": "Ek-18 E.18.1",
    "summary": "Ek-18 şebeke bağlantı kriterleri iletime bağlı RES/GES'lere, OG'den dağıtıma bağlı lisanslı GES'lere ve dağıtıma bağlı 10 MW ve üzeri lisanslı RES'lere uygulanır.",
    "verified": true
   },
   {
    "ref": "Ek-18 E.18.9",
    "summary": "Elektriksel kurulu gücü 10 MW ve üzeri lisanslı ve lisanssız RES'ler TEİAŞ RİTM üzerinden izlenecek altyapıyı kurmalıdır.",
    "verified": true
   }
  ],
  "applies": [
   "res",
   "ges",
   "komp",
   "trafo",
   "kalite"
  ],
  "note": "RES/GES şebeke bağlantı kriterleri (aktif/reaktif güç kontrolü, frekans tepkisi, arıza sırasında devrede kalma) Ek-18'dedir. Madde 14'teki reaktif oranları yalnız iletime bağlı kullanıcılar içindir; dağıtıma bağlı tüketicilerde EPDK Tarife Uygulamaları Usul ve Esasları geçerlidir.",
  "needsCheck": false
 },
 {
  "id": "reaktif-ue",
  "name": "Dağıtım Lisansı Sahibi Tüzel Kişiler ve Görevli Tedarik Şirketlerinin Tarife Uygulamalarına İlişkin Usul ve Esaslar",
  "kind": "Kurul Kararı",
  "issuer": "EPDK",
  "binding": true,
  "rg": "31.12.2015 / 29579 (Kurul Kararı 5999-3)",
  "url": "https://www.epdk.gov.tr/Detay/Icerik/3-0-1-3/elektrikusul-ve-esaslar",
  "urlVerified": true,
  "amendments": "EPDK sayfasında 'son hali' olarak yayımlanan Word metni okundu; metinde sonraki değişikliklerin tarih listesi yok, bu nedenle son değişiklik tarihi doğrulanamadı.",
  "articles": [
   {
    "ref": "Madde 13 (1)",
    "summary": "Mesken, aydınlatma, tek fazlı tüketiciler ile kurulu gücü 15 kW'a (dahil) kadar olan kullanıcılara reaktif enerji tarifesi uygulanmaz; takvim yılındaki ilk ihlalin bedeli faturadan düşülür.",
    "verified": true
   },
   {
    "ref": "Madde 13 (2)",
    "summary": "Kurulu gücü 50 kVA'nın altındaki kullanıcılarda sınır: endüktif reaktif aktif enerjinin %33'ü, kapasitif reaktif %20'si.",
    "verified": true
   },
   {
    "ref": "Madde 13 (3)",
    "summary": "Kurulu gücü 50 kVA ve üstündeki kullanıcılarda sınır: endüktif %20, kapasitif %15.",
    "verified": true
   },
   {
    "ref": "Madde 13 (4),(6)",
    "summary": "Sınır aşılırsa ölçülen reaktif enerjinin tamamı faturalanır; iki sınır birden aşılırsa yüksek olan reaktif değer esas alınır.",
    "verified": true
   }
  ],
  "applies": [
   "komp"
  ],
  "note": "Dağıtım şebekesine bağlı işletmelerin reaktif ceza sınırlarını belirler. 9 kW değil 15 kW eşiği geçerlidir; 50 kVA altı ve üstü için oranlar farklıdır.",
  "needsCheck": true
 },
 {
  "id": "ruzgar-teknik",
  "name": "Rüzgar Kaynağına Dayalı Elektrik Üretimi Başvurularının Teknik Değerlendirmesi Hakkında Yönetmelik",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "20.10.2015 / 29508",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=21189&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Değişiklikler: 12.01.2020/31006, 29.12.2022/32058 (büyük ölçüde yeniden düzenleme), 01.10.2025/33034, 03.10.2026/33389.",
  "articles": [
   {
    "ref": "Madde 1",
    "summary": "Rüzgara dayalı önlisans ve lisanssız başvuruların ve tadil taleplerinin teknik değerlendirme usullerini kapsar.",
    "verified": true
   },
   {
    "ref": "Madde 4",
    "summary": "Önlisans başvurusunun Ek-3 bilgileri EPDK tarafından Genel Müdürlüğe gönderilir; eksik/hatalı bilgi gibi durumlarda teknik değerlendirme olumsuz olur.",
    "verified": true
   },
   {
    "ref": "Madde 5",
    "summary": "Türbin sayısı/gücü/koordinatı, kule yüksekliği, rotor çapı ve depolama koordinatı değişiklikleri tadil talebi olarak Ek-3 bilgileriyle değerlendirilir.",
    "verified": true
   }
  ],
  "applies": [
   "res"
  ],
  "note": "RES başvurularında ETKB'nin teknik uygunluk incelemesini düzenler; türbin yerleşimi değişikliği de tadil gerektirir.",
  "needsCheck": false
 },
 {
  "id": "ruzgar-gunes-imar",
  "name": "Rüzgâr ve Güneş Enerjisine Dayalı Elektrik Üretim Tesislerinin İmar ve Ruhsat İşlemlerine İlişkin Yönetmelik",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "24.07.2026 / 33319",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=46220&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "articles": [
   {
    "ref": "Madde 1",
    "summary": "Önlisans veya üretim lisansı bulunan RES/GES'lerin imar planı, parselasyon, yapı ruhsatı, yapı kullanma izni ve işyeri açma ruhsatı işlemlerinin ETKB tarafından yürütülmesine ilişkin usulleri belirler.",
    "verified": true
   }
  ],
  "applies": [
   "res",
   "ges"
  ],
  "note": "2026'da yürürlüğe giren yeni yönetmelik: lisanslı RES/GES imar ve ruhsat işlemleri ETKB'de toplanmıştır.",
  "needsCheck": false
 },
 {
  "id": "ced",
  "name": "Çevresel Etki Değerlendirmesi Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ÇŞİDB",
  "binding": true,
  "rg": "29.07.2022 / 31907",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=39647&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Rüzgar eşikleri 26.06.2025/32938 değişikliğiyle bugünkü halini aldı; 05.03.2026/33187 değişikliği rüzgar maddelerine dokunmuyor.",
  "articles": [
   {
    "ref": "Ek-1 madde 41",
    "summary": "15 adet ve üzeri türbinli rüzgar santralleri ile tüm denizüstü rüzgar santralleri ÇED Raporu'na tabidir.",
    "verified": true
   },
   {
    "ref": "Ek-2 madde 57",
    "summary": "1–15 adet türbin arası rüzgar santralleri seçme-eleme (ön inceleme) kapsamındadır.",
    "verified": true
   },
   {
    "ref": "Ek-1 madde 43 / Ek-2 madde 41",
    "summary": "Proje alanı 25 ha ve üzeri GES'ler Ek-1'de, 7,5 ha ve üzeri GES'ler Ek-2'dedir (çatı ve cephe sistemleri hariç).",
    "verified": true
   }
  ],
  "applies": [
   "res",
   "ges"
  ],
  "note": "RES için ÇED eşiği artık MW değil türbin sayısıdır (15 ve üzeri Ek-1, 1–15 Ek-2). Ek listeler mevzuat.gov.tr'de ayrı dosyadadır; değerler 26.06.2025 tarihli Resmî Gazete metninden doğrulandı.",
  "needsCheck": false
 },
 {
  "id": "yangin",
  "name": "Binaların Yangından Korunması Hakkında Yönetmelik",
  "kind": "Yönetmelik",
  "issuer": "Cumhurbaşkanlığı (BKK 2007/12937); uygulamada ÇŞİDB/İçişleri",
  "binding": true,
  "rg": "19.12.2007 / 26735",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=200712937&MevzuatTur=21&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Son değişiklikler: 04.11.2020/31294, 20.11.2021/31665, 01.07.2025/32943.",
  "articles": [
   {
    "ref": "Madde 65",
    "summary": "Transformatör odasının duvar, taban ve tavanı en az 120 dakika yangına dayanıklı olmalı; yağlı trafoda yağ toplama çukuru gerekir.",
    "verified": true
   },
   {
    "ref": "Madde 67",
    "summary": "Elektrik tesisatı, kaçış yolu ve acil aydınlatma ile yangın algılama sistemleri ilgili yönetmelik ve standartlara göre tasarlanıp ruhsat veren idarenin onayına tabidir; periyodik kontrolü bina sahibi/yöneticisi yaptırır.",
    "verified": true
   },
   {
    "ref": "Madde 74–75",
    "summary": "Yangın algılama ve uyarı sistemleri EN 54'e uygun olmalı; yangın butonlarına yatay erişim mesafesi 60 m'yi geçmemeli ve butonlar 110–130 cm yüksekliğe konmalıdır.",
    "verified": true
   }
  ],
  "applies": [
   "yangin",
   "trafo",
   "pano",
   "ups",
   "yildirim"
  ],
  "note": "Binalarda trafo odası, jeneratör, acil aydınlatma ve yangın algılama sistemleri için zorunlu yangın güvenliği şartlarını içerir.",
  "needsCheck": false
 },
 {
  "id": "emo-yg-isletme",
  "name": "TMMOB Elektrik Mühendisleri Odası Elektrik Yüksek Gerilim Tesisleri İşletme Sorumluluğu Yönetmeliği",
  "kind": "Oda düzenlemesi",
  "issuer": "EMO (TMMOB)",
  "binding": true,
  "rg": "18.03.2004 / 25406",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=14362&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Değişiklikler: 12.01.2008/26754, 22.01.2019/30663, 05.10.2024/32683.",
  "articles": [
   {
    "ref": "Madde 3",
    "summary": "Hukuki dayanağı 6235 sayılı TMMOB Kanunu'dur.",
    "verified": true
   },
   {
    "ref": "Madde 4",
    "summary": "YG tesislerinde geçici kabulden başlayarak tesis gerilim altında kaldığı sürece uygulanır.",
    "verified": true
   }
  ],
  "applies": [
   "trafo",
   "ges",
   "res"
  ],
  "note": "YG tesisleri için işletme sorumlusu mühendisin görev ve yetkilerini düzenleyen meslek odası yönetmeliğidir. Dayanağı TMMOB Kanunu olduğundan bağlayıcılığı oda üyeleri ve sözleşme ilişkisi üzerinden işler; YG tesisinde sorumlu mühendis şartı ayrıca EKAT Madde 60'tadır.",
  "needsCheck": true
 },
 {
  "id": "fen-adamlari",
  "name": "Elektrik ile İlgili Fen Adamlarının Yetki, Görev ve Sorumlulukları Hakkında Yönetmelik",
  "kind": "Yönetmelik",
  "issuer": "ÇŞİDB (3194 sayılı İmar Kanunu dayanaklı)",
  "binding": true,
  "rg": "20.01.2026 / 33143",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=45051&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "articles": [
   {
    "ref": "Madde 5 (1)",
    "summary": "Yapım işleri kurulu güce göre: teknisyen 1.000 kW'a, tekniker/yüksek tekniker 2.000 kW'a, teknik öğretmen 2.500 kW'a kadar üstlenebilir.",
    "verified": true
   },
   {
    "ref": "Madde 5 (2)",
    "summary": "Proje düzenleme yetkisi: teknisyen 30 kW, tekniker/yüksek tekniker 50 kW, teknik öğretmen 80 kW kurulu güce kadar.",
    "verified": true
   }
  ],
  "applies": [
   "pano"
  ],
  "note": "Elektrik iç tesisatında mühendis dışındaki fen adamlarının proje ve yapım yetki sınırlarını belirleyen 2026 tarihli yönetmeliktir.",
  "needsCheck": false
 },
 {
  "id": "kabul",
  "name": "Elektrik Tesisleri Kabul Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "07.05.1995 / 22280",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=5244&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Konsolide metinde son değişiklikler 11.12.2019/30975 ve 06.11.2021/31651.",
  "articles": [
   {
    "ref": "Madde 1–2",
    "summary": "Yapımı tamamlanan üretim, iletim ve dağıtım tesislerinin kabul işlemlerini kapsar.",
    "verified": true
   }
  ],
  "applies": [
   "trafo",
   "pano"
  ],
  "note": "İletim/dağıtım tesislerinin geçici ve kesin kabul usulünü düzenler. Üretim ve depolama tesisleri için ayrıca 2020 tarihli Kabul Yönetmeliği vardır.",
  "needsCheck": true
 },
 {
  "id": "uretim-depolama-kabul",
  "name": "Elektrik Üretim ve Elektrik Depolama Tesisleri Kabul Yönetmeliği",
  "kind": "Yönetmelik",
  "issuer": "ETKB",
  "binding": true,
  "rg": "19.02.2020 / 31044",
  "url": "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=34288&MevzuatTur=7&MevzuatTertip=5",
  "urlVerified": true,
  "amendments": "Değişiklikler: 09.04.2021/31449, 13.05.2025/32899.",
  "articles": [
   {
    "ref": "Madde 1",
    "summary": "Üretim ve depolama tesis/ünitelerinin kabulünün mevzuat ve standartlara uygun, güvenli ve şebekeyle uyumlu yapılmasını ve kabul yetkisini düzenler.",
    "verified": true
   }
  ],
  "applies": [
   "ges",
   "res",
   "ups"
  ],
  "note": "GES, RES ve depolama tesislerinin işletmeye alınmadan önceki kabul sürecini belirler.",
  "needsCheck": false
 },
 {
  "id": "iec-61439-1-2",
  "name": "IEC 61439-1/-2 Alçak gerilim anahtarlama ve kumanda düzeni panoları (Genel kurallar / Güç panoları)",
  "kind": "Standart",
  "issuer": "IEC / TSE (TS EN IEC 61439-1, -2)",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/32338",
  "urlVerified": true,
  "amendments": "IEC 61439-1:2020 için COR1:2021 ve COR2:2023 yayımlandı.",
  "version": "IEC 61439-1:2020 (Ed.3), IEC 61439-2:2020 (Ed.3)",
  "applies": [
   "pano",
   "komp",
   "ges",
   "selektivite"
  ],
  "note": "Pano imalatı ve tasarım doğrulamasının (sıcaklık artışı, kısa devre dayanımı, dielektrik) temel standardıdır. -2 bölümü PSC panolarını kapsar ve 2020 baskısında PV uygulamaları için ekler içerir.",
  "needsCheck": true
 },
 {
  "id": "iec-60909-0",
  "name": "IEC 60909-0 Üç fazlı AC sistemlerde kısa devre akımları – Akımların hesaplanması",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/68454",
  "urlVerified": true,
  "amendments": "Ed.3 (2026-07-23) 2016 baskısının yerini aldı.",
  "version": "IEC 60909-0:2026 (Ed.3); önceki IEC 60909-0:2016",
  "applies": [
   "pano",
   "trafo",
   "ges",
   "res",
   "topraklama",
   "selektivite"
  ],
  "note": "Kısa devre hesabının uluslararası yöntemidir. Temmuz 2026'da yeni baskı çıktı; TS karşılığının hâlâ 2016 tabanlı olması muhtemel.",
  "needsCheck": true
 },
 {
  "id": "hd-60364-4-41",
  "name": "HD 60364-4-41 / IEC 60364-4-41 Alçak gerilim tesisleri – Elektrik çarpmasına karşı korunma",
  "kind": "Standart",
  "issuer": "CENELEC / IEC / TSE (TS HD 60364-4-41)",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/60169",
  "urlVerified": true,
  "amendments": "IEC 60364-4-41:2005+AMD1:2017 konsolide baskı.",
  "version": "IEC 60364-4-41:2005+AMD1:2017; HD 60364-4-41:2017 (CENELEC sürüm etiketi kontrol edilmeli)",
  "articles": [
   {
    "ref": "411.5.3",
    "summary": "TT sisteminde koruma RCD ile sağlanıyorsa ayırma süresi koşulu ve RA × IΔn ≤ 50 V koşulu birlikte sağlanmalıdır.",
    "verified": false
   }
  ],
  "applies": [
   "topraklama",
   "pano",
   "sarj",
   "ges",
   "selektivite"
  ],
  "note": "Otomatik ayırma süreleri, TN/TT/IT koşulları ve 30 mA ek koruma şartlarının kaynağıdır. İş Ekipmanları Yönetmeliği periyodik kontrolde TS HD 60364-4 serisine atıf yapar.",
  "needsCheck": true
 },
 {
  "id": "hd-60364-5-52",
  "name": "HD 60364-5-52 / IEC 60364-5-52 Elektrik donanımının seçimi ve tesisi – Kablo sistemleri",
  "kind": "Standart",
  "issuer": "CENELEC / IEC / TSE (TS HD 60364-5-52)",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/103734",
  "urlVerified": true,
  "amendments": "IEC tarafında AMD1:2024 yayımlandı (2024-11-22); CENELEC HD karşılığı kontrol edilmeli.",
  "version": "IEC 60364-5-52:2009+AMD1:2024; HD 60364-5-52:2011 (+A11)",
  "applies": [
   "pano",
   "motor",
   "ges",
   "sarj"
  ],
  "note": "Kablo akım taşıma kapasitesi tabloları, düzeltme katsayıları ve döşeme yöntemleri bu standarttadır. Gerilim düşümü için bilgilendirici değerler verir; bağlayıcı sınırlar Türkiye'de EİTY Madde 57'dedir.",
  "needsCheck": true
 },
 {
  "id": "hd-60364-7-712",
  "name": "HD 60364-7-712 / IEC 60364-7-712 Özel tesisler – Güneş fotovoltaik (PV) güç sistemleri",
  "kind": "Standart",
  "issuer": "CENELEC / IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/65748",
  "urlVerified": true,
  "amendments": "IEC 60364-7-712:2025 yeni baskı olarak yayımlandı.",
  "version": "IEC 60364-7-712:2025; HD 60364-7-712:2016 (CENELEC'in güncel sürümü kontrol edilmeli)",
  "applies": [
   "ges"
  ],
  "note": "PV tesislerinin AG tesisatına bağlanmasında koruma, ayırma ve kablolama kurallarını verir.",
  "needsCheck": true
 },
 {
  "id": "hd-60364-7-722",
  "name": "HD 60364-7-722 / IEC 60364-7-722 Özel tesisler – Elektrikli araç beslemeleri",
  "kind": "Standart",
  "issuer": "CENELEC / IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/29958",
  "urlVerified": true,
  "amendments": "CENELEC'te yeni revizyon projesi 2024'te açıldı.",
  "version": "IEC 60364-7-722:2018 (Ed.2); HD 60364-7-722:2018",
  "applies": [
   "sarj"
  ],
  "note": "Her şarj noktası için ayrı devre, RCD ve DC kaçak akım koruması gibi EV besleme kurallarını içerir.",
  "needsCheck": true
 },
 {
  "id": "iec-60898-1",
  "name": "IEC 60898-1 Ev ve benzeri tesisler için aşırı akım koruma devre kesicileri (MCB) – AC",
  "kind": "Standart",
  "issuer": "IEC / TSE (TS EN 60898-1)",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/66269",
  "urlVerified": true,
  "amendments": "AMD1:2019 ve COR1:2020.",
  "version": "IEC 60898-1:2015+AMD1:2019 (Ed.2.1)",
  "applies": [
   "pano",
   "sarj",
   "ges",
   "selektivite"
  ],
  "note": "B, C, D eğrili minyatür devre kesicilerin açma karakteristiklerini tanımlar; kapsamı 440 V, 125 A ve 25 kA'e kadardır.",
  "needsCheck": true
 },
 {
  "id": "iec-60947-2",
  "name": "IEC 60947-2 Alçak gerilim anahtarlama düzenleri – Devre kesiciler",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/66277",
  "urlVerified": true,
  "amendments": "Ed.6 (2024), 2016 baskısı ve AMD1:2019'un yerini aldı.",
  "version": "IEC 60947-2:2024 (Ed.6)",
  "applies": [
   "pano",
   "trafo",
   "motor",
   "ges",
   "selektivite"
  ],
  "note": "Endüstriyel kompakt ve açık tip kesicilerin (MCCB/ACB) standardıdır; 1000 V AC / 1500 V DC'ye kadar.",
  "needsCheck": true
 },
 {
  "id": "iec-60269",
  "name": "IEC 60269-1 / -2 Alçak gerilim sigortaları (Genel kurallar / Yetkili kişilerce kullanılan sigortalar — NH sistemi)",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "version": "IEC 60269-1 ve IEC 60269-2 (güncel baskı kontrol edilmeli)",
  "applies": [
   "selektivite"
  ],
  "note": "gG sigortaların konvansiyonel erime/erimeme akımları (In ≥ 16 A için 1,6·In / 1,25·In) ve zaman–akım kapı değerleri (Imin 10 s, Imax 5 s, Imin/Imax 0,1 s) bu standartlarda verilir. Seçicilik için ön ark ve toplam I²t değerleri üreticiden alınır.",
  "needsCheck": true
 },
 {
  "id": "iec-61008-61009",
  "name": "IEC 61008-1 / IEC 61009-1 Kaçak akım koruma şalterleri (RCCB) / Aşırı akım korumalı kaçak akım şalterleri (RCBO)",
  "kind": "Standart",
  "issuer": "IEC / TSE (TS EN 61008-1, TS EN 61009-1)",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/67980",
  "urlVerified": true,
  "amendments": "Her ikisinde Ed.4 2024-11-21'de yayımlandı ve 2010 baskılarının yerini aldı.",
  "version": "IEC 61008-1:2024 (Ed.4), IEC 61009-1:2024 (Ed.4)",
  "applies": [
   "pano",
   "sarj",
   "topraklama"
  ],
  "note": "Ev tipi kaçak akım şalterlerinin açma eşikleri ve süreleri bu standartlardadır. TS EN karşılıkları büyük olasılıkla hâlâ 2010 tabanlıdır.",
  "needsCheck": true
 },
 {
  "id": "iec-62548-1",
  "name": "IEC 62548-1 Fotovoltaik (PV) diziler – Tasarım gereklilikleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/110893",
  "urlVerified": true,
  "amendments": "AMD1:2025 (Aralık 2025): ayırma düzenleri, bifasiyal modüller ve ark/PID ile ilgili ekler.",
  "version": "IEC 62548-1:2023+AMD1:2025",
  "applies": [
   "ges"
  ],
  "note": "PV dizi DC kablolama, koruma, ayırma ve topraklama tasarımının temel standardıdır.",
  "needsCheck": false
 },
 {
  "id": "iec-62446-1",
  "name": "IEC 62446-1 PV sistemleri – Test, dokümantasyon ve bakım gereklilikleri – Şebeke bağlantılı sistemler",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/63726",
  "urlVerified": true,
  "amendments": "AMD1:2018.",
  "version": "IEC 62446-1:2016+AMD1:2018",
  "applies": [
   "ges"
  ],
  "note": "GES devreye alma testleri (izolasyon, polarite, Voc/Isc) ve teslim dokümanlarını tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iec-61215",
  "name": "IEC 61215 Karasal PV modüller – Tasarım yeterliliği ve tip onayı",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/61345",
  "urlVerified": true,
  "version": "IEC 61215-1:2021 (Ed.2) ve teknolojiye özel 61215-1-x / 61215-2:2021",
  "applies": [
   "ges"
  ],
  "note": "PV modüllerin uzun süreli dış ortam dayanımı için tip testlerini tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iec-61730",
  "name": "IEC 61730 PV modül güvenlik yeterliliği",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/59803",
  "urlVerified": true,
  "version": "IEC 61730-1:2023 (Ed.3); IEC 61730-2:2023",
  "applies": [
   "ges"
  ],
  "note": "PV modüllerin elektriksel ve yangın güvenliği yapım ve test şartlarıdır.",
  "needsCheck": true
 },
 {
  "id": "iec-62109",
  "name": "IEC 62109-1/-2 PV güç sistemlerinde güç dönüştürücülerin güvenliği (Genel / Eviriciler)",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/6470",
  "urlVerified": true,
  "amendments": "IEC 62109-1 Ed.2 (2026) ön sürüm olarak duyuruldu; nihai yayımı doğrulanamadı.",
  "version": "IEC 62109-1:2010, IEC 62109-2:2011",
  "applies": [
   "ges",
   "ups"
  ],
  "note": "PV invertörlerin elektriksel güvenlik şartları ve kaçak akım izleme gereklilikleri bu seridedir.",
  "needsCheck": true
 },
 {
  "id": "iec-60076-1",
  "name": "IEC 60076-1 Güç transformatörleri – Genel",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/588",
  "urlVerified": true,
  "version": "IEC 60076-1:2011 (Ed.3)",
  "applies": [
   "trafo"
  ],
  "note": "Transformatör anma değerleri, toleranslar ve rutin/tip testlerinin genel standardıdır.",
  "needsCheck": false
 },
 {
  "id": "iec-60076-7",
  "name": "IEC 60076-7 Yağlı güç transformatörleri için yükleme kılavuzu",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/34351",
  "urlVerified": true,
  "version": "IEC 60076-7:2018 (Ed.2)",
  "applies": [
   "trafo"
  ],
  "note": "Sıcak nokta sıcaklığı, yaşlanma hızı ve aşırı yükleme sınırlarının hesabı için rehberdir. Tablo değerleri standart metninden ayrıca doğrulanmalıdır.",
  "needsCheck": true
 },
 {
  "id": "en-50588-1",
  "name": "EN 50588-1 Orta güç transformatörleri 50 Hz, en yüksek donanım gerilimi 36 kV'u aşmayan – Genel gereklilikler",
  "kind": "Standart",
  "issuer": "CENELEC / TSE",
  "binding": false,
  "urlVerified": false,
  "amendments": "EN 50588-1:2015 ve A1:2016 geri çekildi; yerini EN 50588-1:2017 aldı (ikincil kaynaklar).",
  "version": "EN 50588-1:2017",
  "applies": [
   "trafo"
  ],
  "note": "AB Ekotasarım (548/2014) verim sınıflarıyla ilişkili dağıtım trafosu kayıp şartlarını içerir.",
  "needsCheck": true
 },
 {
  "id": "iec-62271-200",
  "name": "IEC 62271-200 Metal muhafazalı AC anahtarlama düzenleri (1–52 kV)",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/96236",
  "urlVerified": true,
  "amendments": "AMD1:2024.",
  "version": "IEC 62271-200:2021+AMD1:2024 (Ed.3.1)",
  "applies": [
   "trafo",
   "pano",
   "ges",
   "res"
  ],
  "note": "OG hücrelerinin (LSC, IAC iç ark sınıfı vb.) tasarım ve test standardıdır.",
  "needsCheck": false
 },
 {
  "id": "iec-62271-202",
  "name": "IEC 62271-202 Prefabrik trafo merkezleri (1–52 kV)",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/66264",
  "urlVerified": true,
  "amendments": "COR1:2023.",
  "version": "IEC 62271-202:2022 (Ed.3)",
  "applies": [
   "trafo",
   "ges",
   "res"
  ],
  "note": "Beton/metal köşk tipi trafo merkezlerinin sıcaklık sınıfı ve iç ark testlerini tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iec-61851-1",
  "name": "IEC 61851-1 Elektrikli araç iletkenli şarj sistemi – Genel gereklilikler",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/33644",
  "urlVerified": true,
  "amendments": "COR1:2023.",
  "version": "IEC 61851-1:2017 (Ed.3)",
  "applies": [
   "sarj"
  ],
  "note": "Şarj modları (Mod 1–4), pilot sinyali ve şarj istasyonu güvenlik şartlarını tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iec-62196-2-3",
  "name": "IEC 62196-2 / -3 EV fiş, priz ve araç bağlantı elemanları (AC Tip 2 / DC CCS)",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/86317",
  "urlVerified": true,
  "amendments": "62196-2 Ed.4 2025-11-25; 62196-3 Ed.3 2026-04-23 (TS 62196-3-1 içeriği Ek AA olarak eklendi).",
  "version": "IEC 62196-2:2025 (Ed.4), IEC 62196-3:2026 (Ed.3)",
  "applies": [
   "sarj"
  ],
  "note": "AC (Tip 2) ve DC (CCS) konnektör boyut ve test şartlarıdır.",
  "needsCheck": false
 },
 {
  "id": "iso-15118",
  "name": "ISO 15118 Araç–şebeke haberleşme arayüzü",
  "kind": "Standart",
  "issuer": "ISO",
  "binding": false,
  "url": "https://www.iso.org/standard/77845.html",
  "urlVerified": true,
  "amendments": "ISO 15118-20:2022/Amd 1:2026 (AC DER, MCS, güvenlik); ISO 15118-2'nin yeni baskısı DIS aşamasında.",
  "version": "ISO 15118-20:2022 (+Amd1:2026), ISO 15118-2:2014",
  "applies": [
   "sarj"
  ],
  "note": "Plug & Charge ve çift yönlü (V2G) şarj haberleşmesinin standardıdır.",
  "needsCheck": true
 },
 {
  "id": "iec-61400-1",
  "name": "IEC 61400-1 Rüzgar enerjisi üretim sistemleri – Tasarım gereklilikleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/111042",
  "urlVerified": true,
  "amendments": "AMD1:2025 ve ISH1:2025.",
  "version": "IEC 61400-1:2019+AMD1:2025 (Ed.4)",
  "applies": [
   "res"
  ],
  "note": "Türbin rüzgar sınıfları (I–III, T), türbülans modelleri ve tasarım yük durumlarını tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iec-61400-12-1",
  "name": "IEC 61400-12-1 Rüzgar türbinleri güç performansı ölçümleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/68499",
  "urlVerified": true,
  "amendments": "COR1:2025.",
  "version": "IEC 61400-12-1:2022 (Ed.3)",
  "applies": [
   "res"
  ],
  "note": "Güç eğrisi ölçümü ve yıllık enerji üretimi (AEP) hesabının yöntemidir.",
  "needsCheck": false
 },
 {
  "id": "iec-61400-21-1",
  "name": "IEC 61400-21-1 Rüzgar türbinlerinin elektriksel karakteristiklerinin ölçümü ve değerlendirilmesi",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/29528",
  "urlVerified": true,
  "version": "IEC 61400-21-1:2019 (Ed.1)",
  "applies": [
   "res"
  ],
  "note": "Türbinin güç kalitesi (flicker, harmonik, reaktif kapasite) karakteristiklerini tanımlar; Şebeke Yönetmeliği TS EN 61400 serisine atıf yapar.",
  "needsCheck": false
 },
 {
  "id": "iec-60831-1",
  "name": "IEC 60831-1 1000 V'a kadar kendi kendini onaran tip şönt güç kondansatörleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/3609",
  "urlVerified": true,
  "amendments": "COR1:2014.",
  "version": "IEC 60831-1:2014 (Ed.3)",
  "applies": [
   "komp",
   "kalite"
  ],
  "note": "Kompanzasyon kondansatörlerinin anma değerleri ve aşırı yüklenebilirlik şartlarını içerir.",
  "needsCheck": false
 },
 {
  "id": "iec-61921",
  "name": "IEC 61921 Güç kondansatörleri – AG güç faktörü düzeltme bankaları",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/26596",
  "urlVerified": true,
  "version": "IEC 61921:2017 (Ed.2)",
  "applies": [
   "komp",
   "pano"
  ],
  "note": "Kompanzasyon panolarının (kondansatör bankaları) tasarım ve testleri; uygulanabildiği yerde IEC 61439-1/-2 ile birlikte kullanılır.",
  "needsCheck": false
 },
 {
  "id": "en-50160",
  "name": "EN 50160 Kamu elektrik şebekelerinden sağlanan elektriğin gerilim karakteristikleri",
  "kind": "Standart",
  "issuer": "CENELEC / TSE (TS EN 50160)",
  "binding": false,
  "urlVerified": false,
  "amendments": "EN 50160:2022/A1:2025; A1 ile YG/çok YG harmonik değerleri (Tablo 8) zorunlu hale geldi.",
  "version": "EN 50160:2022+A1:2025",
  "applies": [
   "komp",
   "ges",
   "ups",
   "motor",
   "kalite"
  ],
  "note": "Şebeke gerilim kalitesinin (gerilim değişimi, flicker, harmonik, dengesizlik) haftalık istatistiksel sınırlarını verir.",
  "needsCheck": true
 },
 {
  "id": "iec-61000-2-2",
  "name": "IEC 61000-2-2 Elektromanyetik uyumluluk – Kamu AG güç kaynağı sistemlerinde düşük frekanslı iletilen bozulmalar için uyumluluk seviyeleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "version": "IEC 61000-2-2 (güncel baskı ve değişiklikler kontrol edilmeli)",
  "applies": [
   "kalite"
  ],
  "note": "AG şebekede harmonik gerilimler için uyumluluk seviyeleri (ör. 5. harmonik %6, 7. %5, THD %8) verir; ekipman bağışıklık ve emisyon standartlarının referansıdır.",
  "needsCheck": true
 },
 {
  "id": "iec-61000-4-30",
  "name": "IEC 61000-4-30 Test ve ölçme teknikleri – Güç kalitesi ölçme yöntemleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "version": "IEC 61000-4-30 (Sınıf A / S; güncel baskı kontrol edilmeli)",
  "applies": [
   "kalite",
   "komp"
  ],
  "note": "Gerilim çökmesi/yükselmesi/kesinti eşikleri, 10 dakikalık toplama aralıkları ve dengesizlik (u2) ölçüm yöntemini tanımlar. EN 50160 uygunluğu bu yöntemle ölçülen verilerle değerlendirilir.",
  "needsCheck": true
 },
 {
  "id": "semi-f47",
  "name": "SEMI F47 Yarı iletken işleme ekipmanı için gerilim çökmesi dayanım şartnamesi",
  "kind": "Endüstri şartnamesi",
  "issuer": "SEMI",
  "binding": false,
  "version": "SEMI F47-0706 (güncel revizyon kontrol edilmeli)",
  "applies": [
   "kalite"
  ],
  "note": "Ekipmanın %50 · 200 ms, %70 · 500 ms ve %80 · 1 s çökmelerde çalışmaya devam etmesini ister. Simülasyonda yalnız örnek bir hassas ekipman dayanım eğrisi olarak kullanılır.",
  "needsCheck": true
 },
 {
  "id": "ieee-519",
  "name": "IEEE 519 Elektrik güç sistemlerinde harmonik kontrolü",
  "kind": "Standart",
  "issuer": "IEEE",
  "binding": false,
  "url": "https://standards.ieee.org/ieee/519/10677/",
  "urlVerified": true,
  "amendments": "Revizyon projesi (P519) 2024'ten beri aktif.",
  "version": "IEEE 519-2022",
  "applies": [
   "komp",
   "motor",
   "ups",
   "ges",
   "kalite"
  ],
  "note": "Ortak bağlantı noktasında (PCC) gerilim ve akım harmonik sınırlarını (TDD) verir.",
  "needsCheck": false
 },
 {
  "id": "ieee-80",
  "name": "IEEE 80 AC trafo merkezi topraklamasında güvenlik kılavuzu",
  "kind": "Standart",
  "issuer": "IEEE",
  "binding": false,
  "url": "https://standards.ieee.org/ieee/80/4089/",
  "urlVerified": true,
  "amendments": "IEEE 80-2013 2024-03-21'de 'Inactive-Reserved' durumuna alındı; yeni revizyon projesi 2025'te onaylandı.",
  "version": "IEEE 80-2013 (son yayımlanmış baskı)",
  "applies": [
   "topraklama",
   "trafo"
  ],
  "note": "Trafo merkezi topraklama ızgarası, adım ve dokunma gerilimi hesabında yaygın kullanılan kılavuzdur.",
  "needsCheck": true
 },
 {
  "id": "bs-7430",
  "name": "BS 7430 Elektrik tesislerinin koruma topraklaması uygulama kuralları",
  "kind": "Standart",
  "issuer": "BSI",
  "binding": false,
  "urlVerified": false,
  "amendments": "BS 7430:2026 31 Mayıs 2026'da yürürlüğe girdi; BS 7430:2011+A1:2015 geri çekildi (ECA ve IHS kayıtları; BSI mağazası doğrulanmalı).",
  "version": "BS 7430:2026",
  "applies": [
   "topraklama"
  ],
  "note": "Topraklayıcı direnç hesap formülleri için sık başvurulan İngiliz uygulama kodudur.",
  "needsCheck": true
 },
 {
  "id": "iec-60947-4-1",
  "name": "IEC 60947-4-1 Kontaktörler ve motor yol vericiler – Elektromekanik",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/74487",
  "urlVerified": true,
  "amendments": "COR1:2026 (2026-03-16).",
  "version": "IEC 60947-4-1:2023 (Ed.5)",
  "applies": [
   "motor"
  ],
  "note": "Kontaktör kullanım kategorileri (AC-3 vb.) ve termik röle açma sınıflarını (10A, 10, 20, 30...) tanımlar.",
  "needsCheck": true
 },
 {
  "id": "iec-60034-1",
  "name": "IEC 60034-1 Döner elektrik makineleri – Anma değerleri ve performans",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/89961",
  "urlVerified": true,
  "amendments": "Ed.15 2026-03-13'te 2022 baskısının yerini aldı.",
  "version": "IEC 60034-1:2026 (Ed.15)",
  "applies": [
   "motor"
  ],
  "note": "Motor görev tipleri (S1–S10), sıcaklık sınıfları ve gerilim/frekans toleranslarını tanımlar.",
  "needsCheck": true
 },
 {
  "id": "iec-62040-3",
  "name": "IEC 62040-3 Kesintisiz güç sistemleri (UPS) – Performans ve test gereklilikleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/60140",
  "urlVerified": true,
  "version": "IEC 62040-3:2021 (Ed.3)",
  "applies": [
   "ups"
  ],
  "note": "UPS sınıflandırması (VFI/VI/VFD) ve dinamik çıkış performans eğrilerini tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iso-8528",
  "name": "ISO 8528-1 İçten yanmalı motor tahrikli AC jeneratör grupları – Uygulama, anma değerleri ve performans",
  "kind": "Standart",
  "issuer": "ISO / TSE (TS ISO 8528)",
  "binding": false,
  "url": "https://www.iso.org/standard/68539.html",
  "urlVerified": true,
  "amendments": "Yeni baskı taslak aşamasında (ISO/DIS 8528-1).",
  "version": "ISO 8528-1:2018",
  "applies": [
   "ups",
   "yangin"
  ],
  "note": "Jeneratör güç sınıflarını (sürekli, prime, standby vb.) tanımlar; İş Ekipmanları Yönetmeliği jeneratör periyodik kontrolünde TS ISO 8528 serisine atıf yapar.",
  "needsCheck": false
 },
 {
  "id": "iec-60947-6-1",
  "name": "IEC 60947-6-1 Çok fonksiyonlu donanım – Transfer anahtarlama donanımı (ATS)",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/90494",
  "urlVerified": true,
  "amendments": "Ed.4 2026-04-02'de 2021 baskısının yerini aldı (bypass/izolasyon, kapalı geçişli ATSE, yangın pompası kontrolörleri ekleri).",
  "version": "IEC 60947-6-1:2026 (Ed.4)",
  "applies": [
   "ups",
   "pano",
   "yangin"
  ],
  "note": "Şebeke-jeneratör otomatik transfer şalterlerinin standardıdır.",
  "needsCheck": true
 },
 {
  "id": "en-54-2",
  "name": "EN 54-2 Yangın algılama ve alarm sistemleri – Kontrol ve gösterge donanımı",
  "kind": "Standart",
  "issuer": "CEN / TSE (TS EN 54-2)",
  "binding": false,
  "urlVerified": false,
  "amendments": "A1:2006 ve AC:1999 ile birlikte geçerli; CPR kapsamında uyumlaştırılmış.",
  "version": "EN 54-2:1997+A1:2006",
  "applies": [
   "yangin"
  ],
  "note": "Yangın alarm kontrol panellerinin fonksiyon ve test şartlarıdır; Yangın Yönetmeliği algılama sistemlerinin EN 54'e uygunluğunu ister.",
  "needsCheck": true
 },
 {
  "id": "cen-ts-54-14",
  "name": "CEN/TS 54-14 Yangın algılama ve alarm sistemleri – Planlama, tasarım, tesis, devreye alma, kullanım ve bakım kılavuzu",
  "kind": "Rehber",
  "issuer": "CEN / TSE (TSE CEN/TS 54-14)",
  "binding": false,
  "urlVerified": false,
  "amendments": "CEN/TS 54-14:2018, 2004 baskısının yerini aldı.",
  "version": "CEN/TS 54-14:2018",
  "applies": [
   "yangin"
  ],
  "note": "Teknik şartname niteliğinde olup kendi başına zorunlu değildir; ancak İş Ekipmanları Yönetmeliği EK-III Tablo-3 yangın algılama sistemlerinin periyodik kontrolünü 'TSE CEN/TS 54-14' kriterlerine bağlar, Yangın Yönetmeliği de 'TS EN 54-14' olarak atıf yapar.",
  "needsCheck": true
 },
 {
  "id": "iec-61131-3",
  "name": "IEC 61131-3 Programlanabilir kontrolörler – Programlama dilleri",
  "kind": "Standart",
  "issuer": "IEC / TSE",
  "binding": false,
  "url": "https://webstore.iec.ch/en/publication/68533",
  "urlVerified": true,
  "amendments": "Ed.4 2025-05; Instruction List (IL) çıkarıldı, UTF-8 dize desteği eklendi.",
  "version": "IEC 61131-3:2025 (Ed.4)",
  "applies": [
   "motor",
   "pano"
  ],
  "note": "PLC programlama dillerini (ST, LD, FBD, SFC) tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iso-13849-iec-62061",
  "name": "ISO 13849-1 / IEC 62061 Makine emniyeti – Kumanda sistemlerinin güvenlikle ilgili kısımları / Fonksiyonel güvenlik",
  "kind": "Standart",
  "issuer": "ISO / IEC / TSE",
  "binding": false,
  "url": "https://www.iso.org/standard/73481.html",
  "urlVerified": true,
  "amendments": "IEC 62061:2021/AMD1:2024 (2024-03-28).",
  "version": "ISO 13849-1:2023 (Ed.4); IEC 62061:2021+AMD1:2024",
  "applies": [
   "motor"
  ],
  "note": "Acil stop, emniyet rölesi gibi güvenlik fonksiyonlarının PL (ISO 13849-1) veya SIL (IEC 62061) seviyesine göre tasarımını tanımlar.",
  "needsCheck": false
 },
 {
  "id": "iec-62305",
  "name": "IEC 62305-1/-2/-3/-4 (TS EN 62305) Yıldırımdan korunma – Genel prensipler / Risk yönetimi / Yapılarda fiziksel hasar ve hayati tehlike / İç elektrik ve elektronik sistemler",
  "kind": "Standart",
  "issuer": "IEC / CENELEC / TSE",
  "binding": false,
  "version": "IEC 62305-1/-3:2010 (Ed.2) değerleri kullanıldı; Ed.3 baskılar ve TS EN karşılıkları kontrol edilmeli",
  "articles": [
   {
    "ref": "62305-3 Tablo 2",
    "summary": "Yuvarlanan küre yarıçapı LPL I–IV: 20 / 30 / 45 / 60 m; ağ göz boyutu 5×5 / 10×10 / 15×15 / 20×20 m; koruma açısı Şekil 1’den.",
    "verified": false
   },
   {
    "ref": "62305-3 Tablo 4",
    "summary": "İniş iletkenleri arası tipik mesafe LPL I–IV: 10 / 10 / 15 / 20 m.",
    "verified": false
   },
   {
    "ref": "62305-3 6.3",
    "summary": "Ayırma mesafesi s = ki·(kc/km)·l; ki 0,08 / 0,06 / 0,04 / 0,04 (Tablo 10), km hava 1, katı malzeme 0,5 (Tablo 11), kc Tablo 12 / Ek C.",
    "verified": false
   }
  ],
  "applies": [
   "yildirim"
  ],
  "note": "Dış yıldırımdan korunma sisteminin (hava sonlandırma, iniş iletkeni, topraklama) tasarım kurallarını ve koruma seviyelerini verir. Gerekli koruma seviyesi IEC 62305-2 risk analiziyle belirlenir; iç koruma ve SPD seçimi IEC 62305-4 kapsamındadır. Tablo değerleri standardın güncel baskısından doğrulanmalıdır.",
  "needsCheck": true
 }
];
  /* Ek modüller (depolama-hibrit, ariza-tespit, konveyor-scada): mevcut kayıtlara modül atfı ve yeni standart kayıtları.
   * Yeni kayıtlar standarttır (bağlayıcı değil); sürüm/bağlantı bu oturumda resmî katalogdan doğrulanmadığı için needsCheck: true. */
  [["lisanssiz", ["depolama"]], ["uretim-depolama-kabul", ["depolama"]], ["k6446", ["depolama"]], ["sebeke", ["depolama"]], ["et-proje", ["depolama"]],
   ["eity", ["ariza"]], ["topraklama", ["ariza"]], ["is-ekipmanlari", ["ariza", "konveyor", "depolama"]], ["hd-60364-4-41", ["ariza"]], ["iec-61008-61009", ["ariza"]], ["iec-60947-2", ["ariza"]],
   ["iec-61131-3", ["konveyor"]], ["iso-13849-iec-62061", ["konveyor"]], ["iec-60947-4-1", ["konveyor", "ariza"]], ["iec-60034-1", ["konveyor"]]
  ].forEach(([id, mods]) => { const r = list.find(x => x.id === id); if (r) mods.forEach(m => { if (r.applies.indexOf(m) < 0) r.applies.push(m); }); });
  list.push(
    { id: "iec-62619", name: "IEC 62619 Endüstriyel uygulamalar için ikincil lityum hücre ve bataryalar – Güvenlik gereklilikleri", kind: "Standart", issuer: "IEC / TSE", binding: false,
      version: "IEC 62619 (güncel baskı katalogdan doğrulanmalı)", applies: ["depolama"], needsCheck: true,
      note: "Sabit enerji depolama dahil endüstriyel kullanımdaki lityum hücre ve bataryaların güvenlik testlerini (aşırı şarj, kısa devre, ısıl kaçak yayılımı vb.) tanımlar." },
    { id: "iec-62933-5-2", name: "IEC 62933-5-2 Elektrik enerjisi depolama (EES) sistemleri – Şebekeye bağlı elektrokimyasal sistemler için güvenlik gereklilikleri", kind: "Standart", issuer: "IEC", binding: false,
      version: "IEC 62933-5-2 (güncel baskı katalogdan doğrulanmalı)", applies: ["depolama"], needsCheck: true,
      note: "Batarya enerji depolama sistemlerinde (BESS) sistem düzeyinde risk değerlendirmesi, yangın/gaz, elektriksel ve kumanda güvenliği gerekliliklerini ele alır." },
    { id: "hd-60364-6", name: "HD 60364-6 / IEC 60364-6 Alçak gerilim tesisleri – Doğrulama (muayene ve deneyler)", kind: "Standart", issuer: "CENELEC / IEC / TSE", binding: false,
      version: "HD 60364-6 (güncel baskı katalogdan doğrulanmalı)", applies: ["ariza"], needsCheck: true,
      note: "İlk ve periyodik doğrulamada süreklilik, yalıtım direnci (ör. 500 V'a kadar devrelerde 500 V DC deney gerilimi, en az 1 MΩ), otomatik kesme, döngü empedansı, RCD ve faz sırası deneylerini tanımlar." },
    { id: "iec-61557", name: "IEC 61557 serisi AG dağıtım sistemlerinde elektrik güvenliği – Koruma önlemlerinin deney, ölçme ve izleme donanımı", kind: "Standart", issuer: "IEC / TSE", binding: false,
      version: "IEC 61557 bölümleri (-2 yalıtım, -3 döngü empedansı, -4 süreklilik, -6 RCD, -7 faz sırası)", applies: ["ariza"], needsCheck: true,
      note: "Yalıtım ölçer, döngü empedansı ölçer, süreklilik, RCD ve faz sırası test cihazlarının performans gerekliliklerini tanımlar." },
    { id: "en-50110-1", name: "EN 50110-1 Elektrik tesislerinin işletilmesi – Genel gereklilikler", kind: "Standart", issuer: "CENELEC / TSE", binding: false,
      version: "EN 50110-1 (güncel baskı katalogdan doğrulanmalı)", applies: ["ariza"], needsCheck: true,
      note: "Enerjisiz çalışmanın beş güvenlik kuralını tanımlar: ayır, tekrar enerjilenmeye karşı kilitle, gerilim yokluğunu doğrula, topraklayıp kısa devre et, yakındaki gerilimli bölümlere karşı koru." },
    { id: "iec-60204-1", name: "IEC 60204-1 Makinelerde güvenlik – Makinelerin elektrik donanımı – Genel kurallar", kind: "Standart", issuer: "IEC / TSE", binding: false,
      version: "IEC 60204-1 (güncel baskı katalogdan doğrulanmalı)", applies: ["konveyor"], needsCheck: true,
      note: "Makine elektrik donanımında durdurma kategorileri (0, 1, 2), acil durdurma, yeniden yol almanın önlenmesi ve kumanda devrelerini tanımlar." },
    { id: "iso-13850", name: "ISO 13850 Makinelerde güvenlik – Acil durdurma fonksiyonu – Tasarım ilkeleri", kind: "Standart", issuer: "ISO / TSE", binding: false,
      version: "ISO 13850 (güncel baskı katalogdan doğrulanmalı)", applies: ["konveyor"], needsCheck: true,
      note: "Acil durdurma düzeninin kilitlenmesi, sıfırlanmasının makineyi kendiliğinden başlatmaması ve durdurma kategorisi seçimi ilkelerini verir." },
    { id: "iec-62682", name: "IEC 62682 Proses endüstrisi için alarm sistemlerinin yönetimi", kind: "Standart", issuer: "IEC", binding: false,
      version: "IEC 62682 (ANSI/ISA-18.2 temelli; güncel baskı doğrulanmalı)", applies: ["konveyor"], needsCheck: true,
      note: "Alarm yaşam döngüsünü, alarm durumlarını (etkin/onaylanmamış, onaylanmış, normale dönmüş) ve operatör onayını tanımlar." }
  );
  list.checked = "2026-10-23";
  list.checkedText = "23 Ekim 2026";
  return list;
});
