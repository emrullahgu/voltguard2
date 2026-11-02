<?php
/*
 * VoltGuard Magaza siparis is mantigi (api/MAGAZA.md "Sipariş kaydı"): girdi dogrulama, tekrar korumasi, TEYITLI
 * SIPARIS TALEBI (talep -> personel teyidi -> odeme), kayit, e-postalar, durum gecisleri, liste ve muhasebe CSV'si. API
 * (api/lib/magaza-api.php) ve tools/magaza-admin.php ayni fonksiyonlari kullanir. Talepteki fiyatlar bilgi amaclidir ve
 * sunucuda hesaplanir; baglayici TL tutari yalnizca personel teyidinde (vgm_order_confirm) sabitlenir. Istemcinin
 * gonderdigi hicbir fiyata guvenilmez.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VGM_ORDER_PAGE = 25;

/* ------------------------------------------------------------------ alan dogrulayicilari */

/** Turkiye telefonu: cep (5xx), sabit hat (2xx-4xx) veya 850; 0 / 90 / +90 onekli ya da oneksiz. */
function vgm_phone_ok(string $phone): bool
{
    if (strlen($phone) > 32 || preg_match('/^\+?[0-9 ()\-.]+$/D', $phone) !== 1) {
        return false;
    }
    $digits = (string)preg_replace('/\D+/', '', $phone);
    return preg_match('/^(?:90|0)?(?:[2-5][0-9]{9}|850[0-9]{7})$/D', $digits) === 1;
}

/** T.C. kimlik no: 11 hane, ilk hane 0 degil, 10. ve 11. hane kontrol basamaklari. */
function vgm_tckn_ok(string $t): bool
{
    if (preg_match('/^[1-9][0-9]{10}$/D', $t) !== 1) {
        return false;
    }
    $d = array_map('intval', str_split($t));
    $d10 = ((($d[0] + $d[2] + $d[4] + $d[6] + $d[8]) * 7) - ($d[1] + $d[3] + $d[5] + $d[7])) % 10;
    if ($d10 < 0) {
        $d10 += 10;
    }
    return $d10 === $d[9] && (array_sum(array_slice($d, 0, 10)) % 10) === $d[10];
}

/** Vergi kimlik no: 10 hane, Gelir Idaresi kontrol basamagi. */
function vgm_vkn_ok(string $v): bool
{
    if (preg_match('/^[0-9]{10}$/D', $v) !== 1) {
        return false;
    }
    $d = array_map('intval', str_split($v));
    $sum = 0;
    for ($i = 0; $i < 9; $i++) {
        $tmp = ($d[$i] + 9 - $i) % 10;
        $p = ($tmp * (2 ** (9 - $i))) % 9;
        if ($tmp !== 0 && $p === 0) {
            $p = 9;
        }
        $sum += $p;
    }
    return (10 - ($sum % 10)) % 10 === $d[9];
}

function vgm_in_text($v, int $min, int $max, string $key, string $message, array &$errors, bool $multiline = false): string
{
    $text = vg_text($v, $max + 1, $multiline);
    $len = vg_strlen($text);
    if (($min > 0 || $text !== '') && ($len < $min || $len > $max || preg_match('/[<>]/', $text) === 1)) {
        $errors[$key] = $message;
    }
    return $text;
}

/**
 * Siparis formunu dogrular ve normalize eder. Hata anahtarlari girdi yapisinin noktali yolu: customer.name,
 * billing.vkn, shippingAddress.city, consents.preInfo ... (istemci alanlari bu adlarla eslestirir).
 * $strict false: on bilgilendirme onizlemesi icin eksik alanlar hata uretmez.
 */
function vgm_order_input(array $in, array &$errors, bool $strict = true): array
{
    $errors = [];
    $e = [];
    $c = is_array($in['customer'] ?? null) ? $in['customer'] : [];
    $b = is_array($in['billing'] ?? null) ? $in['billing'] : [];
    $s = is_array($in['shippingAddress'] ?? null) ? $in['shippingAddress'] : [];
    $name = vgm_in_text($c['name'] ?? '', 2, 80, 'customer.name', 'Lütfen ad soyad girin (2–80 karakter).', $e);
    if (!isset($e['customer.name']) && $name !== '' && (preg_match('/\p{L}/u', $name) !== 1 || preg_match('~[:/@\\\\]~', $name) === 1)) {
        $e['customer.name'] = 'Lütfen geçerli bir ad soyad girin.';
    }
    $email = vg_normalize_email($c['email'] ?? '');
    if ($email === '') {
        $e['customer.email'] = 'Geçerli bir e-posta adresi girin.';
    }
    $phone = vg_text($c['phone'] ?? '', 40);
    if (!vgm_phone_ok($phone)) {
        $e['customer.phone'] = 'Geçerli bir telefon numarası girin (cep veya sabit hat).';
    }
    $type = ($b['type'] ?? 'bireysel') === 'kurumsal' ? 'kurumsal' : 'bireysel';
    $billing = ['type' => $type, 'name' => $name, 'tckn' => '', 'company' => '', 'taxOffice' => '', 'vkn' => ''];
    if ($type === 'bireysel') {
        $tckn = (string)preg_replace('/\s+/', '', vg_text($b['tckn'] ?? '', 20));
        if ($tckn !== '' && !vgm_tckn_ok($tckn)) {
            $e['billing.tckn'] = 'T.C. kimlik numarası geçersiz. Boş bırakabilirsiniz.';
        }
        $billing['tckn'] = $tckn;
    } else {
        $billing['company'] = vgm_in_text($b['company'] ?? '', 2, 150, 'billing.company', 'Firma ünvanını girin.', $e);
        $billing['taxOffice'] = vgm_in_text($b['taxOffice'] ?? '', 2, 60, 'billing.taxOffice', 'Vergi dairesini girin.', $e);
        $vkn = (string)preg_replace('/\s+/', '', vg_text($b['vkn'] ?? '', 20));
        if (!(vgm_vkn_ok($vkn) || vgm_tckn_ok($vkn))) {
            $e['billing.vkn'] = 'Vergi kimlik numarası geçersiz (10 hane; şahıs şirketinde 11 haneli T.C. kimlik no).';
        }
        $billing['vkn'] = $vkn;
    }
    $billing['address'] = vgm_in_text($b['address'] ?? '', 10, 300, 'billing.address', 'Fatura adresini girin (en az 10 karakter).', $e, true);
    $billing['city'] = vgm_in_text($b['city'] ?? '', 2, 40, 'billing.city', 'İl girin.', $e);
    $billing['district'] = vgm_in_text($b['district'] ?? '', 2, 40, 'billing.district', 'İlçe girin.', $e);
    if (($s['sameAsBilling'] ?? false) === true) {
        $ship = ['name' => $billing['type'] === 'kurumsal' && $billing['company'] !== '' ? $billing['company'] : $name,
            'phone' => $phone, 'address' => $billing['address'], 'city' => $billing['city'], 'district' => $billing['district'],
            'postalCode' => '', 'sameAsBilling' => true];
    } else {
        $ship = ['name' => vgm_in_text($s['name'] ?? '', 2, 120, 'shippingAddress.name', 'Teslim alacak kişinin adını girin.', $e),
            'phone' => vg_text($s['phone'] ?? '', 40),
            'address' => vgm_in_text($s['address'] ?? '', 10, 300, 'shippingAddress.address', 'Teslimat adresini girin (en az 10 karakter).', $e, true),
            'city' => vgm_in_text($s['city'] ?? '', 2, 40, 'shippingAddress.city', 'Teslimat ili girin.', $e),
            'district' => vgm_in_text($s['district'] ?? '', 2, 40, 'shippingAddress.district', 'Teslimat ilçesi girin.', $e),
            'postalCode' => vg_text($s['postalCode'] ?? '', 10), 'sameAsBilling' => false];
        if (!vgm_phone_ok($ship['phone'])) {
            $e['shippingAddress.phone'] = 'Teslimat için geçerli bir telefon numarası girin.';
        }
        if ($ship['postalCode'] !== '' && preg_match('/^[0-9]{5}$/D', $ship['postalCode']) !== 1) {
            $e['shippingAddress.postalCode'] = 'Posta kodu 5 haneli olmalı.';
        }
    }
    $notes = vgm_in_text($in['notes'] ?? '', 0, 1000, 'notes', 'Not en fazla 1000 karakter olabilir.', $e, true);
    $consents = is_array($in['consents'] ?? null) ? $in['consents'] : [];
    if (($consents['preInfo'] ?? false) !== true) {
        $e['consents.preInfo'] = 'Ön bilgilendirme formunu okuyup onaylamanız gerekir.';
    }
    if (($consents['contract'] ?? false) !== true) {
        $e['consents.contract'] = 'Mesafeli satış sözleşmesini okuyup onaylamanız gerekir.';
    }
    if ($strict) {
        $errors = $e;
    }
    return ['customer' => ['name' => $name, 'email' => $email, 'phone' => $phone], 'billing' => $billing,
        'shippingAddress' => $ship, 'notes' => $notes];
}

/* ------------------------------------------------------------------ jeton -> siparis */

/** Akis sifresi (HMAC-SHA256 CTR) + etiket: tarayici jetonun icindeki USD fiyat ve kuru okuyamaz. PHP 7.4, eklenti gerektirmez. */
function vgm_seal_stream(string $key, string $nonce, int $len): string
{
    $out = '';
    for ($i = 0; strlen($out) < $len; $i++) {
        $out .= hash_hmac('sha256', $nonce . pack('N', $i), $key, true);
    }
    return substr($out, 0, $len);
}

function vgm_quote_seal(string $token): string
{
    $base = hash_hmac('sha256', 'magaza-quote-seal', vg_secret(), true);
    $nonce = random_bytes(16);
    $cipher = $token ^ vgm_seal_stream($base . 'enc', $nonce, strlen($token));
    $tag = substr(hash_hmac('sha256', $nonce . $cipher, $base . 'mac', true), 0, 16);
    return vg_b64url($nonce . $cipher . $tag);
}

function vgm_quote_unseal(string $sealed): ?string
{
    if (strlen($sealed) > 24000 || preg_match('/^[A-Za-z0-9_-]{44,}$/D', $sealed) !== 1) {
        return null;
    }
    $b64 = strtr($sealed, '-_', '+/');
    $raw = base64_decode($b64 . str_repeat('=', (4 - strlen($b64) % 4) % 4), true);
    if (!is_string($raw) || strlen($raw) < 33) {
        return null;
    }
    $base = hash_hmac('sha256', 'magaza-quote-seal', vg_secret(), true);
    $nonce = substr($raw, 0, 16);
    $tag = substr($raw, -16);
    $cipher = substr($raw, 16, -16);
    if (!hash_equals(substr(hash_hmac('sha256', $nonce . $cipher, $base . 'mac', true), 0, 16), $tag)) {
        return null;
    }
    return $cipher ^ vgm_seal_stream($base . 'enc', $nonce, strlen($cipher));
}

/**
 * Siparis TALEBI taslagi (teyitli siparis, sahibin karari 2026-11-02). $cart: vgm_cart_items() ciktisi (her urun talep
 * edilebilir). Satir fiyatlari BILGI AMACLIDIR: urun sayfasindaki gosterim kuraliyla (vgm_price_display: verified | list |
 * last) gosterilen birim fiyat, yoksa null ("fiyat teyitte bildirilir"). Baglayici tutar personel teyidinde
 * (vgm_order_confirm) sabitlenir; bu asamada IBAN ve odeme istenmez. ref bos.
 */
function vgm_request_draft(array $cart, array $clean, array $config, int $now): array
{
    list($state, $rate) = vgm_locked(false, function (string $dir) use ($cart): array {
        return [vgm_price_items($dir, array_keys($cart)), vgm_rate_state($dir)];
    });
    $open = vgm_shop_open($config);
    $items = [];
    $net = 0.0;
    $gross = 0.0;
    $unpriced = 0;
    foreach ($cart as $id => $qty) {
        $p = vgm_product((string)$id);
        if ($p === null) {
            vg_fail(422, 'unknown_product', 'Sepetteki bir ürün artık satışta değil. Sepetinizi yenileyin.');
        }
        $price = vgm_price($p, $state[$p['id']] ?? null, $rate, $config, $open, $now);
        $display = vgm_price_display($price, $now);
        $vat = (int)$price['vat'];
        $it = ['id' => $p['id'], 'name' => $p['name'], 'brand' => $p['brand'] ?? '', 'mpn' => $p['mpn'] ?? '', 'qty' => (int)$qty,
            'unit' => $p['unit'] ?? 'adet', 'vat' => $vat, 'specs' => vgm_specs_snapshot($p), 'deliveryDays' => vgm_delivery_days($p),
            'customMade' => ($p['customMade'] ?? false) === true, 'freight' => $price['reason'] === 'freight',
            'priceBasis' => $display, 'unitUsdNet' => $display !== null ? $price['usdNet'] : null,
            'unitTryNet' => null, 'unitTryGross' => null, 'lineTryNet' => null, 'lineTryGross' => null];
        if ($display !== null) {
            $it['unitTryNet'] = (float)$price['tryNet'];
            $it['unitTryGross'] = (float)$price['tryGross'];
            $it['lineTryNet'] = vgm_round2((float)$price['tryNet'] * $qty);
            $it['lineTryGross'] = vgm_round2((float)$price['tryGross'] * $qty);
            $net += $it['lineTryNet'];
            $gross += $it['lineTryGross'];
        } else {
            $unpriced++;
        }
        $items[] = $it;
    }
    return ['ref' => null, 'createdAt' => $now, 'status' => 'teyit_bekliyor', 'payBy' => null, 'respondBy' => vgm_respond_by($now)]
        + $clean + ['items' => $items,
        'totals' => ['tryNet' => vgm_round2($net), 'tryVat' => vgm_round2($gross - $net), 'shippingTry' => null,
            'tryGross' => vgm_round2($gross), 'unpriced' => $unpriced],
        'rate' => vgm_rate_ok($rate, $now) ? ['usdTry' => (float)$rate['usdTry'], 'date' => (string)$rate['date']] : null];
}

/** Siparis anindaki tedarik kaynaklari (yalnizca personel; herkese acik gorunumde yok). */
function vgm_sources_snapshot(array $items, array $config, array $prices): array
{
    $out = [];
    foreach ($items as $it) {
        $s = $prices[$it['id']] ?? [];
        $list = [];
        foreach (vgm_sources($config, $it['id']) as $i => $src) {
            $used = (int)($s['source'] ?? -1) === (int)$i;
            $list[] = ['supplier' => $src['supplier'], 'url' => $src['url'], 'discount' => $src['discount'] ?? 0,
                'costTry' => $used ? ($s['costTry'] ?? null) : null, 'checkedAt' => $used ? ($s['checkedAt'] ?? null) : null];
        }
        $out[$it['id']] = $list;
    }
    return $out;
}

/** On bilgilendirme ve sozlesme metinleri (odeme sayfasi, e-posta ve kayit ayni metni kullanir). */
function vgm_order_docs(array $order, array $config): array
{
    $ctx = vgm_doc_context($order, vgm_firma(), $config);
    return ['preInfo' => vgm_doc_preinfo($ctx), 'contract' => vgm_doc_contract($ctx)];
}

/**
 * Uretimde bot dogrulamasi yapilandirilmamissa (firma.json turnstileSiteKey ya da gizli anahtar: TURNSTILE_SECRET_KEY / VG_DATA_DIR/turnstile-config.json)
 * siparis alinmaz: 503 captcha_unconfigured (P1-03). Onizleme ve testler (VG_MAIL_OUTBOX=1: e-posta outbox/'a yazilir)
 * anahtarsiz calisir.
 */
function vgm_captcha_ready_or_fail(): void
{
    if (getenv('VG_MAIL_OUTBOX') === '1') {
        return;
    }
    $firma = vgm_firma();
    $siteKey = $firma['turnstileSiteKey'] ?? null;
    $secret = vgm_turnstile_config()['secretKey'];
    $placeholder = function ($v): bool {
        return !is_string($v) || trim($v) === '' || strpos($v, 'REPLACE_WITH') === 0;
    };
    if ($placeholder($siteKey) || $placeholder($secret)) {
        error_log('VoltGuard magaza: order refused, Turnstile is not configured (firma.json turnstileSiteKey / TURNSTILE_SECRET_KEY)');
        vg_fail(503, 'captcha_unconfigured', 'Sipariş güvenlik doğrulaması henüz yapılandırılmadı. Lütfen bizi arayın: '
            . (is_string($firma['telefon'] ?? null) && trim($firma['telefon']) !== '' ? trim($firma['telefon']) : '0545 434 67 35') . '.');
    }
}

/**
 * Siparis TALEBI olusturur (api: action=siparis). Durum "teyit_bekliyor"; IBAN ve odeme talebi YOK. $guard: tekrar
 * korumasinin icinde, yeni bir kayit olusturulmadan once calisir (hiz siniri, bot dogrulamasi); ayni istegin tekrari onu
 * yeniden calistirmaz. $memberId: SUNUCUDA oturumdan okunan uye kimligi (api/lib/magaza-api.php); istemci girdisinden ASLA
 * alinmaz ve tekrar korumasinin parmak izine girmez: ayni istek giris yapildiktan sonra tekrarlansa da ayni kayit doner.
 * @return array{order: array, duplicate: bool, clean: array}
 */
function vgm_order_create(array $in, int $now, ?callable $guard = null, ?string $memberId = null): array
{
    vgm_captcha_ready_or_fail();
    $requestId = is_string($in['requestId'] ?? null) ? $in['requestId'] : '';
    if (preg_match('/^[A-Za-z0-9_-]{16,64}$/D', $requestId) !== 1) {
        vg_fail(400, 'invalid_request', 'Talep bilgisi eksik. Sayfayı yenileyip yeniden deneyin.');
    }
    if (($in['website'] ?? '') !== '') {
        vg_fail(422, 'rejected', 'Talep gönderilemedi. Lütfen alanları kontrol edin.');
    }
    if (!is_string($in['formTimestamp'] ?? null) || preg_match('/^[1-9][0-9]{0,15}$/D', $in['formTimestamp']) !== 1) {
        vg_fail(422, 'invalid_form', 'Form bilgisi eksik. Lütfen sayfayı yenileyip yeniden deneyin.');
    }
    $errors = [];
    $clean = vgm_order_input($in, $errors);
    $cart = vgm_cart_items($in['items'] ?? null);
    if ($errors) {
        vg_fail(422, 'invalid_order', 'Lütfen işaretli alanları düzeltin.', $errors);
    }
    $config = vgm_locked(false, function (string $dir): array {
        return vgm_config($dir);
    });
    if (!vgm_shop_open($config)) {
        vg_fail(503, 'shop_closed', 'Sipariş talepleri çok yakında açılıyor. Şimdilik sepetinizi teklif olarak gönderebilirsiniz.');
    }
    $cartKey = $cart;
    ksort($cartKey);
    $fingerprint = hash('sha256', vg_json_encode(['talep-v2', $clean, $cartKey]));
    $created = null;
    $outcome = vgm_order_once($requestId, $fingerprint, function () use ($cart, $clean, $config, $now, $guard, $memberId, &$created): string {
        if ($guard !== null) {
            $guard();
        }
        if (!vg_mail_can_send()) {
            vg_fail(503, 'mail_unavailable', 'Talep şu anda alınamıyor. Lütfen bizi telefonla arayın.');
        }
        $order = vgm_request_draft($cart, $clean, $config, $now);
        $order['consents'] = ['preInfo' => $now, 'contract' => $now, 'docVersion' => (string)(vgm_firma()['belgeSurumu'] ?? ''),
            'stage' => 'talep', 'ipHash' => hash_hmac('sha256', 'magaza-ip' . "\0" . vg_client_ip(), vg_secret())];
        $order['history'] = [['at' => $now, 'status' => 'teyit_bekliyor', 'by' => 'sistem', 'note' => '', 'publicNote' => '']];
        $order['tracking'] = null;
        if ($memberId !== null && preg_match('/^u[0-9a-f]{24}$/D', $memberId) === 1) {
            $order['member'] = ['id' => $memberId, 'linkedAt' => $now, 'via' => 'checkout'];
        }
        $prices = vgm_locked(false, function (string $dir) use ($cart): array {
            return vgm_price_items($dir, array_keys($cart));
        });
        $order['private'] = ['sources' => vgm_sources_snapshot($order['items'], $config, $prices)];
        $order = vgm_locked(true, function (string $dir) use ($order, $config): array {
            $all = vgm_orders_read($dir);
            do {
                $ref = vgm_reference();
            } while (isset($all['orders'][$ref]));
            $order['ref'] = $ref;
            $order['docs'] = vgm_order_docs($order, $config);
            $all['orders'][$ref] = $order;
            vgm_orders_write($dir, $all);
            return $order;
        });
        $mail = ['customer' => vgm_mail_request_customer($order), 'staff' => vgm_mail_request_staff($order)];
        if (!$mail['customer'] || !$mail['staff']) {
            error_log('VoltGuard magaza: request mail not handed to transport (' . ($mail['customer'] ? 'staff' : 'customer') . ')');
        }
        $order['mail'] = $mail;
        vgm_locked(true, function (string $dir) use ($order): void {
            $all = vgm_orders_read($dir);
            if (isset($all['orders'][$order['ref']])) {
                $all['orders'][$order['ref']]['mail'] = $order['mail'];
                vgm_orders_write($dir, $all);
            }
        });
        $created = $order;
        return $order['ref'];
    });
    $order = $created ?? vgm_order_get($outcome['reference']);
    if ($order === null) {
        vg_unavailable('order record missing after idempotent replay');
    }
    return ['order' => $order, 'duplicate' => $outcome['duplicate'], 'clean' => $clean];
}

/** Personelin girdigi TL tutari (KDV dahil): sayi, 0 < x <= 100.000.000 ($allowZero: 0 da olur), kurus hassasiyeti. */
function vgm_money_in($v, bool $allowZero = false): ?float
{
    if (!(is_int($v) || is_float($v)) || !is_finite((float)$v)) {
        return null;
    }
    $f = vgm_round2((float)$v);
    if ($f > 100000000 || $f < 0 || (!$allowZero && $f <= 0)) {
        return null;
    }
    return $f;
}

/** Teyit kilidinin gecerlilik suresi (sn): e-posta gonderilirken ikinci teyit/ret beklenir; surec coktuyse kilit kendiliginden duser. */
const VGM_CONFIRM_CLAIM_SECONDS = 120;

/** Baska bir oturum bu talebi su anda teyit ediyor mu (e-posta gonderimi suruyor)? */
function vgm_confirm_claimed(array $o, int $now): bool
{
    $at = $o['confirming']['at'] ?? null;
    return is_int($at) && $now - $at < VGM_CONFIRM_CLAIM_SECONDS;
}

/**
 * Personel teyidi (api: panel_order_confirm; personel yetkisi sunucuda denetlenir, musteri bu islemi yapamaz).
 * $in: lines [{id, qty, unitTryGross}] (yalnizca talepteki urunler; listede olmayan satir kaldirilir; adet yalnizca
 * azaltilabilir: 1 <= qty <= talepteki adet ve urunun minQty/step kurali), shippingTry (KDV dahil, 0 = ucretsiz),
 * publicNote?, note?. Hata alanlari urun kimligiyle: "lines.<id>.qty", "lines.<id>.unitTryGross".
 *
 * Teyit e-postasi saticinin baglayici teklifidir (kesin tutar, IBAN, kesin tutarli form ve sozlesme, talepten farklar);
 * sozlesme musteri bu tutari suresinde odeyince kurulur. Bu nedenle e-posta teslim edilmeden teyit KAYDEDILMEZ:
 *  1) kilit altinda dogrulanir, teyitli kayit hesaplanir ve talep "confirming" ile kisa sureli isaretlenir;
 *  2) e-posta gonderilir;
 *  3) gonderildiyse teyit yazilir (odeme_bekleniyor, payBy = teyit + paymentHours); gonderilemediyse isaret kaldirilir,
 *     talep teyit_bekliyor kalir ve 503 mail_failed doner (personel tekrar dener; odeme suresi baslamaz).
 * Yalnizca teyit_bekliyor durumundaki talep teyit edilir (ikinci teyit 409).
 */
function vgm_order_confirm(string $ref, array $in, array $actor, int $now): array
{
    $lines = $in['lines'] ?? null;
    if (!is_array($lines) || $lines === [] || array_keys($lines) !== range(0, count($lines) - 1) || count($lines) > VGM_MAX_LINES) {
        vg_fail(422, 'invalid_lines', 'Teyit için en az bir ürün satırı gerekli.');
    }
    $want = [];
    $errors = [];
    foreach ($lines as $row) {
        $id = is_array($row) && is_string($row['id'] ?? null) ? $row['id'] : '';
        $qty = is_array($row) ? ($row['qty'] ?? null) : null;
        $unit = is_array($row) ? vgm_money_in($row['unitTryGross'] ?? null) : null;
        if ($id === '' || !vgm_id_valid($id) || isset($want[$id])) {
            vg_fail(422, 'invalid_lines', 'Ürün satırları okunamadı. Sayfayı yenileyip tekrar deneyin.');
        }
        if (!is_int($qty) || $qty < 1 || $qty > VGM_MAX_QTY) {
            $errors['lines.' . $id . '.qty'] = 'Adet 1 ile ' . VGM_MAX_QTY . ' arasında tam sayı olmalı.';
        }
        if ($unit === null) {
            $errors['lines.' . $id . '.unitTryGross'] = 'KDV dahil birim fiyatı TL olarak girin.';
        }
        $want[$id] = ['qty' => is_int($qty) ? $qty : 0, 'unit' => $unit];
    }
    $ship = vgm_money_in($in['shippingTry'] ?? 0, true);
    if ($ship === null || $ship > 1000000) {
        $errors['shippingTry'] = 'Kargo ücretini TL olarak girin (ücretsizse 0).';
    }
    if ($errors) {
        vg_fail(422, 'invalid_confirm', 'Lütfen işaretli alanları düzeltin.', $errors);
    }
    $publicNote = vg_text($in['publicNote'] ?? '', 600, true);
    $note = vg_text($in['note'] ?? '', 1000, true);
    $config = vgm_locked(false, function (string $dir): array {
        return vgm_config($dir);
    });
    $by = vg_text($actor['name'] ?? 'personel', 80);
    $token = bin2hex(random_bytes(8));
    /* 1) dogrula, hesapla, kisa sureli isaretle (yazilan tek degisiklik "confirming"). */
    $staged = vgm_locked(true, function (string $dir) use ($ref, $want, $ship, $publicNote, $note, $by, $config, $now, $token): array {
        $all = vgm_orders_read($dir);
        if (!isset($all['orders'][$ref])) {
            vg_fail(404, 'not_found', 'Sipariş bulunamadı.');
        }
        $o = $all['orders'][$ref];
        if ($o['status'] !== 'teyit_bekliyor') {
            vg_fail(409, 'not_awaiting_confirm', 'Bu talep teyit beklemiyor ("' . (VGM_STATUS_LABELS[$o['status']] ?? $o['status']) . '"). Sayfayı yenileyin.');
        }
        if (vgm_confirm_claimed($o, $now)) {
            vg_fail(409, 'confirm_in_progress', 'Bu talep şu anda başka bir oturumda teyit ediliyor. Birkaç saniye sonra sayfayı yenileyin.');
        }
        $byId = [];
        foreach ($o['items'] as $it) {
            $byId[$it['id']] = $it;
        }
        $errors = [];
        foreach ($want as $id => $w) {
            if (!isset($byId[$id])) {
                vg_fail(422, 'invalid_lines', 'Teyit yalnızca talepteki ürünleri içerebilir.');
            }
            $requested = (int)$byId[$id]['qty'];
            $unitName = (string)($byId[$id]['unit'] ?? 'adet');
            if ($w['qty'] > $requested) {
                $errors['lines.' . $id . '.qty'] = 'Adet talepteki adetten (' . $requested . ' ' . $unitName . ') fazla olamaz; teyitte adet yalnızca azaltılabilir.';
                continue;
            }
            $p = vgm_product((string)$id);
            if ($p !== null && $w['qty'] !== $requested && ($w['qty'] < $p['minQty'] || ($w['qty'] - $p['minQty']) % $p['step'] !== 0)) {
                $errors['lines.' . $id . '.qty'] = 'Bu ürün en az ' . $p['minQty'] . ' ' . $unitName
                    . ($p['step'] > 1 ? ' ve ' . $p['step'] . ' ' . $unitName . ' katları ile' : '') . ' satılır.';
            }
        }
        if ($errors) {
            vg_fail(422, 'invalid_confirm', 'Lütfen işaretli alanları düzeltin.', $errors);
        }
        $rate = vgm_rate_state($dir);
        $rateOk = vgm_rate_ok($rate, $now);
        $items = [];
        $net = 0.0;
        $gross = 0.0;
        $usd = 0.0;
        foreach ($want as $id => $w) {
            $it = $byId[$id];
            $vat = (int)$it['vat'];
            $unitNet = vgm_round2($w['unit'] / (1 + $vat / 100));
            $lineGross = vgm_round2($w['unit'] * $w['qty']);
            $lineNet = vgm_round2($lineGross / (1 + $vat / 100));
            $it['requested'] = ['qty' => $it['qty'], 'unitTryGross' => $it['unitTryGross'] ?? null, 'priceBasis' => $it['priceBasis'] ?? null];
            $it['qty'] = $w['qty'];
            $it['unitTryGross'] = $w['unit'];
            $it['unitTryNet'] = $unitNet;
            $it['lineTryGross'] = $lineGross;
            $it['lineTryNet'] = $lineNet;
            $it['priceBasis'] = 'confirmed';
            $it['unitUsdNet'] = $rateOk ? vgm_round2($unitNet / (float)$rate['usdTry']) : null;
            $net += $lineNet;
            $gross += $lineGross;
            $usd += $rateOk ? $unitNet / (float)$rate['usdTry'] * $w['qty'] : 0;
            $items[] = $it;
        }
        $removed = array_values(array_diff(array_keys($byId), array_keys($want)));
        $c = $o;
        $c['request'] = ['items' => $o['items'], 'totals' => $o['totals'], 'docs' => $o['docs'] ?? null, 'respondBy' => $o['respondBy'] ?? null];
        $c['items'] = $items;
        $c['totals'] = ['tryNet' => vgm_round2($net), 'tryVat' => vgm_round2($gross - $net), 'shippingTry' => $ship,
            'tryGross' => vgm_round2($gross + $ship), 'usdNet' => $rateOk ? vgm_round2($usd) : null];
        $c['rate'] = $rateOk ? ['usdTry' => (float)$rate['usdTry'], 'date' => (string)$rate['date']] : ($o['rate'] ?? null);
        $c['status'] = 'odeme_bekleniyor';
        $c['confirmedAt'] = $now;
        $c['confirmedBy'] = $by;
        $c['payBy'] = $now + 3600 * (int)($config['paymentHours'] ?? 24);
        $c['docs'] = vgm_order_docs($c, $config);
        $c['consents']['confirmedDocVersion'] = (string)(vgm_firma()['belgeSurumu'] ?? '');
        /* Talepten farklar musteriye gorunur (e-posta, belgeler, takip gecmisi); ic not yalnizca personel. */
        $changes = vgm_confirm_changes($c);
        $public = $publicNote !== '' ? $publicNote : 'Stok ve fiyat teyit edildi; ödeme bilgileri e-postayla gönderildi.';
        if ($changes) {
            $public .= ' Talebinize göre değişiklikler: ' . implode('; ', $changes) . '.';
        }
        $c['history'][] = ['at' => $now, 'status' => 'odeme_bekleniyor', 'by' => $by,
            'note' => trim($note . ($removed ? ($note !== '' ? ' ' : '') . '[Çıkarılan ürün: ' . implode(', ', $removed) . ']' : '')),
            'publicNote' => $public];
        unset($c['confirming']);
        $all['orders'][$ref]['confirming'] = ['at' => $now, 'token' => $token, 'by' => $by];
        vgm_orders_write($dir, $all);
        return ['order' => $c, 'changes' => $changes];
    });
    /* 2) baglayici teklif: e-posta. */
    $order = $staged['order'];
    $sent = vgm_mail_confirm_customer($order, vgm_doc_context($order, vgm_firma(), $config), $publicNote, $staged['changes']);
    if (!$sent) {
        error_log('VoltGuard magaza: confirmation mail not handed to transport; confirmation not recorded');
    }
    /* 3) gonderildiyse teyidi yaz; gonderilemediyse isareti kaldir (talep teyit_bekliyor kalir, odeme suresi baslamaz). */
    $saved = vgm_locked(true, function (string $dir) use ($ref, $order, $sent, $token, $now): ?array {
        $all = vgm_orders_read($dir);
        $cur = $all['orders'][$ref] ?? null;
        if ($cur === null || ($cur['confirming']['token'] ?? null) !== $token || $cur['status'] !== 'teyit_bekliyor') {
            error_log('VoltGuard magaza: confirmation claim lost for ' . $ref);
            vg_fail(409, 'confirm_conflict', 'Talep bu sırada değişti. Sayfayı yenileyip durumu kontrol edin.');
        }
        unset($cur['confirming']);
        if (!$sent) {
            $cur['mail']['confirmFailedAt'] = $now;
            $all['orders'][$ref] = $cur;
            vgm_orders_write($dir, $all);
            return null;
        }
        /* Esas alinan kayit guncel kayit (bu arada uye baglama gibi alanlar degismis olabilir); teyit alanlari uzerine yazilir. */
        foreach (['request', 'items', 'totals', 'rate', 'status', 'confirmedAt', 'confirmedBy', 'payBy', 'docs'] as $k) {
            $cur[$k] = $order[$k];
        }
        $cur['consents']['confirmedDocVersion'] = $order['consents']['confirmedDocVersion'];
        $cur['history'][] = end($order['history']);
        $cur['mail']['confirm'] = true;
        unset($cur['mail']['confirmFailedAt']);
        $all['orders'][$ref] = $cur;
        vgm_orders_write($dir, $all);
        return $cur;
    });
    if ($saved === null) {
        vg_fail(503, 'mail_failed', 'Teyit e-postası gönderilemedi. Teyit kaydedilmedi; talep "Teyit bekleniyor" durumunda kaldı ve ödeme süresi başlamadı. Biraz sonra tekrar deneyin.');
    }
    $saved['_mailSent'] = true;
    return $saved;
}

/** Ret nedenleri (panel secimi) ve musteriye giden standart cumle. */
const VGM_REJECT_REASONS = [
    'stok_yok' => 'Ürün tedarikçi stoğunda bulunamadı.',
    'fiyat_degisti' => 'Tedarik fiyatı değiştiği için talepteki koşullarla teyit edemedik.',
    'diger' => '',
];

/**
 * Talebi reddeder (api: panel_order_reject): durum iptal (bedelsiz); bu asamada odeme hic istenmemistir. $in: reason
 * (stok_yok|fiyat_degisti|diger), publicNote? (musteriye; "diger"de zorunlu), note? (ic not). Musteriye e-posta gider.
 */
function vgm_order_reject(string $ref, array $in, array $actor, int $now): array
{
    $reason = is_string($in['reason'] ?? null) ? $in['reason'] : '';
    if (!array_key_exists($reason, VGM_REJECT_REASONS)) {
        vg_fail(422, 'invalid_reason', 'Ret nedenini seçin.', ['reason' => 'Ret nedenini seçin.']);
    }
    $publicNote = vg_text($in['publicNote'] ?? '', 600, true);
    $note = vg_text($in['note'] ?? '', 1000, true);
    if ($reason === 'diger' && vg_strlen($publicNote) < 3) {
        vg_fail(422, 'note_required', 'Müşteriye iletilecek gerekçeyi yazın.', ['publicNote' => 'Müşteriye iletilecek gerekçeyi yazın.']);
    }
    $message = trim(VGM_REJECT_REASONS[$reason] . ($publicNote !== '' ? ' ' . $publicNote : ''));
    $order = vgm_locked(true, function (string $dir) use ($ref, $reason, $message, $note, $actor, $now): array {
        $all = vgm_orders_read($dir);
        if (!isset($all['orders'][$ref])) {
            vg_fail(404, 'not_found', 'Sipariş bulunamadı.');
        }
        $o = $all['orders'][$ref];
        if ($o['status'] !== 'teyit_bekliyor') {
            vg_fail(409, 'not_awaiting_confirm', 'Bu talep teyit beklemiyor ("' . (VGM_STATUS_LABELS[$o['status']] ?? $o['status']) . '"). Sayfayı yenileyin.');
        }
        if (vgm_confirm_claimed($o, $now)) {
            vg_fail(409, 'confirm_in_progress', 'Bu talep şu anda başka bir oturumda teyit ediliyor. Birkaç saniye sonra sayfayı yenileyin.');
        }
        $by = vg_text($actor['name'] ?? 'personel', 80);
        $o['status'] = 'iptal';
        $o['rejected'] = ['at' => $now, 'reason' => $reason, 'by' => $by];
        $o['history'][] = ['at' => $now, 'status' => 'iptal', 'by' => $by, 'note' => $note !== '' ? $note : 'Talep teyit edilemedi (' . $reason . ').',
            'publicNote' => trim('Talebiniz teyit edilemedi ve bedelsiz kapatıldı. ' . $message)];
        $all['orders'][$ref] = $o;
        vgm_orders_write($dir, $all);
        return $o;
    });
    $sent = vgm_mail_reject_customer($order, $message);
    if (!$sent) {
        error_log('VoltGuard magaza: rejection mail not handed to transport');
    }
    vgm_locked(true, function (string $dir) use ($ref, $sent): void {
        $all = vgm_orders_read($dir);
        if (isset($all['orders'][$ref])) {
            $all['orders'][$ref]['mail']['reject'] = $sent;
            vgm_orders_write($dir, $all);
        }
    });
    $order['_mailSent'] = $sent;
    return $order;
}

/* ------------------------------------------------------------------ okuma, guncelleme */

function vgm_order_get(string $ref): ?array
{
    if (!vgm_reference_valid($ref)) {
        return null;
    }
    return vgm_locked(false, function (string $dir) use ($ref): ?array {
        return vgm_orders_read($dir)['orders'][$ref] ?? null;
    });
}

/** Musteri gorunumu: sipariş no + e-posta eslesmezse null (sabit zamanli karsilastirma). */
function vgm_order_lookup(string $ref, string $email): ?array
{
    $ref = strtoupper(trim($ref));
    $email = vg_normalize_email($email);
    $order = $email !== '' ? vgm_order_get($ref) : null;
    if ($order === null || !hash_equals((string)$order['customer']['email'], $email)) {
        return null;
    }
    return vgm_order_customer_view($order, time());
}

/**
 * Siparis sahibine gosterilen gorunum (takip sayfasi ve Hesabim > Siparislerim ayni fonksiyonu kullanir): tedarikci,
 * maliyet, USD kuru, ic not ve ozel alanlar yok. Havale bilgisi YALNIZCA teyit edilmis (odeme_bekleniyor) ve suresi
 * dolmamis sipariste eklenir; teyit bekleyen talepte odeme bilgisi yoktur.
 */
function vgm_order_customer_view(array $order, int $now): array
{
    $pub = vgm_order_public($order);
    /* Musteriye USD kuru gosterilmez; yalnizca tarih. */
    $pub['rate'] = isset($order['rate']['date']) ? ['date' => (string)$order['rate']['date']] : null;
    $pub['payOverdue'] = false;
    $pub['payment'] = null;
    if (($order['status'] ?? '') === 'teyit_bekliyor') {
        $pub['paymentNote'] = 'Talebiniz stok ve fiyat teyidi bekliyor. Teyitten sonra kesin tutar ve ödeme bilgileri e-postayla gönderilir; teyit gelmeden ödeme yapmayın.';
    }
    if (($order['status'] ?? '') === 'odeme_bekleniyor') {
        if ((int)$order['payBy'] < $now) {
            $pub['payOverdue'] = true;
            $pub['paymentNote'] = 'Son ödeme süresi doldu. Lütfen ödeme yapmadan önce bizimle iletişime geçin; sipariş bedelsiz iptal edilebilir ve güncel fiyatla yeniden verilebilir.';
        } else {
            $f = vgm_firma();
            $pub['payment'] = ['bank' => (string)($f['banka']['ad'] ?? ''), 'holder' => (string)($f['banka']['hesapSahibi'] ?? ''),
                'iban' => (string)($f['banka']['iban'] ?? ''), 'amountTry' => (float)$order['totals']['tryGross'],
                'amountText' => vgm_fmt_try((float)$order['totals']['tryGross']), 'description' => (string)$order['ref']];
        }
    }
    return $pub;
}

/**
 * Personel guncellemesi. $change: status?, note? (ic not), publicNote? (musteriye gorunur), tracking? {company, code, url?},
 * notify (musteriye e-posta). $actor: {id, name}. Gecersiz gecis 409; iptal gerekce, kargoda takip bilgisi ister.
 */
function vgm_order_update(string $ref, array $change, array $actor, int $now): array
{
    $status = isset($change['status']) ? (string)$change['status'] : null;
    $note = vg_text($change['note'] ?? '', 1000, true);
    $publicNote = vg_text($change['publicNote'] ?? '', 600, true);
    $tracking = null;
    if (is_array($change['tracking'] ?? null)) {
        $tracking = ['company' => vg_text($change['tracking']['company'] ?? '', 60), 'code' => vg_text($change['tracking']['code'] ?? '', 60),
            'url' => vg_safe_url($change['tracking']['url'] ?? '', false)];
        if ($tracking['url'] !== '' && strpos($tracking['url'], 'https://') !== 0) {
            vg_fail(422, 'invalid_tracking', 'Kargo takip bağlantısı https:// ile başlamalı.');
        }
        if ($tracking['company'] === '' || $tracking['code'] === '' || preg_match('/[<>]/', $tracking['company'] . $tracking['code']) === 1) {
            vg_fail(422, 'invalid_tracking', 'Kargo firması ve takip numarası gerekli.');
        }
    }
    if ($status === null && $note === '' && $publicNote === '' && $tracking === null) {
        vg_fail(422, 'nothing_to_change', 'Değişiklik yok.');
    }
    $order = vgm_locked(true, function (string $dir) use ($ref, $status, $note, $publicNote, $tracking, $actor, $now): array {
        $all = vgm_orders_read($dir);
        if (!isset($all['orders'][$ref])) {
            vg_fail(404, 'not_found', 'Sipariş bulunamadı.');
        }
        $o = $all['orders'][$ref];
        if ($status !== null && $status !== $o['status']) {
            if ($o['status'] === 'teyit_bekliyor') {
                vg_fail(409, 'confirm_required', 'Teyit bekleyen talep yalnızca "Onayla ve ödeme bilgisi gönder" ya da "Reddet" ile ilerler.');
            }
            if (!isset(VGM_STATUS_LABELS[$status]) || !vgm_transition_ok($o['status'], $status)) {
                vg_fail(409, 'invalid_transition', '"' . (VGM_STATUS_LABELS[$o['status']] ?? $o['status']) . '" durumundan "'
                    . (VGM_STATUS_LABELS[$status] ?? $status) . '" durumuna geçilemez.');
            }
            if (($status === 'iptal' || $status === 'iade') && $note === '' && $publicNote === '') {
                vg_fail(422, 'note_required', 'İptal ve iade için gerekçe yazın.');
            }
            if ($status === 'kargoda' && $tracking === null && !is_array($o['tracking'] ?? null)) {
                vg_fail(422, 'tracking_required', 'Kargoya verildi için kargo firması ve takip numarası gerekli.');
            }
            $o['status'] = $status;
            if ($status === 'odeme_alindi') {
                $o['paidAt'] = $now;
            }
        }
        if ($tracking !== null) {
            $o['tracking'] = $tracking;
        }
        $o['history'][] = ['at' => $now, 'status' => $o['status'], 'by' => vg_text($actor['name'] ?? 'personel', 80),
            'note' => $note, 'publicNote' => $publicNote];
        $all['orders'][$ref] = $o;
        vgm_orders_write($dir, $all);
        return $o;
    });
    $order['_mailSent'] = null;
    if (($change['notify'] ?? false) === true) {
        $order['_mailSent'] = vgm_mail_status($order, $publicNote);
        if (!$order['_mailSent']) {
            error_log('VoltGuard magaza: status mail not handed to transport');
        }
    }
    return $order;
}

/* ------------------------------------------------------------------ liste ve muhasebe */

function vgm_order_matches(array $o, string $q): bool
{
    if ($q === '') {
        return true;
    }
    $hay = vg_lower(implode(' ', [$o['ref'], $o['customer']['name'], $o['customer']['email'], $o['customer']['phone'],
        $o['billing']['company'] ?? '', $o['shippingAddress']['city'] ?? '', $o['member']['id'] ?? '']));
    return strpos($hay, vg_lower($q)) !== false;
}

/** $filter: status?, q?, page? → {orders, total, page, pages, counts}. En yeni once. */
function vgm_orders_list(array $filter, ?int $now = null): array
{
    $now = $now ?? vg_now();
    $status = (string)($filter['status'] ?? '');
    if ($status !== '' && !isset(VGM_STATUS_LABELS[$status])) {
        vg_fail(422, 'invalid_status', 'Geçersiz durum filtresi.');
    }
    $q = vg_text($filter['q'] ?? '', 80);
    $page = max(1, (int)($filter['page'] ?? 1));
    $all = vgm_locked(false, function (string $dir): array {
        return vgm_orders_read($dir)['orders'];
    });
    $counts = array_fill_keys(array_keys(VGM_STATUS_LABELS), 0);
    $rows = [];
    foreach ($all as $o) {
        $counts[$o['status']] = ($counts[$o['status']] ?? 0) + 1;
        if (($status !== '' && $o['status'] !== $status) || !vgm_order_matches($o, $q)) {
            continue;
        }
        $rows[] = ['ref' => $o['ref'], 'createdAt' => vg_iso((int)$o['createdAt']), 'status' => $o['status'],
            'statusLabel' => VGM_STATUS_LABELS[$o['status']] ?? $o['status'], 'customerName' => $o['customer']['name'],
            'city' => $o['shippingAddress']['city'] ?? '', 'amountTry' => (float)$o['totals']['tryGross'],
            'estimate' => vgm_order_is_estimate($o), 'unpriced' => (int)($o['totals']['unpriced'] ?? 0),
            'itemCount' => count($o['items']), 'payBy' => isset($o['payBy']) ? vg_iso((int)$o['payBy']) : null,
            'respondBy' => isset($o['respondBy']) ? vg_iso((int)$o['respondBy']) : null,
            'overdue' => $o['status'] === 'odeme_bekleniyor' && (int)($o['payBy'] ?? 0) < $now,
            'respondLate' => $o['status'] === 'teyit_bekliyor' && isset($o['respondBy']) && (int)$o['respondBy'] < $now,
            'member' => isset($o['member']['id']) ? (string)($o['member']['via'] ?? 'checkout') : null, '_t' => (int)$o['createdAt']];
    }
    usort($rows, function (array $a, array $b): int {
        return $b['_t'] <=> $a['_t'];
    });
    $total = count($rows);
    $pages = max(1, (int)ceil($total / VGM_ORDER_PAGE));
    $page = min($page, $pages);
    $slice = array_map(function (array $r): array {
        unset($r['_t']);
        return $r;
    }, array_slice($rows, ($page - 1) * VGM_ORDER_PAGE, VGM_ORDER_PAGE));
    return ['orders' => $slice, 'total' => $total, 'page' => $page, 'pages' => $pages, 'counts' => $counts];
}

/** Excel'in formul olarak calistiracagi hucreleri etkisizlestirir; ; ve " kacislanir. */
function vgm_csv_cell($v): string
{
    $s = is_float($v) ? number_format($v, 2, ',', '') : (string)$v;
    $s = str_replace(["\r\n", "\r", "\n"], ' ', $s);
    if ($s !== '' && strpos("=+-@\t", $s[0]) !== false) {
        $s = "'" . $s;
    }
    return '"' . str_replace('"', '""', $s) . '"';
}

/** Muhasebe/e-Arsiv icin CSV (UTF-8 BOM, ; ayracli). $filter: from?, to? (Y-m-d, TSI). */
function vgm_orders_csv(array $filter): string
{
    $bound = function (string $key, bool $end) use ($filter): ?int {
        $v = (string)($filter[$key] ?? '');
        if ($v === '') {
            return null;
        }
        if (preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/D', $v) !== 1 || ($t = strtotime($v . ($end ? 'T23:59:59' : 'T00:00:00') . '+03:00')) === false) {
            vg_fail(422, 'invalid_date', 'Tarih YYYY-AA-GG biçiminde olmalı.');
        }
        return $t;
    };
    $from = $bound('from', false);
    $to = $bound('to', true);
    $all = vgm_locked(false, function (string $dir): array {
        return vgm_orders_read($dir)['orders'];
    });
    uasort($all, function (array $a, array $b): int {
        return ((int)$a['createdAt']) <=> ((int)$b['createdAt']);
    });
    $head = ['Sipariş No', 'Tarih', 'Durum', 'Ad Soyad', 'E-posta', 'Telefon', 'Fatura Tipi', 'TCKN', 'Firma', 'Vergi Dairesi', 'VKN',
        'Fatura Adresi', 'İl', 'İlçe', 'Ürünler', 'Ara Toplam (KDV hariç)', 'KDV', 'Kargo', 'Toplam (TL)', 'USD/TRY', 'Kur Tarihi', 'Ödeme Tarihi'];
    $lines = [implode(';', array_map('vgm_csv_cell', $head))];
    foreach ($all as $o) {
        $t = (int)$o['createdAt'];
        if (($from !== null && $t < $from) || ($to !== null && $t > $to)) {
            continue;
        }
        $items = implode(' | ', array_map(function (array $it): string {
            return $it['qty'] . ' ' . $it['unit'] . ' ' . $it['name'] . ' (' . $it['mpn'] . ')';
        }, $o['items']));
        $b = $o['billing'];
        $lines[] = implode(';', array_map('vgm_csv_cell', [$o['ref'], vgm_local($t), VGM_STATUS_LABELS[$o['status']] ?? $o['status'],
            $o['customer']['name'], $o['customer']['email'], $o['customer']['phone'], $b['type'], $b['tckn'], $b['company'], $b['taxOffice'],
            $b['vkn'], $b['address'], $b['city'], $b['district'], $items, (float)$o['totals']['tryNet'], (float)$o['totals']['tryVat'],
            (float)($o['totals']['shippingTry'] ?? 0), (float)$o['totals']['tryGross'],
            isset($o['rate']['usdTry']) ? number_format((float)$o['rate']['usdTry'], 4, ',', '') : '',
            (string)($o['rate']['date'] ?? ''), isset($o['paidAt']) ? vgm_local((int)$o['paidAt']) : '']));
    }
    return "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n";
}
