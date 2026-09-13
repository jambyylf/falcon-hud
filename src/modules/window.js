'use strict';
// window.js — қалқымалы терезе, трей иконкасы, ыстық перне және хабарламалар.
//
// Терезе: рамкасыз, мөлдір фонды, барлық терезенің үстінде.
// Екі режим: 'compact' (шағын) және 'full' (толық). Орны мен өлшемі есте сақталады.

const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const telegram = require('./telegram');

const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

// Әдепкі өлшемдер
const DEFAULT_SIZES = {
  compact: { width: 320, height: 120 },
  full:    { width: 380, height: 720 },
};

const MIN_SIZES = {
  compact: { width: 296, height: 112 },
  full:    { width: 336, height: 400 },
};

let win = null;
let tray = null;
let state = null;
let saveTimer = null;
let notifiedLimits = new Set();   // "лимитId:resetsAt" — бір реттен артық хабарламау

// Демо режим қосқыштары. Негізгі процесс (main.js) осыны толтырады.
let demoHooks = {
  get: () => ({ demo: false, empty: false }),
  set: () => {},
};

function setDemoHooks(hooks) {
  if (hooks) demoHooks = hooks;
  updateTrayMenu();
}

// ---------------------------------------------------------------- күйді сақтау

function defaultState() {
  return {
    mode: 'full',
    x: null,
    y: null,
    sizes: JSON.parse(JSON.stringify(DEFAULT_SIZES)),
    alwaysOnTop: true,
    autoLaunch: false,
    notifyReady: true,        // сессия дайын болғанда хабарлау
    alertPercent: 80,         // лимит ескертуінің шегі, %
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    const parsed = JSON.parse(raw);
    const s = Object.assign(defaultState(), parsed);
    s.sizes = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SIZES)), parsed.sizes || {});
    if (s.mode !== 'compact' && s.mode !== 'full') s.mode = 'full';
    return s;
  } catch {
    return defaultState();
  }
}

function saveStateNow() {
  if (!state) return;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), 'utf8');
  } catch { /* сақтау сәтсіз болса — апп жұмысын жалғастыра береді */ }
}

// Күйді бірден жазбаймыз: соңғы өзгерістен кейін 500 мс күтіп, БІР рет жазамыз.
// Сүйреу кезінде «moved» оқиғасы секундына ондаған рет келуі мүмкін — онсыз
// дискіге бос жүктеме түсер еді.
const SAVE_DELAY_MS = 500;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveStateNow(); }, SAVE_DELAY_MS);
}

// Терезенің экраннан шығып кетпеуін тексереміз
function clampToScreen(bounds) {
  const displays = screen.getAllDisplays();
  const fits = displays.some((d) => {
    const a = d.workArea;
    return bounds.x + bounds.width > a.x + 40 &&
           bounds.x < a.x + a.width - 40 &&
           bounds.y + 40 < a.y + a.height &&
           bounds.y >= a.y - 10;
  });
  if (fits) return bounds;

  // Сыймаса — негізгі экранның оң жақ жоғарғы бұрышына қоямыз
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(wa.x + wa.width - bounds.width - 24),
    y: Math.round(wa.y + 24),
    width: bounds.width,
    height: bounds.height,
  };
}

function currentSize() {
  const s = state.sizes[state.mode] || DEFAULT_SIZES[state.mode];
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    width: Math.max(MIN_SIZES[state.mode].width, Math.min(s.width, wa.width - 40)),
    height: Math.max(MIN_SIZES[state.mode].height, Math.min(s.height, wa.height - 40)),
  };
}

// ---------------------------------------------------------------- иконка

// Иконка файлын табу (жинақталған аппта resources ішінде болады)
function iconPath(name) {
  const candidates = [
    path.join(__dirname, '..', '..', 'build', name),
    path.join(process.resourcesPath || '', 'build', name),
    path.join(process.resourcesPath || '', name),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

function makeTrayIcon() {
  const p = iconPath('tray.png');
  if (p) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      return process.platform === 'darwin'
        ? img.resize({ width: 18, height: 18 })
        : img;
    }
  }
  // Файл табылмаса — бос иконка (трей бәрібір көрінеді)
  return nativeImage.createEmpty();
}

// ---------------------------------------------------------------- терезе жасау

function createWindow() {
  state = loadState();

  const size = currentSize();
  const wa = screen.getPrimaryDisplay().workArea;
  let bounds = {
    width: size.width,
    height: size.height,
    x: state.x != null ? state.x : Math.round(wa.x + wa.width - size.width - 24),
    y: state.y != null ? state.y : Math.round(wa.y + 24),
  };
  bounds = clampToScreen(bounds);

  const appIcon = iconPath('icon.png');

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_SIZES[state.mode].width,
    minHeight: MIN_SIZES[state.mode].height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !!state.alwaysOnTop,
    show: false,
    icon: appIcon || undefined,
    title: 'FalconHUD',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      // ҚАУІПСІЗДІК: renderer-де Node.js өшік, контекст оқшауланған.
      // Дерек тек preload + IPC арқылы өтеді.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Барлық терезенің үстінде — толық экранды ойын/бейне үстінде де көріну үшін
  if (state.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  win.once('ready-to-show', () => win.show());

  // Орны мен өлшемін есте сақтау
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const b = win.getBounds();
    state.x = b.x;
    state.y = b.y;
    state.sizes[state.mode] = { width: b.width, height: b.height };
    scheduleSave();
  };
  win.on('moved', remember);
  win.on('resized', remember);

  win.on('closed', () => { win = null; });

  // Сыртқы сілтемелерді браузерде ашу (виджет ішінде емес)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Виджет ішінде басқа бетке өтуге тыйым
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  return win;
}

// ------------------------------------------------------------ қолмен сүйреу
//
// «FalconHUD» жазуы -webkit-app-region: no-drag күйінде (әйтпесе оны басып
// жаңарту мүмкін болмас еді). Сондықтан сүйреуді өзіміз жасаймыз: renderer
// 5 пикселден асқанда хабарлайды, біз терезені курсордың соңынан жылжытамыз.

const DRAG_TICK_MS = 16;              // ~60 кадр/с
const DRAG_MAX_MS = 30 * 1000;        // қауіпсіздік: сүйреу мәңгі созылмасын

let dragTimer = null;
let dragAnchor = null;

function beginManualDrag() {
  if (!win || win.isDestroyed()) return false;
  endManualDrag();

  const cur = screen.getCursorScreenPoint();
  const b = win.getBounds();
  dragAnchor = { cx: cur.x, cy: cur.y, wx: b.x, wy: b.y, startedAt: Date.now() };

  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !dragAnchor) { endManualDrag(); return; }
    if (Date.now() - dragAnchor.startedAt > DRAG_MAX_MS) { endManualDrag(); return; }
    const p = screen.getCursorScreenPoint();
    win.setPosition(
      Math.round(dragAnchor.wx + (p.x - dragAnchor.cx)),
      Math.round(dragAnchor.wy + (p.y - dragAnchor.cy))
    );
  }, DRAG_TICK_MS);

  return true;
}

function endManualDrag() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  if (!dragAnchor) return true;
  dragAnchor = null;

  // Жаңа орынды есте сақтаймыз (жазу 500 мс кідіріспен, бір рет)
  if (win && !win.isDestroyed() && state) {
    const b = win.getBounds();
    state.x = b.x;
    state.y = b.y;
    scheduleSave();
  }
  return true;
}

// ---------------------------------------------------------------- режим ауыстыру

function setMode(mode) {
  if (!win || win.isDestroyed()) return state ? state.mode : 'full';
  if (mode !== 'compact' && mode !== 'full') return state.mode;
  if (state.mode === mode) return state.mode;

  // Ағымдағы режимнің өлшемін сақтап қоямыз
  const b = win.getBounds();
  state.sizes[state.mode] = { width: b.width, height: b.height };
  state.mode = mode;

  const size = currentSize();
  win.setMinimumSize(MIN_SIZES[mode].width, MIN_SIZES[mode].height);
  win.setBounds({ x: b.x, y: b.y, width: size.width, height: size.height }, false);
  scheduleSave();
  sendToRenderer('mode-changed', mode);
  updateTrayMenu();
  return mode;
}

function toggleMode() {
  return setMode(state.mode === 'full' ? 'compact' : 'full');
}

// ---------------------------------------------------------------- көрсету/жасыру

function toggleVisibility() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
  updateTrayMenu();
}

function setAlwaysOnTop(value) {
  if (!state) return false;
  state.alwaysOnTop = !!value;
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(state.alwaysOnTop, 'screen-saver');
    win.setVisibleOnAllWorkspaces(state.alwaysOnTop, { visibleOnFullScreen: true });
  }
  scheduleSave();
  updateTrayMenu();
  return state.alwaysOnTop;
}

function setNotifyReady(value) {
  if (!state) return false;
  state.notifyReady = !!value;
  scheduleSave();
  updateTrayMenu();
  return state.notifyReady;
}

// Компьютер қосылғанда автоматты іске қосу
function setAutoLaunch(value) {
  const enabled = !!value;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: process.platform === 'darwin',
      args: [],
    });
    state.autoLaunch = enabled;
  } catch {
    state.autoLaunch = false;
  }
  scheduleSave();
  updateTrayMenu();
  return state.autoLaunch;
}

function isAutoLaunchEnabled() {
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch {
    return !!(state && state.autoLaunch);
  }
}

// ---------------------------------------------------------- баптау терезесі
//
// Баптау БӨЛЕК ТЕРЕЗЕ емес — виджеттің өз ішінен жанынан шығатын панель.
// Сондықтан мұнда тек виджетті көрсетіп, толық режимге ауыстырып,
// renderer-ге «панельді аш» деген белгі береміз.

let settingsOpen = false;
let modeBeforeSettings = null;   // шағын режимнен ашылса — жапқанда қайтарамыз

function openSettings() {
  if (!win || win.isDestroyed()) createWindow();
  if (!win.isVisible()) win.show();
  win.focus();
  // Шағын режимде панель сыймайды — алдымен толық режимге ауысамыз.
  // Қай режимнен келгенін есте сақтап қоямыз: панель жабылғанда қайтарамыз.
  if (state && state.mode !== 'full') {
    modeBeforeSettings = state.mode;
    setMode('full');
  }
  settingsOpen = true;
  // Апп жаңа ғана қосылған болса (`--settings`), бет әлі жүктеліп жатуы мүмкін —
  // ондайда белгі жоғалып кетпес үшін жүктеп болғанын күтеміз.
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => sendToRenderer('settings-open', true));
  } else {
    sendToRenderer('settings-open', true);
  }
  updateTrayMenu();
  return win;
}

function closeSettings() {
  settingsOpen = false;
  sendToRenderer('settings-open', false);
  if (modeBeforeSettings) {
    const back = modeBeforeSettings;
    modeBeforeSettings = null;
    // Панель сырғып біткенше күтеміз — әйтпесе жабылу көрінбей қалады
    setTimeout(() => setMode(back), 260);
  }
  updateTrayMenu();
  return true;
}

function isSettingsOpen() { return settingsOpen; }

// ---------------------------------------------------------------- трей

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!(win && !win.isDestroyed() && win.isVisible());
  const demoFlags = demoHooks.get() || { demo: false, empty: false };
  let tg = { configured: false, enabled: false, lastError: null };
  try { tg = telegram.status(); } catch { /* баптау оқылмаса — мәзір бәрібір ашылады */ }
  const menu = Menu.buildFromTemplate([
    { label: 'FalconHUD', enabled: false },
    { type: 'separator' },
    {
      label: visible ? 'Жасыру' : 'Көрсету',
      click: () => toggleVisibility(),
    },
    {
      label: state.mode === 'full' ? 'Шағын режим' : 'Толық режим',
      click: () => toggleMode(),
    },
    { type: 'separator' },
    {
      label: 'Барлық терезенің үстінде',
      type: 'checkbox',
      checked: !!state.alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    {
      label: 'Компьютер қосылғанда іске қосу',
      type: 'checkbox',
      checked: isAutoLaunchEnabled(),
      click: (item) => setAutoLaunch(item.checked),
    },
    {
      label: '⚙  Баптау…',
      click: () => openSettings(),
    },
    { type: 'separator' },
    {
      label: 'Сессия дайын болғанда хабарлау',
      type: 'checkbox',
      checked: !!state.notifyReady,
      click: (item) => setNotifyReady(item.checked),
    },
    {
      label: 'Telegram',
      submenu: [
        {
          label: tg.configured ? 'Telegram-ға жіберу' : 'Telegram-ға жіберу (токен қойылмаған)',
          type: 'checkbox',
          checked: !!tg.enabled,
          enabled: !!tg.configured,
          click: (item) => { telegram.setEnabled(item.checked); updateTrayMenu(); },
        },
        { type: 'separator' },
        {
          label: 'Баптау файлын ашу…',
          click: () => { try { shell.openPath(telegram.configFile()); } catch {} },
        },
        {
          label: 'Сынақ хабарын жіберу',
          enabled: !!tg.configured,
          click: async () => {
            const r = await telegram.sendTest();
            try {
              if (Notification.isSupported()) {
                new Notification({
                  title: 'FalconHUD — Telegram',
                  body: r.ok ? 'Сынақ хабары жіберілді ✅' : ('Қате: ' + (r.error || '—')),
                  icon: iconPath('icon.png') || undefined,
                }).show();
              }
            } catch {}
            updateTrayMenu();
          },
        },
        { type: 'separator' },
        {
          label: tg.lastError ? ('Соңғы қате: ' + String(tg.lastError).slice(0, 50)) : 'Қате жоқ',
          enabled: false,
        },
      ],
    },
    { type: 'separator' },
    {
      // ТЕКСЕРУГЕ АРНАЛҒАН: нақты дерек орнына жасанды дерек көрсетіледі
      label: 'Демо режим',
      type: 'checkbox',
      checked: !!demoFlags.demo,
      click: (item) => demoHooks.set({ demo: item.checked, empty: demoFlags.empty }),
    },
    {
      label: 'Демо: бос күй',
      type: 'checkbox',
      checked: !!demoFlags.empty,
      enabled: !!demoFlags.demo,
      click: (item) => demoHooks.set({ demo: true, empty: item.checked }),
    },
    { type: 'separator' },
    { label: 'Көрсету/жасыру: Ctrl+Alt+H', enabled: false },
    { type: 'separator' },
    {
      label: 'Шығу',
      click: () => { app.isQuiting = true; app.quit(); },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  try {
    const icon = makeTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('FalconHUD — Claude Code мониторы');
    tray.on('click', () => {
      // Windows-та сол жақ басу — көрсету/жасыру
      if (process.platform === 'win32') toggleVisibility();
    });
    tray.on('double-click', () => toggleVisibility());
    updateTrayMenu();
    return { ok: true, iconEmpty: icon.isEmpty() };
  } catch (e) {
    tray = null;   // Трей істемесе — апп бәрібір жұмыс істейді
    return { ok: false, error: e && e.message };
  }
}

// ---------------------------------------------------------------- ыстық перне

function registerShortcut() {
  try {
    const ok = globalShortcut.register('Control+Alt+H', () => toggleVisibility());
    return ok;
  } catch {
    return false;
  }
}

function unregisterShortcuts() {
  try { globalShortcut.unregisterAll(); } catch {}
}

// ---------------------------------------------------------------- хабарламалар

// ─────────── Сессия сізді күте бастағанда хабарлау ───────────
// Ондаған сессия қатар жүргенде, қайсысы дайын болғанын білу — ең пайдалы нәрсе.
// Трей мәзірінен өшіруге болады.

const STATE_TEXT = {
  waiting: 'кезегін аяқтады — сізді күтіп тұр',
  asking:  'сұрақ қойды — жауабыңызды күтіп тұр',
  stalled: 'рұқсат сұрап тұрған сияқты',
};

function notifySessionReady(session) {
  if (!state || !state.notifyReady) return;
  if (!Notification.isSupported()) return;
  const what = STATE_TEXT[session.state] || 'сізді күтіп тұр';
  try {
    const n = new Notification({
      title: 'FalconHUD — ' + session.project,
      body: what,
      silent: false,
      icon: iconPath('icon.png') || undefined,
    });
    n.on('click', () => {
      if (win && !win.isDestroyed()) { win.show(); win.focus(); }
    });
    n.show();
  } catch { /* хабарлама шықпаса — маңызды емес */ }
}

// Ескерту шегі, %. Әдепкі — 80. Тексеру үшін FALCONHUD_ALERT_PERCENT арқылы өзгертуге болады.
// Шек баптау терезесінен өзгертіледі. FALCONHUD_ALERT_PERCENT орта айнымалысы
// бар болса — ол басым (тексеруге ыңғайлы).
function alertPercent() {
  const env = Number(process.env.FALCONHUD_ALERT_PERCENT);
  if (Number.isFinite(env) && env > 0 && env <= 100) return env;
  const v = state && Number(state.alertPercent);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : 80;
}

function setAlertPercent(value) {
  if (!state) return 80;
  const v = Number(value);
  if (Number.isFinite(v) && v >= 1 && v <= 100) {
    state.alertPercent = Math.round(v);
    notifiedLimits = new Set();   // шек өзгерді — ескертулерді қайта санаймыз
    scheduleSave();
  }
  return state.alertPercent;
}

// Лимит шектен асса — бір рет жүйелік хабарлама
function checkLimitAlerts(limits) {
  if (!Array.isArray(limits) || !Notification.isSupported()) return;

  for (const l of limits) {
    if (!l || typeof l.percent !== 'number') continue;
    const key = `${l.id}:${l.resetsAt || 0}`;

    const limit = alertPercent();
    if (l.percent >= limit) {
      if (notifiedLimits.has(key)) continue;
      notifiedLimits.add(key);
      try {
        const n = new Notification({
          title: 'FalconHUD — лимит ескертуі',
          body: `${l.label}: ${l.percent.toFixed(0)}% жұмсалды, ${l.remaining.toFixed(0)}% қалды.`,
          silent: false,
          icon: iconPath('icon.png') || undefined,
        });
        n.on('click', () => {
          if (win && !win.isDestroyed()) { win.show(); win.focus(); }
        });
        n.show();
      } catch { /* хабарлама шықпаса — маңызды емес */ }
    } else if (l.percent < Math.max(0, limit - 10)) {
      // Лимит қайта төмендесе — келесі рет қайта ескерте аламыз
      notifiedLimits.delete(key);
    }
  }

  // Жинақ шектен аспасын
  if (notifiedLimits.size > 50) notifiedLimits = new Set();
}

// ---------------------------------------------------------------- көмекші

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    try { win.webContents.send(channel, payload); } catch {}
  }
}

function getWindow() { return win; }
function getState() {
  return {
    mode: state ? state.mode : 'full',
    alwaysOnTop: state ? !!state.alwaysOnTop : true,
    autoLaunch: isAutoLaunchEnabled(),
    notifyReady: state ? !!state.notifyReady : true,
    alertPercent: alertPercent(),
    platform: process.platform,
  };
}

function destroy() {
  unregisterShortcuts();
  saveStateNow();
  if (tray) { try { tray.destroy(); } catch {} tray = null; }
}

module.exports = {
  createWindow, createTray, registerShortcut, unregisterShortcuts, setDemoHooks,
  beginManualDrag, endManualDrag,
  setMode, toggleMode, toggleVisibility, setAlwaysOnTop, setAutoLaunch,
  checkLimitAlerts, notifySessionReady, setNotifyReady, setAlertPercent, alertPercent,
  openSettings, closeSettings, isSettingsOpen,
  sendToRenderer, getWindow, getState, updateTrayMenu, destroy,
  saveStateNow,
};
