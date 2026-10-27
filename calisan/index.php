<?php
declare(strict_types=1);
define('VG_API', 1);
require dirname(__DIR__) . '/api/lib/bootstrap.php';
require dirname(__DIR__) . '/api/lib/security.php';
require dirname(__DIR__) . '/api/lib/staff.php';
header('Cache-Control: no-store, private, max-age=0');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Referrer-Policy: same-origin');
try { $staffUser = vg_staff_require_user(); }
catch (VgHttpError $error) {
    if ($error->status === 401) { header('Location: /calisan/giris.html', true, 303); exit; }
    http_response_code($error->status); header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store, private'); echo 'Çalışan alanı şu anda kullanılamıyor.'; exit;
}
catch (Throwable $error) {
    http_response_code(503); header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store, private'); echo 'Çalışan alanı şu anda kullanılamıyor.'; exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, private, max-age=0');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Referrer-Policy: same-origin');
function staff_page_escape(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
?>
<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Çalışan Paneli | VoltGuard</title><meta name="theme-color" content="#0a1628"><script src="/js/vg-theme-init.js?v=928d2d32672c"></script>
  <link rel="stylesheet" href="/css/fonts.css?v=3680cd14c522"><link rel="stylesheet" href="/css/fa-subset.css?v=1eb3ee5f5be2"><link rel="stylesheet" href="/css/vg-shell.css?v=40f6f66886a2"><link rel="stylesheet" href="/css/staff.css?v=408066f04b8d"><link rel="icon" href="/public/favicon-32.png"><script src="/js/vg-shell.js?v=c97b3cdc9a27" defer></script><script src="/js/staff.js?v=0a1f9bc8fc81" defer></script>
</head><body class="staff-page" data-staff-page="panel">
<?php readfile(dirname(__DIR__) . '/calisan/shared-header.html'); ?>
<main id="main" class="staff-wrap staff-panel" tabindex="-1"><div class="staff-panel-heading"><div><p class="staff-eyebrow">VoltGuard / Çalışan Portalı</p><h1>Merhaba, <?php echo staff_page_escape((string)$staffUser['name']); ?>.</h1><p id="staff-role-label" class="staff-muted">Size yetkilendirilmiş şirket kayıtları.</p></div><button id="staff-logout" class="staff-secondary" type="button">Çalışan oturumunu kapat</button></div>
  <section class="staff-app-intro"><div><p class="staff-eyebrow">Şirket uygulamaları</p><h2>Tüm çalışmalarınız tek yerde.</h2><p>Müşteriler, iş emirleri, teklifler, görevler, stok, araçlar, bakım, ekip planlama ve raporlar.</p><a href="/calisan/uygulama/?module=is-emirleri">İş emirlerini aç →</a></div><a class="staff-primary staff-app-link" href="/calisan/uygulama/?module=uygulamalar">Çalışan uygulamalarını aç →</a></section>
  <p id="staff-status" class="staff-status" role="status" aria-live="polite"></p>
  <div class="staff-tabs" role="tablist" aria-label="Çalışan bölümleri"><button class="is-active" data-staff-tab="payroll" type="button" role="tab" id="staff-tabbtn-payroll" aria-controls="staff-tab-payroll" aria-selected="true">Bordrolarım</button><button data-staff-tab="people" id="staff-people-tab" type="button" role="tab" aria-controls="staff-tab-people" aria-selected="false" tabindex="-1" hidden>Çalışanlar</button><button data-staff-tab="security" type="button" role="tab" id="staff-tabbtn-security" aria-controls="staff-tab-security" aria-selected="false" tabindex="-1">Hesap güvenliği</button></div>
  <section id="staff-tab-payroll" class="staff-card" role="tabpanel" aria-labelledby="staff-tabbtn-payroll" tabindex="0"><div class="staff-section-heading"><div><h2 id="staff-payroll-title">Bordrolarım</h2><p class="staff-muted">Dönem kayıtları ve ekli bordro dosyaları.</p></div><button id="staff-refresh" class="staff-secondary" type="button">Yenile</button></div><div id="staff-payroll-list" class="staff-payroll-list" aria-live="polite"></div>
    <details id="staff-payroll-manager" class="staff-manager" hidden><summary>Yeni bordro kaydı</summary><form id="staff-payroll-form" class="staff-form-grid"><label>Çalışan<select name="userId" id="staff-payroll-user" required></select></label><label>Dönem<input name="period" type="month" required></label><label>Brüt tutar (₺)<input name="gross" type="number" min="0" max="1000000000" step="0.01" required></label><label>Kesintiler (₺)<input name="deductions" type="number" min="0" max="1000000000" step="0.01" required></label><label>Net tutar (₺)<input name="net" type="number" min="0" max="1000000000" step="0.01" required></label><label>PDF bordro (isteğe bağlı)<input name="pdf" type="file" accept="application/pdf,.pdf"></label><label class="staff-span">Not<textarea name="note" maxlength="2000" rows="3"></textarea></label><p class="staff-muted staff-span">Tutarlar onaylanmış bordrodan girilir.</p><button class="staff-primary" type="submit">Bordro kaydını ekle</button></form></details>
  </section>
  <section id="staff-tab-people" class="staff-card" role="tabpanel" aria-labelledby="staff-people-tab" tabindex="0" hidden><h2>Çalışanlar</h2><p class="staff-muted">Çalışan hesapları ve erişim durumu.</p><div id="staff-people-list" class="staff-people-list"></div><section id="staff-invite-section" class="staff-manager" hidden><h3>Çalışan davet et</h3><form id="staff-invite-form" class="staff-form-grid"><label>Ad soyad<input name="name" maxlength="100" required></label><label>E-posta<input name="email" type="email" maxlength="254" required></label><label>Yetki<select name="role"><option value="employee">Çalışan · kendi bordrosu</option><option value="payroll">Bordro sorumlusu</option><option value="admin">Yönetici</option></select></label><button type="submit" class="staff-primary">Özel davet oluştur</button></form><div id="staff-invite-result" hidden><label>Etkinleştirme bağlantısı<input id="staff-invite-link" readonly></label><button id="staff-copy-invite" class="staff-secondary" type="button">Bağlantıyı kopyala</button><p class="staff-muted">Yalnızca ilgili çalışanla paylaşın. Davet 24 saat geçerlidir ve bir kez kullanılabilir.</p></div></section></section>
  <section id="staff-tab-security" class="staff-card" role="tabpanel" aria-labelledby="staff-tabbtn-security" tabindex="0" hidden><h2>Hesap güvenliği</h2><p>Çalışan hesabınız şifre ve doğrulayıcı uygulama ile korunur.</p><p class="staff-muted">Cihaz değişikliği veya erişim sorunu için şirket yöneticinizden yeni etkinleştirme daveti isteyin.</p><dl class="staff-account-details"><div><dt>E-posta</dt><dd id="staff-security-email"></dd></div><div><dt>Yetki</dt><dd id="staff-security-role"></dd></div></dl><a href="/topluluk.html">Herkese açık topluluğa git →</a></section>
</main>
<?php readfile(dirname(__DIR__) . '/calisan/shared-footer.html'); ?>
</body></html>
