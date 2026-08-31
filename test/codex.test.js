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

test('an exhausted global week removes misleading five-hour headroom', () => {
  const result = normalizeCodex({ rateLimits: {
    primary: { usedPercent: 20, windowDurationMins: 300 },
    secondary: { usedPercent: 100, windowDurationMins: 10080 }
  } });
  assert.strictEqual(result.windows.session.remainingPercent, 80);
  assert.strictEqual(result.windows.session.effectiveRemainingPercent, 0);
  assert.strictEqual(result.windows.session.blockedBy.kind, 'weekly');
});

test('a week that still has quota does not rewrite the five-hour value', () => {
  const result = normalizeCodex({ rateLimits: {
    primary: { usedPercent: 20, windowDurationMins: 300 },
    secondary: { usedPercent: 90, windowDurationMins: 10080 }
  } });
  assert.strictEqual(result.windows.session.remainingPercent, 80);
  assert.strictEqual(result.windows.session.effectiveRemainingPercent, 80);
  assert.strictEqual(result.windows.session.blockedBy, null);
});

test('a model-specific exhausted week does not block another model session', () => {
  const result = normalizeCodex({ rateLimitsByLimitId: {
    gpt: {
      limitName: 'GPT',
      primary: { usedPercent: 30, windowDurationMins: 300 },
      secondary: { usedPercent: 100, windowDurationMins: 10080 }
    },
    spark: {
      limitName: 'Codex Spark',
      primary: { usedPercent: 40, windowDurationMins: 300 },
      secondary: { usedPercent: 20, windowDurationMins: 10080 }
    }
  } });
  assert.strictEqual(result.windows.weekly.label, 'GPT');
  assert.strictEqual(result.windows.session.label, 'Codex Spark');
  assert.strictEqual(result.windows.session.effectiveRemainingPercent, 60);
});

test('Codex execution failures have actionable states', () => {
  assert.strictEqual(reasonFor({ code: 'ENOENT' }), 'not-installed');
  assert.strictEqual(reasonFor({ code: 'ETIMEDOUT' }), 'timeout');
  assert.strictEqual(reasonFor({ message: 'not logged in' }), 'no-credentials');
});

process.stdout.write(`\n${passed} Codex tests passed\n`);
