'use strict';

let LOCALE = navigator.language || 'en';
let T = I18N.pick(LOCALE);

const stage = document.getElementById('stage');
const pill = document.getElementById('pill');
const panel = document.getElementById('panel');
const panelRows = document.getElementById('panelRows');
const panelMark = document.getElementById('panelMark');
const panelNote = document.getElementById('panelNote');
const panelTail = document.getElementById('panelTail');
const panelTitle = document.getElementById('panelTitle');

const ICONS = {
  claude: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <path d="M12 3.2v17.6M3.2 12h17.6M5.8 5.8l12.4 12.4M18.2 5.8L5.8 18.2"/>
  </svg>`,
  codex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8.8 3.4 5.1 5.5v4.3L2.5 11.3v4.2l3.7 2.1 2.6-1.5 3.7 2.1 3.7-2.1v-3l2.6-1.5V7.4l-3.7-2.1-2.6 1.5z"/>
    <path d="m8.8 7.7 3.7-2.1 3.7 2.1v4.2l-3.7 2.2-3.7-2.2zM6.2 9.2l2.6-1.5M6.2 13.4l2.6-1.5M12.5 14.1v4.1"/>
  </svg>`,
  antigravity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round">
    <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>
    <ellipse cx="12" cy="12" rx="9" ry="4.2" transform="rotate(-24 12 12)"/>
    <ellipse cx="12" cy="12" rx="9" ry="4.2" transform="rotate(56 12 12)"/>
  </svg>`
};

const BRAND = { claude: '#D97757', codex: '#55C89F', antigravity: '#8B7CFF' };
const DEFAULT_SERVICES = [
  { id: 'claude', name: 'Claude', icon: 'claude' },
  { id: 'codex', name: 'Codex', icon: 'codex' },
  { id: 'antigravity', name: 'Antigravity', icon: 'antigravity' }
];

let geo = { pillWidth: 164, ring: 60, ringLabel: 22, ringToLabel: 10, rowGap: 20, pillPadding: 20 };
let theme = THEMES.DEFAULT;
let timeFormat = 'auto';
let data = { ok: false, reason: 'loading', services: [] };
let revealed = false;
let panelOpen = false;
let items = [];
let hotIndex = 0;
let tickTimer = null;
let ringCentres = [];
let hitRegions = null;
let expanded = false;
let interactive = false;

function services() {
  const byId = new Map((data.services || []).map((service) => [service.id, service]));
  return DEFAULT_SERVICES.map((fallback) => byId.get(fallback.id) || {
    ...fallback,
    ok: false,
    reason: data.reason || 'loading',
    fetchedAt: data.fetchedAt || Date.now(),
    windows: { session: null, weekly: null },
    details: [],
    summaryRemaining: null
  });
}

function tone(remaining) {
  if (remaining <= 10) return 'var(--crit)';
  if (remaining <= 30) return 'var(--hot)';
  if (remaining <= 65) return 'var(--warm)';
  return 'var(--ok)';
}

function durationUntil(value) {
  if (!value) return null;
  const millis = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(millis)) return null;
  const minutes = Math.max(0, Math.round(millis / 60000));
  if (minutes === 0) return T.resetNow;
  if (minutes < 60) return T.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return T.hours(hours, minutes % 60);
  return T.days(Math.floor(hours / 24), hours % 24);
}

function formatReset(value, exact = false) {
  const duration = durationUntil(value);
  if (!duration) return T.notReported;
  if (duration === T.resetNow) return duration;
  const relative = T.resetIn(duration);
  if (!exact) return relative;
  const at = new Date(value);
  const date = at.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${relative} · ${date}, ${FORMAT.formatTime(at, LOCALE, timeFormat)}`;
}

function windowLabel(item, fallbackKind) {
  const kind = item && item.kind || fallbackKind;
  const duration = item && item.durationMinutes;
  if (kind === 'weekly') return T.windowWeekly;
  if (kind === 'session' && duration && duration !== 300) return T.windowMinutes(duration);
  if (kind === 'session') return T.window5h;
  return T.windowOther;
}

function detailLabel(item) {
  const windowName = windowLabel(item, item.kind);
  return `${item.label || T.allModels} · ${windowName}`;
}

function countTo(element, from, to, duration) {
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = `${Math.round(from + (to - from) * eased)}%`;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function applyTheme() {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(THEMES.widgetVars(theme))) root.setProperty(name, value);
  const selected = THEMES.get(theme);
  document.documentElement.dataset.light = selected.dark ? 'false' : 'true';
  document.documentElement.dataset.sheen = selected.sheen ? '1' : '0';
  document.documentElement.dataset.hasFont = selected.font ? 'true' : 'false';
  document.documentElement.dataset.header = selected.header ? 'true' : 'false';
  document.getElementById('themeCss').textContent = THEMES.themeCss(theme);
}

function applyGeometry() {
  ringCentres = [];
  const root = document.documentElement.style;
  root.setProperty('--pill-w', `${geo.pillWidth}px`);
  root.setProperty('--ring', `${geo.ring}px`);
  root.setProperty('--row-gap', `${geo.rowGap}px`);
  root.setProperty('--pill-pad', `${geo.pillPadding}px`);
  root.setProperty('--ring-gap', `${geo.ringToLabel}px`);
  root.setProperty('--label-h', `${geo.ringLabel}px`);
}

function circleMarkup(className, radius, circumference, missing) {
  return `<circle class="track ${className} ${missing ? 'missing' : ''}"
    cx="${geo.ring / 2}" cy="${geo.ring / 2}" r="${radius}" fill="none"/>
    <circle class="value ${className} ${missing ? 'missing' : ''}"
    cx="${geo.ring / 2}" cy="${geo.ring / 2}" r="${radius}" fill="none"
    stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${circumference.toFixed(2)}"/>`;
}

function ringRemaining(item) {
  return Number.isFinite(item && item.effectiveRemainingPercent)
    ? item.effectiveRemainingPercent
    : item && item.remainingPercent;
}

function buildItem(service, index) {
  const outerRadius = (geo.ring - 5) / 2;
  const innerRadius = outerRadius - 7;
  const outerCircumference = 2 * Math.PI * outerRadius;
  const innerCircumference = 2 * Math.PI * innerRadius;
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `item ${service.ok ? '' : 'unavailable'}`;
  element.dataset.service = service.id;
  element.style.setProperty('--enter-delay', `${90 + index * 76}ms`);
  element.style.setProperty('--brand', BRAND[service.id] || 'var(--ink)');
  element.style.setProperty('--outer-tone', service.windows.session
    ? tone(ringRemaining(service.windows.session)) : 'var(--track)');
  element.style.setProperty('--inner-tone', service.windows.weekly
    ? tone(service.windows.weekly.remainingPercent) : 'var(--track)');
  element.setAttribute('aria-label', service.name);
  element.innerHTML = `<span class="ring">
      <svg viewBox="0 0 ${geo.ring} ${geo.ring}">
        ${circleMarkup('outer', outerRadius, outerCircumference, !service.windows.session)}
        ${circleMarkup('inner', innerRadius, innerCircumference, !service.windows.weekly)}
      </svg>
      <span class="ring-face"><span class="glyph">${ICONS[service.icon] || ''}</span></span>
    </span>
    <span class="metric">
      <span class="pct">${Number.isFinite(service.summaryRemaining) ? '0%' : '--'}</span>
      <span class="metric-caption">${service.name}</span>
    </span>`;
  element.addEventListener('click', () => {
    const nextIndex = services().findIndex((candidate) => candidate.id === service.id);
    if (nextIndex !== hotIndex) {
      hotIndex = nextIndex;
      expanded = true;
    } else {
      expanded = !expanded;
    }
    element.classList.remove('clicked');
    requestAnimationFrame(() => element.classList.add('clicked'));
    updateHot();
  });
  return {
    element,
    service,
    outerCircumference,
    innerCircumference,
    outerArc: element.querySelector('.value.outer'),
    innerArc: element.querySelector('.value.inner'),
    pct: element.querySelector('.pct')
  };
}

function makeWindowCard(kind, item) {
  const card = document.createElement('div');
  card.className = `window-card ${item ? '' : 'missing'}`;
  if (item) card.style.setProperty('--tone', tone(item.remainingPercent));
  const label = document.createElement('span');
  label.className = 'window-label';
  label.textContent = windowLabel(item, kind);
  const value = document.createElement('strong');
  value.textContent = item ? `${item.remainingPercent}%` : '--';
  const remaining = document.createElement('span');
  remaining.className = 'window-remaining';
  remaining.textContent = item ? T.remainingShort : T.notReported;
  const reset = document.createElement('span');
  reset.className = 'window-reset';
  reset.textContent = item ? formatReset(item.resetsAt, expanded) : T.notReported;
  card.append(label, value, remaining, reset);
  if (item) {
    const source = document.createElement('span');
    source.className = 'window-source';
    source.textContent = item.blockedBy
      ? `${item.label || T.allModels} · ${windowLabel(item.blockedBy, 'weekly')} 0%`
      : item.label || T.allModels;
    card.appendChild(source);
  }
  return card;
}

function makeDetailRow(item) {
  const row = document.createElement('div');
  row.className = 'row';
  row.style.setProperty('--tone', tone(item.remainingPercent));
  const head = document.createElement('div');
  head.className = 'row-head';
  const name = document.createElement('span');
  name.className = 'row-name';
  name.textContent = detailLabel(item);
  const reset = document.createElement('span');
  reset.className = 'row-reset';
  reset.textContent = formatReset(item.resetsAt, expanded);
  head.append(name, reset);
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('span');
  fill.style.width = `${Math.max(item.remainingPercent, 1.5)}%`;
  bar.appendChild(fill);
  const foot = document.createElement('div');
  foot.className = 'row-foot';
  foot.textContent = T.remaining(item.remainingPercent);
  row.append(head, bar, foot);
  return row;
}

function providerError(service) {
  return T.providerErrors[service.reason] || T.providerErrors.unknown;
}

function canConnectClaude(service) {
  return window.widget.canOpenClaudeLogin && service.id === 'claude' &&
    ['no-credentials', 'token-expired', 'unauthorized'].includes(service.reason);
}

function makeClaudeLoginAction(service) {
  if (!canConnectClaude(service)) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'provider-action';
  button.textContent = T.connectClaude;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = T.loginOpening;
    let opened = false;
    try { opened = await window.widget.openClaudeLogin(); } catch (_) {}
    button.textContent = opened ? T.loginOpened : T.loginFailed;
    button.disabled = opened;
  });
  return button;
}

function renderPanel() {
  const service = services()[Math.max(0, Math.min(hotIndex, services().length - 1))];
  if (!service) return;
  panel.style.setProperty('--brand', BRAND[service.id] || 'var(--ink)');
  panel.classList.toggle('expanded', expanded);
  panelMark.innerHTML = ICONS[service.icon] || '';
  panelTitle.textContent = service.name;
  panelRows.innerHTML = '';
  hitRegions = null;

  const readAt = FORMAT.formatTime(service.fetchedAt, LOCALE, timeFormat);
  panelNote.textContent = service.stale ? T.stale(readAt) : (service.plan || readAt);
  panelNote.classList.toggle('warn', Boolean(service.stale));

  if (!service.ok) {
    const error = document.createElement('div');
    error.className = 'provider-error';
    error.innerHTML = `<span class="provider-status"></span><strong></strong><p></p>`;
    error.querySelector('strong').textContent = T.unavailable;
    error.querySelector('p').textContent = providerError(service);
    const action = makeClaudeLoginAction(service);
    if (action) error.appendChild(action);
    panelRows.appendChild(error);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'window-grid';
  grid.append(makeWindowCard('session', service.windows.session));
  grid.append(makeWindowCard('weekly', service.windows.weekly));
  panelRows.appendChild(grid);

  if (service.details.length > 2 || service.details.some((item) => item.kind === 'other')) {
    const heading = document.createElement('div');
    heading.className = 'breakdown-title';
    heading.textContent = T.breakdown;
    panelRows.appendChild(heading);
    const rows = document.createElement('div');
    rows.className = 'detail-rows';
    service.details.forEach((item) => rows.appendChild(makeDetailRow(item)));
    panelRows.appendChild(rows);
  }

  if (service.stale) {
    const stale = document.createElement('div');
    stale.className = 'panel-error stale';
    stale.textContent = providerError(service);
    const action = makeClaudeLoginAction(service);
    if (action) stale.appendChild(action);
    panelRows.appendChild(stale);
  }

  const hint = document.createElement('div');
  hint.className = `panel-hint ${expanded ? 'expanded' : ''}`;
  hint.textContent = expanded ? T.detailsExpanded : T.detailsHint;
  panelRows.appendChild(hint);
}

function render() {
  pill.innerHTML = '';
  items = services().map((service, index) => {
    const item = buildItem(service, index);
    pill.appendChild(item.element);
    return item;
  });
  hotIndex = Math.max(0, Math.min(hotIndex, items.length - 1));
  ringCentres = [];
  hitRegions = null;
  renderPanel();
  updateHot();
  if (revealed) animateIn();
}

function arcTarget(circumference, window) {
  return window ? circumference * (1 - ringRemaining(window) / 100) : circumference;
}

function animateIn() {
  items.forEach((item, index) => {
    item.outerArc.style.transitionDelay = `${170 + index * 84}ms`;
    item.innerArc.style.transitionDelay = `${230 + index * 84}ms`;
    item.outerArc.style.strokeDashoffset = arcTarget(
      item.outerCircumference, item.service.windows.session).toFixed(2);
    item.innerArc.style.strokeDashoffset = arcTarget(
      item.innerCircumference, item.service.windows.weekly).toFixed(2);
    if (Number.isFinite(item.service.summaryRemaining)) {
      setTimeout(() => countTo(item.pct, 0, item.service.summaryRemaining, 760), 180 + index * 84);
    }
  });
}

function resetAnimation() {
  items.forEach((item) => {
    item.outerArc.style.transitionDelay = '0ms';
    item.innerArc.style.transitionDelay = '0ms';
    item.outerArc.style.strokeDashoffset = item.outerCircumference.toFixed(2);
    item.innerArc.style.strokeDashoffset = item.innerCircumference.toFixed(2);
    item.pct.textContent = Number.isFinite(item.service.summaryRemaining) ? '0%' : '--';
  });
}

function placeTail(index) {
  const item = items[index];
  if (!item) return;
  const box = item.element.querySelector('.ring').getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  const y = box.top + box.height / 2 - panelBox.top - 13;
  panelTail.style.top = `${Math.max(16, Math.min(panelBox.height - 42, y))}px`;
}

function updateHot() {
  items.forEach((item, index) => item.element.classList.toggle('hot', index === hotIndex));
  renderPanel();
  requestAnimationFrame(() => placeTail(hotIndex));
}

function measureRings() {
  ringCentres = items.map((item) => {
    const box = item.element.getBoundingClientRect();
    return box.top + box.height / 2;
  });
}

function contains(rect, point, margin = 0) {
  return point.x >= rect.left - margin && point.x <= rect.right + margin &&
    point.y >= rect.top - margin && point.y <= rect.bottom + margin;
}

function updateInteractive(point) {
  if (!hitRegions) {
    hitRegions = {
      pill: pill.getBoundingClientRect(),
      panel: panel.getBoundingClientRect()
    };
  }
  const overPill = revealed && contains(hitRegions.pill, point, 2);
  const overPanel = panelOpen && contains(hitRegions.panel, point, 2);
  const next = overPill || overPanel;
  if (next === interactive) return;
  interactive = next;
  window.widget.setInteractive(next);
}

function onCursor(point) {
  updateInteractive(point);
  if (!revealed || !items.length) return;
  if (ringCentres.length !== items.length) measureRings();
  let best = 0;
  let distance = Infinity;
  ringCentres.forEach((centre, index) => {
    const candidate = Math.abs(point.y - centre);
    if (candidate < distance) { distance = candidate; best = index; }
  });
  if (best !== hotIndex) {
    hotIndex = best;
    expanded = false;
    updateHot();
  }
}

function reveal(on) {
  revealed = on;
  stage.classList.toggle('revealed', on);
  if (on) {
    resetAnimation();
    requestAnimationFrame(() => requestAnimationFrame(animateIn));
    clearInterval(tickTimer);
    tickTimer = setInterval(renderPanel, 20000);
  } else {
    expanded = false;
    interactive = false;
    window.widget.setInteractive(false);
    setPanel(false);
    clearInterval(tickTimer);
  }
}

function setPanel(open) {
  panelOpen = open;
  hitRegions = null;
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    renderPanel();
    requestAnimationFrame(() => placeTail(hotIndex));
  }
}

panel.addEventListener('click', () => {
  if (!services()[hotIndex] || !services()[hotIndex].ok) return;
  expanded = !expanded;
  renderPanel();
});
panel.addEventListener('transitionend', () => { hitRegions = null; });
pill.addEventListener('transitionend', () => { hitRegions = null; });

window.widget.onGeometry((next) => {
  geo = { ...geo, ...next };
  if (next.locale) { LOCALE = next.locale; T = I18N.pick(next.locale); }
  if (next.theme) theme = next.theme;
  if (next.timeFormat) timeFormat = next.timeFormat;
  applyTheme();
  applyGeometry();
  render();
});
window.widget.onUsage((next) => { data = next; expanded = false; render(); });
window.widget.onReveal(reveal);
window.widget.onPanel(setPanel);
window.widget.onCursor(onCursor);

applyTheme();
applyGeometry();
render();
