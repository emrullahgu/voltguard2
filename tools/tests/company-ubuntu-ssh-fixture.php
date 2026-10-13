<?php
/** Private CLI test. Remote wrapper additionally asserts its fixed QA database before every request. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('VG_RUN_ISOLATED_UBUNTU_QA') !== 'vg_bridge_qa_20261013_c6ea4f17') { http_response_code(404); exit(1); }
define('VG_API', 1);
$root = dirname(__DIR__, 2);
foreach (['bootstrap', 'security', 'staff', 'company'] as $part) require $root . '/api/lib/' . $part . '.php';
if (!function_exists('vg_company_ubuntu_store')) require $root . '/api/lib/company-ubuntu.php';
$checks = 0;
function qa_check($actual, $expected, string $message): void {
    global $checks;
    if ($actual !== $expected) throw new RuntimeException($message . ': expected ' . vg_json_encode($expected) . '; actual ' . vg_json_encode($actual));
    $checks++;
}
function qa_error(callable $fn, int $status, string $code, string $message): void {
    try { $fn(); } catch (VgHttpError $e) { qa_check($e->status, $status, $message . ' status'); qa_check($e->errCode, $code, $message . ' code'); return; }
    throw new RuntimeException($message . ': expected rejection did not occur');
}
function qa_login(string $id, string $role): void {
    vg_staff_session_start();
    vg_staff_store(static function (array &$s) use ($id, $role): void {
        $s['users'][$id] = ['id' => $id, 'name' => 'Synthetic SSH QA ' . $role, 'email' => $role . '@ssh-qa.example.test', 'role' => $role, 'status' => 'active', 'mfaSecret' => 'JBSWY3DPEHPK3PXP', 'password' => 'Not used; synthetic test session fixture only', 'epoch' => 1, 'createdAt' => vg_iso(time())];
    });
    $_SESSION['staff'] = ['uid' => $id, 'mfa' => true, 'epoch' => 1, 'created' => time(), 'last' => time()];
}
function qa_query(string $table, string $operation = 'select', array $extra = []): array {
    $input = array_merge(['table' => $table, 'operation' => $operation, 'filters' => [], 'select' => '*', 'returning' => true], $extra);
    return vg_company_store(static function (array &$s, array $actor) use ($input) { return vg_company_query($s, $actor, $input); });
}
function qa_insert(string $table, array $row): array { return qa_query($table, 'insert', ['rows' => [$row], 'single' => 'one'])['data']; }
function qa_rpc(string $name, array $args): array { return vg_company_store(static function (array &$s, array $actor) use ($name, $args) { return ['data' => vg_company_rpc($s, $actor, $name, $args)]; }); }
function qa_filter(string $id): array { return [['op' => 'eq', 'field' => 'id', 'value' => $id]]; }

try {
    $admin = 's' . str_repeat('4', 24); $employee = 's' . str_repeat('5', 24);
    qa_login($employee, 'employee');
    qa_login($admin, 'admin');
    $config = ['version' => 1, 'host' => 'sunucu', 'helper' => '/home/emrullah/voltguard-site-bridge-qa/vg_bridge_qa_20261013_c6ea4f17/company_store_qa.py', 'site' => str_repeat('c', 32), 'timeout' => 25, 'sshExecutable' => 'C:/Windows/System32/OpenSSH/ssh.exe'];
    file_put_contents(vg_company_dir() . '/ubuntu.json', vg_json_encode($config));
    $config = vg_company_ubuntu_config();
    qa_check($config['helper'], '/home/emrullah/voltguard-site-bridge-qa/vg_bridge_qa_20261013_c6ea4f17/company_store_qa.py', 'Fixed QA wrapper path is the only remote target');
    $health = vg_company_ubuntu_call($config, ['op' => 'health', 'actor' => ['id' => $admin, 'role' => 'admin']]);
    qa_check($health['healthy'], true, 'Actual PHP proc_open SSH reaches isolated PostgreSQL');
    $snapshot = vg_company_store(static function (array &$s, array $actor) { return ['data' => ['version' => $s['version'], 'catalog' => vg_company_catalog(), 'actor' => $actor['id']]]; });
    qa_check($snapshot['data']['version'], 1, 'Actual SSH snapshot matches private state contract');
    qa_check($snapshot['data']['actor'], $admin, 'Native approved admin remains the authority');
    $catalogKeys = array_keys($snapshot['data']['catalog']); sort($catalogKeys);
    qa_check($catalogKeys, ['cablePrices', 'historicalInvoice1', 'historicalInvoice2', 'packages'], 'All four catalog sources arrive over actual SSH');
    qa_check($GLOBALS['vg_company_data_source'], 'ubuntu', 'Real data source is Ubuntu');

    $label = 'SSH QA ' . bin2hex(random_bytes(6));
    $product = qa_insert('products', ['name' => $label, 'category' => 'Synthetic QA', 'price' => 10]);
    qa_check($product['name'], $label, 'Real insert returns saved PostgreSQL row');
    qa_check(is_string($product['updated_at']) && $product['updated_at'] !== '', true, 'Saved row carries server canonical timestamp');
    $updated = qa_query('products', 'update', ['rows' => ['price' => 12], 'filters' => qa_filter($product['id']), 'single' => 'one'])['data'];
    qa_check((float)$updated['price'], 12.0, 'Actual commit updates exact selected product');
    $reread = qa_query('products', 'select', ['filters' => qa_filter($product['id']), 'single' => 'one'])['data'];
    qa_check((float)$reread['price'], 12.0, 'Next real SSH snapshot confirms persistence');
    qa_check($reread['updated_at'], $updated['updated_at'], 'Returned canonical timestamp agrees with next snapshot');

    $blue = qa_insert('bordro_employees', ['name' => $label . ' Blue', 'user_id' => $employee, 'agreed_salary' => 50000, 'official_salary' => 40000]);
    $white = qa_insert('beyaz_yaka_employees', ['name' => $label . ' White', 'user_id' => $employee, 'monthly_salary' => 50000, 'gross_salary' => 60000, 'start_date' => '2026-01-01']);
    $args = ['p_employee_id' => $white['id'], 'p_month' => 9, 'p_year' => 2026, 'p_payload' => ['base_salary' => 60000, 'sgk_employee' => 8000, 'income_tax' => 2000, 'logs' => []], 'p_expected_updated_at' => null];
    $savedPayroll = qa_rpc('app_beyaz_yaka_payroll_save', $args)['data'];
    qa_check((float)$savedPayroll['net_payment'], 50000.0, 'Actual payroll RPC persists entered accounting arithmetic');
    qa_check($savedPayroll['employee_id'], $white['id'], 'Canonical payroll row preserves parent identity');
    $args['p_expected_updated_at'] = $savedPayroll['updated_at']; $args['p_payload']['income_tax'] = 3000;
    $secondPayroll = qa_rpc('app_beyaz_yaka_payroll_save', $args)['data'];
    qa_check((float)$secondPayroll['net_payment'], 49000.0, 'Next CAS uses timestamp returned from PostgreSQL');
    qa_check($secondPayroll['updated_at'] !== $savedPayroll['updated_at'], true, 'Every actual saved payroll revision has a new canonical timestamp');
    $args['p_payload']['income_tax'] = 4000;
    qa_error(static function () use ($args) { qa_rpc('app_beyaz_yaka_payroll_save', $args); }, 409, 'PT409', 'Stale timestamp cannot overwrite real payroll');

    qa_login($employee, 'employee');
    $ownBlue = qa_query('bordro_employees', 'select', ['filters' => qa_filter($blue['id'])])['data'];
    qa_check(array_column($ownBlue, 'id'), [$blue['id']], 'Native employee binding survives actual SQL identity normalization');
    $ownWhite = qa_query('beyaz_yaka_monthly_payroll', 'select', ['filters' => qa_filter($secondPayroll['id'])])['data'];
    qa_check(array_column($ownWhite, 'id'), [$secondPayroll['id']], 'Employee sees own actual saved white payroll');
    qa_error(static function () use ($blue) { qa_query('bordro_employees', 'update', ['rows' => ['agreed_salary' => 1], 'filters' => qa_filter($blue['id'])]); }, 403, '42501', 'Real Ubuntu data does not grant employee payroll write permission');
    $prefKey = 'qa-ssh-' . bin2hex(random_bytes(6));
    vg_company_store(static function (array &$s, array $actor) use ($prefKey) { $s['storage'][$actor['id']][$prefKey] = 'Synthetic private SSH state'; return ['data' => null]; });
    $pref = vg_company_store(static function (array &$s, array $actor) use ($prefKey) { return ['data' => $s['storage'][$actor['id']][$prefKey] ?? null]; });
    qa_check($pref['data'], 'Synthetic private SSH state', 'Preference commit persists under private actor scope');
    qa_login($admin, 'admin');
    $foreign = vg_company_store(static function (array &$s, array $actor) use ($prefKey) { return ['data' => $s['storage'][$actor['id']][$prefKey] ?? null]; });
    qa_check($foreign['data'], null, 'Other real staff snapshot cannot read employee preference');

    // Only exact IDs minted above are cleaned; no pre-existing QA records are changed.
    qa_query('products', 'delete', ['filters' => qa_filter($product['id'])]);
    qa_query('bordro_employees', 'delete', ['filters' => qa_filter($blue['id'])]);
    qa_query('beyaz_yaka_employees', 'update', ['rows' => ['active' => false], 'filters' => qa_filter($white['id'])]);
    qa_login($employee, 'employee');
    vg_company_store(static function (array &$s, array $actor) use ($prefKey) { unset($s['storage'][$actor['id']][$prefKey]); return ['data' => null]; });
    qa_check(count(glob(vg_company_dir() . '/ssh-*')), 0, 'Actual PHP transport removes its private request/response scratch files');
    echo vg_json_encode(['ok' => true, 'checks' => $checks, 'database' => 'vg_bridge_qa_20261013_c6ea4f17']);
} catch (Throwable $e) {
    fwrite(STDERR, get_class($e) . ': ' . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n");
    exit(1);
} finally { if (session_status() === PHP_SESSION_ACTIVE) session_write_close(); }
