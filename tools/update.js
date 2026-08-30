'use strict';

const path = require('path');
const updater = require('../src/updater');

const root = path.join(__dirname, '..');

async function main() {
  const result = await updater.apply(root, process.execPath, (step) => {
    process.stdout.write(`marge: ${step}\n`);
  });
  if (!result.ok) {
    process.stderr.write(`marge: update refused (${result.reason})\n`);
    if (result.detail) process.stderr.write(`${result.detail}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(result.changed
    ? `marge: updated to ${result.short}\n`
    : 'marge: already up to date\n');
}

main().catch((error) => {
  process.stderr.write(`marge: update failed (${error.message})\n`);
  process.exitCode = 1;
});
