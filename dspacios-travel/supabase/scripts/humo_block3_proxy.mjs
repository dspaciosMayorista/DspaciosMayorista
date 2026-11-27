// Proxy mínimo del recorrido navegado del bloque 3 (derivado de humo_14a_proxy.mjs): la aplicación compilada habla con NEXT_PUBLIC_SUPABASE_URL y espera <url>/rest/v1/... y <url>/auth/v1/user.
// Quita /rest/v1 hacia un PostgREST desnudo y responde un GoTrue MÍNIMO: el usuario es el `sub` del JWT de la sesión. NOVEDAD: responde CORS (preflight OPTIONS y cabeceras), porque la presencia (#11) llama
// a la base DESDE EL NAVEGADOR (RPC `registrar_presencia`, origen distinto: la app en :3081 y este proxy en :54481), igual que lo haría Supabase real. Además cuenta las peticiones por ruta (GET /__conteo).
import http from "node:http";

const PUERTO = Number(process.env.HUMO_PUERTO ?? 54481);
const REST = new URL(process.env.HUMO_REST ?? "");
const ANON_BUILD = "Bearer anon-local-304", ANON_JWT = process.env.HUMO_ANON_JWT ? `Bearer ${process.env.HUMO_ANON_JWT}` : null;
if (!REST.host) throw new Error("Falta HUMO_REST.");
const sub = (auth) => { try { return JSON.parse(Buffer.from(String(auth).replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub ?? null; } catch { return null; } };
const conteo = new Map();
const cors = (req) => ({
  "access-control-allow-origin": req.headers.origin ?? "*",
  "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-max-age": "600", vary: "origin",
});

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); res.end(); return; }
  if (req.url === "/__conteo") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(Object.fromEntries(conteo))); return; }
  if (req.url.startsWith("/auth/v1/logout")) { res.writeHead(204, cors(req)); res.end(); return; }   // GoTrue real responde 204; sin esto el cliente no retira la sesión local y no emite SIGNED_OUT
  if (req.url.startsWith("/auth/v1/user")) {
    const id = sub(req.headers.authorization);
    if (!id) { res.writeHead(401, { "content-type": "application/json", ...cors(req) }); res.end(JSON.stringify({ message: "sin sesión" })); return; }
    res.writeHead(200, { "content-type": "application/json", ...cors(req) });
    res.end(JSON.stringify({ id, aud: "authenticated", role: "authenticated", email: `${id}@humo.test`, app_metadata: {}, user_metadata: {} }));
    return;
  }
  if (!req.url.startsWith("/rest/v1")) { res.writeHead(404, cors(req)); res.end("no"); return; }
  const ruta = req.url.replace(/^\/rest\/v1/, "") || "/";
  const clave = `${req.method} ${ruta.split("?")[0]}`; conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  const p = http.request({ host: REST.hostname, port: REST.port, path: ruta, method: req.method, headers: { ...req.headers, host: REST.host, ...(ANON_JWT && req.headers.authorization === ANON_BUILD ? { authorization: ANON_JWT } : {}), ...(ANON_JWT && req.headers.apikey === "anon-local-304" ? { apikey: ANON_JWT.replace(/^Bearer /, "") } : {}) } }, (r) => { res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors(req) }); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502, cors(req)); res.end(String(e)); });
  req.pipe(p);
});
server.keepAliveTimeout = 65_000;
server.listen(PUERTO, "127.0.0.1", () => console.log(`proxy humo bloque 3 en 127.0.0.1:${PUERTO} → ${REST.origin}`));
