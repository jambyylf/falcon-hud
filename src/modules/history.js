'use strict';
// history.js — күнделікті жиынтық тарих.
//
// НЕГЕ КЕРЕК: Claude Code ескі .jsonl файлдарын тазалап тастайды. Сонда өткен ай
// туралы дерек мәңгі жоғалады. Бұл модуль күніне бір жазба қалдырады — сессияларды
// емес, тек қорытындыны. Файл кішкентай болып қала береді.
//
// Орны:  ~/.claude/falconhud/history.json
// Лог:   ~/.claude/falconhud/parser-issues.log

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { claudeRoot } = require('./paths');

const KEEP_DAYS = 120;           // Одан ескі күндер өшіріледі — файл өспесін
const WINDOW_DAYS = 30;          // «30 күн» табы осынша күнді қосады
const MAX_LOG_BYTES = 256 * 1024;

const state = {
  data: null,                    // { version, updatedAt, days: { 'YYYY-MM-DD': {...} } }
  loaded: false,
  dirty: false,
  writing: false,
};

// ──────────────────────────────────────────────── жолдар

function dataDir() { return path.join(claudeRoot(), 'falconhud'); }
function historyFile() { return path.join(dataDir(), 'history.json'); }
function logFile() { return path.join(dataDir(), 'parser-issues.log'); }

function ensureDir() {
  try { fs.mkdirSync(dataDir(), { recursive: true }); return true; } catch { return false; }
}

// ──────────────────────────────────────────────── лог

// Parser мәселесін файлға жазу (кейін жөндеу оңай болсын)
function appendLog(text) {
  try {
    ensureDir();
    const f = logFile();
    // Лог шектен асса — басынан бастаймыз
    try {
      const st = fs.statSync(f);
      if (st.size > MAX_LOG_BYTES) fs.writeFileSync(f, '', 'utf8');
    } catch { /* файл әлі жоқ */ }
    fs.appendFileSync(f, new Date().toISOString() + '  ' + text + '\n', 'utf8');
  } catch { /* лог жазылмаса — апп жұмысын жалғастырады */ }
}

// ──────────────────────────────────────────────── оқу / жазу

function emptyData() {
  return { version: 1, updatedAt: null, days: {} };
}

async function load() {
  if (state.loaded) return state.data;
  try {
    const raw = await fsp.readFile(historyFile(), 'utf8');
    const j = JSON.parse(raw);
    state.data = (j && typeof j === 'object' && j.days) ? j : emptyData();
  } catch {
    state.data = emptyData();     // Файл жоқ немесе бүлінген — нөлден бастаймыз
  }
  state.loaded = true;
  return state.data;
}

async function save() {
  if (!state.dirty || state.writing || !state.data) return;
  state.writing = true;
  try {
    ensureDir();
    prune();
    state.data.updatedAt = new Date().toISOString();
    const tmp = historyFile() + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(state.data), 'utf8');
    await fsp.rename(tmp, historyFile());   // атомарлы ауыстыру — файл жартылай қалмайды
    state.dirty = false;
  } catch { /* жазылмаса — келесі жолы қайталанады */ } finally {
    state.writing = false;
  }
}

function prune() {
  const days = Object.keys(state.data.days);
  if (days.length <= KEEP_DAYS) return;
  days.sort();
  for (const d of days.slice(0, days.length - KEEP_DAYS)) delete state.data.days[d];
}

// ──────────────────────────────────────────────── жинақтау

function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Жадыдағы оқиғалардан күн-күнге бөлінген жиынтық құру.
// Кэш ЕКІ өріске бөлек жазылады: cw = жазу, cr = оқу. Әйтпесе «30 күн» табында
// «Кэш жазу» әрқашан нөл болып көрінер еді.
function aggregate(events, costOf) {
  const out = new Map();
  for (const ev of events) {
    const key = dayKey(ev.ts);
    let day = out.get(key);
    if (!day) {
      day = { total: 0, in: 0, out: 0, cw: 0, cr: 0, cache: 0, cost: 0, models: {}, projects: {} };
      out.set(key, day);
    }
    const cw = ev.cw5 + ev.cw1h;
    const cache = cw + ev.cr;
    const total = ev.in + ev.out + cache;
    const cost = costOf(ev);

    day.total += total; day.in += ev.in; day.out += ev.out;
    day.cw += cw; day.cr += ev.cr; day.cache += cache; day.cost += cost;

    let m = day.models[ev.model];
    if (!m) m = day.models[ev.model] = { total: 0, in: 0, out: 0, cache: 0, cost: 0 };
    m.total += total; m.in += ev.in; m.out += ev.out; m.cache += cache; m.cost += cost;

    const pk = ev.project || '—';
    let p = day.projects[pk];
    if (!p) p = day.projects[pk] = { total: 0, cost: 0 };
    p.total += total; p.cost += cost;
  }
  return out;
}

// Сандарды дөңгелектеп, файлды кішірейтеміз
function round(day) {
  const r = (n) => Math.round(n);
  const c = (n) => Math.round(n * 100) / 100;
  const o = {
    total: r(day.total), in: r(day.in), out: r(day.out),
    cw: r(day.cw), cr: r(day.cr), cache: r(day.cache),
    cost: c(day.cost), models: {}, projects: {},
  };
  for (const [k, v] of Object.entries(day.models)) {
    o.models[k] = { total: r(v.total), in: r(v.in), out: r(v.out), cache: r(v.cache), cost: c(v.cost) };
  }
  // Жоба бойынша — тек мағыналы үлесі барларын сақтаймыз (файл кішкентай болсын)
  const projs = Object.entries(day.projects).sort((a, b) => b[1].total - a[1].total).slice(0, 12);
  for (const [k, v] of projs) o.projects[k] = { total: r(v.total), cost: c(v.cost) };
  return o;
}

/**
 * Жадыдағы оқиғалардан тарихты жаңарту.
 * Бір күнге бір ғана жазба қалады.
 *
 * ЕСКЕРТУ: егер .jsonl файлдар тазаланған болса, жадыдағы дерек толық емес.
 * Сондықтан бұрынғы жазба ҮЛКЕН болса, оны кішісімен ауыстырмаймыз.
 */
async function update(events, costOf) {
  await load();
  const agg = aggregate(events, costOf);
  let changed = false;

  for (const [key, day] of agg) {
    const fresh = round(day);
    const old = state.data.days[key];
    if (old && Number(old.total) > fresh.total) continue;   // ескісі толығырақ — тимейміз
    // Өзгеріс жоқ әрі жазба жаңа пішімде (cw/cr бөлек) болса — тимейміз
    if (old && old.total === fresh.total && old.cw != null) continue;
    state.data.days[key] = fresh;
    changed = true;
  }

  if (changed) { state.dirty = true; await save(); }
  return changed;
}

// ──────────────────────────────────────────────── «30 күн» терезесі

// Renderer-ге дайын күйінде береміз — оның пішіні usage.windows.* сияқты
function window30(labelOf) {
  const d = state.data;
  if (!d || !d.days) return { ok: false, days: 0, window30: null };

  const keys = Object.keys(d.days).sort();
  if (!keys.length) return { ok: false, days: 0, window30: null };

  const cutoff = dayKey(Date.now() - (WINDOW_DAYS - 1) * 24 * 3600 * 1000);
  const used = keys.filter((k) => k >= cutoff);
  if (!used.length) return { ok: false, days: 0, window30: null };

  const w = { in: 0, out: 0, cw5: 0, cw1h: 0, cr: 0, total: 0, cost: 0, models: [] };
  const byModel = new Map();

  for (const k of used) {
    const day = d.days[k];
    w.in += day.in || 0;
    w.out += day.out || 0;
    // Ескі жазбаларда cw/cr бөлінбеген — оларда бәрі «кэш оқу» болып саналады
    if (day.cw != null || day.cr != null) {
      w.cw5 += day.cw || 0;
      w.cr += day.cr || 0;
    } else {
      w.cr += day.cache || 0;
    }
    w.total += day.total || 0;
    w.cost += day.cost || 0;

    for (const [id, m] of Object.entries(day.models || {})) {
      let acc = byModel.get(id);
      if (!acc) { acc = { id, in: 0, out: 0, cache: 0, total: 0, cost: 0 }; byModel.set(id, acc); }
      acc.in += m.in || 0; acc.out += m.out || 0; acc.cache += m.cache || 0;
      acc.total += m.total || 0; acc.cost += m.cost || 0;
    }
  }

  w.models = Array.from(byModel.values())
    .map((m) => Object.assign({ label: labelOf ? labelOf(m.id) : m.id }, m))
    .sort((a, b) => b.total - a.total);
  w.cost = Math.round(w.cost * 100) / 100;

  return {
    ok: true,
    days: used.length,
    firstDay: used[0],
    lastDay: used[used.length - 1],
    window30: w,
  };
}

module.exports = {
  load, save, update, window30, appendLog,
  dataDir, historyFile, logFile, dayKey,
  WINDOW_DAYS,
};
