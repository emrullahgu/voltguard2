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

function vg_mail_send(string $to, string $subject, string $body, string $kind): bool
{
    if (filter_var($to, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $to) === 1) {
        return false;
    }
    $fromAddress = 'noreply@voltguard.com.tr';
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'From: VoltGuard <' . $fromAddress . '>',
        'Reply-To: info@voltguard.com.tr',
        'X-Mailer: PHP/' . phpversion(),
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

    $sent = @mail($to, $encodedSubject, $body, implode("\r\n", $headers));
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
    return $first !== '' ? 'Merhaba ' . $first . ',' : 'Merhaba,';
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
        . "VoltGuard Tools hesabınız için şifre sıfırlama talebi aldık. Yeni şifrenizi belirlemek için aşağıdaki bağlantıyı açın:\n\n"
        . $link . "\n\n"
        . "Bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir.\n\n"
        . "Bu talebi siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmez ve hesabınız güvende kalır.\n\n"
        . "VoltGuard\n"
        . vg_site_url() . "\n";
    return vg_mail_send($user['email'], 'VoltGuard Tools: şifre sıfırlama bağlantınız', $body, 'reset');
}

function vg_mail_password_changed(array $user, int $when): bool
{
    $body = vg_greeting($user['name']) . "\n\n"
        . 'VoltGuard Tools hesabınızın şifresi ' . vg_local_time($when) . " (Türkiye saati) tarihinde değiştirildi. Güvenliğiniz için diğer cihazlardaki oturumlarınız kapatıldı.\n\n"
        . "Bu değişikliği siz yapmadıysanız aşağıdaki sayfadan hemen yeni bir şifre belirleyin ve bize info@voltguard.com.tr adresinden haber verin:\n\n"
        . vg_site_url() . "/hesap/sifre-sifirla.html\n\n"
        . "VoltGuard\n"
        . vg_site_url() . "\n";
    return vg_mail_send($user['email'], 'VoltGuard Tools: şifreniz değiştirildi', $body, 'pwchanged');
}
