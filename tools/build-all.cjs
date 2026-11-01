'use strict';
// Keep the publication dependency order in one place. Never run later writers
// after a failed step, or report an interrupted process as a successful build.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const steps = Object.freeze([
  {name: 'Ekip sayfası', runtime: 'node', script: 'tools/build-team.cjs'},
  {name: 'VoltGame ve çevrimdışı oyun', runtime: 'node', script: 'tools/build-voltgame.cjs'},
  {name: 'VoltSim sayfaları', runtime: 'node', script: 'tools/build-voltsim.cjs'},
  {name: 'Ortak site kabuğu', runtime: 'python', script: 'tools/shell.py', args: ['--quiet']},
  {name: 'Çalışan ortak menüsü', runtime: 'node', script: 'tools/build-staff.cjs'},
  {name: 'Mühendislik araçları ve indirme', runtime: 'node', script: 'tools/build-engineering.cjs'},
  {name: 'Korumalı çalışan uygulaması', runtime: 'node', script: 'tools/build-company.cjs'},
  {name: 'Ana sayfa araç dizini', runtime: 'node', script: 'tools/build-home-directory.cjs'},
  {name: 'Arama dizini', runtime: 'node', script: 'tools/build-search-index.cjs'},
  {name: 'İçerik sürümleri', runtime: 'python', script: 'tools/sync-versions.py'},
].map(step => Object.freeze({...step, args: Object.freeze(step.args || [])})));
const dependencies = Object.freeze([
  ['tools/voltgame/tools/node_modules/terser/package.json', 'npm run setup:game'],
  ['tools/staff-app/node_modules/vite/bin/vite.js', 'npm run setup:staff'],
  ['tools/saha-app/node_modules/expo/bin/cli', 'npm ci --prefix tools/saha-app --ignore-scripts --no-fund'],
]);
class BuildFailure extends Error {
  constructor(message, status = 1) {super(message); this.status = Number.isInteger(status) && status > 0 && status < 256 ? status : 1;}
}
function settings(options = {}) {
  return {directory: options.directory || root, python: options.python || process.env.VG_PYTHON || 'python', runner: options.runner || spawnSync,
    log: options.log || console.log, now: options.now || (() => performance.now())};
}
function preflight(options = {}) {
  const config = settings(options);
  if (Number(process.versions.node.split('.')[0]) < 24) throw new BuildFailure('Node.js 24 veya üstü gerekir.');
  const result = config.runner(config.python, ['--version'], {cwd: config.directory, encoding: 'utf8', windowsHide: true, timeout: 10000});
  if (result.error || result.status !== 0) throw new BuildFailure('Python 3 çalıştırılamadı. Python kurun veya VG_PYTHON ile çalıştırıcı yolunu belirtin.');
  const version = String(result.stdout || result.stderr || '').trim();
  if (!/^Python 3\.\d+\.\d+(?:\S*)?$/.test(version)) throw new BuildFailure('Python 3 gerekir; sürüm doğrulanamadı.');
  for (const step of steps) if (!fs.existsSync(path.join(config.directory, step.script))) throw new BuildFailure('Derleme kaynağı eksik: ' + step.script);
  for (const [file, command] of dependencies) if (!fs.existsSync(path.join(config.directory, file))) throw new BuildFailure('Derleme bağımlılığı eksik. Çalıştırın: ' + command);
  config.log('Ön kontrol: Node.js ' + process.versions.node + ', ' + version + '; derleme bağımlılıkları hazır.');
  return config;
}
function runSteps(selected, options = {}) {
  const config = settings(options), started = config.now();
  for (const [index, step] of selected.entries()) {
    config.log('[' + (index + 1) + '/' + selected.length + '] ' + step.name + ' — ' + step.script);
    const before = config.now(), executable = step.runtime === 'python' ? config.python : process.execPath;
    const result = config.runner(executable, [path.join(config.directory, step.script), ...(step.args || [])], {
      cwd: config.directory, stdio: 'inherit', windowsHide: true, shell: false,
    });
    if (result.error) throw new BuildFailure(step.name + ' başlatılamadı (' + (result.error.code || 'process_error') + '). Sonraki adımlar çalıştırılmadı.');
    if (result.signal) throw new BuildFailure(step.name + ' kesildi (' + result.signal + '). Sonraki adımlar çalıştırılmadı.');
    if (result.status !== 0) throw new BuildFailure(step.name + ' başarısız (çıkış ' + result.status + '). Sonraki adımlar çalıştırılmadı.', result.status);
    config.log('Tamamlandı: ' + step.name + ' (' + ((config.now() - before) / 1000).toFixed(1) + ' sn).');
  }
  config.log('Derleme tamamlandı: ' + selected.length + ' adım, ' + ((config.now() - started) / 1000).toFixed(1) + ' sn.');
}
function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--list') {
    for (const [index, step] of steps.entries()) console.log((index + 1) + '. ' + step.name + ': ' + step.runtime + ' ' + [step.script, ...step.args].join(' '));
    return;
  }
  if (args.length > 1 || args.length === 1 && args[0] !== '--check') throw new BuildFailure('Kullanım: node tools/build-all.cjs [--check | --list]', 2);
  const config = preflight();
  if (args[0] !== '--check') runSteps(steps, config);
}
if (require.main === module) {
  try {main();} catch (error) {console.error(error.message); process.exitCode = error instanceof BuildFailure ? error.status : 1;}
}
module.exports = {steps, preflight, runSteps, BuildFailure};
