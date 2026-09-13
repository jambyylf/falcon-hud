'use strict';
// preload.js — негізгі процесс пен renderer арасындағы ЖАЛҒЫЗ қауіпсіз көпір.
//
// Мұнда Node.js API-лары renderer-ге ашылмайды. Тек төмендегі санаулы
// функциялар қолжетімді болады. Құпия дерек (токен) бұл арнадан ешқашан өтпейді.

const { contextBridge, ipcRenderer } = require('electron');

// Рұқсат етілген оқиға арналары — басқасына жазылу мүмкін емес
const CHANNELS = [
  'usage', 'agents', 'limits', 'system', 'mode-changed',
  'history',        // 30 күндік жиынтық
  'flags',          // демо режим / parser ескертуі
  'settings-open',  // баптау панелін ашу/жабу (трейден де келеді)
];

contextBridge.exposeInMainWorld('hud', {
  // --- Дерек сұрау
  snapshot: () => ipcRenderer.invoke('hud:snapshot'),
  refresh: () => ipcRenderer.invoke('hud:refresh'),

  // --- Терезені басқару
  toggleMode: () => ipcRenderer.invoke('hud:toggle-mode'),
  setMode: (mode) => ipcRenderer.invoke('hud:set-mode', String(mode)),
  hide: () => ipcRenderer.invoke('hud:hide'),
  openSettings: () => ipcRenderer.invoke('hud:open-settings'),

  // «FalconHUD» жазуынан сүйреу (5 пикселден асқанда басталады)
  dragStart: () => ipcRenderer.invoke('hud:drag-start'),
  dragEnd: () => ipcRenderer.invoke('hud:drag-end'),
  quit: () => ipcRenderer.invoke('hud:quit'),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('hud:set-always-on-top', !!v),
  getWindowState: () => ipcRenderer.invoke('hud:get-window-state'),

  // Жоба бөлшегі (тізімде жобаны басқанда)
  projectDetail: (dir, name) => ipcRenderer.invoke('hud:project-detail', String(dir), String(name || '')),

  // --- Баптау панелі
  //
  // ҚАУІПСІЗДІК: бот токенін ОҚИТЫН функция жоқ. Тек жаңасын ЖІБЕРУГЕ болады,
  // ал бары-жоғын «қойылған / қойылмаған» деген күйден ғана білеміз.
  settings: {
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    close: () => ipcRenderer.invoke('settings:close'),

    telegramStatus: () => ipcRenderer.invoke('settings:tg-status'),
    telegramSetToken: (token) => ipcRenderer.invoke('settings:tg-set-token', String(token || '')),
    telegramClearToken: () => ipcRenderer.invoke('settings:tg-clear-token'),
    telegramSetEnabled: (v) => ipcRenderer.invoke('settings:tg-set-enabled', !!v),
    telegramSetSend: (opts) => ipcRenderer.invoke('settings:tg-set-send', opts || {}),
    telegramTest: () => ipcRenderer.invoke('settings:tg-test'),

    setNotifyReady: (v) => ipcRenderer.invoke('settings:set-notify-ready', !!v),
    setAlertPercent: (n) => ipcRenderer.invoke('settings:set-alert-percent', Number(n)),
    setAutoLaunch: (v) => ipcRenderer.invoke('settings:set-auto-launch', !!v),
    openPricing: () => ipcRenderer.invoke('settings:open-pricing'),
  },

  // --- Жаңарту оқиғаларына жазылу
  on: (channel, handler) => {
    if (!CHANNELS.includes(channel) || typeof handler !== 'function') return () => {};
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
