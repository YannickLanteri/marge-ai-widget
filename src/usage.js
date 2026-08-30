'use strict';

const { fetchClaude, normalizeClaude } = require('./providers/claude');
const { fetchCodex, normalizeCodex } = require('./providers/codex');
const { fetchAntigravity, normalizeAntigravity } = require('./providers/antigravity');
const { flattenGauges } = require('./providers/shared');

const PROVIDERS = [fetchClaude, fetchCodex, fetchAntigravity];
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

function summary(services, fetchedAt = Date.now(), fresh = true) {
  const successful = services.filter((service) => service.ok && !service.stale);
  const failures = services.filter((service) => !service.ok || service.stale);
  const rateLimited = failures.find((service) => service.reason === 'rate-limited');
  const retryAfter = failures.map((service) => service.retryAfter)
    .filter(Number.isFinite).reduce((max, value) => Math.max(max, value), 0);
  return {
    ok: fresh ? successful.length > 0 : services.some((service) => service.ok),
    fetchedAt,
    services,
    gauges: flattenGauges(services),
    reason: rateLimited ? 'rate-limited' : failures[0] && failures[0].reason,
    ...(retryAfter ? { retryAfter } : {})
  };
}

function mergeUsage(previous, current, now = Date.now()) {
  const previousById = new Map((previous && previous.services || [])
    .filter((service) => service.ok && now - service.fetchedAt <= MAX_STALE_MS)
    .map((service) => [service.id, service]));
  const displayServices = current.services.map((service) => {
    if (service.ok) return service;
    const prior = previousById.get(service.id);
    return prior ? {
      ...prior,
      stale: true,
      reason: service.reason,
      checkedAt: service.fetchedAt,
      detail: service.detail
    } : service;
  });
  const savedServices = current.services.map((service) =>
    service.ok ? service : previousById.get(service.id))
    .filter((service) => service && service.ok);
  return {
    display: summary(displayServices, current.fetchedAt, current.ok),
    lastGood: summary(savedServices, current.fetchedAt, false)
  };
}

function demoUsage() {
  const fetchedAt = Date.now();
  const claude = normalizeClaude({
    five_hour: { utilization: 28, resets_at: new Date(fetchedAt + 2.7 * 3600000).toISOString() },
    seven_day: { utilization: 59, resets_at: new Date(fetchedAt + 4.3 * 86400000).toISOString() },
    seven_day_opus: { utilization: 76, resets_at: new Date(fetchedAt + 4.3 * 86400000).toISOString() },
    limits: [], extra_usage: { is_enabled: true }
  }, fetchedAt);
  const codex = normalizeCodex({
    rateLimits: { planType: 'plus' },
    rateLimitsByLimitId: {
      codex: {
        planType: 'plus', limitName: null,
        primary: { usedPercent: 42, windowDurationMins: 300,
          resetsAt: Math.floor((fetchedAt + 3.4 * 3600000) / 1000) },
        secondary: { usedPercent: 35, windowDurationMins: 10080,
          resetsAt: Math.floor((fetchedAt + 5.8 * 86400000) / 1000) }
      }
    },
    rateLimitResetCredits: { availableCount: 1 }
  }, fetchedAt);
  const antigravity = normalizeAntigravity({ response: { groups: [
    { displayName: 'Gemini', buckets: [
      { window: '5h', remainingFraction: 0.81, resetTime: fetchedAt + 4.1 * 3600000 },
      { window: 'weekly', remainingFraction: 0.54, resetTime: fetchedAt + 3.2 * 86400000 }
    ] },
    { displayName: 'Other', buckets: [
      { window: '5h', remainingFraction: 0.67, resetTime: fetchedAt + 3.7 * 3600000 },
      { window: 'weekly', remainingFraction: 0.32, resetTime: fetchedAt + 3.2 * 86400000 }
    ] }
  ] } }, { userStatus: { plan: 'Google AI Pro' } }, fetchedAt);
  return summary([claude, codex, antigravity], fetchedAt, true);
}

async function fetchUsage() {
  if (process.env.MARGE_DEMO === '1') return demoUsage();
  const services = await Promise.all(PROVIDERS.map(async (provider) => {
    try { return await provider(); }
    catch (error) {
      return {
        id: 'unknown', name: 'Unknown', icon: 'unknown', ok: false,
        reason: 'unavailable', fetchedAt: Date.now(), windows: {}, details: [],
        summaryRemaining: null, detail: error.message
      };
    }
  }));
  return summary(services, Date.now(), true);
}

module.exports = { fetchUsage, mergeUsage, summary, demoUsage, MAX_STALE_MS };

if (require.main === module) {
  fetchUsage().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
}
