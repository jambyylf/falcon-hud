'use strict';
/* panel.js — баптау панелінің логикасы.
   Бұрын бұл бөлек терезе еді; енді виджеттің дәл өз ішінен шығады.

   Мұнда да Node.js жоқ: бәрі window.hud.settings (preload.js) арқылы өтеді.

   ҚАУІПСІЗДІК: бот токені бұл жаққа ЕШҚАШАН келмейді. Біз тек жаңа токен
   ЖІБЕРЕ аламыз, ал бары-жоғын «қойылған / қойылмаған» деген күйден білеміз.

   app.js-тегі атаулармен қақтығыспас үшін бәрі осы функцияның ішінде тұрады. */

(function () {

const api = () => (window.hud && window.hud.settings) || null;
const el = (id) => document.getElementById(id);

let busy = false;
let opened = false;     // панель ашылғанда ғана дерек сұраймыз

/* ──────────────────────────── көмекші ──────────────────────────── */

function msg(text, kind) {
  const box = el('tg-msg');
  box.hidden = false;
  box.className = 'st-msg is-' + (kind || 'info');
  box.textContent = text;
  if (kind === 'ok') {
    setTimeout(() => { if (box.textContent === text) box.hidden = true; }, 6000);
  }
}

function clearMsg() { el('tg-msg').hidden = true; }

function setBusy(v) {
  busy = v;
  for (const b of document.querySelectorAll('.drawer .st-btn')) b.disabled = v;
}

/* ──────────────────────── Ашу / жабу ──────────────────────── */

function open() {
  const d = el('drawer');
  d.classList.add('is-open');
  d.setAttribute('aria-hidden', 'false');
  el('btn-set').classList.add('is-on');
  opened = true;
  load();                                   // әр ашылғанда жаңа дерек
}

function close() {
  const d = el('drawer');
  d.classList.remove('is-open');
  d.setAttribute('aria-hidden', 'true');
  el('btn-set').classList.remove('is-on');
  opened = false;
}

/* ──────────────────────── Дерек көздері ──────────────────────── */

function paintSources(src) {
  const put = (id, ok) => {
    const row = el(id);
    if (!row) return;
    row.classList.toggle('is-on', !!ok);
    row.classList.toggle('is-off', !ok);
    row.querySelector('.st-src-state').textContent = ok ? 'табылды' : 'табылмады';
  };
  put('src-claude', src && src.claude);
  put('src-codex', src && src.codex);
}

/* ──────────────────────── Telegram бөлімі ──────────────────────── */

function paintTelegram(st) {
  const dot = el('tg-dot');
  const text = el('tg-state-text');

  el('tg-setup').hidden = !!st.configured;
  el('tg-ready').hidden = !st.configured;

  dot.className = 'st-dot';

  if (!st.configured) {
    dot.classList.add('is-bad');
    text.textContent = 'Токен қойылмаған';
    return;
  }

  el('tg-enabled').checked = !!st.enabled;
  el('tg-s-sessions').checked = !!(st.send && st.send.sessions);
  el('tg-s-limits').checked = !!(st.send && st.send.limits);
  el('tg-s-parser').checked = !!(st.send && st.send.parser);

  if (!st.enabled) {
    dot.classList.add('is-warn');
    text.textContent = (st.botName || 'Бот') + ' — жіберу өшірулі';
  } else if (!st.hasChat) {
    dot.classList.add('is-warn');
    text.textContent = (st.botName || 'Бот') + ' — ботқа /start деп жазыңыз';
  } else {
    dot.classList.add('is-ok');
    text.textContent = (st.botName || 'Бот') + ' — дайын';
  }

  if (st.lastError) msg('Соңғы қате: ' + st.lastError, 'bad');
}

async function refreshTelegram() {
  const s = api();
  if (!s) return;
  try {
    paintTelegram(await s.telegramStatus());
  } catch {
    el('tg-state-text').textContent = 'Күй оқылмады';
  }
}

/* ──────────────────────── Барлық баптау ──────────────────────── */

async function load() {
  const s = api();
  if (!s) return;
  try {
    const v = await s.getAll();
    if (!v) return;
    el('notify-ready').checked = !!v.notifyReady;
    el('always-top').checked = !!v.alwaysOnTop;
    el('auto-launch').checked = !!v.autoLaunch;
    el('alert-pct').value = v.alertPercent || 80;
    el('alert-pct-val').textContent = (v.alertPercent || 80) + '%';
    if (v.version) el('st-version').textContent = 'v' + v.version;
    paintSources(v.sources);
    paintTelegram(v.telegram || { configured: false });
  } catch {
    el('tg-state-text').textContent = 'Баптау оқылмады';
  }

  // Бот аты кейінірек келуі мүмкін (желі сұрауы) — бір рет жаңартамыз
  setTimeout(() => { if (opened) refreshTelegram(); }, 1200);
}

/* ──────────────────────────── оқиғалар ──────────────────────────── */

function bind() {
  const s = api();
  if (!s) return;

  el('set-back').addEventListener('click', () => s.close());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opened) s.close();
  });

  // ── Токенді көрсету/жасыру
  el('tg-eye').addEventListener('click', () => {
    const f = el('tg-token');
    f.type = f.type === 'password' ? 'text' : 'password';
  });

  // ── Токенді сақтау
  const saveToken = async () => {
    if (busy) return;
    const token = el('tg-token').value.trim();
    if (token.length < 20 || !token.includes(':')) {
      msg('Токен дұрыс емес сияқты. @BotFather берген толық жолды қойыңыз.', 'bad');
      return;
    }
    setBusy(true);
    clearMsg();
    msg('Тексерілуде…', 'info');
    try {
      const r = await s.telegramSetToken(token);
      if (r.ok) {
        el('tg-token').value = '';
        msg('Бот табылды: ' + (r.botName || '—') +
            '. Енді Telegram-нан ботқа /start деп жазыңыз да, «Сынақ хабары» түймесін басыңыз.', 'ok');
      } else {
        msg('Қате: ' + (r.error || 'токен жарамсыз'), 'bad');
      }
      await refreshTelegram();
    } finally {
      setBusy(false);
    }
  };

  el('tg-save').addEventListener('click', saveToken);
  el('tg-token').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveToken();
  });

  // ── Қосу / өшіру
  el('tg-enabled').addEventListener('change', async (e) => {
    await s.telegramSetEnabled(e.target.checked);
    clearMsg();
    await refreshTelegram();
  });

  // ── Не жіберілсін
  const sendOpts = () => s.telegramSetSend({
    sessions: el('tg-s-sessions').checked,
    limits: el('tg-s-limits').checked,
    parser: el('tg-s-parser').checked,
  });
  for (const id of ['tg-s-sessions', 'tg-s-limits', 'tg-s-parser']) {
    el(id).addEventListener('change', sendOpts);
  }

  // ── Сынақ хабары
  el('tg-test').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    msg('Жіберілуде…', 'info');
    try {
      const r = await s.telegramTest();
      msg(r.ok ? 'Жіберілді ✅ Телефоныңызды қараңыз.'
               : ('Жіберілмеді: ' + (r.error || '—')), r.ok ? 'ok' : 'bad');
      await refreshTelegram();
    } finally {
      setBusy(false);
    }
  });

  // ── Токенді өшіру
  el('tg-clear').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      await s.telegramClearToken();
      msg('Токен өшірілді.', 'info');
      await refreshTelegram();
    } finally {
      setBusy(false);
    }
  });

  // ── Хабарламалар
  el('notify-ready').addEventListener('change', (e) => s.setNotifyReady(e.target.checked));

  const pct = el('alert-pct');
  pct.addEventListener('input', () => { el('alert-pct-val').textContent = pct.value + '%'; });
  pct.addEventListener('change', () => s.setAlertPercent(Number(pct.value)));

  // ── Терезе
  el('always-top').addEventListener('change', (e) => window.hud.setAlwaysOnTop(e.target.checked));
  el('auto-launch').addEventListener('change', async (e) => {
    e.target.checked = !!(await s.setAutoLaunch(e.target.checked));
  });

  // ── Баға файлы
  el('open-pricing').addEventListener('click', () => s.openPricing());

  // ── Негізгі процестен келетін «аш / жап» белгісі.
  //    Панельді трейден де, ⚙ түймесінен де, --settings командасынан да
  //    осы бір ғана жол арқылы ашамыз — күй әрдайым бір жерде.
  window.hud.on('settings-open', (on) => { if (on) open(); else close(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bind);
} else {
  bind();
}

})();
