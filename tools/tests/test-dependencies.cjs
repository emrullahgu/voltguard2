'use strict';
const path = require('node:path');
const fs = require('node:fs');

// Local app installs and the trusted offline CI image use the same pinned
// compilers. Fall back only when the workspace entry itself is absent; a broken
// installed compiler must fail instead of silently using another installation.
function testDependency(name) {
  if (!['typescript', '@babel/core'].includes(name)) throw new Error('Unsupported test compiler: ' + name);
  const request = path.resolve(__dirname, '../saha-app/node_modules', name);
  try { return require(request); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || error.message.split('\n')[0] !== "Cannot find module '" + request + "'") throw error;
    if (fs.lstatSync(request, { throwIfNoEntry: false })) throw error;
    return require(name);
  }
}

module.exports = { testDependency };
