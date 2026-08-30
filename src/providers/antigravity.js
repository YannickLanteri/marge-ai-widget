'use strict';

const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { detail, finishService, failedService, clamp } = require('./shared');

const HOST = '127.0.0.1';
const QUOTA_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';
const STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const REQUEST_TIMEOUT_MS = 3000;

function run(file, args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function extractCsrfToken(command) {
  const match = String(command || '').match(
    /--csrf_token(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s"']+))/i);
  return match ? (match[1] || match[2] || match[3] || '').trim() : null;
}

function extractHubPort(command) {
  const match = String(command || '').match(
    /--hub-port(?:=|\s+)(?:"(\d{1,5})"|'(\d{1,5})'|(\d{1,5}))/i);
  if (!match) return null;
  const port = Number(match[1] || match[2] || match[3]);
  return validPort(port) ? port : null;
}

function parseProcesses(stdout, expectedUid = null) {
  return String(stdout || '').split(/\r?\n/).map((line) => {
    const withUid = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (withUid) {
      const uid = Number(withUid[1]);
      if (Number.isFinite(expectedUid) && uid !== expectedUid) return null;
      return { pid: Number(withUid[2]), command: withUid[3] };
    }
    const legacy = line.trim().match(/^(\d+)\s+(.+)$/);
    return legacy ? { pid: Number(legacy[1]), command: legacy[2] } : null;
  }).filter(Boolean).filter((processInfo) => {
    const command = processInfo.command.toLowerCase();
    return (command.includes('language_server') && Boolean(extractCsrfToken(processInfo.command))) ||
      (command.includes('--hub-port') &&
        (command.includes('antigravity') || command.includes('.gemini')));
  }).sort((a, b) => score(b.command) - score(a.command) || b.pid - a.pid);
}

function score(command) {
  const value = String(command || '').toLowerCase();
  let result = 0;
  if (value.includes('--standalone')) result += 8;
  if (value.includes('--override_ide_name antigravity')) result += 6;
  if (value.includes('--app_data_dir antigravity')) result += 4;
  if (value.includes('--app_data_dir=antigravity')) result += 5;
  if (value.includes('--app_data_dir antigravity-ide')) result -= 2;
  return result;
}

function parsePorts(stdout) {
  const ports = [];
  const pattern = /:(\d+)\s+\(LISTEN\)/g;
  let match;
  while ((match = pattern.exec(String(stdout || ''))) !== null) {
    const port = Number(match[1]);
    if (validPort(port)) ports.push(port);
  }
  return [...new Set(ports)];
}

async function listeningPorts(pid) {
  if (process.platform === 'darwin') {
    return parsePorts(await run('lsof', [
      '-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'
    ]));
  }
  const attempts = [
    ['ss', ['-tlnp']],
    ['lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN']],
    ['netstat', ['-tlnp']]
  ];
  for (const [file, args] of attempts) {
    try {
      const output = await run(file, args);
      if (file === 'lsof') return parsePorts(output);
      const pidPattern = new RegExp(file === 'ss' ? `pid=${pid}\\b` : `\\b${pid}/`);
      return [...new Set(output.split(/\r?\n/).filter((line) => pidPattern.test(line))
        .map((line) => Number((line.match(/:(\d+)\s/) || [])[1])).filter(validPort))];
    } catch (_) {}
  }
  return [];
}

function request(protocol, port, token, requestPath, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const transport = protocol === 'https' ? https : http;
    const options = {
      hostname: HOST,
      port,
      path: requestPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Codeium-Csrf-Token': token,
        'Connect-Protocol-Version': '1'
      },
      timeout: REQUEST_TIMEOUT_MS
    };
    if (protocol === 'https') options.rejectUnauthorized = false;
    const req = transport.request(options, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (responseBody.length + chunk.length > 1024 * 1024) {
          req.destroy(new Error('Antigravity response is too large'));
        } else {
          responseBody += chunk;
        }
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`HTTP ${response.statusCode}`));
        }
        try { resolve(JSON.parse(responseBody)); } catch (_) {
          reject(new Error('Invalid Antigravity response'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function localRequest(port, token, requestPath, body) {
  const errors = [];
  for (const protocol of ['https', 'http']) {
    try { return await request(protocol, port, token, requestPath, body); }
    catch (error) { errors.push(error); }
  }
  throw errors[errors.length - 1];
}

function extractConfigToken(html) {
  const match = String(html || '').match(/__APP_CONFIG__\s*=\s*(\{.*?\})\s*;/s);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]).csrfToken;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch (_) {
    return null;
  }
}

function fetchHubToken(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: HOST, port, path: '/', timeout: REQUEST_TIMEOUT_MS },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          if (body.length < 1024 * 1024) body += chunk;
        });
        response.on('end', () => {
          const token = extractConfigToken(body);
          token ? resolve(token) : reject(new Error('Antigravity local token not found'));
        });
      });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function discoverConnection() {
  if (!['darwin', 'linux'].includes(process.platform)) {
    const error = new Error('Unsupported platform');
    error.code = 'UNSUPPORTED';
    throw error;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const candidates = parseProcesses(await run('ps', ['-eo', 'uid=,pid=,args=']), uid);
  if (!candidates.length) {
    const error = new Error('Antigravity is not running');
    error.code = 'NOT_RUNNING';
    throw error;
  }
  let lastError;
  for (const candidate of candidates) {
    try {
      const commandToken = extractCsrfToken(candidate.command);
      const hubPort = extractHubPort(candidate.command);
      const token = commandToken || (hubPort && await fetchHubToken(hubPort));
      const ports = hubPort ? [hubPort] : await listeningPorts(candidate.pid);
      for (const port of ports) {
        try {
          await localRequest(port, token, QUOTA_PATH, {});
          return { port, token };
        } catch (error) { lastError = error; }
      }
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Antigravity local quota service is unavailable');
}

function category(label) {
  const value = String(label || '').toLowerCase();
  return value.includes('gemini') || value.includes('flash') ? 'Gemini' : 'Claude & GPT';
}

function bucketKind(bucket) {
  const value = String(bucket.window || bucket.bucketId || bucket.displayName || '').toLowerCase();
  if (value.includes('weekly') || value.includes('week')) return 'weekly';
  if (value.includes('5h') || value.includes('five') || value.includes('hour')) return 'session';
  return 'other';
}

function normalizeAntigravity(summary, status = {}, fetchedAt = Date.now()) {
  const strictest = new Map();
  for (const group of summary && summary.response && summary.response.groups || []) {
    const label = category(group.displayName);
    for (const bucket of group.buckets || []) {
      const remaining = clamp(Number(bucket.remainingFraction) * 100);
      if (remaining === null) continue;
      const kind = bucketKind(bucket);
      const key = `${label}:${kind}`;
      const item = detail({
        id: key.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        kind,
        scope: 'category',
        label,
        usedPercent: 100 - remaining,
        resetsAt: bucket.resetTime,
        durationMinutes: kind === 'session' ? 300 : kind === 'weekly' ? 10080 : null
      });
      const previous = strictest.get(key);
      if (item && (!previous || item.remainingPercent < previous.remainingPercent)) {
        strictest.set(key, item);
      }
    }
  }

  if (!strictest.size) {
    const models = status.userStatus && status.userStatus.cascadeModelConfigData &&
      status.userStatus.cascadeModelConfigData.clientModelConfigs || [];
    for (const model of models) {
      const remaining = clamp(Number(model.quotaInfo && model.quotaInfo.remainingFraction) * 100);
      if (remaining === null) continue;
      const label = category(model.label);
      const key = `${label}:other`;
      const item = detail({
        id: key.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        kind: 'other', scope: 'category', label, usedPercent: 100 - remaining,
        resetsAt: model.quotaInfo && model.quotaInfo.resetTime
      });
      const previous = strictest.get(key);
      if (item && (!previous || item.remainingPercent < previous.remainingPercent)) {
        strictest.set(key, item);
      }
    }
  }

  const userStatus = status.userStatus || {};
  const plan = userStatus.planStatus && userStatus.planStatus.planInfo &&
    userStatus.planStatus.planInfo.planName || userStatus.plan || status.plan || null;
  const credit = userStatus.userTier && userStatus.userTier.availableCredits &&
    userStatus.userTier.availableCredits[0];
  return finishService({
    id: 'antigravity', name: 'Antigravity', icon: 'antigravity', fetchedAt,
    details: [...strictest.values()], plan,
    meta: { credits: credit && Number(credit.creditAmount) || null }
  });
}

function reasonFor(error) {
  if (error && error.code === 'UNSUPPORTED') return 'unsupported';
  if (error && error.code === 'NOT_RUNNING') return 'not-running';
  if (String(error && error.message).toLowerCase() === 'timeout') return 'timeout';
  return 'unavailable';
}

async function fetchAntigravity() {
  try {
    const { port, token } = await discoverConnection();
    const summary = await localRequest(port, token, QUOTA_PATH, {});
    let status = {};
    try {
      status = await localRequest(port, token, STATUS_PATH,
        { metadata: { ideName: 'antigravity-ide' } });
    } catch (_) {}
    const service = normalizeAntigravity(summary, status);
    return service.ok ? service : failedService('antigravity', 'Antigravity', 'no-data');
  } catch (error) {
    return failedService('antigravity', 'Antigravity', reasonFor(error), { detail: error.message });
  }
}

module.exports = {
  fetchAntigravity, normalizeAntigravity, discoverConnection, extractCsrfToken,
  extractHubPort, parseProcesses, parsePorts, bucketKind, reasonFor
};
