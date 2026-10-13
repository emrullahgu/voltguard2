<?php
/** Run only from the server's private terminal. It never accepts a password argument. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('VG_API', 1);
require dirname(__DIR__) . '/api/lib/bootstrap.php';
require dirname(__DIR__) . '/api/lib/security.php';
require dirname(__DIR__) . '/api/lib/staff.php';

$command = $argv[1] ?? '';
$options = [];
for ($i = 2; $i < count($argv); $i++) {
    $arg = $argv[$i];
    if (!preg_match('/^--(email|name|role|id)(?:=(.*))?$/D', $arg, $match)) { fwrite(STDERR, "Geçersiz seçenek. Şifre komut satırında verilmez.\n"); exit(2); }
    if (isset($match[2])) $options[$match[1]] = $match[2];
    elseif (isset($argv[$i + 1]) && strpos($argv[$i + 1], '--') !== 0) $options[$match[1]] = $argv[++$i];
    else { fwrite(STDERR, "Seçenek değeri eksik.\n"); exit(2); }
}
try {
    if (!is_string(getenv('VG_DATA_DIR')) || trim((string)getenv('VG_DATA_DIR')) === '') {
        fwrite(STDERR, "Önce VG_DATA_DIR değişkenini web kökü dışındaki özel veri dizinine ayarlayın.\n"); exit(2);
    }
    if ($command === 'bootstrap-invite' || $command === 'invite') {
        if ($command === 'bootstrap-invite') $options['role'] = 'admin';
        $result = vg_staff_store(function (array &$state) use ($options, $command) { return vg_staff_make_invite($state, $options, $command === 'bootstrap-invite'); });
        // This local terminal output is the only hand-off. Nothing is emailed or logged.
        fwrite(STDOUT, vg_json_encode(['ok' => true] + $result, true) . "\n");
    } elseif ($command === 'disable') {
        $result = vg_staff_store(function (array &$state) use ($options) {
            $id = $options['id'] ?? '';
            if (!isset($state['users'][$id])) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
            vg_staff_keep_admin($state, $id);
            $state['users'][$id]['status'] = 'disabled'; $state['users'][$id]['epoch']++;
            foreach ($state['invites'] as $hash => $invite) if ($invite['userId'] === $id) unset($state['invites'][$hash]);
            vg_staff_audit($state, 'cli_user_disabled', $id); return ['ok' => true];
        });
        fwrite(STDOUT, vg_json_encode($result) . "\n");
    } elseif ($command === 'list') {
        $result = vg_staff_store(function (array &$state) {
            $items = []; foreach ($state['users'] as $u) $items[] = vg_staff_public_user($u) + ['status' => $u['status'], 'mfaEnrolled' => !empty($u['mfaSecret'])];
            return ['ok' => true, 'items' => $items];
        });
        fwrite(STDOUT, vg_json_encode($result, true) . "\n");
    } else {
        fwrite(STDERR, "Kullanım:\n  php tools/staff-admin.php bootstrap-invite --email <adres> --name <ad>\n  php tools/staff-admin.php invite --email <adres> --name <ad> --role employee|payroll|admin\n  php tools/staff-admin.php list\n  php tools/staff-admin.php disable --id <çalışan-kimliği>\n\nVG_DATA_DIR web kökü dışında olmalı. Şifre çalışan tarafından etkinleştirme sayfasında belirlenir.\n");
        exit(2);
    }
} catch (VgHttpError $e) {
    fwrite(STDERR, vg_json_encode(['ok' => false, 'error' => $e->errCode, 'message' => $e->getMessage()]) . "\n"); exit(1);
} catch (Throwable $e) {
    fwrite(STDERR, "Çalışan depolama işlemi tamamlanamadı. Özel klasör ve sunucu izinlerini kontrol edin.\n"); exit(1);
}
