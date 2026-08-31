'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../package.json');
const { electronBinary } = require('../tools/ensure-electron');

let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

function pngSize(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.subarray(1, 4).toString(), 'PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('the Electron verifier resolves every supported binary layout', () => {
  assert.strictEqual(electronBinary('/electron', 'darwin'),
    path.join('/electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
  assert.strictEqual(electronBinary('/electron', 'linux'),
    path.join('/electron', 'dist', 'electron'));
  assert.strictEqual(electronBinary('/electron', 'win32'),
    path.join('/electron', 'dist', 'electron.exe'));
});

test('documentation captures are reproducible from a neutral local template', () => {
  const root = path.join(__dirname, '..');
  assert.strictEqual(app.scripts['docs:capture'], 'electron tools/capture-docs.js');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'showcase.html')));
  const captureSource = fs.readFileSync(path.join(root, 'tools', 'capture-docs.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(captureSource, /language: 'en'/);
  assert.match(captureSource, /MARGE_CONFIG_DIR: profile/);
  assert.match(captureSource, /--user-data-dir=/);
  assert.match(mainSource, /!CAPTURE && !app\.requestSingleInstanceLock\(\)/);
  assert.match(mainSource, /app\.setPath\('userData', captureUserData\)/);
  assert.match(mainSource, /MARGE_CAPTURE_VERIFY_ONLY/);
  assert.match(mainSource, /verification\.items === 3/);
  assert.match(mainSource, /verification\.themes > 0/);
  assert.match(mainSource, /capture failed:[\s\S]+app\.exit\(1\)/);
  assert.deepStrictEqual(pngSize(path.join(root, 'docs', 'hero.png')),
    { width: 1800, height: 1100 });
  assert.deepStrictEqual(pngSize(path.join(root, 'docs', 'settings-showcase.png')),
    { width: 1800, height: 1100 });
  for (const readme of ['README.md', 'README.fr.md']) {
    const source = fs.readFileSync(path.join(root, readme), 'utf8');
    assert.match(source, /docs\/hero\.png/);
    assert.match(source, /docs\/settings-showcase\.png/);
  }
});

process.stdout.write(`\n${passed} tooling tests passed\n`);
