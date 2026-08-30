'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function electronBinary(moduleDir, platform = process.platform) {
  const suffix = platform === 'darwin'
    ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
    : platform === 'win32' ? 'electron.exe' : 'electron';
  return path.join(moduleDir, 'dist', suffix);
}

function works(binary) {
  const result = spawnSync(binary, ['-e', 'process.exit(0)'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore'
  });
  return !result.error && result.status === 0;
}

function ensure(moduleDir = path.join(__dirname, '..', 'node_modules', 'electron')) {
  const binary = electronBinary(moduleDir);
  if (works(binary)) return binary;

  const result = spawnSync(process.execPath, [path.join(moduleDir, 'install.js')], {
    cwd: moduleDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || !works(binary)) {
    throw new Error('Electron was downloaded but its binary cannot start');
  }
  return binary;
}

if (require.main === module) {
  try {
    const binary = ensure();
    process.stdout.write(`Electron ready: ${binary}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { electronBinary, works, ensure };
