'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const install = path.join(root, 'install.sh');
const uninstall = path.join(root, 'uninstall.sh');
const launcher = path.join(root, 'bin', 'marge');
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
  const escaped = run(install, ['--local', root], { MARGE_DIR: '/tmp/marge\\unsafe' });
  assert.notStrictEqual(escaped.status, 0);
  assert.match(escaped.stderr, /unsupported characters/);
});

test('local snapshots exclude common credentials and private configuration', () => {
  const source = fs.readFileSync(install, 'utf8');
  for (const pattern of ['./.env.*', './.claude', './.codex', './auth.json', './state.json',
    '*.key', '*.pem', '*.p12', '*.mobileprovision']) {
    assert.ok(source.includes(`--exclude='${pattern}'`), `missing exclusion for ${pattern}`);
  }
});

test('snapshot installations update by reinstalling their canonical repository', () => {
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'marge-snapshot-'));
  const output = path.join(snapshot, 'update.txt');
  fs.mkdirSync(path.join(snapshot, 'bin'));
  fs.copyFileSync(launcher, path.join(snapshot, 'bin', 'marge'));
  fs.chmodSync(path.join(snapshot, 'bin', 'marge'), 0o755);
  fs.writeFileSync(path.join(snapshot, 'package.json'), JSON.stringify({
    repository: { url: 'git+https://github.com/example/widget.git' }
  }));
  fs.writeFileSync(path.join(snapshot, 'install.sh'),
    '#!/bin/sh\nprintf "%s\\n%s\\n%s\\n" "$MARGE_DIR" "$1" "$2" > "$MARGE_TEST_OUTPUT"\n');
  fs.chmodSync(path.join(snapshot, 'install.sh'), 0o755);
  const result = run(path.join(snapshot, 'bin', 'marge'), ['update'], {
    MARGE_TEST_OUTPUT: output
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const [installedDir, mode, repo] = fs.readFileSync(output, 'utf8').trim().split('\n');
  assert.strictEqual(fs.realpathSync(installedDir), fs.realpathSync(snapshot));
  assert.strictEqual(mode, '--repo');
  assert.strictEqual(repo, 'https://github.com/example/widget.git');
  fs.rmSync(snapshot, { recursive: true, force: true });
});

test('uninstaller is purge-explicit and refuses the filesystem root', () => {
  const help = run(uninstall, ['--help']);
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /--purge/);
  assert.notStrictEqual(run(uninstall, [], { MARGE_DIR: '/' }).status, 0);
});

process.stdout.write(`\n${passed} installer tests passed\n`);
