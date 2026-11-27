// R3 — PANTALLAS COMPILADAS y DOCUMENTOS/PDF sobre el build de producción (`next start`) con la base y el PostgREST DESECHABLES del recorrido real (pruebas/r2Acciones95.pg.ts).
// Sin GoTrue: una pasarela local mínima atiende /auth/v1/user (verifica el JWT firmado con el secreto fijo) y reenvía /rest/v1 a PostgREST. Roles REALES (usuarios + RLS de la base): superadmin, administración, venta.
// Lo lanza supabase/scripts/test_r2_95_acciones.sh con R2_DESPUES="node supabase/scripts/r3_pantallas/pantallas.mjs" (R2_SECRETO / R2_PUERTO_REST = los de claves.mjs). Solo local.
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { SECRETO, PUERTO_PASARELA, PUERTO_APP, URL_SUPABASE, ANON, SERVICIO, jwt } from "./claves.mjs";
import { createHmac } from "node:crypto";

const REST = process.env.R2_REST_URL, DB = process.env.R2_DB, CT = process.env.R2_CT;
if (!REST || !DB || !CT) throw new Error("Faltan R2_REST_URL / R2_DB / R2_CT: lánzalo desde supabase/scripts/test_r2_95_acciones.sh (R2_DESPUES).");
const SALIDA = process.env.R3_SALIDA ?? path.resolve("docs/tecnico/evidencia-r3-95-2026-11-23/pantallas");
mkdirSync(SALIDA, { recursive: true });
const APP = `http://127.0.0.1:${PUERTO_APP}`;
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
// Usuarios de la prueba (el recorrido real ya creó superadmin/administración; `venta` se agrega aquí, con el nombre del asesor de los contratos para que sea el dueño).
sql(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000950004', 'venta95@x.test') on conflict do nothing;
     insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000950004', 'venta95@x.test', 'Asesor 95', 'venta', true, 'mayorista')
     on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, nombre = excluded.nombre;`);
// Identidad fiscal SINTÉTICA de la agencia (solo en la base desechable): sin RNT los documentos se niegan a imprimirse (regla #49). Nunca los datos reales.
sql(`update public.agencias set razon_social = coalesce(nullif(razon_social, ''), 'Agencia de Prueba SAS'), nombre_comercial = coalesce(nullif(nombre_comercial, ''), 'Agencia de Prueba'), nit = coalesce(nullif(nit, ''), '800123456'), dv = coalesce(nullif(dv, ''), '7'),
       rnt = 'RNT-PRUEBA-1', correo = coalesce(nullif(correo, ''), 'prueba@agencia.test'), banco = coalesce(nullif(banco, ''), 'Banco de Prueba'), tipo_cuenta = coalesce(nullif(tipo_cuenta, ''), 'Cuenta de prueba'), numero_cuenta = coalesce(nullif(numero_cuenta, ''), '000-000000-00'),
       ciudad = coalesce(nullif(ciudad, ''), 'Ciudad de Prueba') where tenant = 'mayorista'`);
const resultados = []; let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); resultados.push({ ok: !!c, m }); if (!c) fallos++; };

// ── pasarela local ────────────────────────────────────────────────────────
function verificar(tok) {
  const [h, p, s] = String(tok).split(".");
  if (!h || !p || !s) return null;
  if (createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  return Number(c.exp) * 1000 > Date.now() ? c : null;
}
let solicitudesRest = 0;
const pasarela = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (url.startsWith("/auth/v1/user")) {
    const c = verificar((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!c || c.role !== "authenticated") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ code: 401, msg: "invalid JWT" })); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: c.sub, aud: "authenticated", role: "authenticated", email: c.email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }));
    return;
  }
  if (url.startsWith("/rest/v1/")) {
    solicitudesRest++;
    const destino = new URL(url.slice("/rest/v1".length), REST);
    const headers = { ...req.headers }; delete headers.host;
    const up = http.request(destino, { method: req.method, headers, agent: false }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
    return;
  }
  res.writeHead(404); res.end();
});
pasarela.keepAliveTimeout = 65_000; pasarela.headersTimeout = 66_000;
await new Promise((r) => pasarela.listen(PUERTO_PASARELA, "127.0.0.1", r));

// ── aplicación compilada ──────────────────────────────────────────────────
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PUERTO_APP), "-H", "127.0.0.1"], {
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=1024", NEXT_PUBLIC_SUPABASE_URL: URL_SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICIO, CRON_SECRET: "cron-r3-local" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logApp = ""; app.stdout.on("data", (d) => (logApp += d)); app.stderr.on("data", (d) => (logApp += d));
async function esperarApp() { for (let i = 0; i < 90; i++) { try { const r = await fetch(`${APP}/login`); if (r.status < 500) return; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 1000)); } throw new Error("la aplicación compilada no arrancó:\n" + logApp.slice(-800)); }
const cerrar = async () => { try { writeFileSync(path.join(SALIDA, "app_next_start_log.txt"), logApp.slice(-20000)); } catch { /* sin log */ } try { app.kill(); } catch { /* ya */ } pasarela.closeAllConnections(); pasarela.close(); };
process.on("exit", () => { try { app.kill(); } catch { /* ya */ } });

// ── sesiones por rol ──────────────────────────────────────────────────────
const USUARIOS = { superadmin: { id: "00000000-0000-0000-0000-000000950001", email: "super95@x.test" }, administracion: { id: "00000000-0000-0000-0000-000000950002", email: "admin95@x.test" }, venta: { id: "00000000-0000-0000-0000-000000950004", email: "venta95@x.test" } };
function cookiesDe(rol) {
  const u = USUARIOS[rol];
  const token = jwt({ role: "authenticated", aud: "authenticated", sub: u.id, email: u.email, session_id: u.id.replace(/^00000000/, "5e550000") });
  const sesion = { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: 1999999000, refresh_token: "r3-local", user: { id: u.id, aud: "authenticated", role: "authenticated", email: u.email } };
  const valor = "base64-" + Buffer.from(JSON.stringify(sesion)).toString("base64url");
  const trozos = valor.match(/.{1,3180}/g);
  return trozos.map((t, i) => ({ name: trozos.length === 1 ? "sb-127-auth-token" : `sb-127-auth-token.${i}`, value: t, domain: "127.0.0.1", path: "/" }));
}
const VISTAS = { escritorio: { width: 1366, height: 900 }, movil: { width: 390, height: 844 } };
async function abrir(browser, rol, vista) {
  const ctx = await browser.newContext({ viewport: VISTAS[vista], isMobile: vista === "movil", hasTouch: vista === "movil", locale: "es-CO", acceptDownloads: true });
  await ctx.addCookies(cookiesDe(rol));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
  return { ctx, page };
}
const texto = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
const paginasPdf = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

try {
  await esperarApp();
  console.log("aplicación compilada lista en", APP);
  // contratos del recorrido real (por escenario/opción): precio y plan_nombre los identifican
  const fila = (q) => { const v = sql(q).split("|"); return { numero: v[0], hija: v[1], precio: v[2] }; };
  const C = {
    imparA: fila(`select numero_contrato, cotizacion_id, precio_venta from public.ventas where precio_venta = 1330455 and plan_nombre like 'Hotel A%' and tipo_paquete = 'dinamico' order by numero_contrato limit 1`),
    imparB: fila(`select numero_contrato, cotizacion_id, precio_venta from public.ventas where precio_venta = 1580455 and plan_nombre like 'Hotel B%' and moneda = 'COP' order by numero_contrato limit 1`),
    usdB: fila(`select numero_contrato, cotizacion_id, precio_venta from public.ventas where moneda = 'USD' and precio_venta = 1582.55 order by numero_contrato limit 1`),
    parA: fila(`select numero_contrato, cotizacion_id, precio_venta from public.ventas where precio_venta = 1330000 and plan_nombre like 'Hotel A%' order by numero_contrato limit 1`),
  };
  console.log("contratos:", JSON.stringify(C));
  ok(Object.values(C).every((c) => c.numero), "los 4 contratos del recorrido real existen");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const pdfs = [];

  // ── 1. documento del cliente: pantalla + PDF por contrato y vista ─────────
  for (const [clave, c] of Object.entries(C)) {
    for (const vista of ["escritorio", "movil"]) {
      const { ctx, page } = await abrir(browser, "superadmin", vista);
      const r = await page.goto(`${APP}/contrato/${encodeURIComponent(c.numero)}`, { waitUntil: "networkidle" });
      ok(r?.status() === 200, `${clave}/${vista}: /contrato/${c.numero} responde 200 (${r?.status()})`);
      const t = await texto(page);
      const precio = Number(c.precio);
      const esUsd = clave === "usdB";
      const esperado = esUsd ? `USD $${precio.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${precio.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`;
      ok(t.replace(/\$\s+/g, "$").toLowerCase().includes(`total del contrato ${esperado}`.toLowerCase()), `${clave}/${vista}: «Total del contrato ${esperado}» exacto en la pantalla compilada`);
      ok(await sinDesborde(page), `${clave}/${vista}: sin desbordamiento horizontal`);
      const png = path.join(SALIDA, `contrato_${clave}_${vista}.png`);
      await page.screenshot({ path: png, fullPage: true });
      if (vista === "escritorio") {
        await page.emulateMedia({ media: "print" });
        const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
        const f = path.join(SALIDA, `contrato_${clave}.pdf`); writeFileSync(f, pdf);
        pdfs.push({ f, paginas: paginasPdf(pdf) });
        ok(paginasPdf(pdf) >= 1, `${clave}: PDF generado (${paginasPdf(pdf)} páginas) → ${path.basename(f)}`);
      }
      await ctx.close();
    }
  }
  // ── 2. cotización elegida (hija): PDF y pantalla ──────────────────────────
  for (const clave of ["imparA", "usdB"]) {
    const c = C[clave];
    const { ctx, page } = await abrir(browser, "superadmin", "escritorio");
    const r = await page.goto(`${APP}/cotizacion/${c.hija}`, { waitUntil: "networkidle" });
    ok(r?.status() === 200, `cotización ${clave}: /cotizacion/${c.hija} responde 200`);
    await page.screenshot({ path: path.join(SALIDA, `cotizacion_${clave}.png`), fullPage: true });
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
    const f = path.join(SALIDA, `cotizacion_${clave}.pdf`); writeFileSync(f, pdf); pdfs.push({ f, paginas: paginasPdf(pdf) });
    await ctx.close();
  }
  // ── 3. ficha del contrato → Cartera → plan de cobro (acción real compilada), por rol y vista ─────────
  for (const [rol, vista] of [["superadmin", "escritorio"], ["administracion", "escritorio"], ["superadmin", "movil"], ["venta", "escritorio"]]) {
    const c = C.imparB;
    const { ctx, page } = await abrir(browser, rol, vista);
    const r = await page.goto(`${APP}/dashboard/contratos/${encodeURIComponent(c.numero)}`, { waitUntil: "networkidle" });
    ok(r?.status() === 200, `ficha ${rol}/${vista}: responde 200`);
    await page.getByRole("tab", { name: "Cartera" }).click().catch(() => {});
    await page.waitForTimeout(400);
    const antes = await texto(page);
    const boton = page.getByRole("button", { name: /Generar plan de cobro|Regenerar plan/ });
    if (rol === "venta") {
      // `venta` consulta un contrato de OTRO asesor de su agencia o el propio: se registra lo que ve (el botón solo si puede escribir el plan).
      ok(true, `ficha venta/${vista}: botón de plan visible = ${await boton.count() > 0} (la RLS de cuotas decide la escritura)`);
    } else {
      ok(await boton.count() > 0, `ficha ${rol}/${vista}: hay botón de plan de cobro`);
      const rest0 = solicitudesRest;
      await boton.first().click();
      await page.waitForFunction(() => /Regenerar plan/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      const t = await texto(page);
      const filasDb = sql(`select count(*) || '|' || coalesce(sum(monto), 0)::numeric(15,0) from public.cuotas where numero_contrato = '${c.numero}'`).split("|");
      ok(Number(filasDb[0]) >= 1 && filasDb[1] === "1580455", `ficha ${rol}/${vista}: el plan quedó guardado (${filasDb[0]} filas, suma ${filasDb[1]} = precio exacto)`);
      ok(/Regenerar plan/.test(t), `ficha ${rol}/${vista}: la pantalla muestra «Regenerar plan» tras generarlo`);
      ok(await sinDesborde(page), `ficha ${rol}/${vista}: sin desbordamiento horizontal`);
      console.log(`  solicitudes REST locales durante la regeneración (${rol}/${vista}): ${solicitudesRest - rest0}`);
      void antes;
    }
    await page.screenshot({ path: path.join(SALIDA, `ficha_cartera_${rol}_${vista}.png`), fullPage: true });
    await ctx.close();
  }
  // ── 4. dos navegadores regeneran el plan al mismo tiempo (pantalla compilada) → un solo plan ─────────
  {
    const c = C.imparB;
    const a = await abrir(browser, "superadmin", "escritorio"), b = await abrir(browser, "administracion", "escritorio");
    for (const x of [a, b]) { await x.page.goto(`${APP}/dashboard/contratos/${encodeURIComponent(c.numero)}`, { waitUntil: "networkidle" }); await x.page.getByRole("tab", { name: "Cartera" }).click().catch(() => {}); }
    await Promise.all([a, b].map((x) => x.page.getByRole("button", { name: /Generar plan de cobro|Regenerar plan/ }).first().click()));
    await a.page.waitForTimeout(2500);
    const n1 = sql(`select count(*) || '|' || count(distinct orden) || '|' || sum(monto)::numeric(15,0) from public.cuotas where numero_contrato = '${c.numero}'`).split("|");
    ok(n1[0] === n1[1] && n1[2] === "1580455", `dos navegadores a la vez → UN plan (${n1[0]} filas, ${n1[1]} órdenes distintos, suma ${n1[2]})`);
    await a.ctx.close(); await b.ctx.close();
  }
  await browser.close();
  writeFileSync(path.join(SALIDA, "resultado.json"), JSON.stringify({ contratos: C, pdfs: pdfs.map((p) => ({ archivo: path.basename(p.f), paginas: p.paginas })), solicitudesRestTotal: solicitudesRest, resultados, fallos }, null, 2));
  console.log(`PDF: ${pdfs.map((p) => `${path.basename(p.f)}=${p.paginas}p`).join(" · ")}`);
} catch (e) {
  console.log("ERROR", e);
  fallos++;
} finally {
  await cerrar();
}
console.log(`=== pantallas R3: ${resultados.filter((r) => r.ok).length} OK, ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
