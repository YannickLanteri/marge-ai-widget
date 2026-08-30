'use strict';
/**
 * The little that must survive a restart.
 *
 * Two things, and both were bugs before this file existed. The failure count,
 * because a widget restarted while rate limited would otherwise start over at
 * full speed and keep the limit alive. And the last real reading, so a fresh
 * start shows numbers immediately instead of an empty pill while the first
 * request travels.
 */

const fs = require('fs');
const paths = require('./paths');

// The override exists so the tests can exercise a real file without touching
// the user's own state.
const FILE = paths.stateFile();
const MAX_AGE_MS = 24 * 60 * 60 * 1000;   // older readings are not worth showing

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function write(state) {
  return paths.writeJson(FILE, state);
}

/** The stored reading, only if it is recent enough to be worth showing. */
function restoreLastGood(now = Date.now()) {
  const { lastGood } = read();
  if (!lastGood || !lastGood.fetchedAt) return null;
  if (now - lastGood.fetchedAt > MAX_AGE_MS) return null;
  if (!Array.isArray(lastGood.services) || !lastGood.services.length) return null;
  const services = lastGood.services.filter((service) =>
    service && service.ok && Number.isFinite(service.fetchedAt) &&
    now - service.fetchedAt <= MAX_AGE_MS).map((service) => ({
    ...service,
    stale: true,
    reason: 'loading'
  }));
  if (!services.length) return null;
  const alive = new Set(services.map((service) => service.id));
  const gauges = (lastGood.gauges || []).filter((gauge) => alive.has(gauge.provider));
  return { ...lastGood, stale: true, reason: 'loading', services, gauges };
}

/** Failures carry over, so a restart does not undo the backoff. */
function restoreFailures() {
  const { failures } = read();
  return Number.isInteger(failures) && failures > 0 ? failures : 0;
}

function save(patch) {
  return write({ ...read(), ...patch });
}

module.exports = { read, write, save, restoreLastGood, restoreFailures, FILE, MAX_AGE_MS };
