'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function configDir(env = process.env, home = os.homedir()) {
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return env.MARGE_CONFIG_DIR || path.join(base, 'marge-ai-widget');
}

function legacyConfigDir(home = os.homedir()) {
  return path.join(home, '.config', 'claude-marge');
}

function configFile(env, home) {
  return path.join(configDir(env, home), 'config.json');
}

function stateFile(env, home) {
  if ((env || process.env).MARGE_STATE_FILE) return (env || process.env).MARGE_STATE_FILE;
  return path.join(configDir(env, home), 'state.json');
}

function writeJson(file, value, fileSystem = fs) {
  const directory = path.dirname(file);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fileSystem.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fileSystem.renameSync(temporary, file);
    fileSystem.chmodSync(file, 0o600);
    return true;
  } catch (_) {
    try { fileSystem.unlinkSync(temporary); } catch (_) {}
    return false;
  }
}

/** Copy legacy settings once. The old files stay as a rollback, never as live state. */
function migrateLegacy({ env = process.env, home = os.homedir(), fileSystem = fs } = {}) {
  const current = configDir(env, home);
  const legacy = legacyConfigDir(home);
  if (current === legacy) return [];

  const copied = [];
  for (const name of ['config.json', 'state.json']) {
    const from = path.join(legacy, name);
    const to = path.join(current, name);
    try {
      if (!fileSystem.existsSync(from) || fileSystem.existsSync(to)) continue;
      fileSystem.mkdirSync(current, { recursive: true, mode: 0o700 });
      fileSystem.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      fileSystem.chmodSync(to, 0o600);
      copied.push(name);
    } catch (_) {
      // A migration failure must not prevent the widget from starting.
    }
  }
  return copied;
}

module.exports = {
  configDir, legacyConfigDir, configFile, stateFile, writeJson, migrateLegacy
};
