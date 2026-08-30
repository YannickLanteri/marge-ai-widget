'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  onGeometry: (fn) => ipcRenderer.on('geometry', (_e, g) => fn(g)),
  onUsage: (fn) => ipcRenderer.on('usage', (_e, d) => fn(d)),
  onReveal: (fn) => ipcRenderer.on('reveal', (_e, v) => fn(v)),
  onPanel: (fn) => ipcRenderer.on('panel', (_e, v) => fn(v)),
  onCursor: (fn) => ipcRenderer.on('cursor', (_e, p) => fn(p)),
  canOpenClaudeLogin: process.platform === 'darwin',
  openClaudeLogin: () => ipcRenderer.invoke('claude:login'),
  requestRefresh: () => ipcRenderer.send('request-refresh'),
  setInteractive: (on) => ipcRenderer.send('set-interactive', on === true)
});
