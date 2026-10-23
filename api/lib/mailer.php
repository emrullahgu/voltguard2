<?php
/*
 * VoltGuard hesap API - e-posta (sifre sifirlama ve guvenlik bildirimleri).
 * Gonderim PHP mail() ile, contact.php ile ayni gonderici basliklariyla yapilir.
 * Yalnizca test icin: VG_MAIL_OUTBOX=1 ortam degiskeni verilirse e-postalar gonderilmez, veri klasorundeki
 * outbox/ altina .eml dosyasi olarak yazilir. Canli sunucuda bu degiskeni TANIMLAMAYIN.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

/** Global transport capability only; it says nothing about an account or delivery. */
function vg_mail_can_send(): bool
{
    return getenv('VG_MAIL_OUTBOX') === '1' || function_exists('mail');
}

function vg_mail_send(string $to, string $subject, string $body, string $kind, ?string $replyTo = null): bool
{
    if (filter_var($to, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $to) === 1) {
        return false;
    }
    if ($replyTo !== null && (filter_var($replyTo, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $replyTo) === 1)) return false;
    $fromAddress = 'noreply@voltguard.com.tr';
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'From: VoltGuard <' . $fromAddress . '>',
        'Reply-To: ' . ($replyTo ?? 'info@voltguard.com.tr'),
    ];
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';

    if (getenv('VG_MAIL_OUTBOX') === '1') {
        $dir = vg_data_dir() . '/outbox';
        if (!vg_ensure_dir($dir)) {
            return false;
        }
        $eml = 'To: ' . $to . "\r\n" . 'Subject: ' . $encodedSubject . "\r\n" . implode("\r\n", $headers) . "\r\n\r\n" . $body;
        $file = $dir . '/' . gmdate('Ymd-His') . '-' . $kind . '-' . bin2hex(random_bytes(4)) . '.eml';
        $ok = @file_put_contents($file, $eml) !== false;
        @chmod($file, 0600);
        return $ok;
    }

    if (!function_exists('mail')) {
        error_log('VoltGuard api: mail transport unavailable (' . $kind . ')');
        return false;
    }
    /* -f: zarf gondericisi (Return-Path) From ile ayni alan adinda olsun; SPF/DMARC hizalamasi icin. */
    $sent = @mail($to, $encodedSubject, $body, implode("\r\n", $headers), '-f' . $fromAddress);
    if (!$sent) {
        /* KVKK: alici adresi loglanmaz. */
        error_log('VoltGuard api: mail() failed (' . $kind . ')');
    }
    return $sent;
}

function vg_greeting(string $name): string
{
    $parts = preg_split('/\s+/u', trim($name));
    $first = is_array($parts) && isset($parts[0]) ? trim((string)$parts[0]) : '';
    /*
     * Ad kullanici tarafindan secilir (e-posta dogrulamasi yok): yalnizca harflerden olusan bir ilk sozcuk kullanilir.
     * URL, e-posta adresi veya isaretler iceren ilk sozcuk resmi postada baglantiya donusmesin diye selamlamaya konmaz.
     */
    if ($first !== '' && preg_match('/^[\p{L}\p{M}][\p{L}\p{M}\'’.-]{0,39}$/u', $first)) {
        return 'Merhaba ' . $first . ',';
    }
    return 'Merhaba,';
}

function vg_local_time(int $ts): string
{
    try {
        $d = new DateTime('@' . $ts);
        $d->setTimezone(new DateTimeZone('Europe/Istanbul'));
        return $d->format('d.m.Y H:i');
    } catch (Throwable $e) {
        return gmdate('d.m.Y H:i', $ts) . ' UTC';
    }
}

function vg_mail_reset_link(array $user, string $token): bool
{
    $link = vg_site_url() . '/hesap/sifre-sifirla.html#t=' . $token;
    $body = vg_greeting($user['name']) . "\n\n"
        . "VoltGuard hesabınız için şifre sıfırlama talebi aldık. Yeni şifrenizi belirlemek için aşağıdaki bağlantıyı açın:\n\n"
        . $link . "\n\n"
        . "Bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir.\n\n"
        . "Bu talebi siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmez ve hesabınız güvende kalır.\n\n"
        . "VoltGuard\n"
        . vg_site_url() . "\n";
    return vg_mail_send($user['email'], 'VoltGuard: şifre sıfırlama bağlantınız', $body, 'reset');
}

function vg_mail_password_changed(array $user, int $when): bool
{
    $body = vg_greeting($user['name']) . "\n\n"
        . 'VoltGuard hesabınızın şifresi ' . vg_local_time($when) . " (Türkiye saati) tarihinde değiştirildi. Güvenliğiniz için diğer cihazlardaki oturumlarınız kapatıldı.\n\n"
        . "Bu değişikliği siz yapmadıysanız aşağıdaki sayfadan hemen yeni bir şifre belirleyin ve bize info@voltguard.com.tr adresinden haber verin:\n\n"
        . vg_site_url() . "/hesap/sifre-sifirla.html\n\n"
        . "VoltGuard\n"
        . vg_site_url() . "\n";
    return vg_mail_send($user['email'], 'VoltGuard: şifreniz değiştirildi', $body, 'pwchanged');
}

/** E-posta adresini bildirimde gostermek icin maskeler: "ah***@g***.com". */
function vg_mask_email(string $email): string
{
    $at = strrpos($email, '@');
    if ($at === false || $at === 0) {
        return '***';
    }
    $local = substr($email, 0, $at);
    $domain = substr($email, $at + 1);
    $dot = strpos($domain, '.');
    $host = $dot === false ? $domain : substr($domain, 0, $dot);
    $rest = $dot === false ? '' : substr($domain, $dot);
    $keep = vg_strlen($local) > 3 ? 2 : 1;
    return vg_substr($local, $keep) . '***@' . vg_substr($host, 1) . '***' . $rest;
}

/** E-posta adresi degisince ESKI adrese guvenlik bildirimi. */
function vg_mail_email_changed(array $user, string $newEmail, int $when): bool
{
    $body = vg_greeting($user['name']) . "\n\n"
        . 'VoltGuard hesabınızın e-posta adresi ' . vg_local_time($when) . ' (Türkiye saati) tarihinde ' . vg_mask_email($newEmail)
        . " olarak değiştirildi. Hesabınızla ilgili e-postalar bundan sonra yeni adrese gönderilecek. Güvenliğiniz için diğer cihazlardaki oturumlarınız kapatıldı ve daha önce istenmiş şifre sıfırlama bağlantıları geçersiz kılındı.\n\n"
        . "Bu değişikliği siz yapmadıysanız hemen info@voltguard.com.tr adresine yazın.\n\n"
        . "VoltGuard\n"
        . vg_site_url() . "\n";
    return vg_mail_send($user['email'], 'VoltGuard: e-posta adresiniz değiştirildi', $body, 'emailchanged');
}
