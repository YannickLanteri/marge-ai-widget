'use strict';

const assert = require('assert');
const {
  normalizeAntigravity, extractCsrfToken, extractHubPort, parseProcesses,
  parsePorts, bucketKind
} = require('../src/providers/antigravity');
let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

test('Antigravity command discovery accepts quoted tokens and hub ports', () => {
  assert.strictEqual(extractCsrfToken('language_server --csrf_token="secret-value"'), 'secret-value');
  assert.strictEqual(extractHubPort('agy --hub-port=49152 --app_data_dir=antigravity'), 49152);
});

test('process discovery ignores unrelated commands', () => {
  const result = parseProcesses([
    ' 123 language_server --csrf_token abc --standalone',
    ' 456 node unrelated.js',
    ' 789 agy --hub-port 49001 --app_data_dir=antigravity'
  ].join('\n'));
  assert.deepStrictEqual(result.map((item) => item.pid), [123, 789]);
});

test('process discovery ignores another user', () => {
  const result = parseProcesses([
    ' 501 123 language_server --csrf_token mine --standalone',
    ' 502 456 language_server --csrf_token theirs --standalone'
  ].join('\n'), 501);
  assert.deepStrictEqual(result.map((item) => item.pid), [123]);
});

test('listening ports are parsed and deduplicated', () => {
  assert.deepStrictEqual(parsePorts('x 127.0.0.1:4567 (LISTEN)\ny *:4567 (LISTEN)'), [4567]);
});

test('Antigravity exposes independent five-hour and weekly category quotas', () => {
  const result = normalizeAntigravity({ response: { groups: [
    { displayName: 'Gemini models', buckets: [
      { window: '5h', remainingFraction: 0.8, resetTime: 1780000000000 },
      { window: 'weekly', remainingFraction: 0.6, resetTime: 1780400000000 }
    ] },
    { displayName: 'Other models', buckets: [
      { window: '5h', remainingFraction: 0.3, resetTime: 1780000000000 },
      { window: 'weekly', remainingFraction: 0.4, resetTime: 1780400000000 }
    ] }
  ] } });
  assert.strictEqual(result.details.length, 4);
  assert.strictEqual(result.windows.session.label, 'Claude & GPT');
  assert.strictEqual(result.windows.session.remainingPercent, 30);
  assert.strictEqual(result.windows.weekly.remainingPercent, 40);
});

test('unknown Antigravity buckets remain details without faking a ring', () => {
  assert.strictEqual(bucketKind({ window: 'monthly' }), 'other');
});

process.stdout.write(`\n${passed} Antigravity tests passed\n`);
