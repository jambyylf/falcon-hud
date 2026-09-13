'use strict';
/* settings.js — баптау терезесінің логикасы.
   Мұнда да Node.js жоқ: бәрі window.settings (preload-settings.js) арқылы өтеді.

   ҚАУІПСІЗДІК: бот токені бұл жаққа ЕШҚАШАН келмейді. Біз тек жаңа токен
   ЖІБЕРЕ аламыз, ал бары-жоғын «қойылған / қойылмаған» деген күйден білеміз. */

const $ = (id) => document.getElementById(id);

let busy = false;

/* ──────────────────────────── көмекші ──────────────────────────── */

function msg(text, kind) {
  const box = $('tg-msg');
  box.hidden = false;
  box.className = 'st-msg is-' + (kind || 'info');
  box.textContent = text;
  if (kind === 'ok') {
    setTimeout(() => { if (box.textContent === text) box.hidden = true; }, 6000);
  }
}

function clearMsg() { $('tg-msg').hidden = true; }

function setBusy(v) {
  busy = v;
  for (const b of document.querySelectorAll('.st-btn')) b.disabled = v;
}

/* ──────────────────────── Telegram бөлімі ──────────────────────── */

function paintTelegram(st) {
  const dot = $('tg-dot');
  const text = $('tg-state-text');

  $('tg-setup').hidden = !!st.configured;
  $('tg-ready').hidden = !st.configured;

  dot.className = 'st-dot';

  if (!st.configured) {
    dot.classList.add('is-bad');
    text.textContent = 'Токен қойылмаған';
    return;
  }

  $('tg-enabled').checked = !!st.enabled;
  $('tg-s-sessions').checked = !!(st.send && st.send.sessions);
  $('tg-s-limits').checked = !!(st.send && st.send.limits);
  $('tg-s-parser').checked = !!(st.send && st.send.parser);

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
  try {
    const st = await window.settings.telegramStatus();
    paintTelegram(st);
  } catch {
    $('tg-state-text').textContent = 'Күй оқылмады';
  }
}

/* ──────────────────────────── оқиғалар ──────────────────────────── */

function bind() {
  $('btn-close').addEventListener('click', () => window.settings.close());

  // ── Токенді көрсету/жасыру
  $('tg-eye').addEventListener('click', () => {
    const f = $('tg-token');
    f.type = f.type === 'password' ? 'text' : 'password';
  });

  // ── Токенді сақтау
  const saveToken = async () => {
    if (busy) return;
    const token = $('tg-token').value.trim();
    if (token.length < 20 || !token.includes(':')) {
      msg('Токен дұрыс емес сияқты. @BotFather берген толық жолды қойыңыз.', 'bad');
      return;
    }
    setBusy(true);
    clearMsg();
    msg('Тексерілуде…', 'info');
    try {
      const r = await window.settings.telegramSetToken(token);
      if (r.ok) {
        $('tg-token').value = '';
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

  $('tg-save').addEventListener('click', saveToken);
  $('tg-token').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveToken();
  });

  // ── Қосу / өшіру
  $('tg-enabled').addEventListener('change', async (e) => {
    await window.settings.telegramSetEnabled(e.target.checked);
    clearMsg();
    await refreshTelegram();
  });

  // ── Не жіберілсін
  const sendOpts = async () => {
    await window.settings.telegramSetSend({
      sessions: $('tg-s-sessions').checked,
      limits: $('tg-s-limits').checked,
      parser: $('tg-s-parser').checked,
    });
  };
  for (const id of ['tg-s-sessions', 'tg-s-limits', 'tg-s-parser']) {
    $(id).addEventListener('change', sendOpts);
  }

  // ── Сынақ хабары
  $('tg-test').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    msg('Жіберілуде…', 'info');
    try {
      const r = await window.settings.telegramTest();
      msg(r.ok ? 'Жіберілді ✅ Телефоныңызды қараңыз.'
               : ('Жіберілмеді: ' + (r.error || '—')), r.ok ? 'ok' : 'bad');
      await refreshTelegram();
    } finally {
      setBusy(false);
    }
  });

  // ── Токенді өшіру
  $('tg-clear').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.settings.telegramClearToken();
      msg('Токен өшірілді.', 'info');
      await refreshTelegram();
    } finally {
      setBusy(false);
    }
  });

  // ── Хабарламалар
  $('notify-ready').addEventListener('change', (e) => {
    window.settings.setNotifyReady(e.target.checked);
  });

  const pct = $('alert-pct');
  pct.addEventListener('input', () => {
    $('alert-pct-val').textContent = pct.value + '%';
  });
  pct.addEventListener('change', () => {
    window.settings.setAlertPercent(Number(pct.value));
  });

  // ── Терезе
  $('always-top').addEventListener('change', (e) => {
    window.settings.setAlwaysOnTop(e.target.checked);
  });
  $('auto-launch').addEventListener('change', async (e) => {
    const r = await window.settings.setAutoLaunch(e.target.checked);
    e.target.checked = !!r;
  });

  // ── Баға файлы
  $('open-pricing').addEventListener('click', () => window.settings.openPricing());

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
}

/* ──────────────────────────── іске қосу ──────────────────────────── */

async function init() {
  bind();

  try {
    const s = await window.settings.getAll();
    if (s) {
      $('notify-ready').checked = !!s.notifyReady;
      $('always-top').checked = !!s.alwaysOnTop;
      $('auto-launch').checked = !!s.autoLaunch;
      $('alert-pct').value = s.alertPercent || 80;
      $('alert-pct-val').textContent = (s.alertPercent || 80) + '%';
      if (s.version) $('st-version').textContent = 'FalconHUD ' + s.version;
      paintTelegram(s.telegram || { configured: false });
    }
  } catch {
    $('tg-state-text').textContent = 'Баптау оқылмады';
  }

  // Бот аты кейінірек келуі мүмкін (желі сұрауы) — бір рет жаңартамыз
  setTimeout(refreshTelegram, 1200);
}

document.addEventListener('DOMContentLoaded', init);
