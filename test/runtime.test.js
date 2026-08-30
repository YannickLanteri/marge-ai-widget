'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marge-runtime-'));
const runner = path.join(__dirname, '..', 'bin', 'run-widget');
let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

function rotate(maxBytes = '1024') {
  execFileSync(runner, ['--rotate-only'], {
    env: { ...process.env, MARGE_APP_DIR: root, MARGE_LOG_MAX_BYTES: maxBytes }
  });
}

test('a small runtime log is left alone', () => {
  fs.writeFileSync(path.join(root, 'widget.log'), 'healthy\n');
  rotate();
  assert.strictEqual(fs.readFileSync(path.join(root, 'widget.log'), 'utf8'), 'healthy\n');
  assert.strictEqual(fs.existsSync(path.join(root, 'widget.log.1')), false);
});

test('an oversized runtime log is rotated before launch', () => {
  fs.writeFileSync(path.join(root, 'widget.log'), 'a'.repeat(1024));
  rotate();
  assert.strictEqual(fs.existsSync(path.join(root, 'widget.log')), false);
  assert.strictEqual(fs.statSync(path.join(root, 'widget.log.1')).size, 1024);
});

test('rotation keeps two bounded generations', () => {
  fs.writeFileSync(path.join(root, 'widget.log'), 'b'.repeat(1024));
  rotate();
  assert.strictEqual(fs.statSync(path.join(root, 'widget.log.1')).size, 1024);
  assert.strictEqual(fs.statSync(path.join(root, 'widget.log.2')).size, 1024);
});

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write(`\n${passed} runtime tests passed\n`);
