'use strict';

const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'docs', 'showcase.html');
const SOURCE_SCENES = [
  {
    output: 'widget.png',
    env: { MARGE_CAPTURE_SERVICE: 'codex', MARGE_CAPTURE_COLLAPSED: '1' }
  },
  { output: 'settings.png', env: { MARGE_CAPTURE_SETTINGS: '1' } }
];
const SCENES = [
  { name: 'hero', output: 'hero.png' },
  { name: 'settings', output: 'settings-showcase.png' }
];

function captureSources(profile) {
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({
    language: 'en',
    theme: 'midnight',
    timeFormat: '24'
  }));

  for (const scene of SOURCE_SCENES) {
    const target = path.join(ROOT, 'docs', scene.output);
    const result = spawnSync(process.execPath, [
      `--user-data-dir=${path.join(profile, 'electron')}`,
      ROOT,
      '--demo'
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        MARGE_CONFIG_DIR: profile,
        MARGE_STATE_FILE: path.join(profile, 'state.json'),
        MARGE_DEMO: '1',
        MARGE_CAPTURE: target,
        ...scene.env
      }
    });
    if (result.status !== 0 || !fs.existsSync(target)) {
      throw new Error(result.stderr || result.stdout || `Could not capture ${scene.output}`);
    }
    process.stdout.write(result.stdout);
  }
}

async function capture(scene) {
  const win = new BrowserWindow({
    width: 1800,
    height: 1100,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#05070c',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  await win.loadFile(TEMPLATE, { query: { scene: scene.name } });
  await win.webContents.executeJavaScript('document.fonts.ready');
  const image = (await win.webContents.capturePage()).resize({
    width: 1800,
    height: 1100,
    quality: 'best'
  });
  const target = path.join(ROOT, 'docs', scene.output);
  fs.writeFileSync(target, image.toPNG());
  win.destroy();
  process.stdout.write(`capture written: ${target} ${image.getSize().width}x${image.getSize().height}\n`);
}

app.whenReady().then(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'marge-docs-'));
  try {
    captureSources(profile);
    for (const scene of SCENES) await capture(scene);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
    app.quit();
  }
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
  app.quit();
});

app.on('window-all-closed', () => {});
