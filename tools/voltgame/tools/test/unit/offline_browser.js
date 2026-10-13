'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cdp = require('../cdp');
const i = process.argv.indexOf('--file');
const file = path.resolve(i >= 0 ? process.argv[i + 1] : path.join(__dirname, '../../../index.html'));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-offline-'));
  let page;
  try {
    const standalone = path.join(dir, 'index.html'); fs.copyFileSync(file, standalone);
    page = await cdp.launch({ width: 375, height: 667, mobile: true, touch: true, dpr: 2, allowFileAccess: false, autoplay: false });
    await page.conn.send('Network.enable');
    await page.conn.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    await page.goto(standalone, { debug: true, lvl: 'P1', nostorage: true });
    await page.waitFor('window.Game && Game.ready === true', 30000);
    await page.waitFor('PX.solver.ready', 30000);
    assert.equal(await page.evaluate('THREE.REVISION'), '128');
    const result = await page.evaluate('Game.replay(Game.level("P1").kanit.cozum,{instant:true})');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(await page.evaluate('Game.state().won'), true);
    assert.equal(page.exceptions().length, 0);
    assert.deepEqual(await page.evaluate('PX.BUILD.loadErrors || []'), []);
    console.log('offline browser: standalone file boots, solver runs and P1 completes with all network URLs blocked');
  } finally {
    if (page) await page.close();
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert(path.basename(target).startsWith('px-offline-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
