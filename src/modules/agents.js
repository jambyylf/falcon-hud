'use strict';
// agents.js — белсенді Claude Code сессиялары мен фондағы subagent-терді анықтайды.
//
// Дереккөздер:
//  1) Негізгі транскрипт:  ~/.claude/projects/<жоба>/<sessionId>.jsonl
//  2) Subagent транскрипт: ~/.claude/projects/<жоба>/<sessionId>/subagents/**/agent-*.jsonl
//     (қатарында agent-*.meta.json файлы, ішінде agentType бар)
//  3) Жүйедегі claude процестерінің саны

const fsp = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const { projectsDir, projectDirToName, cwdToName } = require('./paths');
const { normalizeModel, modelLabel } = require('./usage-parser');

const ACTIVE_MS = 3 * 60 * 1000;          // Соңғы 3 минутта жаңарса — белсенді

// Негізгі сессия файлының соңғы бөлігі. Бізге тек соңғы әрекет пен әлі аяқталмаған
// Agent шақырулары керек — олар әрқашан файлдың соңында болады, сондықтан 512 КБ жеткілікті.
const SESSION_TAIL_BYTES = 512 * 1024;

// Subagent транскрипттері шағын — токенді дәл санау үшін бүтіндей оқимыз.
const SUBAGENT_MAX_BYTES = 8 * 1024 * 1024;

const HEAD_BYTES = 96 * 1024;             // Subagent файлының басынан (тапсырма мәтіні үшін)

// ---------------------------------------------------------- көмекші оқу функциялары

// Файлдың соңғы N байтын оқып, толық жолдарға бөлу
async function readTailLines(filePath, bytes) {
  let fh = null;
  try {
    const st = await fsp.stat(filePath);
    const start = Math.max(0, st.size - bytes);
    const len = st.size - start;
    if (len <= 0) return [];
    fh = await fsp.open(filePath, 'r');
    const buf = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    let text = buf.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');       // Бірінші жол жартылай болуы мүмкін
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text.split('\n').filter((l) => l && l.length > 1);
  } catch {
    return [];
  } finally {
    if (fh) { try { await fh.close(); } catch {} }
  }
}

// Файлдың басынан N байт оқу
async function readHeadLines(filePath, bytes) {
  let fh = null;
  try {
    const st = await fsp.stat(filePath);
    const len = Math.min(bytes, st.size);
    if (len <= 0) return [];
    fh = await fsp.open(filePath, 'r');
    const buf = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(buf, 0, len, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    if (bytesRead < st.size) lines.pop();   // Соңғы жол жартылай
    return lines.filter((l) => l && l.length > 1);
  } catch {
    return [];
  } finally {
    if (fh) { try { await fh.close(); } catch {} }
  }
}

function safeParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

// Мәтінді қысқарту
function short(s, n) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Жол атынан тек файл атын алу (Read/Edit/Write құралдары үшін)
function baseName(p) {
  if (!p) return null;
  return String(p).split(/[\\/]/).pop() || String(p);
}

// tool_use блогынан қысқа сипаттама құру: "Edit · usage-parser.js"
function describeTool(block) {
  const name = block.name || 'tool';
  const inp = block.input || {};
  let detail = null;

  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit':
      detail = baseName(inp.file_path || inp.notebook_path); break;
    case 'Bash': case 'PowerShell':
      detail = short(inp.description || inp.command, 46); break;
    case 'Grep':
      detail = short(inp.pattern, 36); break;
    case 'Glob':
      detail = short(inp.pattern, 36); break;
    case 'Agent': case 'Task':
      detail = short(inp.description || inp.subagent_type, 46); break;
    case 'WebFetch':
      detail = short(inp.url, 46); break;
    case 'WebSearch':
      detail = short(inp.query, 40); break;
    case 'Skill':
      detail = short(inp.skill, 36); break;
    case 'Workflow':
      detail = short(inp.name || 'workflow', 36); break;
    default:
      detail = short(inp.description || inp.path || inp.file_path || inp.query || inp.pattern, 40);
  }
  return { tool: name, detail };
}

// ---------------------------------------------------------- сессия транскриптін талдау

function analyzeSession(lines) {
  const out = {
    model: null,
    lastTool: null,
    lastActivityTs: 0,
    turnStartTs: 0,
    cwd: null,
    pendingAgents: [],     // tool_result-і келмеген Agent/Task шақырулары
  };

  const agentCalls = new Map();   // tool_use_id → { desc, type, ts }
  const resolved = new Set();     // tool_result келген id-лер

  for (const line of lines) {
    const j = safeParse(line);
    if (!j) continue;                                  // Бұзылған жол — өткізу
    const ts = Date.parse(j.timestamp);
    if (Number.isFinite(ts) && ts > out.lastActivityTs) out.lastActivityTs = ts;
    if (j.cwd) out.cwd = j.cwd;

    if (j.type === 'assistant' && j.message) {
      const m = normalizeModel(j.message.model);
      if (m) out.model = m;
      const content = j.message.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && c.type === 'tool_use') {
            const d = describeTool(c);
            out.lastTool = { tool: d.tool, detail: d.detail, ts: Number.isFinite(ts) ? ts : 0 };
            if (c.name === 'Agent' || c.name === 'Task') {
              agentCalls.set(c.id, {
                id: c.id,
                desc: short((c.input && c.input.description) || (c.input && c.input.subagent_type), 54),
                type: (c.input && c.input.subagent_type) || 'agent',
                ts: Number.isFinite(ts) ? ts : 0,
              });
            }
          }
        }
      }
    }

    if (j.type === 'user' && j.message) {
      const content = j.message.content;
      if (typeof content === 'string') {
        // Нақты қолданушы сұрауы — жаңа кезеңнің басы
        if (Number.isFinite(ts)) out.turnStartTs = ts;
      } else if (Array.isArray(content)) {
        let hasToolResult = false;
        for (const c of content) {
          if (c && c.type === 'tool_result') {
            hasToolResult = true;
            if (c.tool_use_id) resolved.add(c.tool_use_id);
          }
        }
        if (!hasToolResult && Number.isFinite(ts)) out.turnStartTs = ts;
      }
    }
  }

  for (const [id, call] of agentCalls) {
    if (!resolved.has(id)) out.pendingAgents.push(call);
  }
  out.pendingAgents.sort((a, b) => a.ts - b.ts);
  return out;
}

// ---------------------------------------------------------- subagent транскриптін талдау

async function analyzeSubagentFile(filePath) {
  // agentType — қатардағы .meta.json файлынан
  let agentType = null;
  try {
    const metaPath = filePath.replace(/\.jsonl$/, '.meta.json');
    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
    agentType = meta.agentType || null;
  } catch { /* meta жоқ — маңызды емес */ }

  // Тапсырма мәтінін файлдың басынан аламыз
  let label = null;
  let startTs = 0;
  const head = await readHeadLines(filePath, HEAD_BYTES);
  for (const line of head) {
    const j = safeParse(line);
    if (!j) continue;
    if (!startTs) {
      const ts = Date.parse(j.timestamp);
      if (Number.isFinite(ts)) startTs = ts;
    }
    if (j.type === 'user' && j.message && !label) {
      const c = j.message.content;
      let text = null;
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) {
        const tb = c.find((x) => x && x.type === 'text');
        if (tb) text = tb.text;
      }
      if (text) { label = short(text, 70); break; }
    }
  }

  // Токен мен модельді бүкіл файлдан санаймыз (subagent файлдары шағын)
  let tokens = 0;
  let model = null;
  let lastTs = 0;
  let lastTool = null;
  const all = await readTailLines(filePath, SUBAGENT_MAX_BYTES);
  for (const line of all) {
    const j = safeParse(line);
    if (!j || j.type !== 'assistant' || !j.message) continue;
    const ts = Date.parse(j.timestamp);
    if (Number.isFinite(ts) && ts > lastTs) lastTs = ts;
    const m = normalizeModel(j.message.model);
    if (m) model = m;
    const u = j.message.usage;
    if (u) {
      tokens += (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0) +
                (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
    }
    if (Array.isArray(j.message.content)) {
      for (const c of j.message.content) {
        if (c && c.type === 'tool_use') lastTool = describeTool(c);
      }
    }
  }

  return { agentType, label, tokens, model, startTs, lastTs, lastTool, file: filePath };
}

// ---------------------------------------------------------- процестерді санау

let procCache = { count: null, at: 0 };

function countClaudeProcesses() {
  const now = Date.now();
  if (now - procCache.at < 5000) return Promise.resolve(procCache.count);

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? 'tasklist /FI "IMAGENAME eq claude.exe" /NH /FO CSV'
      : "ps -A -o comm= | grep -c -i '[c]laude'";

    exec(cmd, { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      let count = null;
      if (!err && typeof stdout === 'string') {
        if (isWin) {
          const lines = stdout.split('\n').filter((l) => /^"claude\.exe"/i.test(l.trim()));
          count = lines.length;
        } else {
          const n = parseInt(String(stdout).trim(), 10);
          count = Number.isFinite(n) ? n : null;
        }
      }
      procCache = { count, at: Date.now() };
      resolve(count);
    });
  });
}

// ---------------------------------------------------------- негізгі жинау функциясы

async function collect() {
  const now = Date.now();
  const cutoff = now - ACTIVE_MS;
  const root = projectsDir();

  const sessions = [];
  const subagents = [];

  let dirs = [];
  try {
    const items = await fsp.readdir(root, { withFileTypes: true });
    dirs = items.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    dirs = [];
  }

  for (const dirName of dirs) {
    const projPath = path.join(root, dirName);
    let entries = [];
    try {
      entries = await fsp.readdir(projPath, { withFileTypes: true });
    } catch { continue; }

    // --- Негізгі сессия файлдары
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const filePath = path.join(projPath, e.name);
      let st;
      try { st = await fsp.stat(filePath); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;               // Белсенді емес

      const lines = await readTailLines(filePath, SESSION_TAIL_BYTES);
      if (!lines.length) continue;
      const info = analyzeSession(lines);
      const sessionId = e.name.replace(/\.jsonl$/, '');

      sessions.push({
        sessionId,
        projectDir: dirName,
        project: cwdToName(info.cwd) || projectDirToName(dirName),
        model: info.model,
        modelLabel: info.model ? modelLabel(info.model) : null,
        lastTool: info.lastTool,
        lastActivityTs: info.lastActivityTs || st.mtimeMs,
        runningSinceTs: info.turnStartTs || info.lastActivityTs || st.mtimeMs,
        pendingAgents: info.pendingAgents,
      });
    }

    // --- Subagent транскрипттері: <sessionId>/subagents/**
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const subRoot = path.join(projPath, e.name, 'subagents');
      const files = await listAgentFiles(subRoot);
      for (const f of files) {
        let st;
        try { st = await fsp.stat(f); } catch { continue; }
        if (st.mtimeMs < cutoff) continue;             // Аяқталған / тоқтаған агент
        const info = await analyzeSubagentFile(f);
        subagents.push({
          sessionId: e.name,
          projectDir: dirName,
          project: projectDirToName(dirName),
          agentType: info.agentType || 'agent',
          label: info.label,
          tokens: info.tokens,
          model: info.model,
          modelLabel: info.model ? modelLabel(info.model) : null,
          startTs: info.startTs || st.mtimeMs,
          lastTs: info.lastTs || st.mtimeMs,
          lastTool: info.lastTool,
        });
      }
    }
  }

  // Сессия ішіндегі күтудегі Agent шақыруларын транскрипттермен қабыстырамыз
  // (уақыт реті бойынша — әдетте дәл келеді; сәйкес келмесе токен "—" болады)
  const subsBySession = new Map();
  for (const s of subagents) {
    if (!subsBySession.has(s.sessionId)) subsBySession.set(s.sessionId, []);
    subsBySession.get(s.sessionId).push(s);
  }
  for (const arr of subsBySession.values()) arr.sort((a, b) => a.startTs - b.startTs);

  const running = [];
  const usedFiles = new Set();

  for (const s of sessions) {
    const pool = subsBySession.get(s.sessionId) || [];
    let idx = 0;
    for (const call of s.pendingAgents) {
      const match = pool[idx];
      idx++;
      if (match) usedFiles.add(match);
      running.push({
        project: s.project,
        description: call.desc || (match && match.label) || 'Агент',
        agentType: (match && match.agentType) || call.type,
        tokens: match ? match.tokens : null,
        modelLabel: (match && match.modelLabel) || s.modelLabel,
        startedTs: call.ts || (match && match.startTs) || now,
        lastTool: (match && match.lastTool) || null,
      });
    }
  }

  // Негізгі транскриптте күтудегі шақыруы табылмаған, бірақ әлі жазылып жатқан агенттер
  for (const s of subagents) {
    if (usedFiles.has(s)) continue;
    running.push({
      project: s.project,
      description: s.label || 'Агент',
      agentType: s.agentType,
      tokens: s.tokens,
      modelLabel: s.modelLabel,
      startedTs: s.startTs,
      lastTool: s.lastTool,
    });
  }

  running.sort((a, b) => a.startedTs - b.startedTs);
  sessions.sort((a, b) => b.lastActivityTs - a.lastActivityTs);

  const processCount = await countClaudeProcesses();

  return {
    updatedAt: now,
    sessions,
    subagents: running,
    counts: {
      activeSessions: sessions.length,
      runningSubagents: running.length,
      claudeProcesses: processCount,
    },
  };
}

// subagents папкасындағы барлық agent-*.jsonl (workflows ішіндегілерін қоса)
async function listAgentFiles(dir, depth = 0, acc = []) {
  if (depth > 3) return acc;
  let items;
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) await listAgentFiles(full, depth + 1, acc);
    else if (it.isFile() && it.name.endsWith('.jsonl') && !it.name.endsWith('.meta.json')) acc.push(full);
  }
  return acc;
}

module.exports = { collect, countClaudeProcesses, ACTIVE_MS };
