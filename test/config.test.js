'use strict';

const assert = require('assert');
const { DEFAULTS, sanitize } = require('../src/config');

let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

test('unknown keys never enter the persisted configuration', () => {
  const result = sanitize({ theme: 'midnight', injected: 'value' });
  assert.strictEqual(Object.hasOwn(result, 'injected'), false);
  assert.deepStrictEqual(Object.keys(result).sort(), Object.keys(DEFAULTS).sort());
});

test('numeric settings are finite and bounded', () => {
  assert.strictEqual(sanitize({ verticalAnchor: 9 }).verticalAnchor, 1);
  assert.strictEqual(sanitize({ verticalAnchor: -2 }).verticalAnchor, 0);
  assert.strictEqual(sanitize({ refreshSeconds: 1 }).refreshSeconds, 30);
  assert.strictEqual(sanitize({ refreshSeconds: Infinity }).refreshSeconds, 300);
  assert.strictEqual(sanitize({ refreshSeconds: 99999 }).refreshSeconds, 3600);
});

test('enumerated values fall back instead of reaching Electron', () => {
  const result = sanitize({ language: '../../x', theme: '<script>', timeFormat: '13' });
  assert.strictEqual(result.language, DEFAULTS.language);
  assert.strictEqual(result.theme, DEFAULTS.theme);
  assert.strictEqual(result.timeFormat, DEFAULTS.timeFormat);
});

test('display ids, thresholds and shortcuts are normalized', () => {
  const result = sanitize({
    displayId: '42:primary', alertAt: [95, '80', 80, -1, 101, 'x'],
    shortcut: `  ${'A'.repeat(100)}  `
  });
  assert.strictEqual(result.displayId, '42:primary');
  assert.deepStrictEqual(result.alertAt, [80, 95]);
  assert.strictEqual(result.shortcut.length, 80);
  assert.strictEqual(sanitize({ displayId: '../bad' }).displayId, 'primary');
});

process.stdout.write(`\n${passed} config tests passed\n`);
