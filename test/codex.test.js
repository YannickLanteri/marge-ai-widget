'use strict';

const assert = require('assert');
const { normalizeCodex, windowKind, reasonFor } = require('../src/providers/codex');
let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

test('Codex classifies windows by duration, never by slot name', () => {
  assert.strictEqual(windowKind({ windowDurationMins: 300 }), 'session');
  assert.strictEqual(windowKind({ windowDurationMins: 10080 }), 'weekly');
  assert.strictEqual(windowKind({}), 'other');
});

test('weekly-only Codex telemetry does not invent a five-hour ring', () => {
  const result = normalizeCodex({ rateLimits: {
    planType: 'plus',
    primary: { usedPercent: 31, windowDurationMins: 10080, resetsAt: 1780400000 },
    secondary: null
  } });
  assert.strictEqual(result.windows.session, null);
  assert.strictEqual(result.windows.weekly.remainingPercent, 69);
});

test('additional Codex buckets remain visible in the breakdown', () => {
  const result = normalizeCodex({ rateLimitsByLimitId: {
    codex: {
      primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1780000000 },
      secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 1780400000 }
    },
    spark: {
      limitName: 'Codex Spark',
      primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: 1780000000 },
      secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1780400000 }
    }
  } });
  assert.strictEqual(result.details.length, 4);
  assert.strictEqual(result.summaryRemaining, 20);
  assert.strictEqual(result.windows.session.label, 'Codex Spark');
});

test('Codex execution failures have actionable states', () => {
  assert.strictEqual(reasonFor({ code: 'ENOENT' }), 'not-installed');
  assert.strictEqual(reasonFor({ code: 'ETIMEDOUT' }), 'timeout');
  assert.strictEqual(reasonFor({ message: 'not logged in' }), 'no-credentials');
});

process.stdout.write(`\n${passed} Codex tests passed\n`);
