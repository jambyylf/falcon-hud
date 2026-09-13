'use strict';
// main.js — Electron негізгі процесі.
// Барлық дерек осында жиналып, IPC арқылы renderer-ге жіберіледі.
// Renderer-де Node.js жоқ — ол тек көрсетумен айналысады.

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const usage = require('./modules/usage-parser');
const agents = require('./modules/agents');
const limits = require('./modules/limits');
const system = require('./modules/system');
const history = require('./modules/history');
const telegram = require('./modules/telegram');
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

// --------------------------------------------- автоқосылуды команда жолынан баптау
//
// «Компьютер қосылғанда іске қосу» баптауын трейден де, командадан да қоюға болады:
//     FalconHUD.exe --enable-autostart
//     FalconHUD.exe --disable-autostart
// Тіркелетін жол — ОСЫ файлдың жолы. Сондықтан оны ОРНАТЫЛҒАН нұсқадан іске қосу
// керек: әйтпесе автоқосылуға әзірлеу режиміндегі уақытша жол жазылып қалады.
const autostartFlag = process.argv.find(
  (a) => a === '--enable-autostart' || a === '--disable-autostart'
);

if (autostartFlag) {
  // Бұл — қысқа бір реттік режим: баптап, бірден шығамыз. Терезе ашылмайды.
  const turnOn = autostartFlag === '--enable-autostart';
  app.whenReady().then(() => {
    let ok = false;
    try {
      app.setLoginItemSettings({
        openAtLogin: turnOn,
        openAsHidden: process.platform === 'darwin',
        args: [],
      });
      ok = !!app.getLoginItemSettings().openAtLogin === turnOn;
    } catch (e) {
      console.error('[FalconHUD] автоқосылу орнатылмады:', e && e.message);
    }
    console.log('[FalconHUD] автоқосылу: ' + (turnOn ? 'ҚОСЫЛДЫ' : 'өшірілді') +
                (ok ? ' ✓' : ' — ТЕКСЕРУ СӘТСІЗ'));
    app.exit(ok ? 0 : 1);
  });
} else {
  // Бір ғана көшірме жұмыс істесін
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    // Екінші көшірме іске қосылса — жаңасы шығып қалады, бірақ аргументін
    // осында береді. «FalconHUD.exe --settings» деп қосса, баптау терезесі ашылады.
    app.on('second-instance', (_e, argv) => {
      if (Array.isArray(argv) && argv.includes('--settings')) {
        win.openSettings();
        return;
      }
      const w = win.getWindow();
      if (w && !w.isDestroyed()) { w.show(); w.focus(); }
    });
  }
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

// ── Сессия «сізді күте бастағанда» бір рет хабарлау ──
// Алғашқы жинауда хабарлама жібермейміз: әйтпесе апп қосылған сәтте бұрыннан
// күтіп тұрған барлық сессия бірден хабарлама жіберер еді.
const prevSessionState = new Map();   // sessionId → күй
let sessionStatesSeeded = false;

function checkSessionAlerts(data) {
  if (!data || !Array.isArray(data.sessions)) return;

  const seen = new Set();
  for (const s of data.sessions) {
    seen.add(s.sessionId);
    const before = prevSessionState.get(s.sessionId);
    prevSessionState.set(s.sessionId, s.state);

    if (!sessionStatesSeeded) continue;          // бірінші жинау — тек есте сақтаймыз
    if (!s.needsYou) continue;                   // әлі жұмыс істеп жатыр
    if (before === s.state) continue;            // күй өзгерген жоқ
    if (before && !WORKING_STATES.has(before)) continue;  // күтуден күтуге ауысу — хабарламаймыз

    win.notifySessionReady(s);       // компьютердегі хабарлама
    telegram.notifySession(s);       // телефонға (Telegram қосулы болса)
  }

  // Тізімнен шыққан сессияларды ұмытамыз (жады өспесін)
  for (const id of prevSessionState.keys()) {
    if (!seen.has(id)) prevSessionState.delete(id);
  }
  sessionStatesSeeded = true;
}

const WORKING_STATES = new Set(['working', 'agent']);

let agentsPending = false;
async function tickAgents() {
  if (agentsPending) return;
  agentsPending = true;
  try {
    latest.agents = await agents.collect();
    emit('agents', latest.agents);
    // Хабарлама тек НАҚТЫ дерекке — демо режимде жалған ескерту болмайды
    if (!demo.on) checkSessionAlerts(latest.agents);
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
      for (const l of latest.limits.limits) {
        if (l && typeof l.percent === 'number' && l.percent >= 80) telegram.notifyLimit(l);
      }
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
      if (!demo.on) telegram.notifyParser(h);
    }
  }

  if (wasWarning !== flags.parserWarning) {
    win.sendToRenderer('flags', Object.assign({}, flags));
  }
}

// --------------------------------------------------------- ЖОБА БӨЛШЕГІ
// «Жобалар» тізімінде бір жобаны басқанда: бүгінгі модель бөлінісі, сол жобада
// жүрген сессиялар және соңғы 30 күндегі динамикасы.
function projectDetail(projectDir, name) {
  // Демо режимде — жасанды, бірақ шынайы көрінетін бөлшек
  if (demo.on && demo.snapshot) {
    return demoData.buildProjectDetail(projectDir, name);
  }

  const since = usage.startOfToday();
  const detail = usage.projectDetail(projectDir, since);
  const projName = name || detail.name || projectDir;

  // Осы жобада жүрген сессиялар
  const sessions = ((latest.agents && latest.agents.sessions) || [])
    .filter((s) => s.projectDir === projectDir || s.project === projName)
    .map((s) => ({ project: s.project, state: s.state, needsYou: s.needsYou, modelLabel: s.modelLabel }));

  let days = [];
  try { days = history.projectDays(projName, 30); } catch { days = []; }

  return Object.assign({}, detail, { name: projName, sessions, days });
}

// ------------------------------------------------- Telegram /status мәтіні
// Телефоннан «/status» деп жазғанда осы мәтін жіберіледі.

function tgDur(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + ' с';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' мин';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' сағ' + (m % 60 ? ' ' + (m % 60) + ' мин' : '');
  return Math.floor(h / 24) + ' күн';
}

function tgCompact(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

function tgEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TG_STATE = {
  waiting: '⏳ сізді күтуде',
  asking:  '❓ жауап күтуде',
  stalled: '🔒 рұқсат күтуде',
  agent:   '🟣 агент жүруде',
  working: '🟢 жұмыста',
};

function buildStatusText() {
  const now = Date.now();
  const lines = ['🦅 <b>FalconHUD</b>'];

  // ── Сессиялар
  const a = latest.agents;
  if (a && Array.isArray(a.sessions)) {
    const waiting = a.sessions.filter((s) => s.needsYou);
    const working = a.sessions.filter((s) => !s.needsYou);

    lines.push('');
    if (waiting.length) {
      lines.push('<b>Сізді күтіп тұр (' + waiting.length + ')</b>');
      for (const s of waiting.slice(0, 8)) {
        lines.push('• <b>' + tgEsc(s.project) + '</b> — ' +
          (TG_STATE[s.state] || 'күтуде') + ' · ' + tgDur(now - s.stateSinceTs));
      }
    } else {
      lines.push('<b>Күтіп тұрған сессия жоқ</b> ✅');
    }

    if (working.length) {
      lines.push('');
      lines.push('<b>Жұмыста (' + working.length + ')</b>');
      for (const s of working.slice(0, 6)) {
        const tool = s.lastTool ? s.lastTool.tool : '';
        lines.push('• ' + tgEsc(s.project) + (tool ? ' — ' + tgEsc(tool) : '') +
          ' · ' + tgDur(now - s.stateSinceTs));
      }
    }
    if (a.counts && a.counts.runningSubagents) {
      lines.push('');
      lines.push('<i>' + a.counts.runningSubagents + ' subagent жүріп жатыр</i>');
    }
  }

  // ── Лимиттер
  const L = latest.limits;
  lines.push('');
  if (L && L.ok && L.limits.length) {
    lines.push('<b>Лимиттер</b> <i>(жұмсалғаны)</i>');
    for (const l of L.limits) {
      const left = l.resetsAt ? l.resetsAt - now : 0;
      const mark = l.percent >= 80 ? '🔴' : (l.percent >= 50 ? '🟡' : '🟢');
      lines.push(mark + ' ' + tgEsc(l.label) + ' — <b>' + Math.round(l.percent) + '%</b>' +
        (left > 0 ? ' · ' + tgDur(left) + ' кейін' : ''));
    }
  } else {
    lines.push('<b>Лимиттер</b> — дерек жоқ');
  }

  // ── Бүгінгі токен
  const u = latest.usage;
  if (u && u.windows && u.windows.today) {
    const t = u.windows.today;
    lines.push('');
    lines.push('<b>Бүгін</b> — ' + tgCompact(t.total) + ' токен · $' + t.cost.toFixed(2));
    const top = (u.projects && u.projects.list) ? u.projects.list.slice(0, 3) : [];
    if (top.length) {
      lines.push('<i>' + top.map((p) => tgEsc(p.name) + ' ' + tgCompact(p.tokens)).join(' · ') + '</i>');
    }
  }

  if (flags.parserWarning) {
    lines.push('');
    lines.push('⚠️ <i>' + tgEsc(flags.parserWarning) + '</i>');
  }

  return lines.join('\n');
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

  // Жоба бөлшегі — тізімде бір жобаны басқанда ашылады
  ipcMain.handle('hud:project-detail', (_e, projectDir, name) => projectDetail(projectDir, name));

  // ─────────────────────── БАПТАУ ТЕРЕЗЕСІ ───────────────────────
  // Мақсаты: қолданушыға JSON файл өңдеудің қажеті болмауы.
  // ЕСКЕРТУ: бот токені бұл арналардың ЕШҚАЙСЫСЫНАН қайтарылмайды.

  ipcMain.handle('settings:get-all', () => {
    const w = win.getState();
    let tg = { configured: false };
    try { tg = telegram.status(); } catch {}
    return {
      notifyReady: w.notifyReady,
      alwaysOnTop: w.alwaysOnTop,
      autoLaunch: w.autoLaunch,
      alertPercent: win.alertPercent(),
      telegram: tg,
      version: app.getVersion(),
    };
  });

  ipcMain.handle('settings:close', () => win.closeSettings());

  ipcMain.handle('settings:tg-status', async () => {
    try {
      await telegram.fetchBotName();          // бот атын алып қоямыз
      return telegram.status();
    } catch {
      return { configured: false };
    }
  });

  ipcMain.handle('settings:tg-set-token', async (_e, token) => {
    try {
      telegram.setToken(token);
      const name = await telegram.fetchBotName();
      if (!name) {
        const st = telegram.status();
        telegram.setToken('');               // жарамсыз токенді сақтап қоймаймыз
        return { ok: false, error: st.lastError || 'Бот табылмады' };
      }
      win.updateTrayMenu();
      return { ok: true, botName: name };
    } catch (e) {
      return { ok: false, error: e && e.message };
    }
  });

  ipcMain.handle('settings:tg-clear-token', () => {
    telegram.clearToken();
    telegram.stopPolling();
    win.updateTrayMenu();
    return true;
  });

  ipcMain.handle('settings:tg-set-enabled', (_e, v) => {
    const on = telegram.setEnabled(v);
    if (on) {
      telegram.setStatusProvider(buildStatusText);
      telegram.startPolling();
    } else {
      telegram.stopPolling();
    }
    win.updateTrayMenu();
    return on;
  });

  ipcMain.handle('settings:tg-set-send', (_e, opts) => telegram.setSendOptions(opts));

  ipcMain.handle('settings:tg-test', async () => {
    try { return await telegram.sendTest(); }
    catch (e) { return { ok: false, error: e && e.message }; }
  });

  ipcMain.handle('settings:set-notify-ready', (_e, v) => win.setNotifyReady(v));
  ipcMain.handle('settings:set-alert-percent', (_e, n) => win.setAlertPercent(n));
  ipcMain.handle('settings:set-auto-launch', (_e, v) => win.setAutoLaunch(v));

  ipcMain.handle('settings:open-pricing', () => {
    try { shell.openPath(pricingPath()); return true; } catch { return false; }
  });
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
  // --enable-autostart режимінде терезе ашылмайды — жоғарыда баптап, шығып кетеміз
  if (autostartFlag) return;

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

  // Telegram: /status командасын тыңдау
  try {
    telegram.setStatusProvider(buildStatusText);
    telegram.startPolling();
  } catch (e) {
    console.error('[FalconHUD] Telegram сұрауы басталмады:', e && e.message);
  }

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

  // «--settings» деп қосылса — баптау терезесін бірден ашамыз
  if (process.argv.includes('--settings')) win.openSettings();

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
  try { telegram.stopPolling(); } catch {}
  // Шығар алдында бүгінгі жиынтықты соңғы рет жазып қалдырамыз
  try {
    history.update(usage.rawEvents(), usage.eventCost);
  } catch { /* жазылмаса — маңызды емес */ }
  win.destroy();
});

// Күтпеген қате аппты құлатпасын
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
