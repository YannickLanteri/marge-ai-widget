'use strict';

const { execFile } = require('child_process');

const LOGIN_REASONS = new Set(['no-credentials', 'token-expired', 'unauthorized']);
const TERMINAL_SCRIPT = [
  '-e', 'tell application "Terminal"',
  '-e', 'activate',
  '-e', 'do script "claude auth login"',
  '-e', 'end tell'
];

function canStartClaudeLogin(reason, platform = process.platform) {
  return platform === 'darwin' && LOGIN_REASONS.has(reason);
}

function startClaudeLogin(reason, options = {}) {
  const platform = options.platform || process.platform;
  const run = options.execFile || execFile;
  if (!canStartClaudeLogin(reason, platform)) return Promise.resolve(false);

  return new Promise((resolve) => {
    run('/usr/bin/osascript', TERMINAL_SCRIPT, { timeout: 10000 }, (error) => {
      resolve(!error);
    });
  });
}

module.exports = { canStartClaudeLogin, startClaudeLogin, TERMINAL_SCRIPT };
