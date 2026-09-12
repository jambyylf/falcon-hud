'use strict';
// paths.js — Claude Code папкаларының жолдары (Windows / macOS / Linux)

const os = require('os');
const path = require('path');
const fs = require('fs');

// ~/.claude түбірі. CLAUDE_CONFIG_DIR орта айнымалысы басымдыққа ие.
function claudeRoot() {
  if (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()) {
    return process.env.CLAUDE_CONFIG_DIR.trim();
  }
  return path.join(os.homedir(), '.claude');
}

// ~/.claude/projects — әр жоба өз папкасында, ішінде <sessionId>.jsonl файлдары
function projectsDir() {
  return path.join(claudeRoot(), 'projects');
}

// Credentials файлы (Windows/Linux). macOS-та Keychain қолданылады.
function credentialsFile() {
  return path.join(claudeRoot(), '.credentials.json');
}

// Папка бар ма?
function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// "c--Users-FALCON-Documents-falcon-hud" → "falcon-hud"
// Claude Code жол атын кодтап сақтайды: бөлгіштер "-" болып өзгереді, сондықтан
// жоба атының өзіндегі "-" мен жол бөлгішін ажырату мүмкін емес. Ең сенімді
// дереккөз — .jsonl ішіндегі "cwd" өрісі; бұл функция тек резерв ретінде керек.
const CONTAINER_TOKENS = new Set([
  'users', 'documents', 'desktop', 'downloads', 'home', 'projects', 'dev', 'code',
  'onedrive', 'repos', 'source', 'src', 'work',
]);

function projectDirToName(dirName) {
  if (!dirName) return '—';
  const parts = String(dirName).split('-').filter(Boolean);
  if (!parts.length) return String(dirName);

  const user = (os.userInfo().username || '').toLowerCase();
  // Басындағы қызметтік бөліктерді (диск әрпі, Users, қолданушы аты, Documents…) тастаймыз.
  // Қолданушы аты тек "users" сөзінен кейін келгенде ғана тасталады — әйтпесе
  // "falcon-hud" сияқты жоба аты қырқылып қалады.
  let i = 0;
  let prevWasUsers = false;
  while (i < parts.length - 1) {
    const low = parts[i].toLowerCase();
    const isDrive = low.length === 1 && /^[a-z]$/.test(low);
    if (isDrive || CONTAINER_TOKENS.has(low)) { prevWasUsers = low === 'users'; i++; continue; }
    if (prevWasUsers && low === user) { prevWasUsers = false; i++; continue; }
    break;
  }
  const tail = parts.slice(i);
  return tail.length ? tail.join('-') : String(dirName);
}

// cwd жолынан қысқа жоба атын аламыз (соңғы папка аты).
// Windows-та бөлгіш "\", macOS/Linux-та "/" — екеуін де қолдаймыз.
const SEP = /[\\/]/;

function cwdToName(cwd) {
  if (!cwd) return null;
  const norm = String(cwd).replace(/[\\/]+$/, '');
  const parts = norm.split(SEP).filter(Boolean);
  const base = parts.length ? parts[parts.length - 1] : null;
  return base || null;
}

module.exports = {
  claudeRoot,
  projectsDir,
  credentialsFile,
  exists,
  projectDirToName,
  cwdToName,
};
