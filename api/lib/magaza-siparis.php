<?php
/*
 * VoltGuard Magaza siparis is mantigi (api/MAGAZA.md "Sipariş kaydı"): girdi dogrulama, imzali fiyat jetonu, tekrar
 * korumasi, kayit, e-postalar, durum gecisleri, liste ve muhasebe CSV'si. API (api/lib/magaza-api.php) ve
 * tools/magaza-admin.php ayni fonksiyonlari kullanir. Siparis TL tutari sepet adiminda imzalanan jetondan gelir;
 * istemcinin gonderdigi hicbir fiyata guvenilmez.
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

/** Jeton satirlarinin [{id, qty}] listesi istemcinin sepetiyle birebir ayni mi? */
function vgm_quote_matches(array $quote, $items): bool
{
    if (!is_array($items)) {
        return false;
    }
    $want = [];
    foreach ($quote['lines'] as $l) {
        $want[(string)$l[0]] = (int)$l[1];
    }
    $got = [];
    foreach ($items as $row) {
        if (!is_array($row) || !is_string($row['id'] ?? null) || !is_int($row['qty'] ?? null) || isset($got[$row['id']])) {
            return false;
        }
        $got[$row['id']] = $row['qty'];
    }
    ksort($want);
    ksort($got);
    return $want === $got;
}

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

function vgm_quote_or_fail(string $token, $items, int $now): array
{
    $inner = vgm_quote_unseal($token);
    $quote = $inner !== null ? vgm_token_decode('quote', $inner, $now) : null;
    if ($quote === null || !is_array($quote['lines'] ?? null) || !$quote['lines'] || !vgm_quote_matches($quote, $items)) {
        vg_fail(409, 'quote_expired', 'Fiyat teyidinin süresi doldu ya da sepet değişti. Güncel fiyatları aldık; lütfen toplamı kontrol edip yeniden onaylayın.');
    }
    return $quote;
}

/** Jetondan (sunucunun imzaladigi fiyatlar) ve dogrulanmis formdan siparis taslagi; ref bos. */
function vgm_order_draft(array $quote, array $clean, array $config, int $now): array
{
    $items = [];
    foreach ($quote['lines'] as $l) {
        $p = vgm_product((string)$l[0]);
        if ($p === null) {
            vg_fail(409, 'quote_expired', 'Sepetteki bir ürün artık satışta değil. Sepetinizi yenileyin.');
        }
        $qty = (int)$l[1];
        $items[] = ['id' => $p['id'], 'name' => $p['name'], 'brand' => $p['brand'] ?? '', 'mpn' => $p['mpn'] ?? '', 'qty' => $qty,
            'unit' => $p['unit'] ?? 'adet', 'vat' => (int)$l[5], 'unitUsdNet' => (float)$l[2], 'unitTryNet' => (float)$l[3],
            'unitTryGross' => (float)$l[4], 'lineTryNet' => vgm_round2((float)$l[3] * $qty), 'lineTryGross' => vgm_round2((float)$l[4] * $qty),
            'deliveryDays' => vgm_delivery_days($p)];
    }
    return ['ref' => null, 'createdAt' => $now, 'payBy' => $now + 3600 * (int)($config['paymentHours'] ?? 24),
        'status' => 'odeme_bekleniyor'] + $clean + ['items' => $items, 'totals' => $quote['totals'], 'rate' => $quote['rate']];
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
 * Siparis olusturur (api: action=siparis). $guard: tekrar korumasinin icinde, yeni bir siparis olusturulmadan once
 * calisir (hiz siniri, bot dogrulamasi); ayni istegin tekrari onu yeniden calistirmaz.
 * @return array{order: array, duplicate: bool}
 */
function vgm_order_create(array $in, int $now, ?callable $guard = null): array
{
    vgm_captcha_ready_or_fail();
    $requestId = is_string($in['requestId'] ?? null) ? $in['requestId'] : '';
    if (preg_match('/^[A-Za-z0-9_-]{16,64}$/D', $requestId) !== 1) {
        vg_fail(400, 'invalid_request', 'Sipariş bilgisi eksik. Sayfayı yenileyip yeniden deneyin.');
    }
    if (($in['website'] ?? '') !== '') {
        vg_fail(422, 'rejected', 'Sipariş gönderilemedi. Lütfen alanları kontrol edin.');
    }
    if (!is_string($in['formTimestamp'] ?? null) || preg_match('/^[1-9][0-9]{0,15}$/D', $in['formTimestamp']) !== 1) {
        vg_fail(422, 'invalid_form', 'Form bilgisi eksik. Lütfen sayfayı yenileyip yeniden deneyin.');
    }
    $errors = [];
    $clean = vgm_order_input($in, $errors);
    $quote = vgm_quote_or_fail(is_string($in['quote'] ?? null) ? $in['quote'] : '', $in['items'] ?? null, $now);
    if ($errors) {
        vg_fail(422, 'invalid_order', 'Lütfen işaretli alanları düzeltin.', $errors);
    }
    $lineIds = [];
    foreach ($quote['lines'] as $l) {
        $lineIds[] = (string)$l[0];
    }
    list($config, $state, $rate) = vgm_locked(false, function (string $dir) use ($lineIds): array {
        return [vgm_config($dir), vgm_price_items($dir, $lineIds), vgm_rate_state($dir)];
    });
    if (!vgm_shop_open($config)) {
        vg_fail(503, 'shop_closed', 'Mağazamız henüz siparişe açık değil. Ürün için teklif isteyebilirsiniz.');
    }
    /* Jeton 30 dk gecerlidir; siparis aninda her satirin 48 saat, bekletme, stok ve kimlik kosulu yeniden denetlenir.
       Tahsil edilen tutar yine imzali TL tutaridir. */
    foreach ($quote['lines'] as $l) {
        $p = vgm_product((string)$l[0]);
        if ($p === null || !vgm_price($p, $state[$p['id']] ?? null, $rate, $config, true, $now)['orderable']) {
            vg_fail(409, 'quote_expired', 'Fiyat teyidinin süresi doldu ya da sepet değişti. Güncel fiyatları aldık; lütfen toplamı kontrol edip yeniden onaylayın.');
        }
    }
    $draft = vgm_order_draft($quote, $clean, $config, $now);
    $fingerprint = hash('sha256', vg_json_encode([$clean, $quote['lines'], $quote['totals'], $quote['rate']]));
    $created = null;
    $outcome = vgm_order_once($requestId, $fingerprint, function () use ($draft, $config, $state, $now, $guard, &$created): string {
        if ($guard !== null) {
            $guard();
        }
        if (!vg_mail_can_send()) {
            vg_fail(503, 'mail_unavailable', 'Sipariş şu anda alınamıyor. Lütfen bizi telefonla arayın.');
        }
        $order = $draft;
        $order['consents'] = ['preInfo' => $now, 'contract' => $now, 'docVersion' => (string)(vgm_firma()['belgeSurumu'] ?? ''),
            'ipHash' => hash_hmac('sha256', 'magaza-ip' . "\0" . vg_client_ip(), vg_secret())];
        $order['history'] = [['at' => $now, 'status' => 'odeme_bekleniyor', 'by' => 'sistem', 'note' => '', 'publicNote' => '']];
        $order['tracking'] = null;
        $order['private'] = ['sources' => vgm_sources_snapshot($order['items'], $config, $state)];
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
        $ctx = vgm_doc_context($order, vgm_firma(), $config);
        $mail = ['customer' => vgm_mail_order_customer($order, $ctx), 'staff' => vgm_mail_order_staff($order)];
        if (!$mail['customer'] || !$mail['staff']) {
            error_log('VoltGuard magaza: order mail not handed to transport (' . ($mail['customer'] ? 'staff' : 'customer') . ')');
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
    return ['order' => $order, 'duplicate' => $outcome['duplicate']];
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
    $pub = vgm_order_public($order);
    /* Musteriye USD kuru gosterilmez; yalnizca tarih. */
    $pub['rate'] = isset($order['rate']['date']) ? ['date' => (string)$order['rate']['date']] : null;
    $now = time();
    $pub['payOverdue'] = false;
    $pub['payment'] = null;
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
        $o['billing']['company'] ?? '', $o['shippingAddress']['city'] ?? '']));
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
            'itemCount' => count($o['items']), 'payBy' => vg_iso((int)$o['payBy']),
            'overdue' => $o['status'] === 'odeme_bekleniyor' && (int)$o['payBy'] < $now, '_t' => (int)$o['createdAt']];
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
            (float)$o['totals']['shippingTry'], (float)$o['totals']['tryGross'], number_format((float)$o['rate']['usdTry'], 4, ',', ''),
            $o['rate']['date'], isset($o['paidAt']) ? vgm_local((int)$o['paidAt']) : '']));
    }
    return "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n";
}
