// MEDICIÓN del recorrido «aplicar a la venta por grupos» (#43/#60 3c) con el CÓDIGO REAL de las acciones
// (grupos-actions → RPC → revalidatePath → regenerarTarifariosDeHotelAcotado → generarTarifario) contra una base
// LOCAL desechable y su PostgREST (lo lanza medir_299_recorrido.sh). Solo se sustituyen `next/headers` (la cookie
// de sesión, armada como @supabase/ssr), `next/cache` (para contar recargas) y `server-only`.
// Un proxy delante de PostgREST cuenta cada consulta interna (tabla o RPC), su duración y la concurrencia máxima.
// Lo que hace el NAVEGADOR no pasa por aquí: una Server Action = 1 POST cuya respuesta trae también la página
// revalidada (revalidatePath) — ver el informe.
import http from "node:http";
import { createHmac } from "node:crypto";
import nodeModule from "node:module";

const REST = process.env.M299_REST, SECRETO = process.env.M299_SECRETO;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const SUB = "00000000-0000-4000-8000-000000009302";
const token = jwt({ role: "authenticated", sub: SUB, session_id: "00000000-0000-4000-8000-00000000a302", aud: "authenticated" });

// ── Proxy contador ─────────────────────────────────────────────────────────────────────────────────────
const destino = new URL(REST);
let consultas = [], enVuelo = 0, maxEnVuelo = 0;
const proxy = http.createServer((req, res) => {
  const ruta = req.url.replace(/^\/rest\/v1/, "") || "/";
  const t0 = performance.now(); enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
  const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers: { ...req.headers, host: destino.host } }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
    r.on("end", () => { enVuelo--; consultas.push({ que: `${req.method} ${ruta.split("?")[0]}`, ms: performance.now() - t0, status: r.statusCode }); });
  });
  p.on("error", (e) => { enVuelo--; res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
const URLP = `http://127.0.0.1:${proxy.address().port}`;
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: URLP, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) });
delete process.env.CRON_SECRET; delete process.env.MANTENIMIENTO_CLAVE;

// ── Sustitutos mínimos de Next ─────────────────────────────────────────────────────────────────────────
const ref = "127";   // @supabase/ssr: sb-<primer segmento del host>-auth-token
const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: SUB, aud: "authenticated", role: "authenticated" } });
const cookie = { name: `sb-${ref}-auth-token`, value: "base64-" + Buffer.from(sesion).toString("base64url") };
globalThis.__m299 = { revalida: [], cookie };
const datos = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const { registerHooks } = nodeModule;
registerHooks({ resolve(s, c, n) {
  if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
  if (s === "next/headers") return { url: datos("export async function cookies(){ const c = globalThis.__m299.cookie; return { getAll: () => [c], get: (n) => (n === c.name ? c : undefined), set(){} }; } export async function headers(){ return new Map(); }"), shortCircuit: true };
  if (s === "next/cache") return { url: datos("export function revalidatePath(p){ globalThis.__m299.revalida.push(p) } export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
  // Next resuelve imports relativos sin extensión; Node no: se prueba .ts, .tsx y /index.ts.
  if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* siguiente */ } }
  }
  return n(s, c);
} });

const acc = await import("../../app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");

async function medir(nombre, fn) {
  consultas = []; maxEnVuelo = 0; globalThis.__m299.revalida.length = 0;
  const cpu0 = process.cpuUsage(), t0 = performance.now();
  const r = await fn();
  const ms = performance.now() - t0, cpu = process.cpuUsage(cpu0);
  const porTipo = {};
  for (const q of consultas) { porTipo[q.que] ??= { n: 0, ms: 0 }; porTipo[q.que].n++; porTipo[q.que].ms += q.ms; }
  console.log(`\n### ${nombre}`);
  console.log(`  resultado: ${r.ok ? "ok" : "FALLO: " + r.error}${r.regeneracion ? " · regeneración " + JSON.stringify(r.regeneracion) : ""}`);
  console.log(`  tiempo total ${ms.toFixed(0)} ms · CPU del proceso Node ${((cpu.user + cpu.system) / 1000).toFixed(0)} ms (user ${(cpu.user / 1000).toFixed(0)} + sys ${(cpu.system / 1000).toFixed(0)})`);
  console.log(`  consultas internas a la base: ${consultas.length} (concurrencia máx. ${maxEnVuelo}; ${consultas.reduce((a, q) => a + q.ms, 0).toFixed(0)} ms sumados) · revalidatePath: ${globalThis.__m299.revalida.length}`);
  for (const [k, v] of Object.entries(porTipo).sort((a, b) => b[1].n - a[1].n)) console.log(`    ${String(v.n).padStart(3)} × ${k}  (${v.ms.toFixed(0)} ms)`);
  return r;
}

const escenario = process.argv[2] ?? "varios";
const temporada = Number(process.argv[3] ?? 930101);
if (process.argv[4] === "publicar-antes") {
  // Regeneración que SÍ publica (el hotel todavía no se vende por grupos): mide su costo real con el mismo código acotado.
  const paq = await import("../../app/(dashboard)/dashboard/paquetes/actions.ts");
  await medir("regenerar ANTES de aplicar (sin grupos activos: publica)", async () => ({ ok: true, regeneracion: await paq.regenerarTarifariosDeHotelAcotado(9301) }));
}
const al = await medir(`revisar (alcance) · vigencia ${temporada}`, () => acc.leerAlcanceGrupos(temporada));
if (!al.ok) { console.log(al.error); process.exit(1); }
const { planActivacion, payloadHabilitaciones } = await import("../../lib/hoteles/activacionGrupos.ts");
const plan = planActivacion(al.alcance);
if (plan.bloqueos.length) { console.log("bloqueos:", plan.bloqueos); process.exit(1); }
const r = await medir(`aplicar a la venta · ${escenario}`, () => acc.aplicarGruposVenta(temporada, al.alcance.huella, payloadHabilitaciones(plan, new Set(plan.habilitaciones.map((h) => h.clave)))));
proxy.close();
process.exit(r.ok ? 0 : 1);
