'use strict';

// Read-only editor status presentation. No browser, network, bootstrap or live data.
const test = require('node:test');
const assert = require('node:assert/strict');
const {schedulerText, renderScheduler} = require('../../js/hesap-volthaber-panel.js');
const stamp = '2026-11-02T14:36:01Z';

function element() {
  let text = '';
  return {
    className: '',
    get textContent() { return text; },
    set textContent(value) { text = value; },
    set innerHTML(value) { throw new Error('Scheduler status must remain plain text.'); },
  };
}

test('the editor shows the actual draft-only scheduler mode and formatted last run', () => {
  const target = element();
  const status = Object.freeze({healthy:true, message:'Zamanlanmış tarama çalışıyor.', lastCronAt:stamp, lastCronMode:'draft-only'});
  const formatted = [];
  renderScheduler(target, status, iso => { formatted.push(iso); return '2 Kasım 2026 17:36'; });
  assert.equal(target.className, 'vhp-alert vhp-alert--ok');
  assert.equal(target.textContent, 'Zamanlanmış tarama çalışıyor. Son zamanlanmış çalışma: 2 Kasım 2026 17:36. Çalışma modu: Yalnız taslak.');
  assert.deepEqual(formatted, [stamp]);
});

test('full scheduler mode remains distinct from draft-only', () => {
  const target = element();
  renderScheduler(target, {healthy:true, message:'Çalışıyor.', lastCronMode:'full'});
  assert.equal(target.textContent, 'Çalışıyor. Çalışma modu: Tam tarama.');
  assert(!target.textContent.includes('Yalnız taslak'));
});

test('legacy and not-yet-run statuses keep their message and time without inventing a mode', () => {
  for (const mode of [undefined, null, '']) {
    const status = {message:'Mevcut durum.', lastCronAt:stamp};
    if (mode !== undefined) status.lastCronMode = mode;
    assert.equal(schedulerText(status, () => 'önceki zaman'), 'Mevcut durum. Son zamanlanmış çalışma: önceki zaman.');
  }
  assert.equal(schedulerText({message:'Zamanlanmış tarama hiç çalışmamış.', lastCronAt:null}), 'Zamanlanmış tarama hiç çalışmamış.');
});

test('unknown modes are reported as unknown rather than being treated as safe draft-only', () => {
  for (const mode of ['drafts-only', 'future-mode', '<img src=x onerror=alert(1)>', true, {}]) {
    const text = schedulerText({message:'Durum.', lastCronMode:mode});
    assert.equal(text, 'Durum. Çalışma modu: Bilinmiyor.');
    assert(!text.includes('Yalnız taslak'));
  }
});

test('missing scheduler data is visibly unavailable and never gets a healthy state', () => {
  for (const status of [undefined, null, 42, 'broken', []]) {
    const target = element();
    renderScheduler(target, status);
    assert.equal(target.textContent, 'Zamanlanmış tarama bilgisi alınamadı.');
    assert.equal(target.className, 'vhp-alert vhp-alert--error');
  }
  assert.doesNotThrow(() => renderScheduler(null, null));
});

test('status content uses plain text and only an explicit healthy boolean gets the success style', () => {
  const target = element();
  const message = '<script>alert("fixture")</script>';
  renderScheduler(target, {healthy:'true', message, lastCronAt:stamp, lastCronMode:'draft-only'}, () => '<time>fixture</time>');
  assert.equal(target.className, 'vhp-alert vhp-alert--error');
  assert.equal(target.textContent, message + ' Son zamanlanmış çalışma: <time>fixture</time>. Çalışma modu: Yalnız taslak.');
});
