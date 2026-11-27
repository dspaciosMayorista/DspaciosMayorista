// ENSAYO de la guía de revisión consolidada sobre una COPIA desechable (REV_ENSAYO=1 node revision.mjs ensayo-crear / ensayo-iniciar). Ejecuta cada paso de pasos/*.mjs con el navegador REAL (Edge, Playwright),
// iniciando sesión por el formulario normal de /login con las cuentas de la revisión (una sesión aislada por rol), y comprueba el resultado ESPERADO de cada paso (pantalla y/o base). Nunca toca la base del dueño:
// se niega a correr si la base activa no es la copia de ensayo.
//   node supabase/scripts/revision_consolidada/ensayo.mjs [--solo ID,ID] [--entrega bloque3] [--salida carpeta]
// Un módulo de pasos exporta `pasos`: arreglo de { id, entrega, rol, titulo, ruta, accion, esperado, solo_lectura?, verificar: async (c) => void } (ver pasos/README.md).
import { chromium } from "../../../node_modules/@playwright/test/index.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = import.meta.dirname;
const CFG = path.join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const cfg = JSON.parse(fs.readFileSync(path.join(CFG, "config.json"), "utf8"));
const APP = `http://localhost:${cfg.puertos.app}`;
const DOMINIO = "consolidada.test", CLAVE = "Consolidada2026!";
const DB = "rev_consolidada_ensayo";
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const SOLO = arg("--solo")?.split(","), ENTREGA = arg("--entrega"), DESDE = arg("--desde");
const MEM_MIN_MB = Number(arg("--mem-min") ?? 900), MAX_CTX = 2;
const libreMB = () => Math.round(os.freemem() / 1048576);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SALIDA = arg("--salida") ?? path.join(CFG, "ensayo", new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12));
fs.mkdirSync(SALIDA, { recursive: true });

function sql(q) {
  const r = spawnSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pgrevc", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`SQL: ${(r.stderr || r.stdout).slice(0, 400)}`);
  return r.stdout.trim();
}
// El ensayo SOLO corre sobre la copia: el contenedor debe tener la copia y la app debe estar sirviendo esa base (la pila la recibe por PILA_DB; se comprueba que existe y que la base del dueño no se usa).
const sirve = spawnSync("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", "consrev_rest"], { encoding: "utf8" }).stdout;
if (!/rev_consolidada_ensayo/.test(sirve)) { console.error("NO: la pila no está sirviendo rev_consolidada_ensayo (usa REV_ENSAYO=1 node revision.mjs ensayo-crear y ensayo-iniciar)."); process.exit(2); }

const resultados = [];
const check = (paso, nombre, ok, detalle = "") => { resultados.push({ paso, nombre, ok: !!ok, detalle: String(detalle).slice(0, 400) }); console.log(`  ${ok ? "OK   " : "FALLA"} ${nombre}${ok ? "" : ` · ${String(detalle).slice(0, 300)}`}`); };

const ARGS_NAV = ["--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--disable-component-update", "--no-first-run", "--js-flags=--max-old-space-size=384"];
const lanzar = () => chromium.launch({ channel: "msedge", headless: true, args: ARGS_NAV });
let navegador = await lanzar();
const contextos = new Map();
/** Cierra TODAS las sesiones y el navegador y lo vuelve a abrir (se llama al cambiar de entrega). Las cuentas se reabren por el login real cuando un paso las pida. */
async function reiniciarNavegador() {
  for (const { ctx } of contextos.values()) await ctx.close().catch(() => {});
  contextos.clear(); await navegador.close().catch(() => {}); navegador = await lanzar();
}
async function sesion(alias) {
  if (!alias) return null;
  if (contextos.has(alias)) { const v = contextos.get(alias); contextos.delete(alias); contextos.set(alias, v); return v; }   // más reciente al final (LRU)
  while (contextos.size >= MAX_CTX) { const [viejo, v] = contextos.entries().next().value; await v.ctx.close().catch(() => {}); contextos.delete(viejo); }
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CO", timezoneId: "America/Bogota" });
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.fill('input[name="email"]', `${alias}@${DOMINIO}`); await page.fill('input[name="password"]', CLAVE);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => null), page.click('button[type="submit"]')]);
  await page.waitForTimeout(800);
  const dest = new URL(page.url()).pathname;
  await page.close();
  contextos.set(alias, { ctx, entrada: dest });
  return contextos.get(alias);
}

const modulos = fs.readdirSync(path.join(AQUI, "pasos")).filter((f) => f.endsWith(".mjs")).sort();
let pasos = [];
for (const m of modulos) pasos = pasos.concat((await import(`file:///${path.join(AQUI, "pasos", m).replace(/\\/g, "/")}`)).pasos ?? []);
if (SOLO) pasos = pasos.filter((p) => SOLO.includes(p.id)); if (ENTREGA) pasos = pasos.filter((p) => p.entrega === ENTREGA);
if (DESDE) { const i = pasos.findIndex((p) => p.id === DESDE); if (i < 0) { console.error(`--desde: no existe el paso ${DESDE}`); process.exit(2); } pasos = pasos.slice(i); }
console.log(`Ensayo sobre ${DB} · ${pasos.length} pasos · salida ${SALIDA}`);

const ANCHOS = [[1280, "escritorio"], [768, "intermedio"], [390, "movil390"]];
const informeParcial = (extra = {}) => fs.writeFileSync(path.join(SALIDA, "informe.json"), JSON.stringify({ base: DB, fecha: new Date().toISOString(), desde: DESDE ?? null, parcial: true, total: resultados.length, fallas: resultados.filter((r) => !r.ok).length, ...extra, resultados }, null, 1));
let entregaActual = null;
for (const p of pasos) {
  if (resultados.length) informeParcial();
  console.log(`  [mem libre ${libreMB()} MB]`);
  if (entregaActual !== null && p.entrega !== entregaActual) await reiniciarNavegador();
  entregaActual = p.entrega;
  // Compuerta de memoria: no se arranca un paso con la máquina al límite. Si no se recupera, se detiene limpio (nada a medias dentro de un paso) y se reanuda con --desde en la misma copia.
  for (let i = 0; i < 40 && libreMB() < MEM_MIN_MB; i++) { if (i === 0) console.log(`  (memoria libre ${libreMB()} MB < ${MEM_MIN_MB}: espero antes de ${p.id})`); await dormir(15000); }
  if (libreMB() < MEM_MIN_MB) { informeParcial({ detenidoPorMemoria: p.id }); console.log(`\nDETENIDO por memoria antes de ${p.id} (libre ${libreMB()} MB). Informe parcial guardado. Reanuda con: --desde ${p.id} (misma copia, sin recrearla).`); await navegador.close().catch(() => {}); process.exit(3); }
  console.log(`\n[${p.id}] ${p.entrega} · ${p.rol ?? "público"} · ${p.titulo}`);
  const variantes = p.solo_lectura ? ANCHOS : [ANCHOS[0]];
  for (const [ancho, etiqueta] of variantes) {
    let page = null, ctxTemporal = null;   // el contexto de un paso público (sin sesión) se cierra al terminar: antes se acumulaba uno por paso y ancho
    try {
      const s = await sesion(p.rol);
      const ctx = s ? s.ctx : (ctxTemporal = await navegador.newContext({ viewport: { width: ancho, height: 900 }, locale: "es-CO", timezoneId: "America/Bogota" }));
      page = await ctx.newPage(); await page.setViewportSize({ width: ancho, height: 900 });
      const errores = []; page.on("pageerror", (e) => errores.push(String(e).slice(0, 200)));
      const etq = variantes.length > 1 ? ` [${etiqueta}]` : "";
      const c = {
        page, sql, APP, ancho, alias: p.rol, cuentas: `@${DOMINIO}`, clave: CLAVE,
        check: (nombre, ok, detalle) => check(p.id, nombre + etq, ok, detalle),
        ir: async (ruta) => { await page.goto(ruta.startsWith("http") ? ruta : `${APP}${ruta}`, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(600); },
        texto: () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")),
        espera: (ms) => page.waitForTimeout(ms),
        // Página nueva con la sesión de OTRA cuenta (p. ej. el contrato lo crea «venta» y lo gestiona «administracion»); quien la pide la cierra.
        paginaDe: async (alias) => { const o = await sesion(alias); const pg = await o.ctx.newPage(); pg.on("dialog", (d) => d.accept().catch(() => {})); return pg; },
        sinDesborde: () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
        foto: async (n) => { await page.screenshot({ path: path.join(SALIDA, `${p.id}_${n}_${etiqueta}.png`), fullPage: true }); },
        errores,
      };
      await p.verificar(c);
      if (p.solo_lectura && !(p.desborde === false && ancho === 768)) c.check("sin desborde horizontal", await c.sinDesborde(), "");
      c.check("sin errores de página", errores.length === 0, errores.join(" | "));
    } catch (e) { check(p.id, `el paso terminó sin excepción [${etiqueta}]`, false, e.stack ?? e.message); }
    finally { try { await page?.close(); } catch { /* ya cerrada */ } try { await ctxTemporal?.close(); } catch { /* ya cerrado */ } }
  }
}
await navegador.close();
const mal = resultados.filter((r) => !r.ok);
fs.writeFileSync(path.join(SALIDA, "informe.json"), JSON.stringify({ base: DB, fecha: new Date().toISOString(), total: resultados.length, fallas: mal.length, resultados }, null, 1));
console.log(`\n${resultados.length - mal.length}/${resultados.length} comprobaciones OK${mal.length ? ` · FALLAN ${mal.length}: ${mal.map((r) => `${r.paso}: ${r.nombre}`).join("; ")}` : ""}\nInforme: ${path.join(SALIDA, "informe.json")}`);
process.exit(mal.length ? 1 : 0);
