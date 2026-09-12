'use strict';
// system.js — компьютер күйі: CPU, GPU, RAM, диск, желі, uptime, батарея.
// Дерек алынбаса — null қайтарылады, интерфейсте "—" болып көрінеді. Қате шығармайды.

const si = require('systeminformation');
const { exec } = require('child_process');

// Әр сұрауды қорғаймыз: біреуі құласа, қалғаны жұмысын жалғастырады
async function safe(fn, fallback) {
  try {
    const v = await fn();
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- GPU (NVIDIA)

let nvidiaAvailable = null;   // null = әлі тексерілмеді

function queryNvidia() {
  return new Promise((resolve) => {
    if (nvidiaAvailable === false) return resolve(null);
    const q = 'name,utilization.gpu,memory.used,memory.total,temperature.gpu';
    exec(
      `nvidia-smi --query-gpu=${q} --format=csv,noheader,nounits`,
      { timeout: 3500, windowsHide: true, maxBuffer: 256 * 1024 },
      (err, stdout) => {
        if (err || !stdout) { nvidiaAvailable = false; return resolve(null); }
        const line = String(stdout).split('\n').find((l) => l.trim());
        if (!line) { nvidiaAvailable = false; return resolve(null); }
        const parts = line.split(',').map((s) => s.trim());
        nvidiaAvailable = true;
        resolve({
          name: parts[0] || null,
          load: num(parts[1]),
          vramUsedMb: num(parts[2]),
          vramTotalMb: num(parts[3]),
          temp: num(parts[4]),
          source: 'nvidia-smi',
        });
      }
    );
  });
}

// nvidia-smi жоқ болса — systeminformation арқылы
async function gpuInfo() {
  const nv = await queryNvidia();
  if (nv && nv.name) return nv;

  const g = await safe(() => si.graphics(), null);
  if (!g || !Array.isArray(g.controllers) || !g.controllers.length) return null;

  // Ең көп жадысы бар картаны негізгі деп аламыз
  const c = g.controllers.slice().sort(
    (a, b) => (num(b.vram) || 0) - (num(a.vram) || 0)
  )[0];
  if (!c) return null;

  return {
    name: c.model || c.vendor || null,
    load: num(c.utilizationGpu),
    vramUsedMb: num(c.memoryUsed),
    vramTotalMb: num(c.memoryTotal) || num(c.vram),
    temp: num(c.temperatureGpu),
    source: 'systeminformation',
  };
}

// ---------------------------------------------------------------- негізгі жинау

let prevNet = null;   // Желі жылдамдығын есептеу үшін алдыңғы өлшем

// Алғашқы "жылыту": si.networkStats() мен si.currentLoad() бірінші шақыруда 0 қайтарады,
// себебі салыстыратын алдыңғы өлшем жоқ. Апп қосылғанда бір рет бос шақырамыз.
async function warmup() {
  await safe(() => si.networkStats(), null);
  await safe(() => si.currentLoad(), null);
}

async function collect() {
  const [load, temp, mem, procs, fs_, net, timeInfo, batt, cpuInfo, gpu] = await Promise.all([
    safe(() => si.currentLoad(), null),
    safe(() => si.cpuTemperature(), null),
    safe(() => si.mem(), null),
    safe(() => si.processes(), null),
    safe(() => si.fsSize(), null),
    safe(() => si.networkStats(), null),
    safe(() => Promise.resolve(si.time()), null),
    safe(() => si.battery(), null),
    safe(() => si.cpu(), null),
    safe(() => gpuInfo(), null),
  ]);

  // --- CPU
  const cpu = {
    load: load ? num(load.currentLoad) : null,
    cores: load && Array.isArray(load.cpus) ? load.cpus.length
         : (cpuInfo ? num(cpuInfo.cores) : null),
    physicalCores: cpuInfo ? num(cpuInfo.physicalCores) : null,
    temp: temp ? num(temp.main) : null,
    brand: cpuInfo ? (cpuInfo.brand || null) : null,
  };
  if (cpu.temp != null && cpu.temp <= 0) cpu.temp = null;   // 0 °C = дерек жоқ

  // --- RAM
  const ram = mem ? {
    total: num(mem.total),
    used: num(mem.active != null ? mem.active : mem.used),
    free: num(mem.available != null ? mem.available : mem.free),
  } : null;
  if (ram && ram.total && ram.used != null) {
    ram.percent = (ram.used / ram.total) * 100;
  }

  // --- RAM бойынша топ-5 процесс
  // systeminformation нұсқасына қарай өріс аттары әртүрлі болады:
  //   жаңа: mem (%), cpu (%), memRss (КБ)   |   ескі: pmem (%), pcpu (%)
  let topProcs = [];
  if (procs && Array.isArray(procs.list)) {
    topProcs = procs.list
      .map((p) => {
        const pct = num(p.mem != null ? p.mem : p.pmem);
        const rssKb = num(p.memRss);
        let bytes = rssKb != null ? rssKb * 1024 : null;
        if (bytes == null && pct != null && ram && ram.total) bytes = (pct / 100) * ram.total;
        return {
          name: p.name || '—',
          pid: p.pid,
          memPercent: pct,
          memBytes: bytes,
          cpuPercent: num(p.cpu != null ? p.cpu : p.pcpu),
        };
      })
      .filter((p) => p.memBytes != null || p.memPercent != null)
      .sort((a, b) => (b.memBytes || 0) - (a.memBytes || 0))
      .slice(0, 5);
  }

  // --- Дискілер
  let disks = [];
  if (Array.isArray(fs_)) {
    const seen = new Set();
    disks = fs_
      .filter((d) => {
        const key = d.mount || d.fs;
        if (!key || seen.has(key)) return false;
        if (!num(d.size)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => ({
        mount: d.mount || d.fs,
        size: num(d.size),
        used: num(d.used),
        free: num(d.available != null ? d.available : (num(d.size) - num(d.used))),
        percent: num(d.use),
      }))
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 4);
  }

  // --- Желі жылдамдығы
  let network = null;
  if (Array.isArray(net) && net.length) {
    let rx = 0, tx = 0;
    for (const n of net) {
      rx += num(n.rx_sec) || 0;
      tx += num(n.tx_sec) || 0;
    }
    // Бірінші өлшемде rx_sec теріс/нөл болуы мүмкін — алдыңғы мәнді сақтаймыз
    if (rx < 0) rx = prevNet ? prevNet.rx : 0;
    if (tx < 0) tx = prevNet ? prevNet.tx : 0;
    prevNet = { rx, tx };
    network = { rxBytesPerSec: rx, txBytesPerSec: tx };
  }

  // --- Батарея
  const battery = (batt && batt.hasBattery) ? {
    percent: num(batt.percent),
    isCharging: !!batt.isCharging,
    acConnected: !!batt.acConnected,
    minutesLeft: num(batt.timeRemaining),
  } : null;

  return {
    updatedAt: Date.now(),
    cpu,
    gpu,
    ram,
    topProcs,
    disks,
    network,
    uptimeSec: timeInfo ? num(timeInfo.uptime) : null,
    battery,
  };
}

module.exports = { collect, warmup };
