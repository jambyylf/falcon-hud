'use strict';
// demo-data.js — ДЕМО режимнің жасанды дерегі.
//
// Мақсаты: нақты өмірде сирек кездесетін күйлерді көзбен тексеру.
// Бұл файл нақты дерекке ЕШҚАНДАЙ әсер етпейді — тек «Демо режим» қосулы кезде
// негізгі процесс осы деректі renderer-ге жібереді.
//
// Демо деректе бір мезгілде мыналар бар:
//   (а) «falcon-hud» карточкасының ІШІНДЕ 2 subagent (шегініспен көрінеді)
//   (б) 5 сағаттық лимит 92% — қызыл әрі пульсациялайды
//   (в) C: дискі 87% — қызыл
//   (г) 5 модель қатар, оның бірі («Nova 6») — бағасы белгісіз ЖАҢА модель.
//       Түстер мен аңыз бұзылмайтынын тексеру үшін әдейі қосылған.

const MIN = 60 * 1000;

// ────────────────────────────────────────────────── көмекші

function bucket(models) {
  const b = { in: 0, out: 0, cw5: 0, cw1h: 0, cr: 0, total: 0, cost: 0, models: [] };
  for (const m of models) {
    const total = m.in + m.out + m.cache;
    b.in += m.in;
    b.out += m.out;
    b.cw5 += Math.round(m.cache * 0.18);
    b.cw1h += Math.round(m.cache * 0.04);
    b.cr += m.cache - Math.round(m.cache * 0.18) - Math.round(m.cache * 0.04);
    b.total += total;
    b.cost += m.cost;
    b.models.push({ id: m.id, label: m.label, in: m.in, out: m.out, cache: m.cache, total, cost: m.cost });
  }
  b.models.sort((a, c) => c.total - a.total);
  return b;
}

// Бес модель — соңғысы әдейі «жаңа», баға кестесінде жоқ модель
function models5(scale) {
  const k = scale;
  return [
    { id: 'claude-opus-5',    label: 'Opus 5',    in: Math.round(1200 * k), out: Math.round(310000 * k), cache: Math.round(38000000 * k), cost: 34.8 * k },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', in: Math.round(640 * k),  out: Math.round(96000 * k),  cache: Math.round(9400000 * k),  cost: 15.2 * k },
    { id: 'claude-sonnet-5',  label: 'Sonnet 5',  in: Math.round(480 * k),  out: Math.round(74000 * k),  cache: Math.round(5100000 * k),  cost: 3.4 * k },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', in: Math.round(310 * k),  out: Math.round(41000 * k),  cache: Math.round(2600000 * k),  cost: 0.7 * k },
    // ▼ Баға файлында жоқ ЖАҢА модель — түс пен аңыз бұзылмауы керек
    { id: 'claude-nova-6',    label: 'Nova 6',    in: Math.round(150 * k),  out: Math.round(22000 * k),  cache: Math.round(1350000 * k),  cost: 1.9 * k },
  ];
}

// ────────────────────────────────────────────────── ЛИМИТТЕР

function demoLimits(now) {
  return {
    ok: true,
    fetchedAt: now - 42 * 1000,
    stale: false,
    error: null,
    warning: null,
    nextTryAt: null,
    limits: [
      {
        id: 'session:all', kind: 'session', label: '5 сағаттық сессия',
        percent: 92, remaining: 8,                    // ← қызыл әрі пульсациялайды
        resetsAt: now + 37 * MIN, order: 0,
      },
      {
        id: 'weekly_all:all', kind: 'weekly_all', label: 'Апталық (жалпы)',
        percent: 46, remaining: 54,
        resetsAt: now + 4 * 24 * 60 * MIN, order: 1,
      },
      {
        id: 'weekly_scoped:Opus', kind: 'weekly_scoped', label: 'Апталық — Opus',
        percent: 63, remaining: 37,
        resetsAt: now + 4 * 24 * 60 * MIN, order: 2,
      },
      {
        id: 'weekly_scoped:Nova 6', kind: 'weekly_scoped', label: 'Апталық — Nova 6',
        percent: 8, remaining: 92,
        resetsAt: now + 4 * 24 * 60 * MIN, order: 2,
      },
    ],
  };
}

// ────────────────────────────────────────────────── ТОКЕНДЕР / ЖОБАЛАР

function demoUsage(now) {
  return {
    ready: true,
    updatedAt: now,
    windows: {
      last5h: bucket(models5(1)),
      today:  bucket(models5(2.4)),
      week:   bucket(models5(11.6)),
    },
    projects: {
      total: 51,
      activeToday: 5,
      list: [
        { dir: 'demo-1', name: 'falcon-hud',   tokens: 48300000, cost: 36.10, lastActive: now - 20 * 1000 },
        { dir: 'demo-2', name: 'kaspi-pay',    tokens: 31200000, cost: 24.80, lastActive: now - 3 * MIN },
        { dir: 'demo-3', name: 'bilim-web',    tokens: 18700000, cost: 14.20, lastActive: now - 26 * MIN },
        { dir: 'demo-4', name: 'tulpar-bot',   tokens: 9400000,  cost: 6.90,  lastActive: now - 71 * MIN },
        { dir: 'demo-5', name: 'sahna-render', tokens: 4100000,  cost: 2.30,  lastActive: now - 2 * 60 * MIN },
      ],
    },
  };
}

// ────────────────────────────────────────────────── АГЕНТТЕР

function demoAgents(now) {
  return {
    updatedAt: now,
    sessions: [
      {
        sessionId: 'demo-session-1',
        projectDir: 'demo-1',
        project: 'falcon-hud',
        model: 'claude-opus-5',
        modelLabel: 'Opus 5',
        lastTool: { tool: 'Edit', detail: 'usage-parser.js', ts: now - 4000 },
        lastActivityTs: now - 4000,
        runningSinceTs: now - 8 * MIN - 12 * 1000,
        pendingAgents: [],
      },
      {
        sessionId: 'demo-session-2',
        projectDir: 'demo-2',
        project: 'kaspi-pay',
        model: 'claude-fable-5-1',
        modelLabel: 'Fable 5.1',
        lastTool: { tool: 'Bash', detail: 'npm test -- checkout', ts: now - 9000 },
        lastActivityTs: now - 9000,
        runningSinceTs: now - 2 * MIN - 40 * 1000,
        pendingAgents: [],
      },
    ],
    // ▼ Екеуі де «falcon-hud» жобасында → сол карточканың ІШІНДЕ шегініспен тұрады
    subagents: [
      {
        project: 'falcon-hud',
        description: 'Транскрипт құрылымын зерттеу',
        agentType: 'Explore',
        tokens: 248110,
        modelLabel: 'Haiku 4.5',
        startedTs: now - 95 * 1000,
        lastTool: { tool: 'Grep', detail: 'isSidechain' },
      },
      {
        project: 'falcon-hud',
        description: 'Лимит endpoint-ін тексеру',
        agentType: 'general-purpose',
        tokens: 1320040,
        modelLabel: 'Sonnet 5',
        startedTs: now - 42 * 1000,
        lastTool: { tool: 'WebFetch', detail: 'api.anthropic.com/oauth/usage' },
      },
    ],
    counts: { activeSessions: 2, runningSubagents: 2, claudeProcesses: 7 },
  };
}

// ────────────────────────────────────────────────── КОМПЬЮТЕР

// Sparkline «тірі» көрінуі үшін мәндер аздап тербеледі.
// Дискі әдейі 87%-да бекітілген — қызыл күйін көру үшін.
let phase = 0;

function demoSystem(now) {
  phase += 1;
  // Пайызға арналған толқын — 0..100 аралығында
  const wave = (amp, base, speed, shift) =>
    Math.max(0, Math.min(100, base + Math.sin((phase + shift) / speed) * amp));
  // Шексіз мәндерге (байт, МБ) арналған толқын — қысылмайды
  const wave2 = (amp, base, speed, shift) =>
    Math.max(0, base + Math.sin((phase + shift) / speed) * amp);

  const totalRam = 34359738368;             // 32 ГБ
  const ramPct = wave(6, 58, 7, 0);
  const usedRam = Math.round((ramPct / 100) * totalRam);

  return {
    updatedAt: now,
    cpu: {
      load: wave(18, 34, 4, 0),
      cores: 32,
      physicalCores: 24,
      temp: Math.round(wave(6, 61, 9, 3)),
      brand: 'Core i9-14900KF',
    },
    gpu: {
      name: 'NVIDIA GeForce RTX 4070',
      load: wave(22, 61, 5, 2),
      vramUsedMb: Math.round(wave2(900, 7400, 6, 1)),
      vramTotalMb: 12282,
      temp: Math.round(wave(4, 67, 11, 5)),
      source: 'demo',
    },
    ram: { total: totalRam, used: usedRam, free: totalRam - usedRam, percent: ramPct },
    topProcs: [
      { name: 'claude.exe',   pid: 4102, memPercent: 5.1, memBytes: 1751778918, cpuPercent: 12.4 },
      { name: 'Code.exe',     pid: 2211, memPercent: 3.4, memBytes: 1168231628, cpuPercent: 6.1 },
      { name: 'chrome.exe',   pid: 8890, memPercent: 2.8, memBytes: 962072674,  cpuPercent: 3.3 },
      { name: 'electron.exe', pid: 7734, memPercent: 1.9, memBytes: 652835028,  cpuPercent: 2.0 },
      { name: 'node.exe',     pid: 5512, memPercent: 1.2, memBytes: 412316860,  cpuPercent: 1.1 },
    ],
    disks: [
      // ▼ Жүйелік дискі 87% — қызыл болып, жолағы пульсациялауы керек
      { mount: 'C:', size: 958398464000, used: 833806663680, free: 124591800320, percent: 87 },
      { mount: 'D:', size: 1920383410176, used: 787357197772, free: 1133026212404, percent: 41 },
      { mount: 'E:', size: 1024209543168, used: 635009916764, free: 389199626404, percent: 62 },
    ],
    network: {
      rxBytesPerSec: Math.round(wave2(900000, 1400000, 3, 0)),
      txBytesPerSec: Math.round(wave2(180000, 260000, 4, 2)),
    },
    uptimeSec: 6 * 3600 + 14 * 60,
    battery: null,
  };
}

// ────────────────────────────────────────────────── 30 КҮНДІК ТАРИХ

function demoHistory(now) {
  const w = bucket(models5(46));
  return {
    ok: true,
    days: 30,
    firstDay: new Date(now - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    lastDay: new Date(now).toISOString().slice(0, 10),
    window30: w,
  };
}

// ────────────────────────────────────────────────── БОС КҮЙ

function emptyPayload(now) {
  const zero = { in: 0, out: 0, cw5: 0, cw1h: 0, cr: 0, total: 0, cost: 0, models: [] };
  return {
    usage: {
      ready: true,
      updatedAt: now,
      windows: { last5h: zero, today: Object.assign({}, zero), week: Object.assign({}, zero) },
      projects: { total: 51, activeToday: 0, list: [] },
    },
    agents: {
      updatedAt: now,
      sessions: [],
      subagents: [],
      counts: { activeSessions: 0, runningSubagents: 0, claudeProcesses: 0 },
    },
    limits: demoLimits(now),
    history: { ok: false, days: 0, window30: null },
  };
}

// ────────────────────────────────────────────────── СЫРТҚЫ API

// Тұрақты бөлік — демо қосылғанда БІР РЕТ құрылады.
// Сондықтан таймерлер («8 мин 12 с») нақтылықпен бірдей өсіп отырады.
function buildStatic(opts) {
  const now = Date.now();
  if (opts && opts.empty) return emptyPayload(now);
  return {
    usage: demoUsage(now),
    agents: demoAgents(now),
    limits: demoLimits(now),
    history: demoHistory(now),
  };
}

// Компьютер күйі — әр тікте жаңарады (sparkline қозғалып тұруы үшін)
function buildSystem(opts) {
  const now = Date.now();
  const sys = demoSystem(now);
  if (opts && opts.empty) {
    sys.topProcs = [];
    sys.network = { rxBytesPerSec: 0, txBytesPerSec: 0 };
  }
  return sys;
}

module.exports = { buildStatic, buildSystem };
