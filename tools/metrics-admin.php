<?php
/* Büyüme paneli (hesap/buyume-paneli.html) yöneticileri, doğrulanmış iş sonuçları ve değişiklik kaydı.
 * Yalnızca sunucu terminalinden çalışır; HTTP ile asla. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('VG_API', 1);
require dirname(__DIR__) . '/api/lib/bootstrap.php';
require dirname(__DIR__) . '/api/lib/store.php';
require dirname(__DIR__) . '/api/lib/metrics.php';

// DOCUMENT_ROOT is often absent in CLI. Resolve the same deployment root as the API.
$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__);
$usage = "Usage: php tools/metrics-admin.php grant|revoke <existing-user-id>\n"
    . "       php tools/metrics-admin.php list\n"
    . "       php tools/metrics-admin.php outcome set <YYYY-MM> --source is-takip|yetkili --by <doğrulayan rolü>"
    . " [--qualified <n>] [--won <n>]\n"
    . "       php tools/metrics-admin.php outcome remove <YYYY-MM>\n"
    . "       php tools/metrics-admin.php outcome list\n"
    . "       php tools/metrics-admin.php change add <YYYY-MM-DD> <kısa açıklama>\n"
    . "       php tools/metrics-admin.php change list\n";
$action = $argv[1] ?? '';
$id = $argv[2] ?? '';

/** --anahtar değer çiftleri; bilinmeyen anahtar ya da eksik değer null döndürür. */
function vg_metrics_cli_options(array $args, array $known): ?array
{
    $out = [];
    for ($i = 0; $i < count($args); $i += 2) {
        $key = substr((string)$args[$i], 2);
        if (strpos((string)$args[$i], '--') !== 0 || !in_array($key, $known, true) || !isset($args[$i + 1])) {
            return null;
        }
        $out[$key] = (string)$args[$i + 1];
    }
    return $out;
}

/** Kısa, tek satırlık etiket (kişisel veri değil; rol ya da değişiklik adı). */
function vg_metrics_cli_label(string $value, int $max): ?string
{
    $value = trim($value);
    return preg_match('/^[^\x00-\x1F\x7F<>]{1,' . $max . '}$/uD', $value) === 1 ? $value : null;
}

$valid = in_array($action, ['grant', 'revoke'], true) ? vg_metrics_user_id($id) && count($argv) === 3
    : ($action === 'list' ? count($argv) === 2
    : ($action === 'outcome' ? in_array($id, ['set', 'remove', 'list'], true)
    : ($action === 'change' && in_array($id, ['add', 'list'], true))));
if (!$valid) {
    fwrite(STDERR, $usage);
    exit(2);
}

// A repository checkout may differ from public_html. Never silently select a different account store.
if (!is_string(getenv('VG_DATA_DIR')) || trim((string)getenv('VG_DATA_DIR')) === '') {
    fwrite(STDERR, "Set VG_DATA_DIR to the API's existing private data directory before administration.\n");
    exit(2);
}

if ($action === 'outcome' || $action === 'change') {
    $month = $argv[3] ?? '';
    if ($action === 'outcome' && $id === 'set') {
        $opts = vg_metrics_cli_options(array_slice($argv, 4), ['source', 'by', 'qualified', 'won']);
        $count = function (?string $v): ?int {
            return $v !== null && preg_match('/^(0|[1-9][0-9]{0,5})$/D', $v) === 1 ? (int)$v : null;
        };
        $by = $opts === null ? null : vg_metrics_cli_label($opts['by'] ?? '', 60);
        $ok = $opts !== null && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', $month) === 1 && $by !== null
            && in_array($opts['source'] ?? '', VG_METRICS_OUTCOME_SOURCES, true)
            && (isset($opts['qualified']) || isset($opts['won']))
            && (!isset($opts['qualified']) || $count($opts['qualified']) !== null) && (!isset($opts['won']) || $count($opts['won']) !== null);
        if (!$ok) {
            fwrite(STDERR, "Ay YYYY-MM, --source is-takip|yetkili, --by <rol> ve en az bir sayı (--qualified / --won) gerekir.\n" . $usage);
            exit(2);
        }
        $row = ['qualified' => $count($opts['qualified'] ?? null), 'won' => $count($opts['won'] ?? null),
            'source' => $opts['source'], 'verifiedBy' => $by, 'at' => gmdate('c')];
    } elseif ($action === 'outcome' && $id === 'remove' && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', $month) !== 1) {
        fwrite(STDERR, $usage);
        exit(2);
    } elseif ($action === 'change' && $id === 'add') {
        $label = vg_metrics_cli_label(implode(' ', array_slice($argv, 4)), 120);
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $month) !== 1 || $label === null) {
            fwrite(STDERR, $usage);
            exit(2);
        }
    }
    try {
        $state = vg_metrics_locked(function () use ($action, $id, $month, &$row, &$label) {
            $state = vg_metrics_outcomes();
            if ($action === 'outcome' && $id === 'set') {
                $state['months'][$month] = $row;
            } elseif ($action === 'outcome' && $id === 'remove') {
                unset($state['months'][$month]);
            } elseif ($action === 'change' && $id === 'add') {
                $state['changes'][] = ['date' => $month, 'label' => $label];
            }
            if ($id !== 'list') {
                vg_metrics_save_outcomes($state);
            }
            return $state;
        });
        if ($action === 'outcome') {
            if (!$state['months']) {
                echo "Doğrulanmış iş sonucu kaydı yok.\n";
            }
            foreach ($state['months'] as $m => $r) {
                echo $m . '  nitelikli=' . ($r['qualified'] ?? '-') . '  kazanılan=' . ($r['won'] ?? '-') . '  kaynak=' . $r['source']
                    . '  doğrulayan=' . $r['verifiedBy'] . "\n";
            }
        } else {
            foreach ($state['changes'] as $c) {
                echo $c['date'] . '  ' . $c['label'] . "\n";
            }
        }
    } catch (Throwable $error) {
        fwrite(STDERR, "Metrics administration failed. Check private data configuration and server logs.\n");
        exit(1);
    }
    exit(0);
}

try {
    $store = vg_store();
    if ($action === 'grant' && $store->findUserById($id) === null) {
        fwrite(STDERR, "Account not found. Create a normal membership account first.\n");
        exit(2);
    }
    $admins = vg_metrics_locked(function () use ($action, $id) {
        $ids = vg_metrics_admins();
        if ($action === 'grant' && !in_array($id, $ids, true)) {
            if (count($ids) >= 50) {
                vg_fail(422, 'limit', 'Admin limit reached.');
            }
            $ids[] = $id;
        } elseif ($action === 'revoke') {
            $ids = array_values(array_filter($ids, function (string $known) use ($id) {
                return $known !== $id;
            }));
        }
        if ($action !== 'list') {
            vg_metrics_save_admins($ids);
        }
        return $ids;
    });
    if ($action === 'list') {
        if (!$admins) {
            echo "No growth dashboard admins configured.\n";
        }
        foreach ($admins as $known) {
            echo $known . ($store->findUserById($known) === null ? '  (account deleted; revoke recommended)' : '') . "\n";
        }
    } else {
        echo "Growth dashboard permission updated.\n";
    }
} catch (Throwable $error) {
    fwrite(STDERR, "Metrics administration failed. Check private data configuration and server logs.\n");
    exit(1);
}
