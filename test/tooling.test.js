'use strict';

const assert = require('assert');
const path = require('path');
const { electronBinary } = require('../tools/ensure-electron');

let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

test('the Electron verifier resolves every supported binary layout', () => {
  assert.strictEqual(electronBinary('/electron', 'darwin'),
    path.join('/electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
  assert.strictEqual(electronBinary('/electron', 'linux'),
    path.join('/electron', 'dist', 'electron'));
  assert.strictEqual(electronBinary('/electron', 'win32'),
    path.join('/electron', 'dist', 'electron.exe'));
});

process.stdout.write(`\n${passed} tooling tests passed\n`);
