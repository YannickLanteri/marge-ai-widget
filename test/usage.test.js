'use strict';

const assert = require('assert');
const { normalizeClaude, reasonFor } = require('../src/providers/claude');
const { mergeUsage, summary, demoUsage, MAX_STALE_MS } = require('../src/usage');
let passed = 0;
const test = (name, fn) => { fn(); passed++; process.stdout.write(`  ok  ${name}\n`); };

const base = {
  five_hour: { utilization: 73.4, resets_at: '2026-08-28T13:39:59Z' },
  seven_day: { utilization: 12, resets_at: '2026-09-02T09:59:59Z' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [],
  extra_usage: { is_enabled: false }
};

test('Claude is normalized to used and remaining percentages', () => {
  const result = normalizeClaude(base);
  assert.strictEqual(result.windows.session.usedPercent, 73);
  assert.strictEqual(result.windows.session.remainingPercent, 27);
  assert.strictEqual(result.windows.weekly.remainingPercent, 88);
});

test('a missing Claude window stays missing', () => {
  const result = normalizeClaude({ ...base, five_hour: null });
  assert.strictEqual(result.windows.session, null);
  assert.ok(result.details.every((item) => Number.isFinite(item.remainingPercent)));
});

test('the strictest model quota becomes the service headline', () => {
  const result = normalizeClaude({
    ...base,
    seven_day_opus: { utilization: 94, resets_at: '2026-09-02T09:59:59Z' },
    seven_day_sonnet: { utilization: 30, resets_at: '2026-09-02T09:59:59Z' }
  });
  assert.strictEqual(result.summaryRemaining, 6);
  assert.strictEqual(result.windows.weekly.label, 'Opus');
});

test('duplicate model shapes create one detail only', () => {
  const result = normalizeClaude({
    ...base,
    seven_day_opus: { utilization: 94, resets_at: null },
    limits: [{ kind: 'weekly_scoped', percent: 94, resets_at: null, is_active: true,
      scope: { model: { display_name: 'Opus' } } }]
  });
  assert.strictEqual(result.details.filter((item) => item.label === 'Opus').length, 1);
});

test('provider failures keep only recent real values as stale', () => {
  const now = Date.now();
  const previous = summary([normalizeClaude(base, now - 60000)], now - 60000, false);
  const failed = summary([{ id: 'claude', name: 'Claude', icon: 'claude', ok: false,
    reason: 'network', fetchedAt: now, windows: {}, details: [], summaryRemaining: null }], now, true);
  const merged = mergeUsage(previous, failed, now);
  assert.strictEqual(merged.display.services[0].stale, true);
  assert.strictEqual(merged.display.services[0].summaryRemaining, 27);
  const expired = mergeUsage(previous, failed, now + MAX_STALE_MS + 1);
  assert.strictEqual(expired.display.services[0].ok, false);
});

test('raw provider diagnostics are never retained in the last-good cache', () => {
  const now = Date.now();
  const failed = {
    id: 'claude', name: 'Claude', icon: 'claude', ok: false,
    reason: 'network', fetchedAt: now, windows: {}, details: [], summaryRemaining: null,
    detail: 'private upstream response'
  };
  const codex = {
    id: 'codex', name: 'Codex', icon: 'codex', ok: true,
    fetchedAt: now, windows: {}, details: [], summaryRemaining: 80
  };
  const merged = mergeUsage(null, summary([failed, codex], now, true), now);
  assert.deepStrictEqual(merged.lastGood.services.map((service) => service.id), ['codex']);
  assert.ok(!JSON.stringify(merged.lastGood).includes('private upstream response'));
});

test('the demo always contains exactly the three requested services', () => {
  assert.deepStrictEqual(demoUsage().services.map((service) => service.id),
    ['claude', 'codex', 'antigravity']);
});

test('Claude failures are named precisely', () => {
  assert.strictEqual(reasonFor({ status: 429 }), 'rate-limited');
  assert.strictEqual(reasonFor({ status: 401 }), 'unauthorized');
  assert.strictEqual(reasonFor({ status: 503 }), 'server');
  assert.strictEqual(reasonFor({ message: 'timeout' }), 'timeout');
  assert.strictEqual(reasonFor({}), 'network');
});

process.stdout.write(`\n${passed} multi-provider usage tests passed\n`);
