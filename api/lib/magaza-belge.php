<?php
/*
 * VoltGuard Magaza belgeleri ve e-postalari: on bilgilendirme formu, mesafeli satis sozlesmesi, siparis ve durum
 * e-postalari. Odeme sayfasinda gosterilen metin, musteriye e-postayla giden ve sipariste saklanan metin AYNI
 * fonksiyonlardan uretilir (tek kaynak). Metinler TASLAKTIR: yayina almadan once hukuki inceleme gerekir.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

/**
 * Belge baglami. $order: siparis kaydi ya da odeme sayfasindaki taslak (ref yoksa "Sipariş onayında verilir").
 * Alanlar: customer, billing, shippingAddress, items, totals, rate, createdAt, payBy.
 */
function vgm_doc_context(array $order, array $firma, array $config): array
{
    return ['order' => $order, 'firma' => $firma, 'paymentHours' => (int)($config['paymentHours'] ?? 24)];
}

/**
 * Satici kimligi: firma.json'da dolu olan alanlar yazilir, bos (null) alanlarin satiri atlanir; koseli parantezli yer tutucu
 * ASLA basilmaz (P1-01). Adres bossa kisa adres (adresKisa) kullanilir.
 */
function vgm_doc_seller(array $f): string
{
    $val = static fn($v): string => is_string($v) && trim($v) !== '' ? trim($v) : '';
    $rows = [
        ['Unvan', $val($f['unvan'] ?? null)],
        ['Adres (cayma ve diğer bildirimler için)', $val($f['adres'] ?? null) !== '' ? $val($f['adres']) : $val($f['adresKisa'] ?? null)],
        ['Telefon', $val($f['telefon'] ?? null)],
        ['E-posta', $val($f['eposta'] ?? null)],
        ['Web sitesi', $val($f['web'] ?? null) !== '' ? $val($f['web']) : 'https://voltguard.com.tr'],
        ['MERSİS No', $val($f['mersis'] ?? null)],
        ['Vergi Dairesi', $val($f['vergiDairesi'] ?? null)],
        ['Vergi No', $val($f['vkn'] ?? null)],
        ['Ticaret Sicil No', $val($f['ticaretSicil'] ?? null)],
        ['Müdür(ler)', $val($f['mudur'] ?? null)],
        ['Taahhüt edilen / ödenen sermaye', $val($f['sermaye'] ?? null)],
        ['KEP adresi', $val($f['kep'] ?? null)],
        ['ETBİS kaydı', $val($f['etbis'] ?? null)],
    ];
    $lines = [];
    foreach ($rows as $r) {
        if ($r[1] !== '') {
            $lines[] = $r[0] . ': ' . $r[1];
        }
    }
    return implode("\n", $lines);
}

/** Belge basligindaki "(TASLAK)" eki: firma.json belgeOnay true olana kadar yazilir (P1-02). */
function vgm_doc_draft_tag(array $f): string
{
    return ($f['belgeOnay'] ?? false) === true ? '' : ' (TASLAK)';
}

function vgm_doc_buyer(array $o): string
{
    $b = $o['billing'] ?? [];
    $s = $o['shippingAddress'] ?? [];
    $lines = ['Ad Soyad / Unvan: ' . (($b['type'] ?? '') === 'kurumsal' && ($b['company'] ?? '') !== '' ? $b['company'] : ($o['customer']['name'] ?? '')),
        'E-posta: ' . ($o['customer']['email'] ?? ''),
        'Telefon: ' . ($o['customer']['phone'] ?? ''),
        'Teslimat adresi: ' . trim(($s['address'] ?? '') . ' ' . ($s['district'] ?? '') . ' / ' . ($s['city'] ?? '')),
        'Fatura adresi: ' . trim(($b['address'] ?? '') . ' ' . ($b['district'] ?? '') . ' / ' . ($b['city'] ?? ''))];
    return implode("\n", $lines);
}

function vgm_doc_items(array $o): string
{
    $lines = [];
    foreach ($o['items'] ?? [] as $it) {
        $lines[] = '- ' . $it['name'] . ((($it['brand'] ?? '') !== '') ? ', marka: ' . $it['brand'] : '')
            . ((($it['mpn'] ?? '') !== '') ? ', model/kod: ' . $it['mpn'] : '') . ' — ' . $it['qty'] . ' ' . ($it['unit'] ?? 'adet')
            . ' × ' . vgm_fmt_try((float)$it['unitTryGross']) . ' = ' . vgm_fmt_try((float)$it['lineTryGross']) . ' (KDV %' . $it['vat'] . ' dahil)';
        foreach (is_array($it['specs'] ?? null) ? $it['specs'] : [] as $sp) {
            $lines[] = '    · ' . $sp[0] . ': ' . $sp[1];
        }
        $days = isset($it['deliveryDays']) ? (int)$it['deliveryDays'] : 0;
        $lines[] = '    · Tahmini teslim süresi: ' . ($days > 0 && $days <= 30 ? $days . ' gün' : 'en geç 30 gün');
        if (($it['customMade'] ?? false) === true) {
            $lines[] = '    · Kişiye özel hazırlanan ürün: cayma hakkı kullanılamaz.';
        }
    }
    $t = $o['totals'] ?? [];
    $lines[] = '';
    $lines[] = 'Ara toplam (KDV hariç): ' . vgm_fmt_try((float)($t['tryNet'] ?? 0));
    $lines[] = 'KDV: ' . vgm_fmt_try((float)($t['tryVat'] ?? 0));
    $lines[] = 'Kargo: ' . (((float)($t['shippingTry'] ?? 0)) > 0 ? vgm_fmt_try((float)$t['shippingTry']) : 'Ücretsiz');
    $lines[] = 'Toplam (tüm vergiler dahil): ' . vgm_fmt_try((float)($t['tryGross'] ?? 0));
    if (isset($o['rate']['usdTry'], $o['rate']['date'])) {
        $lines[] = 'Fiyatlar ' . date('d.m.Y', (int)strtotime((string)$o['rate']['date'])) . ' tarihli TCMB döviz kuru esas alınarak güncellenen fiyat listesine göredir ve sipariş anında '
            . 'Türk lirası olarak sabitlenmiştir.';
    }
    return implode("\n", $lines);
}

function vgm_doc_payment(array $ctx): string
{
    $f = $ctx['firma'];
    $o = $ctx['order'];
    $ref = $o['ref'] ?? '(sipariş numarası sipariş onayında verilir)';
    return "Ödeme yalnızca havale/EFT ile yapılır.\n"
        . 'Banka: ' . $f['banka']['ad'] . "\n"
        . 'Hesap sahibi: ' . $f['banka']['hesapSahibi'] . "\n"
        . 'IBAN: ' . $f['banka']['iban'] . "\n"
        . 'Tutar: ' . vgm_fmt_try((float)($o['totals']['tryGross'] ?? 0)) . "\n"
        . 'Açıklama: ' . $ref . "\n"
        . 'Ödeme süresi: sipariş anından itibaren ' . $ctx['paymentHours'] . " saat.\n"
        . 'Son ödeme zamanı: ' . (isset($o['payBy']) ? vgm_local((int)$o['payBy']) . ' TSİ' : 'sipariş onayında bildirilir') . "\n"
        . "Bu sipariş için TL tutar sabittir; ödeme gününe kadar kur değişiminden etkilenmez.\n"
        . "Süresinde tam tutar ödenmezse sipariş bedelsiz iptal olur; eksik tutarda ödeme yapılmışsa sipariş yine iptal olur ve ödenen kısım "
        . "en geç 14 gün içinde iade edilir. İptalden sonra güncel fiyatla yeni sipariş verilebilir.";
}

/** Siparis numarasi, tarih ve belge surumu. */
function vgm_doc_meta(array $ctx): string
{
    $o = $ctx['order'];
    $lines = ['Sipariş numarası: ' . (is_string($o['ref'] ?? null) && $o['ref'] !== '' ? $o['ref'] : 'sipariş onayında verilir')];
    if (isset($o['createdAt'])) {
        $lines[] = 'Düzenlenme tarihi: ' . vgm_local((int)$o['createdAt']) . ' TSİ';
    }
    $lines[] = 'Metin sürümü: ' . (string)($ctx['firma']['belgeSurumu'] ?? '');
    return implode("\n", $lines);
}

/** Teslimat kosullari (on bilgilendirme ve sozlesmede ayni metin). */
function vgm_doc_delivery(): string
{
    return "Ürünler yalnızca Türkiye içindeki teslimat adreslerine kargo ile gönderilir; yurt dışına gönderim yapılmaz.\n"
        . "Teslim süresi, siparişin satıcıya ulaştığı andan itibaren en geç 30 gündür. Ürün için daha kısa bir tahmini süre varsa "
        . "ürün sayfasında belirtilir. Sipariş, ödeme satıcının hesabına geçtikten sonra hazırlanır.\n"
        . "Birden fazla ürün içeren siparişler ayrı paketler halinde ve farklı günlerde teslim edilebilir.\n"
        . "Kargo ücreti yukarıdaki fiyat bilgisinde gösterilmiştir; bunun dışında teslimat için ücret alınmaz.\n"
        . "Ürün, alıcıya veya alıcının kargo firması dışında belirlediği üçüncü kişiye teslim edilinceye kadar oluşan kayıp ve "
        . "hasarlardan satıcı sorumludur. Teslim sırasında paketi kontrol etmeniz önerilir; paket hasarlıysa kargo görevlisine hasar "
        . "tespit tutanağı tutturun ve durumu satıcıya bildirin. Tutanak tutulmamış olması yasal haklarınızı ortadan kaldırmaz.\n"
        . "Satıcı, siparişin yerine getirilmesinin imkânsızlaştığını öğrenirse bunu öğrendiği tarihten itibaren 3 gün içinde alıcıya "
        . "e-postayla bildirir ve tahsil ettiği tüm tutarı bildirim tarihinden itibaren en geç 14 gün içinde iade eder. Ürünün stokta "
        . "bulunmaması imkânsızlık sayılmaz. Satıcı ürünü belirtilen süre içinde teslim edemezse alıcı sözleşmeyi feshedebilir; bu "
        . "durumda teslimat masrafları dahil ödenen tüm tutar, fesih bildiriminden itibaren 14 gün içinde kanuni faiziyle birlikte iade edilir.";
}

/** Cayma hakki: sure, bildirim, geri gonderim, iade, istisnalar. */
function vgm_doc_withdrawal(array $f): string
{
    $carrier = is_string($f['iadeKargo'] ?? null) && trim($f['iadeKargo']) !== ''
        ? trim($f['iadeKargo']) : 'cayma bildiriminin alınmasından sonra alıcıya e-postayla bildirilir';
    return "Alıcı tüketici ise herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin 14 gün içinde sözleşmeden cayabilir. "
        . "Süre, ürünün alıcıya veya alıcının belirlediği üçüncü kişiye (kargo firması hariç) teslim edildiği gün başlar; birden fazla "
        . "parça halinde teslim edilen siparişlerde son parçanın teslim alındığı gün başlar. Alıcı, ürün teslim edilmeden önce de cayma "
        . "hakkını kullanabilir.\n"
        . 'Cayma bildirimi: süre içinde, sipariş numarası belirtilerek ' . $f['eposta'] . ' adresine e-postayla, ' . $f['telefon']
        . " numarasından telefonla veya satıcının adresine yazılı olarak yapılır. Bildirimin yapıldığını ispat yükü alıcıdadır; bu nedenle "
        . "e-posta veya form kullanılması, telefonla bildirildiyse e-postayla da teyit edilmesi önerilir. Örnek cayma formu "
        . vg_site_url() . "/magaza/iade-ve-cayma.html sayfasındadır; formun kullanılması zorunlu değildir. Satıcı, bildirimin ulaştığını "
        . "e-postayla teyit eder.\n"
        . "Ürünün geri gönderilmesi: alıcı, cayma bildiriminden itibaren 14 gün içinde (bu süre satıcının alıcı lehine uyguladığı süredir) ürünü, varsa aksesuar ve belgeleriyle birlikte "
        . 'satıcının bildireceği iade adresine gönderir. İade için belirlenen kargo firması: ' . $carrier . '. '
        . "Ürün bu kargo firmasıyla gönderilirse iade kargo ücreti alıcıdan alınmaz. Alıcı başka bir kargo firması kullanırsa "
        . "cayma hakkı ortadan kalkmaz; yalnızca iade kargo bedeli alıcıya ait olabilir.\n"
        . "Bedelin iadesi: satıcı, ürünün iade için belirtilen kargo firmasına teslim edildiği tarihten (ürün henüz teslim edilmemişse "
        . "cayma bildiriminin ulaştığı tarihten) itibaren en geç 14 gün içinde, kargo ücreti dahil tahsil ettiği tüm tutarı tek seferde ve "
        . "alıcıya hiçbir masraf yüklemeden, ödemenin yapıldığı banka hesabına ya da alıcının kendi adına kayıtlı olarak bildirdiği "
        . "IBAN'a havale/EFT ile iade eder.\n"
        . "Alıcı, cayma süresi içinde ürünü işleyişine, teknik özelliklerine ve kullanım talimatlarına uygun kullanmadığı takdirde "
        . "oluşan değişiklik ve bozulmalardan sorumludur.\n"
        . "Cayma hakkı kullanılamayan ürünler: alıcının istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan ürünler (örneğin "
        . "alıcının istediği ölçüde kesilen kablo veya alıcıya özel hazırlanan set). Bu nitelikteki ürünler ürün sayfasında ayrıca belirtilir.\n"
        . "Ürünü ticari veya mesleki amaçla satın alan alıcılar için 6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği'ndeki "
        . "cayma hakkı uygulanmaz; bu alıcılar bakımından Türk Borçlar Kanunu ve Türk Ticaret Kanunu hükümleri geçerlidir ve alıcı teslim aldığı malı "
        . "gecikmeksizin muayene edip ayıpları süresinde bildirmekle yükümlüdür (TTK md. 23). Alıcının tüketici sayılması fatura türüne değil satın alma "
        . "amacına bağlıdır; tereddüt halinde sipariş tüketici siparişi sayılır.";
}

/** Ayipli mal ve garanti. */
function vgm_doc_defects(): string
{
    return "Satıcı ürünü sözleşmeye uygun ve ayıpsız teslim etmekle yükümlüdür. Ürün ayıplı çıkarsa tüketici, 6502 sayılı Kanun "
        . "md. 11 uyarınca şu seçimlik haklardan birini kullanabilir: bedel iadesiyle sözleşmeden dönme, ayıp oranında bedelden indirim, "
        . "ücretsiz onarım veya ayıpsız misliyle değişim. Ücretsiz onarım veya değişim, talebin satıcıya ulaşmasından itibaren en geç "
        . "30 iş günü içinde yerine getirilir. Ayıplı maldan sorumluluk teslim tarihinden itibaren 2 yıllık zamanaşımına tabidir; "
        . "teslimden sonraki 6 ay içinde ortaya çıkan ayıpların teslim anında var olduğu kabul edilir.\n"
        . "Garanti: Garanti Belgesi Yönetmeliği kapsamındaki ürünlerde (örneğin evlerde kullanılan güneş enerjisi sistemleri, "
        . "akümülatörler, kesintisiz güç kaynakları, invertörler ve regülatörler) garanti süresi teslimden itibaren en az 2 yıldır ve "
        . "garanti belgesi ve Türkçe kullanım kılavuzu, ürün bazında hazır olduğunda alıcıya kâğıt üzerinde veya elektronik ortamda iletilir; "
        . "bu belgeleri satıcıdan talep edebilirsiniz. "
        . "Diğer ürünlerde üretici garantisi varsa süresi ürün sayfasında belirtilir. Garanti, satıcının yasal ayıp sorumluluğunu "
        . "ortadan kaldırmaz.";
}

/** Sikayet ve uyusmazlik. */
function vgm_doc_disputes(array $f): string
{
    return 'Talep ve şikâyetler için: ' . $f['eposta'] . ', ' . $f['telefon'] . ".\n"
        . "Tüketici, uyuşmazlıklarda Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar içinde yerleşim yerindeki veya "
        . "işlemin yapıldığı yerdeki tüketici hakem heyetine, bu sınırların üzerindeki uyuşmazlıklarda arabulucuya başvurduktan "
        . "sonra tüketici mahkemesine başvurabilir.";
}

/** Fatura bilgisi. */
function vgm_doc_invoice(): string
{
    return "Satış faturası satıcı tarafından e-Arşiv fatura olarak düzenlenir ve alıcının e-posta adresine elektronik ortamda "
        . "gönderilir. Sevk belgesi düzenlemesi tedarikçiyle birlikte sağlanır. Kurumsal alıcılarda fatura, siparişte bildirilen unvan, vergi dairesi ve vergi numarasıyla düzenlenir.";
}

/** Siparisin verilmesi, duzeltilmesi, teyidi ve metnin saklanmasi (6563 md. 3-4). */
function vgm_doc_formation(): string
{
    return "Sipariş, ödeme sayfasında bilgilerin girilmesi, ön bilgilendirme formunun ve mesafeli satış sözleşmesinin "
        . "onaylanması ve \"Siparişi onayla ve gönder\" düğmesine basılmasıyla verilir. Onaydan önce sepet ve form bilgileri "
        . "gözden geçirilip düzeltilebilir. Siparişi göndermekle alıcı ödeme yükümlülüğü altına girer. Sipariş, alındığı ekranda ve "
        . "e-postayla gecikmeksizin teyit edilir. Bu form ve sözleşme sipariş kaydıyla birlikte 3 yıl saklanır, alıcının e-posta "
        . "adresine gönderilir ve talep halinde yeniden iletilir.";
}

/** On bilgilendirme formu (duz metin). */
function vgm_doc_preinfo(array $ctx): string
{
    $o = $ctx['order'];
    $f = $ctx['firma'];
    return 'ÖN BİLGİLENDİRME FORMU' . vgm_doc_draft_tag($f) . "\n" . vgm_doc_meta($ctx) . "\n\n"
        . "Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca sipariş "
        . "verilmeden önce alıcıyı bilgilendirmek için düzenlenmiştir. Form, mesafeli satış sözleşmesinin ayrılmaz parçasıdır ve "
        . "taraflar açıkça kararlaştırmadıkça değiştirilemez.\n\n"
        . "1. SATICI\n" . vgm_doc_seller($f) . "\n\n"
        . "2. ALICI\n" . vgm_doc_buyer($o) . "\n\n"
        . "3. ÜRÜNLERİN TEMEL NİTELİKLERİ VE FİYATI\nÜrünlerin marka, model, ana teknik özellikleri ve ürün başına tahmini teslim süresi "
        . "aşağıda yer alır. Tüm fiyatlar Türk lirası ve KDV dahildir.\n" . vgm_doc_items($o) . "\n\n"
        . "4. ÖDEME\n" . vgm_doc_payment($ctx) . "\nKredi kartıyla ödeme şu anda kabul edilmez.\n\n"
        . "5. TESLİMAT\n" . vgm_doc_delivery() . "\n\n"
        . "6. FATURA\n" . vgm_doc_invoice() . "\n\n"
        . "7. CAYMA HAKKI\n" . vgm_doc_withdrawal($f) . "\n\n"
        . "8. AYIPLI ÜRÜN VE GARANTİ\n" . vgm_doc_defects() . "\n\n"
        . "9. SİPARİŞİN VERİLMESİ VE METNİN SAKLANMASI\n" . vgm_doc_formation() . "\n\n"
        . "10. KİŞİSEL VERİLER\nSipariş için verdiğiniz kişisel veriler siparişin yerine getirilmesi ve yasal yükümlülükler için "
        . 'işlenir. Ayrıntılar: ' . vg_site_url() . "/magaza/kvkk-aydinlatma.html\n\n"
        . "11. ŞİKÂYET VE UYUŞMAZLIK\n" . vgm_doc_disputes($f) . "\n";
}

/** Mesafeli satis sozlesmesi (duz metin). */
function vgm_doc_contract(array $ctx): string
{
    $o = $ctx['order'];
    $f = $ctx['firma'];
    return 'MESAFELİ SATIŞ SÖZLEŞMESİ' . vgm_doc_draft_tag($f) . "\n" . vgm_doc_meta($ctx) . "\n\n"
        . "MADDE 1 – TARAFLAR\nSATICI\n" . vgm_doc_seller($f) . "\n\nALICI\n" . vgm_doc_buyer($o) . "\n\n"
        . "MADDE 2 – KONU VE KAPSAM\nİşbu sözleşmenin konusu, alıcının satıcıya ait " . vg_site_url() . "/magaza/ adresinden "
        . "elektronik ortamda sipariş verdiği, aşağıda nitelikleri ve satış fiyatı belirtilen ürünlerin satışı ve teslimidir. "
        . "Taraflar, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümlerine tabidir. "
        . "Ön bilgilendirme formu bu sözleşmenin ayrılmaz parçasıdır.\n\n"
        . "MADDE 3 – ÜRÜNLER VE BEDEL\nÜrünlerin marka, model, ana teknik özellikleri ve ürün başına tahmini teslim süresi aşağıda yer alır. "
        . "Tüm fiyatlar Türk lirası ve KDV dahildir.\n" . vgm_doc_items($o) . "\n"
        . "Satıcı, sipariş sonrasında bu bedeli tek taraflı olarak değiştiremez.\n\n"
        . "MADDE 4 – ÖDEME\n" . vgm_doc_payment($ctx) . "\nKredi kartıyla ödeme şu anda kabul edilmez. Süresi dolduktan sonra "
        . "yapılan ödemeler en geç 14 gün içinde ödemenin geldiği hesaba iade edilir; alıcı aynı ürünler için açıkça yeni sipariş verir ve yeni ön "
        . "bilgilendirme formunu onaylarsa ödeme yeni siparişe mahsup edilebilir.\n\n"
        . "MADDE 5 – TESLİMAT\n" . vgm_doc_delivery() . "\n\n"
        . "MADDE 6 – SATICININ DİĞER YÜKÜMLÜLÜKLERİ\nSatıcı ürünü sözleşmeye ve ürün sayfasındaki bilgilere uygun, sağlam ve "
        . "varsa Türkçe kullanım kılavuzu ve garanti belgesini alıcıya iletir.\n" . vgm_doc_invoice() . "\n\n"
        . "MADDE 7 – ALICININ YÜKÜMLÜLÜKLERİ\nAlıcı, ödemeyi belirtilen süre içinde ve sipariş numarasını açıklamaya yazarak "
        . "yapar; siparişte verdiği iletişim, fatura ve teslimat bilgilerinin doğru olmasından sorumludur.\n\n"
        . "MADDE 8 – CAYMA HAKKI\n" . vgm_doc_withdrawal($f) . "\n\n"
        . "MADDE 9 – AYIPLI ÜRÜN VE GARANTİ\n" . vgm_doc_defects() . "\n\n"
        . "MADDE 10 – KİŞİSEL VERİLER\nSatıcı, alıcının kişisel verilerini 6698 sayılı Kanun kapsamında aydınlatma metninde açıklanan amaç ve hukuki sebeplerle işler. "
        . 'Aydınlatma metni: ' . vg_site_url() . "/magaza/kvkk-aydinlatma.html\n\n"
        . "MADDE 11 – ŞİKÂYET VE UYUŞMAZLIK\n" . vgm_doc_disputes($f) . "\n\n"
        . "MADDE 12 – YÜRÜRLÜK\n" . vgm_doc_formation() . " Alıcı, siparişi onaylamadan önce ön bilgilendirme formunu ve işbu "
        . "sözleşmeyi okuyup elektronik ortamda onaylar; sözleşme bu onayla kurulur.\n";
}

/** Musteri siparis e-postasi: odeme talimati + belgeler. Tedarikci bilgisi icermez. */
function vgm_mail_order_customer(array $order, array $ctx): bool
{
    $body = vg_greeting($order['customer']['name']) . "\n\n"
        . 'Siparişiniz ' . $order['ref'] . " numarasıyla alındı. Teşekkür ederiz.\n\n"
        . "ÖDEME BİLGİLERİ\n" . vgm_doc_payment($ctx) . "\n\n"
        . "SİPARİŞ ÖZETİ\n" . vgm_doc_items($order) . "\n\n"
        . "SATICI (fatura ve tedarikçi kaydınız için)\n" . vgm_doc_seller($ctx['firma']) . "\n\n"
        . 'Siparişinizi ' . vg_site_url() . '/magaza/siparis-takip.html adresinden sipariş numaranız ve e-posta adresinizle takip edebilirsiniz.' . "\n\n"
        . str_repeat('-', 60) . "\n" . ($order['docs']['preInfo'] ?? '') . "\n" . str_repeat('-', 60) . "\n" . ($order['docs']['contract'] ?? '') . "\n\n"
        . "VoltGuard\n" . vg_site_url() . "\n";
    return vg_mail_send($order['customer']['email'], 'VoltGuard siparişiniz ' . $order['ref'] . ' — ödeme bilgileri', $body, 'magaza-siparis');
}

/** Personel e-postasi: musteri, kalemler ve ozel tedarik kaynaklari. */
function vgm_mail_order_staff(array $order): bool
{
    $lines = ['Yeni mağaza siparişi ' . $order['ref'] . ' (' . vgm_local((int)$order['createdAt']) . ' TSİ)', '',
        'Müşteri: ' . $order['customer']['name'] . ' — ' . $order['customer']['phone'] . ' — ' . $order['customer']['email'],
        'Fatura: ' . ($order['billing']['type'] === 'kurumsal' ? 'Kurumsal ' . $order['billing']['company'] . ' / VD ' . $order['billing']['taxOffice'] . ' / VKN ' . $order['billing']['vkn'] : 'Bireysel'),
        '', 'KALEMLER', vgm_doc_items($order), '', 'TEDARİK KAYNAKLARI (yalnızca iç kullanım)'];
    foreach ($order['items'] as $it) {
        foreach (($order['private']['sources'][$it['id']] ?? []) as $src) {
            $lines[] = '- ' . $it['id'] . ' ' . $it['name'] . ': ' . $src['supplier'] . ' ' . $src['url']
                . (isset($src['costTry']) ? ' (son kontrol ' . vgm_fmt_try((float)$src['costTry']) . ')' : '');
        }
    }
    $lines[] = '';
    $lines[] = 'Yapılacaklar: ödeme hesaba geçince panelden "Ödeme alındı" işaretleyin, tedarikçiden siparişi verin, kargo takip numarasını girin.';
    $lines[] = vg_site_url() . '/hesap/magaza-panel.html#' . $order['ref'];
    return vg_mail_send('info@voltguard.com.tr', 'Mağaza siparişi ' . $order['ref'] . ' — ' . vgm_fmt_try((float)$order['totals']['tryGross']),
        implode("\n", $lines), 'magaza-personel', $order['customer']['email']);
}

/** Durum degisikligi e-postasi (panelden "musteriye bildir" secilirse). */
function vgm_mail_status(array $order, string $publicNote): bool
{
    $label = VGM_STATUS_LABELS[$order['status']] ?? $order['status'];
    $body = vg_greeting($order['customer']['name']) . "\n\n"
        . $order['ref'] . ' numaralı siparişinizin durumu: ' . $label . ".\n"
        . ($publicNote !== '' ? "\n" . $publicNote . "\n" : '')
        . (is_array($order['tracking'] ?? null) ? "\nKargo: " . $order['tracking']['company'] . ' — takip no ' . $order['tracking']['code'] . "\n" : '')
        . "\nSipariş takibi: " . vg_site_url() . "/magaza/siparis-takip.html\n\nVoltGuard\n" . vg_site_url() . "\n";
    return vg_mail_send($order['customer']['email'], 'VoltGuard siparişiniz ' . $order['ref'] . ': ' . $label, $body, 'magaza-durum');
}
