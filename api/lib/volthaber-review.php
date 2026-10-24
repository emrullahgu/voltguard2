<?php
/*
 * VoltHaber yayin akisi: Taslak -> Kaynak kontrolu -> Teknik kontrol -> Yayin onayi -> Yayin.
 * Her kontrol editorun adi, zamani, kanit notu ve icerik ozeti (sha256) ile kaydedilir. Icerik degisirse kontroller
 * gecersiz olur ve kayit taslaga doner. Yayindaki yazi duzeltilirken son onayli surum (liveCopy) yayinda kalir.
 * Otomatik taranan kayitlar ve eksik/celiskili bilgisi olan kayitlar bu akisi tamamlamadan yayimlanamaz.
 * volthaber.php tarafindan yuklenir.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VH_IMPACT_MIN = 80;
const VH_COMMENTARY_MIN = 80;
const VH_NOTE_MIN = 10;
const VH_TERMS_MAX_AGE = 31536000;      // kaynak kosullari en gec 1 yilda bir yeniden kontrol edilir

function vh_stages(): array
{
    return [
        'draft' => 'Taslak',
        'source_check' => 'Kaynak kontrolü',
        'tech_check' => 'Teknik kontrol',
        'approval' => 'Yayın onayı',
        'approved' => 'Onaylandı',
        'legacy' => 'Akış öncesi yayın',
    ];
}

/** Kontrol adimi => [beklenen asama, sonraki asama, ad, zorunlu onay kutulari]. */
function vh_review_steps(): array
{
    return [
        'source' => ['source_check', 'tech_check', 'Kaynak kontrolü', [
            'sourcesOpened' => 'Tüm kaynak bağlantıları açıldı; özet ve tarihler kaynakla karşılaştırıldı.',
            'termsChecked' => 'Her kaynağın içerik ve görsel kullanım koşulu kontrol edildi (RSS erişimi veya kaynak göstermek tek başına izin sayılmadı).',
            'noCopiedText' => 'Kaynaktan tam metin, uzun alıntı veya izinsiz görsel kopyalanmadı.',
            'imagesLicensed' => 'Görsel yok ya da lisansı doğrulandı ve kaydedildi.',
        ]],
        'technical' => ['tech_check', 'approval', 'Teknik kontrol', [
            'claimsVerified' => 'Teknik ifadeler, rakamlar ve tarihler kaynakla tutarlı; çelişki yok.',
            'impactReviewed' => '"Fabrikalar ve işletmeler için anlamı" bölümü doğru ve abartısız.',
            'commentarySeparated' => 'VoltGuard yorumu kaynak bilgisinden açıkça ayrılmış.',
            'linksChecked' => 'İlgili hizmet ve simülasyon bağlantıları konuyla gerçekten ilgili.',
        ]],
        'approval' => ['approval', 'approved', 'Yayın onayı', [
            'readyToPublish' => 'İçeriği son hâliyle okudum; yayımlanmasını onaylıyorum.',
        ]],
    ];
}

function vh_normalize_review(array $r, string $status): array
{
    $stage = (string)($r['stage'] ?? '');
    if (!isset(vh_stages()[$stage])) {
        // Akistan once kaydedilmis veri: yayindakiler "akis oncesi yayin" olarak acikca isaretlenir.
        $stage = in_array($status, ['published', 'scheduled'], true) ? 'legacy' : 'draft';
    }
    $checks = [];
    foreach (array_keys(vh_review_steps()) as $step) {
        $c = $r['checks'][$step] ?? null;
        $checks[$step] = is_array($c) ? [
            'byId' => is_string($c['byId'] ?? null) ? $c['byId'] : null, 'by' => (string)($c['by'] ?? ''), 'at' => (int)($c['at'] ?? 0),
            'note' => (string)($c['note'] ?? ''), 'hash' => (string)($c['hash'] ?? ''),
            'checklist' => array_values(array_filter(is_array($c['checklist'] ?? null) ? $c['checklist'] : [], 'is_string')),
        ] : null;
    }
    $hold = is_array($r['hold'] ?? null) ? [
        'kind' => ($r['hold']['kind'] ?? '') === 'celiskili' ? 'celiskili' : 'eksik', 'reason' => (string)($r['hold']['reason'] ?? ''),
        'by' => (string)($r['hold']['by'] ?? ''), 'at' => (int)($r['hold']['at'] ?? 0),
    ] : null;
    $history = array_values(array_filter(is_array($r['history'] ?? null) ? $r['history'] : [], 'is_array'));
    return ['stage' => $stage, 'checks' => $checks, 'hold' => $hold, 'history' => array_slice($history, -60)];
}

/** Kontrollerin kapsadigi icerik ozeti: bu alanlardan biri degisirse onaylar gecersiz olur. */
function vh_content_hash(array $a): string
{
    $pick = [];
    foreach (['title', 'summary', 'body', 'impact', 'commentary', 'category', 'type', 'tags', 'source', 'extraSources', 'eventDate', 'image', 'related'] as $k) {
        $pick[$k] = $a[$k] ?? null;
    }
    return hash('sha256', (string)json_encode($pick, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/** Okura gosterilen alanlar; yayindaki yazi duzeltilirken onayli surum bu alanlarla yayinda kalir. */
function vh_live_fields(): array
{
    return ['title', 'summary', 'body', 'bodyHtml', 'impact', 'impactHtml', 'commentary', 'commentaryHtml', 'category', 'type', 'tags',
        'source', 'extraSources', 'eventDate', 'image', 'related', 'seo', 'review', 'revisedAt', 'revisionNote', 'editor'];
}

function vh_live_snapshot(array $a): array
{
    $snap = [];
    foreach (vh_live_fields() as $k) {
        $snap[$k] = $a[$k];
    }
    return $snap;
}

/** Herkese acik gorunum: bekleyen bir duzeltme varsa son onayli surum. */
function vh_live_view(array $a): array
{
    if (is_array($a['liveCopy'])) {
        foreach (vh_live_fields() as $k) {
            if (array_key_exists($k, $a['liveCopy'])) {
                $a[$k] = $k === 'review' ? vh_normalize_review((array)$a['liveCopy'][$k], 'published') : $a['liveCopy'][$k];
            }
        }
    }
    $a['liveCopy'] = null;
    return $a;
}

function vh_history(array &$a, array $user, string $action, string $note = ''): void
{
    $a['review']['history'][] = ['at' => vg_now(), 'by' => (string)$user['name'], 'action' => $action, 'stage' => $a['review']['stage'], 'note' => $note];
    $a['review']['history'] = array_slice($a['review']['history'], -60);
}

function vh_reset_review(array &$a): void
{
    $a['review']['stage'] = 'draft';
    foreach (array_keys(vh_review_steps()) as $step) {
        $a['review']['checks'][$step] = null;
    }
}

/** Birincil + ek kaynaklar. */
function vh_all_sources(array $a): array
{
    return array_values(array_filter(array_merge($a['source'] ? [$a['source']] : [], $a['extraSources']), function ($s) {
        return $s['url'] !== '' || $s['name'] !== '';
    }));
}

/** Okura gosterilen editor/onay durumu (yalnizca editor adi ve tarih). */
function vh_public_review(array $a): array
{
    $steps = [];
    foreach (vh_review_steps() as $step => $def) {
        $c = $a['review']['checks'][$step];
        $steps[] = ['step' => $step, 'name' => $def[2], 'by' => $c ? $c['by'] : null, 'at' => $c && $c['at'] ? vg_iso($c['at']) : null];
    }
    return ['stage' => $a['review']['stage'], 'stageName' => vh_stages()[$a['review']['stage']] ?? '', 'steps' => $steps];
}

/**
 * Editor kaydettikten sonra: icerik degistiyse kontroller sifirlanir. Yayindaki yazi icin son onayli surum
 * liveCopy'de yayinda kalir; zamani gelmemis planli yazi taslaga doner (onayi gecersiz oldu).
 */
function vh_after_content_save(array &$a, ?array $existing, array $user): void
{
    if ($existing === null) {
        vh_history($a, $user, 'create');
        return;
    }
    if (vh_content_hash($a) === vh_content_hash($existing)) {
        return;
    }
    $now = vg_now();
    $wasLive = vh_is_live($existing, $now);
    if ($wasLive && $existing['liveCopy'] === null) {
        $a['liveCopy'] = vh_live_snapshot($existing);
    }
    if ($existing['status'] === 'scheduled') {
        if ($wasLive) {
            $a['status'] = 'published';
            $a['publishedAt'] = $existing['publishAt'];
        } else {
            $a['status'] = 'draft';
        }
        $a['publishAt'] = null;
    }
    $before = $a['review']['stage'];
    vh_reset_review($a);
    vh_history($a, $user, 'content_changed', $before !== 'draft' ? 'İçerik değişti; "' . (vh_stages()[$before] ?? $before) . '" aşamasındaki kontroller geçersiz oldu.' : '');
}

/* ------------------------------------------------------------------ kurallar */

/** Kontrole gonderilebilmek icin gereken asgari icerik. Hata: 422 not_complete. */
function vh_assert_complete(array $a): void
{
    $errors = [];
    if (vg_strlen($a['summary']) < VH_SUMMARY_MIN) {
        $errors['summary'] = 'Kaynaklara dayalı özet en az ' . VH_SUMMARY_MIN . ' karakter olmalı.';
    }
    if (vg_strlen(trim($a['impact'])) < VH_IMPACT_MIN) {
        $errors['impact'] = '"Fabrikalar ve işletmeler için anlamı" bölümü en az ' . VH_IMPACT_MIN . ' karakter olmalı.';
    }
    if (vg_strlen(trim($a['commentary'])) < VH_COMMENTARY_MIN) {
        $errors['commentary'] = 'VoltGuard yorumu en az ' . VH_COMMENTARY_MIN . ' karakter olmalı.';
    }
    if ($a['eventDate'] === '') {
        $errors['eventDate'] = 'Olay tarihi zorunludur (kararın, duyurunun veya saha olayının tarihi).';
    } elseif ($a['eventDate'] > gmdate('Y-m-d', vg_now() + 86400)) {
        $errors['eventDate'] = 'Olay tarihi gelecekte olamaz.';
    }
    $sources = vh_all_sources($a);
    if (!$sources) {
        $errors['source.url'] = 'En az bir kaynak bağlantısı zorunludur.';
    }
    foreach ($sources as $s) {
        if ($s['url'] === '' || $s['name'] === '' || $s['publishedAt'] === '') {
            $errors['source.url'] = 'Her kaynağın adı, https bağlantısı ve yayım tarihi girilmelidir.';
        }
    }
    if ($a['type'] === 'analiz' && vg_strlen($a['body']) < VH_ANALYSIS_BODY_MIN) {
        $errors['body'] = 'VoltGuard analizi en az ' . VH_ANALYSIS_BODY_MIN . ' karakter özgün metin içermelidir.';
    }
    if ($a['type'] === 'kaynak') {
        // Otomatik alinan baslik tek basina yayimlanamaz: ozeti bir editor yazmis olmali ve baslik tekrari olmamali.
        $orig = (string)($a['ingest']['originalTitle'] ?? '');
        $sum = vh_fold_words($a['summary']);
        if ($a['summaryBy'] === null || !vh_user_id_valid($a['summaryBy']) && $a['origin'] !== 'seed') {
            $errors['summary'] = 'Kaynak kartının özeti bir editör tarafından yazılmalıdır.';
        } elseif ($sum === vh_fold_words($a['title']) || ($orig !== '' && ($sum === vh_fold_words($orig) || vh_titles_similar($a['summary'], $orig)))) {
            $errors['summary'] = 'Özet, kaynak başlığının tekrarı olamaz; kendi cümlelerinizle yazın.';
        }
    }
    if ($a['image'] !== null) {
        if ($a['image']['rightsNote'] === '' || $a['image']['credit'] === '') {
            $errors['image.rightsNote'] = 'Görsel için künye ve kullanım hakkı kaydı zorunludur.';
        } elseif (strpos($a['image']['url'], '/') !== 0 && $a['image']['licenseUrl'] === '') {
            // Dis gorsel: lisansi dogrulanabilir bir kayda (lisans sayfasi, izin yazisi) baglanmadan yayimlanmaz.
            $errors['image.licenseUrl'] = 'Dış kaynaklı görselin lisansı doğrulanamadı: lisans/izin kaydının adresini girin veya görseli kaldırın.';
        }
    }
    if ($errors) {
        vg_fail(422, 'not_complete', 'Kayıt kontrole gönderilemez: ' . implode(' ', array_values(array_unique($errors))), $errors);
    }
}

/** Yayin icin: tum kontroller tamam ve hepsi bugunku icerige ait. */
function vh_assert_publishable(array $a): void
{
    if ($a['review']['stage'] !== 'approved') {
        vg_fail(422, 'not_approved', 'Yayın akışı tamamlanmadı (şu anki aşama: ' . (vh_stages()[$a['review']['stage']] ?? $a['review']['stage'])
            . '). Kaynak kontrolü, teknik kontrol ve yayın onayı olmadan yayımlanamaz.', ['review' => 'Onay eksik.']);
    }
    $hash = vh_content_hash($a);
    foreach ($a['review']['checks'] as $step => $c) {
        if ($c === null || !hash_equals($c['hash'], $hash)) {
            vg_fail(422, 'not_approved', 'Kontrollerden sonra içerik değişmiş; akış yeniden başlatılmalı.', ['review' => $step]);
        }
    }
    vh_assert_complete($a);
}

/** Kayittaki kaynak (sources.json) adresle eslesiyor mu? Ana sayfa / akis alan adina gore. */
function vh_registry_match(array $sources, string $url): ?array
{
    $host = strtolower((string)parse_url($url, PHP_URL_HOST));
    $host = (string)preg_replace('/^www\./', '', $host);
    foreach ($sources as $s) {
        foreach (vh_source_hosts($s) as $h) {
            if ($host === $h) {
                return $s;
            }
        }
    }
    return null;
}

/** Kaynagin alan adlari (www. olmadan): akis + ana sayfa. Tarayici da yalnizca bunlara baglanir. */
function vh_source_hosts(array $s): array
{
    $out = [];
    foreach ([$s['feedUrl'] ?? '', $s['homepage'] ?? ''] as $u) {
        $h = strtolower((string)parse_url((string)$u, PHP_URL_HOST));
        if ($h !== '') {
            $out[] = (string)preg_replace('/^www\./', '', $h);
        }
    }
    return array_values(array_unique($out));
}

/**
 * Kaynak kontrolunde sunucu tarafi kullanim kosulu denetimi. Kayitli kaynakta izin durumu ve kosul kontrol
 * tarihi; kayitsiz kaynakta editorun yazdigi kullanim notu aranir. RSS erisimi veya kaynak gostermek izin sayilmaz.
 */
function vh_source_terms_problems(array $a, array $registry): array
{
    $problems = [];
    foreach (vh_all_sources($a) as $s) {
        $reg = vh_registry_match($registry, $s['url']);
        if ($reg !== null) {
            if (in_array($reg['permission'], ['izin-gerekli', 'reddedildi'], true)) {
                $problems[] = $s['name'] . ': kaynak kaydında kullanım izni yok (' . $reg['permission'] . '). Birincil/resmî kaynağı kullanın veya yazılı izni kaydedin.';
            } elseif (!vh_terms_fresh($reg)) {
                $problems[] = $s['name'] . ': kaynağın kullanım koşulları son bir yılda kontrol edilmemiş; Kaynaklar sekmesinde yeniden kontrol edip tarihini girin.';
            }
        } elseif (vg_strlen($s['licenseNote']) < 10) {
            $problems[] = $s['name'] . ': kaynak kayıtta yok; kullanım koşulunu kontrol edip "kullanım / lisans notu" alanına yazın.';
        }
    }
    if ($a['image'] !== null && strpos($a['image']['url'], '/') !== 0) {
        $reg = vh_registry_match($registry, $a['image']['url']);
        if ($reg !== null && ($reg['imageTerms'] ?? '') === 'yok') {
            $problems[] = 'Görsel, görsel kullanımına izin vermeyen bir kaynaktan (' . $reg['name'] . ').';
        }
    }
    return $problems;
}

function vh_terms_fresh(array $src): bool
{
    $d = (string)($src['termsCheckedAt'] ?? '');
    $ts = preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) === 1 ? strtotime($d . 'T00:00:00Z') : false;
    return $ts !== false && vg_now() - $ts <= VH_TERMS_MAX_AGE;
}

/* ------------------------------------------------------------------ akis islemleri */

/** submit | review | hold. Ozel kilit altinda, saklanan kayit uzerinde calisir. */
function vh_review_action(string $action, array $body, array $user): array
{
    vh_only($body, ['id', 'step', 'checklist', 'note', 'kind', 'reason', 'resolution']);
    $id = vh_body_id($body);
    $registry = function_exists('vh_sources') ? vh_locked(false, function (string $dir) {
        return vh_sources($dir)['sources'];
    }) : [];
    return vh_locked(true, function (string $dir) use ($action, $body, $id, $user, $registry) {
        $state = vh_articles($dir);
        if (!isset($state['articles'][$id])) {
            vg_fail(404, 'not_found', 'Kayıt bulunamadı.');
        }
        $a = $state['articles'][$id];
        if ($a['status'] === 'archived') {
            vg_fail(409, 'archived', 'Arşivlenmiş kayıt akışa alınamaz; önce taslağa alın.');
        }
        $stage = $a['review']['stage'];
        $logTitle = $a['title'];
        if ($action === 'submit') {
            if (!in_array($stage, ['draft', 'legacy'], true)) {
                vg_fail(409, 'wrong_stage', 'Kayıt zaten akışta (' . vh_stages()[$stage] . ').');
            }
            vh_assert_complete($a);
            $note = '';
            if ($a['review']['hold'] !== null) {
                $note = vh_line($body['resolution'] ?? '', 'resolution', 'Çözüm notu', VH_NOTE_MIN, 500);
                $a['flags'] = array_values(array_diff($a['flags'], ['hold_eksik', 'hold_celiskili']));
                $a['review']['hold'] = null;
            }
            if ($stage === 'legacy' && $a['liveCopy'] === null && vh_is_live($a, vg_now())) {
                $a['liveCopy'] = vh_live_snapshot($a);
            }
            vh_reset_review($a);
            $a['review']['stage'] = 'source_check';
            vh_history($a, $user, 'submit', $note);
        } elseif ($action === 'review') {
            $steps = vh_review_steps();
            $step = $body['step'] ?? '';
            if (!is_string($step) || !isset($steps[$step])) {
                vg_fail(422, 'invalid_field', 'Kontrol adımı geçersiz.', ['step' => 'source, technical veya approval.']);
            }
            list($expect, $next, $name, $items) = $steps[$step];
            if ($stage !== $expect) {
                vg_fail(409, 'wrong_stage', $name . ' şu anda yapılamaz; kayıt "' . vh_stages()[$stage] . '" aşamasında.');
            }
            $list = $body['checklist'] ?? null;
            $missing = [];
            foreach ($items as $k => $label) {
                if (!is_array($list) || ($list[$k] ?? null) !== true) {
                    $missing[$k] = $label;
                }
            }
            if (!is_array($list) || array_diff(array_keys($list), array_keys($items))) {
                vg_fail(400, 'invalid_request', 'Kontrol listesi geçersiz.');
            }
            if ($missing) {
                vg_fail(422, 'checklist_incomplete', $name . ' tamamlanmadı: ' . implode(' ', $missing) . ' Eksik veya çelişkili bilgi varsa "Taslakta tut" kullanın.', ['checklist' => array_keys($missing)]);
            }
            $note = vh_line($body['note'] ?? '', 'note', 'Kontrol notu', VH_NOTE_MIN, 500);
            vh_assert_complete($a);
            if ($step === 'source') {
                $problems = vh_source_terms_problems($a, $registry);
                if ($problems) {
                    vg_fail(422, 'terms_unverified', 'Kaynak kontrolü geçilemez: ' . implode(' ', $problems), ['source.url' => implode(' ', $problems)]);
                }
            }
            $hash = vh_content_hash($a);
            // Onceki adimlar bugunku icerige ait olmali (aradaki duzenleme zaten akisi sifirlar; bu ikinci emniyet).
            foreach (array_keys($steps) as $prev) {
                if ($prev === $step) {
                    break;
                }
                if ($a['review']['checks'][$prev] === null || !hash_equals($a['review']['checks'][$prev]['hash'], $hash)) {
                    vg_fail(409, 'stale_review', 'Önceki kontrol bu içerik için yapılmamış; akış yeniden başlatılmalı.');
                }
            }
            $a['review']['checks'][$step] = ['byId' => $user['id'], 'by' => $user['name'], 'at' => vg_now(), 'note' => $note, 'hash' => $hash, 'checklist' => array_keys($items)];
            $a['review']['stage'] = $next;
            vh_history($a, $user, 'review_' . $step, $note);
        } else { // hold
            $kind = $body['kind'] ?? '';
            if (!in_array($kind, ['eksik', 'celiskili'], true)) {
                vg_fail(422, 'invalid_field', 'Neden türü "eksik" veya "celiskili" olmalı.', ['kind' => 'eksik / celiskili']);
            }
            $reason = vh_line($body['reason'] ?? '', 'reason', 'Gerekçe', VH_NOTE_MIN, 500);
            vh_reset_review($a);
            $a['review']['hold'] = ['kind' => $kind, 'reason' => $reason, 'by' => $user['name'], 'at' => vg_now()];
            $a['flags'] = array_values(array_unique(array_merge(array_diff($a['flags'], ['hold_eksik', 'hold_celiskili']), ['hold_' . $kind])));
            // Henuz yayinda olmayan planli kayit da taslaga doner. Yayindaki surum (varsa) liveCopy ile yerinde kalir;
            // yayindan kaldirmak ayri ve bilincli bir islemdir ("Taslağa al").
            if ($a['status'] === 'scheduled' && !vh_is_live($a, vg_now())) {
                $a['status'] = 'draft';
                $a['publishAt'] = null;
            } elseif (vh_is_live($a, vg_now()) && $a['liveCopy'] === null) {
                $a['liveCopy'] = vh_live_snapshot($a);
            }
            vh_history($a, $user, 'hold_' . $kind, $reason);
        }
        $a['updatedAt'] = vg_now();
        $state['articles'][$id] = $a;
        vh_save_articles($dir, $state);
        vh_log($dir, 'publog.json', ['at' => vg_now(), 'action' => $action === 'review' ? 'review_' . $body['step'] : $action, 'id' => $id, 'title' => $logTitle, 'by' => $user['name']], 500);
        return ['ok' => true, 'service' => VH_SERVICE, 'item' => vh_editor_view($a, [])];
    });
}
