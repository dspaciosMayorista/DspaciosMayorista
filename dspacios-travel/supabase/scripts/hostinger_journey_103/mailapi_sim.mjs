// Simulated Hostinger Mail API (local only, loopback). Mirrors the contract the adapter uses: list / search (POST, uid range) / detail / text. Control surface under /__ctl.
// It records every request (method, path, Authorization present/value-check, timing) so the journey can measure the real call pattern of the compiled app.
import fs from "node:fs";
import http from "node:http";
const PORT = Number(process.argv[2] ?? 19086), BUZON = process.argv[3] ?? "ACwalk0000test1", TOKEN = process.argv[4] ?? "walk-api-token-not-real", ESTADO = process.argv[5] ?? null;   // optional state file: the simulated mailbox survives a restart (owner review)
const st = { mensajes: [], textos: {}, fallos: [], latenciaMs: 0, log: [], inflight: 0, maxInflight: 0 };
if (ESTADO && fs.existsSync(ESTADO)) { try { const j = JSON.parse(fs.readFileSync(ESTADO, "utf8")); st.mensajes = j.mensajes ?? []; st.textos = j.textos ?? {}; } catch { /* unreadable state: start empty */ } }
const guardar = () => { if (ESTADO) fs.writeFileSync(ESTADO, JSON.stringify({ mensajes: st.mensajes, textos: st.textos })); };
const leer = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => res(b)); });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (res, status, body, h = {}) => { res.writeHead(status, { "content-type": "application/json", ...h }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), ruta = u.pathname;
  if (ruta.startsWith("/__ctl/")) {
    const b = JSON.parse((await leer(req)) || "{}");
    if (ruta === "/__ctl/mensajes") { st.mensajes = b.mensajes; st.textos = b.textos ?? {}; guardar(); return send(res, 200, { n: st.mensajes.length }); }
    if (ruta === "/__ctl/agregar") { st.mensajes.push(...b.mensajes); Object.assign(st.textos, b.textos ?? {}); guardar(); return send(res, 200, { n: st.mensajes.length }); }
    if (ruta === "/__ctl/fallos") { st.fallos = (b.fallos ?? []).map((f) => ({ patron: new RegExp(f.patron), secuencia: [...f.secuencia] })); return send(res, 200, { fallos: st.fallos.length }); }
    if (ruta === "/__ctl/latencia") { st.latenciaMs = b.ms ?? 0; return send(res, 200, { ms: st.latenciaMs }); }
    if (ruta === "/__ctl/reset-log") { st.log = []; st.maxInflight = 0; return send(res, 200, {}); }
    if (ruta === "/__ctl/log") return send(res, 200, { log: st.log, maxInflight: st.maxInflight, mensajes: st.mensajes.length, fallosRestantes: st.fallos.map((f) => f.secuencia.length) });
    return send(res, 404, { error: "ctl" });
  }
  const t0 = Date.now(); st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight);
  const reg = { metodo: req.method, ruta, query: u.search, authOk: req.headers.authorization === `Bearer ${TOKEN}`, authPresente: !!req.headers.authorization, ms: 0, status: 0 };
  const fin = (status, body, h) => { reg.status = status; reg.ms = Date.now() - t0; st.log.push(reg); st.inflight--; send(res, status, body, h); };
  const cuerpo = req.method === "POST" ? await leer(req) : "";
  if (st.latenciaMs) await esperar(st.latenciaMs);
  if (!reg.authOk) return fin(401, { error: "unauthorized", code: "ERR_AUTH", params: {} });
  const fallo = st.fallos.find((x) => x.patron.test(ruta) && x.secuencia.length);
  if (fallo) {
    const v = fallo.secuencia.shift();
    if (v === "colgar") { await esperar(60_000); return fin(504, { error: "x", code: "ERR_HANG", params: {} }); }
    if (v === "json") { reg.status = 200; reg.ms = Date.now() - t0; st.log.push(reg); st.inflight--; res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>no json</html>"); }
    return fin(v, { error: "x", code: "ERR_X", params: {} }, v === 429 ? { "retry-after": "1" } : {});
  }
  const m = /^\/api\/v1\/mailboxes\/([^/]+)\/folders\/([^/]+)\/messages(?:\/(\d+)(\/text)?|\/search)?$/.exec(ruta);
  if (!m) return fin(404, { error: "ruta", code: "ERR_ROUTE", params: {} });
  if (m[1] !== BUZON) return fin(403, { error: "otro buzón", code: "ERR_FORBIDDEN", params: {} });
  const pagina = Math.max(1, Number(u.searchParams.get("page") ?? 1)), pp = Math.min(100, Math.max(1, Number(u.searchParams.get("perPage") ?? 25)));
  const ord = (xs) => [...xs].sort((a, b) => b.uid - a.uid).slice((pagina - 1) * pp, pagina * pp);
  const ok = (data) => fin(200, { data });
  if (/\/search$/.test(ruta)) {
    const c = JSON.parse(cuerpo || "{}"), rg = /^(\d+):(\d+)$/.exec(c.uid ?? ""), [a, b] = rg ? [Number(rg[1]), Number(rg[2])] : [1, Number.MAX_SAFE_INTEGER];
    return ok(ord(st.mensajes.filter((x) => x.uid >= a && x.uid <= b)));
  }
  if (!m[3]) return ok(ord(st.mensajes));
  const uid = Number(m[3]), d = st.mensajes.find((x) => x.uid === uid);
  if (!d) return fin(404, { error: "no existe", code: "ERR_NOT_FOUND", params: {} });
  return ok(m[4] ? { text: st.textos[uid] ?? "Gracias, recibido. Confirmamos la disponibilidad.", html: "<p>html</p>" } : d);
}).listen(PORT, "127.0.0.1", () => console.log(`mail api sim on ${PORT}`));
