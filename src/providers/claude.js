'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { detail, finishService, failedService, clamp } = require('./shared');

const API_HOST = 'api.anthropic.com';
const API_PATH = '/api/oauth/usage';
const CRED_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const KEYCHAIN_SERVICES = ['Claude Code-credentials', 'Claude Code'];

function readCredentials() {
  if (process.platform === 'darwin') {
    for (const service of KEYCHAIN_SERVICES) {
      try {
        const raw = execFileSync('security', [
          'find-generic-password', '-a', os.userInfo().username, '-w', '-s', service
        ], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
        const parsed = JSON.parse(raw.trim());
        if (parsed && parsed.claudeAiOauth) return parsed.claudeAiOauth;
      } catch (_) {}
    }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    return parsed.claudeAiOauth || null;
  } catch (_) {
    return null;
  }
}

function requestUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: API_HOST,
      path: API_PATH,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'marge-ai-widget'
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        if (body.length < 1024 * 1024) body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const error = new Error(`HTTP ${res.statusCode}`);
          error.status = res.statusCode;
          error.body = body.slice(0, 300);
          const retryAfter = parseInt(res.headers['retry-after'], 10);
          if (Number.isFinite(retryAfter)) error.retryAfter = retryAfter;
          return reject(error);
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function used(block) {
  return block && block.utilization !== null && block.utilization !== undefined
    ? clamp(block.utilization)
    : null;
}

function normalizeClaude(raw, fetchedAt = Date.now()) {
  const details = [];
  const add = (input) => {
    const normalized = detail(input);
    if (normalized) details.push(normalized);
  };

  add({ id: 'session', kind: 'session', usedPercent: used(raw.five_hour),
    resetsAt: raw.five_hour && raw.five_hour.resets_at, durationMinutes: 300 });
  add({ id: 'weekly', kind: 'weekly', usedPercent: used(raw.seven_day),
    resetsAt: raw.seven_day && raw.seven_day.resets_at, durationMinutes: 10080 });

  const seen = new Set();
  const addModel = (name, percent, resetsAt, active) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    add({ id: `model-${key}`, kind: 'weekly', scope: 'model', label: name,
      usedPercent: percent, resetsAt, durationMinutes: 10080, active });
  };
  for (const [key, name] of [['seven_day_opus', 'Opus'], ['seven_day_sonnet', 'Sonnet']]) {
    if (raw[key]) addModel(name, used(raw[key]), raw[key].resets_at, false);
  }
  for (const limit of raw.limits || []) {
    const model = limit && limit.kind === 'weekly_scoped' && limit.scope && limit.scope.model;
    if (model && model.display_name) {
      addModel(model.display_name, clamp(limit.percent), limit.resets_at, limit.is_active === true);
    }
  }

  const activeLimit = (raw.limits || []).find((limit) => limit && limit.is_active === true);
  if (activeLimit && activeLimit.kind === 'session') {
    const current = details.find((item) => item.id === 'session');
    if (current) current.active = true;
  }
  if (activeLimit && activeLimit.kind === 'weekly_all') {
    const current = details.find((item) => item.id === 'weekly');
    if (current) current.active = true;
  }

  return finishService({
    id: 'claude', name: 'Claude', icon: 'claude', fetchedAt, details,
    meta: { extraUsageEnabled: raw.extra_usage && raw.extra_usage.is_enabled === true }
  });
}

function reasonFor(error) {
  if (error.status === 401 || error.status === 403) return 'unauthorized';
  if (error.status === 429) return 'rate-limited';
  if (error.status >= 500 || error.status) return 'server';
  if (error.message === 'timeout') return 'timeout';
  return 'network';
}

async function fetchClaude() {
  const credentials = readCredentials();
  if (!credentials || !credentials.accessToken) {
    return failedService('claude', 'Claude', 'no-credentials');
  }
  if (credentials.expiresAt && credentials.expiresAt < Date.now()) {
    return failedService('claude', 'Claude', 'token-expired');
  }
  try {
    const service = normalizeClaude(await requestUsage(credentials.accessToken));
    return service.ok ? service : failedService('claude', 'Claude', 'no-data');
  } catch (error) {
    return failedService('claude', 'Claude', reasonFor(error), {
      retryAfter: error.retryAfter,
      detail: error.body ? `${error.message} ${error.body}` : error.message
    });
  }
}

module.exports = { fetchClaude, normalizeClaude, readCredentials, reasonFor };
