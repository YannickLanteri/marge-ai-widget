'use strict';
/**
 * The widget window, flush against the right edge of the screen.
 *
 * Hover is derived from sampling the cursor position in the main process, then
 * handed to the renderer for exact hit-testing. The window only accepts mouse
 * input while the pointer is over a painted surface, so clicks on transparent
 * desktop space continue to pass through.
 */

const {
  app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, shell,
  Notification, globalShortcut, powerMonitor, session
} = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchUsage, mergeUsage } = require('./usage');
const I18N = require('./i18n');
const {
  nextDelay, shouldRefreshOnReveal, manualRefreshAllowed, adjustFloor, initialDelay
} = require('./schedule');
const autostart = require('./autostart');
const store = require('./state');
const alerts = require('./alerts');
const updater = require('./updater');
const paths = require('./paths');
const { DEFAULTS, sanitize: sanitizeConfig } = require('./config');
const { startClaudeLogin } = require('./claude-login');
const {
  G, layout, boundsForDisplay: computeBounds,
  isOuterRightEdge, inHotZone, insideKeepAlive, pickDisplay, sameBounds
} = require('./geometry');

// Claude, Codex and Antigravity always keep the same physical position.
let rows = 3;
const DEMO = process.env.MARGE_DEMO === '1' || process.argv.includes('--demo');

paths.migrateLegacy();
const CONFIG_PATH = paths.configFile();

function loadConfig() {
  try {
    return sanitizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (_) {
    return { ...DEFAULTS };
  }
}
let config = loadConfig();

/** Reveal needs something to reveal: write the defaults on first use. */
function ensureConfigFile() {
  return fs.existsSync(CONFIG_PATH) || paths.writeJson(CONFIG_PATH, config);
}

async function revealConfig() {
  if (!ensureConfigFile()) return;
  // openPath hands it to the default editor; if nothing is associated with
  // .json it returns a message, and revealing the folder is the fallback.
  const problem = await shell.openPath(CONFIG_PATH);
  if (problem) shell.showItemInFolder(CONFIG_PATH);
}

function saveConfig(next) {
  return paths.writeJson(CONFIG_PATH, next);
}

let win = null;
let tray = null;
let visible = false;
let hideTimer = null;
let pollTimer = null;
let refreshTimer = null;
let lastManualRefreshAt = 0;
let lastData = { ok: false, reason: 'loading', gauges: [], services: [] };
let lastGood = DEMO ? null : store.restoreLastGood();
let failures = DEMO ? 0 : store.restoreFailures();
let inFlight = false;
let pinned = false;       // pill stays out; the panel still follows the cursor
let panelOpen = false;
let interactive = false;
let alertLedger = DEMO ? {} : (store.read().alerts || {});
// Starts at the configured interval rather than zero, or the first refresh
// logs a pace change from nothing to the value it already had.
let floorSeconds = DEMO ? 0 : (store.read().floorSeconds || 0);
let cleanReads = 0;
if (lastGood) lastData = { ...lastGood, stale: true, reason: 'loading' };
let ready = false; // the page finished loading and is listening
let currentDisplayId = null;

// --- Placement --------------------------------------------------------------

function boundsForDisplay(display) {
  return computeBounds(display.workArea, rows, config.verticalAnchor);
}

function activeDisplay() {
  return screen.getAllDisplays().find((d) => d.id === currentDisplayId)
    || screen.getPrimaryDisplay();
}

/** The display the settings say the widget belongs on, right now. */
function preferredDisplay() {
  return pickDisplay({
    displays: screen.getAllDisplays(),
    primaryId: screen.getPrimaryDisplay().id,
    cursorPoint: null,
    follow: false,
    preferredId: config.displayId
  }) || screen.getPrimaryDisplay();
}

/**
 * Screens come and go: a laptop lid closes, a dock is unplugged, a resolution
 * changes. Without this the widget keeps its old coordinates and ends up drawn
 * outside every desktop, which looks exactly like a crash.
 */
let displayTimer = null;
/** Screens announce themselves in bursts; act once, when they settle. */
function onDisplaysChanged() {
  clearTimeout(displayTimer);
  displayTimer = setTimeout(applyDisplayChange, 400);
}

function applyDisplayChange() {
  const displays = screen.getAllDisplays();
  const stillThere = displays.some((d) => d.id === currentDisplayId);
  const target = stillThere && config.followCursorDisplay
    ? activeDisplay()
    : preferredDisplay();
  trace(`displays changed: ${displays.length} present, moving to ${target.id}`);
  placeOn(target);
  if (visible) setPanel(panelOpen);
}

function placeOn(display) {
  if (!win || win.isDestroyed()) return;
  currentDisplayId = display.id;
  const next = boundsForDisplay(display);
  // Moving the window emits display-metrics-changed, which moves the window.
  // Skipping a move that changes nothing is what stops the two feeding each
  // other several times a second.
  if (sameBounds(win.getBounds(), next)) return;
  win.setBounds(next);
}

// --- Window -----------------------------------------------------------------

function hardenWindow(target) {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', (event) => event.preventDefault());
}

function createWindow() {
  const display = preferredDisplay();
  win = new BrowserWindow({
    ...boundsForDisplay(display),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    acceptFirstMouse: false,
    type: process.platform === 'linux' ? 'toolbar' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Throttled while hidden, full speed while shown: setBackgroundThrottling
      // is flipped on reveal, so the entry animation never stutters.
      backgroundThrottling: true
    }
  });
  currentDisplayId = display.id;
  hardenWindow(win);

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);

  win.on('closed', () => {
    trace('window closed');
    // Teardown order matters: the cursor poll keeps firing between the window
    // being destroyed and the quit handler running, and touching a destroyed
    // window throws.
    win = null;
    ready = false;
    interactive = false;
    clearInterval(pollTimer);
    clearTimeout(refreshTimer);
  });
  win.webContents.on('render-process-gone', (_e, d) => trace(`renderer gone: ${d.reason}`));
  win.webContents.on('unresponsive', () => trace('renderer unresponsive'));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    ready = true;
    sendGeometry();
    win.webContents.send('usage', lastData);
    // A hover can happen before loading finishes: replay the current state,
    // otherwise the pill stays invisible until the next hover.
    if (visible) {
      win.webContents.send('reveal', true);
      win.webContents.send('panel', panelOpen);
    }
  });
}

function sendGeometry() {
  if (!win || win.isDestroyed()) return;
  const m = layout(activeDisplay().workArea, rows);
  win.webContents.send('geometry', {
    pillWidth: G.pillWidth,
    ringToLabel: G.ringToLabel,
    ring: m.ring,
    ringLabel: m.label,
    rowGap: m.rowGap,
    pillPadding: m.pillPadding,
    locale: activeLocale(),
    theme: config.theme || 'midnight',
    timeFormat: config.timeFormat || 'auto',
    rows
  });
}

/** Resize when the number of quotas the account exposes changes. */
function setRows(n) {
  const next = Math.max(1, n);
  if (next === rows) return;
  rows = next;
  if (win && !win.isDestroyed()) win.setBounds(boundsForDisplay(activeDisplay()));
  sendGeometry();
}

// --- Reveal and hide --------------------------------------------------------

/**
 * The panel is the expensive half: pinned, it would sit across the screen all
 * day. So pinning keeps the pill out and lets the panel follow the pointer,
 * the same way it does on a normal hover.
 */
function setPanel(open) {
  if (open === panelOpen) return;
  panelOpen = open;
  if (ready && win && !win.isDestroyed()) win.webContents.send('panel', open);
}

function setInteractive(on) {
  const next = on === true && visible;
  if (next === interactive || !win || win.isDestroyed()) return;
  interactive = next;
  win.setIgnoreMouseEvents(!next);
}

function show() {
  if (!win || win.isDestroyed() || visible) return;
  visible = true;
  clearTimeout(hideTimer);
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  if (ready) win.webContents.send('reveal', true);
  if (!pinned) setPanel(true);
  if (shouldRefreshOnReveal(
    lastGood && lastGood.fetchedAt, failures, Date.now(), config.refreshSeconds
  )) refresh();
}

function scheduleHide() {
  if (!visible || hideTimer) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!visible || !win || win.isDestroyed()) return;
    visible = false;
    setInteractive(false);
    setPanel(false);
    if (ready) win.webContents.send('reveal', false);
    // Let the exit animation play before hiding the window.
    setTimeout(() => {
      if (visible || !win || win.isDestroyed()) return;
      win.hide();
      win.webContents.setBackgroundThrottling(true);
    }, 320);
  }, G.hideGrace);
}

function cancelHide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

/** Only cross the process boundary when the pointer actually moved. */
let sentCursor = { x: -999, y: -999 };
function sendCursor(cursor) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const p = { x: cursor.x - b.x, y: cursor.y - b.y };
  if (Math.abs(p.x - sentCursor.x) < 3 && Math.abs(p.y - sentCursor.y) < 3) return;
  sentCursor = p;
  win.webContents.send('cursor', p);
}

/**
 * Sampling the cursor is the only thing this process does continuously, so it
 * runs at two speeds: lazily while nothing is on screen, and smoothly once the
 * widget is out. Same behaviour, a third of the wake-ups.
 */
const POLL_FAR = 320;    // the pointer is nowhere near the edge
const POLL_NEAR = 45;    // approaching: sample as finely as when it is open,
                         // or a fast hand could cross the 4 px strip unseen
const POLL_LIVE = 40;    // the widget is out, the hover has to feel smooth
const NEAR_EDGE = 220;   // how close counts as approaching
let pollRate = POLL_FAR;
function setPollRate(ms) {
  if (ms === pollRate) return;
  pollRate = ms;
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, pollRate);
}

function poll() {
  if (!win || win.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const all = screen.getAllDisplays();

  // Sampling the pointer is the only thing this process does all day. Three
  // speeds: barely, while the mouse is off in the middle of the screen; more
  // attentively as it approaches the edge; and smoothly once the widget is out.
  if (visible || pinned) {
    setPollRate(POLL_LIVE);
  } else {
    const display = screen.getDisplayNearestPoint(cursor);
    const edge = display.workArea.x + display.workArea.width;
    setPollRate(edge - cursor.x <= NEAR_EDGE ? POLL_NEAR : POLL_FAR);
  }

  if (pinned) {
    cancelHide();
    if (!visible) show();
    setPanel(insideKeepAlive(cursor, win.getBounds(), rows, activeDisplay().workArea));
    sendCursor(cursor);
    return;
  }

  if (!visible) {
    const display = screen.getDisplayNearestPoint(cursor);
    if (!isOuterRightEdge(display, all)) return;
    if (inHotZone(cursor, display.workArea, rows, config.verticalAnchor)) {
      if (config.followCursorDisplay && display.id !== currentDisplayId) placeOn(display);
      show();
    }
    return;
  }

  const b = win.getBounds();
  if (DEMO || insideKeepAlive(cursor, b, rows, activeDisplay().workArea)) cancelHide();
  else scheduleHide();
  sendCursor(cursor);
}

// --- Data -------------------------------------------------------------------

/** Nobody at the keyboard means the numbers can wait. */
function idleSeconds() {
  try { return powerMonitor.getSystemIdleTime(); } catch (_) { return 0; }
}

function pacing() {
  return { idleSeconds: idleSeconds(), floorSeconds };
}

/** One log line per state change, never one per minute. */
let lastLogged = null;
function logState(data) {
  const describe = (service) => service.ok
    ? `${service.name} ${service.summaryRemaining}% left`
    : `${service.name} ${service.reason}`;
  const state = data.ok
    ? `ok ${(data.services || []).map(describe).join(', ')}`
    : `failed ${data.reason} (attempt ${failures}, next try in ` +
      `${Math.round(nextDelay(data, failures, config.refreshSeconds, pacing()) / 1000)}s)`;
  if (state === lastLogged) return;
  lastLogged = state;
  process.stdout.write(`[${new Date().toISOString()}] ${state}\n`);
  if (!data.ok && data.detail) process.stdout.write(`  server said: ${data.detail}\n`);
}

/**
 * Ask once, then schedule the next call. A failure never wipes the display:
 * the last real numbers stay on screen, marked stale, because a blank widget
 * teaches less than slightly old figures plus the reason they are old.
 */
async function refresh() {
  if (inFlight) return;
  inFlight = true;
  let data;
  try {
    data = await fetchUsage();
  } finally {
    inFlight = false;
  }

  const merged = mergeUsage(lastGood, data);
  lastGood = merged.lastGood;
  lastData = merged.display;
  const scheduleResult = data.reason === 'rate-limited' ? { ...data, ok: false } : data;

  if (scheduleResult.ok) {
    failures = 0;
    cleanReads += 1;
    if (!DEMO) raiseAlerts(data.gauges, lastData.gauges);
  } else {
    cleanReads = 0;
    failures += 1;
  }

  const previousFloor = floorSeconds || config.refreshSeconds;
  floorSeconds = adjustFloor(floorSeconds, scheduleResult, config.refreshSeconds, cleanReads);
  if (floorSeconds !== previousFloor) {
    trace(`pace now one call every ${floorSeconds}s (was ${previousFloor}s)`);
    if (floorSeconds < previousFloor) cleanReads = 0;
  }
  if (!DEMO) {
    store.save({
      failures,
      floorSeconds,
      alerts: alertLedger,
      ...(lastGood && lastGood.ok ? { lastGood } : {})
    });
  }

  logState(data);
  if (win && !win.isDestroyed()) win.webContents.send('usage', lastData);
  updateTrayTitle();

  clearTimeout(refreshTimer);
  const wait = nextDelay(scheduleResult, failures, config.refreshSeconds, pacing());
  // Remembered so a restart cannot skip the wait we just promised.
  if (!DEMO) store.save({ nextAllowedAt: scheduleResult.ok ? 0 : Date.now() + wait });
  refreshTimer = setTimeout(refresh, wait);
}

function manualRefresh() {
  const now = Date.now();
  if (!manualRefreshAllowed(lastManualRefreshAt, failures, now)) return;
  lastManualRefreshAt = now;
  refresh();
}

function updateTrayTitle() {
  if (!tray || tray.isDestroyed()) return;
  const remaining = (lastData.services || []).filter((service) => service.ok)
    .map((service) => service.summaryRemaining).filter(Number.isFinite);
  const strictest = remaining.length ? Math.min(...remaining) : null;
  const label = strictest !== null ? `Marge AI · ${strictest} %` : IDLE_LABEL;
  tray.setToolTip(label);
  if (process.platform === 'darwin' && strictest !== null) {
    tray.setTitle(` ${strictest}%`);
  }
}

/**
 * Warn before the ceiling, once per level and per reset window. The ledger
 * lives on disk so a restart does not replay every alert you already saw.
 */
function raiseAlerts(gauges, aliveGauges = gauges) {
  const thresholds = Array.isArray(config.alertAt) ? config.alertAt : [];
  if (!thresholds.length || !Notification.isSupported()) return;

  const { raise, ledger } = alerts.due(gauges, thresholds, alertLedger, aliveGauges);
  alertLedger = ledger;

  for (const { gauge, level } of raise) {
    const quota = gauge.model || (gauge.kind === 'session' ? T.session : T.allModels);
    const name = `${gauge.providerName} · ${quota}`;
    new Notification({
      title: T.notifyTitle(level),
      body: T.notifyBody(name, gauge.percent),
      silent: level < 90
    }).show();
  }
}

// --- Status bar icon --------------------------------------------------------

// The tray menu speaks the same language as the window.
/** The language the user pinned, or the system's. */
function activeLocale() {
  return config.language && config.language !== 'auto' ? config.language : app.getLocale();
}
// Electron only knows the system locale after the ready event: called before
// that, app.getLocale() returns an empty string, which silently fell back to
// English and left the tray menu untranslated while the widget was not.
let T = I18N.pick('en');
let MENU = T.menu;

function refreshLanguage() {
  T = I18N.pick(activeLocale());
  MENU = T.menu;
}
const IDLE_LABEL = 'Marge AI';

/** Rebuilt on every change so the checkbox always shows the real state. */
function buildMenu() {
  if (!tray || tray.isDestroyed()) return;
  const atLogin = autostart.isEnabled();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: MENU.refresh, click: () => manualRefresh() },
    { label: MENU.peek, click: () => { show(); setTimeout(scheduleHide, 3000); } },
    { type: 'separator' },
    {
      label: MENU.startAtLogin,
      type: 'checkbox',
      checked: atLogin === true,
      // Unknown state means no service is registered: nothing to toggle.
      enabled: atLogin !== null,
      click: (item) => { autostart.setEnabled(item.checked); buildMenu(); }
    },
    {
      label: MENU.pin,
      type: 'checkbox',
      checked: pinned,
      click: (item) => setPinned(item.checked)
    },
    { label: MENU.restartNow, click: () => autostart.restartNow() },
    { label: MENU.update, click: () => { openSettings(); checkForUpdates({ notify: true }); } },
    { type: 'separator' },
    { label: MENU.open, click: () => openSettings() },
    { label: MENU.reveal, click: () => revealConfig() },
    { type: 'separator' },
    { label: MENU.quit, click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  // macOS reads tray.png as 16 points and picks up tray@2x.png on its own.
  // Linux panels want a bigger bitmap, so they get their own file.
  const iconFile = process.platform === 'darwin' ? 'tray.png' : 'tray-linux.png';
  let image = nativeImage.createFromPath(path.join(__dirname, 'renderer', iconFile));
  if (image.isEmpty()) image = nativeImage.createEmpty();
  if (process.platform === 'darwin') image.setTemplateImage(true);
  try {
    tray = new Tray(image);
  } catch (_) {
    return; // no system tray on this session: carry on without one
  }
  buildMenu();
  updateTrayTitle();
}

/** Pinned mode: the widget stays open until you unpin it. */
function setPinned(on) {
  pinned = on;
  if (pinned) { show(); setPanel(false); } else scheduleHide();
  buildMenu();
}

function registerShortcut() {
  const accelerator = (config.shortcut || '').trim();
  if (!accelerator) return;
  try {
    globalShortcut.register(accelerator, () => setPinned(!pinned));
  } catch (_) {
    // An invalid or already taken accelerator must not stop the widget.
  }
}

// --- Updates -----------------------------------------------------------------

const APP_DIR = path.join(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;
let updateTimer = null;

/**
 * The daily look. It only ever notifies, never installs: pulling code onto
 * someone's machine without them asking is not an update, it is a surprise.
 * Each version is announced once, so a widget left running for a week does not
 * repeat itself every day.
 */
async function checkForUpdates({ notify }) {
  const result = await updater.check(APP_DIR);
  if (notify && result.state === 'available') {
    const announced = store.read().announcedUpdate;
    if (announced !== result.remote.sha && Notification.isSupported()) {
      new Notification({
        title: T.updateTitle,
        body: T.updateBody(result.remote.short)
      }).show();
      store.save({ announcedUpdate: result.remote.sha });
    }
  }
  return result;
}

function scheduleUpdateCheck() {
  clearTimeout(updateTimer);
  if (config.checkUpdates === false) return;
  updateTimer = setTimeout(() => {
    checkForUpdates({ notify: true }).finally(scheduleUpdateCheck);
  }, DAY_MS);
}

// --- Settings window ---------------------------------------------------------

let settingsWin = null;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 820,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: T.settings.title,
    backgroundColor: '#0A0A0B',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  hardenWindow(settingsWin);
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

/**
 * Apply a saved config without restarting: reposition, re-language, re-bind the
 * shortcut, and reschedule the next call. Restarting to see a slider move would
 * be the kind of detail that makes a tool feel cheap.
 */
function applyConfig(next) {
  const before = {
    shortcut: config.shortcut, language: config.language,
    theme: config.theme, timeFormat: config.timeFormat
  };
  config = { ...config, ...next };

  if (typeof next.startAtLogin === 'boolean') autostart.setEnabled(next.startAtLogin);

  if (before.language !== config.language) refreshLanguage();
  if (before.language !== config.language || before.theme !== config.theme ||
      before.timeFormat !== config.timeFormat) {
    sendGeometry();
  }
  if (before.shortcut !== config.shortcut) {
    globalShortcut.unregisterAll();
    registerShortcut();
  }

  placeOn(config.followCursorDisplay ? activeDisplay() : preferredDisplay());
  buildMenu();
  scheduleUpdateCheck();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh,
    nextDelay({ ok: failures === 0 }, failures, config.refreshSeconds, pacing()));
}

// --- Lifecycle --------------------------------------------------------------

if (!app.requestSingleInstanceLock()) app.quit();

// Why did it stop? A widget that exits silently and is restarted by the system
// loses its backoff each time, which is how a rate limit becomes permanent.
// These lines cost nothing and turn a mystery into a fact.
function trace(event) {
  process.stdout.write(`[${new Date().toISOString()}] lifecycle: ${event}\n`);
}
app.on('before-quit', () => trace('before-quit'));
app.on('will-quit', () => trace('will-quit'));
app.on('quit', (_e, code) => trace(`quit code=${code}`));
process.on('exit', (code) => trace(`process exit code=${code}`));
process.on('uncaughtException', (err) => trace(`uncaught: ${err && err.stack}`));
process.on('unhandledRejection', (err) => trace(`unhandled rejection: ${err}`));

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  refreshLanguage();
  trace(`started pid=${process.pid} locale=${app.getLocale()} using=${activeLocale()} menu="${MENU.quit}"`);
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  createTray();

  const owed = DEMO ? 0 : initialDelay(store.read().nextAllowedAt);
  if (owed > 0) {
    trace(`still owed ${Math.round(owed / 1000)}s of backoff from the last run`);
    refreshTimer = setTimeout(refresh, owed);
    if (lastGood) sendGeometry();
  } else {
    refresh();
  }
  pollTimer = setInterval(poll, pollRate);
  registerShortcut();
  // Waking from sleep with hours-old numbers is worse than one extra call.
  // Asleep or locked, there is nobody to read the widget and the account is
  // shared with every other machine: stop asking entirely.
  for (const event of ['suspend', 'lock-screen']) {
    powerMonitor.on(event, () => { trace(`${event}: pausing`); clearTimeout(refreshTimer); });
  }
  for (const event of ['resume', 'unlock-screen']) {
    powerMonitor.on(event, () => { trace(`${event}: resuming`); failures = 0; refresh(); });
  }
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, onDisplaysChanged);
  }
  if (!DEMO) scheduleUpdateCheck();
  // One look shortly after start, once the widget has settled.
  if (!DEMO) {
    setTimeout(() => {
      if (config.checkUpdates !== false) checkForUpdates({ notify: true });
    }, 30000);
  }
  if (DEMO) show(); // showcase mode: stays open, no cursor needed

});

ipcMain.on('request-refresh', () => manualRefresh());
ipcMain.on('set-interactive', (_event, on) => setInteractive(on));
ipcMain.handle('claude:login', async (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  const claude = (lastData.services || []).find((service) => service.id === 'claude');
  const opened = await startClaudeLogin(claude && claude.reason);
  if (opened) {
    setTimeout(manualRefresh, 30000);
    setTimeout(manualRefresh, 90000);
  }
  return opened;
});
ipcMain.on('settings:reveal', () => revealConfig());
ipcMain.handle('settings:load', () => ({ ...config, startAtLogin: autostart.isEnabled() === true }));
ipcMain.handle('settings:save', (_e, next) => {
  const { startAtLogin, ...stored } = next || {};
  const sanitized = sanitizeConfig(stored);
  saveConfig(sanitized);
  applyConfig({ ...sanitized, startAtLogin: startAtLogin === true });
  return true;
});
ipcMain.handle('settings:displays', () => {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    primary: d.id === primaryId,
    width: d.bounds.width,
    height: d.bounds.height,
    outerRight: isOuterRightEdge(d, screen.getAllDisplays())
  }));
});
ipcMain.handle('updates:check', () => checkForUpdates({ notify: false }));
ipcMain.handle('updates:apply', async () => {
  const send = (step) => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('updates:step', step);
  };
  const result = await updater.apply(APP_DIR, process.execPath, send);
  if (!result.ok) trace(`update failed: ${result.reason} ${result.detail || ''}`.trim());
  if (result.ok && result.changed) {
    trace(`updated to ${result.short}`);
    store.save({ announcedUpdate: result.sha });
    // Give the window a moment to show the result before we go down with it.
    setTimeout(() => autostart.restartNow(), 1200);
  }
  return result;
});

ipcMain.handle('settings:reset', () => {
  saveConfig(DEFAULTS);
  applyConfig(DEFAULTS);
  return { ...DEFAULTS, startAtLogin: autostart.isEnabled() === true };
});

// Control capture: render the window off screen and quit. Used to check the
// real rendering on a machine with no compositor, or in CI.
if (process.env.MARGE_CAPTURE) {
  app.whenReady().then(() => {
    setTimeout(async () => {
      try {
        // MARGE_CAPTURE_SETTINGS shoots the settings window instead.
        let target = win;
        if (process.env.MARGE_CAPTURE_SETTINGS) {
          openSettings();
          await new Promise((r) => setTimeout(r, 2500));
          target = settingsWin;
        }
        const captureService = ['claude', 'codex', 'antigravity']
          .includes(process.env.MARGE_CAPTURE_SERVICE) ? process.env.MARGE_CAPTURE_SERVICE : null;
        if ((process.env.MARGE_CAPTURE_EXPANDED || captureService) && target === win) {
          const selector = captureService
            ? `.item[data-service="${captureService}"]`
            : '.item.hot, .item';
          await target.webContents.executeJavaScript(
            `document.querySelector('${selector}')?.click()`
          );
          await new Promise((r) => setTimeout(r, 350));
        }
        const image = await target.webContents.capturePage();
        fs.writeFileSync(process.env.MARGE_CAPTURE, image.toPNG());
        process.stdout.write(`capture written: ${process.env.MARGE_CAPTURE} ` +
          `${image.getSize().width}x${image.getSize().height}\n`);
      } catch (err) {
        console.error('capture failed:', err.message);
      }
      app.exit(0);
    }, 4000);
  });
}

// The widget has no main window to close: it never quits on its own.
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  clearInterval(pollTimer);
  clearTimeout(refreshTimer);
  clearTimeout(updateTimer);
  globalShortcut.unregisterAll();
});
