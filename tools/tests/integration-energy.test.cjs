'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const localPhp = path.join(root, '.qa/php/runtime/php.exe');
const php = process.env.VG_PHP_BIN || (fs.existsSync(localPhp) ? localPhp : 'php');
const phpHarness = `define('VG_API', true);
class VgIntegrationError extends Exception {
  public $httpStatus; public $errorCode;
  function __construct($status,$code,$message) { parent::__construct($message); $this->httpStatus=$status; $this->errorCode=$code; }
}
require $argv[1];
$case=json_decode(stream_get_contents(STDIN),true); $calls=[];
try { $data=vg_int_energy($case['action'],$case['input'],function($method,$url,$options) use (&$calls,$case) {
  $calls[]=['method'=>$method,'url'=>$url,'options'=>$options]; return $case['response'];
}); echo json_encode(['ok'=>true,'data'=>$data,'calls'=>$calls],JSON_THROW_ON_ERROR); }
catch(VgIntegrationError $e) { echo json_encode(['ok'=>false,'status'=>$e->httpStatus,'code'=>$e->errorCode,'calls'=>$calls]); }`;
const input = { lat: 38.42, lon: 27.14, peakPower: 2, tilt: 15, azimuth: -90, loss: 14 };
const pvgisFixture = () => ({ inputs: { meteo_data: { radiation_db: 'SYNTHETIC-SOLAR', year_min: 2005, year_max: 2023 } }, outputs: { monthly: { fixed: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, E_m: 100 + i })) } } });
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const nasaFixture = () => ({ header: { range: 'Synthetic 2001–2025 climatology', fill_value: -999 }, parameters: { ALLSKY_SFC_SW_DWN: { units: 'kW-hr/m^2/day' }, T2M: { units: 'C' } }, properties: { parameter: { ALLSKY_SFC_SW_DWN: Object.fromEntries(months.map((m, i) => [m, i === 0 ? 0 : 4])), T2M: Object.fromEntries(months.map(m => [m, -5])) } } });
function provider(action, body, args = input, status = 200) {
  return JSON.parse(execFileSync(php, ['-r', phpHarness, path.join(root, 'api/lib/integration-energy.php')], { input: JSON.stringify({ action, input: args, response: { status, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) } }), encoding: 'utf8' }));
}

test('PVGIS request pins documented schema, aspect, loss and kWp units; sums normalized months', () => {
  const result = provider('pvgis', pvgisFixture());
  assert.equal(result.ok, true);
  const request = result.calls[0], url = new URL(request.url);
  assert.equal(request.method, 'GET'); assert.equal(url.origin + url.pathname, 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc');
  assert.equal(url.searchParams.get('peakpower'), '2'); assert.equal(url.searchParams.get('aspect'), '-90');
  assert.equal(url.searchParams.get('loss'), '14'); assert.equal(url.searchParams.get('mountingplace'), 'free');
  assert.equal(result.data.monthly[0].specificKwhPerKwp, 50);
  assert.equal(result.data.annualEnergyKwh, 1266); assert.equal(result.data.annualSpecificKwhPerKwp, 633);
  assert.deepEqual(result.data.dataPeriod, { startYear: 2005, endYear: 2023 });
  assert.ok(!Number.isNaN(Date.parse(result.data.retrievedAt)));
});

test('solar adapters reject invalid/missing/array/nonfinite inputs before transport', () => {
  for (const args of [{}, { ...input, lat: 91 }, { ...input, lon: -181 }, { ...input, lat: [] }, { ...input, lat: 'NaN' }, { ...input, peakPower: 0 }, { ...input, loss: 101 }, { ...input, tilt: '' }]) {
    const result = provider('pvgis', pvgisFixture(), args);
    assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
  }
});

test('PVGIS rejects missing/duplicate months, negative energies, malformed and busy responses', () => {
  const bad = [];
  const duplicate = pvgisFixture(); duplicate.outputs.monthly.fixed[11].month = 1; bad.push(duplicate);
  const missing = pvgisFixture(); missing.outputs.monthly.fixed.pop(); bad.push(missing);
  const negative = pvgisFixture(); negative.outputs.monthly.fixed[3].E_m = -999; bad.push(negative);
  const numericString = pvgisFixture(); numericString.outputs.monthly.fixed[2].E_m = '100'; bad.push(numericString);
  bad.push('{broken', { error: 'no coverage' });
  for (const body of bad) assert.equal(provider('pvgis', body).status, 502);
  assert.equal(provider('pvgis', pvgisFixture(), input, 429).status, 503);
  assert.equal(provider('pvgis', pvgisFixture(), input, 500).status, 502);
});

test('NASA preserves daily irradiation units, valid zero and negative temperatures; never returns PV production', () => {
  const result = provider('nasa_power', nasaFixture());
  assert.equal(result.ok, true);
  assert.equal(new URL(result.calls[0].url).pathname, '/api/temporal/climatology/point');
  assert.equal(result.data.monthly[0].irradiationKwhPerM2Day, 0); assert.equal(result.data.monthly[0].temperatureC, -5);
  assert.equal(result.data.units.irradiation, 'kWh/m²/day'); assert.equal(result.data.annualEnergyKwh, undefined);
  const badUnits = nasaFixture(); badUnits.parameters.ALLSKY_SFC_SW_DWN.units = 'W/m²';
  assert.equal(provider('nasa_power', badUnits).status, 502);
  const missing = nasaFixture(); missing.properties.parameter.ALLSKY_SFC_SW_DWN.JAN = -999;
  assert.equal(provider('nasa_power', missing).status, 502);
  const tempMissing = nasaFixture(); delete tempMissing.properties.parameter.T2M.DEC;
  assert.equal(provider('nasa_power', tempMissing).status, 502);
});

const E = require(path.join(root, 'js/voltsim/engine.js'));
const X = require(path.join(root, 'js/voltsim/calc/ges.js'));
function ui(fetch) {
  let def;
  const VS = { E: { ...E, ext: { ges: X } }, fmt: (n, d = 0) => Number(n).toFixed(d), fmtPower: String, fmtEnergy: String, register: d => { def = d; }, toast() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/voltsim/mod/ges.js'), 'utf8'), { window: { VoltSim: VS, fetch }, console, setTimeout, clearTimeout, AbortController, URLSearchParams });
  const app = { state: def.defaults(), live: def.initLive(), renders: 0, invalidations: 0, renderControls() { this.renders++; }, invalidate() { this.invalidations++; } };
  const click = label => {
    const button = def.controls(app.state, app).flatMap(g => g.items.filter(Boolean)).filter(c => c.type === 'buttons').flatMap(c => c.items).find(b => b.label.includes(label));
    assert.ok(button, label); return button.onClick(app);
  };
  return { def, app, click };
}
function apiData(action = 'pvgis') {
  const common = { inputs: { lat: 38.42, lon: 27.14 }, source: { dataset: 'SYNTHETIC-SOLAR' }, retrievedAt: '2026-11-01T10:00:00Z' };
  if (action === 'pvgis') return { ...common, provider: 'PVGIS', version: '5.3', dataPeriod: { startYear: 2005, endYear: 2023 }, inputs: { ...common.inputs, peakPower: 1, tilt: 15, azimuth: 0, loss: 14 }, monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, energyKwh: 100, specificKwhPerKwp: 100 })) };
  return { ...common, provider: 'NASA POWER', dataPeriod: { description: 'Synthetic climate period' }, monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, irradiationKwhPerM2Day: 4, temperatureC: 20 })) };
}
const response = data => ({ ok: true, json: async () => ({ api: 'vg-integrations/1', ok: true, data }) });

test('GES fetch uses same-origin gateway, applies confirmed monthly AC data, and does not double count local loss/bifacial gain', async () => {
  let url;
  const { app, def, click } = ui(async u => { url = u; return response(apiData()); });
  await click('PVGIS üretimini al');
  assert.match(url, /^\/api\/integrations\.php\?action=pvgis&/);
  assert.equal(app.state.pvgisMonthly.length, 12); assert.match(app.state.pvgisSource, /2005–2023/);
  const annual = def.compute(app.state).values.annual;
  assert.ok(Math.abs(annual - 360 * 540 / 1000 * 1200) < 1e-6);
  app.state.dcLoss = 30; app.state.soiling = 15; app.state.invEff = 90; app.state.bifacial = true;
  assert.ok(Math.abs(def.compute(app.state).values.annual - annual) < 1e-6, 'final provider energy is not derated again or given synthetic bifacial gain');
});

test('GES failed or malformed refresh preserves last confirmed values and user inputs', async () => {
  let fail = false;
  const { app, click } = ui(async () => fail ? response({ ...apiData(), monthly: [] }) : response(apiData()));
  await click('PVGIS üretimini al'); const saved = JSON.stringify(app.state);
  fail = true; await click('PVGIS üretimini al');
  assert.equal(JSON.stringify(app.state), saved); assert.match(app.live.energyMessage, /korundu/);
});

test('GES suppresses duplicate requests and rejects stale replies after location changes', async () => {
  let resolve, calls = 0;
  const { app, click } = ui(() => { calls++; return new Promise(r => { resolve = r; }); });
  const first = click('PVGIS üretimini al'); await click('PVGIS alınıyor');
  app.state.city = 'Ankara'; resolve(response(apiData())); await first;
  assert.equal(calls, 1); assert.equal(app.state.pvgisMonthly, null); assert.match(app.live.energyMessage, /uygulanmadı/);
});

test('GES pending replies do not overwrite manual monthly edits', async () => {
  let resolve;
  const { app, click } = ui(() => new Promise(r => { resolve = r; }));
  const pending = click('PVGIS üretimini al');
  app.state.pvgisMonthly = Array(12).fill(75); app.state.pvgisSource = 'Manually confirmed source';
  resolve(response(apiData())); await pending;
  assert.equal(app.state.pvgisMonthly[0], 75); assert.equal(app.state.pvgisSource, 'Manually confirmed source');
  assert.match(app.live.energyMessage, /uygulanmadı/);
});

test('GES keeps confirmed data but stops applying it when geometry changes, then can refresh', async () => {
  const { app, def, click } = ui(async () => response(apiData()));
  await click('PVGIS üretimini al'); app.state.tilt = 20;
  const result = def.compute(app.state), dataCheck = result.checks.find(c => c.id === 'data');
  assert.equal(dataCheck.status, 'warn'); assert.equal(app.state.pvgisMonthly[0], 100);
  assert.match(def.readouts(result, app.state).find(r => r.label === 'Yıllık enerji').sub, /senaryosu/);
});

test('NASA UI stores climate context without altering production or design temperatures', async () => {
  const { app, def, click } = ui(async () => response(apiData('nasa_power')));
  const before = { Ta: app.state.Ta, Tmin: app.state.Tmin, Tmax: app.state.Tmax, pvgisMonthly: app.state.pvgisMonthly };
  await click('NASA POWER iklimini al');
  assert.deepEqual({ Ta: app.state.Ta, Tmin: app.state.Tmin, Tmax: app.state.Tmax, pvgisMonthly: app.state.pvgisMonthly }, before);
  assert.equal(app.state.nasaClimate.monthly.length, 12);
  assert.ok(def.controls(app.state, app).some(g => g.items.some(i => i && i.text && i.text.includes('kWh/m²/gün'))));
});

test('PVGIS self-consumption is bounded by annual load and changes with actual production scale', () => {
  const { def, app } = ui();
  app.state.pvgisMonthly = Array(12).fill(100); app.state.profile = 'tek'; app.state.consumption = 10000;
  const high = def.compute(app.state).values;
  assert.ok(high.self <= app.state.consumption + 1, `self ${high.self} must not exceed load`);
  assert.ok(high.selfRatio < 0.1, 'large PV system with small load exports most energy');
  app.state.pvgisMonthly = Array(12).fill(1);
  assert.ok(def.compute(app.state).values.selfRatio > high.selfRatio);
});
