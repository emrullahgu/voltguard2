'use strict';
const path = require('node:path');

// Called by the real employee/PHP fixture. All records live in its disposable dataset.
module.exports = async function sahaScenarios({ page, admin, api, mount, workflow, check, report, output }) {
  const frame = () => page.frameLocator('iframe[title="SahaTakip çalışma alanı"]');
  async function diagnostics(stage) {
    const state = await frame().locator('body').evaluate(() => ({
      text: document.body.innerText.slice(0, 12000),
      controls: [...document.querySelectorAll('a,button,[role="tab"],[role="button"]')].map(node => ({
        tag: node.tagName, role: node.getAttribute('role'), label: node.getAttribute('aria-label'),
        text: node.textContent.slice(0, 140), href: node.getAttribute('href'),
        visible: !!(node.getBoundingClientRect().width && node.getBoundingClientRect().height)
      })).slice(0, 100)
    })).catch(error => ({ error: error.message }));
    (report.sahaFrameDiagnostics ||= []).push({ stage, ...state });
  }
  async function ready() {
    // Admins land on Dashboard. Customers belongs to the separate Explore tab,
    // so its grid label is not a readiness signal for a fresh application load.
    // Tab accessible names can include their Ionicons glyph. Use their exact
    // visible label rather than assuming the link name contains only text.
    try {
      await frame().getByText('Keşfet', { exact: true }).last().waitFor({ state: 'visible', timeout: 90000 });
      await page.getByText('SahaTakip hazırlanıyor…', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
    } catch(error) { await diagnostics('ready'); throw error; }
  }
  async function home() {
    await frame().getByText('Keşfet', { exact: true }).last().click();
    await frame().getByText('Hızlı Erişim', { exact: true }).waitFor({ state: 'visible' });
  }
  async function customers() {
    await home();
    await frame().getByText('Müşteriler', { exact: true }).first().click();
    await frame().getByRole('button', { name: 'Yeni müşteri ekle', exact: true }).waitFor({ state: 'visible' });
  }
  async function workOrders() {
    await home();
    await frame().getByText('İş Emirlerim', { exact: true }).first().click();
    await frame().getByRole('button', { name: 'İş emri ekle', exact: true }).waitFor({ state: 'visible' });
  }
  async function rows(table) {
    return (await api(admin, 'company', 'rpc', { name: 'app_saha_query', args: { table, operation: 'select', select: '*', filters: [], order: [], limit: 1000 } })).data.data || [];
  }
  async function saved(table, predicate) {
    for (let i = 0; i < 60; i++) { const row = (await rows(table)).find(predicate); if (row) return row; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw Error('Saha record was not committed: ' + table);
  }
  await workflow('saha-shared-session-mount', async () => {
    await mount('saha-takip'); await ready();
    check(await frame().getByText('Yönetici Dashboard', { exact: true }).isVisible(), true, 'Administrator opens the real role-based Dashboard landing');
    check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'), 'saha-takip', 'Saha workspace uses the employee module route');
    check(await frame().locator('input[type="password"]').count(), 0, 'No second application login is presented');
    check((await rows('customers')).length, 0, 'The reviewed app never inserts source customer seeds');
    check((await rows('work_orders')).length, 0, 'The reviewed app never inserts source work-order seeds');
    await page.evaluate(() => window.postMessage({ type: 'vg:saha-error', message: 'Forged parent message' }, location.origin));
    check(await page.getByText('Forged parent message', { exact: true }).count(), 0, 'A message from outside the application frame is ignored');
    await page.screenshot({ path: path.join(output, 'saha-desktop-real.png'), fullPage: true });
  });
  await workflow('saha-customer-work-order', async () => {
    await mount('saha-takip'); await ready();
    await customers();
    await frame().getByRole('button', { name: 'Yeni müşteri ekle', exact: true }).click();
    await frame().getByPlaceholder('EGEBORU', { exact: true }).fill('QA Saha Müşteri');
    await frame().getByPlaceholder('ABC SANAYİ VE TİCARET A.Ş.', { exact: true }).fill('QA Saha Sentetik Test Şirketi');
    await frame().getByPlaceholder('info@firma.com', { exact: true }).fill('saha@example.invalid');
    await frame().getByText('Müşteri Ekle', { exact: true }).click();
    const customer = await saved('customers', row => row.short_name === 'QA Saha Müşteri');
    check(customer.title, 'QA Saha Sentetik Test Şirketi', 'Customer form commits to the real private API');
    await page.getByRole('button', { name: 'Yenile', exact: true }).click(); await ready();
    await workOrders();
    await frame().getByRole('button', { name: 'İş emri ekle', exact: true }).click();
    await frame().getByPlaceholder('Müşteri ara (ad, ünvan, vergi no)...', { exact: true }).fill('QA Saha');
    await frame().getByText('QA Saha Müşteri', { exact: true }).first().click();
    await frame().getByPlaceholder('Örn. Trafo periyodik bakımı, pano montajı...', { exact: true }).fill('QA Saha Portal İş Emri');
    await frame().getByText('Ofis İşi', { exact: true }).click();
    await frame().getByText('İş Emrini Oluştur', { exact: true }).click();
    const order = await saved('work_orders', row => row.service_name === 'QA Saha Portal İş Emri');
    check(order.job_type, 'OFFICE', 'Job type survives the web/Ubuntu adapter contract');
    check(order.customer_name, 'QA Saha Müşteri', 'Work order preserves the selected customer');
    await page.getByRole('button', { name: 'Yenile', exact: true }).click(); await ready();
    check((await rows('work_orders')).some(row => row.id === order.id), true, 'Committed work order survives a new application load');
    await workOrders();
    check(await frame().getByText('QA Saha Portal İş Emri', { exact: true }).first().isVisible(), true, 'The saved work order is shown again after application reload');
    report.sahaCustomerId = customer.id; report.sahaOrderId = order.id;
  });
  await workflow('saha-mobile-and-write-guard', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await mount('saha-takip'); await ready();
    const bounds = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    check(bounds.content <= bounds.width + 2, true, 'The employee Saha wrapper fits the mobile viewport');
    const inner = await frame().locator('body').evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    check(inner.content <= inner.width + 2, true, 'The Saha application fits its mobile frame');
    await frame().locator('body').evaluate(() => parent.postMessage({ type: 'vg:saha-storage', pending: 1 }, location.origin));
    await page.getByRole('button', { name: 'Modüller', exact: true }).click();
    await page.getByRole('button', { name: 'Görev takibi', exact: true }).click();
    check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'), 'saha-takip', 'A pending save prevents module unmount');
    await frame().locator('body').evaluate(() => parent.postMessage({ type: 'vg:saha-storage', pending: 0 }, location.origin));
    await page.screenshot({ path: path.join(output, 'saha-mobile-real.png'), fullPage: true });
    await page.getByRole('button', { name: 'Modüller', exact: true }).click();
    await page.getByRole('button', { name: 'Görev takibi', exact: true }).click();
    check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'), 'gorev', 'Navigation continues after writes are complete');
    await page.setViewportSize({ width: 1440, height: 1050 });
  });
};
