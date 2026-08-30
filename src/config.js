'use strict';

const I18N = require('./i18n');
const THEMES = require('./themes');

const DEFAULTS = Object.freeze({
  verticalAnchor: 0.45,
  refreshSeconds: 300,
  followCursorDisplay: true,
  displayId: 'primary',
  language: 'auto',
  checkUpdates: true,
  theme: 'midnight',
  timeFormat: 'auto',
  alertAt: [80, 95],
  shortcut: 'CommandOrControl+Shift+M'
});

function finiteBetween(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function sanitize(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const displayId = String(source.displayId || DEFAULTS.displayId);
  const language = I18N.languages.includes(source.language) ? source.language : DEFAULTS.language;
  const theme = THEMES.ids.includes(source.theme) ? source.theme : DEFAULTS.theme;
  const timeFormat = ['auto', '12', '24'].includes(source.timeFormat)
    ? source.timeFormat : DEFAULTS.timeFormat;
  const alertAt = [...new Set((Array.isArray(source.alertAt) ? source.alertAt : DEFAULTS.alertAt)
    .map(Number).filter((level) => Number.isInteger(level) && level > 0 && level <= 100))]
    .sort((a, b) => a - b).slice(0, 5);

  return {
    verticalAnchor: finiteBetween(source.verticalAnchor, DEFAULTS.verticalAnchor, 0, 1),
    refreshSeconds: Math.round(finiteBetween(
      source.refreshSeconds, DEFAULTS.refreshSeconds, 30, 3600
    )),
    followCursorDisplay: typeof source.followCursorDisplay === 'boolean'
      ? source.followCursorDisplay : DEFAULTS.followCursorDisplay,
    displayId: /^[A-Za-z0-9_.:-]{1,64}$/.test(displayId) ? displayId : DEFAULTS.displayId,
    language,
    checkUpdates: typeof source.checkUpdates === 'boolean'
      ? source.checkUpdates : DEFAULTS.checkUpdates,
    theme,
    timeFormat,
    alertAt,
    shortcut: typeof source.shortcut === 'string' ? source.shortcut.trim().slice(0, 80) : DEFAULTS.shortcut
  };
}

module.exports = { DEFAULTS, sanitize };
