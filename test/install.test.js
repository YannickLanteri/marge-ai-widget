'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const install = path.join(root, 'install.sh');
const uninstall = path.join(root, 'uninstall.sh');
let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

function run(file, args, env = {}) {
  return spawnSync(file, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

test('installer help documents local and repository modes', () => {
  const result = run(install, ['--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /--local/);
  assert.match(result.stdout, /--repo/);
});

test('installer refuses unknown options and non-GitHub remotes', () => {
  assert.notStrictEqual(run(install, ['--unknown']).status, 0);
  const remote = run(install, ['--repo', 'https://example.com/widget.git']);
  assert.notStrictEqual(remote.status, 0);
  assert.match(remote.stderr, /GitHub repository/);
});

test('installer refuses broad destructive targets', () => {
  const result = run(install, ['--local', root], { MARGE_DIR: process.env.HOME });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe installation directory/);
});

test('local snapshots exclude common credentials and private configuration', () => {
  const source = fs.readFileSync(install, 'utf8');
  for (const pattern of ['./.env.*', './.claude', './.codex', './auth.json', './state.json',
    '*.key', '*.pem', '*.p12', '*.mobileprovision']) {
    assert.ok(source.includes(`--exclude='${pattern}'`), `missing exclusion for ${pattern}`);
  }
});

test('uninstaller is purge-explicit and refuses the filesystem root', () => {
  const help = run(uninstall, ['--help']);
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /--purge/);
  assert.notStrictEqual(run(uninstall, [], { MARGE_DIR: '/' }).status, 0);
});

process.stdout.write(`\n${passed} installer tests passed\n`);
