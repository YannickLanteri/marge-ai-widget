'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../src/paths');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'marge-paths-'));
let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

test('the public name is used for new configuration', () => {
  assert.strictEqual(paths.configDir({}, home), path.join(home, '.config', 'marge-ai-widget'));
  assert.strictEqual(paths.configFile({}, home),
    path.join(home, '.config', 'marge-ai-widget', 'config.json'));
});

test('XDG_CONFIG_HOME and test overrides are respected', () => {
  assert.strictEqual(paths.configDir({ XDG_CONFIG_HOME: '/tmp/xdg' }, home),
    '/tmp/xdg/marge-ai-widget');
  assert.strictEqual(paths.stateFile({ MARGE_STATE_FILE: '/tmp/state.json' }, home),
    '/tmp/state.json');
});

test('legacy data is copied once without deleting the rollback', () => {
  const legacy = paths.legacyConfigDir(home);
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"theme":"retro"}\n');
  fs.writeFileSync(path.join(legacy, 'state.json'), '{"failures":2}\n');

  assert.deepStrictEqual(paths.migrateLegacy({ env: {}, home }).sort(),
    ['config.json', 'state.json']);
  assert.strictEqual(fs.readFileSync(paths.configFile({}, home), 'utf8'),
    '{"theme":"retro"}\n');
  assert.strictEqual(fs.existsSync(path.join(legacy, 'config.json')), true);

  fs.writeFileSync(paths.configFile({}, home), '{"theme":"midnight"}\n');
  assert.deepStrictEqual(paths.migrateLegacy({ env: {}, home }), []);
  assert.strictEqual(fs.readFileSync(paths.configFile({}, home), 'utf8'),
    '{"theme":"midnight"}\n');
});

test('JSON writes are atomic and private', () => {
  const file = path.join(home, 'private', 'state.json');
  assert.strictEqual(paths.writeJson(file, { failures: 2 }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { failures: 2 });
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith('.tmp')), false);
});

fs.rmSync(home, { recursive: true, force: true });
process.stdout.write(`\n${passed} path tests passed\n`);
