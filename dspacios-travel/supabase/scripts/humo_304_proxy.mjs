// Proxy mínimo para el HUMO local de la 304 (#94): la aplicación compilada habla con NEXT_PUBLIC_SUPABASE_URL (aquí http://127.0.0.1:54399) y espera
// <url>/rest/v1/... y <url>/auth/v1/user. Este proxy quita /rest/v1 hacia un PostgREST desnudo y responde un GoTrue MÍNIMO (el usuario de la sesión de prueba).
// Solo loopback. keep-alive largo (con el de 5 s de Node el cliente reutiliza un socket cerrado y falla «other side closed»).
import http from "node:http";

const PUERTO = Number(process.env.HUMO_PUERTO ?? 54399);
const REST = new URL(process.env.HUMO_REST ?? "");
const UID = process.env.HUMO_UID ?? "";
// La clave anon que se cocina al compilar (`anon-local-304`) no es un JWT del PostgREST local: el proxy la sustituye por una firmada con el secreto de esta corrida.
const ANON_BUILD = "Bearer anon-local-304", ANON_JWT = process.env.HUMO_ANON_JWT ? `Bearer ${process.env.HUMO_ANON_JWT}` : null;
if (!REST.host || !UID) throw new Error("Faltan HUMO_REST y HUMO_UID.");

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/auth/v1/user")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: UID, aud: "authenticated", role: "authenticated", email: "super94@x.test", app_metadata: {}, user_metadata: {} }));
    return;
  }
  if (!req.url.startsWith("/rest/v1")) { res.writeHead(404); res.end("no"); return; }
  const ruta = req.url.replace(/^\/rest\/v1/, "") || "/";
  const p = http.request({ host: REST.hostname, port: REST.port, path: ruta, method: req.method, headers: { ...req.headers, host: REST.host, ...(ANON_JWT && req.headers.authorization === ANON_BUILD ? { authorization: ANON_JWT } : {}) } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
server.keepAliveTimeout = 65_000;
server.listen(PUERTO, "127.0.0.1", () => console.log(`proxy humo en 127.0.0.1:${PUERTO} → ${REST.origin}`));
