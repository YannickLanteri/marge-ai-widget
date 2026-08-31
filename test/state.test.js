'use strict';
/* Persisted state. Both fields exist because their absence was a bug: a
   restart used to reset the backoff, and to blank the widget. */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'marge-state-'));
process.env.MARGE_STATE_FILE = path.join(TMP, 'state.json');
const store = require('../src/state');

let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };
const reading = (at) => ({
  fetchedAt: at,
  services: [{ id: 'claude', ok: true, fetchedAt: at }],
  gauges: [{ id: 'claude:session', provider: 'claude', percent: 9 }]
});

test('nothing stored yet is not an error', () => {
  assert.strictEqual(store.restoreLastGood(), null);
  assert.strictEqual(store.restoreFailures(), 0);
});

test('a recent reading comes back, so a restart shows numbers at once', () => {
  const now = Date.now();
  store.save({ lastGood: reading(now - 60000) });
  const restored = store.restoreLastGood(now);
  assert.ok(restored, 'the reading was lost');
  assert.strictEqual(restored.stale, true);
  assert.strictEqual(restored.services[0].stale, true,
    'the renderer would present a restored service as fresh');
  assert.strictEqual(restored.services[0].reason, 'loading');
});

test('a reading older than a day is dropped rather than shown as current', () => {
  const now = Date.now();
  store.save({ lastGood: reading(now - store.MAX_AGE_MS - 1000) });
  assert.strictEqual(store.restoreLastGood(now), null);
});

test('an empty reading is never restored', () => {
  store.save({ lastGood: { fetchedAt: Date.now(), services: [], gauges: [] } });
  assert.strictEqual(store.restoreLastGood(), null);
});

test('the failure count survives, so a restart does not undo the backoff', () => {
  store.save({ failures: 3 });
  assert.strictEqual(store.restoreFailures(), 3);
});

test('a corrupted file does not bring the widget down', () => {
  fs.writeFileSync(process.env.MARGE_STATE_FILE, '{ this is not json');
  assert.deepStrictEqual(store.read(), {});
  assert.strictEqual(store.restoreLastGood(), null);
  assert.strictEqual(store.restoreFailures(), 0);
});

test('saving merges rather than replacing', () => {
  store.write({});
  store.save({ failures: 2 });
  store.save({ alerts: { session: { window: 'w', level: 80 } } });
  const s = store.read();
  assert.strictEqual(s.failures, 2, 'the failure count was wiped by the second save');
  assert.ok(s.alerts.session);
});

test('the first-launch guide is remembered without replacing runtime state', () => {
  store.write({ failures: 2 });
  store.save({ onboardingShown: true });
  const s = store.read();
  assert.strictEqual(s.failures, 2);
  assert.strictEqual(s.onboardingShown, true);
});

fs.rmSync(TMP, { recursive: true, force: true });
process.stdout.write(`\n${passed} state tests passed\n`);
