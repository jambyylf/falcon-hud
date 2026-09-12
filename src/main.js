'use strict';
// main.js — Electron негізгі процесі.
// Барлық дерек осында жиналып, IPC арқылы renderer-ге жіберіледі.
// Renderer-де Node.js жоқ — ол тек көрсетумен айналысады.

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const usage = require('./modules/usage-parser');
const agents = require('./modules/agents');
const limits = require('./modules/limits');
const system = require('./modules/system');
const history = require('./modules/history');
const win = require('./modules/window');
const demoData = require('./demo-data');

// --------------------------------------------------------------- жаңарту аралықтары
const TICK_SYSTEM_MS = 2000;         // Компьютер күйі — 2 секунд сайын
const TICK_USAGE_MS = 4000;          // Токен есебі — 4 секунд сайын
const TICK_AGENTS_MS = 5000;         // Агенттер — 5 секунд сайын
const TICK_LIMITS_MS = 60 * 1000;    // Лимит — минут сайын тексереміз (модуль өзі 5 мин кэштейді)
const TICK_HISTORY_MS = 10 * 60 * 1000;  // Тарих — 10 минут сайын бүгінгі жиынтық жаңарады
const TICK_HEALTH_MS = 30 * 1000;    // Parser денсаулығы — жарты минут сайын

const timers = [];

// Соңғы белгілі күй — renderer жаңа қосылғанда бірден толық сурет алады
const latest = {
  usage: null,
  agents: null,
  limits: null,
  system: null,
  history: { ok: false, days: 0, window30: null },
};

// --------------------------------------------------------------- ДЕМО РЕЖИМ
// Нақты дерек жиналуын тоқтатпаймыз — сондықтан демо өшірілгенде дереу нақтыға оралады.
const demo = {
  on: false,
  empty: false,
  snapshot: null,     // тұрақты бөлік (таймерлер өсіп тұруы үшін бір рет құрылады)
};

// Renderer-ге жіберілетін ескерту жалаушалары
const flags = {
  demo: false,
  demoEmpty: false,
  parserWarning: null,   // мәтін немесе null
};

function demoState() { return { demo: demo.on, empty: demo.empty }; }

function setDemo(next) {
  const wasOn = demo.on;
  demo.on = !!(next && next.demo);
  demo.empty = !!(next && next.empty);

  // Демо қосылғанда (немесе «бос күй» ауысқанда) тұрақты бөлікті қайта құрамыз
  if (demo.on) {
    demo.snapshot = demoData.buildStatic({ empty: demo.empty });
  } else {
    demo.snapshot = null;
  }

  flags.demo = demo.on;
  flags.demoEmpty = demo.empty;

  win.updateTrayMenu();
  pushAll();          // экранды дереу жаңартамыз — күту жоқ
  if (wasOn !== demo.on) {
    console.log('[FalconHUD] демо режим: ' + (demo.on ? 'ҚОСУЛЫ' : 'өшірулі'));
  }
}

// Ағымдағы көрсетілетін дерек: демо немесе нақты
function view() {
  if (demo.on && demo.snapshot) {
    return {
      usage: demo.snapshot.usage,
      agents: demo.snapshot.agents,
      limits: demo.snapshot.limits,
      history: demo.snapshot.history,
      system: demoData.buildSystem({ empty: demo.empty }),
    };
  }
  return latest;
}

// Барлық арнаны бірден жіберу
function pushAll() {
  const v = view();
  win.sendToRenderer('usage', v.usage);
  win.sendToRenderer('agents', v.agents);
  win.sendToRenderer('limits', v.limits);
  win.sendToRenderer('system', v.system);
  win.sendToRenderer('history', v.history);
  win.sendToRenderer('flags', Object.assign({}, flags));
}

// Бір ғана көшірме жұмыс істесін
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = win.getWindow();
    if (w && !w.isDestroyed()) { w.show(); w.focus(); }
  });
}

// --------------------------------------------------------------- pricing.json жолы
// Баға файлын іздеу реті МАҢЫЗДЫ: алдымен қолданушы өңдей алатын көшірмелер,
// соңында ғана апптың ішіне тігілген резерв нұсқасы. Әйтпесе жинақталған аппта
// қолданушының түзетуі еш әсер етпей қалады (архив ішіндегі көшірме басым болады).
function pricingPath() {
  const candidates = [];

  // 1) Қолданушының жеке нұсқасы (ең басым)
  try { candidates.push(path.join(app.getPath('userData'), 'pricing.json')); } catch {}

  // 2) Орнатылған апптың қасындағы өңдеуге болатын көшірме (extraResources)
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'pricing.json'));

  // 3) Жоба папкасындағы файл (әзірлеу режимі) және апп ішіндегі резерв
  candidates.push(path.join(__dirname, '..', 'pricing.json'));

  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return candidates[candidates.length - 1];
}

// --------------------------------------------------------------- дерек жинау циклдері

// Демо қосулы кезде экранға демо дерегі кетеді, бірақ нақты дерек жиналуы тоқтамайды.
function emit(channel, realValue) {
  if (!demo.on) { win.sendToRenderer(channel, realValue); return; }
  const v = view();
  win.sendToRenderer(channel, v[channel]);
}

let usagePending = false;
async function tickUsage(full) {
  if (usagePending) return;
  usagePending = true;
  try {
    await usage.scan({ full: !!full });
    latest.usage = usage.summary();
    emit('usage', latest.usage);
  } catch (e) {
    // Бір айналым сәтсіз болса — келесісі қайталайды
  } finally {
    usagePending = false;
  }
}

let agentsPending = false;
async function tickAgents() {
  if (agentsPending) return;
  agentsPending = true;
  try {
    latest.agents = await agents.collect();
    emit('agents', latest.agents);
  } catch (e) {
    /* елемейміз */
  } finally {
    agentsPending = false;
  }
}

let systemPending = false;
async function tickSystem() {
  if (systemPending) return;
  systemPending = true;
  try {
    latest.system = await system.collect();
    emit('system', latest.system);
  } catch (e) {
    /* елемейміз */
  } finally {
    systemPending = false;
  }
}

async function tickLimits(force) {
  try {
    latest.limits = await limits.getLimits(!!force);
    emit('limits', latest.limits);
    // Хабарлама тек НАҚТЫ дерекке шығады — демо режим жалған ескерту бермейді
    if (!demo.on && latest.limits && latest.limits.ok) {
      win.checkLimitAlerts(latest.limits.limits);   // 80%-дан асса — хабарлама
    }
  } catch (e) {
    /* елемейміз */
  }
}

// --------------------------------------------------------------- КҮНДЕЛІКТІ ТАРИХ
// Бүгінгі күннің жиынтығын жаңартып отырамыз. Файлда бір күнге бір ғана жазба
// қалады, сондықтан ол кішкентай. Жиі жазудың себебі: апп жабылып қалса да
// бүгінгі дерек жоғалмасын.
async function tickHistory() {
  try {
    await history.update(usage.rawEvents(), usage.eventCost);
    latest.history = history.window30(usage.modelLabel);
    emit('history', latest.history);
  } catch (e) {
    /* тарих жазылмаса — виджет жұмысын жалғастырады */
  }
}

// ------------------------------------------------- PARSER ТЫНЫШ БҰЗЫЛУЫ
// Соңғы 10 минутта .jsonl-ге жол қосылған, бірақ токен оқылмаса — пішім өзгерген.
let lastHealthLog = 0;

function tickHealth() {
  let h;
  try { h = usage.health(); } catch { return; }
  if (!h) return;

  const wasWarning = flags.parserWarning;

  if (h.ok) {
    flags.parserWarning = null;
  } else {
    flags.parserWarning = 'Дерек оқылмай тұр — формат өзгерген болуы мүмкін';

    // Логқа жазамыз: қай өріс табылмағаны көрінсін (кейін жөндеу үшін)
    const now = Date.now();
    if (!wasWarning || now - lastHealthLog > 10 * 60 * 1000) {
      lastHealthLog = now;
      const parts = [
        'PARSER ЕСКЕРТУІ: ' + h.cause,
        'соңғы ' + Math.round(h.windowMs / 60000) + ' минутта: ' +
          'жол=' + h.lines + ', assistant=' + h.assistantLines + ', оқылған жазба=' + h.parsed,
      ];
      if (h.reasons && h.reasons.length) {
        parts.push('себептер: ' + h.reasons.map((r) => r.reason + ' ×' + r.count).join(' | '));
      } else {
        parts.push('себеп тіркелмеді — "type":"assistant" жолдары мүлде кездеспеген болуы мүмкін');
      }
      const text = parts.join('\n    ');
      history.appendLog(text);
      console.warn('[FalconHUD] ' + text);
    }
  }

  if (wasWarning !== flags.parserWarning) {
    win.sendToRenderer('flags', Object.assign({}, flags));
  }
}

// --------------------------------------------------------------- IPC арналары

function registerIpc() {
  // Renderer қосылғанда — бар деректің бәрін бірден береміз
  ipcMain.handle('hud:snapshot', () => {
    const v = view();
    return {
      usage: v.usage,
      agents: v.agents,
      limits: v.limits,
      system: v.system,
      history: v.history,
      flags: Object.assign({}, flags),
      window: win.getState(),
      version: app.getVersion(),
    };
  });

  ipcMain.handle('hud:toggle-mode', () => win.toggleMode());
  ipcMain.handle('hud:set-mode', (_e, mode) => win.setMode(mode));
  ipcMain.handle('hud:hide', () => { const w = win.getWindow(); if (w) w.hide(); win.updateTrayMenu(); return true; });

  // «FalconHUD» жазуынан қолмен сүйреу
  ipcMain.handle('hud:drag-start', () => win.beginManualDrag());
  ipcMain.handle('hud:drag-end', () => win.endManualDrag());
  ipcMain.handle('hud:quit', () => { app.isQuiting = true; app.quit(); return true; });

  ipcMain.handle('hud:set-always-on-top', (_e, v) => win.setAlwaysOnTop(v));
  ipcMain.handle('hud:get-window-state', () => win.getState());

  // Қолмен жаңарту
  ipcMain.handle('hud:refresh', async () => {
    await Promise.all([tickUsage(false), tickAgents(), tickSystem(), tickLimits(true)]);
    await tickHistory();
    tickHealth();
    return true;
  });
}

// --------------------------------------------------------------- іске қосу

app.whenReady().then(async () => {
  // Windows-та хабарламалар дұрыс көрінуі үшін
  if (process.platform === 'win32') app.setAppUserModelId('kz.falcon.hud');

  usage.loadPricing(pricingPath());

  win.createWindow();
  const trayInfo = win.createTray();
  const hotkeyOk = win.registerShortcut();
  registerIpc();

  // Трей мәзіріндегі «Демо режим» қосқыштарын жалғаймыз
  try {
    win.setDemoHooks({ get: demoState, set: setDemo });
  } catch (e) {
    console.error('[FalconHUD] трей мәзірі құрылмады:', e && e.message);
  }

  // Демо режимді іске қосу кезінде-ақ қосуға болады (тексеруге ыңғайлы):
  //   FALCONHUD_DEMO=1 npm start          → демо
  //   FALCONHUD_DEMO=empty npm start      → демо + бос күй
  const demoEnv = String(process.env.FALCONHUD_DEMO || '').toLowerCase();
  if (demoEnv && demoEnv !== '0' && demoEnv !== 'false') {
    setDemo({ demo: true, empty: demoEnv === 'empty' || demoEnv === 'bos' });
  }

  // Тарихты оқып қоямыз (әлі бос болуы мүмкін)
  await history.load().catch(() => {});

  // Іске қосу диагностикасы — бірдеңе істемей қалса, терминалда бірден көрінеді
  console.log(
    '[FalconHUD] трей: ' + (trayInfo && trayInfo.ok ? 'қосылды' : 'ҚОСЫЛМАДЫ') +
    (trayInfo && trayInfo.iconEmpty ? ' (иконка бос!)' : '') +
    ' | Ctrl+Alt+H: ' + (hotkeyOk ? 'тіркелді' : 'ТІРКЕЛМЕДІ (басқа апп иеленген болуы мүмкін)') +
    ' | pricing.json: ' + pricingPath()
  );

  // Жүйелік өлшеуіштерді "жылытамыз" (бірінші өлшем 0 болмауы үшін)
  system.warmup().catch(() => {});

  // Бірінші толық шолу — фондa, интерфейс бірден ашылады
  tickSystem();
  tickUsage(true).then(() => {
    // Толық шолудан кейін файл бақылауды қосамыз
    usage.startWatching(() => { /* өзгеріс белгіленді, келесі айналым оқиды */ });
    // Жадыда соңғы 8 күн бар — тарихқа сол күндерді бірден жазып қоямыз
    return tickHistory();
  });
  tickAgents();
  tickLimits(true);
  win.sendToRenderer('flags', Object.assign({}, flags));

  // Мерзімді айналымдар
  timers.push(setInterval(tickSystem, TICK_SYSTEM_MS));
  timers.push(setInterval(() => tickUsage(false), TICK_USAGE_MS));
  timers.push(setInterval(tickAgents, TICK_AGENTS_MS));
  timers.push(setInterval(() => tickLimits(false), TICK_LIMITS_MS));
  timers.push(setInterval(tickHistory, TICK_HISTORY_MS));
  timers.push(setInterval(tickHealth, TICK_HEALTH_MS));

  // Әр 10 минутта толық шолу — бақылау бір нәрсені өткізіп жіберсе, қалпына келеді
  timers.push(setInterval(() => tickUsage(true), 10 * 60 * 1000));
});

// Терезе жабылса да апп трейде қала береді
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Трей бар болса — шықпаймыз
    if (!app.isQuiting) return;
    app.quit();
  }
});

app.on('activate', () => {
  const w = win.getWindow();
  if (!w) win.createWindow();
  else { w.show(); w.focus(); }
});

app.on('before-quit', () => { app.isQuiting = true; });

app.on('will-quit', () => {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  usage.stopWatching();
  // Шығар алдында бүгінгі жиынтықты соңғы рет жазып қалдырамыз
  try {
    history.update(usage.rawEvents(), usage.eventCost);
  } catch { /* жазылмаса — маңызды емес */ }
  win.destroy();
});

// Күтпеген қате аппты құлатпасын
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
