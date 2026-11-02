'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Apache denies the error_log family and existing sensitive extensions while preserving public filenames', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../.htaccess'), 'utf8');
  const rule = [...source.matchAll(/<FilesMatch "([^"]+)">([\s\S]*?)<\/FilesMatch>/g)]
    .find(match => match[1].includes('^error_log'));
  assert.ok(rule, 'the actual error_log FilesMatch directive exists');
  assert.match(rule[2], /\bRequire all denied\b/);
  assert.ok(rule[1].startsWith('(?i)'), 'Apache filename matching stays case insensitive');
  const filenames = new RegExp(rule[1].replace(/^\(\?i\)/, ''), 'i');

  for (const name of [
    'error_log', 'ERROR_LOG', 'error_log.1', 'error_log.20261102', 'error_log.gz',
    'error_log.old', 'error_log.1.gz', 'error_log-1', 'error_log_20261102', 'Error_Log.OLD'
  ]) assert.ok(filenames.test(name), name + ' must be private');

  for (const extension of [
    'env', 'log', 'ini', 'bak', 'sql', 'sh', 'yml', 'yaml', 'lock', 'inc', 'conf',
    'dist', 'swp', 'sqlite', 'sqlite3', 'db', 'toml', 'ps1', 'py', 'md', 'pem', 'key'
  ]) assert.ok(filenames.test('private.' + extension), 'existing extension deny remains: ' + extension);
  assert.ok(filenames.test('index.html~'), 'existing editor backup deny remains');

  for (const name of [
    'index.html', 'main.js', 'style.css', 'catalog.json', 'catalog.pdf', 'photo.webp',
    'download.gz', 'download.zip', 'my_error_log.1', 'error_logging.html', 'error_logger.js'
  ]) assert.equal(filenames.test(name), false, name + ' keeps its existing public filename behavior');
});
