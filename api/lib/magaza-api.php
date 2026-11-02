<?php
/*
 * VoltGuard Magaza JSON API yonlendiricisi (api/magaza.php). Zarf uyelik API'siyle aynidir: {"api":"vg-auth/1","ok":...}.
 * Herkese acik: fiyatlar (GET), sepet, onbilgi, siparis (TEYITLI SIPARIS TALEBI: IBAN yok), durum (POST). Talebi yalnizca
 * personel teyit eder ya da reddeder (panel_order_confirm / panel_order_reject); musteri tarafinda bu islem yoktur. Uye (sitenin uye hesabi, api/lib/magaza-uye.php):
 * hesap_profil, hesap_siparisler, hesap_siparis (GET), hesap_dogrula_gonder, hesap_dogrula, hesap_sahiplen, hesap_adres_sil
 * (POST; oturum + Origin + X-VG-CSRF); her uye yalnizca kendine bagli siparisleri gorur. Panel islemleri: oturum (VGSESS) + Origin +
 * X-VG-CSRF + sunucuda atanmis magaza yetkisi (tools/magaza-admin.php grant). Herkese acik yanitlarda tedarikci,
 * maliyet, marj ve USD tutar YOKTUR (api/MAGAZA.md kural 5 ve sahibin "sayfada TL" karari).
 * Hicbir islem tum urunleri dolasmaz (50.000 urun): fiyatlar yalnizca istenen kimlikleri, panel sorun listesini
 * (fiyat-durum.json) ve sayimlari (fiyat-sira.json, manifest.json) okur.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

function vgm_api_routes(): array
{
    return [
        'fiyatlar' => ['GET', 'public'], 'sepet' => ['POST', 'public'], 'onbilgi' => ['POST', 'public'],
        'siparis' => ['POST', 'public'], 'durum' => ['POST', 'public'],
        'panel_me' => ['GET', 'session'],
        'hesap_profil' => ['GET', 'member'], 'hesap_siparisler' => ['GET', 'member'], 'hesap_siparis' => ['GET', 'member'],
        'hesap_dogrula_gonder' => ['POST', 'member'], 'hesap_dogrula' => ['POST', 'member'], 'hesap_sahiplen' => ['POST', 'member'],
        'hesap_adres_sil' => ['POST', 'member'],
        'panel_orders' => ['GET', 'panel'], 'panel_order' => ['GET', 'panel'], 'panel_order_update' => ['POST', 'panel'],
        'panel_order_confirm' => ['POST', 'panel'], 'panel_order_reject' => ['POST', 'panel'],
        'panel_prices' => ['GET', 'panel'], 'panel_price_decide' => ['POST', 'panel'], 'panel_check_now' => ['POST', 'panel'],
        'panel_status' => ['GET', 'panel'], 'panel_export' => ['POST', 'panel'],
    ];
}

function vgm_get_param(string $key): string
{
    $v = $_GET[$key] ?? '';
    return is_string($v) ? $v : '';
}

/** Bot dogrulamasi (contact.php ile ayni kurallar): gizli anahtar tanimliysa jeton zorunlu ve sunucuda dogrulanir. */
/** Ortam degiskeni varsa ozel dizine hic dokunmadan onu kullanir; yoksa iletisim formlarinin ortak ayari (dosya). */
function vgm_turnstile_config(): array
{
    $secret = getenv('TURNSTILE_SECRET_KEY');
    if (is_string($secret) && trim($secret) !== '' && $secret !== 'REPLACE_WITH_TURNSTILE_SECRET_KEY') {
        $host = getenv('TURNSTILE_EXPECTED_HOSTNAME');
        return ['secretKey' => vg_turnstile_secret_value($secret),
            'expectedHostname' => is_string($host) && trim($host) !== '' ? vg_turnstile_hostname_value($host) : 'voltguard.com.tr'];
    }
    return vg_turnstile_config();
}

function vgm_verify_captcha(string $token): void
{
    // Iletisim formlariyla ayni yapilandirma: TURNSTILE_SECRET_KEY ortami ya da VG_DATA_DIR/turnstile-config.json
    $config = vgm_turnstile_config();
    if ($config['secretKey'] === '') {
        if (getenv('VG_MAIL_OUTBOX') !== '1') {
            error_log('VoltGuard magaza: Turnstile secret is not configured; bot verification is off');
        }
        return;
    }
    vg_turnstile_verify($config, $token);
}

/** Herkese acik fiyat gorunumu (USD ve tedarikci bilgisi yok). */
function vgm_public_price(array $pr): array
{
    return ['tryNet' => $pr['tryNet'], 'tryGross' => $pr['tryGross'], 'vat' => $pr['vat'],
        'checkedAt' => $pr['checkedAt'] !== null ? vg_iso((int)$pr['checkedAt']) : null,
        'orderable' => $pr['orderable'], 'reason' => $pr['reason'], 'reasonText' => vgm_reason_text($pr['reason'])];
}

/** Sepet adimindaki canli fiyat kontrolu (fiyat 6 saatten eskiyse; toplam 8 sn, en cok 6 getirme). */
function vgm_live_recheck(array $ids): void
{
    if (!function_exists('vgm_refresh') || !$ids) {
        return;
    }
    try {
        vgm_refresh(['ids' => array_values($ids), 'live' => true, 'budget' => 8, 'max' => 6, 'spacing' => 0, 'rates' => true]);
    } catch (VgHttpError $e) {
        throw $e;
    } catch (Throwable $e) {
        error_log('VoltGuard magaza: live recheck failed (' . get_class($e) . ')');
    }
}

/* ------------------------------------------------------------------ uye hesabi (api/lib/magaza-uye.php) */

/**
 * Siparis gonderen ziyaretci uye girisi yapmis mi? Uye kimligi YALNIZCA sunucudaki oturumdan okunur (istemci girdisi
 * yok sayilir) ve yalnizca oturumun CSRF jetonu da gonderildiyse kullanilir. Cerez yoksa oturum dosyasi acilmaz.
 */
function vgm_checkout_member(): ?array
{
    $sent = (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '');
    if (!isset($_COOKIE[VG_SESSION_NAME]) || $sent === '') {
        return null;
    }
    $store = vg_store();
    vg_session_start();
    $known = isset($_SESSION['csrf']) && is_string($_SESSION['csrf']) ? $_SESSION['csrf'] : '';
    $user = $known !== '' && hash_equals($known, $sent) ? vg_session_user($store) : null;
    session_write_close();
    return $user !== null && vgm_uid_valid($user['id'] ?? null) ? $user : null;
}

/** T.C. kimlik no uyeye de tam gosterilmez (son 2 hane). */
function vgm_mask_tckn(string $t): string
{
    return $t === '' ? '' : str_repeat('•', max(0, strlen($t) - 2)) . substr($t, -2);
}

/** Odeme sayfasi on doldurma: uye profili + (onayla kaydedilmis) son fatura/teslimat bilgisi. */
function vgm_member_profile(?array $user): array
{
    if ($user === null) {
        return ['user' => null, 'saved' => null, 'verified' => false];
    }
    $entry = vgm_member_entry((string)$user['id']);
    $saved = is_array($entry['saved'] ?? null) ? $entry['saved'] : null;
    if ($saved !== null) {
        $saved['savedAt'] = vg_iso((int)($saved['savedAt'] ?? 0));
        if (is_array($saved['billing'] ?? null)) {
            $saved['billing']['tckn'] = '';   // kayitli bilgide T.C. kimlik no tutulmaz/gosterilmez (vgm_member_save_profile)
        }
    }
    return ['user' => ['name' => (string)$user['name'], 'email' => (string)$user['email'], 'phone' => (string)($user['phone'] ?? ''),
        'company' => (string)($user['company'] ?? '')], 'saved' => $saved,
        'verified' => vgm_member_verified($entry, vg_normalize_email($user['email'] ?? ''))];
}

/** Siparislerim satiri: musteri gorunumunden kisaltilmis ozet. */
function vgm_member_order_row(array $o, int $now): array
{
    $v = vgm_order_customer_view($o, $now);
    $first = $o['items'][0]['name'] ?? '';
    return ['reference' => $v['reference'], 'createdAt' => $v['createdAt'], 'status' => $v['status'], 'statusLabel' => $v['statusLabel'],
        'payBy' => $v['payBy'], 'payOverdue' => $v['payOverdue'], 'payment' => $v['payment'], 'totalTry' => (float)$o['totals']['tryGross'],
        'estimate' => $v['estimate'], 'unpriced' => (int)($o['totals']['unpriced'] ?? 0), 'respondBy' => $v['respondBy'],
        'paymentNote' => $v['paymentNote'] ?? null,
        'itemCount' => count($o['items']), 'firstItem' => (string)$first, 'tracking' => $v['tracking'],
        'linkedVia' => (string)($o['member']['via'] ?? 'checkout')];
}

function vgm_member_action(string $action, array $body, array $user, int $now): array
{
    $uid = (string)$user['id'];
    $email = vg_normalize_email($user['email'] ?? '');
    switch ($action) {
        case 'hesap_siparisler':
            $entry = vgm_member_entry($uid);
            $verified = vgm_member_verified($entry, $email);
            /* E-postasi dogrulanmis uyede, girissiz verilmis ayni e-postali siparisler kendiliginden hesaba eklenir. */
            $claimed = $verified ? vgm_member_claim($uid, $email, $now) : [];
            $orders = vgm_member_orders_raw($uid);
            $rows = [];
            foreach (array_slice($orders, 0, VGM_MEMBER_ORDERS_MAX) as $o) {
                $rows[] = vgm_member_order_row($o, $now);
            }
            return ['orders' => $rows, 'total' => count($orders), 'verified' => $verified, 'email' => $email,
                'claimed' => count($claimed), 'hasSaved' => is_array($entry['saved'] ?? null)];
        case 'hesap_siparis':
            $ref = strtoupper(trim(vgm_get_param('ref')));
            $o = vgm_reference_valid($ref) ? vgm_order_get($ref) : null;
            /* Baska uyenin ya da bagsiz siparis: var olup olmadigi da belli edilmez. */
            if ($o === null || ($o['member']['id'] ?? null) !== $uid) {
                vg_fail(404, 'not_found', 'Sipariş bulunamadı ya da hesabınıza bağlı değil.');
            }
            $v = vgm_order_customer_view($o, $now);
            $b = $o['billing'];
            $b['tckn'] = vgm_mask_tckn((string)($b['tckn'] ?? ''));
            $v['customer'] = $o['customer'];
            $v['billing'] = $b;
            $v['shippingAddress'] = $o['shippingAddress'];
            $v['notes'] = (string)($o['notes'] ?? '');
            $v['docs'] = ['preInfo' => (string)($o['docs']['preInfo'] ?? ''), 'contract' => (string)($o['docs']['contract'] ?? '')];
            $v['consents'] = isset($o['consents']['preInfo']) ? ['preInfo' => vg_iso((int)$o['consents']['preInfo']),
                'contract' => vg_iso((int)$o['consents']['contract']), 'docVersion' => (string)($o['consents']['docVersion'] ?? '')] : null;
            $v['linkedVia'] = (string)($o['member']['via'] ?? 'checkout');
            return ['order' => $v];
        case 'hesap_dogrula_gonder':
            if (!vgm_member_verify_send($user, $now)) {
                vg_fail(503, 'mail_failed', 'Doğrulama e-postası şu anda gönderilemedi. Lütfen biraz sonra tekrar deneyin.');
            }
            return ['sent' => true, 'message' => 'Doğrulama kodu ' . $email . ' adresine gönderildi. Kod 15 dakika geçerlidir.'];
        case 'hesap_dogrula':
            vgm_member_verify_check($user, is_string($body['code'] ?? null) ? $body['code'] : '', $now);
            $claimed = vgm_member_claim($uid, $email, $now);
            return ['verified' => true, 'claimed' => count($claimed), 'message' => $claimed
                ? 'E-posta adresiniz doğrulandı. Bu adresle verilen ' . count($claimed) . ' sipariş hesabınıza eklendi.'
                : 'E-posta adresiniz doğrulandı. Bu adresle üye girişi yapmadan verilmiş başka sipariş bulunmadı.'];
        case 'hesap_sahiplen':
            if (!vgm_member_verified(vgm_member_entry($uid), $email)) {
                vg_fail(403, 'email_unverified', 'Önce e-posta adresinizi doğrulayın; siparişler yalnızca doğrulanmış adrese eklenir.');
            }
            $claimed = vgm_member_claim($uid, $email, $now);
            return ['claimed' => count($claimed)];
        case 'hesap_adres_sil':
            return ['removed' => vgm_member_forget_saved($uid)];
    }
    vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
    return [];
}

function vgm_public_action(string $action, array $body, int $now): array
{
    if ($action === 'fiyatlar') {
        if (($retry = vg_rl_hit('vgm_read', vg_rl_ip_key(), 240, 60)) > 0) {
            vg_too_many($retry);
        }
        /* ?ids=vgm-0101,vgm-0102 (en cok 100): yalnizca istenen urunlerin fiyati. */
        $ids = array_values(array_unique(array_filter(explode(',', vgm_get_param('ids')), function (string $id): bool {
            return vgm_id_valid($id);
        })));
        if (!$ids || count($ids) > 100) {
            vg_fail(422, 'invalid_ids', 'En az bir, en çok 100 ürün kimliği verin (?ids=vgm-0101,vgm-0102).');
        }
        list($config, $state, $rate) = vgm_locked(false, function (string $dir) use ($ids): array {
            return [vgm_config($dir), vgm_price_items($dir, $ids), vgm_rate_state($dir)];
        });
        $open = vgm_shop_open($config);
        $items = [];
        foreach ($ids as $id) {
            $p = vgm_product($id);
            if ($p !== null) {
                $items[$id] = vgm_public_price(vgm_price($p, $state[$id] ?? null, $rate, $config, $open, $now));
            }
        }
        return ['open' => $open, 'rate' => vgm_rate_ok($rate, $now) ? ['date' => (string)$rate['date']] : null, 'items' => $items,
            'generatedAt' => vg_iso($now)];
    }
    if ($action === 'sepet') {
        if (($retry = vg_rl_hit('vgm_cart', vg_rl_ip_key(), 60, 600)) > 0) {
            vg_too_many($retry);
        }
        $cart = vgm_cart_items($body['items'] ?? null);
        vgm_live_recheck(array_keys($cart));
        $quote = vgm_quote($cart, $now);
        if ($quote['quote'] !== null) {
            $quote['quote']['token'] = vgm_quote_seal($quote['quote']['token']);
        }
        $quote['rate'] = $quote['rate'] !== null ? ['date' => $quote['rate']['date']] : null;
        return $quote;
    }
    if ($action === 'onbilgi') {
        if (($retry = vg_rl_hit('vgm_doc', vg_rl_ip_key(), 120, 600)) > 0) {
            vg_too_many($retry);
        }
        /* Talep asamasi belgeleri (tahmini tutarlar, IBAN yok): sunucu fiyatlari kendisi hesaplar. */
        $cart = vgm_cart_items($body['items'] ?? null);
        $errors = [];
        $clean = vgm_order_input($body, $errors, false);
        $config = vgm_locked(false, function (string $dir): array {
            return vgm_config($dir);
        });
        $draft = vgm_request_draft($cart, $clean, $config, $now);
        return vgm_order_docs($draft, $config);
    }
    if ($action === 'siparis') {
        $captcha = is_string($body['turnstile'] ?? null) ? $body['turnstile'] : '';
        $guard = function () use ($captcha): void {
            if (($retry = vg_rl_hit('vgm_order_ip', vg_rl_ip_key(), 5, 600)) > 0) {
                vg_too_many($retry, 'Kısa sürede çok fazla sipariş denemesi yapıldı. Lütfen birkaç dakika sonra yeniden deneyin.');
            }
            if (($retry = vg_rl_hit('vgm_order_all', 'all', 60, 3600)) > 0) {
                vg_too_many($retry, 'Şu anda çok sayıda sipariş alınıyor. Lütfen biraz sonra tekrar deneyin veya bizi telefonla arayın.');
            }
            vgm_verify_captcha($captcha);
        };
        $member = vgm_checkout_member();
        /* Istemci uye oturumuyla gonderdi (CSRF basligi var) ama oturum dogrulanamadiysa (suresi doldu, baska sekmede
           cikis/giris) siparis yine alinir; baglanmadigi durust bildirilir, sessizce "kaydedildi" denmez. */
        $memberClaimed = (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '') !== '';
        $result = vgm_order_create($body, $now, $guard, $member !== null ? (string)$member['id'] : null);
        $o = $result['order'];
        $account = $memberClaimed ? ['linked' => false, 'saved' => false] : null;
        if ($member !== null) {
            $linked = ($o['member']['id'] ?? null) === $member['id'];
            $saved = false;
            if ($linked && ($body['saveDetails'] ?? false) === true) {
                try {
                    vgm_member_save_profile((string)$member['id'], $result['clean'], $now);
                    $saved = true;
                } catch (Throwable $e) {
                    /* Siparis alindi; kayitli bilgi yazilamadiysa siparis basarisiz sayilmaz, durum durust bildirilir. */
                    error_log('VoltGuard magaza: saved checkout details not written (' . get_class($e) . ')');
                }
            }
            $account = ['linked' => $linked, 'saved' => $saved];
        }
        $preview = getenv('VG_MAIL_OUTBOX') === '1';
        $mailed = ($o['mail']['customer'] ?? true) === true;
        $respond = isset($o['respondBy']) && is_int($o['respondBy']) ? $o['respondBy'] : null;
        $respondText = $respond !== null ? vgm_local($respond) . ' (TSİ)' : '';
        $message = $result['duplicate']
            ? 'Bu talep daha önce ' . $o['ref'] . ' numarasıyla alınmıştı; tekrar kaydedilmedi.'
            : 'Sipariş talebiniz ' . $o['ref'] . ' numarasıyla alındı. Stok ve fiyatı teyit ettikten sonra kesin tutarı ve ödeme bilgilerini '
                . 'en geç ' . VGM_CONFIRM_BUSINESS_DAYS . ' iş günü içinde e-postayla göndereceğiz. Teyit gelmeden ödeme yapmayın.';
        if (!$mailed) {
            $message .= ' Bilgilendirme e-postası şu anda gönderilemedi; ekibimiz sizinle iletişime geçecek.';
        } elseif ($preview) {
            $message .= ' (Önizleme: e-posta gönderilmez.)';
        }
        /* Talep yaniti: odeme bilgisi (banka, IBAN, son odeme) YOKTUR; yalnizca tahmini tutar ve yanit suresi. */
        return ['reference' => $o['ref'], 'status' => $o['status'], 'estimateTry' => (float)$o['totals']['tryGross'],
            'estimateText' => vgm_fmt_try((float)$o['totals']['tryGross']), 'unpriced' => (int)($o['totals']['unpriced'] ?? 0),
            'respondBy' => $respond !== null ? vg_iso($respond) : null, 'respondByText' => $respondText,
            'responseDays' => VGM_CONFIRM_BUSINESS_DAYS,
            'message' => $message, 'duplicate' => $result['duplicate'], 'mailSent' => $mailed, 'preview' => $preview,
            'account' => $account];
    }
    if ($action === 'durum') {
        if (($retry = vg_rl_hit('vgm_status', vg_rl_ip_key(), 20, 600)) > 0) {
            vg_too_many($retry);
        }
        $ref = is_string($body['reference'] ?? null) ? $body['reference'] : '';
        $email = is_string($body['email'] ?? null) ? $body['email'] : '';
        $order = vgm_order_lookup($ref, $email);
        if ($order === null) {
            vg_fail(404, 'not_found', 'Sipariş bulunamadı. Sipariş numarasını ve e-posta adresini kontrol edin.');
        }
        return ['order' => $order];
    }
    vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
    return [];
}

/* ------------------------------------------------------------------ panel */

/** Personel icin fiyat satiri: maliyet, USD satis fiyati, kaynaklar ve onay bekleyen degisiklik. */
function vgm_panel_price_row(array $p, ?array $s, ?array $rate, array $config, bool $open, int $now): array
{
    $pr = vgm_price($p, $s, $rate, $config, $open, $now);
    $sources = [];
    foreach (vgm_sources($config, $p['id']) as $i => $src) {
        $sources[] = ['index' => $i, 'supplier' => $src['supplier'], 'url' => $src['url'], 'discount' => $src['discount'] ?? 0];
    }
    return ['id' => $p['id'], 'name' => $p['name'], 'category' => $p['category'], 'status' => $s['status'] ?? null,
        'costTry' => $s['costTry'] ?? null, 'usdNet' => $pr['usdNet'], 'tryGross' => $pr['tryGross'], 'margin' => vgm_margin($config, $p),
        'checkedAt' => isset($s['checkedAt']) ? vg_iso((int)$s['checkedAt']) : null,
        'lastAttemptAt' => isset($s['lastAttemptAt']) ? vg_iso((int)$s['lastAttemptAt']) : null,
        'orderable' => $pr['orderable'], 'reason' => $pr['reason'], 'held' => $s['held'] ?? null, 'note' => $s['note'] ?? '',
        'method' => $s['method'] ?? null, 'sources' => $sources];
}

/**
 * Teyit yardimi (yalnizca personel): talepteki her urun icin tedarikcinin SON fiyat kontrolu (alis, KDV dahil satis onerisi,
 * durum, kontrol zamani, kaynaklar) ve magazanin kargo ayari. Personel "Şimdi kontrol et" ile panel_check_now'i calistirip
 * bu yardimi yeniler. Musteriye hicbir yerde gosterilmez.
 */
function vgm_panel_confirm_aid(array $order, int $now): array
{
    $ids = array_map(function (array $it): string {
        return (string)$it['id'];
    }, $order['items']);
    list($config, $prices, $rate) = vgm_locked(false, function (string $dir) use ($ids): array {
        return [vgm_config($dir), vgm_price_items($dir, $ids), vgm_rate_state($dir)];
    });
    $lines = [];
    foreach ($ids as $id) {
        $p = vgm_product($id);
        if ($p === null) {
            $lines[$id] = null;
            continue;
        }
        $row = vgm_panel_price_row($p, $prices[$id] ?? null, $rate, $config, true, $now);
        $row['reasonText'] = vgm_reason_text($row['reason']);
        $row['fresh'] = is_int($prices[$id]['checkedAt'] ?? null) && $now - (int)$prices[$id]['checkedAt'] <= VGM_PRICE_MAX_AGE;
        $row['available'] = $prices[$id]['available'] ?? null;
        $row['maxQty'] = (int)$p['maxQty'];
        $lines[$id] = $row;
    }
    $ship = is_array($config['shipping'] ?? null) ? $config['shipping'] : [];
    return ['lines' => $lines, 'shipping' => ['feeTry' => (float)($ship['feeTry'] ?? 0), 'freeOverTry' => (float)($ship['freeOverTry'] ?? 0)],
        'paymentHours' => (int)($config['paymentHours'] ?? 24),
        'rate' => vgm_rate_ok($rate, $now) ? ['usdTry' => (float)$rate['usdTry'], 'date' => (string)$rate['date']] : null];
}

/** Sira dosyasindan sayimlar (kaynagi olan urunler) ve kaynaksiz urun sayisi (manifest). */
function vgm_panel_counts(array $queue, int $products, int $now): array
{
    $counts = ['ok' => 0, 'held' => 0, 'error' => 0, 'unavailable' => 0, 'stale' => 0, 'noSource' => 0];
    foreach ($queue as $e) {
        $st = is_array($e) && is_string($e[2] ?? null) ? $e[2] : 'error';
        if (isset($counts[$st])) {
            $counts[$st]++;
        }
        $at = is_array($e) ? (int)($e[0] ?? 0) : 0;
        if ($at === 0 || $now - $at > VGM_PRICE_MAX_AGE) {
            $counts['stale']++;
        }
    }
    $counts['noSource'] = max(0, $products - count($queue));
    return $counts;
}

function vgm_panel_status(int $now): array
{
    vgm_queue_ensure();
    list($config, $queue, $status, $rate, $orders) = vgm_locked(false, function (string $dir): array {
        return [vgm_config($dir), vgm_queue_read($dir)['items'], vgm_status_read($dir), vgm_rate_state($dir), vgm_orders_read($dir)['orders']];
    });
    $open = vgm_shop_open($config);
    $products = vgm_manifest()['products'];
    $counts = vgm_panel_counts($queue, $products, $now);
    $awaiting = 0;
    $overdue = 0;
    $confirm = 0;
    $confirmLate = 0;
    foreach ($orders as $o) {
        if ($o['status'] === 'teyit_bekliyor') {
            $confirm++;
            if (isset($o['respondBy']) && (int)$o['respondBy'] < $now) {
                $confirmLate++;
            }
        }
        if ($o['status'] === 'odeme_bekleniyor') {
            $awaiting++;
            if ((int)$o['payBy'] < $now) {
                $overdue++;
            }
        }
    }
    $last = is_int($status['lastRunAt'] ?? null) ? $status['lastRunAt'] : null;
    $healthyAfter = defined('VGM_HEALTHY_AFTER') ? (int)constant('VGM_HEALTHY_AFTER') : 1800;
    $sourced = count($queue);
    return ['open' => $open, 'configOpen' => ($config['open'] ?? false) === true, 'firmaMissing' => vgm_firma_missing(vgm_firma()),
        'rate' => $rate !== null ? ['usdTry' => (float)$rate['usdTry'], 'date' => (string)($rate['date'] ?? ''),
            'fetchedAt' => isset($rate['fetchedAt']) ? vg_iso((int)$rate['fetchedAt']) : null, 'ok' => vgm_rate_ok($rate, $now)] : null,
        'cron' => ['lastRunAt' => $last !== null ? vg_iso($last) : null, 'healthy' => $last !== null && $now - $last <= $healthyAfter,
            'summary' => $status['lastRunSummary'] ?? null,
            'freshShare' => $sourced > 0 ? round(($sourced - $counts['stale']) / $sourced, 4) : null],
        'counts' => $counts, 'orders' => ['awaitingPayment' => $awaiting, 'overdue' => $overdue, 'awaitingConfirm' => $confirm, 'confirmLate' => $confirmLate],
        'products' => $products];
}

function vgm_panel_action(string $action, array $body, array $user, int $now): array
{
    $actor = ['id' => $user['id'], 'name' => $user['name']];
    switch ($action) {
        case 'panel_orders':
            return vgm_orders_list(['status' => vgm_get_param('status'), 'q' => vgm_get_param('q'), 'page' => (int)vgm_get_param('page')], $now);
        case 'panel_order':
            $order = vgm_order_get(strtoupper(vgm_get_param('ref')));
            if ($order === null) {
                vg_fail(404, 'not_found', 'Sipariş bulunamadı.');
            }
            $memberInfo = null;
            if (isset($order['member']['id']) && is_string($order['member']['id'])) {
                $u = vg_store()->findUserById($order['member']['id']);
                $memberInfo = ['id' => $order['member']['id'], 'via' => (string)($order['member']['via'] ?? ''),
                    'linkedAt' => vg_iso((int)($order['member']['linkedAt'] ?? 0)), 'exists' => $u !== null,
                    'name' => $u !== null ? (string)$u['name'] : '', 'email' => $u !== null ? (string)$u['email'] : ''];
            }
            return ['order' => $order, 'allowed' => VGM_TRANSITIONS[$order['status']] ?? [], 'memberInfo' => $memberInfo,
                'confirmAid' => $order['status'] === 'teyit_bekliyor' ? vgm_panel_confirm_aid($order, $now) : null];
        case 'panel_order_confirm':
        case 'panel_order_reject':
            $ref = is_string($body['ref'] ?? null) ? strtoupper($body['ref']) : '';
            if (!vgm_reference_valid($ref)) {
                vg_fail(422, 'invalid_reference', 'Geçersiz sipariş numarası.');
            }
            $order = $action === 'panel_order_confirm' ? vgm_order_confirm($ref, $body, $actor, $now) : vgm_order_reject($ref, $body, $actor, $now);
            $mailSent = $order['_mailSent'];
            unset($order['_mailSent']);
            return ['order' => $order, 'allowed' => VGM_TRANSITIONS[$order['status']] ?? [], 'mailSent' => $mailSent];
        case 'panel_order_update':
            $ref = is_string($body['ref'] ?? null) ? strtoupper($body['ref']) : '';
            if (!vgm_reference_valid($ref)) {
                vg_fail(422, 'invalid_reference', 'Geçersiz sipariş numarası.');
            }
            $order = vgm_order_update($ref, $body, $actor, $now);
            $mailSent = $order['_mailSent'];
            unset($order['_mailSent']);
            return ['order' => $order, 'allowed' => VGM_TRANSITIONS[$order['status']] ?? [], 'mailSent' => $mailSent];
        case 'panel_prices':
            /* Sorunlu urunler (fiyat-durum.json, en cok 300) + ?q= ile aranan urunler (kimlik ya da ad/marka/model, en cok 50). */
            $q = vg_text(vgm_get_param('q'), 80);
            vgm_queue_ensure();
            list($config, $status, $rate, $queue) = vgm_locked(false, function (string $dir): array {
                return [vgm_config($dir), vgm_status_read($dir), vgm_rate_state($dir), vgm_queue_read($dir)['items']];
            });
            $problemIds = array_keys($status['problems']);
            sort($problemIds, SORT_STRING);
            $ids = [];
            $matched = [];
            if ($q !== '') {
                if (vgm_id_valid(strtolower($q))) {
                    $matched[strtolower($q)] = true;
                } else {
                    foreach (vgm_search($q, 50, false)['items'] as $card) {
                        $matched[$card['id']] = true;
                    }
                }
                $ids = array_keys($matched);
            }
            foreach (array_slice($problemIds, 0, 300) as $id) {
                $ids[] = (string)$id;
            }
            $ids = array_values(array_unique($ids));
            $prices = vgm_locked(false, function (string $dir) use ($ids): array {
                return vgm_price_items($dir, $ids);
            });
            $open = vgm_shop_open($config);
            $items = [];
            foreach ($ids as $id) {
                $p = vgm_product($id);
                if ($p !== null) {
                    $items[] = vgm_panel_price_row($p, $prices[$id] ?? null, $rate, $config, $open, $now) + ['match' => isset($matched[$id])];
                }
            }
            $products = vgm_manifest()['products'];
            return ['rate' => $rate, 'lastRunAt' => isset($status['lastRunAt']) ? vg_iso((int)$status['lastRunAt']) : null,
                'lastRunSummary' => $status['lastRunSummary'] ?? null, 'items' => $items, 'query' => $q,
                'problems' => count($problemIds), 'counts' => vgm_panel_counts($queue, $products, $now), 'products' => $products];
        case 'panel_price_decide':
            $id = is_string($body['id'] ?? null) ? $body['id'] : '';
            $p = vgm_product($id);
            $decision = $body['decision'] ?? '';
            if ($p === null || !in_array($decision, ['approve', 'reject', 'manual'], true)) {
                vg_fail(422, 'invalid_request', 'Ürün veya karar geçersiz.');
            }
            $note = vg_text($body['note'] ?? '', 200);
            $cost = $body['costTry'] ?? null;
            if ($decision === 'manual' && (!(is_int($cost) || is_float($cost)) || $cost <= 0 || $cost > 100000000)) {
                vg_fail(422, 'invalid_price', 'KDV dahil alış fiyatını TL olarak girin.');
            }
            if ($decision === 'manual' && $note === '') {
                vg_fail(422, 'note_required', 'Elle girilen fiyatın kaynağını not olarak yazın (ör. tedarikçiyle telefonda teyit).');
            }
            $item = vgm_locked(true, function (string $dir) use ($p, $decision, $note, $cost, $body, $user, $now): array {
                $item = vgm_price_item($dir, $p['id']);
                if ($decision === 'manual') {
                    $rate = vgm_rate_state($dir);
                    if (!vgm_rate_ok($rate, $now)) {
                        vg_fail(409, 'no_rate', 'Güncel TCMB kuru yok; önce kuru güncelleyin.');
                    }
                    $item = vgm_apply_check($item, $p, (int)($item['source'] ?? 0), ['price' => (float)$cost, 'currency' => 'TRY',
                        'vatIncluded' => true, 'available' => ($body['available'] ?? true) !== false,
                        'method' => 'manual:' . vg_text($user['name'], 30)], ['USD' => (float)$rate['usdTry'], 'EUR' => (float)($rate['eurTry'] ?? 0)], $now);
                    $item['note'] = $note;
                } else {
                    if ($item === null) {
                        vg_fail(409, 'not_held', 'Bu ürün için onay bekleyen fiyat yok.');
                    }
                    $item = vgm_decide_held($item, $decision, $note, $now);
                }
                vgm_prices_put($dir, [$p['id'] => $item]);
                return $item;
            });
            return ['item' => $item];
        case 'panel_check_now':
            /* {id}: tek urun; {batch: true}: zamani gelen en cok 5 urun (istek suresi icinde, kalp atisi yazmaz). */
            $batch = ($body['batch'] ?? false) === true;
            $id = is_string($body['id'] ?? null) ? $body['id'] : '';
            if (!$batch && vgm_product($id) === null) {
                vg_fail(422, 'invalid_request', 'Ürün bulunamadı.');
            }
            if (!function_exists('vgm_refresh')) {
                vg_fail(503, 'unavailable', 'Fiyat kontrol modülü yüklü değil.');
            }
            if (($retry = vg_rl_hit('vgm_check', $user['id'], 20, 600)) > 0) {
                vg_too_many($retry);
            }
            if ($batch) {
                /* Zamanlanmis calismayla ayni kilit: cron calisiyorsa ayni urunler iki kez getirilmez. */
                $lock = @fopen(vgm_dir() . '/cron.lock', 'c+');
                if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
                    if ($lock !== false) {
                        fclose($lock);
                    }
                    vg_fail(409, 'cron_running', 'Zamanlanmış fiyat kontrolü şu anda çalışıyor; birkaç dakika sonra yeniden deneyin.');
                }
                try {
                    $summary = vgm_refresh(['ids' => null, 'live' => false, 'budget' => 20, 'max' => 5, 'rates' => true, 'heartbeat' => false]);
                } finally {
                    flock($lock, LOCK_UN);
                    fclose($lock);
                }
                return ['item' => null, 'summary' => $summary];
            }
            $summary = vgm_refresh(['ids' => [$id], 'live' => false, 'budget' => 25, 'max' => 3, 'spacing' => 0, 'rates' => true]);
            $item = vgm_locked(false, function (string $dir) use ($id): ?array {
                return vgm_price_item($dir, $id);
            });
            return ['item' => $item, 'summary' => $summary];
        case 'panel_status':
            return vgm_panel_status($now);
        case 'panel_export':
            $csv = vgm_orders_csv(['from' => $body['from'] ?? '', 'to' => $body['to'] ?? '']);
            return ['_raw' => $csv, '_headers' => ['Content-Type: text/csv; charset=utf-8',
                'Content-Disposition: attachment; filename="voltguard-siparisler-' . gmdate('Ymd', $now) . '.csv"']];
    }
    vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
    return [];
}

function vgm_api_run(): void
{
    ob_start();
    try {
        $action = vg_action();
        $routes = vgm_api_routes();
        if (!isset($routes[$action])) {
            vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
        }
        list($method, $role) = $routes[$action];
        $request = vg_method();
        if ($request === 'HEAD' && $method === 'GET') {
            $request = 'GET';
        }
        if ($request !== $method) {
            vg_fail(405, 'method_not_allowed', 'Bu işlem için istek yöntemi desteklenmiyor.', [], ['Allow: ' . $method]);
        }
        vg_check_fetch_site();
        $body = [];
        if ($method === 'POST') {
            vg_require_same_origin();
            $body = vg_json_body(32768);
        }
        $now = vg_now();
        if ($role === 'public') {
            vg_send(200, ['ok' => true, 'service' => VGM_SERVICE] + vgm_public_action($action, $body, $now));
            vg_schedule_gc();
            vg_finish_and_run_jobs();
            return;
        }
        if ($method === 'POST' && (!isset($_COOKIE[VG_SESSION_NAME]) || (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '') === '')) {
            vg_fail(403, 'csrf', 'Güvenlik doğrulaması başarısız oldu. Sayfayı yenileyip tekrar deneyin.');
        }
        if ($role === 'member' && !isset($_COOKIE[VG_SESSION_NAME])) {
            /* Oturum cerezi olmayan ziyaretci: oturum dosyasi acilmaz (odeme sayfasi her ziyaretcide hesap_profil sorar). */
            if ($action === 'hesap_profil') {
                vg_send(200, ['ok' => true, 'service' => VGM_SERVICE] + vgm_member_profile(null));
                vg_finish_and_run_jobs();
                return;
            }
            vg_fail(401, 'unauthorized', 'Siparişlerinizi görmek için üye girişi yapın.');
        }
        $store = vg_store();
        vg_session_start();
        if ($method === 'POST') {
            vg_require_csrf();
        }
        $user = vg_session_user($store);
        $csrf = vg_csrf_token();
        session_write_close();
        if ($action === 'panel_me') {
            vg_send(200, ['ok' => true, 'service' => VGM_SERVICE, 'user' => $user ? ['id' => $user['id'], 'name' => $user['name']] : null,
                'panel' => vgm_is_panel($user), 'csrf' => $csrf]);
            vg_finish_and_run_jobs();
            return;
        }
        if ($role === 'member') {
            if ($action === 'hesap_profil') {
                vg_send(200, ['ok' => true, 'service' => VGM_SERVICE] + vgm_member_profile($user) + ['csrf' => $csrf]);
                vg_finish_and_run_jobs();
                return;
            }
            if ($user === null) {
                vg_fail(401, 'unauthorized', 'Siparişlerinizi görmek için üye girişi yapın.');
            }
            if (($retry = vg_rl_hit('vgm_member', $user['id'], 300, 600)) > 0) {
                vg_too_many($retry);
            }
            vg_send(200, ['ok' => true, 'service' => VGM_SERVICE] + vgm_member_action($action, $body, $user, $now) + ['csrf' => $csrf]);
            vg_schedule_gc();
            vg_finish_and_run_jobs();
            return;
        }
        if ($user === null) {
            vg_fail(401, 'unauthorized', 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.');
        }
        if (!vgm_is_panel($user)) {
            vg_fail(403, 'forbidden', 'Bu işlem yalnızca mağaza yetkisi olan personele açıktır.');
        }
        if (($retry = vg_rl_hit('vgm_panel', $user['id'], 600, 600)) > 0) {
            vg_too_many($retry);
        }
        $result = vgm_panel_action($action, $body, $user, $now);
        if (isset($result['_raw'])) {
            vg_send_raw(200, $result['_raw'], $result['_headers'] ?? []);
        } else {
            vg_send(200, ['ok' => true, 'service' => VGM_SERVICE] + $result + ['csrf' => $csrf]);
        }
        vg_schedule_gc();
    } catch (VgHttpError $error) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        $payload = ['ok' => false, 'service' => VGM_SERVICE, 'error' => $error->errCode, 'message' => $error->getMessage()];
        if ($error->fields) {
            $payload['fields'] = $error->fields;
        }
        vg_send($error->status, $payload + array_intersect_key($error->extra, ['reference' => 1, 'retryAfter' => 1]), $error->headers);
    } catch (Throwable $error) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        error_log('VoltGuard magaza: request failed (' . get_class($error) . ')');
        vg_send(503, ['ok' => false, 'service' => VGM_SERVICE, 'error' => 'unavailable', 'message' => 'Mağaza şu anda yanıt veremiyor. Lütfen biraz sonra tekrar deneyin veya bizi telefonla arayın.']);
    }
    vg_finish_and_run_jobs();
}
