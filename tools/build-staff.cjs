'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of ['header', 'footer']) {
  const data = fs.readFileSync(path.join(root, 'tools/shell', name + '.html'));
  const target = path.join(root, 'calisan', 'shared-' + name + '.html');
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(data)) fs.writeFileSync(target, data);
}
console.log('Çalışan paneli ortak menüsü güncellendi.');
