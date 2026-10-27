<?php
/** CLI-only test fixture. It never registers an HTTP injection or touches preview data. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('VG_API', 1);
$root = dirname(__DIR__, 2);
require $root . '/api/lib/bootstrap.php';
require $root . '/api/lib/security.php';
require $root . '/api/lib/staff.php';
require $root . '/api/lib/company.php';
if (!function_exists('vg_company_ubuntu_store')) require $root . '/api/lib/company-ubuntu.php';

$checks = 0;
function fixture_check($actual, $expected, string $message): void {
    global $checks;
    if ($actual !== $expected) throw new RuntimeException($message . ': expected ' . vg_json_encode($expected) . '; actual ' . vg_json_encode($actual));
    $checks++;
}
function fixture_error(callable $action, int $status, ?string $code, string $message): void {
    try { $action(); }
    catch (VgHttpError $e) {
        fixture_check($e->status, $status, $message . ' status');
        if ($code !== null) fixture_check($e->errCode, $code, $message . ' code');
        return;
    }
    throw new RuntimeException($message . ': error was not rejected');
}
function fixture_login(string $id, string $role = 'employee'): void {
    vg_staff_session_start();
    vg_staff_store(function (array &$s) use ($id, $role): void {
        $s['users'][$id] = ['id' => $id, 'name' => 'Synthetic ' . $id, 'email' => $id . '@example.test', 'role' => $role, 'status' => 'active', 'mfaSecret' => 'JBSWY3DPEHPK3PXP', 'password' => 'Synthetic fixture never verifies a password', 'epoch' => 1, 'createdAt' => vg_iso(time())];
    });
    $_SESSION['staff'] = ['uid' => $id, 'mfa' => true, 'epoch' => 1, 'created' => time(), 'last' => time()];
}
function fixture_state(): array {
    $state = ['version' => 1, 'tables' => [], 'storage' => [], 'sequence' => 7, 'audit' => []];
    foreach (vg_company_schema() as $table => $_) if ($table !== 'users') $state['tables'][$table] = [];
    return $state;
}

/** A deterministic transactional server model, independent of the adapter's diff logic. */
final class FixtureUbuntu {
    public array $state;
    public array $requests = [];
    public $afterSnapshot = null;
    public $rewriteCanonical = null;
    public function __construct(array $state) { $this->state = $state; }
    public function token($row): string { return hash('sha256', vg_json_encode($row)); }
    public function call(array $config, array $request): array {
        $this->requests[] = $request;
        if ($request['op'] === 'snapshot') {
            $rows = []; foreach ($this->state['tables'] as $table => $records) foreach ($records as $id => $row) $rows[$table][$id] = $this->token($row);
            $prefs = []; foreach ($this->state['storage'][$request['actor']['id']] ?? [] as $key => $value) $prefs[$key] = $this->token($value);
            $answer = ['protocol' => 'vg-ubuntu-company/1', 'ok' => true, 'state' => $this->state, 'snapshot' => ['rows' => $rows, 'prefs' => $prefs], 'catalog' => ['historicalInvoice1' => [], 'historicalInvoice2' => [], 'cablePrices' => [], 'packages' => []]];
            if ($this->afterSnapshot) ($this->afterSnapshot)($this);
            return $answer;
        }
        fixture_check($request['op'], 'commit', 'Only documented transport operation used');
        foreach ($request['changes'] as $change) {
            $old = $this->state['tables'][$change['table']][$change['id']] ?? null;
            if (($old === null ? null : $this->token($old)) !== $change['before']) return ['protocol' => 'vg-ubuntu-company/1', 'ok' => false, 'status' => 409, 'code' => 'PT409'];
        }
        foreach ($request['storageChanges'] as $change) {
            $old = $this->state['storage'][$request['actor']['id']][$change['key']] ?? null;
            if (($old === null ? null : $this->token($old)) !== $change['before']) return ['protocol' => 'vg-ubuntu-company/1', 'ok' => false, 'status' => 409, 'code' => 'PT409'];
        }
        if ($request['expectedSequence'] !== $this->state['sequence']) return ['protocol' => 'vg-ubuntu-company/1', 'ok' => false, 'status' => 409, 'code' => 'PT409'];
        $canonical = [];
        foreach ($request['changes'] as $change) {
            if ($change['row'] === null) { unset($this->state['tables'][$change['table']][$change['id']]); continue; }
            $row = $change['row'];
            if ($this->rewriteCanonical) $row = ($this->rewriteCanonical)($row, $change['table']);
            $this->state['tables'][$change['table']][$change['id']] = $row;
            $canonical[$change['table']][$change['id']] = $row;
        }
        foreach ($request['storageChanges'] as $change) {
            if ($change['value'] === null) unset($this->state['storage'][$request['actor']['id']][$change['key']]);
            else $this->state['storage'][$request['actor']['id']][$change['key']] = $change['value'];
        }
        $this->state['audit'] = array_merge($this->state['audit'], $request['audit']);
        $this->state['sequence'] = $request['sequence'];
        return ['protocol' => 'vg-ubuntu-company/1', 'ok' => true, 'rows' => $canonical];
    }
    public function commits(): array { return array_values(array_filter($this->requests, static function ($r) { return $r['op'] === 'commit'; })); }
}

function fixture_query(FixtureUbuntu $server, array $config, string $table, string $operation = 'select', array $extra = []): array {
    $input = array_merge(['table' => $table, 'operation' => $operation, 'select' => '*', 'filters' => [], 'returning' => true], $extra);
    return vg_company_ubuntu_store(static function (array &$s, array $actor) use ($input) { return vg_company_query($s, $actor, $input); }, $config, [$server, 'call']);
}
function fixture_rpc(FixtureUbuntu $server, array $config, string $name, array $arguments): array {
    return vg_company_ubuntu_store(static function (array &$s, array $actor) use ($name, $arguments) { return ['data' => vg_company_rpc($s, $actor, $name, $arguments)]; }, $config, [$server, 'call']);
}
function fixture_snapshot_response(array $state): array {
    $rows = []; foreach ($state['tables'] as $table => $records) foreach ($records as $id => $row) $rows[$table][$id] = hash('sha256', vg_json_encode($row));
    $prefs = []; foreach ($state['storage']['synthetic-employee'] ?? [] as $key => $value) $prefs[$key] = hash('sha256', vg_json_encode($value));
    return ['protocol' => 'vg-ubuntu-company/1', 'ok' => true, 'state' => $state, 'snapshot' => ['rows' => $rows, 'prefs' => $prefs], 'catalog' => ['historicalInvoice1' => [], 'historicalInvoice2' => [], 'cablePrices' => [], 'packages' => []]];
}

try {
    fixture_login('synthetic-employee');
    $syntheticExecutable = vg_data_dir() . '/ssh-fixture.exe';
    file_put_contents($syntheticExecutable, 'This synthetic path is validated but never executed.');
    $config = ['version' => 1, 'host' => 'synthetic-fixture', 'helper' => '/home/fixture/company.py', 'site' => str_repeat('a', 64), 'timeout' => 5, 'sshExecutable' => $syntheticExecutable];
    $state = fixture_state();
    $state['tables']['products']['old-product'] = ['id' => 'old-product', 'name' => 'Remote Product', 'category' => 'Kablo', 'price' => 10, 'created_at' => '2026-10-01T12:00:00.000000+00:00', 'updated_at' => '2026-10-01T12:00:00.000000+00:00'];
    $state['tables']['products']['unchanged-product'] = ['id' => 'unchanged-product', 'name' => 'Unchanged Product', 'category' => 'Kablo', 'price' => 20];
    $state['storage']['synthetic-employee'] = ['private-view' => 'private value'];
    $server = new FixtureUbuntu($state);
    $result = fixture_query($server, $config, 'products');
    fixture_check(count($result['data']), 2, 'Authenticated staff reads remote records');
    fixture_check(count($server->commits()), 0, 'Read-only query never writes');
    fixture_check($server->requests[0]['actor'], ['id' => 'synthetic-employee', 'role' => 'employee'], 'Wire actor comes from private staff identity');
    fixture_check($server->requests[0]['site'], $config['site'], 'Wire site is private configured identity');
    fixture_check(isset($server->requests[0]['actor']['email']), false, 'Transport avoids unnecessary employee email');
    fixture_check($GLOBALS['vg_company_data_source'], 'ubuntu', 'Remote snapshot labels actual data source');
    file_put_contents(vg_company_dir() . '/catalog.json', vg_json_encode(['historicalInvoice1' => [['name' => 'Local catalog must not replace remote']], 'historicalInvoice2' => [], 'cablePrices' => [], 'packages' => []]));
    fixture_check(vg_company_catalog()['historicalInvoice1'], [], 'Configured Ubuntu catalog is authoritative over local cached catalog');

    // Original Saha data is a separate source and deliberately has no company price catalog.
    $sahaConfig = vg_company_saha_remote_config(array_merge($config, ['sahaHelper' => '/home/fixture/saha_store.py']));
    fixture_check($sahaConfig['helper'], '/home/fixture/saha_store.py', 'Saha transport selects its private source helper');
    fixture_check($sahaConfig['sahaSource'], true, 'Saha catalog exemption is stamped only by internal routing');
    $sahaResponse = fixture_snapshot_response($state); unset($sahaResponse['catalog']);
    $companyCatalog = ['historicalInvoice1' => [['name' => 'Company catalog remains authoritative']], 'historicalInvoice2' => [], 'cablePrices' => [], 'packages' => []];
    $GLOBALS['vg_company_ubuntu_catalog'] = $companyCatalog;
    $sahaSnapshot = vg_company_ubuntu_store(static function (array &$s, array $actor) { return ['data' => ['actor' => $actor['id'], 'version' => $s['version']]]; }, $sahaConfig, static function () use ($sahaResponse) { return $sahaResponse; });
    fixture_check($sahaSnapshot['data'], ['actor' => 'synthetic-employee', 'version' => 1], 'Actual PHP adapter accepts authenticated catalog-free Saha snapshots');
    fixture_check($GLOBALS['vg_company_ubuntu_catalog'], $companyCatalog, 'Saha snapshot cannot replace the existing company catalog');
    unset($GLOBALS['vg_company_ubuntu_catalog']);
    vg_company_ubuntu_store(static function () { return []; }, $sahaConfig, static function () use ($sahaResponse) { return $sahaResponse; });
    fixture_check(array_key_exists('vg_company_ubuntu_catalog', $GLOBALS), false, 'Saha snapshot does not synthesize a global company catalog');
    fixture_error(static function () use ($config, $sahaResponse) { vg_company_ubuntu_store(static function () { return []; }, $config, static function () use ($sahaResponse) { return $sahaResponse; }); }, 503, 'company_ubuntu_catalog', 'Main company adapter still requires the complete catalog');
    $GLOBALS['vg_company_ubuntu_catalog'] = $companyCatalog;

    $server->rewriteCanonical = static function (array $row): array { if (isset($row['updated_at'])) $row['updated_at'] = '2026-10-13T12:00:00.123456+00:00'; return $row; };
    $oldToken = $server->token($state['tables']['products']['old-product']);
    $result = fixture_query($server, $config, 'products', 'update', ['rows' => ['price' => 12], 'filters' => [['op' => 'eq', 'field' => 'id', 'value' => 'old-product']], 'single' => 'one']);
    $commit = $server->commits()[0];
    fixture_check(count($commit['changes']), 1, 'Diff changes only selected row');
    fixture_check($commit['changes'][0]['before'], $oldToken, 'Update carries opaque server row token');
    fixture_check($commit['changes'][0]['table'], 'products', 'Diff retains allowlisted table name');
    fixture_check($commit['changes'][0]['row']['price'], 12, 'Real query mutation is submitted');
    fixture_check($commit['changes'][0]['row']['updated_by'], 'synthetic-employee', 'Local authority stamps authenticated actor');
    fixture_check($result['data']['updated_at'], '2026-10-13T12:00:00.123456+00:00', 'Returned row uses canonical remote timestamp');
    fixture_check($server->state['tables']['products']['unchanged-product'], $state['tables']['products']['unchanged-product'], 'Unrelated remote row remains untouched');
    fixture_check(preg_match('/^[a-f0-9-]{36}$/D', $commit['requestId']), 1, 'Commit request has unique request identifier');
    fixture_check($commit['audit'][0]['actor'], 'synthetic-employee', 'Commit audit uses staff identity');
    fixture_check($commit['expectedSequence'], 7, 'Sequence CAS carries initial snapshot sequence');
    fixture_check($commit['sequence'], 7, 'Ordinary update leaves proposal sequence unchanged');

    $proposal = fixture_query($server, $config, 'proposals', 'insert', ['rows' => [['type' => 'yg', 'name' => 'Synthetic Ubuntu Offer', 'data' => []]], 'single' => 'one'])['data'];
    fixture_check(substr($proposal['reference_no'], -6), '000008', 'Proposal uses remote company sequence');
    fixture_check($server->state['sequence'], 8, 'Remote transaction advances proposal sequence once');
    $insertCommit = $server->commits()[1];
    fixture_check($insertCommit['changes'][0]['before'], null, 'New rows carry absent-row token');

    $beforePrefs = $server->token('private value');
    vg_company_ubuntu_store(static function (array &$s, array $actor) { $s['storage'][$actor['id']]['private-view'] = 'changed value'; return ['data' => null]; }, $config, [$server, 'call']);
    $prefCommit = $server->commits()[2];
    fixture_check($prefCommit['changes'], [], 'Preference changes do not rewrite business rows');
    fixture_check($prefCommit['storageChanges'], [['key' => 'private-view', 'before' => $beforePrefs, 'value' => 'changed value']], 'Preference diff retains opaque CAS token');
    $beforeOwnerRejection = count($server->commits());
    fixture_error(static function () use ($server, $config) { vg_company_ubuntu_store(static function (array &$s) { $s['storage']['other-staff']['secret'] = 'forbidden'; return []; }, $config, [$server, 'call']); }, 403, 'company_storage_owner', 'Cannot write another staff member preference');
    fixture_check(count($server->commits()), $beforeOwnerRejection, 'Unauthorized preference never reaches commit');

    $racing = new FixtureUbuntu($state);
    $racing->afterSnapshot = static function (FixtureUbuntu $remote): void { $remote->state['tables']['products']['old-product']['price'] = 15; };
    fixture_error(static function () use ($racing, $config) { fixture_query($racing, $config, 'products', 'update', ['rows' => ['price' => 99], 'filters' => [['op' => 'eq', 'field' => 'id', 'value' => 'old-product']]]); }, 409, 'PT409', 'Concurrent remote edit is rejected');
    fixture_check($racing->state['tables']['products']['old-product']['price'], 15, 'Conflict preserves concurrent remote value');

    $payrollState = fixture_state();
    $payrollState['tables']['bordro_employees'] = ['own' => ['id' => 'own', 'name' => 'Own Payroll', 'user_id' => 'synthetic-employee'], 'other' => ['id' => 'other', 'name' => 'Other Payroll', 'user_id' => 'other-staff'], 'unmapped' => ['id' => 'unmapped', 'name' => 'Unmapped', 'user_id' => null]];
    $payrollState['tables']['bordro_daily_logs'] = ['own-day' => ['id' => 'own-day', 'employee_id' => 'own', 'description' => 'Own detail'], 'other-day' => ['id' => 'other-day', 'employee_id' => 'other', 'description' => 'Other detail']];
    $payrollServer = new FixtureUbuntu($payrollState);
    fixture_check(array_column(fixture_query($payrollServer, $config, 'bordro_employees')['data'], 'id'), ['own'], 'Remote payroll read still uses strict own-account mapping');
    fixture_check(array_column(fixture_query($payrollServer, $config, 'bordro_daily_logs')['data'], 'id'), ['own-day'], 'Remote payroll details filtered by employee ownership');
    fixture_error(static function () use ($payrollServer, $config) { fixture_query($payrollServer, $config, 'bordro_employees', 'insert', ['rows' => [['name' => 'Unauthorized', 'agreed_salary' => 1, 'official_salary' => 1]]]); }, 403, '42501', 'Ordinary staff cannot become payroll manager through remote adapter');
    fixture_check(count($payrollServer->commits()), 0, 'Denied payroll request is never sent to remote commit');
    $payrollState['tables']['activity_logs'] = ['own-log' => ['id' => 'own-log', 'user_id' => 'synthetic-employee', 'action_description' => 'Own event'], 'other-log' => ['id' => 'other-log', 'user_id' => 'other-staff', 'action_description' => 'Other payroll event'], 'legacy-log' => ['id' => 'legacy-log', 'user_id' => null, 'action_description' => 'Unmapped legacy payroll event']];
    $activityServer = new FixtureUbuntu($payrollState);
    fixture_check(array_column(fixture_query($activityServer, $config, 'activity_logs')['data'], 'id'), ['own-log'], 'Employee activity history does not leak other or unmapped legacy payroll events');

    fixture_login('synthetic-payroll', 'payroll');
    $whiteState = fixture_state();
    $whiteState['tables']['beyaz_yaka_employees']['white-own'] = ['id' => 'white-own', 'name' => 'Synthetic White Payroll', 'user_id' => 'synthetic-employee', 'monthly_salary' => 50000, 'gross_salary' => 60000, 'active' => true];
    $whiteServer = new FixtureUbuntu($whiteState);
    $whiteServer->rewriteCanonical = static function (array $row): array { if (isset($row['updated_at'])) $row['updated_at'] = '2026-10-13T12:00:00.987654+00:00'; return $row; };
    $whiteArgs = ['p_employee_id' => 'white-own', 'p_month' => 9, 'p_year' => 2026, 'p_payload' => ['base_salary' => 60000, 'sgk_employee' => 8000, 'income_tax' => 2000, 'logs' => []], 'p_expected_updated_at' => null];
    $white = fixture_rpc($whiteServer, $config, 'app_beyaz_yaka_payroll_save', $whiteArgs)['data'];
    fixture_check($white['net_payment'], 50000.0, 'Real payroll RPC arithmetic persists through remote adapter');
    fixture_check($white['updated_at'], '2026-10-13T12:00:00.987654+00:00', 'Payroll RPC returns remote canonical timestamp for next CAS');
    $whiteArgs['p_expected_updated_at'] = $white['updated_at'];
    $whiteArgs['p_payload']['income_tax'] = 3000;
    $updatedWhite = fixture_rpc($whiteServer, $config, 'app_beyaz_yaka_payroll_save', $whiteArgs)['data'];
    fixture_check($updatedWhite['net_payment'], 49000.0, 'Next payroll save accepts returned canonical timestamp alias');
    fixture_check(count($whiteServer->commits()[1]['changes']), 1, 'Payroll save sends one atomic payroll row change');
    fixture_login('synthetic-employee');

    $canonical = ['beyaz_yaka_monthly_payroll' => ['payroll-id' => ['id' => 'payroll-id', 'updated_at' => 'remote']], 'beyaz_yaka_advances' => ['expense-id' => ['id' => 'expense-id', 'updated_at' => 'remote-advance']]];
    $nested = ['data' => ['payroll' => ['id' => 'payroll-id', 'updated_at' => 'local'], 'expense' => ['id' => 'expense-id', 'amount' => 100], 'expenses' => [['id' => 'expense-id', 'amount' => 100]]]];
    $replaced = vg_company_ubuntu_result($nested, $canonical);
    fixture_check($replaced['data']['payroll'], $canonical['beyaz_yaka_monthly_payroll']['payroll-id'], 'Only known payroll result is canonicalized');
    fixture_check($replaced['data']['expense'], $nested['data']['expense'], 'Nested expense with matching ledger id is not accidentally replaced');
    fixture_check($replaced['data']['expenses'], $nested['data']['expenses'], 'Nested expense collection retains its full client result');
    fixture_check(vg_company_ubuntu_result(['data' => [['id' => 'payroll-id', 'updated_at' => 'local']]], $canonical)['data'][0]['updated_at'], 'remote', 'Returned row arrays are canonicalized');

    $invalidResponses = [
        'wrong protocol' => ['protocol' => 'public-database/1', 'ok' => true],
        'nonboolean status' => ['protocol' => 'vg-ubuntu-company/1', 'ok' => 1],
        'missing tables' => ['protocol' => 'vg-ubuntu-company/1', 'ok' => true, 'state' => ['version' => 1]],
        'invalid version' => array_replace_recursive(fixture_snapshot_response($state), ['state' => ['version' => 2]]),
        'missing row token' => array_replace_recursive(fixture_snapshot_response($state), ['snapshot' => ['rows' => ['products' => ['old-product' => null]]]]),
        'nonhex row token' => array_replace_recursive(fixture_snapshot_response($state), ['snapshot' => ['rows' => ['products' => ['old-product' => str_repeat('x', 64)]]]]),
        'wrong row identity' => array_replace_recursive(fixture_snapshot_response($state), ['state' => ['tables' => ['products' => ['old-product' => ['id' => 'other-id']]]]]),
        'credentials table' => array_replace_recursive(fixture_snapshot_response($state), ['state' => ['tables' => ['users' => []]]]),
        'unknown table' => array_replace_recursive(fixture_snapshot_response($state), ['state' => ['tables' => ['secrets' => []]]]),
        'other staff preferences' => array_replace_recursive(fixture_snapshot_response($state), ['state' => ['storage' => ['other-staff' => ['secret' => 'must not expose']]]]),
        'unrecognized catalog field' => array_replace_recursive(fixture_snapshot_response($state), ['catalog' => ['credentials' => []]]),
        'missing catalog' => array_diff_key(fixture_snapshot_response($state), ['catalog' => true]),
        'invalid catalog collection' => array_replace_recursive(fixture_snapshot_response($state), ['catalog' => ['historicalInvoice1' => 'invalid']]),
    ];
    foreach ($invalidResponses as $label => $response) fixture_error(static function () use ($config, $response) { vg_company_ubuntu_store(static function (array &$s) { return ['data' => null]; }, $config, static function () use ($response) { return $response; }); }, 503, null, 'Malformed remote ' . $label);
    // Committed canonical rows refresh values but never re-add fields masked or projected away for this actor.
    $canonical = ['drivers' => ['d1' => ['id' => 'd1', 'full_name' => 'Kanonik Ad', 'tc_no' => '10000000146', 'license_no' => 'L-1', 'updated_at' => 'T2']]];
    $masked = vg_company_ubuntu_result(['data' => [['id' => 'd1', 'full_name' => 'Eski Ad', 'updated_at' => 'T1']], 'count' => 1], $canonical);
    fixture_check($masked['data'][0], ['id' => 'd1', 'full_name' => 'Kanonik Ad', 'updated_at' => 'T2'], 'Returned rows keep the actor masking and projection');
    $single = vg_company_ubuntu_result(['data' => ['id' => 'd1', 'full_name' => 'Eski Ad']], $canonical);
    fixture_check(array_key_exists('tc_no', $single['data']), false, 'Single returned row cannot regain hidden identity number');
    fixture_error(static function () use ($config) { vg_company_ubuntu_store(static function () { return []; }, $config, static function () { throw new RuntimeException('Simulated offline private host'); }); }, 503, 'company_ubuntu_unavailable', 'Offline transport fails closed');
    fixture_error(static function () use ($config) { vg_company_ubuntu_call($config, ['op' => 'snapshot'], static function () { return ['protocol' => 'vg-ubuntu-company/1', 'ok' => false, 'status' => 200, 'code' => 'dangerous invalid code']; }); }, 503, 'company_ubuntu_unavailable', 'Remote errors cannot forge successful status or unsafe codes');

    $revoked = new FixtureUbuntu($state);
    $revoked->afterSnapshot = static function (): void { vg_staff_store(static function (array &$s): void { $s['users']['synthetic-employee']['epoch']++; }); };
    $called = false;
    fixture_error(static function () use ($revoked, $config, &$called) { vg_company_ubuntu_store(static function (array &$s) use (&$called) { $called = true; $s['sequence']++; return []; }, $config, [$revoked, 'call']); }, 401, 'staff_unauthorized', 'Revocation during snapshot blocks mutation');
    fixture_check($called, false, 'Revoked actor cannot execute mutation callback');
    fixture_check(count($revoked->commits()), 0, 'Revocation after read prevents remote commit');
    fixture_login('synthetic-employee');
    $revokedAfterCallback = new FixtureUbuntu($state);
    fixture_error(static function () use ($revokedAfterCallback, $config) { vg_company_ubuntu_store(static function (array &$s) { $s['sequence']++; vg_staff_store(static function (array &$staff) { $staff['users']['synthetic-employee']['status'] = 'disabled'; }); return []; }, $config, [$revokedAfterCallback, 'call']); }, 401, 'staff_unauthorized', 'Revocation after mutation callback still blocks write');
    fixture_check(count($revokedAfterCallback->commits()), 0, 'Second live authorization check runs immediately before commit');
    fixture_login('synthetic-employee');
    unset($_SESSION['staff']);
    $transportCalls = 0;
    fixture_error(static function () use ($config, &$transportCalls) { vg_company_ubuntu_store(static function () { return []; }, $config, static function () use (&$transportCalls) { $transportCalls++; return []; }); }, 401, 'staff_unauthorized', 'Anonymous request is rejected');
    fixture_check($transportCalls, 0, 'Authless request cannot invoke SSH transport');
    fixture_login('synthetic-employee');

    $configFile = vg_company_dir() . '/ubuntu.json';
    fixture_check(vg_company_ubuntu_config(), null, 'Absent remote configuration is explicit local mode');
    file_put_contents($configFile, vg_json_encode($config));
    fixture_check(vg_company_ubuntu_config()['host'], 'synthetic-fixture', 'Private valid remote configuration is accepted');
    $invalidConfigs = [
        '{broken',
        vg_json_encode(array_merge($config, ['password' => 'unexpected field'])),
        vg_json_encode(array_merge($config, ['sahaSource' => true])),
        vg_json_encode(array_merge($config, ['host' => 'host; unsafe-command'])),
        vg_json_encode(array_merge($config, ['helper' => '/home/fixture/../secret.py'])),
        vg_json_encode(array_merge($config, ['site' => 'not-a-site-identity'])),
        vg_json_encode(array_merge($config, ['timeout' => 0])),
        vg_json_encode(array_merge($config, ['sshExecutable' => vg_company_dir() . '/nonexistent.exe'])),
        str_repeat('x', 8193),
    ];
    foreach ($invalidConfigs as $invalid) {
        file_put_contents($configFile, $invalid); $rejected = false;
        try { vg_company_ubuntu_config(); } catch (Throwable $e) { $rejected = true; }
        fixture_check($rejected, true, 'Malformed configured remote host cannot silently fall back to local storage');
    }
    unlink($configFile);
    mkdir($configFile);
    $rejectedDirectory = false;
    try { vg_company_ubuntu_config(); } catch (Throwable $e) { $rejectedDirectory = true; }
    fixture_check($rejectedDirectory, true, 'Existing configuration directory is invalid rather than absent remote mode');
    rmdir($configFile);
    $linkTarget = vg_data_dir() . '/config-symlink-target.json';
    file_put_contents($linkTarget, vg_json_encode($config));
    if (@symlink($linkTarget, $configFile)) {
        $rejectedLink = false;
        try { vg_company_ubuntu_config(); } catch (Throwable $e) { $rejectedLink = true; }
        fixture_check($rejectedLink, true, 'Configuration symlink is rejected even when its target is a valid private config');
        unlink($configFile);
    }
    if (@symlink(vg_data_dir() . '/nonexistent-config.json', $configFile)) {
        $rejectedBrokenLink = false;
        try { vg_company_ubuntu_config(); } catch (Throwable $e) { $rejectedBrokenLink = true; }
        fixture_check($rejectedBrokenLink, true, 'Broken configuration symlink fails closed rather than activating local data');
        unlink($configFile);
    }
    echo vg_json_encode(['ok' => true, 'checks' => $checks, 'sessionId' => session_id(), 'csrf' => vg_staff_csrf(), 'config' => $config]);
} catch (Throwable $e) {
    fwrite(STDERR, get_class($e) . ': ' . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n");
    exit(1);
} finally {
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
}
