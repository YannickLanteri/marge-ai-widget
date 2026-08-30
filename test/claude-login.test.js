'use strict';

const assert = require('assert');
const {
  canStartClaudeLogin, startClaudeLogin, TERMINAL_SCRIPT
} = require('../src/claude-login');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  process.stdout.write(`  ok  ${name}\n`);
}

async function run() {
  await test('Claude login is offered only for authentication failures on macOS', () => {
    assert.strictEqual(canStartClaudeLogin('no-credentials', 'darwin'), true);
    assert.strictEqual(canStartClaudeLogin('token-expired', 'darwin'), true);
    assert.strictEqual(canStartClaudeLogin('network', 'darwin'), false);
    assert.strictEqual(canStartClaudeLogin('no-credentials', 'linux'), false);
  });

  await test('the Terminal command is fixed and carries no renderer input', async () => {
    let invocation;
    const opened = await startClaudeLogin('no-credentials', {
      platform: 'darwin',
      execFile: (file, args, options, callback) => {
        invocation = { file, args, options };
        callback(null);
      }
    });
    assert.strictEqual(opened, true);
    assert.strictEqual(invocation.file, '/usr/bin/osascript');
    assert.deepStrictEqual(invocation.args, TERMINAL_SCRIPT);
    assert.ok(invocation.args.includes('do script "claude auth login"'));
    assert.strictEqual(invocation.options.timeout, 10000);
  });

  await test('unsupported states never start a process', async () => {
    let called = false;
    const opened = await startClaudeLogin('network', {
      platform: 'darwin',
      execFile: () => { called = true; }
    });
    assert.strictEqual(opened, false);
    assert.strictEqual(called, false);
  });

  await test('a Terminal launch failure is reported to the renderer', async () => {
    const opened = await startClaudeLogin('token-expired', {
      platform: 'darwin',
      execFile: (_file, _args, _options, callback) => callback(new Error('denied'))
    });
    assert.strictEqual(opened, false);
  });

  process.stdout.write(`\n${passed} Claude login tests passed\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
