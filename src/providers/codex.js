'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { detail, finishService, failedService, clamp } = require('./shared');

const REQUEST_TIMEOUT_MS = 12000;

function executable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return file;
  } catch (_) {
    return null;
  }
}

function nvmCandidates() {
  const versions = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    return fs.readdirSync(versions)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => path.join(versions, version, 'bin', 'codex'));
  } catch (_) {
    return [];
  }
}

function findCodexBinary() {
  const candidates = [
    process.env.CODEX_BIN,
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    path.join(os.homedir(), '.npm-global', 'bin', 'codex'),
    path.join(os.homedir(), 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    ...nvmCandidates()
  ].filter(Boolean);
  return candidates.map(executable).find(Boolean) || 'codex';
}

function readRateLimits(binary = findCodexBinary()) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let initialized = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(binary, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const send = (message) => {
      if (!settled && child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const handleLine = (line) => {
      let message;
      try { message = JSON.parse(line); } catch (_) { return; }
      if (message.id === 0) {
        if (message.error) return finish(new Error(message.error.message || 'Codex initialization failed'));
        initialized = true;
        send({ method: 'initialized', params: {} });
        send({ method: 'account/rateLimits/read', id: 7 });
      } else if (message.id === 7) {
        if (message.error) return finish(new Error(message.error.message || 'Codex quota lookup failed'));
        finish(null, message.result || {});
      }
    };

    const timer = setTimeout(() => {
      const error = new Error(initialized ? 'Codex quota lookup timed out' : 'Codex App Server timed out');
      error.code = 'ETIMEDOUT';
      finish(error);
    }, REQUEST_TIMEOUT_MS);

    child.on('error', finish);
    child.stdin.on('error', finish);
    child.on('close', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex App Server exited with code ${code}`));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        return finish(new Error('Codex App Server response is too large'));
      }
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      lines.filter(Boolean).forEach(handleLine);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 3000) stderr += chunk;
    });
    send({
      method: 'initialize',
      id: 0,
      params: { clientInfo: { name: 'marge_ai_widget', title: 'Marge AI Widget', version: '0.2.0' } }
    });
  });
}

function windowKind(window) {
  const duration = Number(window && window.windowDurationMins);
  if (!Number.isFinite(duration) || duration <= 0) return 'other';
  return duration >= 24 * 60 ? 'weekly' : 'session';
}

function normalizeCodex(raw, fetchedAt = Date.now()) {
  const details = [];
  const seen = new Set();
  const result = raw && raw.result ? raw.result : raw || {};
  const byId = result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object'
    ? result.rateLimitsByLimitId
    : {};
  const entries = Object.entries(byId);
  if (!entries.length && result.rateLimits) {
    entries.push([result.rateLimits.limitId || 'codex', result.rateLimits]);
  }

  for (const [limitId, limit] of entries) {
    const label = limit.limitName || (limitId === 'codex' ? null : limitId);
    for (const [slot, window] of [['primary', limit.primary], ['secondary', limit.secondary]]) {
      if (!window) continue;
      const usedPercent = clamp(window.usedPercent);
      if (usedPercent === null) continue;
      const kind = windowKind(window);
      const key = `${limitId}:${kind}:${slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = detail({
        id: key,
        kind,
        scope: label ? 'model' : 'all',
        label,
        usedPercent,
        resetsAt: window.resetsAt,
        durationMinutes: Number(window.windowDurationMins),
        active: usedPercent >= 100 || Boolean(limit.rateLimitReachedType)
      });
      if (item) details.push(item);
    }
  }

  const service = finishService({
    id: 'codex',
    name: 'Codex',
    icon: 'codex',
    fetchedAt,
    details,
    plan: (result.rateLimits && result.rateLimits.planType) ||
      (entries[0] && entries[0][1] && entries[0][1].planType) || null,
    meta: {
      resetCredits: result.rateLimitResetCredits &&
        Number.isFinite(result.rateLimitResetCredits.availableCount)
        ? result.rateLimitResetCredits.availableCount
        : null
    }
  });
  return service;
}

function reasonFor(error) {
  const message = String(error && error.message || '').toLowerCase();
  if (error && error.code === 'ENOENT') return 'not-installed';
  if (error && error.code === 'ETIMEDOUT') return 'timeout';
  if (/not logged|login|authentication|credential|unauthorized/.test(message)) return 'no-credentials';
  return 'unavailable';
}

async function fetchCodex() {
  try {
    const service = normalizeCodex(await readRateLimits());
    return service.ok ? service : failedService('codex', 'Codex', 'no-data');
  } catch (error) {
    return failedService('codex', 'Codex', reasonFor(error), { detail: error.message });
  }
}

module.exports = {
  fetchCodex, normalizeCodex, readRateLimits, findCodexBinary, windowKind, reasonFor
};
