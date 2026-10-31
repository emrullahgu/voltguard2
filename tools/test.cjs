'use strict';

// Expand test paths explicitly so Node 20 and Windows do not depend on shell globs.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = ['tools/engineering/tests', 'tools/tests'].flatMap(directory =>
  fs.readdirSync(path.join(root, directory)).filter(file => file.endsWith('.test.cjs'))
    .sort().map(file => path.join(directory, file)));
files.push('tools/saha-app/tests/measured-grid.test.cjs', 'tools/saha-app/tests/read-hydration.test.cjs');
const result = spawnSync(process.execPath, ['--test', ...files], {cwd: root, stdio: 'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
