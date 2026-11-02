<?php
/*
 * VoltGuard Magaza - uye hesabi baglantisi (api/MAGAZA.md "Üye hesabı ve Siparişlerim").
 *
 * Magaza ayri bir hesap sistemi KULLANMAZ: sitenin uye hesabi (api/auth.php, VGSESS oturumu) aynen kullanilir.
 *  - Oturum acikken verilen siparis, sunucuda oturumdaki uye kimligiyle isaretlenir (order.member); istemcinin
 *    gonderdigi hicbir uye kimligine guvenilmez.
 *  - Uye girisi yapmadan ayni e-postayla verilmis siparisler, yalnizca e-posta adresi DOGRULANMIS uyeye baglanir.
 *    Uye kaydi e-postayi dogrulamadigi icin (handlers.php vg_h_register) dogrulama burada yapilir: hesabin e-posta
 *    adresine 6 haneli, 15 dakika gecerli bir kod gonderilir; kod girilince adres o uye icin dogrulanmis sayilir.
 *    Uye e-postasini degistirirse dogrulama kendiliginden gecersiz olur (kayitli adres ile karsilastirilir).
 *  - Kayitli fatura/teslimat bilgisi yalnizca uyenin onay kutusuyla saklanir ve uye isterse silinir.
 *  - Hesap silinince siparislerdeki uye baglantisi ve bu dosyadaki kayit silinir; siparis kayitlari yasal saklama
 *    suresince kalir (magaza/kvkk-aydinlatma.html).
 * Veri: vg_data_dir()/magaza/uyeler.json {version:1, members:{uid:{verified?, verify?, saved?}}} (git disi, 0600).
 * Bu dosya hem api/magaza.php hem de hesap silme / disa aktarma icin api/auth.php tarafindan yuklenir; yalnizca
 * api/lib/magaza.php fonksiyonlarina dayanir.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VGM_MEMBERS_FILE = 'uyeler.json';
const VGM_MEMBERS_MAX = 8388608;          // 8 MiB
const VGM_VERIFY_TTL = 900;               // dogrulama kodu 15 dakika gecerli
const VGM_VERIFY_TRIES = 5;               // bir kod icin en cok 5 hatali deneme
const VGM_MEMBER_ORDERS_MAX = 200;        // listede en cok 200 siparis (en yeni once)
/*
 * Kod tahmini sinirlari E-POSTA ADRESINE baglidir (uye kimligine degil): hesap silinip ayni adresle yeniden kayit
 * olunsa (yeni uid) ya da IP degistirilse de sayaclar surer (rl/ dosyalari hesap silmede temizlenmez).
 * Gunde en cok 6 kod ve 10 hatali deneme: bir yilda tahmin sansi ~%0,4'un altinda kalir.
 */
const VGM_VERIFY_SEND_HOUR = 3;
const VGM_VERIFY_SEND_DAY = 6;
const VGM_VERIFY_FAIL_DAY = 10;

function vgm_uid_valid($uid): bool
{
    return is_string($uid) && preg_match('/^u[0-9a-f]{24}$/D', $uid) === 1;
}

function vgm_members_read(string $dir): array
{
    $state = vgm_read($dir, VGM_MEMBERS_FILE, ['version' => 1, 'members' => []], VGM_MEMBERS_MAX);
    if (!is_array($state['members'] ?? null)) {
        $state['members'] = [];
    }
    return $state;
}

function vgm_members_write(string $dir, array $state): void
{
    vgm_write($dir, VGM_MEMBERS_FILE, $state, VGM_MEMBERS_MAX);
}

function vgm_member_entry(string $uid): array
{
    return (array)vgm_locked(false, function (string $dir) use ($uid): array {
        $e = vgm_members_read($dir)['members'][$uid] ?? [];
        return is_array($e) ? $e : [];
    });
}

/** Uyenin SU ANKI hesap e-postasi dogrulanmis mi? (adres degisirse dogrulama gecersiz olur) */
function vgm_member_verified(array $entry, string $email): bool
{
    $v = $entry['verified'] ?? null;
    return $email !== '' && is_array($v) && is_string($v['email'] ?? null) && hash_equals($v['email'], $email);
}

function vgm_verify_hash(string $uid, string $email, string $code): string
{
    return hash_hmac('sha256', 'magaza-uye-dogrula' . "\0" . $uid . "\0" . $email . "\0" . $code, vg_secret());
}

/** Hesap e-postasina dogrulama kodu gonderir. @return bool e-posta tasiyiciya teslim edildi mi */
function vgm_member_verify_send(array $user, int $now): bool
{
    $uid = (string)$user['id'];
    $email = vg_normalize_email($user['email'] ?? '');
    if ($email === '') {
        vg_fail(422, 'invalid_email', 'Hesabınızdaki e-posta adresi geçersiz. Hesap ayarlarından düzeltin.');
    }
    if (vgm_member_verified(vgm_member_entry($uid), $email)) {
        vg_fail(409, 'already_verified', 'E-posta adresiniz zaten doğrulanmış.');
    }
    if (($retry = vgm_verify_fail_lock($email)) > 0) {
        vg_too_many($retry, 'Bu e-posta adresi için çok fazla hatalı kod girildi. Lütfen ' . vg_human_wait($retry) . ' sonra yeniden deneyin.');
    }
    if (($retry = vg_rl_hit('vgm_verify_send', $uid, VGM_VERIFY_SEND_HOUR, 3600)) > 0
        || ($retry = vg_rl_hit('vgm_verify_send_mail', $email, VGM_VERIFY_SEND_HOUR, 3600)) > 0
        || ($retry = vg_rl_hit('vgm_verify_send_mail_day', $email, VGM_VERIFY_SEND_DAY, 86400)) > 0) {
        vg_too_many($retry, 'Kısa sürede çok fazla doğrulama kodu istendi. Lütfen biraz sonra yeniden deneyin.');
    }
    if (($retry = vg_rl_hit('vgm_verify_send_ip', vg_rl_ip_key(), 10, 3600)) > 0) {
        vg_too_many($retry);
    }
    if (!vg_mail_can_send()) {
        vg_fail(503, 'mail_unavailable', 'Doğrulama e-postası şu anda gönderilemiyor. Lütfen daha sonra tekrar deneyin.');
    }
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    vgm_locked(true, function (string $dir) use ($uid, $email, $code, $now): void {
        $state = vgm_members_read($dir);
        $entry = is_array($state['members'][$uid] ?? null) ? $state['members'][$uid] : [];
        $entry['verify'] = ['hash' => vgm_verify_hash($uid, $email, $code), 'exp' => $now + VGM_VERIFY_TTL, 'tries' => 0];
        $state['members'][$uid] = $entry;
        vgm_members_write($dir, $state);
    });
    $body = vg_greeting((string)($user['name'] ?? '')) . "\n\n"
        . "VoltGuard hesabınızın e-posta adresini doğrulamak için kodunuz:\n\n    " . $code . "\n\n"
        . "Kod 15 dakika geçerlidir. Kodu Hesabım > Siparişlerim sayfasına girdiğinizde, bu e-posta adresiyle üye girişi yapmadan "
        . "verdiğiniz mağaza siparişleri hesabınızda görünür.\n\n"
        . "Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın; kodu kimseyle paylaşmayın.\n\n"
        . "VoltGuard\n" . vg_site_url() . "\n";
    $sent = vg_mail_send($email, 'VoltGuard: e-posta doğrulama kodunuz', $body, 'magaza-dogrula');
    if (!$sent) {
        error_log('VoltGuard magaza: verification mail not handed to transport');
    }
    return $sent;
}

/** E-posta adresi icin son 24 saatteki hatali deneme siniri asildiysa kalan bekleme suresi (sn), yoksa 0. */
function vgm_verify_fail_lock(string $email): int
{
    $now = vg_now();
    $hits = [];
    foreach ((vg_rl_peek('vgm_verify_fail_mail', $email)['hits'] ?? []) as $t) {
        if (is_int($t) && $now - $t < 86400) {
            $hits[] = $t;
        }
    }
    return count($hits) >= vg_rate_scale(VGM_VERIFY_FAIL_DAY) ? max(1, 86400 - ($now - min($hits))) : 0;
}

/** Kodu dogrular; dogruysa adres dogrulanmis olur. Hatali kodda 422, deneme hakki bitince 410/429. */
function vgm_member_verify_check(array $user, string $code, int $now): void
{
    $uid = (string)$user['id'];
    $email = vg_normalize_email($user['email'] ?? '');
    $code = (string)preg_replace('/\s+/', '', $code);
    if (preg_match('/^[0-9]{6}$/D', $code) !== 1) {
        vg_fail(422, 'invalid_code', 'E-postanıza gelen 6 haneli kodu girin.', ['code' => 'E-postanıza gelen 6 haneli kodu girin.']);
    }
    if ($email === '') {
        vg_fail(422, 'invalid_email', 'Hesabınızdaki e-posta adresi geçersiz. Hesap ayarlarından düzeltin.');
    }
    /* Adres basina gunluk hatali deneme siniri: uid'den bagimsiz, hesap silinip yeniden acilsa da surer. */
    if (($retry = vgm_verify_fail_lock($email)) > 0) {
        vg_too_many($retry, 'Bu e-posta adresi için çok fazla hatalı kod girildi. Lütfen ' . vg_human_wait($retry) . ' sonra yeniden deneyin.');
    }
    $result = vgm_locked(true, function (string $dir) use ($uid, $email, $code, $now): string {
        $state = vgm_members_read($dir);
        $entry = is_array($state['members'][$uid] ?? null) ? $state['members'][$uid] : [];
        $v = is_array($entry['verify'] ?? null) ? $entry['verify'] : null;
        if ($v === null || (int)($v['exp'] ?? 0) < $now || (int)($v['tries'] ?? 0) >= VGM_VERIFY_TRIES) {
            if ($v !== null) {
                unset($entry['verify']);
                $state['members'][$uid] = $entry;
                vgm_members_write($dir, $state);
            }
            return 'expired';
        }
        if (!hash_equals((string)$v['hash'], vgm_verify_hash($uid, $email, $code))) {
            $entry['verify']['tries'] = (int)$v['tries'] + 1;
            $state['members'][$uid] = $entry;
            vgm_members_write($dir, $state);
            return 'wrong';
        }
        unset($entry['verify']);
        $entry['verified'] = ['email' => $email, 'at' => $now];
        $state['members'][$uid] = $entry;
        vgm_members_write($dir, $state);
        return 'ok';
    });
    if ($result === 'expired') {
        vg_fail(410, 'code_expired', 'Kodun süresi doldu ya da çok fazla hatalı deneme yapıldı. Yeni kod isteyin.');
    }
    if ($result === 'wrong') {
        vg_rl_hit('vgm_verify_fail_mail', $email, VGM_VERIFY_FAIL_DAY, 86400);
        vgm_failure_delay();
        vg_fail(422, 'wrong_code', 'Kod hatalı. E-postanızdaki son kodu kontrol edin.', ['code' => 'Kod hatalı.']);
    }
}

function vgm_failure_delay(): void
{
    usleep(random_int(250000, 450000));
}

/**
 * Uye girisi yapmadan ayni e-postayla verilmis, henuz hicbir uyeye bagli olmayan siparisleri uyeye baglar.
 * Yalnizca dogrulanmis e-posta ile cagrilir (cagiran denetler). @return string[] baglanan siparis numaralari
 */
function vgm_member_claim(string $uid, string $email, int $now): array
{
    if (!vgm_uid_valid($uid) || $email === '') {
        return [];
    }
    $match = function (array $o) use ($email): bool {
        return !isset($o['member']['id']) && hash_equals((string)($o['customer']['email'] ?? ''), $email);
    };
    /* Once paylasimli kilitle bakilir: baglanacak siparis yoksa (cogu sayfa acilisi) yazma kilidi alinmaz, canli
       siparis yazimlariyla yarisilmaz. Aday varsa yazma kilidi altinda yeniden denetlenir. */
    $any = (bool)vgm_locked(false, function (string $dir) use ($match): bool {
        foreach (vgm_orders_read($dir)['orders'] as $o) {
            if ($match($o)) {
                return true;
            }
        }
        return false;
    });
    if (!$any) {
        return [];
    }
    return (array)vgm_locked(true, function (string $dir) use ($uid, $now, $match): array {
        $all = vgm_orders_read($dir);
        $refs = [];
        foreach ($all['orders'] as $ref => $o) {
            if (!$match($o)) {
                continue;
            }
            $all['orders'][$ref]['member'] = ['id' => $uid, 'linkedAt' => $now, 'via' => 'claim'];
            $refs[] = (string)$ref;
        }
        if ($refs) {
            vgm_orders_write($dir, $all);
        }
        return $refs;
    });
}

/** Uyenin siparisleri (en yeni once). */
function vgm_member_orders_raw(string $uid): array
{
    $list = (array)vgm_locked(false, function (string $dir) use ($uid): array {
        $out = [];
        foreach (vgm_orders_read($dir)['orders'] as $o) {
            if (($o['member']['id'] ?? null) === $uid) {
                $out[] = $o;
            }
        }
        return $out;
    });
    usort($list, function (array $a, array $b): int {
        return ((int)$b['createdAt']) <=> ((int)$a['createdAt']);
    });
    return $list;
}

/**
 * Kayitli fatura/teslimat bilgisi (uyenin onayiyla). $clean: vgm_order_input ciktisi.
 * T.C. kimlik no SAKLANMAZ: siparis detayinda da maskelenir; oturumu ele geciren biri hesap_profil ile tam
 * numarayi okuyamamali. Uye gerekirse her sipariste yeniden girer.
 */
function vgm_member_save_profile(string $uid, array $clean, int $now): void
{
    $billing = $clean['billing'];
    $billing['tckn'] = '';
    $saved = ['customer' => ['name' => (string)$clean['customer']['name'], 'phone' => (string)$clean['customer']['phone']],
        'billing' => $billing, 'shippingAddress' => $clean['shippingAddress'], 'savedAt' => $now];
    vgm_locked(true, function (string $dir) use ($uid, $saved): void {
        $state = vgm_members_read($dir);
        $entry = is_array($state['members'][$uid] ?? null) ? $state['members'][$uid] : [];
        $entry['saved'] = $saved;
        $state['members'][$uid] = $entry;
        vgm_members_write($dir, $state);
    });
}

function vgm_member_forget_saved(string $uid): bool
{
    return (bool)vgm_locked(true, function (string $dir) use ($uid): bool {
        $state = vgm_members_read($dir);
        if (!isset($state['members'][$uid]['saved'])) {
            return false;
        }
        unset($state['members'][$uid]['saved']);
        vgm_members_write($dir, $state);
        return true;
    });
}

/**
 * Hesap silme (handlers.php vg_h_delete_account): baglantilar ve uye kaydi silinir, siparisler kalir.
 * Donen geri alma kaydi YALNIZCA bellekte tutulur: hesap silmenin sonraki adimi basarisiz olursa
 * vgm_member_restore() ile baglantilar ve uye kaydi geri yazilir (hesap duruyorsa Siparislerim bos kalmaz).
 * @return array{unlinked:int, links:array<string,array>, entry:?array}
 */
function vgm_member_forget(string $uid, int $now): array
{
    if (!vgm_uid_valid($uid)) {
        return ['unlinked' => 0, 'links' => [], 'entry' => null];
    }
    return (array)vgm_locked(true, function (string $dir) use ($uid, $now): array {
        $links = [];
        $all = vgm_orders_read($dir);
        foreach ($all['orders'] as $ref => $o) {
            if (($o['member']['id'] ?? null) === $uid) {
                $links[(string)$ref] = $o['member'];
                unset($all['orders'][$ref]['member']);
                $all['orders'][$ref]['memberUnlinkedAt'] = $now;
            }
        }
        $state = vgm_members_read($dir);
        $entry = is_array($state['members'][$uid] ?? null) ? $state['members'][$uid] : null;
        /* Once uye kaydi, sonra siparisler: ikinci yazim basarisiz olursa baglantilar yerinde kalir, kayit geri yazilir. */
        if ($entry !== null) {
            unset($state['members'][$uid]);
            vgm_members_write($dir, $state);
        }
        if ($links) {
            try {
                vgm_orders_write($dir, $all);
            } catch (Throwable $e) {
                if ($entry !== null) {
                    $state['members'][$uid] = $entry;
                    vgm_members_write($dir, $state);
                }
                throw $e;
            }
        }
        return ['unlinked' => count($links), 'links' => $links, 'entry' => $entry];
    });
}

/** vgm_member_forget geri alma: hesap silinemediyse baglantilari ve uye kaydini geri yazar. */
function vgm_member_restore(string $uid, array $undo): void
{
    if (!vgm_uid_valid($uid)) {
        return;
    }
    vgm_locked(true, function (string $dir) use ($uid, $undo): void {
        $links = is_array($undo['links'] ?? null) ? $undo['links'] : [];
        if ($links) {
            $all = vgm_orders_read($dir);
            $n = 0;
            foreach ($links as $ref => $member) {
                if (isset($all['orders'][$ref]) && !isset($all['orders'][$ref]['member']['id'])) {
                    $all['orders'][$ref]['member'] = $member;
                    unset($all['orders'][$ref]['memberUnlinkedAt']);
                    $n++;
                }
            }
            if ($n > 0) {
                vgm_orders_write($dir, $all);
            }
        }
        if (is_array($undo['entry'] ?? null)) {
            $state = vgm_members_read($dir);
            if (!isset($state['members'][$uid])) {
                $state['members'][$uid] = $undo['entry'];
                vgm_members_write($dir, $state);
            }
        }
    });
}

/** KVKK disa aktarma (handlers.php vg_h_export): uyeye bagli siparis ozetleri ve kayitli bilgiler. */
function vgm_member_export(string $uid): array
{
    $orders = [];
    foreach (vgm_member_orders_raw($uid) as $o) {
        $orders[] = ['reference' => $o['ref'], 'createdAt' => vg_iso((int)$o['createdAt']), 'status' => $o['status'],
            'statusLabel' => VGM_STATUS_LABELS[$o['status']] ?? $o['status'], 'totalTry' => (float)$o['totals']['tryGross'],
            'linkedAt' => vg_iso((int)($o['member']['linkedAt'] ?? $o['createdAt'])), 'linkedVia' => (string)($o['member']['via'] ?? ''),
            'customer' => $o['customer'], 'billing' => $o['billing'], 'shippingAddress' => $o['shippingAddress']];
    }
    $entry = vgm_member_entry($uid);
    $saved = $entry['saved'] ?? null;
    if (is_array($saved) && isset($saved['savedAt'])) {
        $saved['savedAt'] = vg_iso((int)$saved['savedAt']);
    }
    $verified = $entry['verified'] ?? null;
    return ['orders' => $orders, 'savedCheckoutDetails' => is_array($saved) ? $saved : null,
        'verifiedEmail' => is_array($verified) ? ['email' => (string)$verified['email'], 'at' => vg_iso((int)$verified['at'])] : null];
}
