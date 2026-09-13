'use strict';
// telegram.js — маңызды оқиғаларды Telegram-ға жібереді.
//
// НЕГЕ КЕРЕК: компьютер басында отырмағанда да сессия сізді күтіп тұрғанын,
// лимит таусылып қалғанын немесе деректің оқылмай қалғанын білу үшін.
//
// Баптау файлы:  ~/.claude/falconhud/telegram.json
// Лог:           ~/.claude/falconhud/telegram.log
//
// ҚАУІПСІЗДІК: бот токені — құпия. Ол ЕШҚАШАН логқа, консольге, виджет
// интерфейсіне немесе git-ке түспейді. Баптау файлы жоба папкасынан тыс жатыр.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { claudeRoot } = require('./paths');

const API = 'https://api.telegram.org/bot';
const REQUEST_TIMEOUT_MS = 12000;

const MIN_GAP_MS = 1500;              // Екі хабар арасындағы ең аз үзіліс
const SESSION_COOLDOWN_MS = 5 * 60 * 1000;   // Бір сессия жиі хабарламасын
const PARSER_COOLDOWN_MS = 30 * 60 * 1000;   // Parser ескертуі сирек келсін
const MAX_QUEUE = 20;                 // Кезек шектен аспасын

const state = {
  cfg: null,
  loaded: false,
  queue: [],
  sending: false,
  lastSentAt: 0,
  lastError: null,
  sessionSentAt: new Map(),   // sessionId → уақыт
  limitSent: new Set(),       // "limitId:resetsAt"
  parserSentAt: 0,
};

// ──────────────────────────────────────────────────── жолдар мен баптау

function dataDir() { return path.join(claudeRoot(), 'falconhud'); }
function configFile() { return path.join(dataDir(), 'telegram.json'); }
function logFile() { return path.join(dataDir(), 'telegram.log'); }

function template() {
  return {
    _nusqau_kk: [
      '1) Telegram-нан @BotFather-ды тауып, /newbot деп жазыңыз.',
      '2) Ол берген токенді төмендегі botToken өрісіне қойыңыз.',
      '3) Жаңа ботыңызға Telegram-нан кез келген хабар жазыңыз (мысалы /start).',
      '4) enabled өрісін true қылыңыз да, FalconHUD-ты қайта қосыңыз.',
      'chatId өрісін өзіңіз толтырудың қажеті жоқ — апп оны өзі тауып жазады.',
      'НАЗАР: botToken — құпия. Бұл файлды ешкімге көрсетпеңіз.',
    ],
    enabled: false,
    botToken: '',
    chatId: '',
    send: { sessions: true, limits: true, parser: true },
  };
}

function ensureDir() {
  try { fs.mkdirSync(dataDir(), { recursive: true }); return true; } catch { return false; }
}

// Баптауды оқу. Файл жоқ болса — бос үлгі жасап береді.
function load() {
  if (state.loaded) return state.cfg;
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const j = JSON.parse(raw);
    state.cfg = Object.assign(template(), j);
    state.cfg.send = Object.assign(template().send, j.send || {});
  } catch {
    state.cfg = template();
    save();                       // қолданушыға толтыруға дайын үлгі қалдырамыз
  }
  state.loaded = true;
  return state.cfg;
}

function save() {
  try {
    ensureDir();
    fs.writeFileSync(configFile(), JSON.stringify(state.cfg, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────── лог (токенсіз)

function log(text) {
  try {
    ensureDir();
    const f = logFile();
    try {
      const st = fs.statSync(f);
      if (st.size > 128 * 1024) fs.writeFileSync(f, '', 'utf8');
    } catch { /* файл әлі жоқ */ }
    fs.appendFileSync(f, new Date().toISOString() + '  ' + redact(text) + '\n', 'utf8');
  } catch { /* лог жазылмаса — маңызды емес */ }
}

// Кездейсоқ жерде токен қалып қоймасын
function redact(text) {
  const t = String(text);
  const token = state.cfg && state.cfg.botToken;
  let out = token ? t.split(token).join('<ТОКЕН>') : t;
  return out.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<ТОКЕН>');
}

// ──────────────────────────────────────────────────── күй

function isConfigured() {
  const c = load();
  return !!(c.botToken && String(c.botToken).trim().length > 20);
}

function isEnabled() {
  const c = load();
  return !!(c.enabled && isConfigured());
}

function setEnabled(value) {
  const c = load();
  c.enabled = !!value;
  save();
  if (c.enabled) log('Telegram қосылды');
  else log('Telegram өшірілді');
  return c.enabled;
}

function status() {
  const c = load();
  return {
    configured: isConfigured(),
    enabled: isEnabled(),
    hasChat: !!c.chatId,
    lastError: state.lastError,
  };
}

// ──────────────────────────────────────────────────── Telegram API

async function call(method, body) {
  const c = load();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API + c.botToken + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      // Қате мәтінінде URL болмайды — токен ағып кетпейді
      const desc = (data && data.description) || ('HTTP ' + res.status);
      const err = new Error(desc);
      err.status = res.status;
      throw err;
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

// chatId белгісіз болса, ботқа жазылған соңғы хабардан табамыз
async function resolveChatId() {
  const c = load();
  if (c.chatId) return c.chatId;

  try {
    const updates = await call('getUpdates', { limit: 10, timeout: 0 });
    if (!Array.isArray(updates) || !updates.length) {
      state.lastError = 'Ботқа әлі хабар жазылмаған';
      return null;
    }
    for (let i = updates.length - 1; i >= 0; i--) {
      const m = updates[i].message || updates[i].edited_message ||
                updates[i].channel_post || null;
      const id = m && m.chat && m.chat.id;
      if (id != null) {
        c.chatId = String(id);
        save();
        log('chatId табылды');
        state.lastError = null;
        return c.chatId;
      }
    }
    state.lastError = 'Хабардан chatId табылмады';
    return null;
  } catch (e) {
    state.lastError = e.message;
    log('getUpdates қатесі: ' + e.message);
    return null;
  }
}

// ──────────────────────────────────────────────────── кезек

// Хабарлар тым жиі кетпеуі үшін кезекке қоямыз
function enqueue(text) {
  if (!isEnabled()) return false;
  if (state.queue.length >= MAX_QUEUE) return false;
  state.queue.push(text);
  drain();
  return true;
}

async function drain() {
  if (state.sending || !state.queue.length) return;
  state.sending = true;

  try {
    while (state.queue.length) {
      const gap = Date.now() - state.lastSentAt;
      if (gap < MIN_GAP_MS) {
        await new Promise((r) => setTimeout(r, MIN_GAP_MS - gap));
      }

      const chatId = await resolveChatId();
      if (!chatId) { state.queue.length = 0; break; }   // баптау аяқталмаған

      const text = state.queue.shift();
      try {
        await call('sendMessage', {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        state.lastSentAt = Date.now();
        state.lastError = null;
      } catch (e) {
        state.lastError = e.message;
        log('sendMessage қатесі: ' + e.message);
        // 403/400 — баптау дұрыс емес, кезекті босатамыз
        if (e.status === 400 || e.status === 403) { state.queue.length = 0; break; }
        await new Promise((r) => setTimeout(r, 3000));   // уақытша қате — сәл күтеміз
      }
    }
  } finally {
    state.sending = false;
  }
}

// ──────────────────────────────────────────────────── мәтін дайындау

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dur(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + ' с';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' мин';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' сағ' + (m % 60 ? ' ' + (m % 60) + ' мин' : '');
  return Math.floor(h / 24) + ' күн';
}

const STATE_TEXT = {
  waiting: 'Кезегін аяқтады — сізді күтіп тұр',
  asking:  'Сұрақ қойды — жауабыңызды күтіп тұр',
  stalled: 'Рұқсат сұрап тұрған сияқты',
};

const STATE_ICON = { waiting: '⏳', asking: '❓', stalled: '🔒' };

// ──────────────────────────────────────────────────── сыртқы API

// Сессия сізді күте бастады
function notifySession(s) {
  const c = load();
  if (!isEnabled() || !c.send.sessions || !s) return false;

  const now = Date.now();
  const last = state.sessionSentAt.get(s.sessionId) || 0;
  if (now - last < SESSION_COOLDOWN_MS) return false;    // жиі хабарламаймыз
  state.sessionSentAt.set(s.sessionId, now);

  // Жинақ шектен аспасын
  if (state.sessionSentAt.size > 200) {
    for (const [k, t] of state.sessionSentAt) {
      if (now - t > SESSION_COOLDOWN_MS * 4) state.sessionSentAt.delete(k);
    }
  }

  const icon = STATE_ICON[s.state] || '⏳';
  const lines = [
    icon + ' <b>' + esc(s.project) + '</b>',
    esc(STATE_TEXT[s.state] || 'Сізді күтіп тұр'),
  ];
  const meta = [];
  if (s.modelLabel) meta.push(esc(s.modelLabel));
  if (s.stateSinceTs) meta.push(dur(now - s.stateSinceTs));
  if (s.lastTool && s.lastTool.tool) {
    meta.push(esc(s.lastTool.tool + (s.lastTool.detail ? ' · ' + s.lastTool.detail : '')));
  }
  if (meta.length) lines.push('<i>' + meta.join(' · ') + '</i>');

  return enqueue(lines.join('\n'));
}

// Лимит шектен асты
function notifyLimit(l) {
  const c = load();
  if (!isEnabled() || !c.send.limits || !l) return false;

  const key = l.id + ':' + (l.resetsAt || 0);
  if (state.limitSent.has(key)) return false;
  state.limitSent.add(key);
  if (state.limitSent.size > 100) state.limitSent.clear();

  const lines = [
    '⚠️ <b>' + esc(l.label) + '</b>',
    Math.round(l.percent) + '% жұмсалды, ' + Math.round(l.remaining) + '% қалды',
  ];
  if (l.resetsAt) {
    const left = l.resetsAt - Date.now();
    if (left > 0) lines.push('<i>' + dur(left) + ' кейін жаңарады</i>');
  }
  return enqueue(lines.join('\n'));
}

// Parser деректі оқи алмай қалды
function notifyParser(health) {
  const c = load();
  if (!isEnabled() || !c.send.parser || !health) return false;

  const now = Date.now();
  if (now - state.parserSentAt < PARSER_COOLDOWN_MS) return false;
  state.parserSentAt = now;

  const lines = [
    '🔧 <b>FalconHUD</b>',
    'Дерек оқылмай тұр — формат өзгерген болуы мүмкін',
  ];
  if (health.reasons && health.reasons.length) {
    lines.push('<i>' + esc(health.reasons.map((r) => r.reason + ' ×' + r.count).join(' | ')) + '</i>');
  }
  return enqueue(lines.join('\n'));
}

// Баптауды тексеру — қолданушы «сынап көру» дегенде
async function sendTest() {
  const c = load();
  if (!isConfigured()) return { ok: false, error: 'Бот токені қойылмаған' };

  // Тексеру үшін уақытша қосамыз
  const was = c.enabled;
  c.enabled = true;
  try {
    const chatId = await resolveChatId();
    if (!chatId) {
      return { ok: false, error: state.lastError || 'chatId табылмады' };
    }
    await call('sendMessage', {
      chat_id: chatId,
      text: '✅ <b>FalconHUD</b>\nБайланыс орнады — хабарлар осында келеді.',
      parse_mode: 'HTML',
    });
    state.lastError = null;
    log('сынақ хабары жіберілді');
    return { ok: true };
  } catch (e) {
    state.lastError = e.message;
    log('сынақ қатесі: ' + e.message);
    return { ok: false, error: e.message };
  } finally {
    c.enabled = was;
    save();
  }
}

module.exports = {
  load, save, status, isConfigured, isEnabled, setEnabled,
  notifySession, notifyLimit, notifyParser, sendTest,
  configFile, logFile, dataDir,
};
