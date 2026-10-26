'use strict';

/* New company-portal administrator UI, backed by the real temporary PHP fixture.
 * Invitations stay inside that disposable store; no real email/account is touched. */
const crypto = require('node:crypto');

module.exports = async function administratorOutputCases(ctx) {
  const { page, admin, employee, api, rows, waitRow, mount, fill, workflow, check, report, base, browser } = ctx;
  const card = email => page.locator('[data-portal-module="admin"] article').filter({ hasText: email });
  const linkInput = () => page.getByRole('textbox', { name: 'Etkinleştirme bağlantısı', exact: true });
  const pendingName = 'QA Yeni Portal Daveti', pendingEmail = 'qa-new-portal-invite@example.invalid';
  const awaitLoaded = async () => {
    await page.getByRole('button', { name: 'Yenile', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => { const button = [...document.querySelectorAll('[data-portal-module="admin"] button')].find(element => element.textContent.trim() === 'Yenile'); return button && !button.disabled; });
  };
  const reloadUI = async () => {
    const pending = page.waitForResponse(response => response.url().includes('/api/company.php?action=query') && response.request().postDataJSON()?.table === 'users');
    await page.getByRole('button', { name: 'Yenile', exact: true }).click(); await pending;
    await page.waitForFunction(() => { const button = [...document.querySelectorAll('[data-portal-module="admin"] button')].find(element => element.textContent.trim() === 'Yenile'); return button && !button.disabled; });
  };
  const expectServerRejection = async (work, code, reason) => {
    let message = '';
    try { await work(); } catch (error) { message = String(error.message || error); }
    check(message.includes(code), true, reason);
  };
  const newActor = () => ({ cookies: new Map(), csrf: '' });
  const verifyRevokedLink = async link => {
    const outsider = newActor(); await api(outsider, 'staff', 'me');
    await expectServerRejection(() => api(outsider, 'staff', 'activate', { token: new URL(link).hash.slice(3), password: 'SyntheticAdminFixture123!' }), 'staff_invite_invalid', 'Server rejects the activation URL invalidated by the administrator UI action');
  };
  const totp = secret => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bits = [...secret].map(char => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
    const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2))), counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const hash = crypto.createHmac('sha1', key).update(counter).digest(), offset = hash[19] & 15;
    return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
  };

  await workflow('admin-nonadmin-route-and-own-account-guards', async () => {
    const ownContext = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', serviceWorkers: 'block' });
    try {
      await ownContext.addCookies([...employee.cookies].filter(([name]) => name === 'VGSTAFF').map(([name, value]) => ({ name, value, url: base, httpOnly: true, sameSite: 'Strict' })));
      const ordinary = await ownContext.newPage();
      await ordinary.goto(base + '/calisan/uygulama/?module=admin');
      await ordinary.locator('[data-portal-module="dashboard"]').waitFor({ state: 'visible' });
      check(await ordinary.getByRole('button', { name: 'Etkinleştirme bağlantısı oluştur', exact: true }).count(), 0, 'Ordinary staff cannot reach the new administrator invite form by module URL');
      check(await ordinary.getByRole('link', { name: 'Çalışan yönetimi', exact: true }).count(), 0, 'Ordinary staff has no administrator navigation link');
    } finally { await ownContext.close(); }
    await mount('admin'); await awaitLoaded();
    const own = card(admin.user.email); await own.waitFor({ state: 'visible' });
    check(await own.getByRole('button', { name: 'Erişimi kapat', exact: true }).isDisabled(), true, 'Administrator cannot disable own account through UI');
    check(await own.getByRole('button', { name: 'Yeni etkinleştirme bağlantısı', exact: true }).isDisabled(), true, 'Administrator cannot renew own invitation through UI');
    check(await own.getByRole('button', { name: 'Doğrulayıcı cihazını güvenli sıfırla', exact: true }).count(), 0, 'Own MFA reset is absent');
    await own.getByRole('button', { name: 'Yetkileri düzenle', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Çalışan yetkileri', exact: true });
    check(await dialog.locator('select').isDisabled(), true, 'Own administrator role is read-only');
    check(await dialog.getByRole('checkbox').isDisabled(), true, 'Own administrator payroll permission cannot be removed');
    await dialog.getByRole('button', { name: 'Vazgeç', exact: true }).click();
  });

  await workflow('admin-invite-form-validation-role-controls', async () => {
    await mount('admin'); await awaitLoaded();
    const form = page.locator('[data-portal-module="admin"] form').first();
    await fill('Hesap rolü', 'payroll', form); check(await form.getByRole('checkbox').isChecked(), true, 'Creating payroll role automatically grants explicit payroll management');
    await fill('Hesap rolü', 'admin', form); check(await form.getByRole('checkbox').isDisabled(), true, 'Creating admin role cannot disable mandatory payroll management');
    await fill('Hesap rolü', 'employee', form); check(await form.getByRole('checkbox').isChecked(), false, 'Returning to employee clears payroll permission');
    await fill('Ad soyad', 'A', form); await fill('E-posta', 'not-an-email', form);
    let posts = 0;
    const observe = request => { if (request.url().includes('/api/company.php?action=rpc') && request.postDataJSON()?.name === 'app_portal_invite') posts++; };
    page.on('request', observe);
    try {
      check(await form.evaluate(element => element.checkValidity()), false, 'Invalid invitation form is rejected by native constraints');
      await form.getByRole('button', { name: 'Etkinleştirme bağlantısı oluştur', exact: true }).click(); await page.waitForTimeout(150);
      check(posts, 0, 'Invalid invite form sends no company invitation mutation');
      check(await form.locator('input[type=email]').inputValue(), 'not-an-email', 'Invalid form retains entered email for correction');
    } finally { page.off('request', observe); }
  });

  await workflow('admin-new-invitation-copy-hide-renew-cancel', async () => {
    await mount('admin'); await awaitLoaded();
    const form = page.locator('[data-portal-module="admin"] form').first();
    await fill('Ad soyad', pendingName, form); await fill('E-posta', pendingEmail, form);
    await form.getByRole('button', { name: 'Etkinleştirme bağlantısı oluştur', exact: true }).click();
    const pending = await waitRow('users', user => user.email === pendingEmail && user.approved === false && user.must_change_password === true);
    await linkInput().waitFor({ state: 'visible' }); const first = await linkInput().inputValue();
    check(first.startsWith(base + '/calisan/etkinlestir.html#t='), true, 'New portal invite exposes a fixture-only activation URL');
    await card(pendingEmail).getByRole('button', { name: 'Daveti iptal et', exact: true }).waitFor({ state: 'visible' });
    check(await card(pendingEmail).getByRole('button', { name: 'Daveti iptal et', exact: true }).isVisible(), true, 'Pending invitation has cancellation rather than account-enable action');
    check(await card(pendingEmail).getByRole('button', { name: 'Erişimi aç', exact: true }).count(), 0, 'Pending invitation cannot bypass password/MFA activation');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.getByRole('button', { name: 'Bağlantıyı kopyala', exact: true }).click();
    check(await page.evaluate(() => navigator.clipboard.readText()).then(value => value === first), true, 'Invite copy writes exactly the intended synthetic activation URL');
    await page.getByRole('button', { name: 'Bağlantıyı ekrandan kaldır', exact: true }).click(); check(await linkInput().count(), 0, 'Hide link removes sensitive activation URL from DOM');
    await card(pendingEmail).getByRole('button', { name: 'Yeni etkinleştirme bağlantısı', exact: true }).click();
    await linkInput().waitFor({ state: 'visible' }); const renewed = await linkInput().inputValue();
    check(renewed !== first, true, 'UI renewal creates a fresh one-time URL');
    check((await rows('users')).filter(user => user.email === pendingEmail).length, 1, 'Renewal preserves one account rather than duplicating employee');
    await verifyRevokedLink(first);
    await card(pendingEmail).getByRole('button', { name: 'Daveti iptal et', exact: true }).click();
    await waitRow('users', user => user.id === pending.id && user.status === 'disabled');
    await page.getByRole('status').filter({ hasText: 'Bekleyen etkinleştirme bağlantısı iptal edildi.' }).waitFor({ state: 'visible' });
    await verifyRevokedLink(renewed);
    if (await linkInput().count()) await page.getByRole('button', { name: 'Bağlantıyı ekrandan kaldır', exact: true }).click();
  });

  await workflow('admin-active-employee-disable-and-enable', async () => {
    await mount('admin'); await awaitLoaded();
    await card(employee.user.email).getByRole('button', { name: 'Erişimi kapat', exact: true }).click();
    const disabled = await waitRow('users', user => user.id === employee.user.id && user.status === 'disabled');
    check(disabled.must_change_password, false, 'Disabling an enrolled employee does not misclassify them as a pending invitation');
    await card(employee.user.email).getByRole('button', { name: 'Erişimi aç', exact: true }).waitFor({ state: 'visible' });
    await expectServerRejection(() => api(employee, 'company', 'bootstrap'), 'staff_unauthorized', 'UI disable revokes existing temporary employee session');
    await card(employee.user.email).getByRole('button', { name: 'Erişimi aç', exact: true }).click();
    await waitRow('users', user => user.id === employee.user.id && user.approved === true);
    await card(employee.user.email).getByRole('button', { name: 'Erişimi kapat', exact: true }).waitFor({ state: 'visible' });
    await expectServerRejection(() => api(employee, 'company', 'bootstrap'), 'staff_unauthorized', 'Re-enable requires fresh login instead of resurrecting revoked sessions');
  });

  await workflow('admin-renew-mfa-reset-and-private-reactivation', async () => {
    await mount('admin'); await awaitLoaded();
    check(await card(employee.user.email).getByRole('button', { name: 'Doğrulayıcı cihazını güvenli sıfırla', exact: true }).count(), 0, 'Active account cannot reset MFA without first closing access and renewing invitation');
    await card(employee.user.email).getByRole('button', { name: 'Yeni etkinleştirme bağlantısı', exact: true }).click();
    await linkInput().waitFor({ state: 'visible' }); const link = await linkInput().inputValue();
    await card(employee.user.email).getByRole('button', { name: 'Doğrulayıcı cihazını güvenli sıfırla', exact: true }).waitFor({ state: 'visible' });
    check(await card(employee.user.email).getByRole('button', { name: 'Erişimi aç', exact: true }).count(), 0, 'Renewed account cannot be enabled before private activation');
    await card(employee.user.email).getByRole('button', { name: 'Doğrulayıcı cihazını güvenli sıfırla', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Eski doğrulayıcı cihazları kaldırıldı.' }).waitFor({ state: 'visible' });
    const audit = (await api(admin, 'company', 'rpc', { name: 'app_portal_account_audit', args: {} })).data;
    check(audit.some(event => event.event === 'mfa_recovered' && event.target_id === employee.user.id), true, 'UI reset produces safe server MFA-recovery audit event');
    await page.getByRole('button', { name: 'Bağlantıyı ekrandan kaldır', exact: true }).click();
    const recovered = newActor(); await api(recovered, 'staff', 'me');
    const setup = await api(recovered, 'staff', 'activate', { token: new URL(link).hash.slice(3), password: 'SyntheticRecoveredPortal123!' });
    check(setup.mode, 'enroll', 'UI recovery URL requires a fresh authenticator enrollment');
    await expectServerRejection(() => api(recovered, 'company', 'bootstrap'), 'staff_unauthorized', 'Recovery activation alone cannot access company data before MFA');
    const finished = await api(recovered, 'staff', 'mfa_enroll', { code: totp(setup.secret) });
    check(finished.user.id, employee.user.id, 'UI recovery preserves original employee identity after fresh mandatory MFA');
    await reloadUI(); await card(employee.user.email).getByRole('button', { name: 'Erişimi kapat', exact: true }).waitFor({ state: 'visible' });
    check(await card(employee.user.email).getByRole('button', { name: 'Doğrulayıcı cihazını güvenli sıfırla', exact: true }).count(), 0, 'Recovered active account hides pending-only MFA reset action');
  });

  await workflow('admin-account-filters-refresh-and-safe-audit-display', async () => {
    await mount('admin'); await awaitLoaded();
    const all = await rows('users');
    for (const [filter, predicate] of [['active', user => user.approved], ['inactive', user => !user.approved], ['all', () => true]]) {
      await page.getByRole('combobox', { name: 'Hesap filtresi', exact: true }).selectOption(filter);
      const expected = all.filter(predicate).length;
      await page.waitForFunction(count => document.querySelectorAll('[data-portal-module="admin"] article').length === count, expected);
      check(await page.locator('[data-portal-module="admin"] article').count(), expected, filter + ': account filter shows exactly corresponding server identities');
    }
    await reloadUI();
    const audit = page.getByRole('heading', { name: 'Son hesap işlemleri', exact: true }).locator('xpath=..');
    check(await audit.locator('li').count() > 0, true, 'Administrator audit list renders actual safe server records');
    const text = await audit.innerText();
    check(text.includes('Etkinleştirme bağlantısı oluşturuldu'), true, 'Audit renders invitation event label');
    check(text.includes('Doğrulayıcı cihazı sıfırlandı'), true, 'Audit renders recovery event label');
    check(text.includes(pendingName), true, 'Audit resolves target employee name');
    check(/#t=|password|mfaSecret|[a-f0-9]{64}/i.test(text), false, 'Rendered audit discloses no passwords, authenticator secrets or activation keys');
    report.coverageNotes ||= [];
    report.coverageNotes.push('New company portal administrator form and controls were exercised through UI against real temporary PHP. Activation/MFA API calls here verify server effects of UI recovery; activation-page UI itself is covered separately by staff-browser.cjs. No real email, real account or external channel was used.');
  });
};
