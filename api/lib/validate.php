<?php
/*
 * VoltGuard hesap API - girdi dogrulama ve kayit (koleksiyon) semalari.
 * Hicbir alan oldugu gibi saklanmaz: her deger turu, uzunlugu ve bicimi denetlenip kirpilir.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

/* Koleksiyon basina en fazla kayit ve JSON boyutu. history doldugunda en eski kayitlar dusurulur. */
const VG_COLL_LIMITS = [
    'favorites' => ['max' => 200, 'bytes' => 131072],
    'history' => ['max' => 500, 'bytes' => 1048576],
    'projects' => ['max' => 200, 'bytes' => 262144],
    'documents' => ['max' => 500, 'bytes' => 524288],
];
const VG_MAX_OPS = 500;

function vg_strlen(string $s): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($s, 'UTF-8');
    }
    return (int)preg_match_all('/./us', $s);
}

function vg_substr(string $s, int $len): string
{
    if (vg_strlen($s) <= $len) {
        return $s;
    }
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $len, 'UTF-8');
    }
    preg_match('/^.{0,' . $len . '}/us', $s, $m);
    return $m[0] ?? '';
}

function vg_lower(string $s): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

/**
 * Metin alani: string/sayi kabul edilir, kontrol karakterleri temizlenir, bosluklar sadelestirilir, kirpilir.
 * $multiline: satir sonlari korunur (not alanlari).
 */
function vg_text($v, int $max, bool $multiline = false): string
{
    if (is_int($v) || is_float($v)) {
        $v = (string)$v;
    }
    if (!is_string($v)) {
        return '';
    }
    if (preg_match('//u', $v) !== 1) {
        return '';
    }
    $v = str_replace(["\r\n", "\r"], "\n", $v);
    if ($multiline) {
        $v = (string)preg_replace('/[\x00-\x08\x0B-\x1F\x7F]/u', '', $v);
        $v = (string)preg_replace("/\n{3,}/", "\n\n", $v);
    } else {
        $v = (string)preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v);
        $v = (string)preg_replace('/\s{2,}/u', ' ', $v);
    }
    return vg_substr(trim($v), $max);
}

/** E-posta normalizasyonu: bosluklar atilir, kucuk harfe cevrilir. Gecersizse ''. */
function vg_normalize_email($v): string
{
    if (!is_string($v)) {
        return '';
    }
    $e = strtolower(trim($v));
    if ($e === '' || strlen($e) > 254 || preg_match('/\s/', $e) === 1) {
        return '';
    }
    if (filter_var($e, FILTER_VALIDATE_EMAIL) === false) {
        return '';
    }
    return $e;
}

function vg_validate_name($v, array &$errors): string
{
    $name = vg_text($v, 200);
    if (vg_strlen($name) < 2) {
        $errors['name'] = 'Ad soyad en az 2 karakter olmalı.';
    } elseif (vg_strlen($name) > 80) {
        $errors['name'] = 'Ad soyad en fazla 80 karakter olabilir.';
    } elseif (preg_match('/\p{L}/u', $name) !== 1) {
        $errors['name'] = 'Lütfen geçerli bir ad soyad girin.';
    }
    return $name;
}

function vg_validate_email_field($v, array &$errors): string
{
    $email = vg_normalize_email($v);
    if ($email === '') {
        $errors['email'] = 'Geçerli bir e-posta adresi girin.';
    }
    return $email;
}

function vg_validate_company($v, array &$errors): string
{
    $c = vg_text($v, 200);
    if (vg_strlen($c) > 120) {
        $errors['company'] = 'Firma adı en fazla 120 karakter olabilir.';
    }
    return $c;
}

function vg_validate_phone($v, array &$errors): string
{
    $p = vg_text($v, 64);
    if ($p === '') {
        return '';
    }
    $digits = (string)preg_replace('/\D+/', '', $p);
    if (strlen($p) > 32 || preg_match('/^\+?[0-9 ()\-.]+$/', $p) !== 1 || strlen($digits) < 7 || strlen($digits) > 15) {
        $errors['phone'] = 'Geçerli bir telefon numarası girin (örn. 0 5xx xxx xx xx).';
    }
    return $p;
}

const VG_COMMON_PASSWORDS = [
    '12345678', '123456789', '1234567890', '12345678a', 'a12345678', 'password1', 'password123', 'qwerty123',
    'qwerty12', 'abc12345', 'abcd1234', '1q2w3e4r', '1qaz2wsx', 'asdf1234', 'zxcv1234', 'parola123', 'sifre123',
    'şifre123', 'parola12', 'sifre1234', 'admin123', 'test1234', 'deneme123', 'galatasaray1', 'fenerbahce1',
    'besiktas1', 'turkiye1', 'istanbul1', 'izmir123', 'ankara123', 'voltguard1', 'voltguard123', 'iloveyou1',
    'welcome1', 'letmein1', 'aa123456', 'q1w2e3r4', 'p4ssw0rd', 'passw0rd', 'elektrik1', 'muhendis1',
];

/**
 * Sifre kurali: 8-64 karakter, en az bir harf ve bir rakam, kontrol karakteri yok, cok yaygin sifre degil.
 * bcrypt 72 bayttan sonrasini yok saydigi icin bayt siniri da uygulanir.
 */
function vg_password_problem($pw): string
{
    if (!is_string($pw) || $pw === '') {
        return 'Şifre girin.';
    }
    if (preg_match('//u', $pw) !== 1 || preg_match('/[\x00-\x1F\x7F]/', $pw) === 1) {
        return 'Şifre geçersiz karakter içeriyor.';
    }
    $len = vg_strlen($pw);
    if ($len < 8) {
        return 'Şifre en az 8 karakter olmalı.';
    }
    if ($len > 64 || strlen($pw) > 72) {
        return 'Şifre en fazla 64 karakter olabilir.';
    }
    if (preg_match('/\p{L}/u', $pw) !== 1 || preg_match('/\p{Nd}/u', $pw) !== 1) {
        return 'Şifre en az bir harf ve bir rakam içermeli.';
    }
    if (in_array(vg_lower($pw), VG_COMMON_PASSWORDS, true)) {
        return 'Bu şifre çok yaygın ve kolay tahmin edilir. Lütfen başka bir şifre seçin.';
    }
    return '';
}

function vg_bool($v): bool
{
    return $v === true || $v === 1 || $v === '1' || $v === 'true' || $v === 'on';
}

/** ISO 8601 tarih; gecersiz veya gelecekteyse (1 gunden fazla) sunucu zamani kullanilir. */
function vg_iso_date($v, int $now): string
{
    if (is_string($v) && $v !== '' && strlen($v) <= 40) {
        $ts = strtotime($v);
        if ($ts !== false && $ts >= 1577836800 && $ts <= $now + 86400) {
            return vg_iso($ts);
        }
    }
    return vg_iso($now);
}

/** http(s) mutlak adres ya da kok-mutlak yol (/hesaplama/...). Diger semalar (javascript:, data:) reddedilir. */
function vg_safe_url($v, bool $allowRelative): string
{
    $u = vg_text($v, 500);
    if ($u === '') {
        return '';
    }
    /* Bosluk, tirnak ve acili parantez iceren adresler reddedilir (Turkce karakterli adreslere izin verilir). */
    if ($allowRelative && preg_match('#^/(?![/\\\\])[^\s<>"\'`]*$#u', $u) === 1) {
        return $u;
    }
    if (preg_match('#^https?://[^\s/?\#<>"\'`\\\\@]+([/?\#][^\s<>"\'`]*)?$#iu', $u) !== 1) {
        return '';
    }
    return $u;
}

function vg_valid_item_id($v, string $prefix): string
{
    if (!is_string($v)) {
        return '';
    }
    return preg_match('/^' . $prefix . '_[a-z0-9]{4,40}$/', $v) === 1 ? $v : '';
}

function vg_new_item_id(string $prefix): string
{
    return $prefix . '_' . base_convert((string)time(), 10, 36) . bin2hex(random_bytes(4));
}

function vg_slug($v): string
{
    return is_string($v) && preg_match('/^[a-z0-9][a-z0-9-]{0,99}$/', $v) === 1 ? $v : '';
}

/**
 * Bir kaydi koleksiyon semasina gore temizler. Gecersizse null ve $why'a nedeni yazar.
 * Sunucu zamani (serverAt) her yazimda eklenir.
 */
function vg_clean_item(string $coll, $item, int $now, string &$why): ?array
{
    $why = '';
    if (!is_array($item)) {
        $why = 'Kayıt biçimi geçersiz.';
        return null;
    }
    $serverAt = vg_iso($now);
    switch ($coll) {
        case 'favorites':
            $slug = vg_slug($item['toolSlug'] ?? ($item['id'] ?? null));
            if ($slug === '') {
                $why = 'Araç kimliği geçersiz.';
                return null;
            }
            return [
                'id' => $slug,
                'toolSlug' => $slug,
                'toolName' => vg_text($item['toolName'] ?? '', 200) ?: $slug,
                'toolUrl' => vg_safe_url($item['toolUrl'] ?? '', true),
                'addedAt' => vg_iso_date($item['addedAt'] ?? null, $now),
                'serverAt' => $serverAt,
            ];

        case 'history':
            $id = vg_valid_item_id($item['id'] ?? null, 'h');
            if ($id === '') {
                $why = 'Kayıt kimliği geçersiz.';
                return null;
            }
            $name = vg_text($item['toolName'] ?? '', 200);
            $slug = vg_slug($item['toolSlug'] ?? null);
            if ($name === '' && $slug === '') {
                $why = 'Hesaplama adı eksik.';
                return null;
            }
            $params = [];
            if (isset($item['params']) && is_array($item['params'])) {
                foreach (array_slice(array_values($item['params']), 0, 60) as $p) {
                    if (is_array($p)) {
                        $params[] = ['label' => vg_text($p['label'] ?? '', 200), 'value' => vg_text($p['value'] ?? '', 400)];
                    }
                }
            }
            $res = isset($item['result']) && is_array($item['result']) ? $item['result'] : [];
            return [
                'id' => $id,
                'toolSlug' => $slug,
                'toolName' => $name !== '' ? $name : $slug,
                'toolUrl' => vg_safe_url($item['toolUrl'] ?? '', true),
                'params' => $params,
                'result' => ['value' => vg_text($res['value'] ?? '', 300), 'note' => vg_text($res['note'] ?? '', 1000, true)],
                'note' => vg_text($item['note'] ?? '', 1000, true),
                'savedAt' => vg_iso_date($item['savedAt'] ?? null, $now),
                'serverAt' => $serverAt,
            ];

        case 'projects':
            $id = vg_valid_item_id($item['id'] ?? null, 'p');
            $name = vg_text($item['name'] ?? '', 200);
            if ($id === '') {
                $why = 'Proje kimliği geçersiz.';
                return null;
            }
            if ($name === '') {
                $why = 'Proje adı gerekli.';
                return null;
            }
            $calcIds = [];
            if (isset($item['calcIds']) && is_array($item['calcIds'])) {
                foreach (array_slice(array_values($item['calcIds']), 0, 500) as $c) {
                    $c = vg_valid_item_id($c, 'h');
                    if ($c !== '' && !in_array($c, $calcIds, true)) {
                        $calcIds[] = $c;
                    }
                }
            }
            return [
                'id' => $id,
                'name' => $name,
                'description' => vg_text($item['description'] ?? '', 600, true),
                'calcIds' => $calcIds,
                'createdAt' => vg_iso_date($item['createdAt'] ?? null, $now),
                'serverAt' => $serverAt,
            ];

        case 'documents':
            $id = vg_valid_item_id($item['id'] ?? null, 'd');
            $name = vg_text($item['name'] ?? '', 200);
            if ($id === '') {
                $why = 'Doküman kimliği geçersiz.';
                return null;
            }
            if ($name === '') {
                $why = 'Doküman adı gerekli.';
                return null;
            }
            $rawUrl = vg_text($item['url'] ?? '', 500);
            $url = vg_safe_url($rawUrl, false);
            if ($rawUrl !== '' && $url === '') {
                $why = 'Geçerli bir http(s) bağlantısı girin.';
                return null;
            }
            return [
                'id' => $id,
                'name' => $name,
                'url' => $url,
                'note' => vg_text($item['note'] ?? '', 1000, true),
                'addedAt' => vg_iso_date($item['addedAt'] ?? null, $now),
                'serverAt' => $serverAt,
            ];
    }
    $why = 'Bilinmeyen koleksiyon.';
    return null;
}
