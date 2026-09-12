'use strict';
// make-icons.js — FalconHUD иконкаларын сыртқы кітапханасыз жасайды (таза Node + zlib).
// Іске қосу:  node build/make-icons.js
// Нәтиже:     build/icon.png (512×512), build/tray.png (32×32), build/icon.ico

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ------------------------------------------------------------------ PNG жазу

// CRC32 кестесі
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// RGBA пикселдер (Uint8Array, size*size*4) → PNG буфері
function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // бит тереңдігі
  ihdr[9] = 6;    // түс типі: RGBA
  ihdr[10] = 0;   // сығу әдісі
  ihdr[11] = 0;   // сүзгі әдісі
  ihdr[12] = 0;   // интерлейс жоқ

  // Әр жолдың алдына сүзгі байты (0) қосылады
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy
      ? rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
      : Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ сурет салу

// Түстер
const C = {
  bgOuter: [18, 24, 42],
  bgInner: [10, 14, 24],
  track:   [255, 255, 255],
  amber:   [245, 158, 11],
  teal:    [20, 184, 166],
};

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Дөңгелектелген шаршының ішінде ме? (нормаланған -0.5..0.5 координаттар)
function insideRoundedRect(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  if (dx <= 0 || dy <= 0) return Math.abs(x) <= half && Math.abs(y) <= half;
  return dx * dx + dy * dy <= radius * radius;
}

// Бір пиксельдің түсін есептеу (супер-сэмплингпен тегістеледі)
function samplePixel(nx, ny) {
  // nx, ny: -0.5 .. 0.5
  const half = 0.5;
  const radius = 0.22;

  if (!insideRoundedRect(nx, ny, half, radius)) return [0, 0, 0, 0];

  // Фон — жоғарыдан төменге градиент
  const t = (ny + 0.5);
  let rgb = mix(C.bgOuter, C.bgInner, t);
  let a = 255;

  // Гауге сақинасы
  const r = Math.sqrt(nx * nx + ny * ny);
  const ringR = 0.30;
  const ringW = 0.062;

  if (Math.abs(r - ringR) <= ringW / 2) {
    // Бұрыш: жоғарыдан бастап сағат тілімен
    let ang = Math.atan2(nx, -ny) * 180 / Math.PI;   // -180..180, 0 = жоғары
    if (ang < 0) ang += 360;                          // 0..360

    const startAng = 225;   // гауге саңылауының шеті (төменгі сол жақ)
    const sweep = 270;      // жалпы доға

    // Ағымдағы бұрыштың доғадағы орны
    let pos = ang - startAng;
    if (pos < 0) pos += 360;

    if (pos <= sweep) {
      const frac = pos / sweep;
      if (frac <= 0.68) {
        // Толтырылған бөлік: амбардан тилға ауысады
        rgb = mix(C.amber, C.teal, frac / 0.68);
      } else {
        // Бос бөлік — күңгірт
        rgb = mix(rgb, C.track, 0.16);
      }
      return [rgb[0], rgb[1], rgb[2], a];
    }
    // Саңылау — фон қалады
  }

  // Гауге тілшесі: жоғары қараған жіңішке үшбұрыш
  const tipY = -0.155;    // ұшы
  const baseY = 0.105;    // табаны
  const baseHalf = 0.072; // табанының жарты ені
  if (ny >= tipY && ny <= baseY) {
    const k = (ny - tipY) / (baseY - tipY);          // 0 = ұшы, 1 = табаны
    if (Math.abs(nx) <= baseHalf * k) {
      return [C.amber[0], C.amber[1], C.amber[2], a];
    }
  }

  // Тілшенің айналу нүктесі
  const dy2 = ny - baseY;
  if (nx * nx + dy2 * dy2 <= 0.055 * 0.055) {
    return [C.teal[0], C.teal[1], C.teal[2], a];
  }

  return [rgb[0], rgb[1], rgb[2], a];
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;   // супер-сэмплинг 4×4

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size - 0.5;
          const ny = (y + (sy + 0.5) / SS) / size - 0.5;
          const p = samplePixel(nx, ny);
          // Альфаны ескеріп қосамыз
          const pa = p[3] / 255;
          r += p[0] * pa; g += p[1] * pa; b += p[2] * pa; a += p[3];
        }
      }
      const n = SS * SS;
      const aAvg = a / n;
      const i = (y * size + x) * 4;
      if (aAvg < 0.5) {
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
      } else {
        const k = a / 255;   // жиналған альфа салмағы
        buf[i]     = Math.round(r / k);
        buf[i + 1] = Math.round(g / k);
        buf[i + 2] = Math.round(b / k);
        buf[i + 3] = Math.round(aAvg);
      }
    }
  }
  return buf;
}

// ------------------------------------------------------------------ ICO жазу

// ICO ішіне PNG кескіндерін тікелей салуға болады (Vista+)
function encodeICO(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);       // резерв
  header.writeUInt16LE(1, 2);       // тип: 1 = icon
  header.writeUInt16LE(count, 4);

  const dirSize = 16 * count;
  let offset = 6 + dirSize;
  const dirs = [];

  for (const { size, data } of pngs) {
    const d = Buffer.alloc(16);
    d[0] = size >= 256 ? 0 : size;   // ені (256 → 0)
    d[1] = size >= 256 ? 0 : size;   // биіктігі
    d[2] = 0;                        // палитра түстері
    d[3] = 0;                        // резерв
    d.writeUInt16LE(1, 4);           // түс жазықтығы
    d.writeUInt16LE(32, 6);          // бит/пиксель
    d.writeUInt32BE(0, 8);
    d.writeUInt32LE(data.length, 8);
    d.writeUInt32LE(offset, 12);
    dirs.push(d);
    offset += data.length;
  }

  return Buffer.concat([header, ...dirs, ...pngs.map((p) => p.data)]);
}

// ------------------------------------------------------------------ орындау

function main() {
  const outDir = __dirname;

  const sizes = { icon: 512, tray: 32 };

  const iconPng = encodePNG(render(sizes.icon), sizes.icon);
  fs.writeFileSync(path.join(outDir, 'icon.png'), iconPng);
  console.log('✓ build/icon.png  (512×512, ' + Math.round(iconPng.length / 1024) + ' КБ)');

  const trayPng = encodePNG(render(sizes.tray), sizes.tray);
  fs.writeFileSync(path.join(outDir, 'tray.png'), trayPng);
  console.log('✓ build/tray.png  (32×32, ' + trayPng.length + ' Б)');

  // Windows .ico — бірнеше өлшемді қамтиды
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = icoSizes.map((s) => ({ size: s, data: encodePNG(render(s), s) }));
  const ico = encodeICO(pngs);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log('✓ build/icon.ico  (' + icoSizes.join(', ') + ' — ' + Math.round(ico.length / 1024) + ' КБ)');
}

main();
