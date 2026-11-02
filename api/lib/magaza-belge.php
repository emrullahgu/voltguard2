<?php
/*
 * VoltGuard Magaza belgeleri ve e-postalari: on bilgilendirme formu, mesafeli satis sozlesmesi, siparis ve durum
 * e-postalari. Odeme sayfasinda gosterilen metin, musteriye e-postayla giden ve sipariste saklanan metin AYNI
 * fonksiyonlardan uretilir (tek kaynak). Metinler 2026-11-02 tarihli ic hukuki incelemeden gecti (firma.json belgeSurumu);
 * metin degisirse belgeSurumu guncellenir (ayni gun ikinci revizyon: YYYY-AA-GG.N). 2026-11-02.2: sozlesmenin kurulusu
 * teyit e-postasindan (saticinin baglayici teklifi) kesin tutarin suresinde odenmesine tasindi.
 *
 * TEYITLI SIPARIS TALEBI (sahibin karari, 2026-11-02): iki asama vardir.
 *  - talep: alici formu ve sozlesmeyi onaylayip talebi gonderir (satin alma teklifi). Tutarlar tahminidir, IBAN ve
 *    odeme talebi YOKTUR; "teyit gelmeden odeme yapmayin" yazar.
 *  - teyit: personel stok ve fiyati teyit eder (vgm_order_confirm); kesin tutarli form ve sozlesme IBAN'la birlikte
 *    e-postayla gider. Teyit e-postasi saticinin BAGLAYICI TEKLIFIDIR (talepten farklar e-postada yazar); sozlesme alici
 *    kesin tutari suresi icinde odeyince kurulur (kabul). Odeme yapilmazsa sozlesme kurulmaz, talep bedelsiz sona erer.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

/**
 * Belge baglami. $order: siparis kaydi ya da odeme sayfasindaki taslak (ref yoksa "talep gönderildiğinde verilir").
 * Alanlar: customer, billing, shippingAddress, items, totals, rate, createdAt, payBy, respondBy, confirmedAt.
 * stage: confirmedAt varsa ya da kayit teyitli talep akisindan once (dogrudan siparis) olusturulduysa "teyit" (kesin tutar,
 * odeme bilgisi; vgm_order_is_estimate), yoksa "talep".
 */
function vgm_doc_context(array $order, array $firma, array $config): array
{
    return ['order' => $order, 'firma' => $firma, 'paymentHours' => (int)($config['paymentHours'] ?? 24),
        'stage' => vgm_order_is_estimate($order) ? 'talep' : 'teyit'];
}

function vgm_doc_confirmed(array $ctx): bool
{
    return ($ctx['stage'] ?? 'talep') === 'teyit';
}

/**
 * Satici kimligi: firma.json'da dolu olan alanlar yazilir, bos (null) alanlarin satiri atlanir; koseli parantezli yer tutucu
 * ASLA basilmaz (P1-01). Adres bossa kisa adres (adresKisa) kullanilir. merkezAdres (ticaret sicilinde tescilli merkez)
 * isyeri adresinden farkliysa iki ayri satir yazilir (TTK md. 39/2; MSY md. 5/1-b,c).
 */
function vgm_doc_seller(array $f): string
{
    $val = static fn($v): string => is_string($v) && trim($v) !== '' ? trim($v) : '';
    $adres = $val($f['adres'] ?? null) !== '' ? $val($f['adres']) : $val($f['adresKisa'] ?? null);
    $merkez = $val($f['merkezAdres'] ?? null);
    $rows = [['Unvan', $val($f['unvan'] ?? null)]];
    if ($merkez !== '' && $merkez !== $adres) {
        $rows[] = ['Merkez (ticaret sicilinde tescilli) adres', $merkez];
        $rows[] = ['İşyeri adresi (cayma, iade ve diğer bildirimler için)', $adres];
    } else {
        $rows[] = ['Adres (cayma ve diğer bildirimler için)', $adres];
    }
    $rows = array_merge($rows, [
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
    ]);
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

function vgm_doc_items(array $o, bool $confirmed): string
{
    $lines = [];
    foreach ($o['items'] ?? [] as $it) {
        $head = '- ' . $it['name'] . ((($it['brand'] ?? '') !== '') ? ', marka: ' . $it['brand'] : '')
            . ((($it['mpn'] ?? '') !== '') ? ', model/kod: ' . $it['mpn'] : '') . ' — ' . $it['qty'] . ' ' . ($it['unit'] ?? 'adet');
        if (isset($it['unitTryGross']) && $it['unitTryGross'] !== null) {
            $head .= ' × ' . vgm_fmt_try((float)$it['unitTryGross']) . ' = ' . vgm_fmt_try((float)$it['lineTryGross']) . ' (KDV %' . $it['vat'] . ' dahil'
                . ($confirmed ? '' : ', tahmini') . ')';
        } else {
            $head .= ' — fiyat teyitte bildirilir (KDV %' . $it['vat'] . ' dahil olarak)';
        }
        $lines[] = $head;
        foreach (is_array($it['specs'] ?? null) ? $it['specs'] : [] as $sp) {
            $lines[] = '    · ' . $sp[0] . ': ' . $sp[1];
        }
        $days = isset($it['deliveryDays']) ? (int)$it['deliveryDays'] : 0;
        $lines[] = '    · Tahmini teslim süresi: ' . ($days > 0 && $days <= 30 ? $days . ' gün' : 'en geç 30 gün');
        if (!$confirmed && ($it['freight'] ?? false) === true) {
            $lines[] = '    · Ağır/hacimli ürün: nakliye ücreti teyitte bildirilir.';
        }
        if (($it['customMade'] ?? false) === true) {
            $lines[] = '    · Kişiye özel hazırlanan ürün: cayma hakkı kullanılamaz.';
        }
    }
    $t = $o['totals'] ?? [];
    $lines[] = '';
    if (!$confirmed) {
        $unpriced = (int)($t['unpriced'] ?? 0);
        $lines[] = 'Tahmini ara toplam (KDV hariç): ' . vgm_fmt_try((float)($t['tryNet'] ?? 0));
        $lines[] = 'Tahmini KDV: ' . vgm_fmt_try((float)($t['tryVat'] ?? 0));
        $lines[] = 'Kargo: teyitte bildirilir';
        $lines[] = 'Tahmini toplam (gösterilen fiyatlarla, KDV dahil): ' . vgm_fmt_try((float)($t['tryGross'] ?? 0));
        if ($unpriced > 0) {
            $lines[] = $unpriced . ' ürünün fiyatı tahmine dahil değildir; fiyatı teyitte bildirilir.';
        }
        $lines[] = 'Bu tutarlar bilgi amaçlıdır. Kesin birim fiyatlar, kargo ücreti ve tüm vergiler dahil toplam tutar Türk lirası olarak '
            . 'satıcının teyit e-postasında bildirilir; sözleşme, bu kesin tutarın süresi içinde ödenmesiyle kurulur.';
        return implode("\n", $lines);
    }
    $lines[] = 'Ara toplam (KDV hariç): ' . vgm_fmt_try((float)($t['tryNet'] ?? 0));
    $lines[] = 'KDV: ' . vgm_fmt_try((float)($t['tryVat'] ?? 0));
    $lines[] = 'Kargo: ' . (((float)($t['shippingTry'] ?? 0)) > 0 ? vgm_fmt_try((float)$t['shippingTry']) . ' (KDV dahil)' : 'Ücretsiz');
    $lines[] = 'Toplam (tüm vergiler dahil): ' . vgm_fmt_try((float)($t['tryGross'] ?? 0));
    $lines[] = 'Fiyatlar satıcının ' . vgm_local((int)$o['confirmedAt']) . ' TSİ tarihli stok ve fiyat teyidiyle Türk lirası olarak sabitlenmiştir'
        . (isset($o['rate']['date']) ? ' (' . date('d.m.Y', (int)strtotime((string)$o['rate']['date'])) . ' tarihli TCMB döviz kuru esas alınmıştır)' : '') . '.';
    return implode("\n", $lines);
}

/**
 * Teyitte talebe gore degisenler (musteriye gorunur cumleler): cikarilan urunler, degisen adetler, tahminden farkli ya da ilk
 * kez teyitte belirlenen birim fiyatlar. $o['request']['items'] (talep) ile $o['items'] (teyit) karsilastirilir; talep kaydi
 * yoksa (eski kayit) bos dizi. Kargo her teyitte ayrica bildirildigi icin burada yer almaz.
 */
function vgm_confirm_changes(array $o): array
{
    $req = is_array($o['request']['items'] ?? null) ? $o['request']['items'] : null;
    if ($req === null) {
        return [];
    }
    $now = [];
    foreach ($o['items'] ?? [] as $it) {
        $now[$it['id']] = $it;
    }
    $out = [];
    foreach ($req as $r) {
        $name = (string)$r['name'];
        $unit = (string)($r['unit'] ?? 'adet');
        if (!isset($now[$r['id']])) {
            $out[] = $name . ' (' . $r['qty'] . ' ' . $unit . ') teyit edilemedi ve siparişten çıkarıldı';
            continue;
        }
        $c = $now[$r['id']];
        if ((int)$c['qty'] !== (int)$r['qty']) {
            $out[] = $name . ': adet ' . $r['qty'] . ' ' . $unit . ' yerine ' . $c['qty'] . ' ' . $unit;
        }
        $was = $r['unitTryGross'] ?? null;
        if ($was === null) {
            $out[] = $name . ': birim fiyat teyitte belirlendi, ' . vgm_fmt_try((float)$c['unitTryGross']) . ' (KDV dahil)';
        } elseif (abs((float)$was - (float)$c['unitTryGross']) >= 0.005) {
            $out[] = $name . ': birim fiyat tahmini ' . vgm_fmt_try((float)$was) . ' yerine ' . vgm_fmt_try((float)$c['unitTryGross']) . ' (KDV dahil)';
        }
    }
    return $out;
}

/** Belgelerdeki "talebe gore degisiklikler" blogu (teyit asamasi; degisiklik yoksa bos). */
function vgm_doc_changes(array $ctx): string
{
    if (!vgm_doc_confirmed($ctx)) {
        return '';
    }
    $changes = vgm_confirm_changes($ctx['order']);
    return $changes ? "\nSipariş talebine göre değişiklikler:\n- " . implode("\n- ", $changes) . "\n" : '';
}

function vgm_doc_payment(array $ctx): string
{
    $f = $ctx['firma'];
    $o = $ctx['order'];
    $h = $ctx['paymentHours'];
    if (!vgm_doc_confirmed($ctx)) {
        /* Talep asamasi: IBAN ve odeme talebi YOK (sahibin karari). */
        return "Ödeme yalnızca havale/EFT ile yapılır.\n"
            . "Bu aşamada ödeme yapmayın: sipariş talebi için ödeme istenmez. Satıcı stok ve fiyatı teyit ettikten sonra kesin tutarı, "
            . "banka hesap bilgilerini ve son ödeme zamanını teyit e-postasıyla gönderir. Teyit e-postası gelmeden yapılan ödemeler "
            . "eşleştirilemeyebilir ve iade edilir.\n"
            . 'Ödeme süresi: teyit e-postasının gönderilmesinden itibaren ' . $h . " saat.\n"
            . "Teyit edilen TL tutar sabittir; ödeme gününe kadar kur değişiminden etkilenmez.\n"
            . "Süresinde tam tutar ödenmezse sözleşme kurulmaz ve talep hiçbir bedel veya ceza doğmadan sona erer.";
    }
    return "Ödeme yalnızca havale/EFT ile yapılır.\n"
        . 'Banka: ' . $f['banka']['ad'] . "\n"
        . 'Hesap sahibi: ' . $f['banka']['hesapSahibi'] . "\n"
        . 'IBAN: ' . $f['banka']['iban'] . "\n"
        . 'Tutar: ' . vgm_fmt_try((float)($o['totals']['tryGross'] ?? 0)) . "\n"
        . 'Açıklama: ' . ($o['ref'] ?? '') . "\n"
        . 'Ödeme süresi: teyit anından itibaren ' . $h . " saat.\n"
        . 'Son ödeme zamanı: ' . (isset($o['payBy']) && is_int($o['payBy']) ? vgm_local($o['payBy']) . ' TSİ' : 'teyit e-postasında bildirilir') . "\n"
        . "Bu sipariş için TL tutar sabittir; ödeme gününe kadar kur değişiminden etkilenmez.\n"
        . "Süresinde tam tutar ödenmezse sözleşme kurulmaz ve sipariş bedelsiz iptal olur. Eksik ödeme yapılmışsa satıcı bunu alıcıya e-postayla bildirir; fark süre "
        . "sonuna kadar tamamlanmazsa sipariş iptal olur ve ödenen kısım en geç 14 gün içinde iade edilir. İptalden sonra güncel fiyatla yeni "
        . "sipariş talebi gönderilebilir.";
}

/** Siparis numarasi, asama, tarih ve belge surumu. */
function vgm_doc_meta(array $ctx): string
{
    $o = $ctx['order'];
    $lines = ['Sipariş numarası: ' . (is_string($o['ref'] ?? null) && $o['ref'] !== '' ? $o['ref'] : 'talep gönderildiğinde verilir')];
    if (vgm_doc_confirmed($ctx)) {
        $lines[] = 'Aşama: satıcı teyidi (kesin tutarlar; satıcının bağlayıcı teklifi, sözleşme bu tutarın süresi içinde ödenmesiyle kurulur)';
        if (isset($o['createdAt'])) {
            $lines[] = 'Talep tarihi: ' . vgm_local((int)$o['createdAt']) . ' TSİ';
        }
        $lines[] = 'Teyit tarihi: ' . vgm_local((int)$o['confirmedAt']) . ' TSİ';
    } else {
        $lines[] = 'Aşama: sipariş talebi (tutarlar tahmini; sözleşme, teyit e-postasındaki kesin tutarın süresi içinde ödenmesiyle kurulur)';
        if (isset($o['createdAt'])) {
            $lines[] = 'Düzenlenme tarihi: ' . vgm_local((int)$o['createdAt']) . ' TSİ';
        }
    }
    $lines[] = 'Metin sürümü: ' . (string)($ctx['firma']['belgeSurumu'] ?? '');
    return implode("\n", $lines);
}

/** Teslimat kosullari (on bilgilendirme ve sozlesmede ayni metin). */
function vgm_doc_delivery(): string
{
    return "Ürünler yalnızca Türkiye içindeki teslimat adreslerine kargo ile gönderilir; yurt dışına gönderim yapılmaz.\n"
        . "Teslim süresi, sipariş talebinin satıcıya ulaştığı andan itibaren en geç 30 gündür. Ürün için daha kısa bir tahmini süre "
        . "varsa ürün sayfasında belirtilir. Sipariş, ödeme satıcının hesabına geçtikten sonra hazırlanır.\n"
        . "Birden fazla ürün içeren siparişler ayrı paketler halinde ve farklı günlerde teslim edilebilir.\n"
        . "Kargo ücreti teyit edilen fiyat bilgisinde gösterilir; bunun dışında teslimat için ücret alınmaz.\n"
        . "Ürün, alıcıya veya alıcının kargo firması dışında belirlediği üçüncü kişiye teslim edilinceye kadar oluşan kayıp ve "
        . "hasarlardan satıcı sorumludur. Teslim sırasında paketi kontrol etmeniz önerilir; paket hasarlıysa kargo görevlisine hasar "
        . "tespit tutanağı tutturun ve durumu satıcıya bildirin. Tutanak tutulmamış olması yasal haklarınızı ortadan kaldırmaz.\n"
        . "Satıcı, sözleşme kurulduktan sonra siparişin yerine getirilmesinin imkânsızlaştığını öğrenirse bunu öğrendiği tarihten itibaren "
        . "3 gün içinde alıcıya e-postayla bildirir ve tahsil ettiği tüm tutarı bildirim tarihinden itibaren en geç 14 gün içinde iade eder. "
        . "Stok ve fiyat sözleşmeden önce teyit edildiği için ürünün sonradan stokta bulunmaması imkânsızlık sayılmaz. Satıcı ürünü belirtilen "
        . "süre içinde teslim edemezse alıcı sözleşmeyi feshedebilir; bu durumda teslimat masrafları dahil ödenen tüm tutar, fesih "
        . "bildiriminden itibaren 14 gün içinde kanuni faiziyle birlikte iade edilir.";
}

/** Cayma hakki: sure, bildirim, geri gonderim, iade, istisnalar. */
function vgm_doc_withdrawal(array $f): string
{
    return "Alıcı tüketici ise herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin 14 gün içinde sözleşmeden cayabilir. "
        . "Süre, ürünün alıcıya veya alıcının belirlediği üçüncü kişiye (kargo firması hariç) teslim edildiği gün başlar; birden fazla "
        . "parça halinde teslim edilen siparişlerde son parçanın teslim alındığı gün başlar. Alıcı, ürün teslim edilmeden önce de cayma "
        . "hakkını kullanabilir.\n"
        . 'Cayma bildirimi: süre içinde, sipariş numarası belirtilerek ' . $f['eposta'] . ' adresine e-postayla, ' . $f['telefon']
        . " numarasından telefonla veya satıcının adresine yazılı olarak yapılır. Bildirimin yapıldığını ispat yükü alıcıdadır; bu nedenle "
        . "e-posta veya form kullanılması, telefonla bildirildiyse e-postayla da teyit edilmesi önerilir. Örnek cayma formu "
        . vg_site_url() . "/magaza/iade-ve-cayma.html sayfasındadır; formun kullanılması zorunlu değildir. Satıcı, bildirimin ulaştığını "
        . "e-postayla teyit eder.\n"
        . "Ürünün geri gönderilmesi: alıcı, cayma bildiriminden itibaren 14 gün içinde ürünü, varsa aksesuar ve belgeleriyle birlikte "
        . "satıcının bildireceği iade adresine gönderir. İade gönderisinin masrafı satıcıya aittir; alıcıdan hangi kargo firmasını kullanırsa "
        . "kullansın iade masrafı talep edilmez. Satıcı, alıcının bulunduğu yerde şubesi olmayan durumlarda ürünü ek ücret almadan "
        . "alıcıdan teslim alır.\n"
        . "Bedelin iadesi: satıcı, cayma bildiriminin kendisine ulaştığı tarihten itibaren en geç 14 gün içinde, ürünün alıcıya teslim "
        . "masrafları (kargo ücreti) dahil tahsil ettiği tüm ödemeleri tek seferde ve alıcıya hiçbir masraf yüklemeden, ödemenin yapıldığı "
        . "banka hesabına ya da alıcının kendi adına kayıtlı olarak bildirdiği IBAN'a havale/EFT ile iade eder.\n"
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
        . "akümülatörler, kesintisiz güç kaynakları, invertörler ve regülatörler) garanti süresi teslimden itibaren en az 2 yıldır. "
        . "Garanti belgesi ile Türkçe tanıtma ve kullanma kılavuzu ürünle birlikte kâğıt üzerinde veya elektronik ortamda teslim edilir. "
        . "Diğer ürünlerde üretici garantisi varsa süresi ürün sayfasında belirtilir. Garanti, satıcının yasal ayıp sorumluluğunu "
        . "ortadan kaldırmaz.";
}

/** Sikayet ve uyusmazlik. */
function vgm_doc_disputes(array $f): string
{
    return 'Talep ve şikâyetler için: ' . $f['eposta'] . ', ' . $f['telefon'] . ".\n"
        . "Tüketici, uyuşmazlıklarda Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar içinde (2026 yılı için 186.000 TL'nin "
        . "altındaki uyuşmazlıklarda) yerleşim yerindeki veya işlemin yapıldığı yerdeki tüketici hakem heyetine e-Devlet (TÜBİS) üzerinden "
        . "veya dilekçeyle; bu sınırın üzerindeki uyuşmazlıklarda 6502 sayılı Kanun md. 73/A uyarınca dava açmadan önce arabulucuya "
        . "başvurduktan sonra tüketici mahkemesine başvurabilir.";
}

/** Fatura bilgisi. */
function vgm_doc_invoice(): string
{
    return "Satış faturası satıcı tarafından e-Arşiv fatura olarak düzenlenir ve alıcının e-posta adresine elektronik ortamda "
        . "gönderilir. Ürün VoltGuard'ın anlaşmalı tedarikçisinin deposundan gönderilebilir; bu durumda da satıcı ve fatura düzenleyen "
        . "VoltGuard'dır. Kurumsal alıcılarda fatura, siparişte bildirilen unvan, vergi dairesi ve vergi numarasıyla düzenlenir.";
}

/**
 * Sipariş talebi, satıcı teyidi, sözleşmenin kuruluşu ve metnin saklanması (6563 md. 3-4; TBK md. 1-4): talep alıcıyı
 * bağlamaz (teklife davet); teyit e-postası satıcının bağlayıcı teklifidir ve kesin tutarlı ön bilgilendirme formunu içerir
 * (MSY md. 5-6: alıcı bağlanmadan önce kesin toplam fiyatı görür); sözleşme alıcının süresinde ödemesiyle (kabul) kurulur.
 * Talep ve teyit aşamasında aynı metin.
 */
function vgm_doc_formation(): string
{
    return "Sipariş talebi, ödeme sayfasında bilgilerin girilmesi, ön bilgilendirme formunun ve mesafeli satış sözleşmesinin onaylanması "
        . "ve \"Sipariş talebi gönder\" düğmesine basılmasıyla verilir. Göndermeden önce sepet ve form bilgileri gözden geçirilip düzeltilebilir. "
        . "Sipariş talebi alıcıyı bağlamaz; satıcıdan stok ve fiyat teyidiyle kesin teklif istenmesidir. Bu aşamada ödeme istenmez "
        . "ve alıcı ödeme yapmamalıdır.\n"
        . "Satıcı stok ve fiyatı tedarikçisiyle teyit eder ve talebe en geç " . VGM_CONFIRM_BUSINESS_DAYS . " iş günü içinde e-postayla yanıt verir. "
        . "Teyit e-postası satıcının bağlayıcı teklifidir: kesin birim fiyatları, kargo ücretini, tüm vergiler dahil toplam "
        . "tutarı, banka hesap bilgilerini, son ödeme zamanını ve kesin tutarlarla düzenlenmiş ön bilgilendirme formu ile "
        . "sözleşmeyi içerir. Teyit edilen ürünler, adetler ve tutarlar talepte gösterilenlerden farklı olabilir; farklar teyit "
        . "e-postasında ayrıca belirtilir. Satıcı bu teklifle son ödeme zamanına kadar bağlıdır.\n"
        . "Sözleşme, teyit e-postasındaki kesin tutarın süresi içinde ödenmesiyle kurulur; alıcı ödeme yapmadan önce kesin "
        . "tutarlı formu ve sözleşmeyi inceleyebilir. Alıcı süresi içinde ödeme yapmazsa sözleşme kurulmaz ve talep hiçbir bedel "
        . "veya ceza doğmadan sona erer.\n"
        . "Satıcı talebi teyit edemezse (ürün stokta yoksa veya fiyat değiştiyse) bunu e-postayla bildirir ve talep bedelsiz sona erer; bu "
        . "durumda alıcıdan hiçbir ödeme alınmamış olur ve tarafların birbirinden talebi kalmaz.\n"
        . "Talep alındığı ekranda ve e-postayla gecikmeksizin bildirilir. Bu form ve sözleşme sipariş kaydıyla birlikte 3 yıl saklanır, "
        . "alıcının e-posta adresine gönderilir ve talep halinde yeniden iletilir.";
}

/** On bilgilendirme formu (duz metin). */
function vgm_doc_preinfo(array $ctx): string
{
    $o = $ctx['order'];
    $f = $ctx['firma'];
    $intro = vgm_doc_confirmed($ctx)
        ? "Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, alıcının sipariş talebi "
            . "üzerine satıcının stok ve fiyat teyidinde bildirdiği kesin tutarlarla düzenlenmiştir ve satıcının bağlayıcı teklifiyle birlikte, "
            . "ödeme yapılmadan ve sözleşme kurulmadan önce alıcıya iletilir."
        : "Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca sipariş talebi "
            . "gönderilmeden önce alıcıyı bilgilendirmek için düzenlenmiştir. Satıcı talebi teyit ettiğinde form kesin tutarlarla yeniden "
            . "düzenlenir ve teyit e-postasıyla gönderilir.";
    return 'ÖN BİLGİLENDİRME FORMU' . vgm_doc_draft_tag($f) . "\n" . vgm_doc_meta($ctx) . "\n\n"
        . $intro . " Form, mesafeli satış sözleşmesinin ayrılmaz parçasıdır ve taraflar açıkça kararlaştırmadıkça değiştirilemez.\n\n"
        . "1. SATICI\n" . vgm_doc_seller($f) . "\n\n"
        . "2. ALICI\n" . vgm_doc_buyer($o) . "\n\n"
        . "3. ÜRÜNLERİN TEMEL NİTELİKLERİ VE FİYATI\nÜrünlerin marka, model, ana teknik özellikleri ve ürün başına tahmini teslim süresi "
        . "aşağıda yer alır. Tüm fiyatlar Türk lirası ve KDV dahildir.\n" . vgm_doc_items($o, vgm_doc_confirmed($ctx)) . "\n" . vgm_doc_changes($ctx) . "\n"
        . "4. ÖDEME\n" . vgm_doc_payment($ctx) . "\nKredi kartıyla ödeme şu anda kabul edilmez.\n\n"
        . "5. TESLİMAT\n" . vgm_doc_delivery() . "\n\n"
        . "6. FATURA\n" . vgm_doc_invoice() . "\n\n"
        . "7. CAYMA HAKKI\n" . vgm_doc_withdrawal($f) . "\n\n"
        . "8. AYIPLI ÜRÜN VE GARANTİ\n" . vgm_doc_defects() . "\n\n"
        . "9. SİPARİŞ TALEBİ, TEYİT VE METNİN SAKLANMASI\n" . vgm_doc_formation() . "\n\n"
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
        . "elektronik ortamda sipariş talebi gönderdiği ve satıcının stok ve fiyatını teyit ettiği, aşağıda nitelikleri ve satış fiyatı "
        . "belirtilen ürünlerin satışı ve teslimidir. "
        . "Alıcı tüketici ise taraflar 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümlerine "
        . "tabidir. Ürünü ticari veya mesleki amaçla satın alan alıcılar bakımından Türk Borçlar Kanunu ve Türk Ticaret Kanunu hükümleri "
        . "uygulanır. "
        . "Ön bilgilendirme formu bu sözleşmenin ayrılmaz parçasıdır.\n\n"
        . "MADDE 3 – ÜRÜNLER VE BEDEL\nÜrünlerin marka, model, ana teknik özellikleri ve ürün başına tahmini teslim süresi aşağıda yer alır. "
        . "Tüm fiyatlar Türk lirası ve KDV dahildir.\n" . vgm_doc_items($o, vgm_doc_confirmed($ctx)) . "\n" . vgm_doc_changes($ctx)
        . "Satıcı, teyit e-postasıyla bildirdiği bedeli son ödeme zamanına kadar ve sözleşme kurulduktan sonra tek taraflı olarak "
        . "değiştiremez.\n\n"
        . "MADDE 4 – ÖDEME\n" . vgm_doc_payment($ctx) . "\nKredi kartıyla ödeme şu anda kabul edilmez. Süresi dolduktan sonra "
        . "yapılan ödemeler en geç 14 gün içinde ödemenin geldiği hesaba iade edilir; alıcı aynı ürünler için açıkça yeni sipariş talebi "
        . "gönderir ve yeni ön bilgilendirme formunu onaylarsa ödeme, teyit edilen yeni siparişe mahsup edilebilir.\n\n"
        . "MADDE 5 – TESLİMAT\n" . vgm_doc_delivery() . "\n\n"
        . "MADDE 6 – SATICININ DİĞER YÜKÜMLÜLÜKLERİ\nSatıcı ürünü sözleşmeye ve ürün sayfasındaki bilgilere uygun, ayıpsız ve "
        . "sağlam olarak teslim eder; varsa Türkçe tanıtma ve kullanma kılavuzu ile garanti belgesini ürünle birlikte alıcıya iletir.\n" . vgm_doc_invoice() . "\n\n"
        . "MADDE 7 – ALICININ YÜKÜMLÜLÜKLERİ\nAlıcı, satıcının teyit e-postası gelmeden ödeme yapmaz; ödemeyi teyit e-postasında "
        . "belirtilen süre içinde ve sipariş numarasını açıklamaya yazarak yapar; talepte verdiği iletişim, fatura ve teslimat bilgilerinin "
        . "doğru olmasından sorumludur.\n\n"
        . "MADDE 8 – CAYMA HAKKI\n" . vgm_doc_withdrawal($f) . "\n\n"
        . "MADDE 9 – AYIPLI ÜRÜN VE GARANTİ\n" . vgm_doc_defects() . "\n\n"
        . "MADDE 10 – KİŞİSEL VERİLER\nSatıcı, alıcının kişisel verilerini 6698 sayılı Kanun kapsamında aydınlatma metninde açıklanan amaç ve hukuki sebeplerle işler. "
        . 'Aydınlatma metni: ' . vg_site_url() . "/magaza/kvkk-aydinlatma.html\n\n"
        . "MADDE 11 – ŞİKÂYET VE UYUŞMAZLIK\n" . vgm_doc_disputes($f) . "\n\n"
        . "MADDE 12 – YÜRÜRLÜK\n" . vgm_doc_formation() . "\nAlıcı, sipariş talebini göndermeden önce ön bilgilendirme formunu ve işbu "
        . "sözleşmeyi okuyup elektronik ortamda onaylar; kesin tutarlı form ve sözleşme teyit e-postasıyla yeniden iletilir. Sözleşme, teyit "
        . "e-postasındaki kesin tutarın süresi içinde ödenmesiyle kurulur.\n";
}

function vgm_mail_docs(array $order): string
{
    return str_repeat('-', 60) . "\n" . ($order['docs']['preInfo'] ?? '') . "\n" . str_repeat('-', 60) . "\n" . ($order['docs']['contract'] ?? '');
}

/** Musteri talep e-postasi: "talebiniz alindi, teyit gelmeden odeme yapmayin" + tahmini ozet + belgeler. IBAN YOK. */
function vgm_mail_request_customer(array $order): bool
{
    $f = vgm_firma();
    $respond = isset($order['respondBy']) && is_int($order['respondBy']) ? vgm_local($order['respondBy']) . ' TSİ' : '';
    $body = vg_greeting($order['customer']['name']) . "\n\n"
        . 'Sipariş talebiniz ' . $order['ref'] . " numarasıyla alındı. Teşekkür ederiz.\n\n"
        . "Talebiniz alındı; stok ve fiyat teyidinden sonra kesin tutar ve ödeme bilgileri size e-postayla gönderilecek.\n"
        . "TEYİT GELMEDEN ÖDEME YAPMAYIN. Bu aşamada sizden ödeme istenmez.\n\n"
        . 'Yanıt süresi: en geç ' . VGM_CONFIRM_BUSINESS_DAYS . ' iş günü' . ($respond !== '' ? ' (' . $respond . ' itibarıyla)' : '') . ".\n"
        . "Ürünleri teyit edemezsek (stok yoksa veya fiyat değiştiyse) size e-postayla bildiririz ve talebiniz bedelsiz kapanır.\n"
        . "Teyit e-postasındaki tutar talepteki tahmini tutardan farklı olabilir; ödeme yapmazsanız sipariş bedelsiz iptal olur.\n\n"
        . "TALEP ÖZETİ\n" . vgm_doc_items($order, false) . "\n\n"
        . "SATICI BİLGİLERİ\n" . vgm_doc_seller($f) . "\n\n"
        . 'Talebinizi ' . vg_site_url() . '/magaza/siparis-takip.html adresinden sipariş numaranız ve e-posta adresinizle takip edebilirsiniz.' . "\n\n"
        . vgm_mail_docs($order) . "\n\n"
        . "VoltGuard\n" . vg_site_url() . "\n";
    return vg_mail_send($order['customer']['email'], 'VoltGuard sipariş talebiniz ' . $order['ref'] . ' alındı — teyit bekleniyor', $body, 'magaza-talep');
}

/** Personel e-postasi: yeni talep, musteri, kalemler ve ozel tedarik kaynaklari. */
function vgm_mail_request_staff(array $order): bool
{
    $lines = ['Yeni mağaza sipariş TALEBİ ' . $order['ref'] . ' (' . vgm_local((int)$order['createdAt']) . ' TSİ)', '',
        'Müşteri: ' . $order['customer']['name'] . ' — ' . $order['customer']['phone'] . ' — ' . $order['customer']['email'],
        'Fatura: ' . ($order['billing']['type'] === 'kurumsal' ? 'Kurumsal ' . $order['billing']['company'] . ' / VD ' . $order['billing']['taxOffice'] . ' / VKN ' . $order['billing']['vkn'] : 'Bireysel'),
        'Yanıt son zamanı: ' . (isset($order['respondBy']) ? vgm_local((int)$order['respondBy']) . ' TSİ' : '-'),
        '', 'KALEMLER (tahmini fiyatlar)', vgm_doc_items($order, false), '', 'TEDARİK KAYNAKLARI (yalnızca iç kullanım)'];
    foreach ($order['items'] as $it) {
        foreach (($order['private']['sources'][$it['id']] ?? []) as $src) {
            $lines[] = '- ' . $it['id'] . ' ' . $it['name'] . ': ' . $src['supplier'] . ' ' . $src['url']
                . (isset($src['costTry']) ? ' (son kontrol ' . vgm_fmt_try((float)$src['costTry']) . ')' : '');
        }
    }
    $lines[] = '';
    $lines[] = 'Yapılacaklar: stok ve fiyatı tedarikçiyle teyit edin; panelde birim fiyatları (KDV dahil) ve kargo ücretini girip '
        . '"Onayla ve ödeme bilgisi gönder" ya da "Reddet" seçin. Müşteriye henüz ödeme bilgisi gönderilmedi.';
    $lines[] = vg_site_url() . '/hesap/magaza-panel.html#' . $order['ref'];
    return vg_mail_send('info@voltguard.com.tr', 'Mağaza sipariş talebi ' . $order['ref'] . ' — teyit bekliyor (tahmini ' . vgm_fmt_try((float)$order['totals']['tryGross']) . ')',
        implode("\n", $lines), 'magaza-personel', $order['customer']['email']);
}

/**
 * Teyit e-postasi = saticinin baglayici teklifi: kesin tutar, IBAN, siparis numarasi, son odeme zamani, talebe gore
 * degisiklikler ($changes, vgm_confirm_changes) ve kesin belgeler. Sozlesme musteri bu tutari suresinde odeyince kurulur.
 */
function vgm_mail_confirm_customer(array $order, array $ctx, string $publicNote, array $changes = []): bool
{
    $body = vg_greeting($order['customer']['name']) . "\n\n"
        . $order['ref'] . " numaralı sipariş talebinizdeki ürünlerin stok ve fiyatını teyit ettik. Bu e-posta bağlayıcı teklifimizdir: "
        . "aşağıdaki kesin tutarı son ödeme zamanına kadar ödediğinizde mesafeli satış sözleşmesi kurulur ve siparişiniz kesinleşir. "
        . "Ödeme yapmadan önce lütfen aşağıdaki kesin tutarlı ön bilgilendirme formunu ve sözleşmeyi okuyun.\n"
        . ($publicNote !== '' ? "\n" . $publicNote . "\n" : '')
        . "\nTALEBİNİZE GÖRE DEĞİŞİKLİKLER\n"
        . ($changes
            ? '- ' . implode("\n- ", $changes) . "\nBu değişiklikleri kabul etmiyorsanız ödeme yapmayın; talebiniz son ödeme zamanında bedelsiz kapanır. "
                . "Sorularınız için bu e-postayı yanıtlayabilirsiniz.\n"
            : "Teyit edilen ürünler, adetler ve birim fiyatlar talebinizdekiyle aynıdır.\n")
        . "\nÖDEME BİLGİLERİ\n" . vgm_doc_payment($ctx) . "\n\n"
        . "Ödeme yapmazsanız sözleşme kurulmaz ve talebiniz son ödeme zamanında bedelsiz kapanır; sizden herhangi bir ücret istenmez.\n\n"
        . "SİPARİŞ ÖZETİ (kesin tutarlar)\n" . vgm_doc_items($order, true) . "\n\n"
        . "SATICI BİLGİLERİ (sözleşmenin tarafı ve faturayı düzenleyen satıcı)\n" . vgm_doc_seller($ctx['firma']) . "\n\n"
        . 'Siparişinizi ' . vg_site_url() . '/magaza/siparis-takip.html adresinden sipariş numaranız ve e-posta adresinizle takip edebilirsiniz.' . "\n\n"
        . vgm_mail_docs($order) . "\n\n"
        . "VoltGuard\n" . vg_site_url() . "\n";
    return vg_mail_send($order['customer']['email'], 'VoltGuard siparişiniz ' . $order['ref'] . ' teyit edildi — ödeme bilgileri ve kesin teklif', $body, 'magaza-siparis');
}

/** Ret e-postasi: talep bedelsiz kapandi, odeme alinmadi. */
function vgm_mail_reject_customer(array $order, string $message): bool
{
    $body = vg_greeting($order['customer']['name']) . "\n\n"
        . $order['ref'] . " numaralı sipariş talebinizi teyit edemedik.\n"
        . ($message !== '' ? $message . "\n" : '')
        . "\nTalebiniz bedelsiz kapatıldı. Sizden herhangi bir ödeme alınmadı ve bir yükümlülüğünüz bulunmuyor.\n"
        . "Benzer ürün veya termin için bu e-postayı yanıtlayabilir ya da " . vg_site_url() . "/magaza/ adresinden yeni talep gönderebilirsiniz.\n\n"
        . "Sipariş takibi: " . vg_site_url() . "/magaza/siparis-takip.html\n\nVoltGuard\n" . vg_site_url() . "\n";
    return vg_mail_send($order['customer']['email'], 'VoltGuard sipariş talebiniz ' . $order['ref'] . ' — teyit edilemedi', $body, 'magaza-durum');
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
