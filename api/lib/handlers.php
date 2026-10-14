<?php
/*
 * VoltGuard hesap API - islemler (endpoint'ler) ve yonlendirici.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

/** Istemciye donen kullanici bilgisi (sifre ozeti ve ic alanlar yok). */
function vg_public_user(array $u): array
{
    return [
        'id' => $u['id'],
        'name' => $u['name'],
        'email' => $u['email'],
        'company' => $u['company'],
        'phone' => $u['phone'],
        'createdAt' => vg_iso((int)$u['created_at']),
        'lastLoginAt' => (int)$u['last_login_at'] > 0 ? vg_iso((int)$u['last_login_at']) : null,
    ];
}

function vg_hash_password(string $pw): string
{
    $hash = password_hash($pw, PASSWORD_DEFAULT, VG_PW_OPTIONS);
    if (!is_string($hash) || $hash === '') {
        throw new RuntimeException('password_hash failed');
    }
    return $hash;
}

/** Var olmayan hesaplarda da ayni maliyette dogrulama yapmak icin sabit (rastgele) ozet. */
function vg_dummy_hash(): string
{
    $file = vg_data_dir() . '/dummy.hash';
    $h = @file_get_contents($file);
    if (is_string($h) && strpos($h, '$') === 0 && strlen($h) >= 50) {
        return trim($h);
    }
    $h = vg_hash_password(bin2hex(random_bytes(16)));
    @file_put_contents($file, $h, LOCK_EX);
    @chmod($file, 0600);
    return $h;
}

function vg_email_key(string $email): string
{
    return $email !== '' ? $email : '-';
}

/** Basarisiz denemeyi yavaslatir (kucuk, sabit + rastgele gecikme). */
function vg_failure_delay(): void
{
    usleep(random_int(250000, 450000));
}

function vg_new_user_id(): string
{
    return 'u' . bin2hex(random_bytes(12));
}

/** Gecerli bir kullanicinin sifresini dogrular; hatali denemeleri kullanici basina sayar ve kilitler. */
function vg_verify_user_password(VgStore $store, array $user, $password, string $field): void
{
    $remaining = vg_fail_lock_remaining('pw_user', $user['id']);
    if ($remaining > 0) {
        vg_too_many($remaining);
    }
    if (!is_string($password) || $password === '' || !password_verify($password, $user['pass'])) {
        vg_fail_record('pw_user', $user['id'], 5, true);
        vg_failure_delay();
        vg_fail(422, 'wrong_password', 'Mevcut şifreniz hatalı.', [$field => 'Mevcut şifreniz hatalı.']);
    }
    vg_rl_clear('pw_user', $user['id']);
    if (password_needs_rehash($user['pass'], PASSWORD_DEFAULT, VG_PW_OPTIONS)) {
        $store->updateUser($user['id'], ['pass' => vg_hash_password($password)]);
    }
}

function vg_validation_failed(array $errors): void
{
    vg_fail(422, 'validation', 'Lütfen işaretli alanları kontrol edin.', $errors);
}

/* ================================================================== islemler */

function vg_h_me(VgStore $store, array $body): array
{
    $u = vg_session_user($store);
    $out = ['ok' => true, 'user' => $u ? vg_public_user($u) : null, 'csrf' => vg_csrf_token()];
    if ($u === null && !empty($_SESSION['expired'])) {
        $out['expired'] = true;
    }
    unset($_SESSION['expired']);
    return $out;
}

function vg_h_register(VgStore $store, array $body): array
{
    /* Bal tuzagi: insanlar bu gizli alani gormez ve doldurmaz. */
    if (isset($body['website']) && (!is_string($body['website']) || trim($body['website']) !== '')) {
        vg_failure_delay();
        vg_fail(400, 'rejected', 'Kayıt tamamlanamadı. Sayfayı yenileyip tekrar deneyin.');
    }
    $errors = [];
    $name = vg_validate_name($body['name'] ?? '', $errors);
    $email = vg_validate_email_field($body['email'] ?? '', $errors);
    $password = $body['password'] ?? '';
    $pwProblem = vg_password_problem($password);
    if ($pwProblem !== '') {
        $errors['password'] = $pwProblem;
    }
    $company = vg_validate_company($body['company'] ?? '', $errors);
    $phone = vg_validate_phone($body['phone'] ?? '', $errors);
    if (!vg_bool($body['consent'] ?? false)) {
        $errors['consent'] = 'Devam etmek için üyelik ve KVKK aydınlatma metnini onaylamanız gerekir.';
    }
    if ($errors) {
        vg_validation_failed($errors);
    }
    /* IPv6'da /48 blogu: tek bir musteri blogundan cok sayida adresle e-posta yoklamasi yapilamasin. */
    $retry = vg_rl_hit('register_ip', vg_rl_ip_key(48), 10, 3600);
    if ($retry > 0) {
        vg_too_many($retry);
    }
    $now = vg_now();
    $user = [
        'id' => vg_new_user_id(),
        'email' => $email,
        'name' => $name,
        'company' => $company,
        'phone' => $phone,
        'pass' => vg_hash_password((string)$password),
        'epoch' => 1,
        'consent_at' => $now,
        'consent_ver' => VG_CONSENT_VERSION,
        'created_at' => $now,
        'updated_at' => $now,
        'last_login_at' => $now,
    ];
    if (!$store->insertUser($user)) {
        /* Ayni adres icin tekrarlanan "kayitli" yanitlari sinirlanir (hesap varligi yoklamasini yavaslatir). */
        $retry = vg_rl_hit('register_email', $email, 3, 3600);
        if ($retry > 0) {
            vg_too_many($retry);
        }
        vg_fail(409, 'email_taken', 'Bu e-posta adresiyle kayıtlı bir hesap var. Giriş yapabilir ya da şifrenizi sıfırlayabilirsiniz.', ['email' => 'Bu e-posta adresiyle kayıtlı bir hesap var.']);
    }
    vg_session_login($user, vg_bool($body['remember'] ?? false));
    return ['ok' => true, 'user' => vg_public_user($user), 'csrf' => vg_csrf_token(), '_status' => 201];
}

function vg_h_login(VgStore $store, array $body): array
{
    $email = vg_normalize_email($body['email'] ?? '');
    $password = $body['password'] ?? '';
    if (!is_string($password)) {
        $password = '';
    }
    $errors = [];
    if ($email === '') {
        $errors['email'] = 'Geçerli bir e-posta adresi girin.';
    }
    if ($password === '') {
        $errors['password'] = 'Şifrenizi girin.';
    }
    if ($errors) {
        vg_validation_failed($errors);
    }
    /*
     * Kilitler: (1) e-posta + istemci (IP, IPv6'da /64) cifti: 5. hatadan itibaren kademeli (30 sn ... 15 dk);
     * baskasinin adresini bilen biri, sahibini kendi baglantisindan kilitleyemez. (2) e-posta basina dagitik
     * denemelere karsi yuksek esik: 15 dk icinde 50 hata -> 15 dk. Bu kilit, hesap sahibinin daha once basariyla
     * giris yaptigi tarayicilara (bilinen cihaz cerezi VGDEV) uygulanmaz; boylece baskalari dagitik hatali
     * denemelerle sahibini disarida birakamaz. Dogru sifre tek basina muafiyet saglamaz. (3) istemci basina
     * (IPv6'da /56 blogu): 15 dk icinde 30 hata -> 15 dk.
     */
    $ip = vg_rl_ip_key();
    $ipWide = vg_rl_ip_key(56);
    $pair = $email . '|' . $ip;
    $user = $store->findUserByEmail($email);
    $knownDevice = $user !== null && vg_kdev_has($user);
    $remaining = max(
        vg_fail_lock_remaining('login_email_ip', $pair),
        $knownDevice ? 0 : vg_fail_lock_remaining('login_email', $email),
        vg_fail_lock_remaining('login_ip', $ipWide)
    );
    if ($remaining > 0) {
        vg_too_many($remaining, 'Çok fazla hatalı giriş denemesi yapıldı. Güvenliğiniz için ' . vg_human_wait($remaining) . ' sonra tekrar deneyin ya da şifrenizi sıfırlayın.');
    }
    /* Hesap yoksa da ayni maliyette dogrulama yapilir (hesap varligi zamanlamadan anlasilmasin). */
    $valid = password_verify($password, $user !== null ? $user['pass'] : vg_dummy_hash()) && $user !== null;
    if (!$valid) {
        vg_fail_record('login_email_ip', $pair, 5, true);
        vg_fail_record('login_email', $email, 50, false);
        vg_fail_record('login_ip', $ipWide, 30, false);
        vg_failure_delay();
        vg_fail(401, 'invalid_credentials', 'E-posta adresi veya şifre hatalı.');
    }
    vg_rl_clear('login_email_ip', $pair);
    vg_rl_clear('login_email', $email);
    $now = vg_now();
    $fields = ['last_login_at' => $now];
    if (password_needs_rehash($user['pass'], PASSWORD_DEFAULT, VG_PW_OPTIONS)) {
        $fields['pass'] = vg_hash_password($password);
    }
    $store->updateUser($user['id'], $fields);
    $user['last_login_at'] = $now;
    vg_session_login($user, vg_bool($body['remember'] ?? false));
    return ['ok' => true, 'user' => vg_public_user($user), 'csrf' => vg_csrf_token()];
}

function vg_h_logout(VgStore $store, array $body): array
{
    vg_session_destroy();
    return ['ok' => true];
}

function vg_h_update_profile(VgStore $store, array $body): array
{
    $user = vg_require_user($store);
    $errors = [];
    $fields = [];
    if (array_key_exists('name', $body)) {
        $fields['name'] = vg_validate_name($body['name'], $errors);
    }
    if (array_key_exists('company', $body)) {
        $fields['company'] = vg_validate_company($body['company'], $errors);
    }
    if (array_key_exists('phone', $body)) {
        $fields['phone'] = vg_validate_phone($body['phone'], $errors);
    }
    $emailChange = false;
    if (array_key_exists('email', $body)) {
        $email = vg_validate_email_field($body['email'], $errors);
        if ($email !== '' && $email !== $user['email']) {
            $emailChange = true;
            $fields['email'] = $email;
        }
    }
    if ($errors) {
        vg_validation_failed($errors);
    }
    $now = vg_now();
    if ($emailChange) {
        /* E-posta degisikligi hesabin kimligini degistirir: mevcut sifre istenir. */
        vg_verify_user_password($store, $user, $body['password'] ?? '', 'password');
        /* "Bu adres baska hesapta kayitli" yaniti ile adres taramasini sinirla (hesap ve istemci basina). */
        $retry = max(vg_rl_hit('email_change_user', $user['id'], 5, 3600), vg_rl_hit('email_change_ip', vg_rl_ip_key(), 10, 3600));
        if ($retry > 0) {
            vg_too_many($retry);
        }
        /* Diger cihazlardaki oturumlar kapatilir (oturum surumu artar; bu oturum yenilenir). */
        $fields['epoch'] = (int)$user['epoch'] + 1;
    }
    if (!$fields) {
        return ['ok' => true, 'user' => vg_public_user($user)];
    }
    $fields['updated_at'] = $now;
    if (!$store->updateUser($user['id'], $fields)) {
        vg_fail(409, 'email_taken', 'Bu e-posta adresi başka bir hesapta kayıtlı.', ['email' => 'Bu e-posta adresi başka bir hesapta kayıtlı.']);
    }
    $out = ['ok' => true];
    if ($emailChange) {
        /* Eski adrese gonderilmis sifre sifirlama baglantilari gecersiz olur; eski adrese bildirim gider. */
        $store->deleteResetTokens($user['id']);
        vg_rl_clear('login_email', $user['email']);
        vg_session_refresh((int)$fields['epoch']);
        vg_kdev_remember(['id' => $user['id'], 'epoch' => (int)$fields['epoch'], '_old_epoch' => (int)$user['epoch']]);
        $newEmail = $fields['email'];
        vg_after_response(function () use ($user, $newEmail, $now) {
            vg_mail_email_changed($user, $newEmail, $now);
        });
        $out['csrf'] = vg_csrf_token();
    }
    $fresh = $store->findUserById($user['id']);
    $out['user'] = vg_public_user($fresh ?: array_merge($user, $fields));
    return $out;
}

function vg_h_change_password(VgStore $store, array $body): array
{
    $user = vg_require_user($store);
    $new = $body['password'] ?? '';
    $problem = vg_password_problem($new);
    if ($problem !== '') {
        vg_validation_failed(['password' => $problem]);
    }
    vg_verify_user_password($store, $user, $body['current'] ?? '', 'current');
    if (password_verify((string)$new, $user['pass'])) {
        vg_validation_failed(['password' => 'Yeni şifre mevcut şifrenizle aynı olamaz.']);
    }
    $now = vg_now();
    $epoch = (int)$user['epoch'] + 1;
    $store->updateUser($user['id'], ['pass' => vg_hash_password((string)$new), 'epoch' => $epoch, 'updated_at' => $now]);
    $store->deleteResetTokens($user['id']);
    vg_session_refresh($epoch);
    vg_kdev_remember(['id' => $user['id'], 'epoch' => $epoch, '_old_epoch' => (int)$user['epoch']]);
    vg_after_response(function () use ($user, $now) {
        vg_mail_password_changed($user, $now);
    });
    return ['ok' => true, 'csrf' => vg_csrf_token(), 'message' => 'Şifreniz güncellendi. Diğer cihazlardaki oturumlarınız kapatıldı.'];
}

function vg_h_delete_account(VgStore $store, array $body): array
{
    $user = vg_require_user($store);
    if (!vg_bool($body['confirm'] ?? false)) {
        vg_validation_failed(['confirm' => 'Silme işlemini onaylamak için kutuyu işaretleyin.']);
    }
    vg_verify_user_password($store, $user, $body['password'] ?? '', 'password');
    $store->deleteUser($user['id']);
    vg_rl_clear('login_email', $user['email']);
    vg_rl_clear('login_email_ip', $user['email'] . '|' . vg_rl_ip_key());
    vg_session_destroy();
    vg_kdev_forget($user);
    return ['ok' => true, 'message' => 'Hesabınız ve tüm kayıtlarınız kalıcı olarak silindi.'];
}

const VG_FORGOT_MESSAGE = 'Talebiniz alındı. Güvenliğiniz için hesap bilgisi ve e-posta teslim durumu bu ekranda gösterilmez. Sıfırlama bağlantısı geldiğinde 1 saat içinde kullanın. E-posta gelmezse spam klasörünü kontrol edin veya info@voltguard.com.tr adresinden destek alın.';
const VG_FORGOT_PREVIEW_MESSAGE = 'Talebiniz alındı. Bu önizlemede e-postalar gerçek adreslere gönderilmez. Şifrenizi e-postayla sıfırlamak için voltguard.com.tr üzerindeki canlı hesap sayfasını kullanın.';

function vg_h_forgot_password(VgStore $store, array $body): array
{
    $start = microtime(true);
    $email = vg_normalize_email($body['email'] ?? '');
    if ($email === '') {
        vg_validation_failed(['email' => 'Geçerli bir e-posta adresi girin.']);
    }
    /* Global capability is checked before lookup; never disclose per-account send failures. */
    if (!vg_mail_can_send()) {
        vg_fail(503, 'mail_unavailable', 'Şifre sıfırlama e-postası şu anda gönderilemiyor. Lütfen daha sonra tekrar deneyin veya info@voltguard.com.tr adresinden destek alın.');
    }
    $retry = vg_rl_hit('forgot_ip', vg_rl_ip_key(), 5, 900);
    if ($retry > 0) {
        vg_too_many($retry);
    }
    /* E-posta basina sinir sessizce uygulanir: yanit her durumda ayni (hesap varligi anlasilmasin). */
    $allowedForEmail = vg_rl_hit('forgot_email', $email, 3, 3600) === 0;
    $user = $allowedForEmail ? $store->findUserByEmail($email) : null;
    if ($user !== null) {
        $token = vg_b64url(random_bytes(32));
        $store->putResetToken(hash('sha256', $token), $user['id'], vg_now() + VG_RESET_TTL);
        $job = function () use ($user, $token) {
            vg_mail_reset_link($user, $token);
        };
        if (vg_can_finish_early()) {
            vg_after_response($job);
        } else {
            $job();
        }
    }
    /* Her iki yolda da benzer yanit suresi (e-posta yanittan sonra gonderilemiyorsa daha uzun taban sure). */
    $floor = vg_can_finish_early() ? 0.35 : 1.2;
    $elapsed = microtime(true) - $start;
    $target = $floor + random_int(0, 150) / 1000;
    if ($elapsed < $target) {
        usleep((int)(($target - $elapsed) * 1000000));
    }
    return ['ok' => true, 'message' => getenv('VG_MAIL_OUTBOX') === '1' ? VG_FORGOT_PREVIEW_MESSAGE : VG_FORGOT_MESSAGE];
}

function vg_h_reset_password(VgStore $store, array $body): array
{
    $token = $body['token'] ?? '';
    $password = $body['password'] ?? '';
    $retry = vg_rl_hit('reset_ip', vg_rl_ip_key(), 10, 900);
    if ($retry > 0) {
        vg_too_many($retry);
    }
    $invalid = 'Bağlantı geçersiz ya da süresi dolmuş. Lütfen yeni bir şifre sıfırlama bağlantısı isteyin.';
    if (!is_string($token) || preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
        vg_fail(400, 'invalid_token', $invalid);
    }
    /* Sifre kurali jeton harcanmadan once denetlenir (kullanici formu duzeltip tekrar gonderebilsin). */
    $problem = vg_password_problem($password);
    if ($problem !== '') {
        vg_validation_failed(['password' => $problem]);
    }
    $rec = $store->takeResetToken(hash('sha256', $token));
    if ($rec === null || $rec['expires'] < vg_now()) {
        vg_failure_delay();
        vg_fail(400, 'invalid_token', $invalid);
    }
    $user = $store->findUserById($rec['uid']);
    if ($user === null) {
        vg_fail(400, 'invalid_token', $invalid);
    }
    $now = vg_now();
    $store->updateUser($user['id'], ['pass' => vg_hash_password((string)$password), 'epoch' => (int)$user['epoch'] + 1, 'updated_at' => $now]);
    $store->deleteResetTokens($user['id']);
    vg_rl_clear('login_email', $user['email']);
    vg_rl_clear('login_email_ip', $user['email'] . '|' . vg_rl_ip_key());
    vg_rl_clear('pw_user', $user['id']);
    /* Bu tarayicida baska bir hesap acik olsa bile kapatilir; yeni sifreyle giris yapilir. */
    vg_session_drop_user();
    vg_after_response(function () use ($user, $now) {
        vg_mail_password_changed($user, $now);
    });
    return ['ok' => true, 'csrf' => vg_csrf_token(), 'message' => 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.'];
}

function vg_collection_param($v): string
{
    return is_string($v) && in_array($v, VG_COLLECTIONS, true) ? $v : '';
}

function vg_collection_out(array $state): array
{
    return [
        'items' => $state['items'],
        'rev' => (int)$state['rev'],
        'updatedAt' => $state['updatedAt'] > 0 ? vg_iso((int)$state['updatedAt']) : null,
    ];
}

function vg_h_data_get(VgStore $store, array $body): array
{
    $user = vg_require_user($store);
    session_write_close();
    $param = isset($_GET['collection']) && is_string($_GET['collection']) ? $_GET['collection'] : 'all';
    $names = $param === 'all' ? VG_COLLECTIONS : array_values(array_filter(array_map('trim', explode(',', $param)), function ($c) {
        return in_array($c, VG_COLLECTIONS, true);
    }));
    if (!$names) {
        vg_fail(400, 'invalid_collection', 'Geçersiz veri türü.');
    }
    $out = [];
    foreach (array_unique($names) as $c) {
        $out[$c] = vg_collection_out($store->getCollection($user['id'], $c));
    }
    return ['ok' => true, 'collections' => $out, 'serverTime' => vg_iso(vg_now())];
}

/**
 * data_put: { collection, ops: [{op:"upsert", item:{...}} | {op:"delete", id:"..."}] }
 *        ya da { collection, items: [...], base_rev?: n } (tam liste; base_rev farkliysa 409).
 * Kayitlar sunucuda dogrulanir, sunucu zamani (serverAt) eklenir, koleksiyon sinirlari uygulanir.
 */
function vg_h_data_put(VgStore $store, array $body): array
{
    $user = vg_require_user($store);
    session_write_close();
    $coll = vg_collection_param($body['collection'] ?? null);
    if ($coll === '') {
        vg_fail(400, 'invalid_collection', 'Geçersiz veri türü.');
    }
    $limits = VG_COLL_LIMITS[$coll];
    $now = vg_now();
    $hasOps = isset($body['ops']);
    $hasItems = isset($body['items']);
    if ($hasOps === $hasItems) {
        vg_fail(400, 'invalid_request', 'Geçersiz istek.');
    }

    if ($hasOps) {
        if (!is_array($body['ops']) || count($body['ops']) > VG_MAX_OPS) {
            vg_fail(413, 'too_many_ops', 'Tek seferde çok fazla değişiklik gönderildi.');
        }
        $ops = [];
        foreach (array_values($body['ops']) as $i => $op) {
            $kind = is_array($op) ? ($op['op'] ?? '') : '';
            if ($kind === 'delete') {
                $id = is_string($op['id'] ?? null) ? $op['id'] : '';
                if ($id === '' || strlen($id) > 100) {
                    vg_fail(422, 'invalid_item', 'Silinecek kayıt geçersiz.', ['index' => (string)$i]);
                }
                $ops[] = ['delete', $id];
            } elseif ($kind === 'upsert') {
                $why = '';
                $item = vg_clean_item($coll, $op['item'] ?? null, $now, $why);
                if ($item === null) {
                    vg_fail(422, 'invalid_item', $why, ['index' => (string)$i]);
                }
                $ops[] = ['upsert', $item];
            } else {
                vg_fail(400, 'invalid_request', 'Geçersiz işlem türü.');
            }
        }
        $apply = function (array $state) use ($ops) {
            $items = $state['items'];
            foreach ($ops as $op) {
                if ($op[0] === 'delete') {
                    $items = array_values(array_filter($items, function ($it) use ($op) {
                        return !is_array($it) || ($it['id'] ?? null) !== $op[1];
                    }));
                    continue;
                }
                $item = $op[1];
                $found = false;
                foreach ($items as $k => $it) {
                    if (is_array($it) && ($it['id'] ?? null) === $item['id']) {
                        $items[$k] = $item;
                        $found = true;
                        break;
                    }
                }
                if (!$found) {
                    array_unshift($items, $item);
                }
            }
            return $items;
        };
    } else {
        if (!is_array($body['items'])) {
            vg_fail(400, 'invalid_request', 'Geçersiz istek.');
        }
        $clean = [];
        $seen = [];
        foreach (array_values($body['items']) as $i => $raw) {
            $why = '';
            $item = vg_clean_item($coll, $raw, $now, $why);
            if ($item === null) {
                vg_fail(422, 'invalid_item', $why, ['index' => (string)$i]);
            }
            if (isset($seen[$item['id']])) {
                continue;
            }
            $seen[$item['id']] = true;
            $clean[] = $item;
        }
        $baseRev = isset($body['base_rev']) && is_int($body['base_rev']) ? $body['base_rev'] : null;
        $apply = function (array $state) use ($clean, $baseRev) {
            if ($baseRev !== null && $baseRev !== (int)$state['rev']) {
                throw new VgHttpError(409, 'conflict', 'Veriler başka bir cihazda değişti. Güncel liste yüklendi.', [], [], ['current' => vg_collection_out($state)]);
            }
            return $clean;
        };
    }

    $finalize = function (array $state) use ($apply, $coll, $limits) {
        $items = $apply($state);
        if ($coll === 'history') {
            /* Gecmis her zaman en yeni kayit basta olacak sekilde siralanir; sinir asilirsa en eskiler duser. */
            usort($items, function ($a, $b) {
                return strcmp((string)($b['savedAt'] ?? ''), (string)($a['savedAt'] ?? ''));
            });
        }
        if (count($items) > $limits['max']) {
            if ($coll === 'history') {
                $items = array_slice($items, 0, $limits['max']);
            } else {
                throw new VgHttpError(422, 'limit', 'Bu listede en fazla ' . $limits['max'] . ' kayıt saklanabilir. Yer açmak için eski kayıtları silin.');
            }
        }
        while (strlen(vg_json_encode($items)) > $limits['bytes']) {
            if ($coll === 'history' && count($items) > 1) {
                array_splice($items, -max(1, (int)ceil(count($items) / 20)));
                continue;
            }
            throw new VgHttpError(413, 'too_large', 'Bu liste depolama sınırına ulaştı. Yer açmak için eski kayıtları silin.');
        }
        return $items;
    };

    $state = $store->mutateCollection($user['id'], $coll, $finalize);
    return ['ok' => true, 'collection' => $coll] + vg_collection_out($state);
}

function vg_h_export(VgStore $store, array $body): array
{
    $user = vg_require_user($store);
    session_write_close();
    $collections = [];
    foreach (VG_COLLECTIONS as $c) {
        $collections[$c] = $store->getCollection($user['id'], $c)['items'];
    }
    $doc = [
        'format' => 'voltguard-account-export/1',
        'exportedAt' => vg_iso(vg_now()),
        'notice' => 'VoltGuard Tools hesabınızda saklanan tüm kişisel veriler. Şifreniz geri döndürülemez biçimde (hash) saklandığı için dosyada yer almaz.',
        'user' => vg_public_user($user) + [
            'consentAt' => (int)$user['consent_at'] > 0 ? vg_iso((int)$user['consent_at']) : null,
            'consentVersion' => $user['consent_ver'],
            'updatedAt' => vg_iso((int)$user['updated_at']),
        ],
    ] + $collections;
    $name = 'voltguard-hesap-verilerim-' . gmdate('Y-m-d') . '.json';
    return ['_raw' => vg_json_encode($doc, true), '_headers' => ['Content-Disposition: attachment; filename="' . $name . '"']];
}

/* ================================================================== yonlendirici */

function vg_routes(): array
{
    return [
        'me' => ['GET', 'vg_h_me'],
        'data_get' => ['GET', 'vg_h_data_get'],
        'export' => ['GET', 'vg_h_export'],
        'register' => ['POST', 'vg_h_register'],
        'login' => ['POST', 'vg_h_login'],
        'logout' => ['POST', 'vg_h_logout'],
        'update_profile' => ['POST', 'vg_h_update_profile'],
        'change_password' => ['POST', 'vg_h_change_password'],
        'delete_account' => ['POST', 'vg_h_delete_account'],
        'forgot_password' => ['POST', 'vg_h_forgot_password'],
        'reset_password' => ['POST', 'vg_h_reset_password'],
        'data_put' => ['POST', 'vg_h_data_put'],
    ];
}

function vg_run(): void
{
    ob_start();
    try {
        $routes = vg_routes();
        $action = vg_action();
        if ($action === '' || !isset($routes[$action])) {
            vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
        }
        list($method, $handler) = $routes[$action];
        $reqMethod = vg_method();
        if ($reqMethod === 'HEAD' && $method === 'GET') {
            $reqMethod = 'GET';
        }
        if ($reqMethod !== $method) {
            vg_fail(405, 'method_not_allowed', 'Bu işlem için istek yöntemi desteklenmiyor.', [], ['Allow: ' . $method]);
        }
        vg_check_fetch_site();
        $body = [];
        if ($method === 'POST') {
            vg_require_same_origin();
            $body = vg_json_body($action === 'data_put' ? VG_MAX_BODY_DATA : VG_MAX_BODY);
        }
        /* Oturum cerezi olmadan gelen POST gecerli bir CSRF jetonu tasiyamaz: oturum dosyasi acmadan reddet. */
        if ($method === 'POST' && (!isset($_COOKIE[VG_SESSION_NAME]) || (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '') === '')) {
            vg_fail(403, 'csrf', 'Güvenlik doğrulaması başarısız oldu. Sayfayı yenileyip tekrar deneyin.');
        }
        $store = vg_store();
        vg_session_start();
        if ($method === 'POST') {
            vg_require_csrf();
        }
        $result = $handler($store, $body);
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        if (isset($result['_raw'])) {
            vg_send_raw(200, (string)$result['_raw'], isset($result['_headers']) ? (array)$result['_headers'] : []);
        } else {
            $status = isset($result['_status']) ? (int)$result['_status'] : 200;
            unset($result['_status']);
            vg_send($status, $result);
        }
        vg_schedule_gc();
    } catch (VgHttpError $e) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        $payload = ['ok' => false, 'error' => $e->errCode, 'message' => $e->getMessage()];
        if ($e->fields) {
            $payload['fields'] = $e->fields;
        }
        vg_send($e->status, $payload + $e->extra, $e->headers);
    } catch (Throwable $e) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        /* Gunluge yalnizca hata turu ve konumu yazilir (kisisel veri yok). */
        error_log('VoltGuard api: ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
        vg_send(500, ['ok' => false, 'error' => 'server_error', 'message' => 'Beklenmeyen bir hata oluştu. Lütfen biraz sonra tekrar deneyin.']);
    }
    vg_finish_and_run_jobs();
}
