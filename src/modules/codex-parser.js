'use strict';
// codex-parser.js — OpenAI Codex сессияларынан токен мен лимитті оқиды.
//
// Claude Code-тың usage-parser.js-імен ҚАТАР жұмыс істейді: шығаратын жазбасының
// пішіні бірдей, сондықтан екеуінің дерегі бір есепке қосылады.
//
// Файлдар:  ~/.codex/sessions/ЖЫЛ/АЙ/КҮН/rollout-<уақыт>-<id>.jsonl
//
// Жол типтері (бізге керектері):
//   session_meta        — сессияның басы: cwd, session_id
//   turn_context        — модель аты (мысалы gpt-6-astra)
//   token_usage_record  — токен саны (response_id бойынша дедупликация)
//   event_msg/token_count — ішінде rate_limits: 5 сағаттық және апталық лимит
//
// МАҢЫЗДЫ АЙЫРМАШЫЛЫҚ: Codex-те input_tokens ІШІНЕ cached_input_tokens кіреді
// (Claude-та бөлек). Сондықтан кэштен оқылғанды алып тастаймыз, әйтпесе
// токен екі есе саналып, құны да артық шығады.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const { cwdToName } = require('./paths');

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 8 * DAY_MS;

// ---------------------------------------------------------------- жолдар

function codexRoot() {
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim()) {
    return process.env.CODEX_HOME.trim();
  }
  return path.join(os.homedir(), '.codex');
}

function sessionsDir() { return path.join(codexRoot(), 'sessions'); }

// Codex орнатылған ба?
function available() {
  try { fs.accessSync(sessionsDir()); return true; } catch { return false; }
}

// ---------------------------------------------------------------- күй

const state = {
  // Файл жолы → { offset, rest, cwd, model, sessionId }
  // cwd/model файл ішінде БІР рет кездеседі, ал токен жазбалары кейін келеді —
  // сондықтан оларды файл бойынша есте сақтап отырамыз.
  files: new Map(),
  seen: new Map(),        // response_id → уақыт (дедупликация)
  events: [],
  projects: new Map(),    // жоба аты → { name, lastActive }
  rateLimits: null,       // соңғы көрінген лимит
  rateLimitsTs: 0,
  ready: false,
  scanning: false,
  dirty: new Set(),
  watcher: null,
};

let costOf = () => 0;     // main.js usage-parser.eventCost-ты береді
let labelOf = (m) => m;

function setHelpers(cost, label) {
  if (typeof cost === 'function') costOf = cost;
  if (typeof label === 'function') labelOf = label;
}

// ---------------------------------------------------------------- оқу

function parseLine(line, fileState) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  if (!j || !j.type) return null;
  const p = j.payload || {};

  // Сессияның басы — жұмыс папкасын есте сақтаймыз
  if (j.type === 'session_meta') {
    if (p.cwd) fileState.cwd = p.cwd;
    if (p.session_id || p.id) fileState.sessionId = p.session_id || p.id;
    return null;
  }

  // Модель осы жерде хабарланады
  if (j.type === 'turn_context') {
    if (p.cwd) fileState.cwd = p.cwd;
    if (p.model) fileState.model = String(p.model);
    return null;
  }

  // Лимиттер event_msg ішінде келеді
  if (j.type === 'event_msg' && p.rate_limits) {
    const ts = Date.parse(j.timestamp);
    if (Number.isFinite(ts) && ts >= state.rateLimitsTs) {
      // primary/secondary бос болуы мүмкін — ондайды елемейміз
      if (p.rate_limits.primary || p.rate_limits.secondary) {
        state.rateLimits = p.rate_limits;
        state.rateLimitsTs = ts;
      }
    }
    return null;
  }

  if (j.type !== 'token_usage_record') return null;

  const u = p.usage;
  if (!u) return null;

  const ts = Date.parse(j.timestamp);
  if (!Number.isFinite(ts)) return null;

  // Дедупликация: бір жауап екі рет саналмауы керек
  const key = p.response_id || ((p.turn_id || '') + '|' + j.ordinal);
  if (!key) return null;

  const inputAll = Number(u.input_tokens) || 0;
  const cached = Number(u.cached_input_tokens) || 0;
  const cw = Number(u.cache_write_input_tokens) || 0;
  const out = Number(u.output_tokens) || 0;

  // Кэштен оқылған бөлікті шегереміз — ол input ішіне кіріп тұр
  const freshIn = Math.max(0, inputAll - cached);
  if (freshIn + cached + cw + out === 0) return null;

  const model = fileState.model || 'gpt-unknown';
  const cwd = fileState.cwd || null;

  return {
    key,
    ts,
    model,
    project: cwdToName(cwd) || 'codex',
    projectDir: 'codex:' + (cwd || 'unknown'),
    sessionId: fileState.sessionId || null,
    provider: 'codex',
    in: freshIn,
    out,
    cw5: cw,          // OpenAI-де кэш жазу тегін, бірақ санын көрсетеміз
    cw1h: 0,
    cr: cached,
  };
}

async function readFileTail(filePath, cutoffMs) {
  let st;
  try { st = await fsp.stat(filePath); } catch { return; }

  let entry = state.files.get(filePath);
  if (!entry) {
    if (st.mtimeMs < cutoffMs) {
      state.files.set(filePath, { offset: st.size, rest: '', cwd: null, model: null, sessionId: null });
      return;
    }
    entry = { offset: 0, rest: '', cwd: null, model: null, sessionId: null };
    state.files.set(filePath, entry);
  }

  if (st.size < entry.offset) { entry.offset = 0; entry.rest = ''; }
  if (st.size === entry.offset) return;

  let fh = null;
  try {
    fh = await fsp.open(filePath, 'r');
    const len = st.size - entry.offset;
    const buf = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(buf, 0, len, entry.offset);
    entry.offset += bytesRead;

    const text = entry.rest + buf.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    entry.rest = lines.pop() || '';

    for (const line of lines) {
      if (!line || line.length < 2) continue;
      const ev = parseLine(line, entry);
      if (!ev) continue;
      if (state.seen.has(ev.key)) continue;
      state.seen.set(ev.key, ev.ts);
      state.events.push(ev);

      const proj = state.projects.get(ev.projectDir) ||
        { dir: ev.projectDir, name: ev.project, lastActive: 0 };
      proj.name = ev.project;
      if (ev.ts > proj.lastActive) proj.lastActive = ev.ts;
      state.projects.set(ev.projectDir, proj);
    }
  } catch {
    // Файл қолжетімсіз — келесі айналымда қайталанады
  } finally {
    if (fh) { try { await fh.close(); } catch {} }
  }
}

// sessions/ЖЫЛ/АЙ/КҮН/*.jsonl
async function listJsonl(dir, depth = 0, acc = []) {
  if (depth > 4) return acc;
  let items;
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) await listJsonl(full, depth + 1, acc);
    else if (it.isFile() && it.name.endsWith('.jsonl')) acc.push(full);
  }
  return acc;
}

async function scan(options) {
  const full = !!(options && options.full);
  if (state.scanning || !available()) return;
  state.scanning = true;
  const cutoffMs = Date.now() - KEEP_MS;

  try {
    if (full) {
      const files = await listJsonl(sessionsDir());
      for (const f of files) await readFileTail(f, cutoffMs);
    } else {
      const targets = Array.from(state.dirty);
      state.dirty.clear();
      for (const f of targets) await readFileTail(f, cutoffMs);
    }
    prune();
    state.ready = true;
  } finally {
    state.scanning = false;
  }
}

function prune() {
  const cutoff = Date.now() - KEEP_MS;
  if (state.events.length && state.events[0].ts < cutoff) {
    state.events = state.events.filter((e) => e.ts >= cutoff);
  }
  if (state.seen.size > 20000) {
    for (const [k, ts] of state.seen) if (ts < cutoff) state.seen.delete(k);
  }
}

// ---------------------------------------------------------------- бақылау

function startWatching(onChange) {
  if (!available()) return false;
  try {
    state.watcher = chokidar.watch(sessionsDir(), {
      ignoreInitial: true,
      persistent: true,
      depth: 4,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
      ignored: (p, st) => (st && st.isFile() ? !p.endsWith('.jsonl') : false),
    });
    const mark = (f) => {
      if (typeof f === 'string' && f.endsWith('.jsonl')) {
        state.dirty.add(f);
        if (onChange) onChange();
      }
    };
    state.watcher.on('add', mark);
    state.watcher.on('change', mark);
    state.watcher.on('error', () => {});
    return true;
  } catch {
    state.watcher = null;
    return false;
  }
}

function stopWatching() {
  if (state.watcher) { try { state.watcher.close(); } catch {} state.watcher = null; }
}

// ---------------------------------------------------------------- сыртқа

function rawEvents() { return state.events; }
function projectCount() { return state.projects.size; }

// Codex лимиттерін виджеттің лимит пішініне келтіреміз
function limits() {
  const rl = state.rateLimits;
  if (!rl) return [];

  const now = Date.now();
  const out = [];
  const add = (part, kind, label, order) => {
    if (!part || typeof part.used_percent !== 'number') return;

    // Терезе әлдеқашан жаңарған болса, бұл сан ескірген — көрсетпейміз.
    // (Лимит Codex сессиясының ішінде хабарланады; Codex жүрмесе, дерек тоқтайды.
    //  Ондайда «99%» деп көрсету шындыққа жанаспас еді.)
    const resets = part.resets_at ? Number(part.resets_at) * 1000 : 0;
    if (resets && resets < now) return;

    const pct = Math.max(0, Math.min(100, part.used_percent));
    out.push({
      id: 'codex:' + kind,
      kind: 'codex_' + kind,
      label,
      percent: pct,
      remaining: 100 - pct,
      resetsAt: part.resets_at ? Number(part.resets_at) * 1000 : null,
      order,
      provider: 'codex',
    });
  };

  // window_minutes: 300 = 5 сағат, 10080 = апта
  const win = (m) => {
    if (!m) return '';
    if (m % 10080 === 0) return (m / 10080 > 1 ? (m / 10080) + ' апта' : 'апталық');
    if (m % 1440 === 0) return (m / 1440) + ' күндік';
    if (m % 60 === 0) return (m / 60) + ' сағаттық';
    return m + ' мин';
  };

  add(rl.primary, 'primary', 'Codex · ' + (win(rl.primary && rl.primary.window_minutes) || 'негізгі'), 10);
  add(rl.secondary, 'secondary', 'Codex · ' + (win(rl.secondary && rl.secondary.window_minutes) || 'қосымша'), 11);
  return out;
}

function planType() {
  return state.rateLimits ? (state.rateLimits.plan_type || null) : null;
}

// Лимит дерегі қашан жаңарғанын білдіретін белгі. main.js осыны бақылап,
// жаңа лимит көрінген бойда экранды жаңартады (60 секунд күтпей).
function limitsStamp() { return state.rateLimitsTs; }

module.exports = {
  available, codexRoot, sessionsDir,
  setHelpers, scan, startWatching, stopWatching,
  rawEvents, projectCount, limits, limitsStamp, planType,
  listJsonl,
};
