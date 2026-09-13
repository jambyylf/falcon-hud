'use strict';
// live.js — «бұл сессия әлі ашық тұр ма, әлде жабылған ба?»
//
// Бұрын мұны транскрипттен болжайтынбыз, ал ол сенімсіз еді: терминалды жауып
// тастасаң да, жазба файлы орнында қала беретін — виджет жабық жобаны әлі
// ашықтай көрсететін.
//
// Шын мәнінде Claude Code өзі ~/.claude/sessions/<pid>.json файлын жүргізеді.
// Ішінде: pid, sessionId, cwd және ЕҢ БАСТЫСЫ — өзінің күйі (busy / idle).
// Шыққанда сол файлды өзі өшіреді.
//
// Одан екі нәрсе аламыз:
//   1. Сессия тірі ме — файл бар ма әрі сол pid шынымен жүріп тұр ма;
//   2. Не істеп жатыр — Claude Code-тың өз сөзі, біздің болжамымыз емес.
//
// МАҢЫЗДЫ: бұл мүмкіндік Claude Code-тың жаңа нұсқаларында ғана бар. Қалта
// мүлдем болмаса, ескі тәртіппен жұмыс істей береміз (төмендегі supported()).

const fs = require('fs');
const path = require('path');
const { claudeRoot } = require('./paths');

const CACHE_MS = 3000;          // қалтаны секунд сайын оқып әуре болмаймыз
const STATUS_MAX_AGE_MS = 30 * 60 * 1000;   // одан ескі күйге сенбейміз

const state = {
  at: 0,
  map: new Map(),     // sessionId → жазба
  supported: false,
};

function sessionsDir() { return path.join(claudeRoot(), 'sessions'); }

// Процесс шынымен жүріп тұр ма? Сигнал 0 — ештеңе жібермейді, тек тексереді.
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM — процесс бар, бірақ бізде оған тиюге рұқсат жоқ. Демек тірі.
    return !!(e && e.code === 'EPERM');
  }
}

function read() {
  const now = Date.now();
  if (now - state.at < CACHE_MS) return state;

  state.at = now;
  const map = new Map();
  let any = false;

  let files;
  try {
    files = fs.readdirSync(sessionsDir());
  } catch {
    state.map = map;
    state.supported = false;     // қалта жоқ — ескі Claude Code
    return state;
  }

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    any = true;
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(sessionsDir(), f), 'utf8'));
    } catch {
      continue;                  // жазылу үстінде болуы мүмкін — келесі айналымда оқимыз
    }
    if (!j || !j.sessionId) continue;

    const alive = pidAlive(j.pid);
    const statusAge = now - (Number(j.statusUpdatedAt) || 0);

    map.set(String(j.sessionId), {
      pid: j.pid,
      alive,
      cwd: j.cwd || null,
      name: j.name || null,
      // Күйге тек процесс тірі әрі жазба жаңа болғанда ғана сенеміз
      status: alive && statusAge < STATUS_MAX_AGE_MS ? (j.status || null) : null,
      statusAt: Number(j.statusUpdatedAt) || 0,
      kind: j.kind || null,
    });
  }

  state.map = map;
  state.supported = any;
  return state;
}

// Claude Code бұл мүмкіндікті қолдай ма? Қолдамаса, «жабылған» деген
// қорытынды жасауға болмайды — бәрін бұрынғыдай көрсете береміз.
function supported() { return read().supported; }

// sessionId бойынша жазба (болмаса — null)
function lookup(sessionId) {
  if (!sessionId) return null;
  return read().map.get(String(sessionId)) || null;
}

// Сессия жабылған ба? Тек анық білгенде ғана true қайтарамыз.
function isClosed(sessionId) {
  const s = read();
  if (!s.supported) return false;              // біле алмаймыз
  const rec = s.map.get(String(sessionId));
  if (!rec) return true;                       // файлы жоқ — Claude Code шығарда өшірген
  return !rec.alive;                           // файлы қалған, бірақ процесі өлген
}

module.exports = { supported, lookup, isClosed, sessionsDir, pidAlive };
