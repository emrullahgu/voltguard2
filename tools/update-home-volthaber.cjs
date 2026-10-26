'use strict';
// Explicit public-data refresh only. Normal builds/tests consume the committed snapshot offline.
// node tools/update-home-volthaber.cjs          refresh after a complete successful read
// node tools/update-home-volthaber.cjs --check  compare current public links without writing
const fs = require('node:fs');
const path = require('node:path');
const reader = require('../js/home-volthaber.js');
const origin = 'https://voltguard.com.tr';
const output = path.join(__dirname, 'data/home-directory-volthaber.json');

async function refresh(args = process.argv.slice(2)) {
  if (args.some(value => value !== '--check')) throw new Error('Desteklenen seçenek: --check');
  const result = await reader.readEntries({origin, fetch:(url, options) => fetch(origin + url, {
    ...options, headers:{...options.headers, 'User-Agent':'VoltGuardDirectoryBot/1.0'}
  }), timeoutMs:15000});
  if (!result.ok || !result.complete) throw new Error('Canlı yayın listesi tam okunamadı; kayıtlı anlık görüntü korundu.');
  if (args.includes('--check')) {
    const current = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
    if (!current || JSON.stringify(current.entries) !== JSON.stringify(result.entries)) {
      console.error('VoltHaber dizin anlık görüntüsü güncel değil.');
      return 1;
    }
    console.log(`VoltHaber anlık görüntüsü güncel (${result.entries.length} yayımlanmış yazı).`);
    return 0;
  }
  const snapshot = {checkedAt:result.checkedAt, entries:result.entries};
  const temporary = output + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + '\n');
  fs.renameSync(temporary, output);
  console.log(`VoltHaber anlık görüntüsü güncellendi (${result.entries.length} yayımlanmış yazı).`);
  return 0;
}

if (require.main === module) refresh().then(code => {process.exitCode = code;}).catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {refresh};
