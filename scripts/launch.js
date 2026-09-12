'use strict';
// launch.js — FalconHUD-ті сенімді іске қосу.
//
// Неге керек: кейбір терминалдар (мысалы Electron-ға негізделген редакторлардың
// ішкі терминалы) ELECTRON_RUN_AS_NODE=1 айнымалысын орнатып қояды. Ол қосулы болса
// Electron қарапайым Node ретінде іске қосылады да, терезе мүлде ашылмайды.
// Бұл скрипт сол айнымалыны алып тастап, Electron-ды дұрыс режимде қосады.

const { spawn } = require('child_process');
const path = require('path');

let electronPath;
try {
  electronPath = require('electron');            // Electron бинарының жолын қайтарады
} catch (e) {
  console.error('Electron табылмады. Алдымен "npm install" командасын орындаңыз.');
  process.exit(1);
}

if (typeof electronPath !== 'string') {
  console.error('Electron жолы анықталмады. "npm install" қайта орындап көріңіз.');
  process.exit(1);
}

// Ортаны тазалаймыз
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const projectRoot = path.join(__dirname, '..');
const args = [projectRoot].concat(process.argv.slice(2));

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('close', (code) => process.exit(code == null ? 0 : code));
child.on('error', (err) => {
  console.error('Іске қосу қатесі:', err.message);
  process.exit(1);
});
