// Proxy mínimo del HUMO #14-A (derivado de humo_304_proxy.mjs): la aplicación compilada habla con NEXT_PUBLIC_SUPABASE_URL y espera <url>/rest/v1/... y <url>/auth/v1/user.
// Quita /rest/v1 hacia un PostgREST desnudo y responde un GoTrue MÍNIMO: el usuario es el `sub` del JWT de la sesión (varios usuarios: personal y aliados). Solo loopback.
import http from "node:http";

const PUERTO = Number(process.env.HUMO_PUERTO ?? 54399);
const REST = new URL(process.env.HUMO_REST ?? "");
const ANON_BUILD = "Bearer anon-local-304", ANON_JWT = process.env.HUMO_ANON_JWT ? `Bearer ${process.env.HUMO_ANON_JWT}` : null;
if (!REST.host) throw new Error("Falta HUMO_REST.");
const sub = (auth) => { try { return JSON.parse(Buffer.from(String(auth).replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub ?? null; } catch { return null; } };

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/auth/v1/user")) {
    const id = sub(req.headers.authorization);
    if (!id) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "sin sesión" })); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, aud: "authenticated", role: "authenticated", email: `${id}@humo.test`, app_metadata: {}, user_metadata: {} }));
    return;
  }
  if (!req.url.startsWith("/rest/v1")) { res.writeHead(404); res.end("no"); return; }
  const ruta = req.url.replace(/^\/rest\/v1/, "") || "/";
  const p = http.request({ host: REST.hostname, port: REST.port, path: ruta, method: req.method, headers: { ...req.headers, host: REST.host, ...(ANON_JWT && req.headers.authorization === ANON_BUILD ? { authorization: ANON_JWT } : {}), ...(ANON_JWT && req.headers.apikey === "anon-local-304" ? { apikey: ANON_JWT.replace(/^Bearer /, "") } : {}) } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
server.keepAliveTimeout = 65_000;
server.listen(PUERTO, "127.0.0.1", () => console.log(`proxy humo 14a en 127.0.0.1:${PUERTO} → ${REST.origin}`));
