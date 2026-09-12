'use strict';
// usage-parser.js — ~/.claude/projects/**/*.jsonl файлдарын оқып, токен мен құнды санайды.
//
// Негізгі принциптер:
//  1) Файл бүтіндей қайта оқылмайды — тек соңғы рет оқылған байттан кейінгі жаңа жолдар.
//  2) Қайталанған жазба message.id + requestId бойынша бір-ақ рет саналады.
//  3) Бұзылған JSON жолы үнсіз өткізіліп жіберіледі — апп құламайды.
//  4) Есте тек соңғы 8 күннің жазбалары сақталады (апталық есеп үшін жеткілікті).

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const chokidar = require('chokidar');
const { projectsDir, projectDirToName, cwdToName } = require('./paths');

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 8 * DAY_MS;              // Жадыда сақтау терезесі
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;

// ---------------------------------------------------------------- күй (state)
const state = {
  // Файл жолы → { offset: оқылған байт саны, rest: аяқталмаған жол қалдығы }
  files: new Map(),
  // Дедупликация кілті → уақыт белгісі (ms)
  seen: new Map(),
  // Токен жазбалары
  events: [],
  // Жоба папкасы → { dir, name, lastActive }
  projects: new Map(),
  ready: false,
  scanning: false,
  dirty: new Set(),
  watcher: null,
  lastScanMs: 0,
};

// -------------------------------------------------------------- баға (pricing)
let pricing = null;

function loadPricing(pricingPath) {
  try {
    pricing = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
  } catch {
    // Баға файлы оқылмаса — құн нөл болады, бірақ токен саны жұмыс істей береді
    pricing = {
      models: {},
      fallback: { label: '—', input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 },
    };
  }
  return pricing;
}

function getPricing() { return pricing; }

// "claude-opus-5[1m]" → "claude-opus-5", "claude-haiku-4-5-20251001" → "claude-haiku-4-5"
function normalizeModel(model) {
  if (!model || typeof model !== 'string') return null;
  if (model === '<synthetic>') return null;      // Жергілікті жауап — нақты токен жұмсалмаған
  let m = model.trim();
  m = m.replace(/\[[^\]]*\]\s*$/, '');           // [1m] сияқты контекст белгісін алу
  m = m.replace(/-\d{8}$/, '');                  // -20251001 күн белгісін алу
  return m || null;
}

function modelRate(model) {
  const p = pricing || { models: {} };
  return (p.models && p.models[model]) || p.fallback ||
    { label: model, input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 };
}

function modelLabel(model) {
  const r = modelRate(model);
  return (r && r.label) || model;
}

// Бір жазбаның $ құны
function eventCost(ev) {
  const r = modelRate(ev.model);
  const M = 1000000;
  return (
    (ev.in   / M) * (r.input          || 0) +
    (ev.out  / M) * (r.output         || 0) +
    (ev.cw5  / M) * (r.cache_write_5m || 0) +
    (ev.cw1h / M) * (r.cache_write_1h || 0) +
    (ev.cr   / M) * (r.cache_read     || 0)
  );
}

// ------------------------------------------------- parser денсаулығын бақылау
//
// Мақсаты: Claude Code транскрипт пішімін өзгертсе, виджет үнсіз нөл көрсетпесін.
// Ереже: соңғы 10 минутта .jsonl файлдарға жаңа жол қосылған, бірақ бірде-бір
// токен жазбасы оқылмаса — пішім өзгерген деп санаймыз.

const HEALTH_WINDOW_MS = 10 * 60 * 1000;
const SUSPECT_LINES = 40;        // assistant жолы мүлде танылмаса, осыншама жол жеткілікті

const hb = { lines: 0, assistantLines: 0, parsed: 0 };   // ағымдағы шолудың есептегіші
const healthLog = [];                                    // [{ ts, lines, assistantLines, parsed }]
const reasons = new Map();                               // себеп → { count, lastTs }

// Қай өріс табылмағанын белгілеу (лог пен есеп үшін)
function note(reason) {
  const r = reasons.get(reason) || { count: 0, lastTs: 0 };
  r.count++;
  r.lastTs = Date.now();
  reasons.set(reason, r);
  if (reasons.size > 60) {
    // Тізім шектен аспасын — ең ескісін тастаймыз
    let oldestKey = null, oldestTs = Infinity;
    for (const [k, v] of reasons) if (v.lastTs < oldestTs) { oldestTs = v.lastTs; oldestKey = k; }
    if (oldestKey) reasons.delete(oldestKey);
  }
}

// Әр шолудан кейін есептегішті терезеге қосамыз
function healthCommit() {
  if (hb.lines || hb.assistantLines || hb.parsed) {
    healthLog.push({ ts: Date.now(), lines: hb.lines, assistantLines: hb.assistantLines, parsed: hb.parsed });
  }
  hb.lines = 0; hb.assistantLines = 0; hb.parsed = 0;
  const cutoff = Date.now() - HEALTH_WINDOW_MS;
  while (healthLog.length && healthLog[0].ts < cutoff) healthLog.shift();
}

// Ағымдағы күй. ok:false болса — виджетте сары жолақ шығады.
function health() {
  const cutoff = Date.now() - HEALTH_WINDOW_MS;
  let lines = 0, assistantLines = 0, parsed = 0;
  for (const r of healthLog) {
    if (r.ts < cutoff) continue;
    lines += r.lines; assistantLines += r.assistantLines; parsed += r.parsed;
  }

  // Соңғы 10 минуттағы себептер (ең жиісі бірінші)
  const top = [];
  for (const [k, v] of reasons) if (v.lastTs >= cutoff) top.push({ reason: k, count: v.count });
  top.sort((a, b) => b.count - a.count);

  let ok = true;
  let cause = null;

  if (parsed === 0 && assistantLines > 0) {
    ok = false;
    cause = 'assistant жолдары бар (' + assistantLines + '), бірақ бірде-бір токен жазбасы оқылмады';
  } else if (parsed === 0 && lines >= SUSPECT_LINES) {
    ok = false;
    cause = lines + ' жаңа жол қосылды, бірақ assistant жазбасы мүлде табылмады';
  }

  return { ok, cause, lines, assistantLines, parsed, reasons: top.slice(0, 6), windowMs: HEALTH_WINDOW_MS };
}

// ------------------------------------------------------------------ оқу логикасы

// Бір JSON жолын өңдеу. Қайтарады: жазба (event) немесе null.
//
// ЕСКЕРТУ: талдау логикасы өзгермеген. `note()` шақырулары — тек бақылау
// есептегіші: қай өріс табылмағанын жазып отырады (health.js есебі үшін).
function parseLine(line, projectDir) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }   // Бұзылған жол — өткізіп жіберу
  if (!j || j.type !== 'assistant') return null;

  hb.assistantLines++;                                   // assistant жолын көрдік

  const msg = j.message;
  if (!msg) { note('message өрісі жоқ'); return null; }
  if (!msg.usage) { note('message.usage өрісі жоқ'); return null; }

  const model = normalizeModel(msg.model);
  if (!model) {
    // '<synthetic>' — қалыпты жағдай, мәселе емес
    if (msg.model !== '<synthetic>') note('message.model танылмады: ' + String(msg.model).slice(0, 40));
    return null;
  }

  const u = msg.usage;
  const inp = Number(u.input_tokens) || 0;
  const out = Number(u.output_tokens) || 0;
  const cr  = Number(u.cache_read_input_tokens) || 0;
  const cwTotal = Number(u.cache_creation_input_tokens) || 0;

  // Кэш жазу 5 минуттық және 1 сағаттық болып бөлінеді — бағасы әртүрлі
  let cw5 = 0, cw1h = 0;
  const cc = u.cache_creation;
  if (cc && typeof cc === 'object') {
    cw5  = Number(cc.ephemeral_5m_input_tokens) || 0;
    cw1h = Number(cc.ephemeral_1h_input_tokens) || 0;
  }
  if (cw5 + cw1h === 0) cw5 = cwTotal;   // Бөлініс жоқ болса — бәрін 5м деп есептейміз

  if (inp + out + cr + cw5 + cw1h === 0) { note('usage ішіндегі токендер нөл'); return null; }

  const ts = Date.parse(j.timestamp);
  if (!Number.isFinite(ts)) { note('timestamp оқылмады'); return null; }

  // Дедупликация кілті: message.id + requestId
  const key = (msg.id || 'noid') + '|' + (j.requestId || 'noreq');

  hb.parsed++;                                           // сәтті оқылған жазба
  return {
    key,
    ts,
    model,
    project: cwdToName(j.cwd) || projectDirToName(projectDir),
    projectDir,
    sessionId: j.sessionId || null,
    isSub: j.isSidechain === true,
    in: inp, out, cw5, cw1h, cr,
  };
}

// Файлдың тек жаңа бөлігін оқу
async function readFileTail(filePath, projectDir, cutoffMs) {
  let st;
  try { st = await fsp.stat(filePath); } catch { return; }

  let entry = state.files.get(filePath);
  if (!entry) {
    // Бірінші көру. Ескі файлды (cutoff-тан бұрын өзгертілген) мүлде оқымаймыз —
    // тек өлшемін белгілеп қоямыз. Бұл алғашқы іске қосуды бірнеше есе тездетеді.
    if (st.mtimeMs < cutoffMs) {
      state.files.set(filePath, { offset: st.size, rest: '' });
      return;
    }
    entry = { offset: 0, rest: '' };
    state.files.set(filePath, entry);
  }

  // Файл кішірейсе (қайта жазылса) — басынан оқимыз
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
    entry.rest = lines.pop() || '';   // Соңғы жол әлі аяқталмаған болуы мүмкін

    for (const line of lines) {
      if (!line || line.length < 2) continue;
      hb.lines++;                                  // жаңа жол оқылды (бақылау есептегіші)
      const ev = parseLine(line, projectDir);
      if (!ev) continue;
      if (state.seen.has(ev.key)) continue;     // Қайталанған жазба — екі рет санамаймыз
      state.seen.set(ev.key, ev.ts);
      state.events.push(ev);

      const proj = state.projects.get(projectDir) ||
        { dir: projectDir, name: ev.project, lastActive: 0 };
      proj.name = ev.project;
      if (ev.ts > proj.lastActive) proj.lastActive = ev.ts;
      state.projects.set(projectDir, proj);
    }
  } catch {
    // Файл бос емес / қолжетімсіз — келесі айналымда қайталанады
  } finally {
    if (fh) { try { await fh.close(); } catch {} }
  }
}

// Папкадағы барлық .jsonl файлдарын (subagents ішіндегілерін қоса) жинау
async function listJsonl(dir, depth = 0, acc = []) {
  if (depth > 5) return acc;
  let items;
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) await listJsonl(full, depth + 1, acc);
    else if (it.isFile() && it.name.endsWith('.jsonl')) acc.push(full);
  }
  return acc;
}

// Барлық жобаларды шолу (толық) немесе тек өзгерген файлдарды оқу
async function scan(options) {
  const full = !!(options && options.full);
  if (state.scanning) return;
  state.scanning = true;
  const cutoffMs = Date.now() - KEEP_MS;

  try {
    const root = projectsDir();
    let dirs = [];
    try {
      const items = await fsp.readdir(root, { withFileTypes: true });
      dirs = items.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      dirs = [];
    }

    // Барлық жоба папкасын тіркеу (бүгін белсенді болмаса да жалпы санға кіреді)
    for (const d of dirs) {
      if (!state.projects.has(d)) {
        state.projects.set(d, { dir: d, name: projectDirToName(d), lastActive: 0 });
      }
    }

    if (full) {
      for (const d of dirs) {
        const files = await listJsonl(path.join(root, d));
        for (const f of files) await readFileTail(f, d, cutoffMs);
      }
    } else {
      const targets = Array.from(state.dirty);
      state.dirty.clear();
      for (const f of targets) {
        const rel = path.relative(root, f);
        if (!rel || rel.startsWith('..')) continue;
        const projectDir = rel.split(path.sep)[0];
        if (!projectDir) continue;
        await readFileTail(f, projectDir, cutoffMs);
      }
    }

    prune();
    healthCommit();                 // бақылау есептегішін терезеге қосамыз
    state.ready = true;
    state.lastScanMs = Date.now();
  } finally {
    state.scanning = false;
  }
}

// Ескі жазбаларды жадыдан тазалау
function prune() {
  const cutoff = Date.now() - KEEP_MS;
  if (state.events.length && state.events[0].ts < cutoff) {
    state.events = state.events.filter((e) => e.ts >= cutoff);
  }
  if (state.seen.size > 20000) {
    for (const [k, ts] of state.seen) if (ts < cutoff) state.seen.delete(k);
  }
}

// ------------------------------------------------------------------ файл бақылау
function startWatching(onChange) {
  const root = projectsDir();
  try {
    state.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      persistent: true,
      depth: 5,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
      ignored: (p, st) => {
        if (st && st.isFile()) return !p.endsWith('.jsonl');
        return false;
      },
    });
    const mark = (f) => {
      if (typeof f === 'string' && f.endsWith('.jsonl')) {
        state.dirty.add(f);
        if (onChange) onChange();
      }
    };
    state.watcher.on('add', mark);
    state.watcher.on('change', mark);
    state.watcher.on('error', () => {});   // Бақылау қатесі аппты құлатпайды
  } catch {
    state.watcher = null;   // Бақылау істемесе — мерзімді шолу жалғаса береді
  }
}

function stopWatching() {
  if (state.watcher) {
    try { state.watcher.close(); } catch {}
    state.watcher = null;
  }
}

// ------------------------------------------------------------------ қосындылар
function emptyBucket() {
  return { in: 0, out: 0, cw5: 0, cw1h: 0, cr: 0, total: 0, cost: 0, byModel: {} };
}

function addToBucket(b, ev) {
  const cost = eventCost(ev);
  const tot = ev.in + ev.out + ev.cw5 + ev.cw1h + ev.cr;
  b.in += ev.in; b.out += ev.out; b.cw5 += ev.cw5; b.cw1h += ev.cw1h; b.cr += ev.cr;
  b.total += tot;
  b.cost += cost;
  let m = b.byModel[ev.model];
  if (!m) {
    m = { label: modelLabel(ev.model), in: 0, out: 0, cache: 0, total: 0, cost: 0 };
    b.byModel[ev.model] = m;
  }
  m.in += ev.in; m.out += ev.out; m.cache += ev.cw5 + ev.cw1h + ev.cr;
  m.total += tot; m.cost += cost;
}

// Жергілікті күннің басы (00:00)
function startOfToday(now) {
  const d = new Date(now || Date.now());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Аптаның басы — дүйсенбі 00:00
function startOfWeek(now) {
  const d = new Date(now || Date.now());
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();                  // 0 = жексенбі
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d.getTime();
}

function summary() {
  const now = Date.now();
  const t5h = now - FIVE_HOUR_MS;
  const tToday = startOfToday(now);
  const tWeek = startOfWeek(now);

  const last5h = emptyBucket();
  const today = emptyBucket();
  const week = emptyBucket();
  const perProjectToday = new Map();

  for (const ev of state.events) {
    if (ev.ts >= t5h) addToBucket(last5h, ev);
    if (ev.ts >= tToday) {
      addToBucket(today, ev);
      let p = perProjectToday.get(ev.projectDir);
      if (!p) {
        p = { dir: ev.projectDir, name: ev.project, tokens: 0, cost: 0, lastActive: 0 };
        perProjectToday.set(ev.projectDir, p);
      }
      p.name = ev.project;
      p.tokens += ev.in + ev.out + ev.cw5 + ev.cw1h + ev.cr;
      p.cost += eventCost(ev);
      if (ev.ts > p.lastActive) p.lastActive = ev.ts;
    }
    if (ev.ts >= tWeek) addToBucket(week, ev);
  }

  const sortModels = (b) => Object.keys(b.byModel)
    .map((id) => Object.assign({ id }, b.byModel[id]))
    .sort((a, c) => c.total - a.total);

  const projectsToday = Array.from(perProjectToday.values()).sort((a, b) => b.tokens - a.tokens);

  return {
    ready: state.ready,
    updatedAt: now,
    windows: {
      last5h: Object.assign({}, last5h, { models: sortModels(last5h) }),
      today:  Object.assign({}, today,  { models: sortModels(today) }),
      week:   Object.assign({}, week,   { models: sortModels(week) }),
    },
    projects: {
      total: state.projects.size,
      activeToday: projectsToday.length,
      list: projectsToday,
    },
  };
}

function rawEvents() { return state.events; }

module.exports = {
  loadPricing, getPricing, normalizeModel, modelLabel, modelRate,
  scan, startWatching, stopWatching, summary, rawEvents,
  startOfToday, startOfWeek, listJsonl,
  eventCost,          // тарих модулі құнды дәл осы формуламен санауы үшін
  health,             // parser тыныш бұзылуын бақылау
};
