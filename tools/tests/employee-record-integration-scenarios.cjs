'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sentinel = 'QA_STATUS_ONLY_SENTINEL_NOT_A_REAL_PROVIDER_KEY';

// Real published screens + real isolated PHP sessions/status/authentication.
// The sole provider-success fixture is an explicit browser interception of the
// read-only JSONPlaceholder request, never a replacement company database read.
async function integrationScenarios({ page, admin, employee, workflow, check, report, ui, base, output }) {
  const requests = [], scripts = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/integrations.php') requests.push({ action: url.searchParams.get('action'), method: request.method() });
    if (request.resourceType() === 'script') scripts.push(url.pathname);
  });
  const isStatus = response => new URL(response.url()).pathname === '/api/integrations.php' && new URL(response.url()).searchParams.get('action') === 'status';
  const host = ui.host;
  const screenText = () => host().locator('[data-vg-module-root]').innerText();
  async function endpoint(who, action, query = {}) {
    const cookie = [...who.cookies].map(([key, value]) => key + '=' + value).join('; ');
    const response = await fetch(base + '/api/integrations.php?' + new URLSearchParams({ action, ...query }), { headers: { Cookie: cookie } });
    const body = await response.json();
    (report.expectedIntegrationResponses ||= []).push({ action, status: response.status, error: body.error });
    return { status: response.status, body };
  }
  async function cookie(who) {
    await page.context().addCookies([...who.cookies].filter(([name]) => name === 'VGSTAFF').map(([name, value]) => ({ name, value, url: base, httpOnly: true, sameSite: 'Strict' })));
  }
  await workflow('integration:compiled-ai-missing-keys', async () => {
    const response = page.waitForResponse(isStatus);
    await ui.open('ConnectedAi');
    const status = await (await response).json();
    check(status.api, 'vg-integrations/1', 'Real status endpoint returns the published integration envelope');
    check(['gemini', 'groq', 'openrouter', 'cloudflare'].every(id => status.data.ai[id].configured === false), true, 'Isolated AI credentials are absent for all providers');
    check(await host().getByRole('radio').count(), 4, 'Published AI screen exposes all four providers');
    await host().getByRole('textbox', { name: 'Yapay zekâ iletisi', exact: true }).fill('QA sentetik teknik soru: güneş paneli eğimi nedir?');
    check(await host().getByRole('button', { name: 'Seçili sağlayıcıya gönder', exact: true }).isDisabled(), true, 'A nonempty draft cannot be sent when the provider key is absent');
    for (const label of ['Groq', 'OpenRouter', 'Cloudflare Workers AI', 'Google Gemini']) {
      await host().getByRole('radio', { name: label, exact: true }).click();
      check(await host().getByRole('button', { name: 'Seçili sağlayıcıya gönder', exact: true }).isDisabled(), true, label + ' remains disabled without its configured key');
    }
    const before = requests.filter(item => item.action === 'status').length;
    const refreshed = page.waitForResponse(isStatus);
    await host().getByRole('button', { name: 'Bağlantı durumunu yenile', exact: true }).click();
    await refreshed;
    check(requests.filter(item => item.action === 'status').length, before + 1, 'Status refresh is a single explicit manual request');
    check(requests.filter(item => item.action === 'ai_chat').length, 0, 'No AI request is made by typing, selecting providers or refreshing status');
    await ui.inspect('ConnectedAi');
    await page.screenshot({ path: path.join(output, 'connected-ai-missing-keys.png') });
  });

  await workflow('integration:admin-status-and-synthetic-five-records', async () => {
    const response = page.waitForResponse(isStatus);
    await ui.open('ConnectedData');
    const status = await (await response).json();
    check(status.data.services.ipinfo.configured, true, 'Status evaluates the isolated harmless IPinfo sentinel as configured');
    check(JSON.stringify(status).includes(sentinel), false, 'Real status output never returns the configured provider secret');
    check((await screenText()).includes(sentinel), false, 'Compiled screen never displays a provider key');
    check(status.data.services.epias.configured, false, 'EPİAŞ is explicitly unconfigured in this isolated environment');
    await host().getByRole('radio', { name: 'JSONPlaceholder · sentetik kayıtlar', exact: true }).click();
    check(await host().getByRole('button', { name: 'Seçili veri kaynağını sorgula', exact: true }).isDisabled(), false, 'The real administrator can explicitly run the read-only mock laboratory');
    const fixture = {
      api: 'vg-integrations/1', ok: true, data: {
        provider: 'JSONPlaceholder', source: { name: 'JSONPlaceholder', url: 'https://jsonplaceholder.typicode.com/' },
        retrievedAt: new Date().toISOString(), synthetic: true,
        items: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, title: 'QA sentetik kayıt ' + (index + 1), body: 'Yalnız tarayıcı arayüzü test verisi.' })),
        notice: 'SENTETİK TEST VERİSİ: gerçek şirket kaydı değildir.',
      },
    };
    let intercepted = 0;
    const pattern = '**/api/integrations.php*';
    await page.route(pattern, async route => {
      const action = new URL(route.request().url()).searchParams.get('action');
      if (action === 'status') return route.continue();
      if (action !== 'jsonplaceholder') return route.abort('blockedbyclient');
      check(route.request().method(), 'GET', 'Synthetic provider preview uses a read-only GET');
      check(new URL(route.request().url()).searchParams.get('limit'), '5', 'The administrator requests exactly five example records');
      intercepted++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });
    try {
      await host().getByRole('textbox', { name: 'Örnek kayıt sayısı', exact: true }).fill('5');
      await host().getByRole('button', { name: 'Seçili veri kaynağını sorgula', exact: true }).click();
      await host().getByText('Son sorgu · JSONPlaceholder · sentetik kayıtlar', { exact: true }).waitFor({ state: 'visible' });
      const text = await screenText();
      check(intercepted, 1, 'Only one explicitly requested mock-provider preview is issued');
      check(Array.from({ length: 5 }, (_, index) => text.includes('QA sentetik kayıt ' + (index + 1))).every(Boolean), true, 'All five normalized synthetic records render in the compiled screen');
      check(text.includes('"synthetic": true') && text.includes('Bu kaynak sentetik örnek veri döndürür'), true, 'The preview clearly labels synthetic data and its isolation from business records');
      await ui.inspect('ConnectedData');
      await host().getByText('Son sorgu · JSONPlaceholder · sentetik kayıtlar', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'connected-data-admin-five-synthetic.png') });
    } finally { await page.unroute(pattern); }
  });

  await workflow('integration:employee-admin-boundary-and-epias', async () => {
    await cookie(employee);
    try {
      await ui.open('ConnectedData');
      await host().getByRole('radio', { name: 'JSONPlaceholder · sentetik kayıtlar', exact: true }).click();
      await host().getByText('Bu sorgu için yönetici yetkisi gerekiyor.', { exact: true }).waitFor({ state: 'visible' });
      check(await host().getByRole('button', { name: 'Seçili veri kaynağını sorgula', exact: true }).isDisabled(), true, 'Ordinary employees cannot issue an administrator-only laboratory query');
      const denied = await endpoint(employee, 'jsonplaceholder', { limit: '5' });
      check(denied.status, 403, 'Actual PHP endpoint independently rejects the employee mock query');
      check(denied.body.error, 'admin_required', 'The real employee rejection reports the administrator policy');
      await host().getByRole('radio', { name: 'EPİAŞ · saatlik PTF', exact: true }).click();
      check(await host().getByText('Bu sorgu için yönetici yetkisi gerekiyor.', { exact: true }).count(), 0, 'EPİAŞ remains a staff-access service rather than an administrator-only laboratory query');
      check(await host().getByRole('button', { name: 'Seçili veri kaynağını sorgula', exact: true }).isDisabled(), true, 'EPİAŞ querying stays disabled until server account configuration exists');
      const missing = await endpoint(employee, 'epias', { date: new Date().toISOString().slice(0, 10) });
      check(missing.status, 503, 'Actual PHP endpoint accepts staff scope then reports missing EPİAŞ configuration');
      check(missing.body.error, 'provider_not_configured', 'Missing EPİAŞ account is reported without an upstream request');
      await ui.inspect('ConnectedData');
      await page.screenshot({ path: path.join(output, 'connected-data-employee-epias-missing.png') });
    } finally { await cookie(admin); }
  });

  const runtimeScripts = report.recordCoverage.runtimeScripts;
  check(runtimeScripts.every(script => scripts.includes(script)), true, 'Browser actually executes the immutable compiled scripts recorded in the manifest');
  report.integrationBoundary = {
    realSyntheticMfaAccounts: true, realStatusAndAuthorization: true,
    providerSuccessFixture: 'Browser interception of one JSONPlaceholder GET only; no production database or provider request',
    runtimeScripts: runtimeScripts.map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../..', file))).digest('hex') })),
    requests,
  };
}

integrationScenarios.environment = Object.fromEntries([
  'VG_GEMINI_API_KEY', 'VG_GROQ_API_KEY', 'VG_OPENROUTER_API_KEY', 'VG_CLOUDFLARE_API_TOKEN', 'VG_CLOUDFLARE_ACCOUNT_ID',
  'VG_EPIAS_TGT', 'VG_EPIAS_USERNAME', 'VG_EPIAS_PASSWORD', 'VG_UNSPLASH_ACCESS_KEY', 'VG_TMDB_TOKEN', 'VG_NEWSAPI_KEY',
  'VG_TMDB_COMMERCIAL_LICENSE', 'VG_NEWSAPI_PRODUCTION_ALLOWED', 'VG_INTEGRATIONS_LOCAL',
].map(name => [name, '']).concat([['VG_IPINFO_TOKEN', sentinel]]));
module.exports = integrationScenarios;
