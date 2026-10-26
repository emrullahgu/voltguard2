'use strict';

/* Extends the real PHP/browser fixture with isolated OSOS and Keşif output workflows.
 * Dormant Keşif simple-PDF and nonexistent print controls are intentionally excluded.
 * The caller owns setup, MFA, browser lifecycle and artifact directory. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const XLSX = require(path.resolve(__dirname, '../staff-app/node_modules/xlsx'));

module.exports = async function outputOsosKesifCases(ctx) {
  const { page, admin, api, rows, waitRow, mount, fill, workflow, check, report, download, output } = ctx;
  const prefix = 'QA Output ';
  const findDocument = (kind, id) => waitRow('company_documents', row => row.kind === kind && row.record_id === id);
  const store = (key, value) => api(admin, 'company', 'storage', { key, value: JSON.stringify(value) });
  const pdfText = (label, bytes, required) => {
    const result = spawnSync(process.env.VG_PYTHON || 'python', ['-c',
      'import io,sys; from pypdf import PdfReader; r=PdfReader(io.BytesIO(sys.stdin.buffer.read())); print("\\n".join(p.extract_text() or "" for p in r.pages))'],
    { input: bytes, encoding: 'utf8', env: {...process.env, PYTHONIOENCODING: 'utf-8'}, windowsHide: true, timeout: 30000 });
    check(result.status, 0, label + ': downloaded PDF parses with pypdf: ' + (result.stderr || ''));
    const text = result.stdout || '';
    fs.writeFileSync(path.join(output, label + '-text.txt'), text, 'utf8');
    for (const term of required) check(text.includes(term), true, label + ': PDF contains ' + term);
    check(/NaN|Infinity|Invalid Date/.test(text), false, label + ': PDF has no invalid arithmetic/date output');
    return text;
  };
  const waitGone = async (kind, id) => {
    await page.waitForTimeout(300);
    check((await rows('company_documents')).some(row => row.kind === kind && row.record_id === id), false, kind + ': UI delete removed durable document');
  };
  const reportModal = () => page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Kayıtlı Raporlar', exact: true }) });
  const factoryModal = () => page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Fabrika Veri Yönetimi', exact: true }) });
  const quoteModal = () => page.locator('.fixed').filter({ has: page.getByRole('heading', { name: /^Kaydedilmiş Teklifler/ }) });
  const preview = () => page.locator('.fixed').filter({ has: page.locator('#kesif-printable-paper') });
  const factoryCard = name => factoryModal().locator('.border-2').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const quoteCard = name => quoteModal().locator('.border-2').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const reportCard = name => reportModal().locator('.border-2').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const closePreview = async () => { await preview().locator('button').last().click(); await preview().waitFor({ state: 'hidden' }); };
  const prepareManualOSOS = async name => {
    await mount('osos');
    await page.getByPlaceholder('Firma adını girin', { exact: true }).fill(name);
    await page.getByPlaceholder('Rapor numarası', { exact: true }).fill('QA-OSOS-OUTPUT');
    await page.getByPlaceholder('Değer', { exact: true }).first().fill('12.5');
    await page.getByPlaceholder('Ek bilgiler ve notlar...', { exact: true }).fill('Sentetik çıktı doğrulaması: ölçülen güç 12,5 kW.');
  };

  await workflow('osos-template-and-direct-json-import', async () => {
    await mount('osos');
    const bytes = await download('osos-measurement-template', () => page.getByRole('button', { name: 'Boş ölçüm JSON şablonunu indir', exact: true }).click());
    const template = JSON.parse(bytes.toString('utf8'));
    check(Array.isArray(template), true, 'OSOS measurement template is JSON array');
    check(template.length, 1, 'OSOS measurement template has one blank row');
    check(template[0].aktif_guc, null, 'OSOS template invents no measurement');
    check(template[0].olcum_zamani, '', 'OSOS template invents no timestamp');
    const name = prefix + 'JSON Tesis';
    await page.getByPlaceholder('Firma adını girin', { exact: true }).fill(name);
    const input = [{ ...template[0], sayac_no: 'QA-OUTPUT-METER', olcum_zamani: '2026-10-26T09:00:00+03:00', aktif_guc: 12.5, gerilim_l1: 230, frekans: 50 }];
    await page.locator('input[type=file][accept=".json,.xlsx,.xls"]').setInputFiles({ name: 'qa-output-measurement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    const saved = await waitRow('osos_olcumler', row => row.fabrika_adi === name && row.sayac_no === 'QA-OUTPUT-METER');
    check(saved.aktif_guc, 12.5, 'Template populated with measured JSON retains numeric power');
    check(saved.gerilim_l2, null, 'Unprovided measurement remains null');
    await page.getByRole('heading', { name: 'Kaydedilmiş ölçümleri izle', exact: true }).waitFor();
  });

  await workflow('osos-xlsx-import-factory-raw-load-delete', async () => {
    const name = prefix + 'Excel Tesis';
    await mount('osos'); await page.getByPlaceholder('Firma adını girin', { exact: true }).fill(name);
    const imported = [{ Tarih: '2026-10-25 00:00:00', 'Tüketim ()': 120.5, Çarpan: 1, 'Endeks Kodu': '1.8.0' }, { Tarih: '2026-10-26 00:00:00', 'Tüketim ()': 230.5, Çarpan: 1, 'Endeks Kodu': '1.8.0' }];
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(imported), 'OSOS');
    await page.locator('input[type=file][accept=".json,.xlsx,.xls"]').setInputFiles({ name: 'qa-output-energy.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
    await page.getByRole('button', { name: 'İçe Aktar', exact: true }).click();
    const saved = await waitRow('company_documents', row => row.kind === 'osos_fabrika' && row.payload?.fabrikaAdi === name);
    check(saved.payload.aktifEnerji.length, 2, 'OSOS real Excel import persists both active-energy rows');
    check(saved.payload.istatistikler.toplamTuketim, '351.00', 'OSOS Excel import retains total 351 kWh');
    await page.getByRole('button', { name: /^Fabrikalar/ }).click();
    const card = factoryCard(name); await card.waitFor();
    const raw = await download('osos-factory-raw-json', () => card.getByRole('button', { name: /Ham Veri İndir/ }).click());
    check(JSON.parse(raw.toString('utf8')), imported, 'Downloaded factory JSON matches imported workbook rows');
    await card.getByRole('button', { name: /Rapora Yükle/ }).click();
    check(await page.getByPlaceholder('Firma adını girin', { exact: true }).inputValue(), name, 'Factory load updates report company');
    const pdf = await download('osos-energy-pdf', () => page.getByRole('button', { name: 'PDF İndir', exact: true }).click());
    pdfText('osos-energy-pdf', pdf, ['OSOS ENERJİ RAPORU', name, 'Aktif enerji', '351']);
    const html = await download('osos-energy-html', () => page.getByRole('button', { name: 'HTML Rapor', exact: true }).click());
    check(/<!doctype html>/i.test(html.toString('utf8')), true, 'OSOS HTML export is a standalone HTML document');
    check(html.toString('utf8').includes(name), true, 'OSOS HTML report contains company');
    check(/NaN|Infinity|Invalid Date/.test(html.toString('utf8')), false, 'OSOS HTML report contains valid values');
    await page.getByRole('button', { name: /^Fabrikalar/ }).click();
    await factoryCard(name).getByRole('button', { name: /Sil/ }).click();
    await waitGone('osos_fabrika', saved.record_id);
  });

  await workflow('osos-manual-report-save-reopen-update-print-delete', async () => {
    const name = prefix + 'Kaydedilen Rapor';
    await prepareManualOSOS(name);
    await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
    const original = await waitRow('company_documents', row => row.kind === 'osos_rapor' && row.payload?.firmaAdi === name);
    check(original.payload.measurements[0].deger, '12.5', 'OSOS report save retains entered measurement');
    await mount('osos'); await page.getByRole('button', { name: 'Raporlar', exact: true }).click();
    await reportCard(name).getByRole('button', { name: 'Yükle', exact: true }).click();
    check(await page.getByPlaceholder('Değer', { exact: true }).first().inputValue(), '12.5', 'OSOS report load restores measured value');
    await page.getByPlaceholder('Ek bilgiler ve notlar...', { exact: true }).fill('Güncellenmiş sentetik rapor notu.');
    await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await waitRow('company_documents', row => row.record_id === original.record_id && row.revision === original.revision + 1 && row.payload?.formData?.aciklama === 'Güncellenmiş sentetik rapor notu.');
    const pdf = await download('osos-measurement-pdf', () => page.getByRole('button', { name: 'PDF İndir', exact: true }).click());
    pdfText('osos-measurement-pdf', pdf, [name, '12.5', 'Güncellenmiş sentetik rapor notu.']);
    await page.evaluate(() => { window.__qaOsosPrintCount = 0; window.print = () => { window.__qaOsosPrintCount++; window.__qaOsosPrintText = document.body.innerText; }; });
    await page.getByRole('button', { name: 'Yazdır', exact: true }).click();
    await page.waitForFunction(() => window.__qaOsosPrintCount === 1);
    check(await page.evaluate(() => window.__qaOsosPrintText.includes('Güncellenmiş sentetik rapor notu.')), true, 'OSOS print branch exposes report contents when invoking browser print');
    check(await page.evaluate(() => window.__qaOsosPrintCount), 1, 'OSOS print invokes browser once (print-dialog branch, not a physical printer test)');
    await page.getByRole('button', { name: 'Raporlar', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Raporlar', exact: true }).click();
    await reportCard(name).getByRole('button', { name: 'Sil', exact: true }).click(); await waitGone('osos_rapor', original.record_id);
  });

  await workflow('osos-legacy-report-import-delete', async () => {
    const id = crypto.randomUUID(), name = prefix + 'Eski OSOS';
    const legacy = { id, tarih: '2026-10-26T09:00:00Z', firmaAdi: name, formData: { firmaAdi: name, raporNo: 'QA-LEGACY', raporTarihi: '2026-10-26', sonuc: 'Değerlendirilmedi' }, fabrikaVerileri: [], measurements: [{ id: 1, parametre: 'Aktif Güç', deger: '7.5', birim: 'kW', durum: 'Değerlendirilmedi' }], aktifEnerji: [], induktifEnerji: [], kapasitifEnerji: [], logo: null };
    await store('osos_raporlar', [legacy]); await mount('osos');
    await page.getByRole('button', { name: 'Eski tarayıcı OSOS raporlarını şirket sunucusuna aktar', exact: true }).click();
    const saved = await findDocument('osos_rapor', id); check(saved.payload.firmaAdi, name, 'OSOS legacy import persists the selected synthetic report');
    await reportCard(name).getByRole('button', { name: 'Sil', exact: true }).click(); await waitGone('osos_rapor', id);
    await api(admin, 'company', 'storage', { key: 'osos_raporlar', value: null });
  });

  await workflow('kesif-preview-pdf-company-document-and-central-archive', async () => {
    const name = prefix + 'Keşif Müşteri', productName = prefix + 'Keşif Kablo';
    const product = (await api(admin, 'company', 'query', { table: 'products', operation: 'insert', rows: [{ name: productName, category: 'QA Kablo', price: 123.45, original_name: productName }], filters: [], select: '*', returning: true, single: 'one' })).data;
    await mount('kesif');
    const productCard = page.getByRole('heading', { name: productName, exact: true }).locator('xpath=../..');
    await productCard.locator('button').last().click();
    await page.getByRole('button', { name: 'Önizle', exact: true }).click();
    await page.getByPlaceholder('Örn: ABC İnşaat Ltd. Şti.', { exact: true }).fill(name);
    await page.getByPlaceholder('Sizin firma adınız', { exact: true }).fill('QA Elektrik Ltd.');
    await page.getByPlaceholder('Sizin adınız', { exact: true }).fill('QA Yetkili');
    await page.getByRole('button', { name: '✓ Kaydet ve Önizle', exact: true }).click();
    await page.locator('#kesif-printable-paper').waitFor({ state: 'visible' });
    check((await page.locator('#kesif-printable-paper').innerText()).includes(productName), true, 'Keşif PDF preview contains selected product');
    check((await page.locator('#kesif-printable-paper').innerText()).includes('teklifimiz 30 gün süreyle geçerlidir.'),true,'Keşif legal page uses the same validity as its first-page metadata');
    await preview().getByRole('button',{name:'Düzenle',exact:true}).click();
    await page.locator('#kesif-printable-paper p').first().click();await page.keyboard.press('End');await page.keyboard.type(' QA-CENTRAL-KESIF-EDIT');
    await preview().getByRole('button',{name:'Kaydet',exact:true}).first().click();
    const bytes = await download('kesif-preview-pdf', () => preview().getByRole('button', { name: 'İndir', exact: true }).click());
    check(bytes.length > 10000, true, 'Active Keşif preview export downloaded rendered PDF data');
    await closePreview();
    await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
    const saved = await waitRow('company_documents', row => row.kind === 'kesif_teklif' && row.payload?.teklifForm?.musteriAdi === name);
    check(saved.payload.cart[0].name, productName, 'Keşif company document stores selected product');
    check(saved.payload.cart[0].price, 123.45, 'Keşif company document retains selected unit price');
    check(saved.payload.reportHtml.includes('QA-CENTRAL-KESIF-EDIT'),true,'Saved Keşif company document retains the report edit before archiving');
    await mount('kesif'); await page.getByRole('button', { name: 'Teklifler', exact: true }).click();
    await quoteCard(name).getByRole('button', { name: 'Yükle', exact: true }).click();
    check(await page.getByPlaceholder('Açıklama ekle (opsiyonel)...', { exact: true }).count(), 1, 'Keşif company document reload restores one cart row');
    await page.getByRole('button', { name: 'Teklif arşivine kaydet', exact: true }).click();
    const archived = await waitRow('proposals', row => row.type === 'kesif' && row.name.includes(name));
    check(archived.data.componentSnapshot.cart[0].name, productName, 'Central proposal archive retains full Keşif component snapshot');
    check(archived.data.referenceNo, archived.reference_no, 'Central Keşif archive uses server reference');
    await page.getByRole('button', { name: 'Teklifler', exact: true }).click();
    await quoteCard(name).getByRole('button', { name: 'Sil', exact: true }).click(); await waitGone('kesif_teklif', saved.record_id);
    await mount('saved');
    await page.getByRole('button',{name:/^Keşif.*\(/}).click();
    const archiveCard=()=>page.getByRole('heading',{name:archived.name,exact:true}).locator('xpath=..');
    check(await archiveCard().count(),1,'Keşif archive filter exposes the exact saved snapshot');
    await archiveCard().getByRole('button').first().click();await page.locator('[data-portal-module="kesif"]').waitFor();
    await page.getByPlaceholder('Açıklama ekle (opsiyonel)...',{exact:true}).first().waitFor({state:'visible'});
    check(await page.getByPlaceholder('Açıklama ekle (opsiyonel)...',{exact:true}).count(),1,'Central archive reload restores the original one-row cart');
    await page.getByRole('button',{name:'Önizle',exact:true}).click();await page.locator('#kesif-printable-paper').waitFor();
    const restored=await page.locator('#kesif-printable-paper').innerText();
    for(const text of [name,productName,'148.14 TL','QA-CENTRAL-KESIF-EDIT',archived.reference_no])check(restored.includes(text),true,'Central Keşif archive restores customer, total, report edit and metadata: '+text);
    await closePreview();await mount('saved');await archiveCard().getByRole('button').last().click();
    await page.waitForTimeout(250); check((await rows('proposals')).some(row => row.id === archived.id), false, 'Keşif central archive UI delete persists');
    await api(admin, 'company', 'query', { table: 'products', operation: 'delete', filters: [{ field: 'id', op: 'eq', value: product.id }] });
  });

  await workflow('kesif-legacy-company-quote-import-load-delete', async () => {
    const id = crypto.randomUUID(), name = prefix + 'Eski Keşif';
    const legacy = { schemaVersion: 1, id, tarih: '2026-10-26T09:00:00Z', teklifForm: { musteriAdi: name, firmaAdi: 'QA Firma', yetkili: 'QA Yetkili', teklifNo: 'QA-LEGACY-KESIF', kdvOrani: 20, tarih: '26.10.2026',gecerlilikSuresi:'7 gün' }, cart: [{ id: 'qa-legacy-item', name: 'QA Eski Kablo', category: 'QA', price: 12.5, quantity: 2, kdvOrani: 20 }], discount: 0, profit: 0, logo: null, reportHtml: '' };
    await store('kesifTeklifler', [legacy]); await mount('kesif');
    await page.getByRole('button', { name: 'Eski tarayıcı tekliflerini şirket sunucusuna aktar', exact: true }).click();
    const saved = await findDocument('kesif_teklif', id); check(saved.payload.cart[0].quantity, 2, 'Legacy Keşif import preserves entered quantity');
    await quoteCard(name).getByRole('button', { name: 'Yükle', exact: true }).click();
    check(await page.getByPlaceholder('Açıklama ekle (opsiyonel)...', { exact: true }).count(), 1, 'Legacy Keşif quote opens in active editor');
    await page.getByRole('button',{name:'Önizle',exact:true}).click();await page.locator('#kesif-printable-paper').waitFor();
    const restoredText=await page.locator('#kesif-printable-paper').innerText();check(restoredText.includes('Geçerlilik: 7 gün')&&restoredText.includes('teklifimiz 7 gün süreyle geçerlidir.'),true,'A restored nondefault validity is consistent on metadata and legal pages');await closePreview();
    await page.getByRole('button', { name: 'Teklifler', exact: true }).click();
    await quoteCard(name).getByRole('button', { name: 'Sil', exact: true }).click(); await waitGone('kesif_teklif', id);
    await api(admin, 'company', 'storage', { key: 'kesifTeklifler', value: null });
  });

  await workflow('osos-three-energy-types-and-multiple-factory-compare', async () => {
    const saved = [];
    for (const [type, code, field] of [['aktif', '1.8.0', 'aktifEnerji'], ['induktif', '5.8.0', 'induktifEnerji'], ['kapasitif', '8.8.0', 'kapasitifEnerji']]) {
      const name = prefix + 'Karşılaştırma ' + type;
      await mount('osos'); await page.getByPlaceholder('Firma adını girin', { exact: true }).fill(name);
      const input = [{ Tarih: '2026-10-25 00:00:00', 'Tüketim ()': '12,5', Çarpan: 1, 'Endeks Kodu': code }];
      await page.locator('input[type=file][accept=".json,.xlsx,.xls"]').setInputFiles({ name: 'qa-' + type + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
      await page.getByRole('button', { name: 'İçe Aktar', exact: true }).click();
      const record = await waitRow('company_documents', row => row.kind === 'osos_fabrika' && row.payload?.fabrikaAdi === name);
      check(record.payload.enerjiTipi, type, 'OBIS ' + code + ' imports correct energy type');
      check(record.payload[field].length, 1, type + ': only supplied energy rows are populated');
      check(record.payload.istatistikler.toplamTuketim, '12.50', type + ': decimal-comma import retains measured total');
      saved.push({ id: record.record_id, name });
    }
    await page.getByRole('button', { name: /^Fabrikalar/ }).click();
    const comparison = page.waitForEvent('dialog', { predicate: dialog => dialog.message().includes('FABRİKA KARŞILAŞTIRMASI') });
    await factoryModal().getByRole('button', { name: /Tüm Fabrikaları Karşılaştır/ }).click();
    const message = (await comparison).message();
    for (const item of saved) check(message.includes(item.name), true, 'Factory comparison includes ' + item.name);
    check(message.includes('kWh') && message.includes('kVArh'), true, 'Comparison preserves active/reactive energy units');
    for (const item of saved) { await factoryCard(item.name).getByRole('button', { name: /Sil/ }).click(); await waitGone('osos_fabrika', item.id); }
  });

  await workflow('osos-logo-url-upload-reset-and-print-media', async () => {
    const name = prefix + 'Logo ve Yazdırma';
    await prepareManualOSOS(name);
    const logoSettings = page.getByRole('heading', { name: 'Logo Ayarları', exact: true }).locator('xpath=..');
    const logoURL = new URL('/public/favicon-32.png', page.url()).href;
    await page.getByPlaceholder('https://ornek.com/logo.png', { exact: true }).fill(logoURL);
    await logoSettings.getByRole('button', { name: 'Güncelle', exact: true }).click();
    check(await logoSettings.locator('img[alt="Logo"]').getAttribute('src'), logoURL, 'OSOS logo URL change uses the selected same-origin image');
    await logoSettings.locator('input[type=file]').setInputFiles(path.resolve(__dirname, '../../public/favicon-32.png'));
    await page.waitForFunction(() => [...document.querySelectorAll('img[alt="Logo"]')].some(image => image.src.startsWith('data:image/png;base64,')));
    const acceptedLogo=await logoSettings.locator('img[alt="Logo"]').getAttribute('src');
    await logoSettings.locator('input[type=file]').setInputFiles({name:'qa-unsupported-logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')});
    check(await logoSettings.locator('img[alt="Logo"]').getAttribute('src'),acceptedLogo,'Unsupported SVG never replaces the raster logo used by PDF export');
    await logoSettings.locator('input[type=file]').setInputFiles({name:'qa-oversized-logo.png',mimeType:'image/png',buffer:Buffer.alloc(1048577)});
    check(await logoSettings.locator('img[alt="Logo"]').getAttribute('src'),acceptedLogo,'Oversized logo never makes saved report exceed the API body limit');
    const pdf = await download('osos-uploaded-logo-pdf', () => page.getByRole('button', { name: 'PDF İndir', exact: true }).click());
    check(/\/Subtype\s*\/Image/.test(pdf.toString('latin1')), true, 'OSOS PDF embeds the uploaded visible report logo');
    await logoSettings.getByTitle('Varsayılan logoya dön', { exact: true }).click();
    check(await page.getByPlaceholder('https://ornek.com/logo.png', { exact: true }).inputValue(), '/calisan/uygulama/fatura_logo.png', 'OSOS logo reset restores default image');
    await page.getByRole('button', { name: 'Düzenleme Modu', exact: true }).click();
    await page.locator('#osos-printable-report').waitFor({ state: 'visible' });
    try {
      await page.emulateMedia({ media: 'print' });
      const printable = await page.locator('#osos-printable-report').evaluate(element => ({ visibility: getComputedStyle(element).visibility, display: getComputedStyle(element).display }));
      check(printable.visibility, 'visible', 'OSOS print media exposes the active report');
      check(printable.display !== 'none', true, 'OSOS report is not display:none in print media');
      const printed = await page.pdf({ path: path.join(output, 'osos-print-media.pdf'), format: 'A4', printBackground: true });
      pdfText('osos-print-media', printed, ['OSOS RAPORU', name, '12.5']);
      report.printArtifacts ||= []; report.printArtifacts.push({ module: 'osos', path: path.join(output, 'osos-print-media.pdf'), kind: 'Chromium print-media PDF; no native print dialog or physical printer tested' });
    } finally { await page.emulateMedia({ media: 'screen' }); }
  });

  await workflow('kesif-custom-product-create-edit-passivate', async () => {
    await mount('kesif'); await page.getByRole('button', { name: 'Yeni Ürün', exact: true }).click();
    const modal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Yeni Ürün Ekle', exact: true }) });
    const name = prefix + 'Yeni Özel Ürün';
    await modal.locator('#newProductName').fill(name); await modal.locator('#newProductPrice').fill('123.45');
    const category = modal.locator('#newProductCategory');
    if (await category.evaluate(element => element.tagName) === 'SELECT') {
      check(await category.locator('option').count() > 0, true, 'A fresh empty-catalog workspace exposes a usable category for creating a custom product');
      await category.selectOption({ index: 0 });
    } else await category.fill('QA Özel');
    await modal.getByRole('button', { name: 'Ürün Ekle', exact: true }).click();
    const product = await waitRow('products', row => row.name === name);
    const card = page.getByRole('heading', { name, exact: true }).locator('xpath=../..'); await card.hover(); await card.getByTitle('Ürünü Düzenle', { exact: true }).click();
    const edit = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Ürün Düzenle', exact: true }) });
    const updatedName = name + ' Güncellendi';
    check(await edit.getByLabel('Kategori',{exact:true}).inputValue(),product.category,'Custom product edit retains its freely entered category');
    await edit.getByLabel('Kategori',{exact:true}).fill('QA Yeni Özel Kategori');
    await edit.getByPlaceholder('Ürün adını girin...', { exact: true }).fill(updatedName); await edit.getByPlaceholder('0.00', { exact: true }).fill('130.5');
    await edit.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await waitRow('products', row => row.id === product.id && row.name === updatedName && Number(row.price) === 130.5 && row.category==='QA Yeni Özel Kategori');
    const updatedCard = page.getByRole('heading', { name: updatedName, exact: true }).locator('xpath=../..'); await updatedCard.hover(); await updatedCard.getByTitle('Ürünü Düzenle', { exact: true }).click();
    await edit.getByRole('button', { name: 'Sil', exact: true }).click();
    await waitRow('products', row => row.id === product.id && row.is_active === false);
    await page.getByRole('heading', { name: updatedName, exact: true }).waitFor({state:'hidden'});
    check(await page.getByRole('heading', { name: updatedName, exact: true }).count(), 0, 'Passivated custom product disappears from selection catalog');
  });

  await workflow('kesif-cart-clipboard-local-email-and-editor-reopen', async () => {
    const name = prefix + 'Araçlar Müşteri', productName = prefix + 'Araçlar Kablo';
    await api(admin, 'company', 'query', { table: 'products', operation: 'insert', rows: [{ name: productName, category: 'QA Kablo', price: 100, original_name: productName }], filters: [], select: '*', returning: true });
    await mount('kesif');
    const productCard = page.getByRole('heading', { name: productName, exact: true }).locator('xpath=../..');
    await productCard.locator('button').last().click(); await productCard.locator('button').last().click();
    check(await page.getByPlaceholder('Açıklama ekle (opsiyonel)...', { exact: true }).count(), 1, 'Adding same product twice merges into one cart row');
    const cart = page.getByPlaceholder('Açıklama ekle (opsiyonel)...', { exact: true }).locator('xpath=../..');
    check(await cart.locator('input[type=number]').first().inputValue(), '2', 'Merged cart row adds quantity');
    await cart.locator('input[type=number]').nth(0).fill('3'); await cart.locator('input[type=number]').nth(1).fill('10');
    await page.getByPlaceholder('Açıklama ekle (opsiyonel)...', { exact: true }).fill('QA saha malzemesi');
    await fill('İskonto (%)', '10'); await fill('Kâr (%)', '20');
    check((await cart.innerText()).includes('324.00 TL'), true, 'Cart quantity, discount and margin produce correct 324.00 TL line total');
    await page.getByRole('button', { name: 'Müşteri Bilgileri', exact: true }).click();
    await page.getByPlaceholder('Örn: ABC İnşaat Ltd. Şti.', { exact: true }).fill(name); await page.getByPlaceholder('Sizin firma adınız', { exact: true }).fill('QA Firma'); await page.getByPlaceholder('Sizin adınız', { exact: true }).fill('QA Yetkili');
    await page.getByRole('button', { name: '✓ Kaydet ve Önizle', exact: true }).click(); await page.locator('#kesif-printable-paper').waitFor({ state: 'visible' }); await closePreview();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await page.getByRole('button', { name: 'Kopyala', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check(copied.includes(productName) && copied.includes('324.00'), true, 'Cart copy writes selected synthetic line and total to isolated browser clipboard');
    const external = [], origin = new URL(page.url()).origin;
    const observe = request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url()); };
    page.on('request', observe);
    try {
      await page.getByRole('button', { name: 'E-posta Taslağı', exact: true }).click();
      const email = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Teklif Mektubu Oluşturucu', exact: true }) });
      const draft = await email.locator('textarea').inputValue();
      check(draft.includes(name) && draft.includes(productName) && draft.includes('356.40'), true, 'Local email draft includes customer/product and exact VAT-inclusive total');
      check(draft.includes('Geçerlilik: 30 gün'),true,'Email draft uses the same selected validity as the PDF');
      await email.locator('textarea').fill(draft + '\nQA düzenlenmiş taslak'); await email.getByRole('button', { name: 'Metni Kopyala', exact: true }).click();
      check((await page.evaluate(() => navigator.clipboard.readText())).includes('QA düzenlenmiş taslak'), true, 'Edited email draft can be copied');
      check(external.length, 0, 'Email draft generation sends no company data to an external service');
      await email.locator('button').first().click();
    } finally { page.off('request', observe); }
    await page.getByRole('button', { name: 'Önizle', exact: true }).click(); await page.locator('#kesif-printable-paper').waitFor({ state: 'visible' });
    await preview().getByRole('button', { name: 'Düzenle', exact: true }).click();
    await page.locator('#kesif-printable-paper p').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' QA-KESIF-EDIT-MARKER');
    await preview().getByRole('button', { name: 'Kaydet', exact: true }).first().click(); await preview().getByRole('button', { name: 'Kaydet', exact: true }).click();
    const saved = await waitRow('company_documents', row => row.kind === 'kesif_teklif' && row.payload?.teklifForm?.musteriAdi === name && row.payload?.reportHtml?.includes('QA-KESIF-EDIT-MARKER'));
    check(saved.payload.discount, 10, 'Keşif saved cart retains selected discount'); check(saved.payload.profit, 20, 'Keşif saved cart retains selected profit'); check(saved.payload.cart[0].kdvOrani, 10, 'Keşif saved cart retains selected VAT');
    await closePreview(); await mount('kesif'); await page.getByRole('button', { name: 'Teklifler', exact: true }).click(); await quoteCard(name).getByRole('button', { name: 'Yükle', exact: true }).click();
    await page.getByRole('button', { name: 'Önizle', exact: true }).click(); await page.locator('#kesif-printable-paper').waitFor({ state: 'visible' });
    check((await page.locator('#kesif-printable-paper').innerText()).includes('QA-KESIF-EDIT-MARKER'), true, 'Saved edited Keşif report reopens with the user edits');
  });

  const componentSource = fs.readFileSync(path.resolve(__dirname, '../staff-app/src/KesifMetraj.jsx'), 'utf8');
  const scenarioLiteral = componentSource.match(/const scenarios = (\[[\s\S]*?\n  \]);/);
  if (!scenarioLiteral) throw Error('Keşif visible scenario configuration was not found for inventory');
  const scenarios = Function('"use strict"; return (' + scenarioLiteral[1] + ');')();
  for (const scenario of scenarios) await workflow('kesif-visible-scenario-' + scenario.id, async () => {
    const created = [];
    try {
      for (const term of [...new Set(scenario.items.map(item => item.search))]) {
        const name = 'QA TEMPLATE ' + term;
        const item = (await api(admin, 'company', 'query', { table: 'products', operation: 'insert', rows: [{ name, category: 'QA Template', price: 10, original_name: name }], filters: [], select: '*', returning: true, single: 'one' })).data;
        created.push(item);
      }
      await mount('kesif'); await page.getByRole('button', { name: 'Örnek Malzeme Şablonları', exact: true }).click();
      await page.getByRole('heading', { name: scenario.name, exact: true }).click();
      const active = (await rows('products')).filter(item => item.is_active !== false);
      const expected = scenario.items.filter(item => active.filter(product => product.name.toLocaleLowerCase('tr-TR').includes(item.search.toLocaleLowerCase('tr-TR')) || product.category.toLocaleLowerCase('tr-TR').includes(item.search.toLocaleLowerCase('tr-TR'))).length === 1);
      check(expected.length > 0, true, scenario.name + ': synthetic catalog provides a deterministic usable match');
      check(await page.getByPlaceholder('Açıklama ekle (opsiyonel)...', { exact: true }).count(), expected.length, scenario.name + ': active scenario adds every unambiguous configured material row');
    } finally {
      for (const item of created) await api(admin, 'company', 'query', { table: 'products', operation: 'delete', filters: [{ field: 'id', op: 'eq', value: item.id }] });
    }
  });

  report.coverageNotes ||= [];
  report.coverageNotes.push('Keşif simple jsPDF path and logo upload/reset are inside a form without an active opener; active preview raster PDF was downloaded. Keşif has no active print control. OSOS browser print invocation and Chromium print-media PDF are checked; no native print dialog or physical printer is claimed.');
};
