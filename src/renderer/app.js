'use strict';
/* ════════════════════════════════════════════════════════════════════
   FalconHUD — интерфейс логикасы.
   Мұнда Node.js жоқ: дерек тек window.hud (preload) арқылы келеді.
   Бұл файл тек КӨРСЕТУМЕН айналысады — есептеу негізгі процесте.
   ════════════════════════════════════════════════════════════════════ */

/* ───────────────────────── Lucide иконкалары ─────────────────────────
   Сыртқы сұраныс болмауы үшін SVG жолдары осында тікелей жазылған.
   Дереккөз: lucide.dev (ISC лицензиясы), viewBox 24×24, stroke 2.        */
const ICONS = {
  pin:        '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  minimize:   '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>',
  maximize:   '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  x:          '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  settings:   '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  gauge:      '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  hash:       '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  bot:        '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  folder:     '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  cpu:        '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  monitor:    '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  memory:     '<path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.8V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.8Z"/>',
  drive:      '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  activity:   '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  terminal:   '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  pencil:     '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  fileText:   '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  filePlus:   '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  search:     '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  globe:      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  sparkles:   '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>',
  branch:     '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  workflow:   '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  dot:        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  moon:       '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  alert:      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  flask:      '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
  calendar:   '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  chevron:    '<path d="m9 18 6-6-6-6"/>',
};

// SVG иконка элементін жасау
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name] || ICONS.dot;   // тек жоғарыдағы тұрақты жолдар
  const span = document.createElement('i');
  span.className = 'ic';
  span.appendChild(svg);
  return span;
}

// Құрал атауы → иконка
const TOOL_ICON = {
  Edit: 'pencil', Write: 'filePlus', NotebookEdit: 'pencil',
  Read: 'fileText',
  Bash: 'terminal', PowerShell: 'terminal',
  Grep: 'search', Glob: 'folder', WebSearch: 'search', WebFetch: 'globe',
  Agent: 'branch', Task: 'branch',
  Skill: 'sparkles', Workflow: 'workflow',
};
function toolIcon(tool) { return TOOL_ICON[tool] || 'dot'; }

/* ─────────────────────────── Пішімдеу ─────────────────────────── */

// 1 234 567 → "1.2M"
function compact(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

function money(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return '$' + compact(v);
  if (v >= 0.01) return '$' + v.toFixed(2);
  if (v > 0) return '<$0.01';
  return '$0';
}

function bytes(b) {
  if (b == null || !Number.isFinite(b)) return '—';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(v < 10 && i >= 2 ? 1 : 0) + ' ' + u[i];
}

function speed(b) {
  if (b == null || !Number.isFinite(b)) return '—';
  if (b < 1024) return Math.round(b) + ' Б/с';
  if (b < 1048576) return Math.round(b / 1024) + ' КБ/с';
  return (b / 1048576).toFixed(1) + ' МБ/с';
}

// Ұзақтық: "1 сағ 40 м"
function dur(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.floor(sec);
  if (s < 60) return s + ' с';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' м' + (s % 60 ? ' ' + (s % 60) + ' с' : '');
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' сағ' + (m % 60 ? ' ' + (m % 60) + ' м' : '');
  const d = Math.floor(h / 24);
  return d + ' к' + (h % 24 ? ' ' + (h % 24) + ' сағ' : '');
}

// Тар жерге арналған қысқа түрі: "3сағ38м"
function durTiny(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.floor(sec);
  if (s < 60) return s + 'с';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'м';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'сағ' + (m % 60 ? (m % 60) + 'м' : '');
  const d = Math.floor(h / 24);
  return d + 'к' + (h % 24 ? (h % 24) + 'сағ' : '');
}

function countdown(untilMs) {
  if (!untilMs || !Number.isFinite(untilMs)) return null;
  const left = Math.floor((untilMs - Date.now()) / 1000);
  return left <= 0 ? null : left;
}

function clock(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ─────────────────── Мәртебе деңгейі мен түстер ─────────────────── */
// 50%-ға дейін жасыл · 50–80% сары · 80%-дан жоғары қызыл
// Пайыз экранда дөңгелектеліп көрсетілетіндіктен, түс те дәл сол дөңгелектелген
// саннан есептеледі — әйтпесе «50%» жазылып тұрып жолақ жасыл болып қалады.
function level(pct) {
  if (pct == null || !Number.isFinite(pct)) return 'ok';
  const p = Math.round(pct);
  if (p > 80) return 'bad';
  if (p >= 50) return 'warn';
  return 'ok';
}

const MODEL_COLORS = [
  ['opus',   '#8B5CF6'],
  ['fable',  '#E879F9'],
  ['mythos', '#F472B6'],
  ['sonnet', '#38BDF8'],
  ['haiku',  '#2DD4BF'],
];
const SPARE_COLORS = ['#A78BFA', '#60A5FA', '#34D399', '#FBBF24', '#FB7185'];

function modelColor(id, index) {
  const low = String(id || '').toLowerCase();
  for (const [key, col] of MODEL_COLORS) if (low.includes(key)) return col;
  return SPARE_COLORS[index % SPARE_COLORS.length];
}

/* ───────────────────────── DOM көмекшілері ───────────────────────── */
const $ = (id) => document.getElementById(id);
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

// Сан өзгергенде 200 мс жұмсақ ауысу (тек opacity + transform)
function setNum(node, text) {
  if (!node) return;
  const s = text == null ? '—' : String(text);
  if (node.textContent === s) return;
  node.textContent = s;
  if (REDUCE || !node.animate) return;
  try {
    node.animate(
      [{ opacity: 0.35, transform: 'translateY(-2px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 200, easing: 'cubic-bezier(0.22,0.61,0.36,1)' }
    );
  } catch { /* анимация қолжетімсіз — маңызды емес */ }
}

function setText(node, text) {
  const s = text == null ? '—' : String(text);
  if (node && node.textContent !== s) node.textContent = s;
}

// Прогресс жолағы: transform: scaleX() — layout қозғалмайды
function setTrack(track, pct, opts) {
  if (!track) return;
  const inner = track.firstElementChild;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  if (inner) inner.style.transform = 'scaleX(' + (p / 100) + ')';

  const lv = (opts && opts.level) || level(p);
  track.classList.toggle('lv-warn', lv === 'warn');
  track.classList.toggle('lv-bad', lv === 'bad');
  track.classList.toggle('is-hot', !!(opts && opts.hot) && p > 80);
}

const RING_C = 2 * Math.PI * 23;   // r=23 → шеңбер ұзындығы

function setRing(root, pctUsed, remainText, resetText) {
  if (!root) return;
  const arc = root.querySelector('.ring-arc');
  const p = Math.max(0, Math.min(100, Number(pctUsed) || 0));
  if (arc) {
    arc.style.strokeDasharray = RING_C;
    arc.style.strokeDashoffset = RING_C * (1 - p / 100);
    const lv = level(p);
    arc.classList.toggle('lv-warn', lv === 'warn');
    arc.classList.toggle('lv-bad', lv === 'bad');
  }
  setNum(root.querySelector('.ring-pct'), remainText);
  setText(root.querySelector('.ring-reset'), resetText);
}

/* ───────── Кілттелген тізім (жаңасы ғана fade-in болады) ───────── */
function renderKeyed(container, items, build, update) {
  const existing = new Map();
  for (const node of Array.from(container.children)) {
    if (node.dataset && node.dataset.key) existing.set(node.dataset.key, node);
    else node.remove();     // кілтсіз қалдық («Жүктелуде…», бос күй) — тазалаймыз
  }

  const seen = new Set();
  let prev = null;

  for (const item of items) {
    seen.add(item.key);
    let node = existing.get(item.key);
    if (node) {
      update(node, item);
    } else {
      node = build(item);
      node.dataset.key = item.key;
      if (!REDUCE) node.classList.add('is-new');
    }
    // Ретке келтіру
    const after = prev ? prev.nextSibling : container.firstChild;
    if (node !== after) container.insertBefore(node, after);
    prev = node;
  }

  for (const [key, node] of existing) {
    if (!seen.has(key)) node.remove();
  }
}

/* ─────────────────────────── Sparkline ─────────────────────────── */
const HIST_LEN = 30;          // 30 өлшем × 2 с = 60 секунд
const history = { cpu: [], gpu: [], ram: [], disk: [], net: [] };

function pushHist(key, value) {
  const arr = history[key];
  if (!arr) return;
  arr.push(Number.isFinite(value) ? value : null);
  while (arr.length > HIST_LEN) arr.shift();
}

// Мәндер массивінен SVG нүктелерін құру (viewBox 0 0 100 24)
function sparkPoints(values, maxOverride) {
  const pts = [];
  if (!values || !values.length) return { line: '', area: '' };

  let max = maxOverride;
  if (max == null) {
    max = 0;
    for (const v of values) if (Number.isFinite(v) && v > max) max = v;
  }
  if (!Number.isFinite(max) || max <= 0) max = 1;

  const n = Math.max(values.length, 2);
  const step = 100 / (n - 1);
  const offset = 100 - step * (values.length - 1);   // оң жақ шетке теңестіру

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const x = offset + i * step;
    const y = v == null ? 24 : 23 - (Math.max(0, Math.min(1, v / max)) * 21);
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }

  const first = pts[0].split(',')[0];
  const last = pts[pts.length - 1].split(',')[0];
  return {
    line: pts.join(' '),
    area: first + ',24 ' + pts.join(' ') + ' ' + last + ',24',
  };
}

function buildSpark(color) {
  const box = el('div', 'spark-box');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 100 24');
  svg.setAttribute('preserveAspectRatio', 'none');

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('class', 'spark-fill');
  area.setAttribute('fill', color);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('class', 'spark-line');
  line.setAttribute('stroke', color);

  svg.appendChild(area);
  svg.appendChild(line);
  box.appendChild(svg);
  return box;
}

function updateSpark(box, values, color, maxOverride) {
  if (!box) return;
  const { line, area } = sparkPoints(values, maxOverride);
  const pl = box.querySelector('.spark-line');
  const pg = box.querySelector('.spark-fill');
  if (pl) { pl.setAttribute('points', line); pl.setAttribute('stroke', color); }
  if (pg) { pg.setAttribute('points', area); pg.setAttribute('fill', color); }
}

/* ─────────────────────────── Жалпы күй ─────────────────────────── */
const ui = {
  win: 'last5h',
  data: { usage: null, agents: null, limits: null, system: null, history: null },
  flags: { demo: false, demoEmpty: false, parserWarning: null },
  pinned: true,
  openProject: null,          // ашық тұрған жоба бөлшегі (projectDir)
  openProjectName: null,
  openProjectPaintedAt: 0,    // жиі қайта салмау үшін
};

const LV_COLOR = { ok: '#22C55E', warn: '#EAB308', bad: '#EF4444' };

/* ═══════════════════════════ 1. ЛИМИТТЕР ═══════════════════════════ */

function pickLimit(limits, kinds) {
  if (!limits) return null;
  for (const k of kinds) {
    const f = limits.find((x) => x.kind === k);
    if (f) return f;
  }
  return null;
}

function renderLimits(d) {
  const body = $('limits-body');
  const note = $('limits-note');
  if (!body) return;

  if (!d || !d.ok) {
    clear(body);
    const b = el('div', 'blank');
    b.appendChild(icon('moon'));
    b.appendChild(el('span', null, (d && d.error) || 'Лимит дерегі уақытша жоқ'));
    body.appendChild(b);
    if (note) { note.textContent = ''; note.classList.remove('is-warn'); }
    return;
  }

  if (note) {
    if (d.warning) { note.textContent = d.warning; note.classList.add('is-warn'); }
    else { note.textContent = clock(d.fetchedAt); note.classList.remove('is-warn'); }
  }

  const items = d.limits.map((l) => ({ key: l.id, l }));

  renderKeyed(body, items,
    (item) => {
      const row = el('div', 'lim');
      const top = el('div', 'lim-top');
      top.appendChild(el('span', 'lim-name'));
      top.appendChild(el('span', 'lim-pct num'));
      row.appendChild(top);

      const track = el('div', 'track track--lg');
      track.appendChild(document.createElement('i'));
      row.appendChild(track);

      row.appendChild(el('div', 'lim-foot'));
      updateLimit(row, item);
      return row;
    },
    updateLimit
  );
}

function updateLimit(row, item) {
  const l = item.l;
  const lv = level(l.percent);

  setText(row.querySelector('.lim-name'), l.label);

  const pct = row.querySelector('.lim-pct');
  pct.classList.remove('lv-ok', 'lv-warn', 'lv-bad');
  pct.classList.add('lv-' + lv);
  setNum(pct, Math.round(l.percent) + '%');

  setTrack(row.querySelector('.track'), l.percent, { level: lv, hot: true });

  const foot = row.querySelector('.lim-foot');
  foot.dataset.reset = l.resetsAt || '';
  paintLimitFoot(foot);
}

// Секунд сайын жаңаратын бөлік
// Пайыз ӘРҚАШАН «қанша ЖҰМСАЛДЫ» дегенді білдіреді — қалғанын емес.
// Сондықтан жолақ та, сан да, түс те бір бағытта өседі.
function paintLimitFoot(foot) {
  const reset = Number(foot.dataset.reset);
  clear(foot);
  foot.appendChild(document.createTextNode('жұмсалды'));
  const left = countdown(reset);
  if (left != null) {
    foot.appendChild(el('span', 'dot', '·'));
    foot.appendChild(document.createTextNode(dur(left) + ' кейін жаңарады'));
  }
}

/* ═══════════════ Ескерту жолақтары (демо / parser) ═══════════════ */

function renderBanners() {
  const box = $('banners');
  if (!box) return;
  const f = ui.flags || {};
  const items = [];

  if (f.demo) {
    items.push({
      key: 'demo',
      cls: 'banner banner--demo',
      ic: 'flask',
      text: 'ДЕМО — нақты дерек емес' + (f.demoEmpty ? ' · бос күй' : ''),
    });
  }
  if (f.parserWarning) {
    items.push({ key: 'parser', cls: 'banner', ic: 'alert', text: f.parserWarning });
  }
  // Не Claude Code, не Codex табылмаса — виджет бос тұрады, себебін айтамыз
  if (f.noSource) {
    items.push({ key: 'nosource', cls: 'banner', ic: 'alert', text: f.noSource });
  }

  renderKeyed(box, items,
    (item) => {
      const b = el('div', item.cls);
      b.appendChild(icon(item.ic));
      b.appendChild(el('span', 'banner-txt', item.text));
      return b;
    },
    (node, item) => {
      node.className = item.cls;
      setText(node.querySelector('.banner-txt'), item.text);
    }
  );
}

/* ═══════════════════════════ 2. ТОКЕНДЕР ═══════════════════════════ */

// Ағымдағы таб үшін көрсетілетін терезе.
// «30 күн» — тарих файлынан, қалғаны — тікелей оқылған дерек.
function currentWindow(d) {
  if (ui.win === 'days30') {
    const h = ui.data.history;
    return (h && h.ok && h.window30) ? h.window30 : null;
  }
  return d.windows[ui.win];
}

function renderUsage(d) {
  if (!d) return;

  const w = currentWindow(d);
  const pending = $('u-pending');
  const content = $('u-content');

  // Тарих әлі жиналмаса — сан емес, түсіндірме көрсетеміз
  if (ui.win === 'days30' && !w) {
    if (content) content.hidden = true;
    if (pending) pending.hidden = false;
    setText($('usage-note'), '');
    renderProjects(d);
    return;
  }
  if (content) content.hidden = false;
  if (pending) pending.hidden = true;
  if (!w) return;

  setNum($('u-total'), compact(w.total));
  setNum($('u-cost'), money(w.cost));

  if (ui.win === 'days30') {
    const h = ui.data.history;
    setText($('usage-note'), h && h.days ? h.days + ' күн жиналды' : '');
  } else {
    setText($('usage-note'), d.ready ? '' : 'оқылуда…');
  }

  // ── Модель бойынша жиналған жолақ
  const bar = $('u-stack');
  const models = w.models || [];
  const total = w.total || 1;

  const segs = new Map();
  for (const node of Array.from(bar.children)) segs.set(node.dataset.m, node);

  let offset = 0;
  const seen = new Set();
  models.forEach((m, i) => {
    seen.add(m.id);
    let s = segs.get(m.id);
    if (!s) {
      s = document.createElement('i');
      s.dataset.m = m.id;
      bar.appendChild(s);
    }
    const frac = Math.max(0, m.total / total);
    s.style.background = modelColor(m.id, i);
    s.style.transform = 'translateX(' + (offset * 100).toFixed(3) + '%) scaleX(' + frac.toFixed(4) + ')';
    offset += frac;
  });
  for (const [id, node] of segs) if (!seen.has(id)) node.remove();

  // ── Аңыз (legend)
  const legend = $('u-legend');
  clear(legend);
  if (!models.length) {
    legend.appendChild(el('span', 'leg-val', 'Бұл кезеңде дерек жоқ'));
  } else {
    models.slice(0, 5).forEach((m, i) => {
      const g = el('span', 'leg');
      const dot = el('span', 'leg-dot');
      dot.style.background = modelColor(m.id, i);
      g.appendChild(dot);
      g.appendChild(el('span', 'leg-name', m.label));
      g.appendChild(el('span', 'leg-val', compact(m.total) + ' · ' + money(m.cost)));
      legend.appendChild(g);
    });
  }

  // ── Бөліністер
  const chips = $('u-breakdown');
  clear(chips);
  const parts = [
    ['Кіріс', w.in], ['Шығыс', w.out],
    ['Кэш жазу', w.cw5 + w.cw1h], ['Кэш оқу', w.cr],
  ];
  for (const [k, v] of parts) {
    const c = el('span', 'chip');
    c.appendChild(el('span', null, k));
    c.appendChild(el('span', 'chip-v', compact(v)));
    chips.appendChild(c);
  }

  renderProjects(d);
}

/* ═══════════════════════════ 4. ЖОБАЛАР ═══════════════════════════ */

function renderProjects(d) {
  const body = $('p-body');
  const note = $('p-note');
  if (!body) return;

  const list = (d.projects.list || []).slice(0, 5);
  if (note) {
    clear(note);
    note.appendChild(el('b', null, String(d.projects.activeToday)));
    note.appendChild(document.createTextNode(' белсенді / '));
    note.appendChild(el('b', null, String(d.projects.total)));
  }

  if (!list.length) {
    clear(body);
    body.appendChild(el('div', 'blank', 'Бүгін белсенді жоба жоқ'));
    return;
  }

  const max = list[0].tokens || 1;
  const items = list.map((p, i) => ({ key: p.dir, p, i, max }));

  renderKeyed(body, items,
    (item) => {
      const wrap = el('div', 'proj-wrap');

      const row = el('div', 'proj');
      row.appendChild(el('span', 'proj-rank'));
      const b = el('div', 'proj-body');
      const top = el('div', 'proj-top');
      top.appendChild(el('span', 'proj-name'));
      const val = el('span', 'proj-val num');
      val.appendChild(el('span', 'proj-val-t'));
      val.appendChild(el('span', 'proj-cost'));
      top.appendChild(val);
      b.appendChild(top);
      const track = el('div', 'track');
      track.appendChild(document.createElement('i'));
      b.appendChild(track);
      row.appendChild(b);
      row.appendChild(icon('chevron'));

      // Басқанда бөлшегі ашылады / жабылады
      row.addEventListener('click', () => toggleProject(wrap, item.p));

      wrap.appendChild(row);
      wrap.appendChild(el('div', 'proj-detail', ''));
      wrap.querySelector('.proj-detail').hidden = true;

      updateProject(wrap, item);
      return wrap;
    },
    updateProject
  );

  // Ашық тұрған панельді жаңа дерекпен жаңартамыз
  if (ui.openProject) refreshOpenProject();
}

/* ═════════════════ Жоба бөлшегі (жолды басқанда ашылады) ═════════════════ */

async function toggleProject(wrap, p) {
  const panel = wrap.querySelector('.proj-detail');
  const isOpen = !panel.hidden && ui.openProject === p.dir;

  // Басқа ашық панельдерді жабамыз — бір мезгілде біреуі ғана ашық тұрсын
  for (const other of document.querySelectorAll('.proj-detail')) {
    if (other !== panel) { other.hidden = true; clear(other); }
  }
  for (const r of document.querySelectorAll('.proj')) r.classList.remove('is-open');

  if (isOpen) {
    panel.hidden = true;
    clear(panel);
    ui.openProject = null;
    return;
  }

  ui.openProject = p.dir;
  ui.openProjectName = p.name;
  wrap.querySelector('.proj').classList.add('is-open');
  panel.hidden = false;
  clear(panel);
  panel.appendChild(el('div', 'proj-loading', 'Оқылуда…'));

  try {
    const d = await window.hud.projectDetail(p.dir, p.name);
    if (ui.openProject !== p.dir) return;      // бұл арада басқасы ашылды
    paintProjectDetail(panel, d);
  } catch {
    clear(panel);
    panel.appendChild(el('div', 'proj-loading', 'Бөлшегі оқылмады'));
  }
}

async function refreshOpenProject() {
  const dir = ui.openProject;
  if (!dir) return;
  const wrap = Array.from(document.querySelectorAll('.proj-wrap'))
    .find((w) => w.dataset.key === dir);
  if (!wrap) { ui.openProject = null; return; }
  const panel = wrap.querySelector('.proj-detail');
  if (!panel || panel.hidden) return;
  wrap.querySelector('.proj').classList.add('is-open');

  // Панельді 4 секунд сайын қайта салмаймыз — жыпылықтап тұрар еді
  if (Date.now() - ui.openProjectPaintedAt < 6000) return;

  try {
    const d = await window.hud.projectDetail(dir, ui.openProjectName || '');
    if (ui.openProject === dir) paintProjectDetail(panel, d);
  } catch { /* келесі айналымда қайталанады */ }
}

function paintProjectDetail(panel, d) {
  ui.openProjectPaintedAt = Date.now();
  clear(panel);
  if (!d) { panel.appendChild(el('div', 'proj-loading', 'Дерек жоқ')); return; }

  // ── Жинақ жол: бүгінгі саны, сессия саны, соңғы әрекет
  const head = el('div', 'pd-head');
  head.appendChild(el('span', 'pd-sum', compact(d.total) + ' · ' + money(d.cost)));
  const meta = [];
  if (d.sessionCount) meta.push(d.sessionCount + ' сессия');
  if (d.lastActive) meta.push('соңғы ' + clock(d.lastActive));
  head.appendChild(el('span', 'pd-meta', meta.join(' · ')));
  panel.appendChild(head);

  // ── Осы жобада жүрген сессиялардың күйі
  if (d.sessions && d.sessions.length) {
    const row = el('div', 'pd-states');
    for (const s of d.sessions) {
      const ui2 = STATE_UI[s.state] || STATE_UI.working;
      const pill = el('span', 'pd-state' + (s.needsYou ? ' is-needs' : ''));
      const dot = el('span', 'beacon' + (ui2.beacon ? ' ' + ui2.beacon : ''));
      pill.appendChild(dot);
      pill.appendChild(el('span', null, ui2.label));
      row.appendChild(pill);
    }
    panel.appendChild(row);
  }

  // ── Модель бойынша бөлініс (бүгін)
  if (d.models && d.models.length) {
    const box = el('div', 'pd-models');
    const max = d.models[0].total || 1;
    d.models.forEach((m, i) => {
      const r = el('div', 'pd-model');
      const dot = el('span', 'leg-dot');
      dot.style.background = modelColor(m.id, i);
      r.appendChild(dot);
      r.appendChild(el('span', 'pd-model-name', m.label));
      const bar = el('div', 'pd-model-bar');
      const inner = el('i');
      inner.style.width = ((m.total / max) * 100) + '%';
      inner.style.background = modelColor(m.id, i);
      bar.appendChild(inner);
      r.appendChild(bar);
      r.appendChild(el('span', 'pd-model-val', compact(m.total)));
      r.appendChild(el('span', 'pd-model-cost', money(m.cost)));
      box.appendChild(r);
    });
    panel.appendChild(box);
  } else {
    panel.appendChild(el('div', 'proj-loading', 'Бүгін дерек жоқ'));
  }

  // ── Соңғы 30 күн — баған-график
  if (d.days && d.days.length) {
    panel.appendChild(el('div', 'pd-cap', 'Соңғы 30 күн'));
    panel.appendChild(buildDayBars(d.days));
  }
}

// 30 күндік баған-график (SVG). Дерегі жоқ күндер — бос орын.
function buildDayBars(days) {
  const box = el('div', 'pd-bars');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 26');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'pd-bars-svg');

  let max = 0;
  for (const d of days) if (d.total > max) max = d.total;
  if (max <= 0) max = 1;

  const n = days.length;
  const gap = 0.6;
  const w = (100 - gap * (n - 1)) / n;

  days.forEach((d, i) => {
    const h = Math.max(d.total > 0 ? 1.2 : 0, (d.total / max) * 24);
    if (h <= 0) return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (i * (w + gap)).toFixed(2));
    rect.setAttribute('y', (25 - h).toFixed(2));
    rect.setAttribute('width', w.toFixed(2));
    rect.setAttribute('height', h.toFixed(2));
    rect.setAttribute('rx', '0.4');
    // Соңғы күн — акцент түсі, қалғаны күңгірт
    rect.setAttribute('fill', i === n - 1 ? '#8B5CF6' : 'rgba(139,92,246,0.42)');
    svg.appendChild(rect);
  });

  box.appendChild(svg);
  const peak = days.reduce((a, b) => (b.total > a.total ? b : a), days[0]);
  box.appendChild(el('div', 'pd-bars-cap',
    'ең көп: ' + compact(peak.total) + ' (' + peak.day.slice(5) + ')'));
  return box;
}

function updateProject(row, item) {
  const p = item.p;
  setText(row.querySelector('.proj-rank'), String(item.i + 1));
  setText(row.querySelector('.proj-name'), p.name);
  setNum(row.querySelector('.proj-val-t'), compact(p.tokens));
  setText(row.querySelector('.proj-cost'), money(p.cost));
  setTrack(row.querySelector('.track'), (p.tokens / item.max) * 100, { level: 'accent' });
}

/* ══════════════════════ 3. БЕЛСЕНДІ АГЕНТТЕР ══════════════════════ */

function renderAgents(d) {
  const body = $('a-body');
  const note = $('a-note');
  if (!body) return;

  if (!d) return;

  if (note) {
    clear(note);
    const wait = d.counts.waitingSessions || 0;
    if (wait > 0) {
      const w = el('b', 'needs-pill', '▲ ' + wait + ' күтуде');
      note.appendChild(w);
      note.appendChild(document.createTextNode(' · '));
    }
    note.appendChild(el('b', null, String(d.counts.activeSessions || 0)));
    note.appendChild(document.createTextNode(' жұмыста · '));
    note.appendChild(el('b', null, d.counts.claudeProcesses == null ? '—' : String(d.counts.claudeProcesses)));
    note.appendChild(document.createTextNode(' процесс'));
  }

  const sessions = d.sessions || [];
  const subs = d.subagents || [];

  // Subagent-терді жоба бойынша сессияға байлаймыз (дерек логикасы өзгермейді)
  const byProject = new Map();
  for (const s of subs) {
    const k = s.project || '—';
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k).push(s);
  }

  const items = [];
  const used = new Set();

  for (const s of sessions) {
    const kids = byProject.get(s.project) || [];
    if (kids.length) used.add(s.project);
    items.push({ key: 'S:' + s.sessionId, kind: 'session', s, kids });
  }
  // Сессиясы табылмаған subagent-тер — жеке карточка
  for (const [proj, kids] of byProject) {
    if (used.has(proj)) continue;
    items.push({ key: 'O:' + proj, kind: 'orphan', s: null, project: proj, kids });
  }

  if (!items.length) {
    clear(body);
    const b = el('div', 'blank');
    b.appendChild(icon('moon'));
    b.appendChild(el('span', null, 'Қазір белсенді агент жоқ'));
    body.appendChild(b);
    return;
  }

  renderKeyed(body, items, buildSession, updateSession);
}

function buildSession(item) {
  const card = el('div', 'sess');

  const main = el('div', 'sess-main');
  main.appendChild(el('span', 'beacon'));

  const b = el('div', 'sess-body');
  const head = el('div', 'sess-head');
  head.appendChild(el('span', 'sess-name'));
  head.appendChild(el('span', 'badge'));
  b.appendChild(head);

  const act = el('div', 'sess-act');
  act.appendChild(el('span', 'sess-act-ic'));
  act.appendChild(el('span', 'sess-act-tool'));
  act.appendChild(el('span', 'sess-act-txt'));
  b.appendChild(act);
  main.appendChild(b);

  const timer = el('div', 'sess-timer');
  timer.appendChild(el('span', 'sess-time num'));
  timer.appendChild(el('span', 'sess-since', 'жұмыста'));
  main.appendChild(timer);

  card.appendChild(main);
  card.appendChild(el('div', 'subs'));

  updateSession(card, item);
  return card;
}

/* Сессия күйінің көрінісі.
   Мақсаты: ондаған сессияның ҚАЙСЫСЫ сізді күтіп тұрғанын бірден көру. */
const STATE_UI = {
  working: { label: 'жұмыста',       beacon: '',               tone: '' },
  agent:   { label: 'агент жүруде',  beacon: 'beacon--agent',  tone: 'st-agent' },
  waiting: { label: 'сізді күтуде',  beacon: 'beacon--wait',   tone: 'st-wait' },
  asking:  { label: 'жауап күтуде',  beacon: 'beacon--wait',   tone: 'st-wait' },
  stalled: { label: 'рұқсат күтуде', beacon: 'beacon--stall',  tone: 'st-stall' },
};

function updateSession(card, item) {
  const s = item.s;

  // ── Күй: жиек, нүкте түсі, мәтін
  const st = (s && s.state) || 'working';
  const ui2 = STATE_UI[st] || STATE_UI.working;
  card.classList.toggle('is-needs', !!(s && s.needsYou) && st !== 'stalled');
  card.classList.toggle('is-stall', st === 'stalled');

  const beacon = card.querySelector('.beacon');
  if (beacon) {
    beacon.className = 'beacon' + (ui2.beacon ? ' ' + ui2.beacon : '');
  }

  setText(card.querySelector('.sess-name'), s ? s.project : item.project);

  const badge = card.querySelector('.badge');
  if (s && s.modelLabel) {
    badge.hidden = false;
    setText(badge, s.modelLabel);
    badge.style.color = modelColor(s.model || s.modelLabel, 0);
  } else {
    badge.hidden = true;
  }

  // Соңғы әрекет: иконка + құрал аты + қысқа сипаттама
  const icBox = card.querySelector('.sess-act-ic');
  const tool = s && s.lastTool ? s.lastTool.tool : null;
  const wantIc = toolIcon(tool);
  if (icBox.dataset.ic !== wantIc) {
    icBox.dataset.ic = wantIc;
    clear(icBox);
    icBox.appendChild(icon(wantIc));
  }
  setText(card.querySelector('.sess-act-tool'), tool || 'күтуде');
  setText(card.querySelector('.sess-act-txt'), s && s.lastTool && s.lastTool.detail ? '· ' + s.lastTool.detail : '');

  const time = card.querySelector('.sess-time');
  const since = card.querySelector('.sess-since');
  if (s) {
    // Таймер күйдің басталған сәтінен саналады: «сізді 12 минуттан бері күтуде»
    time.dataset.since = String(s.stateSinceTs || s.runningSinceTs);
    time.hidden = false;
    since.hidden = false;
    setText(since, ui2.label);
    time.className = 'sess-time num' + (ui2.tone ? ' ' + ui2.tone : '');
    since.className = 'sess-since' + (ui2.tone ? ' ' + ui2.tone : '');
  } else {
    delete time.dataset.since;          // жасырын өрісті бос санамаймыз
    time.hidden = true;
    since.hidden = true;
  }

  // ── Subagent-тер
  const box = card.querySelector('.subs');
  const kids = item.kids || [];
  box.hidden = !kids.length;

  const kidItems = kids.map((k) => ({
    key: k.agentType + '|' + k.startedTs + '|' + (k.description || ''),
    k,
  }));
  renderKeyed(box, kidItems, buildSub, updateSub);
}

function buildSub(item) {
  const row = el('div', 'sub');
  const b = el('div', 'sub-body');
  const head = el('div', 'sub-head');
  head.appendChild(el('span', 'sub-type'));
  head.appendChild(el('span', 'sub-desc'));
  b.appendChild(head);
  b.appendChild(el('div', 'sub-meta'));
  row.appendChild(b);

  const side = el('div', 'sub-side');
  side.appendChild(el('span', 'sub-tok num'));
  side.appendChild(el('span', 'sub-time num'));
  row.appendChild(side);

  updateSub(row, item);
  return row;
}

function updateSub(row, item) {
  const k = item.k;
  setText(row.querySelector('.sub-type'), k.agentType || 'agent');
  setText(row.querySelector('.sub-desc'), k.description || 'Агент');
  setText(row.querySelector('.sub-meta'),
    k.lastTool ? k.lastTool.tool + (k.lastTool.detail ? ' · ' + k.lastTool.detail : '') : '');
  setNum(row.querySelector('.sub-tok'), k.tokens != null ? compact(k.tokens) : '—');
  const t = row.querySelector('.sub-time');
  t.dataset.since = String(k.startedTs);
}

/* ══════════════════════════ 5. КОМПЬЮТЕР ══════════════════════════ */

const METRICS = [
  { id: 'cpu',  ic: 'cpu',      name: 'CPU' },
  { id: 'gpu',  ic: 'monitor',  name: 'GPU' },
  { id: 'ram',  ic: 'memory',   name: 'RAM' },
  { id: 'disk', ic: 'drive',    name: 'Диск' },
  { id: 'net',  ic: 'activity', name: 'Желі' },
];

let metricsBuilt = false;

function buildMetrics() {
  const body = $('sys-body');
  clear(body);
  for (const m of METRICS) {
    const row = el('div', 'met');
    row.dataset.m = m.id;

    const ib = el('div', 'met-ic');
    ib.appendChild(icon(m.ic));
    row.appendChild(ib);

    const b = el('div', 'met-body');
    const top = el('div', 'met-top');
    top.appendChild(el('span', 'met-name', m.name));
    top.appendChild(el('span', 'met-val num', '—'));
    b.appendChild(top);
    const track = el('div', 'track');
    track.appendChild(document.createElement('i'));
    b.appendChild(track);
    b.appendChild(el('div', 'met-sub', '—'));
    row.appendChild(b);

    row.appendChild(buildSpark(LV_COLOR.ok));
    body.appendChild(row);
  }
  metricsBuilt = true;
}

function metricRow(id) { return document.querySelector('.met[data-m="' + id + '"]'); }

function paintMetric(id, opts) {
  const row = metricRow(id);
  if (!row) return;
  const lv = opts.level || level(opts.pct);
  const color = opts.color || LV_COLOR[lv];

  if (opts.name) setText(row.querySelector('.met-name'), opts.name);

  const val = row.querySelector('.met-val');
  val.classList.remove('lv-ok', 'lv-warn', 'lv-bad');
  val.classList.add('lv-' + lv);
  setNum(val, opts.value);

  // 80%-дан асса — жолақ ақырын пульсациялайды (тек opacity)
  setTrack(row.querySelector('.track'), opts.pct, { level: lv, hot: true });
  setText(row.querySelector('.met-sub'), opts.sub);
  updateSpark(row.querySelector('.spark-box'), history[id], color, opts.sparkMax);
}

// Жүйелік диск (C: немесе /) — sparkline сол үшін
function primaryDisk(disks) {
  if (!disks || !disks.length) return null;
  const sys = disks.find((d) => /^(c:|\/)/i.test(String(d.mount || '')));
  return sys || disks[0];
}

function renderSystem(d) {
  if (!d) return;
  if (!metricsBuilt) buildMetrics();

  // ── Тарихқа жазу (sparkline үшін)
  const disk = primaryDisk(d.disks);
  const netTotal = d.network ? (d.network.rxBytesPerSec + d.network.txBytesPerSec) : null;
  pushHist('cpu', d.cpu ? d.cpu.load : null);
  pushHist('gpu', d.gpu ? d.gpu.load : null);
  pushHist('ram', d.ram ? d.ram.percent : null);
  pushHist('disk', disk ? disk.percent : null);
  pushHist('net', netTotal);

  // ── CPU
  const cpu = d.cpu || {};
  paintMetric('cpu', {
    name: cpu.brand ? 'CPU · ' + cpu.brand.replace(/\(R\)|\(TM\)|™|®|CPU/gi, '').trim() : 'CPU',
    value: cpu.load != null ? Math.round(cpu.load) + '%' : '—',
    pct: cpu.load,
    sub: (cpu.cores != null ? cpu.cores + ' ядро' : '— ядро') +
         ' · ' + (cpu.temp != null ? Math.round(cpu.temp) + '°C' : 'темп. —'),
    sparkMax: 100,
  });

  // ── GPU
  const gpu = d.gpu;
  paintMetric('gpu', {
    name: gpu && gpu.name ? 'GPU · ' + gpu.name.replace(/NVIDIA |AMD |Intel\(R\) /i, '') : 'GPU',
    value: gpu && gpu.load != null ? Math.round(gpu.load) + '%' : '—',
    pct: gpu ? gpu.load : 0,
    sub: gpu
      ? ((gpu.vramUsedMb != null && gpu.vramTotalMb != null
          ? bytes(gpu.vramUsedMb * 1048576) + ' / ' + bytes(gpu.vramTotalMb * 1048576)
          : 'VRAM —') + ' · ' + (gpu.temp != null ? Math.round(gpu.temp) + '°C' : 'темп. —'))
      : 'дерек жоқ',
    sparkMax: 100,
  });

  // ── RAM
  const ram = d.ram;
  paintMetric('ram', {
    value: ram && ram.percent != null ? Math.round(ram.percent) + '%' : '—',
    pct: ram ? ram.percent : 0,
    sub: ram ? bytes(ram.used) + ' / ' + bytes(ram.total) + ' · бос ' + bytes(ram.free) : '—',
    sparkMax: 100,
  });

  // ── Диск
  paintMetric('disk', {
    name: disk ? 'Диск · ' + String(disk.mount).replace(/\\$/, '') : 'Диск',
    value: disk && disk.percent != null ? Math.round(disk.percent) + '%' : '—',
    pct: disk ? disk.percent : 0,
    sub: disk ? bytes(disk.free) + ' бос / ' + bytes(disk.size) : '—',
    sparkMax: 100,
  });

  // ── Желі (автомасштаб, акцент түсі)
  paintMetric('net', {
    value: d.network ? speed(netTotal) : '—',
    pct: 0,
    level: 'ok',
    color: '#8B5CF6',
    sub: d.network
      ? '↓ ' + speed(d.network.rxBytesPerSec) + '   ↑ ' + speed(d.network.txBytesPerSec)
      : '—',
  });
  // Желі жолағын жасырамыз — оның орнына sparkline мәнді
  const netRow = metricRow('net');
  if (netRow) netRow.querySelector('.track').hidden = true;

  // ── Қосымша: басқа дискілер, uptime, батарея
  const extra = $('sys-extra');
  clear(extra);
  const add = (k, v) => {
    const c = el('span', 'chip');
    c.appendChild(el('span', null, k));
    c.appendChild(el('span', 'chip-v', v));
    extra.appendChild(c);
  };
  for (const dk of (d.disks || [])) {
    if (disk && dk.mount === disk.mount) continue;
    add(String(dk.mount).replace(/\\$/, ''), bytes(dk.free) + ' бос');
  }
  add('Жұмыс уақыты', d.uptimeSec != null ? dur(d.uptimeSec) : '—');
  if (d.battery) add('Батарея', d.battery.percent + '%' + (d.battery.isCharging ? ' ⚡' : ''));

  setText($('sys-note'), clock(d.updatedAt));
}

/* ═════════════════════════ ШАҒЫН РЕЖИМ ═════════════════════════ */

function renderMini() {
  const L = ui.data.limits;
  const A = ui.data.agents;
  const S = ui.data.system;

  const l5 = L && L.ok ? pickLimit(L.limits, ['session', 'five_hour']) : null;
  const lw = L && L.ok ? pickLimit(L.limits, ['weekly_all', 'seven_day']) : null;

  // Сақинаның ортасында да ЖҰМСАЛҒАН пайыз тұрады — доғамен бірдей бағытта.
  const ring = (root, lim) => {
    if (!lim) { setRing(root, 0, '—', '—'); return; }
    const left = countdown(lim.resetsAt);
    setRing(root, lim.percent, Math.round(lim.percent) + '%', left != null ? durTiny(left) : '—');
  };
  ring($('ring-5h'), l5);
  ring($('ring-week'), lw);

  // Сол жақта — жұмыс істеп жатқандар, оң жағында — сізді күтіп тұрғандар
  const working = A ? (A.counts.activeSessions + A.counts.runningSubagents) : null;
  const waiting = A ? (A.counts.waitingSessions || 0) : 0;

  setNum($('mini-agents'), working == null ? '—' : String(working));
  const beacon = $('mini-beacon');
  if (beacon) beacon.classList.toggle('is-idle', !working);

  const needs = $('mini-needs');
  if (needs) {
    needs.hidden = !waiting;
    if (waiting) setNum(needs, '▲ ' + waiting + ' күтуде');
  }

  const cpuPct = S && S.cpu ? S.cpu.load : null;
  const ramPct = S && S.ram ? S.ram.percent : null;

  setNum($('mini-cpu').querySelector('.mini-meter-val'), cpuPct != null ? Math.round(cpuPct) + '%' : '—');
  setTrack($('mini-cpu').querySelector('.track'), cpuPct);

  setNum($('mini-ram').querySelector('.mini-meter-val'), ramPct != null ? Math.round(ramPct) + '%' : '—');
  setTrack($('mini-ram').querySelector('.track'), ramPct);
}

/* ══════════════════ Секунд сайынғы уақыт өрістері ══════════════════ */

function tickTimes() {
  if (document.body.dataset.mode === 'compact') {
    // Сақина астындағы reset уақыты
    const L = ui.data.limits;
    if (L && L.ok) {
      const l5 = pickLimit(L.limits, ['session', 'five_hour']);
      const lw = pickLimit(L.limits, ['weekly_all', 'seven_day']);
      const put = (root, lim) => {
        if (!root || !lim) return;
        const left = countdown(lim.resetsAt);
        setText(root.querySelector('.ring-reset'), left != null ? durTiny(left) : '—');
      };
      put($('ring-5h'), l5);
      put($('ring-week'), lw);
    }
    return;
  }

  for (const foot of document.querySelectorAll('.lim-foot')) paintLimitFoot(foot);

  for (const node of document.querySelectorAll('[data-since]')) {
    const since = Number(node.dataset.since);
    if (!since) continue;
    setText(node, dur((Date.now() - since) / 1000));
  }
}

/* ═══════════════════════════ Жалпы салу ═══════════════════════════ */

function renderAll() {
  renderBanners();
  if (document.body.dataset.mode === 'compact') {
    renderMini();
  } else {
    renderLimits(ui.data.limits);
    renderUsage(ui.data.usage);
    renderAgents(ui.data.agents);
    renderSystem(ui.data.system);
  }
}

function applyMode(mode) {
  if (mode !== 'compact' && mode !== 'full') return;
  document.body.dataset.mode = mode;
  const btn = $('btn-mode');
  clear(btn);
  btn.appendChild(icon(mode === 'full' ? 'minimize' : 'maximize'));
  renderAll();
}

/* ═══════════════════════════ Оқиғалар ═══════════════════════════ */

/* ─────────────── Екі рет басуды тану (сүйреуден ажырату) ───────────────
   Мәселе: терезені сүйрегенде браузер оны кездейсоқ «екі рет басу» деп танып,
   режим өздігінен ауысып кететін. Сондықтан браузердің өз dblclick оқиғасын
   қолданбаймыз — басу мен жіберудің АРАҚАШЫҚТЫҒЫН өзіміз өлшейміз.

   Ережелер:
     • Басылған нүкте мен жіберілген нүктенің арасы 5 пикселден артық болса —
       бұл сүйреу, режим ауыспайды.
     • Екі басудың арасы 400 мс-тан асса — бөлек екі басу деп саналады.
     • Екі басу бір-бірінен 5 пикселден алыс болса да — бөлек басу.

   МАҢЫЗДЫ: экран координаттары (screenX/screenY) қолданылады. Терезені сүйрегенде
   курсор терезенің ІШІНДЕ орнында тұрады, сондықтан clientX/clientY өзгермейді —
   олармен сүйреуді танып болмайды. */

const TAP_MAX_MOVE = 5;      // пиксель — осыдан артық жылжыса, сүйреу деп саналады
const TAP_MAX_GAP = 400;     // мс — екі басудың ең үлкен аралығы

let tapDown = null;          // ағымдағы басудың бастапқы нүктесі
let lastTap = null;          // { t, x, y } — алдыңғы «таза» басу

function dist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

function bindDoubleTap() {
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) { tapDown = null; return; }
    tapDown = { x: e.screenX, y: e.screenY };
  });

  document.addEventListener('mouseup', async (e) => {
    if (e.button !== 0) return;
    const start = tapDown;
    tapDown = null;
    if (!start) return;

    // Түймелердің өз әрекеті бар — оларды санамаймыз
    if (e.target.closest && e.target.closest('button')) { lastTap = null; return; }

    // 1) Сүйреу ме? Басылған және жіберілген нүктені салыстырамыз
    if (dist(start.x, start.y, e.screenX, e.screenY) > TAP_MAX_MOVE) {
      lastTap = null;            // сүйреуден кейін жұп басу басталмайды
      return;
    }

    const now = Date.now();

    // 2) Алдыңғы басумен жұп құрай ма? (уақыт + орын бойынша)
    if (lastTap &&
        (now - lastTap.t) <= TAP_MAX_GAP &&
        dist(lastTap.x, lastTap.y, e.screenX, e.screenY) <= TAP_MAX_MOVE) {
      lastTap = null;
      applyMode(await window.hud.toggleMode());
      return;
    }

    // 3) Бірінші басу — келесісін күтеміз
    lastTap = { t: now, x: e.screenX, y: e.screenY };
  });

  // Браузердің өз dblclick оқиғасы ештеңе істемеуі керек
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

/* ──────── «FalconHUD» жазуы: әрі жаңарту түймесі, әрі сүйреу тұтқасы ────────
   Бұл аймақ -webkit-app-region: no-drag күйінде қалады — әйтпесе тінтуір
   оқиғалары бетке жетпей, жаңарту басылмай қалар еді. Сондықтан сүйреуді
   өзіміз жасаймыз: 5 пикселден артық жылжыса, терезені курсорға ілестіреміз.

     • 5 пикселден АРТЫҚ жылжыса → сүйреу, жаңарту ІСТЕМЕЙДІ
     • 5 пикселден АЗ жылжыса    → жаңартады                                  */

let brandDown = null;        // басылған нүкте (экран координаттары)
let brandDragging = false;   // шегінен асып, сүйреу басталды ма?

function bindBrand() {
  const brand = $('brand');
  const live = $('live');

  brand.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    brandDown = { x: e.screenX, y: e.screenY };
    brandDragging = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (!brandDown || brandDragging) return;
    if (dist(brandDown.x, brandDown.y, e.screenX, e.screenY) > TAP_MAX_MOVE) {
      brandDragging = true;
      window.hud.dragStart();         // енді терезе курсормен бірге жылжиды
    }
  });

  document.addEventListener('mouseup', async (e) => {
    if (e.button !== 0 || !brandDown) return;
    const wasDragging = brandDragging;
    brandDown = null;
    brandDragging = false;

    if (wasDragging) {
      window.hud.dragEnd();           // сүйредік — жаңарту жоқ
      return;
    }

    // Орнында басылды — жаңартамыз
    live.classList.add('is-idle');
    await window.hud.refresh();
    live.classList.remove('is-idle');
  });

  // Терезе фокусын жоғалтса, сүйреу «жабысып» қалмасын
  window.addEventListener('blur', () => {
    if (brandDragging) window.hud.dragEnd();
    brandDown = null;
    brandDragging = false;
  });
}

// HTML-дегі data-ic белгілері бар орындарға иконка салу (бөлім тақырыптары)
function mountStaticIcons() {
  for (const slot of document.querySelectorAll('[data-ic]')) {
    if (slot.firstChild) continue;
    const built = icon(slot.dataset.ic);
    slot.appendChild(built.firstChild);       // тек SVG-ді көшіреміз
  }
}

function bindEvents() {
  mountStaticIcons();

  // Жоғарғы жолақтағы 3 иконка
  clear($('btn-set'));  $('btn-set').appendChild(icon('settings'));
  clear($('btn-pin'));  $('btn-pin').appendChild(icon('pin'));
  clear($('btn-hide')); $('btn-hide').appendChild(icon('x'));

  $('btn-set').addEventListener('click', () => window.hud.openSettings());
  $('btn-hide').addEventListener('click', () => window.hud.hide());

  $('btn-mode').addEventListener('click', async () => {
    applyMode(await window.hud.toggleMode());
  });

  $('btn-pin').addEventListener('click', async () => {
    ui.pinned = await window.hud.setAlwaysOnTop(!ui.pinned);
    $('btn-pin').classList.toggle('is-on', ui.pinned);
  });

  // Логотипті басу — қолмен жаңарту
  bindBrand();

  // Токен кезеңі
  for (const tab of document.querySelectorAll('.seg-btn')) {
    tab.addEventListener('click', () => {
      ui.win = tab.dataset.win;
      for (const t of document.querySelectorAll('.seg-btn')) t.classList.toggle('is-on', t === tab);
      renderUsage(ui.data.usage);
    });
  }

  bindDoubleTap();

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
}

/* ═══════════════════════════ Іске қосу ═══════════════════════════ */

async function init() {
  bindEvents();

  try {
    const snap = await window.hud.snapshot();
    if (snap) {
      ui.data.usage = snap.usage;
      ui.data.agents = snap.agents;
      ui.data.limits = snap.limits;
      ui.data.system = snap.system;
      ui.data.history = snap.history || null;
      if (snap.flags) ui.flags = snap.flags;
      if (snap.window) {
        ui.pinned = !!snap.window.alwaysOnTop;
        $('btn-pin').classList.toggle('is-on', ui.pinned);
        applyMode(snap.window.mode);
      }
    }
  } catch { /* негізгі процесс әлі дайын емес */ }

  if (!document.body.dataset.mode) applyMode('full');
  renderAll();

  const mini = () => document.body.dataset.mode === 'compact';

  window.hud.on('usage',  (d) => { ui.data.usage = d;  if (!mini()) renderUsage(d);  });
  window.hud.on('agents', (d) => { ui.data.agents = d; mini() ? renderMini() : renderAgents(d); });
  window.hud.on('limits', (d) => { ui.data.limits = d; mini() ? renderMini() : renderLimits(d); });
  window.hud.on('system', (d) => { ui.data.system = d; mini() ? renderMini() : renderSystem(d); });
  window.hud.on('mode-changed', (mode) => applyMode(mode));

  // 30 күндік тарих
  window.hud.on('history', (h) => {
    ui.data.history = h;
    if (!mini() && ui.win === 'days30') renderUsage(ui.data.usage);
  });

  // Демо режим / parser ескертуі
  window.hud.on('flags', (f) => {
    ui.flags = f || { demo: false, demoEmpty: false, parserWarning: null };
    renderBanners();
  });

  setInterval(tickTimes, 1000);
}

document.addEventListener('DOMContentLoaded', init);
