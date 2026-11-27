// RC-1 — contraejemplos reales de la detención de procesos propios. No ejecuta la detención insegura anterior (ya no existe) y no toca ningún proceso ajeno: los «ajenos» son procesos desechables creados aquí.
//   node prueba_procesos_propios.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { detenerPropio, lanzarPropio, procesoVivo, veredicto, escuchando } from "./procesos_propios.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc1-"));
const reg = (n) => path.join(dir, n + ".json");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((ok) => { import("node:net").then(({ default: net }) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); }); });
const ESCUCHA = (p) => ["-e", `require('http').createServer((q,r)=>r.end('ok')).listen(${p},'127.0.0.1')`];
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let n = 0; const ok = (m) => console.log(`  ok ${++n} — ${m}`);
async function esperaPuerto(p, abierto) { for (let i = 0; i < 40; i++) { if ((await escuchando(p)) === abierto) return true; await espera(250); } return false; }
const ajeno = async (p) => { const c = spawn(process.execPath, ESCUCHA(p), { stdio: "ignore", windowsHide: true }); assert.ok(await esperaPuerto(p, true), "el proceso ajeno no abrió el puerto"); return c; };

const limpiar = [];
try {
  // 0. Función pura
  const R = { propietario: "revision-consolidada", pid: 10, inicio: "2026-01-01T00:00:00.0000000Z", linea: "node a" };
  assert.equal(veredicto(R, { inicio: R.inicio, linea: "node a" }), "propio");
  assert.equal(veredicto(R, null), "obsoleto");
  assert.equal(veredicto(R, { inicio: "2026-01-02T00:00:00.0000000Z", linea: "node a" }), "reutilizado");
  assert.equal(veredicto(R, { inicio: R.inicio, linea: "node b" }), "otra-linea");
  assert.equal(veredicto({ ...R, propietario: "otro" }, { inicio: R.inicio, linea: "node a" }), "ausente");
  assert.equal(veredicto(null, null), "ausente"); ok("veredicto puro: propio / obsoleto / reutilizado / otra línea / sin dueño / sin registro");

  // 1. Arranque y parada genuinos (el proceso propio SÍ se detiene, registro incluido)
  { const p = await puertoLibre(); const f = reg("genuino");
    const pid = lanzarPropio(f, { cwd: dir, log: path.join(dir, "g.log"), puerto: p, ejecutable: process.execPath, args: ESCUCHA(p) });
    assert.ok(await esperaPuerto(p, true), "el propio no escucha"); assert.ok(fs.existsSync(f));
    const r = detenerPropio(f); assert.equal(r.estado, "detenido");
    assert.ok(await esperaPuerto(p, false), "el puerto sigue abierto tras detener lo propio"); assert.ok(!vivo(pid)); assert.ok(!fs.existsSync(f)); ok("arranque y parada genuinos: proceso propio detenido, puerto libre, registro retirado"); }

  // 2. Escucha ajena SIN registro: no se toca
  { const p = await puertoLibre(); const c = await ajeno(p); limpiar.push(c);
    const r = detenerPropio(reg("inexistente")); assert.equal(r.estado, "ausente");
    assert.ok(vivo(c.pid) && (await escuchando(p))); ok("escucha ajena sin registro propio: se rechaza y sigue viva"); }

  // 3. Registro OBSOLETO (el propio ya terminó) y un ajeno tomó el MISMO puerto: se limpia el registro, el ajeno vive
  { const p = await puertoLibre(); const f = reg("obsoleto");
    const pid = lanzarPropio(f, { cwd: dir, log: path.join(dir, "o.log"), puerto: p, ejecutable: process.execPath, args: ESCUCHA(p) });
    assert.ok(await esperaPuerto(p, true)); process.kill(pid); assert.ok(await esperaPuerto(p, false), "el propio no liberó el puerto");
    const c = await ajeno(p); limpiar.push(c);   // otro proceso toma el puerto después
    const r = detenerPropio(f); assert.equal(r.estado, "obsoleto");
    assert.ok(vivo(c.pid) && (await escuchando(p)), "el ajeno que tomó el puerto fue tocado"); assert.ok(!fs.existsSync(f)); ok("registro obsoleto + puerto retomado por un ajeno: registro limpiado, ajeno intacto"); }

  // 4. PID reutilizado: el registro apunta al PID de un proceso VIVO ajeno con otra hora de inicio
  { const p = await puertoLibre(); const c = await ajeno(p); limpiar.push(c); const v = procesoVivo(c.pid); assert.ok(v);
    const f = reg("reutilizado"); fs.writeFileSync(f, JSON.stringify({ propietario: "revision-consolidada", pid: c.pid, inicio: "2020-01-01T00:00:00.0000000Z", linea: v.linea, puerto: p }));
    const r = detenerPropio(f); assert.equal(r.estado, "reutilizado");
    assert.ok(vivo(c.pid) && (await escuchando(p)), "el proceso con el PID reutilizado fue tocado"); assert.ok(!fs.existsSync(f)); ok("PID reutilizado (otra hora de inicio): rechazado, el proceso ajeno sigue vivo"); }

  // 5. Mismo PID y mismo inicio pero otra línea de comando: rechazado
  { const p = await puertoLibre(); const c = await ajeno(p); limpiar.push(c); const v = procesoVivo(c.pid);
    const f = reg("otra-linea"); fs.writeFileSync(f, JSON.stringify({ propietario: "revision-consolidada", pid: c.pid, inicio: v.inicio, linea: v.linea + " --otra", puerto: p }));
    const r = detenerPropio(f); assert.equal(r.estado, "otra-linea"); assert.ok(vivo(c.pid) && (await escuchando(p))); ok("misma hora de inicio pero otra línea de comando: rechazado, ajeno vivo"); }

  // 6. Registro sin dueño / corrupto: rechazado sin tocar nada
  { const p = await puertoLibre(); const c = await ajeno(p); limpiar.push(c); const v = procesoVivo(c.pid);
    const f = reg("sin-dueno"); fs.writeFileSync(f, JSON.stringify({ pid: c.pid, inicio: v.inicio, linea: v.linea }));
    assert.equal(detenerPropio(f).estado, "ausente"); fs.writeFileSync(f, "{no es json"); assert.equal(detenerPropio(f).estado, "ausente");
    assert.ok(vivo(c.pid) && (await escuchando(p))); ok("registro sin dueño o corrupto: rechazado, ajeno vivo"); }

  // 7. Control negativo: un registro correcto de un proceso vivo SÍ lo detiene (la prueba no es vacía) y el vecino ajeno en OTRO puerto sigue vivo
  { const p = await puertoLibre(); const q = await puertoLibre(); const c = await ajeno(q); limpiar.push(c); const f = reg("control");
    const pid = lanzarPropio(f, { cwd: dir, log: path.join(dir, "c.log"), puerto: p, ejecutable: process.execPath, args: ESCUCHA(p) }); assert.ok(await esperaPuerto(p, true));
    assert.equal(detenerPropio(f).estado, "detenido"); assert.ok(!vivo(pid) && vivo(c.pid) && (await escuchando(q))); ok("control: detiene solo el propio; el vecino ajeno sigue vivo"); }
  console.log(`PROCESOS PROPIOS: ${n} comprobaciones OK`);
} finally {
  for (const c of limpiar) { try { c.kill(); } catch { /* ya terminó */ } }
  fs.rmSync(dir, { recursive: true, force: true });
}
