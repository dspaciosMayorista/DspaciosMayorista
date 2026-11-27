// Memory guard: runs a command, samples free physical memory every 500 ms, kills the whole tree if it drops below the floor, and reports min free / duration.
// usage: node guardia.mjs <floorMB> <logfile> <cmd> [args...]
import { spawn, execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
const [piso, log, cmd, ...args] = process.argv.slice(2);
const floor = Number(piso) * 1024 * 1024;
const t0 = Date.now(); let min = os.freemem(), abortado = false;
const ch = spawn(cmd, args, { stdio: "inherit" });
const iv = setInterval(() => {
  const f = os.freemem(); if (f < min) min = f;
  if (f < floor && !abortado) { abortado = true; try { execSync(`taskkill /PID ${ch.pid} /T /F`, { stdio: "ignore" }); } catch {} }
}, 500);
ch.on("exit", (code) => {
  clearInterval(iv);
  const r = { exit: code, abortado, segundos: Math.round((Date.now() - t0) / 1000), libreInicialMB: null, libreMinimaMB: Math.round(min / 1048576), pisoMB: Number(piso) };
  fs.appendFileSync(log, JSON.stringify(r) + "\n"); console.log(JSON.stringify(r));
  process.exit(code ?? 1);
});
