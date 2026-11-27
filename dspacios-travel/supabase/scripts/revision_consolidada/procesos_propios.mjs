// RC-1 — procesos PROPIOS de la revisión: se lanzan con registro verificable y SOLO se detienen si siguen siendo exactamente ese proceso.
// Nunca se mata «lo que escucha en un puerto»: un puerto ocupado por otro proceso (ajeno, o uno que lo tomó después de que el propio terminó) no se toca.
//   node procesos_propios.mjs lanzar <registro.json> <cwd> <log> <puerto> -- <ejecutable> [args…]   lanza desacoplado, registra PID + hora de inicio + línea de comando
//   node procesos_propios.mjs detener <registro.json> [puerto]                                        detiene solo si el registro coincide con el proceso vivo
// Veredictos de detener: detenido | ausente (sin registro) | obsoleto (el proceso ya no existe) | reutilizado (mismo PID, otra hora de inicio) | otra-linea (mismo PID e inicio, otra línea de comando) | no-detenido (sigue vivo tras taskkill).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const PROPIETARIO = "revision-consolidada";

// Consulta Windows (CIM) por PID: hora de inicio exacta (ISO, UTC) + línea de comando. null si no existe.
export function procesoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { @{ inicio = $p.CreationDate.ToUniversalTime().ToString('o'); linea = $p.CommandLine } | ConvertTo-Json -Compress }`], { encoding: "utf8" });
  const t = (r.stdout ?? "").trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

// Función pura (probada sin procesos): ¿el registro describe EXACTAMENTE el proceso vivo?
export function veredicto(registro, vivo) {
  if (!registro || registro.propietario !== PROPIETARIO || !registro.pid || !registro.inicio || !registro.linea) return "ausente";
  if (!vivo) return "obsoleto";
  if (vivo.inicio !== registro.inicio) return "reutilizado";
  if (vivo.linea !== registro.linea) return "otra-linea";
  return "propio";
}

export function leerRegistro(archivo) {
  try { return JSON.parse(fs.readFileSync(archivo, "utf8")); } catch { return null; }
}

// `buscar` y `matar` son inyectables solo para las pruebas.
export function detenerPropio(archivo, { buscar = procesoVivo, matar = (pid) => spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]) } = {}) {
  const reg = leerRegistro(archivo);
  if (!reg) return { estado: "ausente", detalle: "sin registro propio: no se detiene nada" };
  const v = veredicto(reg, buscar(reg.pid));
  if (v !== "propio") {
    if (v === "obsoleto" || v === "reutilizado" || v === "otra-linea") fs.rmSync(archivo, { force: true });   // el registro ya no describe nada nuestro; el proceso actual (si lo hay) NO se toca
    return { estado: v, detalle: v === "obsoleto" ? "el proceso propio ya había terminado" : `el PID ${reg.pid} ya no es el proceso propio (${v}): no se toca` };
  }
  matar(reg.pid);
  if (buscar(reg.pid)) return { estado: "no-detenido", detalle: `el PID ${reg.pid} sigue vivo tras taskkill` };
  fs.rmSync(archivo, { force: true });
  return { estado: "detenido", detalle: `PID ${reg.pid} detenido` };
}

export function lanzarPropio(archivo, { cwd, log, puerto, ejecutable, args, env = process.env }) {
  const fd = fs.openSync(log, "a");
  const p = spawn(ejecutable, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  p.unref();
  let vivo = null;
  for (let i = 0; i < 20 && !vivo; i++) { vivo = procesoVivo(p.pid); }
  if (!vivo) throw new Error(`no se pudo verificar el proceso lanzado (PID ${p.pid})`);
  fs.writeFileSync(archivo, JSON.stringify({ propietario: PROPIETARIO, pid: p.pid, inicio: vivo.inicio, linea: vivo.linea, puerto: puerto ?? null, lanzado: new Date().toISOString() }, null, 2));
  return p.pid;
}

export const escuchando = (puerto) => new Promise((ok) => { const s = net.connect({ port: puerto, host: "127.0.0.1" }); s.on("connect", () => { s.destroy(); ok(true); }); s.on("error", () => ok(false)); });

// CLI (usado también desde pila_consolidada.sh)
if (path.basename(process.argv[1] ?? "") === "procesos_propios.mjs") {
  const [cmd, archivo, ...resto] = process.argv.slice(2);
  if (cmd === "lanzar") {
    const sep = resto.indexOf("--"); const [cwd, log, puerto] = resto.slice(0, sep); const [ejecutable, ...args] = resto.slice(sep + 1);
    console.log(`lanzado PID ${lanzarPropio(archivo, { cwd, log, puerto: puerto ? Number(puerto) : null, ejecutable: ejecutable === "node" ? process.execPath : ejecutable, args })}`);
  } else if (cmd === "detener") {
    const r = detenerPropio(archivo); console.log(`${r.estado}: ${r.detalle}`);
    const puerto = Number(resto[0]); if (puerto && (await escuchando(puerto))) console.log(`AVISO: el puerto ${puerto} sigue ocupado por un proceso que NO es propio; no se toca.`);
  } else { console.error("uso: lanzar|detener"); process.exit(2); }
}
