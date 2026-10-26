<?php
/** Private company workspace adapter. Staff sessions are the sole authority. */
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }
require_once __DIR__ . '/company-ubuntu.php';

function vg_company_schema(): array {
    static $schema;
    if ($schema !== null) return $schema;
    $fields = [
        'proposals' => 'type name data reference_no',
        'company_documents' => 'kind record_id payload revision',
        'products' => 'name category price original_name is_new is_active',
        'urun_takip' => 'urun_adi kategori marka model miktar birim lokasyon aciklama seri_no tarih user_email',
        'gorevler' => 'baslik aciklama durum oncelik atanan_kisi baslangic_tarihi bitis_tarihi notlar',
        'is_takip_calisanlar' => 'ad_soyad telefon email pozisyon aktif user_id',
        'is_takip_lokasyonlar' => 'ad adres koordinat aktif',
        'is_takip_malzemeler' => 'ad kategori birim stok_durumu aktif',
        'is_takip_kayitlar' => 'tarih calisan_id lokasyon_id baslangic_saat bitis_saat toplam_sure yapilan_is kullanilan_malzemeler notlar',
        'vehicles' => 'plate brand model year color active',
        'drivers' => 'full_name phone tc_no license_no active',
        'fuel_records' => 'date vehicle_id driver_id liters price_per_liter total_amount km station fuel_type payment_method description',
        'haftalik_raporlar' => 'fabrika_adi hafta_baslangic hafta_bitis guc_faktoru onceki_hafta_guc_faktoru hedef_guc_faktoru reaktif_guc aktif_guc kompanzasyon_durumu enerji_tuketimi maliyet notlar gorsel_url rapor_hazirlayan onaylayan excel_data_aktif excel_data_enduktif excel_data_kapasitif osos_ozet_tablo',
        'osos_fabrikalar' => 'firma_adi fabrika_adi vergi_no adres il ilce posta_kodu yetkili_adi yetkili_unvan telefon email tesis_gucu_kw calisan_sayisi faaliyet_alani dagitim_sirketi sayac_no musteri_no abone_no notlar aktif',
        'osos_olcumler' => 'fabrika_adi sayac_no aktif_guc reaktif_guc kapasitif_guc gorunen_guc gerilim_l1 gerilim_l2 gerilim_l3 akim_l1 akim_l2 akim_l3 guc_faktoru frekans toplam_enerji olcum_zamani',
        'bordro_employees' => 'name tc_no agreed_salary official_salary active user_id',
        'bordro_daily_logs' => 'employee_id day month year type start_time end_time overtime_hours description last_modified_by last_modified_at restored_at',
        'bordro_expenses' => 'employee_id month year type amount description date installment_total installment_current',
        'monthly_payroll_summary' => 'employee_id month year employee_name agreed_salary official_salary days_worked sunday_days overtime_hours advances expenses bonuses net_payable hand_pay closed_at user_id',
        'bordro_payment_records' => 'employee_id month year calculated_amount paid_amount balance payment_date payment_note',
        'beyaz_yaka_employees' => 'name tc_no email phone position department start_date monthly_salary gross_salary sgk_base active bank_name iban user_id',
        'beyaz_yaka_monthly_payroll' => 'employee_id month year base_salary overtime_pay bonus meal_allowance transport_allowance other_earnings advance_deduction sgk_employee unemployment_employee income_tax stamp_tax other_deductions net_payment sgk_employer unemployment_employer total_employer_cost worked_days total_days paid_leave_days unpaid_leave_days sick_leave_days payment_date payment_method is_paid notes logs expenses',
        'beyaz_yaka_advances' => 'employee_id amount advance_date description installment_count remaining_installments monthly_deduction is_fully_paid',
        'beyaz_yaka_leaves' => 'employee_id leave_type start_date end_date total_days is_paid description status',
        'beyaz_yaka_bonuses' => 'employee_id bonus_type amount bonus_date month year description is_applied',
        'activity_logs' => 'user_id user_email action_type action_description module related_id ip_address user_agent',
        'users' => 'name email company role companyRole approved can_access_bordro must_change_password status'
    ];
    $schema = [];
    foreach ($fields as $table => $columns) $schema[$table] = array_merge(['id', 'created_at', 'updated_at', 'created_by', 'updated_by'], explode(' ', $columns));
    return $schema;
}

function vg_company_fail(int $status = 422, string $code = '22023', string $message = 'Gönderilen şirket kaydını kontrol edin.'): void { vg_fail($status, $code, $message); }
function vg_company_conflict(string $message = 'Kayıt başka bir işlemde değişti. Güncel sürümü yükleyip karşılaştırın.'): void { vg_company_fail(409, 'PT409', $message); }
function vg_company_manage(array $user): bool { return in_array($user['role'], ['admin', 'payroll'], true); }
function vg_company_sensitive(string $table): bool { return strpos($table, 'bordro_') === 0 || strpos($table, 'beyaz_yaka_') === 0 || $table === 'monthly_payroll_summary'; }
function vg_company_id(): string { $b = random_bytes(16); $b[6] = chr((ord($b[6]) & 15) | 64); $b[8] = chr((ord($b[8]) & 63) | 128); $h = bin2hex($b); return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20); }
function vg_company_time(?string $previous = null): string {
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC')); $value = $now->format('Y-m-d\TH:i:s.u\Z');
    if ($previous !== null && strcmp($value, $previous) <= 0) $value = (new DateTimeImmutable($previous))->modify('+1 microsecond')->format('Y-m-d\TH:i:s.u\Z');
    return $value;
}
function vg_company_user(array $u): array {
    return vg_staff_public_user($u) + ['companyRole' => $u['role'], 'company' => 'VoltGuard', 'approved' => ($u['status'] ?? 'active') === 'active', 'can_access_bordro' => vg_company_manage($u), 'must_change_password' => ($u['status'] ?? 'active') !== 'active', 'status' => $u['status'] ?? 'active', 'created_at' => $u['createdAt'] ?? null];
}
function vg_company_dir(): string { $base = realpath(vg_data_dir()); if ($base === false) throw new RuntimeException('company private base'); return vg_staff_private_directory($base . '/company', $base); }
function vg_company_catalog(): array {
    if (isset($GLOBALS['vg_company_ubuntu_catalog'])) return $GLOBALS['vg_company_ubuntu_catalog'];
    $empty = ['historicalInvoice1' => [], 'historicalInvoice2' => [], 'cablePrices' => (object)[], 'packages' => ['paketler' => []]];
    $directory = vg_company_dir(); $file = $directory . '/catalog.json'; if (!is_file($file)) return $empty;
    $actual = realpath($file); $prefix = strtolower(rtrim(str_replace('\\', '/', $directory), '/')) . '/';
    if ($actual === false || strpos(strtolower(str_replace('\\', '/', $actual)), $prefix) !== 0 || filesize($file) > 16777216) throw new RuntimeException('invalid private catalog');
    $raw = @file_get_contents($file); $catalog = is_string($raw) ? json_decode($raw, true, 64) : null;
    if (!is_array($catalog) || array_diff(array_keys($catalog), array_keys($empty))) throw new RuntimeException('invalid private catalog');
    foreach ($catalog as $key => $value) if (!is_array($value)) throw new RuntimeException('invalid private catalog field');
    return array_merge($empty, $catalog);
}
function vg_company_store(callable $fn) {
    $remote = vg_company_ubuntu_config();
    if ($remote !== null) return vg_company_ubuntu_store($fn, $remote);
    $dir = vg_company_dir(); $file = $dir . '/state.json'; $lock = @fopen($dir . '/store.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) throw new RuntimeException('company store lock');
    @chmod($dir . '/store.lock', 0600);
    try {
        $s = ['version' => 1, 'tables' => [], 'storage' => [], 'sequence' => 0, 'audit' => []];
        if (is_file($file)) {
            if (filesize($file) > 134217728) throw new RuntimeException('company store size');
            $raw = @file_get_contents($file); $s = is_string($raw) ? json_decode($raw, true, 128) : null;
            if (!is_array($s) || ($s['version'] ?? null) !== 1 || !is_array($s['tables'] ?? null) || !is_array($s['storage'] ?? null) || !is_array($s['audit'] ?? null)) throw new RuntimeException('company invalid store');
        }
        foreach (vg_company_schema() as $table => $_) if ($table !== 'users' && !isset($s['tables'][$table])) $s['tables'][$table] = [];
        $before = vg_json_encode($s);
        // Recheck current approval, MFA, expiry and epoch after obtaining the company lock.
        $user = vg_staff_require_user(); $result = $fn($s, $user); $after = vg_json_encode($s);
        if ($before !== $after) {
            if (strlen($after) > 134217728) vg_company_fail(409, 'company_capacity', 'Şirket depolama sınırına ulaşıldı.');
            $tmp = $dir . '/state-' . bin2hex(random_bytes(12)) . '.tmp';
            if (@file_put_contents($tmp, $after, LOCK_EX) !== strlen($after)) { @unlink($tmp); throw new RuntimeException('company write'); }
            @chmod($tmp, 0600); if (!@rename($tmp, $file)) { @unlink($tmp); throw new RuntimeException('company commit'); } @chmod($file, 0600);
        }
        return $result;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
function vg_company_audit(array &$s, array $u, string $event, string $target): void { $s['audit'][] = ['at' => vg_company_time(), 'actor' => $u['id'], 'event' => $event, 'target' => $target]; $s['audit'] = array_slice($s['audit'], -1000); }
function vg_company_wire($value, string $key = '') {
    if (!is_array($value)) return $value;
    if ($value === [] && in_array($key, ['logs', 'payload', 'storage', 'cablePrices'], true)) return (object)[];
    foreach ($value as $k => $v) $value[$k] = vg_company_wire($v, (string)$k);
    return $value;
}
function vg_company_staff_users(array $actor): array {
    return vg_staff_store(function (array &$s) use ($actor) { $items = []; foreach ($s['users'] as $u) if (vg_company_manage($actor) || $u['id'] === $actor['id']) $items[] = vg_company_user($u); return $items; });
}
function vg_company_visible(array $s, array $u, string $table, array $row): bool {
    if ($table === 'activity_logs') return vg_company_manage($u) || ($row['user_id'] ?? null) === $u['id'];
    if (!vg_company_sensitive($table) || vg_company_manage($u)) return true;
    $employeeTable = strpos($table, 'beyaz_yaka_') === 0 ? 'beyaz_yaka_employees' : 'bordro_employees';
    $employee = $table === $employeeTable ? $row : ($s['tables'][$employeeTable][$row['employee_id'] ?? ''] ?? null);
    // Null / email / name matching NEVER implies employee ownership.
    return is_array($employee) && ($employee['user_id'] ?? null) === $u['id'];
}
/*
 * Table x role permission matrix (server-side; the UI never decides).
 *   select : every approved employee; payroll tables additionally pass vg_company_visible().
 *   write  : operational tables for every employee, payroll tables only for admin/payroll (see query()).
 *   delete : admin everywhere; payroll managers on payroll tables; ordinary employees only rows they
 *            created themselves in day-to-day work tables. Master data and issued quotes: admin only.
 * Personal identifiers that ordinary employees do not need are hidden from them and cannot be filtered on.
 */
const VG_COMPANY_OWN_DELETE_TABLES = ['gorevler', 'is_takip_kayitlar', 'urun_takip', 'fuel_records', 'haftalik_raporlar', 'osos_olcumler'];
const VG_COMPANY_MANAGER_FIELDS = ['drivers' => ['tc_no', 'license_no'], 'is_takip_calisanlar' => ['telefon', 'email']];
function vg_company_can_delete(array $u, string $table, array $row): bool {
    if ($u['role'] === 'admin') return true;
    if (vg_company_sensitive($table)) return vg_company_manage($u);
    return in_array($table, VG_COMPANY_OWN_DELETE_TABLES, true) && ($row['created_by'] ?? null) === $u['id'];
}
function vg_company_hidden_fields(array $u, string $table): array { return vg_company_manage($u) ? [] : (VG_COMPANY_MANAGER_FIELDS[$table] ?? []); }
function vg_company_mask_rows(array $u, string $table, array $rows): array {
    $hidden = vg_company_hidden_fields($u, $table); if (!$hidden) return $rows;
    return array_map(function ($row) use ($hidden) { foreach ($hidden as $field) unset($row[$field]); return $row; }, $rows);
}
function vg_company_field(string $table, $field): string { if (!is_string($field) || !in_array($field, vg_company_schema()[$table], true)) vg_company_fail(400, 'company_field', 'Desteklenmeyen kayıt alanı.'); return $field; }
function vg_company_filters(string $table, $filters): array {
    if (!is_array($filters) || count($filters) > 24) vg_company_fail(400, 'company_filter', 'Kayıt filtresi geçersiz.');
    foreach ($filters as $f) {
        if (!is_array($f) || !in_array($f['op'] ?? '', ['eq', 'neq', 'is', 'not', 'in', 'gt', 'gte', 'lt', 'lte'], true)) vg_company_fail(400, 'company_filter', 'Kayıt filtresi geçersiz.');
        vg_company_field($table, $f['field'] ?? null); $v = $f['value'] ?? null;
        if ($f['op'] === 'not') { if (!is_array($v) || ($v['op'] ?? '') !== 'is' || ($v['value'] ?? null) !== null) vg_company_fail(400, 'company_filter', 'Kayıt filtresi geçersiz.'); }
        elseif ($f['op'] === 'in') { if (!is_array($v) || count($v) > 200) vg_company_fail(400, 'company_filter', 'Kayıt filtresi geçersiz.'); foreach ($v as $item) if (!is_scalar($item) && $item !== null) vg_company_fail(400, 'company_filter'); }
        elseif (!is_scalar($v) && $v !== null) vg_company_fail(400, 'company_filter', 'Kayıt filtresi geçersiz.');
    }
    return $filters;
}
function vg_company_equal($a, $b): bool { if ($a === null || $b === null || is_bool($a) || is_bool($b)) return $a === $b; return is_scalar($a) && is_scalar($b) && (string)$a === (string)$b; }
function vg_company_matches(array $row, array $filters): bool {
    foreach ($filters as $f) {
        $a = $row[$f['field']] ?? null; $b = $f['value'] ?? null; $op = $f['op'];
        if ($op === 'eq' || $op === 'is') $yes = vg_company_equal($a, $b);
        elseif ($op === 'neq') $yes = !vg_company_equal($a, $b);
        elseif ($op === 'not') $yes = $a !== null;
        elseif ($op === 'in') { $yes = false; foreach ($b as $value) if (vg_company_equal($a, $value)) { $yes = true; break; } }
        else { $cmp = is_numeric($a) && is_numeric($b) ? ((float)$a <=> (float)$b) : strcmp((string)$a, (string)$b); $yes = $op === 'gt' ? $cmp > 0 : ($op === 'gte' ? $cmp >= 0 : ($op === 'lt' ? $cmp < 0 : $cmp <= 0)); }
        if (!$yes) return false;
    }
    return true;
}
function vg_company_projection(array $s, string $table, array $row, $selection): array {
    if (!is_string($selection) || strlen($selection) > 1200) vg_company_fail(400, 'company_select');
    $selection = trim($selection); if ($selection === '') $selection = '*';
    $tokens = preg_split('/,(?![^()]*\))/', $selection); $out = [];
    foreach ($tokens as $raw) {
        $field = trim($raw); if ($field === '*') { $out += $row; continue; }
        if (strpos($field, '(') !== false) {
            $flat = preg_replace('/\s+/', '', $field);
            $joins = ['fuel_records' => ['vehicles:vehicle_id(plate)' => ['vehicles', 'vehicles', 'vehicle_id', ['plate']], 'drivers:driver_id(full_name)' => ['drivers', 'drivers', 'driver_id', ['full_name']]], 'is_takip_kayitlar' => ['calisan:is_takip_calisanlar(ad_soyad)' => ['calisan', 'is_takip_calisanlar', 'calisan_id', ['ad_soyad']], 'lokasyon:is_takip_lokasyonlar(ad,adres)' => ['lokasyon', 'is_takip_lokasyonlar', 'lokasyon_id', ['ad', 'adres']]]];
            $join = $joins[$table][$flat] ?? null; if (!$join) vg_company_fail(400, 'company_select', 'Desteklenmeyen kayıt ilişkisi.');
            $related = $s['tables'][$join[1]][$row[$join[2]] ?? ''] ?? null; $out[$join[0]] = $related ? array_intersect_key($related, array_flip($join[3])) : null; continue;
        }
        vg_company_field($table, $field); $out[$field] = $row[$field] ?? null;
    }
    return $out;
}
function vg_company_slice(array $s, string $table, array $rows, array $input): array {
    $order = $input['order'] ?? []; if (!is_array($order) || count($order) > 5) vg_company_fail(400, 'company_order');
    foreach ($order as $o) { if (!is_array($o)) vg_company_fail(400, 'company_order'); vg_company_field($table, $o['field'] ?? null); if (isset($o['ascending']) && !is_bool($o['ascending'])) vg_company_fail(400, 'company_order'); }
    if ($order) usort($rows, function ($a, $b) use ($order) { foreach ($order as $o) { $x = $a[$o['field']] ?? null; $y = $b[$o['field']] ?? null; $cmp = is_numeric($x) && is_numeric($y) ? ((float)$x <=> (float)$y) : strcmp((string)$x, (string)$y); if ($cmp !== 0) return ($o['ascending'] ?? true) ? $cmp : -$cmp; } return 0; });
    $count = count($rows); $offset = 0; $limit = $input['limit'] ?? 1000;
    if (!is_int($limit) || $limit < 1 || $limit > 5000) vg_company_fail(400, 'company_limit');
    if (isset($input['range'])) { $r = $input['range']; if (!is_array($r) || count($r) !== 2 || !is_int($r[0]) || !is_int($r[1]) || $r[0] < 0 || $r[1] < $r[0] || $r[1] - $r[0] >= 5000) vg_company_fail(400, 'company_range'); $offset = $r[0]; $limit = min($limit, $r[1] - $r[0] + 1); }
    $rows = array_slice($rows, $offset, $limit); $single = $input['single'] ?? null;
    if (!in_array($single, [null, 'one', 'maybe'], true)) vg_company_fail(400, 'company_single');
    if (($single === 'one' && count($rows) !== 1) || ($single === 'maybe' && count($rows) > 1)) vg_company_fail(406, 'PGRST116', 'Tek kayıt beklenirken farklı sayıda kayıt bulundu.');
    $items = array_map(function ($r) use ($s, $table, $input) { return vg_company_projection($s, $table, $r, $input['select'] ?? '*'); }, $rows);
    return ['data' => $single !== null ? ($items[0] ?? null) : $items, 'count' => $count];
}

function vg_company_defaults(string $table): array {
    $d = ['products' => ['is_new' => true, 'is_active' => true], 'urun_takip' => ['miktar' => 0, 'birim' => 'Adet'], 'gorevler' => ['durum' => 'beklemede', 'oncelik' => 'orta'], 'is_takip_calisanlar' => ['aktif' => true], 'is_takip_lokasyonlar' => ['aktif' => true], 'is_takip_malzemeler' => ['aktif' => true, 'stok_durumu' => 0], 'vehicles' => ['active' => true], 'drivers' => ['active' => true], 'bordro_employees' => ['active' => true, 'user_id' => null], 'beyaz_yaka_employees' => ['active' => true, 'user_id' => null], 'beyaz_yaka_advances' => ['is_fully_paid' => false], 'osos_fabrikalar' => ['aktif' => true]];
    return $d[$table] ?? [];
}
function vg_company_number($n, bool $nonnegative = true): float { if ((!is_numeric($n) || is_bool($n)) || !is_finite((float)$n) || abs((float)$n) >= 1000000000000 || ($nonnegative && (float)$n < 0)) vg_company_fail(); return (float)$n; }
function vg_company_date($v, bool $nullable = false): ?string { if ($nullable && ($v === null || $v === '')) return null; if (!is_string($v) || preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/D', $v, $m) !== 1 || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) vg_company_fail(); return $v; }
function vg_company_period($month, $year, $day = null): void { if (!is_int($month) || $month < 0 || $month > 11 || !is_int($year) || $year < 2000 || $year > 2200 || ($day !== null && (!is_int($day) || !checkdate($month + 1, $day, $year)))) vg_company_fail(); }
function vg_company_employee(array $s, string $table, $id): array { $u = is_string($id) ? ($s['tables'][$table][$id] ?? null) : null; if (!$u) vg_company_fail(404, 'company_employee_missing', 'Çalışan kaydı bulunamadı.'); return $u; }
function vg_company_validate(array $s, string $table, array $row): void {
    foreach ($row as $key => $value) {
        vg_company_field($table, $key);
        $jsonFields = ['data', 'payload', 'logs', 'excel_data_aktif', 'excel_data_enduktif', 'excel_data_kapasitif', 'osos_ozet_tablo', 'kullanilan_malzemeler'];
        if (is_array($value) && !in_array($key, $jsonFields, true) && !($table === 'beyaz_yaka_monthly_payroll' && $key === 'expenses')) vg_company_fail();
        if (is_string($value) && (!preg_match('//u', $value) || strpos($value, "\0") !== false || strlen($value) > 2097152)) vg_company_fail();
        if (is_array($value) && strlen(vg_json_encode($value)) > 2097152) vg_company_fail();
        if (in_array($key, ['active', 'aktif', 'is_active', 'is_new', 'is_paid', 'is_fully_paid', 'is_applied'], true) && !is_bool($value)) vg_company_fail();
    }
    $required = ['proposals' => ['type', 'name', 'data'], 'products' => ['name', 'category', 'price'], 'urun_takip' => ['urun_adi', 'kategori'], 'gorevler' => ['baslik'], 'is_takip_calisanlar' => ['ad_soyad'], 'is_takip_lokasyonlar' => ['ad'], 'is_takip_malzemeler' => ['ad'], 'is_takip_kayitlar' => ['tarih', 'calisan_id', 'lokasyon_id', 'baslangic_saat', 'bitis_saat', 'yapilan_is'], 'vehicles' => ['plate'], 'drivers' => ['full_name'], 'fuel_records' => ['date', 'vehicle_id', 'driver_id', 'total_amount'], 'haftalik_raporlar' => ['fabrika_adi', 'hafta_baslangic', 'hafta_bitis'], 'bordro_employees' => ['name', 'agreed_salary', 'official_salary'], 'beyaz_yaka_employees' => ['name', 'monthly_salary', 'start_date']];
    foreach ($required[$table] ?? [] as $key) if (!isset($row[$key]) || (is_string($row[$key]) && trim($row[$key]) === '')) vg_company_fail();
    $numeric = ['price', 'miktar', 'stok_durumu', 'liters', 'price_per_liter', 'total_amount', 'km', 'tesis_gucu_kw', 'calisan_sayisi', 'agreed_salary', 'official_salary', 'monthly_salary', 'gross_salary', 'sgk_base', 'amount', 'calculated_amount', 'paid_amount', 'days_worked', 'sunday_days', 'overtime_hours', 'advances', 'expenses', 'bonuses', 'net_payable', 'hand_pay', 'guc_faktoru', 'onceki_hafta_guc_faktoru', 'hedef_guc_faktoru', 'reaktif_guc', 'aktif_guc', 'enerji_tuketimi', 'maliyet', 'kapasitif_guc', 'gorunen_guc', 'gerilim_l1', 'gerilim_l2', 'gerilim_l3', 'akim_l1', 'akim_l2', 'akim_l3', 'frekans', 'toplam_enerji'];
    foreach ($numeric as $key) if (isset($row[$key]) && !is_array($row[$key])) { $n = vg_company_number($row[$key]); if (in_array($key, ['guc_faktoru', 'onceki_hafta_guc_faktoru', 'hedef_guc_faktoru'], true) && $n > 1) vg_company_fail(); }
    foreach (['date', 'tarih', 'hafta_baslangic', 'hafta_bitis', 'start_date', 'end_date', 'advance_date', 'bonus_date'] as $key) if (isset($row[$key])) vg_company_date($row[$key]);
    foreach (['baslangic_tarihi', 'bitis_tarihi', 'payment_date'] as $key) if (isset($row[$key])) vg_company_date($row[$key], true);
    if (vg_company_sensitive($table) && (isset($row['month']) || isset($row['year']))) vg_company_period($row['month'] ?? null, $row['year'] ?? null, $row['day'] ?? null);
    if ($table === 'vehicles' && isset($row['year']) && (!is_int($row['year']) || $row['year'] < 1900 || $row['year'] > 2200)) vg_company_fail();
    if ($table === 'bordro_expenses') {
        if (!in_array($row['type'] ?? '', ['Avans', 'Gider', 'Prim'], true)) vg_company_fail();
        foreach (['installment_total', 'installment_current'] as $k) if (isset($row[$k]) && (!is_int($row[$k]) || $row[$k] < 1 || $row[$k] > 120)) vg_company_fail();
    }
    if (isset($row['kullanilan_malzemeler'])) {
        if (!is_array($row['kullanilan_malzemeler']) || count($row['kullanilan_malzemeler']) > 1000) vg_company_fail();
        foreach ($row['kullanilan_malzemeler'] as $material) if (!is_string($material) || !isset($s['tables']['is_takip_malzemeler'][$material])) vg_company_fail(422, 'company_relation', 'İlişkili malzeme bulunamadı.');
    }
    if (isset($row['hafta_baslangic'], $row['hafta_bitis']) && $row['hafta_baslangic'] > $row['hafta_bitis']) vg_company_fail();
    if ($table === 'gorevler' && (!in_array($row['durum'], ['beklemede', 'devam-ediyor', 'tamamlandi', 'iptal'], true) || !in_array($row['oncelik'], ['dusuk', 'orta', 'yuksek', 'acil'], true))) vg_company_fail();
    if ($table === 'proposals' && (!in_array($row['type'], ['yg', 'periodic', 'kesif', 'ges'], true) || !is_array($row['data']) || array_is_list_compat($row['data']))) vg_company_fail();
    $refs = ['fuel_records' => ['vehicle_id' => 'vehicles', 'driver_id' => 'drivers'], 'is_takip_kayitlar' => ['calisan_id' => 'is_takip_calisanlar', 'lokasyon_id' => 'is_takip_lokasyonlar']];
    foreach ($refs[$table] ?? [] as $key => $reference) if (!isset($s['tables'][$reference][$row[$key] ?? ''])) vg_company_fail(422, 'company_relation', 'İlişkili kayıt bulunamadı.');
    if (isset($row['employee_id'])) vg_company_employee($s, strpos($table, 'beyaz_yaka_') === 0 ? 'beyaz_yaka_employees' : 'bordro_employees', $row['employee_id']);
    if (in_array($table, ['bordro_employees', 'beyaz_yaka_employees', 'is_takip_calisanlar'], true) && isset($row['user_id'])) {
        $exists = vg_staff_store(function (array &$staff) use ($row) { return isset($staff['users'][$row['user_id']]); }); if (!$exists) vg_company_fail(422, 'company_staff_relation', 'Gerçek çalışan hesabını seçin.');
    }
    if ($table === 'is_takip_kayitlar') {
        foreach (['baslangic_saat', 'bitis_saat'] as $key) if (!is_string($row[$key]) || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/D', $row[$key])) vg_company_fail();
        if ($row['bitis_saat'] <= $row['baslangic_saat']) vg_company_fail(422, 'company_work_time', 'Bitiş saati başlangıçtan sonra olmalı.');
    }
}
function array_is_list_compat(array $value): bool { return $value !== [] && array_keys($value) === range(0, count($value) - 1); }
function vg_company_unique(string $table): array { $m = ['vehicles' => ['plate'], 'bordro_daily_logs' => ['employee_id', 'day', 'month', 'year'], 'monthly_payroll_summary' => ['employee_id', 'month', 'year'], 'bordro_payment_records' => ['employee_id', 'month', 'year'], 'beyaz_yaka_monthly_payroll' => ['employee_id', 'month', 'year'], 'company_documents' => ['kind', 'record_id']]; return $m[$table] ?? ['id']; }
function vg_company_input_row(string $table, $input): array { if (!is_array($input) || array_is_list_compat($input) || count($input) > 70) vg_company_fail(); foreach ($input as $k => $_) vg_company_field($table, $k); return $input; }
function vg_company_stamp(array $u, array $row, ?array $old = null): array { $time = vg_company_time($old['updated_at'] ?? null); $row['id'] = $old['id'] ?? ($row['id'] ?? vg_company_id()); if (!is_string($row['id']) || !preg_match('/^[A-Za-z0-9_.:-]{1,128}$/D', $row['id'])) vg_company_fail(); $row['created_at'] = $old['created_at'] ?? $time; $row['created_by'] = $old['created_by'] ?? $u['id']; $row['updated_at'] = $time; $row['updated_by'] = $u['id']; return $row; }

function vg_company_query(array &$s, array $u, array $input): array {
    $table = $input['table'] ?? ''; $op = $input['operation'] ?? '';
    if (!is_string($table) || !isset(vg_company_schema()[$table]) || !in_array($op, ['select', 'insert', 'update', 'delete', 'upsert'], true)) vg_company_fail(400, 'company_query', 'Desteklenmeyen şirket işlemi.');
    $filters = vg_company_filters($table, $input['filters'] ?? []);
    vg_company_projection($s, $table, [], $input['select'] ?? '*');
    if ($table === 'users') {
        if ($op === 'update') {
            $row = $input['rows'] ?? []; if (is_array($row) && array_is_list_compat($row) && count($row) === 1) $row = $row[0];
            if (!is_array($row) || array_keys($row) !== ['name'] || !is_string($row['name']) || strlen(trim($row['name'])) < 2 || strlen($row['name']) > 240 || !vg_company_matches(vg_company_user($u), $filters) || !$filters) vg_company_fail(403, '42501', 'Yalnızca kendi adınızı düzenleyebilirsiniz.');
            foreach ($filters as $f) if ($f['field'] !== 'id' || $f['op'] !== 'eq' || $f['value'] !== $u['id']) vg_company_fail(403, '42501');
            $changed = vg_staff_store(function (array &$staff) use ($u, $row) { if (!isset($staff['users'][$u['id']])) vg_company_fail(401, '42501'); $staff['users'][$u['id']]['name'] = trim($row['name']); return vg_company_user($staff['users'][$u['id']]); });
            return vg_company_slice($s, $table, [$changed], $input);
        }
        if ($op !== 'select') vg_company_fail(403, '42501', 'Çalışan hesapları özel çalışan yönetiminden düzenlenir.');
        $rows = array_values(array_filter(vg_company_staff_users($u), function ($r) use ($filters) { return vg_company_matches($r, $filters); })); return vg_company_slice($s, $table, $rows, $input);
    }
    if ($op !== 'select' && vg_company_sensitive($table) && !vg_company_manage($u)) vg_company_fail(403, '42501', 'Bordro yönetim yetkisi gerekiyor.');
    if ($op !== 'select' && in_array($table, ['company_documents', 'bordro_daily_logs', 'beyaz_yaka_monthly_payroll', 'beyaz_yaka_advances'], true)) vg_company_fail(403, '42501', 'Bu kayıt için kontrollü ve sürümlü kayıt işlemini kullanın.');
    if ($table === 'proposals' && !in_array($op, ['select', 'insert', 'delete'], true)) vg_company_fail(403, '42501', 'Kayıtlı teklif değiştirilmez; yeni teklif sürümü oluşturun.');
    if (in_array($op, ['update', 'delete'], true) && !$filters) vg_company_fail(400, 'company_filter_required', 'Değiştirilecek kayıt açıkça seçilmeli.');
    $hidden = vg_company_hidden_fields($u, $table);
    if ($hidden) {
        $used = array_map(function ($f) { return $f['field'] ?? ''; }, $filters);
        foreach ((is_array($input['order'] ?? null) ? $input['order'] : []) as $o) $used[] = is_array($o) ? ($o['field'] ?? '') : '';
        if (array_intersect($used, $hidden)) vg_company_fail(403, '42501', 'Bu alan yalnızca yönetici ve bordro sorumlusu tarafından görülebilir.');
    }
    $selected = []; foreach ($s['tables'][$table] as $id => $r) if (vg_company_visible($s, $u, $table, $r) && vg_company_matches($r, $filters)) $selected[$id] = $r;
    if ($op === 'select') return vg_company_slice($s, $table, vg_company_mask_rows($u, $table, array_values($selected)), $input);
    if ($op === 'delete') {
        foreach ($selected as $row) if (!vg_company_can_delete($u, $table, $row)) vg_company_fail(403, '42501', 'Bu kaydı silme yetkiniz yok. Silme işlemi için şirket yöneticinize başvurun.');
        foreach ($selected as $id => $row) {
            // PHP converts numeric ID keys to integers, while imported relations can be strings.
            $id = (string)$id;
            foreach ($s['tables'] as $otherTable => $records) foreach ($records as $other) {
                foreach (['employee_id', 'vehicle_id', 'driver_id', 'calisan_id', 'lokasyon_id'] as $field) if (vg_company_equal($other[$field] ?? null, $id)) vg_company_conflict('Kayıt geçmiş kayıtlarla ilişkili; silmek yerine pasif yapın.');
                if ($table === 'is_takip_malzemeler' && $otherTable === 'is_takip_kayitlar' && is_array($other['kullanilan_malzemeler'] ?? null) && in_array($id, $other['kullanilan_malzemeler'], true)) vg_company_conflict('Kayıt geçmiş kayıtlarla ilişkili; silmek yerine pasif yapın.');
            }
            unset($s['tables'][$table][$id]); vg_company_audit($s, $u, 'delete:' . $table, $id);
        }
        return !empty($input['returning']) ? vg_company_slice($s, $table, vg_company_mask_rows($u, $table, array_values($selected)), $input) : ['data' => null, 'count' => count($selected)];
    }
    $raw = $input['rows'] ?? null; if ($op === 'update') $rows = [is_array($raw) && array_is_list_compat($raw) && count($raw) === 1 ? $raw[0] : $raw]; else $rows = is_array($raw) && array_is_list_compat($raw) ? $raw : [$raw];
    if (!$rows || count($rows) > 5000) vg_company_fail(); $affected = [];
    foreach ($rows as $item) {
        $row = vg_company_input_row($table, $item); $targets = $op === 'update' ? $selected : [null];
        if ($op === 'upsert') {
            $conflict = $input['onConflict'] ?? 'id'; $keys = is_string($conflict) ? explode(',', str_replace(' ', '', $conflict)) : [];
            if ($keys !== ['id'] && $keys !== vg_company_unique($table)) vg_company_fail(400, 'company_conflict_key');
            $targets = [null]; foreach ($s['tables'][$table] as $existing) { $same = true; foreach ($keys as $key) if (!array_key_exists($key, $row) || !vg_company_equal($row[$key], $existing[$key] ?? null)) $same = false; if ($same) { if (!vg_company_visible($s, $u, $table, $existing)) vg_company_fail(403, '42501', 'Bu kayda erişim yetkiniz yok.'); $targets = [$existing]; break; } }
        }
        foreach ($targets as $old) {
            $merged = $old ? array_merge($old, $row) : array_merge(vg_company_defaults($table), $row);
            if ($old && isset($row['id']) && $row['id'] !== $old['id']) vg_company_fail(400, 'company_id_immutable');
            if ($table === 'urun_takip') $merged['user_email'] = $old['user_email'] ?? $u['email'];
            if ($table === 'activity_logs') { $merged['user_id'] = $u['id']; $merged['user_email'] = $u['email']; $merged['ip_address'] = null; }
            if ($table === 'vehicles') $merged['plate'] = strtoupper(trim((string)$merged['plate']));
            if ($table === 'is_takip_kayitlar') { $start = explode(':', (string)$merged['baslangic_saat']); $end = explode(':', (string)$merged['bitis_saat']); $merged['toplam_sure'] = round(((int)($end[0] ?? 0) * 60 + (int)($end[1] ?? 0) - (int)($start[0] ?? 0) * 60 - (int)($start[1] ?? 0)) / 60, 2); }
            if ($table === 'bordro_payment_records') $merged['balance'] = round(vg_company_number($merged['calculated_amount']) - vg_company_number($merged['paid_amount'] ?? 0), 2);
            $merged = vg_company_stamp($u, $merged, $old); vg_company_validate($s, $table, $merged);
            foreach ($s['tables'][$table] as $existing) if ($existing['id'] !== $merged['id']) { $same = true; foreach (vg_company_unique($table) as $key) if (!array_key_exists($key, $merged) || !vg_company_equal($merged[$key], $existing[$key] ?? null)) $same = false; if ($same) vg_company_fail(409, '23505', 'Bu kayıt zaten var. Güncel listeyi yükleyin.'); }
            if (!$old && isset($s['tables'][$table][$merged['id']])) vg_company_fail(409, '23505');
            if ($table === 'proposals') {
                $s['sequence']++; $ref = 'VG-' . (new DateTimeImmutable('now', new DateTimeZone('Europe/Istanbul')))->format('Y') . '-' . strtoupper($merged['type']) . '-' . str_pad((string)$s['sequence'], 6, '0', STR_PAD_LEFT);
                $merged['reference_no'] = $ref; $merged['data']['referenceNo'] = $ref;
                if (isset($merged['data']['calculated']) && is_array($merged['data']['calculated'])) $merged['data']['calculated']['refNo'] = $ref;
                if (isset($merged['data']['componentSnapshot']['teklifForm'])) $merged['data']['componentSnapshot']['teklifForm']['teklifNo'] = $ref;
                foreach (['reportHtml'] as $key) if (isset($merged['data'][$key]) && is_string($merged['data'][$key])) $merged['data'][$key] = preg_replace('/(<span[^>]*data-vg-reference[^>]*>)[^<]*(<\/span>)/i', '${1}' . $ref . '${2}', $merged['data'][$key]);
            }
            if (count($s['tables'][$table]) >= 50000 && !$old) vg_company_fail(409, 'company_capacity');
            $s['tables'][$table][$merged['id']] = $merged; $affected[] = $merged; vg_company_audit($s, $u, $op . ':' . $table, $merged['id']);
        }
    }
    return !empty($input['returning']) ? vg_company_slice($s, $table, vg_company_mask_rows($u, $table, $affected), $input) : ['data' => null, 'count' => count($affected)];
}

function vg_company_payroll_default(array $employee, string $id, int $month, int $year): array {
    $r = ['employee_id' => $id, 'month' => $month, 'year' => $year, 'logs' => [], 'expenses' => [], 'is_paid' => false, 'notes' => 'İç ödeme kaydı; vergi ve SGK tutarları onaylanmış bordrodan girilir.'];
    foreach (['base_salary', 'overtime_pay', 'bonus', 'meal_allowance', 'transport_allowance', 'other_earnings', 'advance_deduction', 'sgk_employee', 'unemployment_employee', 'income_tax', 'stamp_tax', 'other_deductions', 'net_payment', 'sgk_employer', 'unemployment_employer', 'total_employer_cost', 'worked_days', 'total_days', 'paid_leave_days', 'unpaid_leave_days', 'sick_leave_days'] as $key) $r[$key] = 0;
    $r['base_salary'] = vg_company_number($employee['gross_salary'] ?? $employee['monthly_salary']); $r['net_payment'] = $r['base_salary']; $r['total_employer_cost'] = $r['base_salary']; return $r;
}
function vg_company_payroll_find(array $s, string $table, string $employee, int $month, int $year, ?int $day = null): ?array { foreach ($s['tables'][$table] as $r) if ($r['employee_id'] === $employee && $r['month'] === $month && $r['year'] === $year && ($day === null || $r['day'] === $day)) return $r; return null; }
function vg_company_payroll_totals(array $r): array {
    $earn = 0; foreach (['base_salary', 'overtime_pay', 'bonus', 'meal_allowance', 'transport_allowance', 'other_earnings'] as $k) $earn += vg_company_number($r[$k] ?? 0);
    $deduct = 0; foreach (['advance_deduction', 'sgk_employee', 'unemployment_employee', 'income_tax', 'stamp_tax', 'other_deductions'] as $k) $deduct += vg_company_number($r[$k] ?? 0);
    $r['net_payment'] = round($earn - $deduct, 2); $r['total_employer_cost'] = round($earn + vg_company_number($r['sgk_employer'] ?? 0) + vg_company_number($r['unemployment_employer'] ?? 0), 2); return $r;
}
function vg_company_other_advance_month(array $s, array $advance, ?string $origin): bool {
    $start = (int)substr($advance['advance_date'], 0, 4) * 12 + (int)substr($advance['advance_date'], 5, 2) - 1;
    foreach ($s['tables']['beyaz_yaka_monthly_payroll'] as $r) { $period = $r['year'] * 12 + $r['month']; if ($r['employee_id'] === $advance['employee_id'] && $r['id'] !== $origin && $period >= $start && $period < $start + $advance['installment_count'] && ($r['advance_deduction'] ?? 0) > 0) return true; }
    return false;
}
function vg_company_rpc(array &$s, array $u, string $name, array $a) {
    if ($name === 'app_portal_identity') return vg_company_user($u);
    if (in_array($name, ['app_onayli', 'app_admin', 'app_portal_bordro'], true)) return $name === 'app_onayli' || ($name === 'app_admin' ? $u['role'] === 'admin' : vg_company_manage($u));
    if ($name === 'app_change_own_password') {
        vg_staff_rate('company-password-user', $u['id'], 5); $password = vg_staff_password($a['p_new'] ?? null); $old = $a['p_old'] ?? '';
        return vg_staff_store(function (array &$staff) use ($u, $old, $password) { $record = $staff['users'][$u['id']] ?? null; if (!$record || !is_string($old) || !password_verify($old, $record['password'])) vg_company_fail(422, 'staff_wrong_password', 'Mevcut şifre doğrulanamadı.'); $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]); if (!is_string($hash)) throw new RuntimeException('company password hash'); $staff['users'][$u['id']]['password'] = $hash; $staff['users'][$u['id']]['epoch']++; vg_staff_audit($staff, 'password_changed', $u['id']); unset($_SESSION['staff'], $_SESSION['staff_pending']); vg_staff_rotate(); return null; });
    }
    if (in_array($name, ['app_portal_account_audit', 'app_portal_invite', 'app_portal_recover_mfa', 'app_portal_update_user'], true)) {
        if ($u['role'] !== 'admin') vg_company_fail(403, '42501', 'Şirket yöneticisi yetkisi gerekiyor.');
        return vg_staff_store(function (array &$staff) use ($u, $name, $a) {
            $actor = vg_staff_user_in($staff); if (!$actor || $actor['id'] !== $u['id'] || $actor['role'] !== 'admin') vg_company_fail(403, '42501', 'Şirket yöneticisi yetkisi gerekiyor.');
            if ($name === 'app_portal_account_audit') {
                $out = []; foreach (array_reverse(array_slice($staff['audit'], -100)) as $event) $out[] = ['created_at' => $event['at'], 'actor_id' => $event['actor'], 'target_id' => $event['target'], 'event' => $event['event']]; return $out;
            }
            $id = $a['p_user_id'] ?? null;
            if ($id !== null && (!is_string($id) || !isset($staff['users'][$id]))) vg_company_fail(404, 'company_staff_missing', 'Çalışan hesabı bulunamadı.');
            if ($name === 'app_portal_invite') {
                $role = vg_company_staff_role($a['p_role'] ?? 'employee', $a['p_bordro'] ?? false);
                $email = is_string($a['p_email'] ?? null) ? strtolower(trim($a['p_email'])) : '';
                if ($id !== null && $staff['users'][$id]['email'] !== $email) vg_company_fail(422, 'company_staff_identity', 'Çalışan kimliği ile e-posta eşleşmiyor.');
                return vg_staff_make_invite($staff, ['name' => $a['p_name'] ?? '', 'email' => $email, 'role' => $role]);
            }
            if ($id === null) vg_company_fail(422, 'company_staff_identity', 'Çalışan hesabını seçin.');
            $record = $staff['users'][$id];
            if ($name === 'app_portal_recover_mfa') {
                if ($id === $actor['id']) vg_company_fail(409, 'company_self_recovery', 'Kendi doğrulayıcınız için başka bir yöneticiye başvurun.');
                vg_staff_keep_admin($staff, $id);
                $hasInvite = false; foreach ($staff['invites'] as $inv) if ($inv['userId'] === $id && $inv['expires'] > time() && $inv['epoch'] === $record['epoch']) $hasInvite = true;
                if ($record['status'] !== 'invited' || !$hasInvite) vg_company_fail(409, 'company_recovery_requires_invite', 'Önce çalışanın yeni etkinleştirme davetini oluşturup mevcut erişimini kapatın.');
                $record['epoch']++; $record['mfaSecret'] = null; $record['lastTotpStep'] = -1; $record['password'] = null;
                foreach ($staff['invites'] as &$inv) if ($inv['userId'] === $id) $inv['epoch'] = $record['epoch']; unset($inv);
                $staff['users'][$id] = $record; vg_staff_audit($staff, 'mfa_recovered', $id); return null;
            }
            $newName = $a['p_name'] ?? null; $role = vg_company_staff_role($a['p_role'] ?? null, $a['p_bordro'] ?? false); $approved = $a['p_approved'] ?? null;
            if (!is_string($newName) || !preg_match('//u', $newName) || strpos($newName, "\0") !== false || strlen(trim($newName)) < 2 || strlen($newName) > 240 || !is_bool($approved)) vg_company_fail();
            if ($id === $actor['id'] && (!$approved || $role !== 'admin')) vg_company_fail(409, 'company_self_role', 'Kendi yönetici yetkinizi veya erişiminizi kaldıramazsınız.');
            if ($approved && (empty($record['password']) || empty($record['mfaSecret']) || !in_array($record['status'], ['active', 'disabled'], true))) vg_company_fail(409, 'company_activation_required', 'Çalışan önce özel davetle şifresini ve doğrulayıcısını kurmalı.');
            if (!$approved || $role !== 'admin') vg_staff_keep_admin($staff, $id);
            $status = $approved ? 'active' : 'disabled'; $changed = $record['name'] !== trim($newName) || $record['role'] !== $role || $record['status'] !== $status;
            $record['name'] = trim($newName); $record['role'] = $role; $record['status'] = $status;
            if ($changed) $record['epoch']++;
            if (!$approved) foreach ($staff['invites'] as $hash => $inv) if ($inv['userId'] === $id) unset($staff['invites'][$hash]);
            $staff['users'][$id] = $record; vg_staff_audit($staff, 'account_updated', $id); return vg_company_user($record);
        });
    }
    if ($name === 'app_company_document_save' || $name === 'app_company_document_delete') {
        $kind = $a['p_kind'] ?? ''; $key = $a['p_record_id'] ?? ''; $expected = $a['p_expected_revision'] ?? null;
        if (!in_array($kind, ['kesif_teklif', 'osos_rapor', 'osos_fabrika', 'periyodik_rapor', 'teklif', 'yg_teklif'], true) || !is_string($key) || !preg_match('/^[A-Za-z0-9_:.-]{1,128}$/D', $key) || ($expected !== null && (!is_int($expected) || $expected < 1))) vg_company_fail();
        $old = null; foreach ($s['tables']['company_documents'] as $r) if ($r['kind'] === $kind && $r['record_id'] === $key) { $old = $r; break; }
        if (($old && $old['revision'] !== $expected) || (!$old && $expected !== null) || ($name === 'app_company_document_delete' && !$old)) vg_company_conflict();
        // Issued quotes and reports: admin, or the employee who created the record (same rule as vg_company_can_delete).
        if ($name === 'app_company_document_delete' && $u['role'] !== 'admin' && ($old['created_by'] ?? null) !== $u['id']) vg_company_fail(403, '42501', 'Bu belgeyi yalnızca oluşturan çalışan veya yönetici silebilir.');
        if ($name === 'app_company_document_delete') { unset($s['tables']['company_documents'][$old['id']]); vg_company_audit($s, $u, 'document_deleted', $key); return null; }
        $payload = $a['p_payload'] ?? null; if (!is_array($payload) || array_is_list_compat($payload) || strlen(vg_json_encode($payload)) > 2097152) vg_company_fail();
        $row = vg_company_stamp($u, ['kind' => $kind, 'record_id' => $key, 'payload' => $payload, 'revision' => $old ? $old['revision'] + 1 : 1], $old); $s['tables']['company_documents'][$row['id']] = $row; vg_company_audit($s, $u, 'document_saved', $key); return $row;
    }
    $payrollNames = ['app_bordro_daily_log_save', 'app_beyaz_yaka_payroll_save', 'app_beyaz_yaka_expense_save', 'app_beyaz_yaka_expense_delete', 'app_beyaz_yaka_advance_delete'];
    if (!in_array($name, $payrollNames, true)) vg_company_fail(404, 'company_rpc_unknown', 'Bu şirket işlemi desteklenmiyor.');
    if (!vg_company_manage($u)) vg_company_fail(403, '42501', 'Bordro yönetim yetkisi gerekiyor.');
    if ($name === 'app_beyaz_yaka_advance_delete') {
        $id = $a['p_advance_id'] ?? ''; $advance = is_string($id) ? ($s['tables']['beyaz_yaka_advances'][$id] ?? null) : null; if (!$advance) vg_company_fail(404, 'company_advance_missing');
        $origin = null; foreach ($s['tables']['beyaz_yaka_monthly_payroll'] as $r) if ($r['employee_id'] === $advance['employee_id']) foreach ($r['expenses'] ?? [] as $e) if ($e['id'] === $id) { $origin = $r; break 2; }
        if (vg_company_other_advance_month($s, $advance, $origin['id'] ?? null)) vg_company_conflict('Avans başka bir kayıtlı dönemde kullanılıyor; önce ilgili dönemleri düzeltin.');
        $updated = null; if ($origin) $updated = vg_company_rpc($s, $u, 'app_beyaz_yaka_expense_delete', ['p_employee_id' => $origin['employee_id'], 'p_month' => $origin['month'], 'p_year' => $origin['year'], 'p_expense_id' => $id]); else unset($s['tables']['beyaz_yaka_advances'][$id]); return ['removed' => true, 'payroll' => $updated];
    }
    $id = $a['p_employee_id'] ?? null; $month = $a['p_month'] ?? null; $year = $a['p_year'] ?? null; vg_company_period($month, $year, $name === 'app_bordro_daily_log_save' ? ($a['p_day'] ?? 0) : null);
    $employee = vg_company_employee($s, $name === 'app_bordro_daily_log_save' ? 'bordro_employees' : 'beyaz_yaka_employees', $id);
    if ($name === 'app_bordro_daily_log_save') {
        $log = $a['p_log'] ?? null; if (!is_array($log) || array_diff(array_keys($log), ['type', 'start_time', 'end_time', 'overtime_hours', 'description'])) vg_company_fail();
        if (!in_array($log['type'] ?? '', ['Normal', 'Pazar', 'Resmi Tatil', 'Raporlu', 'İzinli', 'Gelmedi'], true)) vg_company_fail();
        foreach (['start_time', 'end_time'] as $key) { $log[$key] = $log[$key] ?? ''; if (!is_string($log[$key]) || ($log[$key] !== '' && !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/D', $log[$key]))) vg_company_fail(); }
        $log['overtime_hours'] = vg_company_number($log['overtime_hours'] ?? null); if ($log['overtime_hours'] > 24 || ($log['start_time'] && $log['end_time'] && $log['end_time'] < $log['start_time'])) vg_company_fail();
        $log['description'] = $log['description'] ?? ''; if (!is_string($log['description']) || strlen($log['description']) > 10000) vg_company_fail();
        $old = vg_company_payroll_find($s, 'bordro_daily_logs', $id, $month, $year, $a['p_day']); $expected = $a['p_expected_updated_at'] ?? null;
        if ($old && $old['updated_at'] !== $expected) { $same = true; foreach ($log as $key => $v) if (!vg_company_equal($v, $old[$key] ?? null)) $same = false; if ($same) return $old; vg_company_conflict(); }
        if (!$old && $expected !== null) vg_company_conflict();
        $row = vg_company_stamp($u, ['employee_id' => $id, 'day' => $a['p_day'], 'month' => $month, 'year' => $year] + $log, $old); $row['last_modified_by'] = $u['id']; $row['last_modified_at'] = $row['updated_at']; $s['tables']['bordro_daily_logs'][$row['id']] = $row; vg_company_audit($s, $u, 'daily_log_saved', $row['id']); return $row;
    }
    $old = vg_company_payroll_find($s, 'beyaz_yaka_monthly_payroll', $id, $month, $year); $row = $old ?? vg_company_payroll_default($employee, $id, $month, $year);
    if ($name === 'app_beyaz_yaka_payroll_save') {
        $payload = $a['p_payload'] ?? null; $expected = $a['p_expected_updated_at'] ?? null;
        if (($old && $old['updated_at'] !== $expected) || (!$old && $expected !== null)) vg_company_conflict();
        $allowed = array_diff(vg_company_schema()['beyaz_yaka_monthly_payroll'], ['id', 'employee_id', 'month', 'year', 'expenses', 'created_at', 'updated_at', 'created_by', 'updated_by']);
        if (!is_array($payload) || array_is_list_compat($payload) || array_diff(array_keys($payload), $allowed) || strlen(vg_json_encode($payload)) > 1048576) vg_company_fail();
        foreach ($payload as $key => $value) {
            if ($key === 'logs') { if (!is_array($value) || count($value) > 31) vg_company_fail(); foreach ($value as $day => $log) if (!ctype_digit((string)$day) || !checkdate($month + 1, (int)$day, $year) || !is_array($log) || strlen(vg_json_encode($log)) > 12000) vg_company_fail(); }
            elseif (in_array($key, ['payment_date', 'payment_method', 'notes', 'is_paid'], true)) { if ($key === 'payment_date') $value = vg_company_date($value, true); elseif ($key === 'is_paid' && !is_bool($value)) vg_company_fail(); elseif (in_array($key, ['payment_method', 'notes'], true) && $value !== null && !is_string($value)) vg_company_fail(); }
            else { $value = vg_company_number($value, !in_array($key, ['net_payment'], true)); if (in_array($key, ['worked_days', 'total_days', 'paid_leave_days', 'unpaid_leave_days', 'sick_leave_days'], true) && ($value > 31 || (int)$value != $value)) vg_company_fail(); }
            $row[$key] = $value;
        }
        if (!$old && empty($employee['active'])) vg_company_conflict('Çalışan pasif; yeni bordro oluşturulamaz.');
        $row = vg_company_payroll_totals($row);
    } elseif ($name === 'app_beyaz_yaka_expense_save') {
        $type = $a['p_type'] ?? ''; $amount = vg_company_number($a['p_amount'] ?? null); $date = vg_company_date($a['p_date'] ?? null); $parts = $a['p_installments'] ?? 1; $request = $a['p_request_id'] ?? '';
        if (!in_array($type, ['Avans', 'Gider', 'Prim'], true) || $amount <= 0 || abs($amount * 100 - round($amount * 100)) > 0.000001 || !is_int($parts) || $parts < 1 || $parts > 120 || !is_string($request) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iD', $request) || !is_string($a['p_description'] ?? '')) vg_company_fail();
        foreach ($row['expenses'] as $existing) if ($existing['id'] === $request) { if ($existing['type'] === $type && $existing['amount'] == $amount && $existing['date'] === $date && $existing['installment_total'] === $parts && $existing['description'] === ($a['p_description'] ?? '')) return $row; vg_company_fail(409, 'company_request_reused', 'İstek kimliği farklı bir kayıtla kullanılmış.'); }
        $offset = $year * 12 + $month - ((int)substr($date, 0, 4) * 12 + (int)substr($date, 5, 2) - 1); $cents = (int)round($amount * 100); $quotient = intdiv($cents, $parts); $remainder = $cents % $parts;
        $applied = $type === 'Avans' ? ($offset < 0 || $offset >= $parts ? 0 : ($quotient + ($offset < $remainder ? 1 : 0)) / 100) : $amount;
        if ($type === 'Avans') { if (isset($s['tables']['beyaz_yaka_advances'][$request])) vg_company_fail(409, 'company_request_reused'); $advance = vg_company_stamp($u, ['id' => $request, 'employee_id' => $id, 'amount' => $amount, 'advance_date' => $date, 'description' => $a['p_description'] ?? '', 'installment_count' => $parts, 'remaining_installments' => $parts, 'monthly_deduction' => $quotient / 100, 'is_fully_paid' => false]); $s['tables']['beyaz_yaka_advances'][$request] = $advance; $row['advance_deduction'] += $applied; }
        elseif ($type === 'Prim') $row['bonus'] += $applied; else $row['other_deductions'] += $applied;
        $row['expenses'][] = ['id' => $request, 'type' => $type, 'amount' => $amount, 'date' => $date, 'description' => $a['p_description'] ?? '', 'installment_total' => $parts, 'installment_current' => max(1, $offset + 1), 'applied_amount' => $applied]; $row = vg_company_payroll_totals($row);
    } elseif ($name === 'app_beyaz_yaka_expense_delete') {
        $key = $a['p_expense_id'] ?? ''; $expense = null; foreach ($row['expenses'] as $e) if ($e['id'] === $key) { $expense = $e; break; } if (!$old || !$expense) vg_company_fail(404, 'company_expense_missing');
        if ($expense['type'] === 'Avans') { $advance = $s['tables']['beyaz_yaka_advances'][$key] ?? null; if ($advance && vg_company_other_advance_month($s, $advance, $row['id'])) vg_company_conflict('Avans başka bir kayıtlı dönemde kullanılıyor; önce ilgili dönemleri düzeltin.'); unset($s['tables']['beyaz_yaka_advances'][$key]); $row['advance_deduction'] = max(0, $row['advance_deduction'] - $expense['applied_amount']); }
        elseif ($expense['type'] === 'Prim') $row['bonus'] = max(0, $row['bonus'] - $expense['applied_amount']); else $row['other_deductions'] = max(0, $row['other_deductions'] - $expense['applied_amount']);
        $row['expenses'] = array_values(array_filter($row['expenses'], function ($e) use ($key) { return $e['id'] !== $key; })); $row = vg_company_payroll_totals($row);
    }
    $row = vg_company_stamp($u, $row, $old); $s['tables']['beyaz_yaka_monthly_payroll'][$row['id']] = $row; vg_company_audit($s, $u, $name, $row['id']); return $row;
}

function vg_company_staff_role($role, $bordro): string {
    if (!is_string($role) || !in_array($role, ['user', 'employee', 'payroll', 'admin'], true) || !is_bool($bordro)) vg_company_fail(422, 'company_staff_role', 'Çalışan rolü geçersiz.');
    return $role === 'admin' ? 'admin' : (($role === 'payroll' || $bordro) ? 'payroll' : 'employee');
}

function vg_company_run(): void {
    ob_start();
    try {
        vg_check_fetch_site(); vg_staff_session_start(); $u = vg_staff_require_user(); $action = vg_action(); $method = vg_method();
        if ($action === 'health') {
            if ($method !== 'GET') vg_company_fail(405, 'company_method');
            $remote = vg_company_ubuntu_config();
            if ($remote !== null) vg_company_ubuntu_call($remote, ['op' => 'health', 'actor' => ['id' => $u['id'], 'role' => $u['role']]]);
            $out = ['data' => ['online' => true, 'dataSource' => $remote === null ? 'local' : 'ubuntu']];
        } elseif ($action === 'bootstrap') {
            if ($method !== 'GET') vg_company_fail(405, 'company_method');
            $out = vg_company_store(function (array &$s, array $actor) { return ['data' => ['user' => vg_company_user($actor), 'storage' => $s['storage'][$actor['id']] ?? [], 'catalog' => vg_company_catalog(), 'capabilities' => ['private' => true, 'operations' => true, 'payrollManage' => vg_company_manage($actor), 'employeeAdmin' => $actor['role'] === 'admin', 'dataSource' => $GLOBALS['vg_company_data_source'] ?? 'local', 'liveOSOS' => false, 'externalAI' => false]]]; });
        } else {
            if (!in_array($action, ['query', 'rpc', 'storage'], true)) vg_company_fail(404, 'company_action'); if ($method !== 'POST') vg_company_fail(405, 'company_method');
            vg_staff_write_guard(); $input = vg_json_body(2097152); vg_staff_rate('company-request-user', $u['id'], 1200, 900);
            $handler = function (array &$s, array $actor) use ($action, $input) {
                if ($action === 'query') return vg_company_query($s, $actor, $input);
                if ($action === 'rpc') { if (!is_string($input['name'] ?? null) || !is_array($input['args'] ?? [])) vg_company_fail(); return ['data' => vg_company_rpc($s, $actor, $input['name'], $input['args'] ?? [])]; }
                $key = $input['key'] ?? ''; $value = $input['value'] ?? null;
                if (!is_string($key) || !preg_match('/^[A-Za-z0-9_.:-]{1,160}$/D', $key) || ($value !== null && (!is_string($value) || strlen($value) > 2097152))) vg_company_fail(400, 'company_storage');
                if (!isset($s['storage'][$actor['id']])) $s['storage'][$actor['id']] = []; if ($value === null) unset($s['storage'][$actor['id']][$key]); else $s['storage'][$actor['id']][$key] = $value;
                if (count($s['storage'][$actor['id']]) > 2000 || strlen(vg_json_encode($s['storage'][$actor['id']])) > 16777216) vg_company_fail(409, 'company_storage_capacity'); return ['data' => null];
            };
            $native = ($action === 'query' && ($input['table'] ?? null) === 'users') || ($action === 'rpc' && in_array($input['name'] ?? null, ['app_portal_identity','app_onayli','app_admin','app_portal_bordro','app_portal_account_audit','app_portal_invite','app_portal_recover_mfa','app_portal_update_user','app_change_own_password'], true));
            if ($native) { $empty = ['version' => 1, 'tables' => [], 'storage' => [], 'sequence' => 0, 'audit' => []]; $out = $handler($empty, vg_staff_require_user()); }
            else $out = vg_company_store($handler);
        }
        vg_discard_output(); vg_common_headers(200, []); echo vg_json_encode(vg_company_wire(['api' => 'vg-company/1', 'ok' => true, 'csrf' => vg_staff_csrf()] + $out));
    } catch (VgHttpError $e) { vg_discard_output(); vg_common_headers($e->status, $e->headers); echo vg_json_encode(['api' => 'vg-company/1', 'ok' => false, 'error' => $e->errCode, 'message' => $e->getMessage()] + $e->extra); }
    catch (Throwable $e) { error_log('VoltGuard company: request failed (' . get_class($e) . ')'); vg_discard_output(); vg_common_headers(503, []); echo vg_json_encode(['api' => 'vg-company/1', 'ok' => false, 'error' => 'company_unavailable', 'message' => 'Şirket çalışma alanı şu anda kullanılamıyor.']); }
    finally { if (session_status() === PHP_SESSION_ACTIVE) session_write_close(); }
}
