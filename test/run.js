'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tests = fs.readdirSync(__dirname)
  .filter((file) => file.endsWith('.test.js'))
  .sort();

for (const file of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: root,
    env: { ...process.env, MARGE_STATE_FILE: '' },
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write(`\n${tests.length} test files passed\n`);
