'use strict';

const assert = require('assert');
const app = require('../package.json');
const runtime = require('../install/runtime/package.json');

let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

test('development and user installations pin the same Electron release', () => {
  assert.match(app.devDependencies.electron, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(runtime.dependencies.electron, app.devDependencies.electron);
  assert.strictEqual(app.engines.node, '>=22.12.0');
  assert.strictEqual(app.devDependencies['@electron/fuses'], '2.1.3');
});

test('the project cannot be published accidentally to npm', () => {
  assert.strictEqual(app.private, true);
  assert.strictEqual(app.build.publish, null);
});

test('public project metadata points to the canonical repository', () => {
  assert.strictEqual(app.homepage, 'https://github.com/YannickLanteri/marge-ai-widget#readme');
  assert.strictEqual(app.repository.url,
    'git+https://github.com/YannickLanteri/marge-ai-widget.git');
  assert.strictEqual(app.bugs.url, 'https://github.com/YannickLanteri/marge-ai-widget/issues');
  assert.strictEqual(app.build.appId, 'io.github.yannicklanteri.margeaiwidget');
});

test('packaged applications are ASAR-only and disable Node injection fuses', () => {
  assert.strictEqual(app.build.asar, true);
  assert.strictEqual(app.build.electronFuses.runAsNode, false);
  assert.strictEqual(app.build.electronFuses.enableNodeOptionsEnvironmentVariable, false);
  assert.strictEqual(app.build.electronFuses.enableNodeCliInspectArguments, false);
  assert.strictEqual(app.build.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.strictEqual(app.build.electronFuses.onlyLoadAppFromAsar, true);
  assert.strictEqual(app.build.electronFuses.grantFileProtocolExtraPrivileges, true);
});

test('the public compatibility floor matches Electron 44', () => {
  assert.strictEqual(app.build.mac.minimumSystemVersion, '13.0');
  assert.deepStrictEqual(app.build.mac.target, ['dmg', 'zip']);
  assert.deepStrictEqual(app.build.linux.target, ['AppImage']);
});

process.stdout.write(`\n${passed} package tests passed\n`);
