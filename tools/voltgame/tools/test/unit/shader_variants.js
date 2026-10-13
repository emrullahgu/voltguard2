'use strict';
const assert = require('assert/strict');
const path = require('path');
const cdp = require('../cdp');
const i = process.argv.indexOf('--file');
const file = path.resolve(i >= 0 ? process.argv[i + 1] : path.join(__dirname, '../../../index.html'));
(async () => {
  const page = await cdp.launch({ width: 375, height: 667, mobile: true, touch: true, dpr: 2 });
  try {
    await page.goto(file, { debug: true, lvl: 'M1' });
    await page.waitFor('window.Game && Game.ready', 30000);
    await page.waitFor('PX.solver.ready', 30000);
    await page.evaluate('Game.idle()');
    await cdp.sleep(3000);
    const variants = await page.evaluate(`(() => {
      const byMat = new Map(), clashes=[]; let instanced=0;
      PX.scene.scene.traverse(o=>{ if(!o.material || !o.isMesh)return;
        const mats=Array.isArray(o.material)?o.material:[o.material];
        for(const m of mats){const v=!!o.isInstancedMesh;const old=byMat.get(m.uuid);
          if(old!==undefined && old!==v)clashes.push(m.name);byMat.set(m.uuid,v);
          if(v && m.name==='PX.KIT.instanced')instanced++;}
      }); return {clashes,instanced};
    })()`);
    assert(variants.instanced > 0, 'M1 exercises instanced KIT rails');
    assert.deepEqual(variants.clashes, [], 'normal and instanced meshes have separate materials');
    await page.evaluate(`(() => {window.__programLookups=0;const seen=new Set();
      PX.scene.scene.traverse(o=>{if(!o.material)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
        if(seen.has(m))continue;seen.add(m);const original=m.customProgramCacheKey;
        m.customProgramCacheKey=function(){window.__programLookups++;return original.call(this)};m.needsUpdate=true;
      }}); return true;
    })()`);
    await page.frames(4); await page.evaluate('window.__programLookups=0');
    await page.frames(120);
    assert.equal(await page.evaluate('window.__programLookups'), 0, 'idle frames reuse shader programs');
    const beforePrograms = await page.evaluate('PX.scene.renderer.info.programs.length');
    await page.evaluate(`(async()=>{const L=Game.L(),s=PX.game.state().s;const targets=PX.SIM.walkTargets(L,s);
      const to=targets.find(c=>PX.SIM.walkPath(L,s,c).length>3);if(to===undefined)throw Error('walk target missing');
      Game.cmd({t:'tap',cell:to});await Game.idle();return true})()`);
    assert.equal(await page.evaluate('PX.scene.renderer.info.programs.length'), beforePrograms, 'first walk does not compile a new shader');
    assert.equal(page.exceptions().length, 0);
    console.log('shader variants: instanced KIT materials isolated; 0 program reselections in 120 idle frames');
  } finally { await page.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
