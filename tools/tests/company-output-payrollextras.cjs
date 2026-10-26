'use strict';

/* Active payroll UI paths omitted by the original real-browser fixture.
 * Uses only its caller's isolated synthetic dataset. No dormant helper is invoked. */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function payrollExtraCases(ctx) {
  const { page, admin, api, rows, waitRow, mount, fill, workflow, check, report, output } = ctx;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)) - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthKey = year + '-' + month;
  const insert = async (table, row) => (await api(admin, 'company', 'query', { table, operation: 'insert', rows: [row], select: '*', filters: [], returning: true, single: 'one' })).data;
  const blue = name => insert('bordro_employees', { name, agreed_salary: 40000, official_salary: 30000, active: true });
  const white = name => insert('beyaz_yaka_employees', { name, monthly_salary: 30000, gross_salary: 30000, start_date: '2026-01-01', active: true });
  const rpc = (name, args) => api(admin, 'company', 'rpc', { name, args });
  const poll = async (read, predicate, label, timeout = 15000) => {
    const end = Date.now() + timeout;
    do { const result = await read(); if (predicate(result)) return result; await page.waitForTimeout(120); } while (Date.now() < end);
    throw Error(label);
  };
  const blueDetail = async employee => {
    await mount('bordro');
    await page.getByRole('button', { name: 'PERSONEL DETAY', exact: true }).click();
    await page.locator('[data-payroll-access] select').filter({ has: page.locator('option[value="' + employee.id + '"]') }).first().selectOption(employee.id);
    await page.getByRole('button', { name: 'AVANS', exact: true }).waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
  };
  const whiteDetail = async employee => {
    await mount('beyaz-yaka');
    await page.locator('tr').filter({ hasText: employee.name }).getByTitle('Bordro Detayı', { exact: true }).click();
    await page.getByRole('button', { name: 'Yeni Kayıt Ekle', exact: true }).waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
  };
  const whitePayroll = employee => waitRow('beyaz_yaka_monthly_payroll', row => row.employee_id === employee.id && row.month === month && row.year === year);
  const expenseModal = () => page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Yeni Kayıt Ekle', exact: true }) });
  const events = [];
  const previousDialogs = page.listeners('dialog');
  page.removeAllListeners('dialog');
  const onDialog = async dialog => {
    const entry = { type: dialog.type(), message: dialog.message() }; events.push(entry);
    try {
      if (dialog.type() === 'prompt') await dialog.accept(dialog.message().includes('"SIL"') ? 'SIL' : dialog.defaultValue() || 'QA Payroll');
      // Explicit autofill is separately exercised. Decline automatic empty-month prompts.
      else if (dialog.type() === 'confirm' && /otomatik olarak doldurulsun/i.test(dialog.message())) await dialog.dismiss();
      else await dialog.accept();
    } catch (error) { if (!/Not attached to an active page|Target (page|context|browser).*closed/i.test(error.message)) report.pageErrors.push({phase:'payroll-dialog',message:error.message}); }
  };
  page.on('dialog', onDialog);
  try {
    for (const [type, button, amount, installments] of [['Avans', 'AVANS', 100.01, 3], ['Gider', 'GİDER', 222.22, 1], ['Prim', 'PRİM', 333.33, 1]]) {
      await workflow('blue-' + type.toLocaleLowerCase('tr-TR') + '-create-delete', async () => {
        const employee = await blue('QA Extra Blue ' + type);
        await blueDetail(employee);
        await page.getByRole('button', { name: button, exact: true }).click();
        const modal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: new RegExp(type + ' Ekle') }) });
        await modal.getByPlaceholder('0.00', { exact: true }).fill(String(amount));
        await modal.locator('input[type=date]').fill(today);
        if (type === 'Avans') await modal.locator('input[type=number]').nth(1).fill(String(installments));
        await modal.getByRole('button', { name: /KAYDET/ }).click();
        const saved = await waitRow('bordro_expenses', row => row.employee_id === employee.id && row.type === type && Number(row.amount) === amount);
        check(saved.installment_total, installments, type + ': blue expense persists intended installment count');
        check(Number(saved.amount), amount, type + ': blue expense stores total, not per-month amount');
        await modal.waitFor({ state: 'hidden' });
        const card = page.locator('[data-payroll-access] div.flex.justify-between.items-start.text-xs.bg-gray-50').filter({ hasText: type }).first();
        await card.waitFor({ state: 'visible' });
        const before = events.length;
        await card.locator('button').last().click();
        await poll(() => rows('bordro_expenses'), records => !records.some(row => row.id === saved.id), 'Blue expense was not deleted');
        check(events.slice(before).some(event => event.type === 'prompt' && event.message.includes('"SIL"')), true, type + ': blue delete reaches explicit security-code prompt');
        check(await card.count(), 0, type + ': deleted expense disappears from active UI');
        if (type === 'Avans') {
          const deletionText = events.slice(before).filter(event => event.type === 'confirm').map(event => event.message).join('\n');
          check(deletionText.includes('100,01'), true, 'Installment delete warning shows the entered total');
          check(deletionText.includes('33,34'), true, 'Installment delete warning shows the selected-period cent-accurate installment');
          check(deletionText.includes('300,03'), false, 'Installment delete warning never multiplies an already-total amount');
          fs.writeFileSync(path.join(output, 'blue-installment-delete-confirmation.txt'), deletionText, 'utf8');
          report.payrollExtraNotes ||= [];
          report.payrollExtraNotes.push({ feature: 'blue-installment-delete-confirmation', text: deletionText, totalStoredAmount: amount });
        }
      });
    }

    await workflow('blue-daily-autofill-history-and-private-backup-recovery', async () => {
      const employee = await blue('QA Extra Blue History');
      await rpc('app_bordro_daily_log_save', { p_employee_id: employee.id, p_day: 1, p_month: month, p_year: year, p_expected_updated_at: null, p_log: { type: 'İzinli', start_time: '08:00', end_time: '18:00', overtime_hours: 0, description: 'QA preserve existing day' } });
      await blueDetail(employee);
      await page.getByRole('button', { name: 'OTOMATİK DOLDUR', exact: true }).click();
      const daily = await poll(() => rows('bordro_daily_logs'), records => records.filter(row => row.employee_id === employee.id && row.month === month && row.year === year).length === daysInMonth, 'Blue explicit autofill did not persist every day', 25000);
      check(daily.find(row => row.employee_id === employee.id && row.day === 1)?.type, 'İzinli', 'Blue autofill preserves preexisting day type');
      await page.getByText(/değişiklik kaydedilmeyi bekliyor/).waitFor({state:'hidden',timeout:30000});
      await page.getByRole('button', { name: 'GEÇMİŞ', exact: true }).click();
      check(events.some(event => event.type === 'alert' && event.message.includes('SON 20 DEĞİŞİKLİK GEÇMİŞİ')), true, 'Blue change history opens visible history alert');
      await page.getByRole('button', { name: 'Ayı Kapat & Kaydet', exact: true }).click();
      const summary = await waitRow('monthly_payroll_summary', row => row.employee_id === employee.id && row.month === month && row.year === year);
      await page.getByRole('button', { name: 'Geçmiş Bordrolar', exact: true }).click();
      const history = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Geçmiş Bordrolar', exact: true }) });
      await history.locator('select').nth(0).selectOption(String(year)); await history.locator('select').nth(1).selectOption(String(month));
      await history.getByRole('button', { name: 'Bordroyu Göster', exact: true }).click();
      const historyRow = history.locator('tr').filter({ hasText: employee.name }); await historyRow.waitFor({ state: 'visible' });
      check(/NaN|Infinity/.test(await historyRow.innerText()), false, 'Blue saved history renders valid summary totals');
      check(Number.isFinite(Number(summary.net_payable)), true, 'Blue saved monthly net is numeric');
      await history.locator('button').first().click();
      const payload = await poll(() => api(admin, 'company', 'bootstrap'), value => {
        const raw = value.data?.storage?.bordro_auto_backup;
        if (!raw) return false;
        try { return JSON.parse(raw).employees.some(row => row.id === employee.id); } catch { return false; }
      }, 'Blue automatic private backup was not durable');
      const backup = JSON.parse(payload.data.storage.bordro_auto_backup);
      check(Object.keys(backup.appData?.[employee.id]?.[monthKey]?.logs || {}).length, daysInMonth, 'Automatic backup retains all persisted month days');
      const restoredName = employee.name + ' Restored Snapshot';
      await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(element => element.textContent.includes('Özel kayıtlarınız şirket sunucusuna kaydediliyor')));
      backup.employees = backup.employees.map(row => row.id === employee.id ? { ...row, name: restoredName } : row);
      await api(admin, 'company', 'storage', { key: 'bordro_auto_backup', value: JSON.stringify(backup) });
      const refreshed = page.waitForResponse(response => response.url().includes('/api/company.php?action=bootstrap'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed; await page.waitForTimeout(150);
      await page.getByTitle('Yedeğen Geri Yükle', { exact: true }).click();
      await page.getByText(restoredName,{exact:true}).first().waitFor({state:'attached'});
      check((await rows('bordro_employees')).find(row => row.id === employee.id)?.name, employee.name, 'Recovery is truthfully an in-memory restore and does not silently rewrite staff master data');
      check(events.some(event => event.type === 'alert' && event.message.includes('geri yüklendi')), true, 'Recovery gives explicit completion notice');
    });

    await workflow('blue-employee-edit-passivate-preserves-history', async () => {
      const employee = await blue('QA Extra Blue Employee Edit');
      await rpc('app_bordro_daily_log_save', { p_employee_id: employee.id, p_day: 1, p_month: month, p_year: year, p_expected_updated_at: null, p_log: { type: 'Normal', start_time: '08:00', end_time: '18:00', overtime_hours: 0, description: 'QA retained history' } });
      await mount('bordro');
      const row = page.locator('tr').filter({ hasText: employee.name }); await row.getByTitle('Bilgileri Düzenle', { exact: true }).click();
      const modal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'Personel Bilgilerini Düzenle', exact: true }) });
      const edited = employee.name + ' Updated';
      await modal.getByPlaceholder('Örn: Ahmet Yılmaz', { exact: true }).fill(edited);
      await modal.getByPlaceholder('Örn: 90000', { exact: true }).fill('41000');
      await modal.getByRole('button', { name: 'GÜNCELLE', exact: true }).click();
      await waitRow('bordro_employees', entry => entry.id === employee.id && entry.name === edited && Number(entry.agreed_salary) === 41000);
      await page.locator('tr').filter({ hasText: edited }).getByTitle('Personeli Sil', { exact: true }).click();
      const inactive = await waitRow('bordro_employees', entry => entry.id === employee.id && entry.active === false);
      check(inactive.name, edited, 'Blue passivation retains edited master record');
      check((await rows('bordro_daily_logs')).some(entry => entry.employee_id === employee.id), true, 'Blue passivation preserves historical daily log');
    });

    for (const [type, amount, installments] of [['Avans', 100.01, 2], ['Gider', 222.22, 1], ['Prim', 333.33, 1]]) {
      await workflow('white-' + type.toLocaleLowerCase('tr-TR') + '-create-delete', async () => {
        const employee = await white('QA Extra White ' + type), description = 'QA Extra ' + type + ' Atomic';
        await whiteDetail(employee);
        await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
        const baseline = await whitePayroll(employee);
        await page.getByRole('button', { name: 'Yeni Kayıt Ekle', exact: true }).click();
        const modal = expenseModal();
        await modal.locator('select').selectOption(type); await fill('Tutar', String(amount), modal); await modal.locator('input[type=date]').fill(today);
        if (type === 'Avans') await fill('Toplam Taksit Sayısı', String(installments), modal);
        await modal.locator('textarea').fill(description); await modal.getByRole('button', { name: 'Kaydet', exact: true }).click();
        const saved = await waitRow('beyaz_yaka_monthly_payroll', entry => entry.employee_id === employee.id && entry.expenses?.some(expense => expense.description === description));
        const expense = saved.expenses.find(entry => entry.description === description);
        check(expense.type, type, type + ': white UI creates the selected expense type');
        check(Number(expense.amount), amount, type + ': white expense retains total entered amount');
        const applied = type === 'Avans' ? 50.01 : amount;
        const direction = type === 'Prim' ? 1 : -1;
        check(Math.round(Number(saved.net_payment) * 100), Math.round((Number(baseline.net_payment) + direction * applied) * 100), type + ': atomic white expense changes current net exactly once');
        if (type === 'Avans') {
          const plan = await waitRow('beyaz_yaka_advances', entry => entry.id === expense.id);
          check(plan.installment_count, 2, 'White advance creates two-installment ledger');
          await page.getByRole('button', { name: 'Sonraki ay', exact: true }).click();
          await page.getByRole('button', { name: 'Kaydın dönemine git', exact: true }).waitFor({ state: 'visible' });
          await page.getByRole('button', { name: 'Kaydın dönemine git', exact: true }).click();
          await page.locator('tr').filter({ hasText: description }).getByTitle('Sil', { exact: true }).waitFor({ state: 'visible' });
        }
        await page.locator('tr').filter({ hasText: description }).getByTitle('Sil', { exact: true }).click();
        const removed = await poll(() => rows('beyaz_yaka_monthly_payroll'), records => records.some(entry => entry.id === saved.id && !entry.expenses?.some(item => item.id === expense.id)), 'White expense not removed');
        const final = removed.find(entry => entry.id === saved.id);
        check(final.expenses.some(entry => entry.id === expense.id), false, type + ': white expense UI delete persists');
        check(Math.round(Number(final.net_payment) * 100), Math.round(Number(baseline.net_payment) * 100), type + ': expense deletion reverses only its applied amount');
        if (type === 'Avans') check((await rows('beyaz_yaka_advances')).some(entry => entry.id === expense.id), false, 'Original-period advance deletion also removes installment plan');
      });
    }

    await workflow('white-employee-edit-passivate-preserves-payroll', async () => {
      const employee = await white('QA Extra White Employee Edit');
      await whiteDetail(employee); await page.getByRole('button', { name: 'Kaydet', exact: true }).click(); const payroll = await whitePayroll(employee);
      await mount('beyaz-yaka'); await page.locator('tr').filter({ hasText: employee.name }).getByTitle('Bilgileri Düzenle', { exact: true }).click();
      const modal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: 'çalışan Düzenle', exact: true }) });
      const edited = employee.name + ' Updated'; await fill('Ad Soyad', edited, modal); await fill('Aylık Net Maaş', '31000', modal); await fill('Pozisyon', 'QA Uzman', modal);
      await modal.getByRole('button', { name: 'Kaydet', exact: true }).click();
      await waitRow('beyaz_yaka_employees', entry => entry.id === employee.id && entry.name === edited && Number(entry.monthly_salary) === 31000);
      await page.locator('tr').filter({ hasText: edited }).getByTitle('çalışanı Sil', { exact: true }).click();
      await waitRow('beyaz_yaka_employees', entry => entry.id === employee.id && entry.active === false);
      check((await rows('beyaz_yaka_monthly_payroll')).some(entry => entry.id === payroll.id), true, 'White passivation preserves saved historical payroll');
    });
  } finally {
    page.off('dialog', onDialog);
    for (const listener of previousDialogs) page.on('dialog', listener);
    fs.writeFileSync(path.join(output, 'payroll-extra-dialogs.json'), JSON.stringify(events, null, 2), 'utf8');
  }
};
