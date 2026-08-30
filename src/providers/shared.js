'use strict';

function clamp(value, min = 0, max = 100) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeReset(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const millis = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function detail(input) {
  const usedPercent = clamp(input.usedPercent);
  if (usedPercent === null) return null;
  return {
    id: input.id,
    kind: input.kind || 'other',
    scope: input.scope || 'all',
    label: input.label || null,
    usedPercent: Math.round(usedPercent),
    remainingPercent: Math.round(100 - usedPercent),
    resetsAt: normalizeReset(input.resetsAt),
    durationMinutes: Number.isFinite(input.durationMinutes) ? input.durationMinutes : null,
    active: input.active === true
  };
}

function chooseWindow(details, kind) {
  const candidates = details.filter((item) => item.kind === kind);
  if (!candidates.length) return null;
  return candidates.reduce((strictest, item) =>
    item.remainingPercent < strictest.remainingPercent ? item : strictest);
}

function finishService(input) {
  const details = (input.details || []).filter(Boolean);
  const windows = {
    session: chooseWindow(details, 'session'),
    weekly: chooseWindow(details, 'weekly')
  };
  const summaryRemaining = details.length
    ? Math.min(...details.map((item) => item.remainingPercent))
    : null;
  return {
    id: input.id,
    name: input.name,
    icon: input.icon || input.id,
    ok: details.length > 0,
    reason: details.length > 0 ? null : (input.reason || 'no-data'),
    fetchedAt: input.fetchedAt || Date.now(),
    windows,
    details,
    summaryRemaining,
    plan: input.plan || null,
    meta: input.meta || {}
  };
}

function failedService(id, name, reason, extra = {}) {
  return {
    id,
    name,
    icon: id,
    ok: false,
    reason,
    fetchedAt: Date.now(),
    windows: { session: null, weekly: null },
    details: [],
    summaryRemaining: null,
    plan: null,
    meta: {},
    ...extra
  };
}

function flattenGauges(services) {
  return (services || []).flatMap((service) => service.ok
    ? service.details.map((item) => ({
      id: `${service.id}:${item.id}`,
      provider: service.id,
      providerName: service.name,
      kind: item.kind,
      model: item.label,
      percent: item.usedPercent,
      resetsAt: item.resetsAt,
      active: item.active
    }))
    : []);
}

module.exports = {
  clamp, normalizeReset, detail, chooseWindow, finishService, failedService, flattenGauges
};
