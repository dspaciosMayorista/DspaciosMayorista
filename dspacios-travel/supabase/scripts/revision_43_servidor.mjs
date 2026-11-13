// REVISIÓN VISUAL DEL DUEÑO (árbol combinado #43/#60 + lote). Lo lanza `revision_43_combinado.sh servir`. SOLO LOCAL.
// (1) Gateway «Supabase» en 127.0.0.1:V_PUERTO_SB (la URL incrustada en el build): /auth/v1 → GoTrue real, /rest/v1 → PostgREST.
// (2) `next start` del build existente en 127.0.0.1:V_PUERTO_APP, con la guardia de red de local4360 (todo lo no loopback se rechaza).
// Ctrl+C (o matar el proceso) detiene ambos.
import http from "node:http";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const P_SB = Number(process.env.V_PUERTO_SB), P_APP = Number(process.env.V_PUERTO_APP);
const destinos = [["/auth/v1", new URL(process.env.V_AUTH)], ["/rest/v1", new URL(process.env.V_REST)]];

// CORS como el plugin de Kong en Supabase: el navegador (app en otro puerto) llama a Auth/REST directamente.
const cors = (req) => ({ "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-credentials": "true", vary: "Origin",
  "access-control-expose-headers": "content-range, x-total-count, x-supabase-api-version" });
const gw = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors(req), "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*", "access-control-max-age": "3600" });
    res.end(); return;
  }
  const d = destinos.find(([pref]) => req.url === pref || req.url.startsWith(pref + "/") || req.url.startsWith(pref + "?"));
  if (!d) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"message":"no disponible en la revisión local"}'); return; }
  const [pref, u] = d;
  const p = http.request({ host: u.hostname, port: u.port, path: req.url.slice(pref.length) || "/", method: req.method, headers: { ...req.headers, host: u.host } },
    (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors(req) }); r.pipe(res); });
  p.on("error", (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
// Inactividad mayor que la del cliente (undici reutiliza el socket): con los 5 s por defecto Next recibe «other side closed».
gw.keepAliveTimeout = 65_000; gw.headersTimeout = 66_000;
await new Promise((ok) => gw.listen(P_SB, "127.0.0.1", ok));
console.log(`gateway Supabase local en http://127.0.0.1:${P_SB}`);

const registro = path.join(os.tmpdir(), "revision43_red_bloqueada.log");
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(P_APP), "-H", "127.0.0.1"], {
  env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", QUICK_LOGIN_ENABLED: "0", NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${P_APP}`,
    LOCAL4360_REGISTRO_RED: registro, NODE_OPTIONS: `--require "${process.env.V_GUARDIA.replace(/\\/g, "/")}" --max-old-space-size=2048` },
  stdio: "inherit" });
console.log(`app (next start) en http://127.0.0.1:${P_APP} · intentos de red externa bloqueados → ${registro}`);
const fin = () => { try { app.kill(); } catch { /* ya cerrado */ } gw.close(); process.exit(0); };
process.on("SIGINT", fin); process.on("SIGTERM", fin);
app.on("exit", (c) => { console.log(`next start terminó (código ${c})`); gw.close(); process.exit(c ?? 1); });
