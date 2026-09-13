'use strict';
// forecast.js — «лимит осы қарқынмен қашан бітеді?» деген сұраққа жауап.
//
// Виджет қазір «қанша ЖҰМСАЛДЫ» дегенді ғана көрсетеді. Ал шын керегі —
// «бұлай жұмсай берсем, терезе жаңарғанша жетеді ме?» деген сұрақ.
//
// Қалай істейміз:
//   1. Әр лимиттің пайызын уақытымен бірге есте сақтаймыз (үлгі = sample).
//   2. Соңғы 90 минуттың үлгілеріне түзу сызық жүргіземіз (ең кіші квадраттар).
//      Бір-екі кездейсоқ секірісті тегістеу үшін дәл осы әдіс керек.
//   3. Сол қарқынмен 100%-ға қашан жететінін есептейміз.
//   4. Ол уақыт терезенің жаңару сәтінен КЕЙІН болса — «жетеді» дейміз,
//      БҰРЫН болса — нақты сағатын көрсетеміз.
//
// Үлгілер ~/.claude/falconhud/limit-trend.json файлында сақталады: апп қайта
// қосылғанда болжам нөлден басталмасын.
//
// МАҢЫЗДЫ: бұл жерде ешқандай құпия дерек жоқ — тек пайыз бен уақыт.

const fs = require('fs');
const path = require('path');
const history = require('./history');

// ──────────────────────────────────────────────── баптаулар

const MIN_GAP_MS = 25 * 1000;        // үлгілерді жиі жазбаймыз
const TREND_MS = 90 * 60 * 1000;     // болжам соңғы 90 минутқа қарайды
const MIN_SAMPLES = 3;               // үш нүктеден азына сызық жүргізбейміз
const MIN_SPAN_MS = 8 * 60 * 1000;   // әрі олар кемінде 8 минутқа созылсын
const MAX_SAMPLES = 300;             // бір лимитке
const DROP_PCT = 2;                  // пайыз осыншаға түссе — терезе жаңарған
const SAVE_DELAY_MS = 20 * 1000;

const state = {
  series: new Map(),   // id → { resetsAt, points: [{ t, p }] }
  loaded: false,
  timer: null,
};

function trendFile() { return path.join(history.dataDir(), 'limit-trend.json'); }

// ──────────────────────────────────────────────── файл

function load() {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(trendFile(), 'utf8'));
    if (!raw || !raw.series) return;
    const now = Date.now();
    for (const [id, s] of Object.entries(raw.series)) {
      if (!s || !Array.isArray(s.points)) continue;
      // Тым ескі үлгілердің қажеті жоқ
      const points = s.points
        .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.p) && now - p.t < TREND_MS * 2)
        .slice(-MAX_SAMPLES);
      if (points.length) state.series.set(id, { resetsAt: s.resetsAt || 0, points });
    }
  } catch {
    /* файл жоқ немесе бүлінген — нөлден бастаймыз */
  }
}

function scheduleSave() {
  if (state.timer) return;
  state.timer = setTimeout(() => { state.timer = null; saveNow(); }, SAVE_DELAY_MS);
}

function saveNow() {
  try {
    fs.mkdirSync(history.dataDir(), { recursive: true });
    const series = {};
    for (const [id, s] of state.series) {
      series[id] = { resetsAt: s.resetsAt, points: s.points.slice(-MAX_SAMPLES) };
    }
    fs.writeFileSync(trendFile(), JSON.stringify({ version: 1, series }), 'utf8');
  } catch {
    /* жаза алмасақ — болжам жадта қала береді */
  }
}

// ──────────────────────────────────────────────── үлгі жинау

// Лимит тізімін көрген сайын шақырылады
function record(limits, now) {
  load();
  if (!Array.isArray(limits)) return;
  const t = now || Date.now();

  for (const l of limits) {
    if (!l || !l.id || typeof l.percent !== 'number' || !Number.isFinite(l.percent)) continue;

    const resets = Number(l.resetsAt) || 0;
    let s = state.series.get(l.id);

    if (!s) {
      s = { resetsAt: resets, points: [] };
      state.series.set(l.id, s);
    }

    const last = s.points[s.points.length - 1];

    // Терезе жаңарды ма? Екі белгі бар: жаңару уақыты жылжыды, не пайыз түсіп кетті.
    // Ондайда ескі үлгілер жарамсыз — олар басқа терезенің дерегі.
    const windowMoved = resets && s.resetsAt && resets > s.resetsAt + 60 * 1000;
    const dropped = last && l.percent < last.p - DROP_PCT;
    if (windowMoved || dropped) s.points = [];

    s.resetsAt = resets;

    const prev = s.points[s.points.length - 1];
    if (prev && t - prev.t < MIN_GAP_MS) {
      prev.p = l.percent;          // тым жиі келсе — соңғысын жаңартамыз
      continue;
    }

    s.points.push({ t, p: l.percent });
    if (s.points.length > MAX_SAMPLES) s.points.splice(0, s.points.length - MAX_SAMPLES);
  }

  scheduleSave();
}

// ──────────────────────────────────────────────── болжам

// Ең кіші квадраттар әдісімен қарқынды табамыз (пайыз / миллисекунд)
function slope(points) {
  const n = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  // Сандар үлкен болмас үшін уақытты бірінші нүктеден бастап санаймыз
  const t0 = points[0].t;
  for (const q of points) {
    const x = q.t - t0;
    sx += x; sy += q.p; sxx += x * x; sxy += x * q.p;
  }
  const denom = n * sxx - sx * sx;
  if (!denom) return 0;
  return (n * sxy - sx * sy) / denom;
}

// Бір лимиттің болжамы.
// Қайтарады: null (дерек аз) | { safe: true } (жетеді) | { at: <мс> } (бітеді)
function predict(limit, now) {
  load();
  if (!limit || !limit.id || typeof limit.percent !== 'number') return null;

  const s = state.series.get(limit.id);
  if (!s) return null;

  const t = now || Date.now();
  const points = s.points.filter((q) => t - q.t <= TREND_MS);
  if (points.length < MIN_SAMPLES) return null;

  const span = points[points.length - 1].t - points[0].t;
  if (span < MIN_SPAN_MS) return null;

  const rate = slope(points);            // пайыз / мс
  if (!Number.isFinite(rate) || rate <= 0) return { safe: true, rate: 0 };

  const left = 100 - limit.percent;
  if (left <= 0) return { at: t, rate };

  const at = t + left / rate;
  const resets = Number(limit.resetsAt) || 0;

  // Терезе бітуден бұрын жаңарса — лимит жетеді
  if (resets && at >= resets) return { safe: true, rate };

  return { at: Math.round(at), rate };
}

// Тізімге болжамды қосып қайтарады (бастапқы объектілерді өзгертпейміз)
function annotate(limits, now) {
  if (!Array.isArray(limits)) return limits;
  const t = now || Date.now();
  return limits.map((l) => {
    const p = predict(l, t);
    if (!p) return l;
    return Object.assign({}, l, {
      runsOutAt: p.at || null,
      willLast: !!p.safe,
    });
  });
}

function reset() {
  state.series.clear();
  saveNow();
}

module.exports = { record, predict, annotate, load, saveNow, reset, trendFile };
