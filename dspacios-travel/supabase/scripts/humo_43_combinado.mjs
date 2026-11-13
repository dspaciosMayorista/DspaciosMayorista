// HUMO + REVISIÓN VISUAL del árbol combinado (#43/#60 + lote) con la app de PRODUCCIÓN (`next start`) contra Supabase local desechable.
// Lo lanza humo_43_combinado.sh (base + PostgREST desechables, datos de los recorridos de las entregas 5 y 6 ya cargados por recorrido_43_e6).
// Piezas: (1) proxy «Supabase» en H_PUERTO_SB: GoTrue mínimo (/auth/v1/user) + PostgREST sin /rest/v1; (2) `next start` en H_PUERTO_APP;
// (3) proxy de NAVEGADOR en H_PUERTO_WEB que añade la cookie de sesión de operaciones (así las páginas internas se ven como un usuario
// real; sin ella, como visitante). Rutas clave: estado HTTP, sin errores 500 y textos esperados; capturas de Edge a 375 px y 1280 px.
import http from "node:http";
import { createHmac } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REST = new URL(process.env.H_REST), SECRETO = process.env.H_SECRETO, SALIDA = process.env.H_SALIDA;
const P_SB = Number(process.env.H_PUERTO_SB), P_APP = Number(process.env.H_PUERTO_APP), P_WEB = Number(process.env.H_PUERTO_WEB);
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ exp: 1924992000, ...p }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const SUB = "00000000-0000-4000-8000-000000009302";
const token = jwt({ role: "authenticated", sub: SUB, session_id: "00000000-0000-4000-8000-00000000a302", aud: "authenticated" });
const usuario = { id: SUB, aud: "authenticated", role: "authenticated", email: "t293-oper-may@x.test", app_metadata: {}, user_metadata: {} };

const sb = http.createServer((req, res) => {
  if (req.url.startsWith("/auth/v1/user")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(usuario)); return; }
  if (req.url.startsWith("/auth/v1/")) { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; }
  const ruta = req.url.replace(/^\/rest\/v1/, "") || "/";
  const p = http.request({ host: REST.hostname, port: REST.port, path: ruta, method: req.method, headers: { ...req.headers, host: REST.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
// Inactividad mayor que la del cliente (undici reutiliza el socket): con los 5 s por defecto Next recibe «other side closed».
sb.keepAliveTimeout = 65_000; sb.headersTimeout = 66_000;
await new Promise((ok) => sb.listen(P_SB, "127.0.0.1", ok));

const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: 1924992000, refresh_token: "x", user: usuario });
const cookie = `sb-127-auth-token=base64-${Buffer.from(sesion).toString("base64url")}`;
const web = http.createServer((req, res) => {
  const p = http.request({ host: "127.0.0.1", port: P_APP, path: req.url, method: req.method, headers: { ...req.headers, /* se conserva el Host del navegador: Next exige Origin = Host en las Server Actions */ cookie: [req.headers.cookie, cookie].filter(Boolean).join("; ") } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
web.keepAliveTimeout = 65_000; web.headersTimeout = 66_000;
await new Promise((ok) => web.listen(P_WEB, "127.0.0.1", ok));

const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(P_APP), "-H", "127.0.0.1"], {
  env: { ...process.env, NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=2048" }, stdio: ["ignore", "pipe", "pipe"] });
let logApp = "";
app.stdout.on("data", (d) => { logApp += d; }); app.stderr.on("data", (d) => { logApp += d; });
for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${P_APP}/login`, { redirect: "manual" }); if (r.status) break; } catch { /* aún no */ } await new Promise((ok) => setTimeout(ok, 500)); }

let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const RUTAS = [
  { ruta: "/login", sesion: false, espera: [200], textos: [] },
  { ruta: "/dashboard", sesion: false, espera: [307, 302], textos: [], nota: "sin sesión ⇒ redirige a /login (proxy.ts)" },
  { ruta: "/tarifario", sesion: false, espera: [200], textos: [] },
  { ruta: "/dashboard", sesion: true, espera: [200], textos: [] },
  { ruta: "/dashboard/producto/hoteles/9307", sesion: true, espera: [200], textos: ["Promociones"] },
  { ruta: "/dashboard/producto/hoteles/9301", sesion: true, espera: [200], textos: [] },
  { ruta: "/dashboard/paquetes/9601", sesion: true, espera: [200], textos: [] },
  { ruta: "/dashboard/paquetes", sesion: true, espera: [200], textos: [] },
  { ruta: "/dashboard/reservar", sesion: true, espera: [200], textos: [] },
  { ruta: "/dashboard/tarifario", sesion: true, espera: [200], textos: [] },
];
for (const r of RUTAS) {
  const base = r.sesion ? `http://127.0.0.1:${P_WEB}` : `http://127.0.0.1:${P_APP}`;
  try {
    const res = await fetch(base + r.ruta, { redirect: "manual" });
    const html = await res.text();
    const faltan = r.textos.filter((t) => !html.includes(t));
    ok(r.espera.includes(res.status) && !faltan.length && !/Application error|Internal Server Error/.test(html),
      `${r.sesion ? "con sesión" : "sin sesión"} ${r.ruta} → ${res.status}${r.nota ? ` (${r.nota})` : ""}${faltan.length ? ` · faltan: ${faltan.join(", ")}` : ""}`);
  } catch (e) { ok(false, `${r.ruta}: ${e.message}`); }
}

if (process.env.H_DIAG) {
  for (const [nombre, base] of [["sin sesión", P_APP], ["con sesión", P_WEB]]) {
    const html = await (await fetch(`http://127.0.0.1:${base}/tarifario`)).text();
    const n = (t) => (html.match(new RegExp(t, "g")) ?? []).length;
    console.log(`  diag /tarifario ${nombre}: ${html.length} bytes · «T293 PERSONA» ${n("T293 PERSONA")} · «R43» ${n("R43 ")} · «desde_entrada» ${n("desde_entrada")} · «precio_doble» ${n("precio_doble")}`);
  }
  console.log(`  diag registro next start (últimas líneas): ${logApp.split("\n").filter(Boolean).slice(-6).join(" | ").slice(0, 600)}`);
}
if (process.env.H_DIAG) {
  // Diagnóstico: cada recurso que la página pide al servidor, con su estado y tiempo (lo que un navegador esperaría antes de pintar).
  const html = await (await fetch(`http://127.0.0.1:${P_APP}${process.env.H_RUTA ?? "/login"}`)).text();
  const recursos = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]))].slice(0, 40);
  for (const r of recursos) {
    const t0 = Date.now();
    try { const res = await fetch(`http://127.0.0.1:${P_APP}${r}`, { signal: AbortSignal.timeout(10_000) }); await res.arrayBuffer(); console.log(`  diag ${res.status} ${Date.now() - t0} ms ${r.slice(0, 100)}`); }
    catch (e) { console.log(`  diag ERROR ${Date.now() - t0} ms ${r.slice(0, 100)} — ${e.name}`); }
  }
}

if (process.env.H_DIAG) {
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const perfil = path.join(SALIDA, `perfil-diag-${Date.now()}`);
  try {
    const r = spawn(edge, ["--headless=new", "--disable-gpu", "--dump-dom", "--timeout=15000", "--enable-logging=stderr", "--v=0", `--user-data-dir=${perfil}`, `http://127.0.0.1:${P_APP}${process.env.H_RUTA ?? "/login"}`]);
    let out = "", err = "";
    r.stdout.on("data", (d) => { out += d; }); r.stderr.on("data", (d) => { err += d; });
    await new Promise((ok) => { r.on("exit", ok); setTimeout(() => { r.kill(); ok(); }, 40_000); });
    console.log(`  diag DOM: ${out.length} caracteres · contiene «Ingresar»/«Contraseña»: ${/Ingresar|Contraseña|contraseña/.test(out)} · título: ${(out.match(/<title>([^<]*)/) ?? [])[1]}`);
    for (const l of err.split("\n").filter((l) => /CONSOLE|Uncaught|ERR_|Refused|blocked/i.test(l)).slice(0, 12)) console.log(`  diag consola: ${l.slice(0, 220)}`);
    fs.writeFileSync(path.join(SALIDA, "diag-dom.html"), out);
  } catch (e) { console.log(`  diag edge: ${e.message}`); }
}

// Capturas (Edge sin interfaz, desde PowerShell: desde Git Bash no deja PNG).
fs.mkdirSync(SALIDA, { recursive: true });
// Abre la pestaña «Porción terrestre» de la vitrina y devuelve la línea de la tarjeta con la estadía del «desde».
const ABRIR_PORCION = "(async () => { const b = [...document.querySelectorAll('button')].find((x) => /Porci.n terrestre/.test(x.textContent)); if (!b) return 'sin pestaña'; b.click(); await new Promise((r) => setTimeout(r, 3000)); const t = document.body.innerText.split('\\n'); const k = t.findIndex((l) => /noches · Entrada/.test(l)); return k < 0 ? 'sin línea de estadía' : t.slice(Math.max(0, k - 3), k + 1).join(' / '); })()";
const CAPTURAS = process.env.H_UNA ? [["una-375", process.env.H_RUTA ?? "/tarifario", 375, 1200]] : [
  ["tarifario-375", "/tarifario", 375, 1600], ["tarifario-porcion-375", "/tarifario", 375, 2200, ABRIR_PORCION], ["tarifario-porcion-1280", "/tarifario", 1280, 1600, ABRIR_PORCION],
  ["hotel-9307-promociones-375", "/dashboard/producto/hoteles/9307", 375, 2400], ["hotel-9307-promociones-1280", "/dashboard/producto/hoteles/9307", 1280, 1800],
  ["paquete-9601-375", "/dashboard/paquetes/9601", 375, 1800], ["dashboard-375", "/dashboard", 375, 1800], ["dashboard-1280", "/dashboard", 1280, 1400],
  ["paquetes-375", "/dashboard/paquetes", 375, 1800], ["reservar-375", "/dashboard/reservar", 375, 1800],
];
const { abrirEdge } = await import(new URL("./captura_cdp.mjs", import.meta.url).href);
const navegador = await abrirEdge(path.join(SALIDA, "perfil-cdp"));
for (const [nombre, ruta, w, h, accion] of CAPTURAS) {
  const png = path.join(SALIDA, `${nombre}.png`);
  try {
    const r = await navegador.capturar(`http://127.0.0.1:${P_WEB}${ruta}`, png, w, Math.max(h, 1200), 6000, accion ?? null);
    if (accion) { console.log(`      acción en ${nombre}: ${r.resultadoAccion}`); if (/porcion/.test(nombre)) ok(/550\.000/.test(String(r.resultadoAccion)) && /5 noches · Entrada 04\/01\/2027/.test(String(r.resultadoAccion)) && !/500\.000/.test(String(r.resultadoAccion)),`la tarjeta de porción en la app muestra «${r.resultadoAccion}»`); }
    ok(fs.existsSync(png) && fs.statSync(png).size > 5000 && !r.desbordaHorizontal && r.errores.length === 0,
      `captura ${nombre} (${w}px, alto ${r.alto}px${r.desbordaHorizontal ? `, DESBORDA a ${r.anchoReal}px` : ", sin desborde horizontal"}${r.errores.length ? `, errores JS: ${r.errores.join(" | ").slice(0, 160)}` : ""})`);
  } catch (e) { ok(false, `captura ${nombre}: ${e.message}`); }
}
navegador.cerrar();

const errores = logApp.split("\n").filter((l) => /\b(Error|TypeError|ReferenceError|⨯)\b/.test(l) && !/fetch failed|ECONNREFUSED/.test(l));
fs.writeFileSync(path.join(SALIDA, "next-start.log"), logApp);
ok(errores.length === 0, `registro de next start sin errores del servidor${errores.length ? ": " + errores.slice(0, 3).join(" | ") : ""}`);
app.kill(); sb.close(); web.close();
console.log(`\n=== ${fallos} fallo(s) · capturas en ${SALIDA}`);
process.exit(fallos ? 1 : 0);
