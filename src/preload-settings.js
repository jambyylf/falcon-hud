'use strict';
// preload-settings.js — баптау терезесінің қауіпсіз көпірі.
//
// Негізгі виджеттің preload.js-інен БӨЛЕК: баптау терезесіне дерек арналары
// қажет емес, ал виджетке баптау функциялары қажет емес. Әрқайсысы тек өзіне
// керегін ғана көреді.
//
// ҚАУІПСІЗДІК: бот токенін ОҚУҒА болатын функция жоқ — тек жаңасын қоюға болады.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  // --- Жалпы
  getAll: () => ipcRenderer.invoke('settings:get-all'),
  close: () => ipcRenderer.invoke('settings:close'),

  // --- Telegram
  telegramStatus: () => ipcRenderer.invoke('settings:tg-status'),
  telegramSetToken: (token) => ipcRenderer.invoke('settings:tg-set-token', String(token || '')),
  telegramClearToken: () => ipcRenderer.invoke('settings:tg-clear-token'),
  telegramSetEnabled: (v) => ipcRenderer.invoke('settings:tg-set-enabled', !!v),
  telegramSetSend: (opts) => ipcRenderer.invoke('settings:tg-set-send', opts || {}),
  telegramTest: () => ipcRenderer.invoke('settings:tg-test'),

  // --- Хабарламалар
  setNotifyReady: (v) => ipcRenderer.invoke('settings:set-notify-ready', !!v),
  setAlertPercent: (n) => ipcRenderer.invoke('settings:set-alert-percent', Number(n)),

  // --- Терезе
  setAlwaysOnTop: (v) => ipcRenderer.invoke('hud:set-always-on-top', !!v),
  setAutoLaunch: (v) => ipcRenderer.invoke('settings:set-auto-launch', !!v),

  // --- Баға файлы
  openPricing: () => ipcRenderer.invoke('settings:open-pricing'),
});
