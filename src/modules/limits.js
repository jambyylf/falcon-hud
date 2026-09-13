'use strict';
// limits.js — жазылым лимиттерін ресми емес oauth/usage endpoint арқылы оқиды.
//
// ЕРЕЖЕЛЕР (маңызды):
//  • Токен ЕШҚАШАН жаңартылмайды (refresh жасалмайды) — оны Claude Code өзі жаңартады.
//    Біз әр сұраныс алдында файлдан/Keychain-нан қайта оқимыз.
//  • Токен ешқашан логқа, экранға немесе IPC арқылы renderer-ге жіберілмейді.
//  • 5 минутта бір реттен жиі сұралмайды, нәтиже кэште сақталады.
//  • 401/429 келсе — күту уақыты өседі (backoff), виджет басқа бөлімдері жұмысын жалғастырады.

const fsp = require('fs/promises');
const { exec } = require('child_process');
const { credentialsFile } = require('./paths');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const MIN_INTERVAL_MS = 5 * 60 * 1000;      // Ең жиі сұрау аралығы — 5 минут
const MAX_BACKOFF_MS = 60 * 60 * 1000;      // Ең ұзақ күту — 1 сағат
const REQUEST_TIMEOUT_MS = 12000;

const state = {
  cache: null,         // Сәтті жауаптың өңделген түрі
  fetchedAt: 0,
  backoffMs: 0,
  nextAllowedAt: 0,
  lastError: null,
  inFlight: null,
};

// ---------------------------------------------------------------- токенді оқу

// macOS: Keychain ішіндегі "Claude Code-credentials" жазбасы
function readKeychain() {
  return new Promise((resolve) => {
    exec(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { timeout: 6000, windowsHide: true, maxBuffer: 512 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        resolve(String(stdout).trim() || null);
      }
    );
  });
}

// Токенді алу. Қайтарылатын мән ешқайда сақталмайды, тек сол сұранысқа қолданылады.
async function readAccessToken() {
  let raw = null;
  if (process.platform === 'darwin') {
    raw = await readKeychain();
    if (!raw) {
      // macOS-та кейде файл да болады — резерв ретінде қараймыз
      try { raw = await fsp.readFile(credentialsFile(), 'utf8'); } catch { raw = null; }
    }
  } else {
    try { raw = await fsp.readFile(credentialsFile(), 'utf8'); } catch { raw = null; }
  }
  if (!raw) return null;

  try {
    const j = JSON.parse(raw);
    const oauth = j.claudeAiOauth || j;
    const token = oauth && oauth.accessToken;
    return (typeof token === 'string' && token.length > 10) ? token : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- жауапты нормалау

// Уақытты ms-қа келтіру: ISO жол да, unix секунд та келуі мүмкін
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== '') return n > 1e12 ? n : n * 1000;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : null;
}

// Пайызды 0..100 аралығына келтіру (кейде 0..1 үлес түрінде келеді)
// «percent» деп аталған өріс ӘРҚАШАН пайыз: 1 деген — бір пайыз.
//
// Бұрын мұнда «сан 1-ден кіші болса, бөлшек шығар» деген болжам тұрған еді
// (0.23 → 23%). Ол қате болып шықты: API percent: 1 деп қайтарғанда, яғни
// лимит жаңа ғана жаңарып, бір-ақ пайызы жұмсалғанда, виджет 100% деп
// көрсететін. Ақау дәл ең маңызды сәтте — терезе жаңарғанда — шығатын.
// Сондықтан бұл өрісті ЕШҚАШАН көбейтпейміз.
function toPercent(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

// Ал «utilization» деп аталған өріс бөлшек болуы мүмкін (0.23 = 23%) —
// бұл атаудың жалпы қабылданған мағынасы сондай. Бірақ шешімді бір мәнге
// қарап емес, бүкіл жауапқа қарап қабылдаймыз: ішінде 1-ден үлкен сан болса,
// демек API пайызбен жазады.
function toUtilization(v, allAreFractions) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return allAreFractions && n >= 0 && n <= 1 ? n * 100 : n;
}

// Жауаптағы utilization мәндерінің бәрі 1-ден кіші ме?
function utilizationsAreFractions(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return false;
  return nums.every((n) => n >= 0 && n <= 1);
}

function kindLabel(kind, modelName) {
  switch (kind) {
    case 'session':       return '5 сағаттық сессия';
    case 'weekly_all':    return 'Апталық (жалпы)';
    case 'weekly_scoped': return modelName ? `Апталық — ${modelName}` : 'Апталық (модель)';
    default:              return modelName ? `${kind} — ${modelName}` : String(kind || 'Лимит');
  }
}

// Резервтік өрістердің атауын адамша атауға айналдыру.
// Жаңа модель қосылса (мысалы seven_day_fable) — код өзгертпей-ақ көрінеді.
function fallbackLabel(key) {
  if (key === 'five_hour') return '5 сағаттық сессия';
  if (key === 'seven_day') return 'Апталық (жалпы)';
  const m = /^seven_day[_-](.+)$/.exec(key);
  if (m) {
    const name = m[1].replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `Апталық — ${name}`;
  }
  return key.replace(/[_-]+/g, ' ');
}

function fallbackOrder(key) {
  if (key === 'five_hour') return 0;
  if (key === 'seven_day') return 1;
  return 2;
}

// Әртүрлі жауап пішімін бір қалыпқа келтіру
function normalize(data) {
  const out = [];

  // 1-нұсқа: limits массиві (жаңа пішім)
  if (data && Array.isArray(data.limits)) {
    // utilization пішімін бір рет, бүкіл жауапқа қарап шешеміз
    const fractions = utilizationsAreFractions(
      data.limits.filter((l) => l && l.percent == null).map((l) => l && l.utilization)
    );
    for (const l of data.limits) {
      if (!l || typeof l !== 'object') continue;
      const modelName =
        (l.scope && l.scope.model && (l.scope.model.display_name || l.scope.model.name)) ||
        (l.scope && l.scope.display_name) || null;
      const pct = l.percent != null
        ? toPercent(l.percent)
        : toUtilization(l.utilization, fractions);
      if (pct == null) continue;
      out.push({
        id: `${l.kind || 'limit'}:${modelName || 'all'}`,
        kind: l.kind || 'limit',
        label: kindLabel(l.kind, modelName),
        percent: Math.max(0, Math.min(100, pct)),
        remaining: Math.max(0, 100 - Math.max(0, Math.min(100, pct))),
        resetsAt: toMs(l.resets_at || l.reset_at || l.resetsAt),
        order: l.kind === 'session' ? 0 : (l.kind === 'weekly_all' ? 1 : 2),
      });
    }
  }

  // 2-нұсқа: five_hour / seven_day / seven_day_<model> өрістері (ескі пішім)
  if (!out.length && data && typeof data === 'object') {
    const fbFractions = utilizationsAreFractions(
      Object.keys(data)
        .filter((k) => /^(five_hour|seven_day)/.test(k) && data[k] && data[k].percent == null)
        .map((k) => data[k].utilization)
    );
    for (const key of Object.keys(data)) {
      if (!/^(five_hour|seven_day)/.test(key)) continue;
      const v = data[key];
      if (!v || typeof v !== 'object') continue;
      const pct = v.percent != null
        ? toPercent(v.percent)
        : toUtilization(v.utilization, fbFractions);
      if (pct == null) continue;
      out.push({
        id: key,
        kind: key,
        label: fallbackLabel(key),
        percent: Math.max(0, Math.min(100, pct)),
        remaining: Math.max(0, 100 - Math.max(0, Math.min(100, pct))),
        resetsAt: toMs(v.resets_at || v.reset_at || v.resetsAt),
        order: fallbackOrder(key),
      });
    }
  }

  out.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label, 'kk'));
  return out;
}

// ---------------------------------------------------------------- сұраныс

async function requestUsage(token) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
        'User-Agent': 'FalconHUD/1.0',
      },
      signal: ac.signal,
    });

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Қате түріне қарай күту уақытын ұлғайту
function applyBackoff(status) {
  const base = state.backoffMs > 0 ? state.backoffMs * 2 : MIN_INTERVAL_MS;
  state.backoffMs = Math.min(base, MAX_BACKOFF_MS);
  state.nextAllowedAt = Date.now() + state.backoffMs;
  if (status === 401 || status === 403) {
    state.lastError = 'Кіру рұқсаты жоқ (Claude Code-қа қайта кіріңіз)';
  } else if (status === 429) {
    state.lastError = 'Сұраныс тым жиі — күтудеміз';
  } else {
    state.lastError = 'Лимит дерегі уақытша жоқ';
  }
}

function clearBackoff() {
  state.backoffMs = 0;
  state.nextAllowedAt = 0;
  state.lastError = null;
}

// Негізгі функция. force=true болса минималды аралықты елемейді (бірақ backoff-ты емес).
async function getLimits(force) {
  const now = Date.now();

  const fresh = state.cache && (now - state.fetchedAt < MIN_INTERVAL_MS);
  if (fresh && !force) return snapshot();

  if (now < state.nextAllowedAt) return snapshot();      // Backoff кезеңі — сұрамаймыз
  if (state.inFlight) return state.inFlight;

  state.inFlight = (async () => {
    try {
      const token = await readAccessToken();
      if (!token) {
        state.lastError = 'Токен табылмады (.credentials.json)';
        state.nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
        return snapshot();
      }

      const data = await requestUsage(token);
      const limits = normalize(data);

      if (!limits.length) {
        state.lastError = 'Лимит дерегі танылмады';
        state.nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
        return snapshot();
      }

      state.cache = limits;
      state.fetchedAt = Date.now();
      clearBackoff();
      return snapshot();
    } catch (e) {
      applyBackoff(e && e.status);
      return snapshot();
    } finally {
      state.inFlight = null;
    }
  })();

  return state.inFlight;
}

// Renderer-ге берілетін қауіпсіз көрініс (токен жоқ!)
function snapshot() {
  return {
    ok: !!(state.cache && state.cache.length),
    limits: state.cache || [],
    fetchedAt: state.fetchedAt || null,
    stale: state.cache ? (Date.now() - state.fetchedAt > MIN_INTERVAL_MS * 2) : false,
    error: state.cache ? null : (state.lastError || 'Лимит дерегі уақытша жоқ'),
    warning: state.cache && state.lastError ? state.lastError : null,
    nextTryAt: state.nextAllowedAt || null,
  };
}

module.exports = { getLimits, snapshot, MIN_INTERVAL_MS };
