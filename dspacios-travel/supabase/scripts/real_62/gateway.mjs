// #62 (V1) — gateway LOCAL mínimo, en lugar de Kong: una sola URL para Auth y REST como en Supabase (/auth/v1 → GoTrue, /rest/v1 → PostgREST), solo loopback.
// Extras de prueba: CORS para el navegador, REGISTRO de peticiones (para contar llamadas por acción) e INYECCIÓN de fallos reales en una ruta (500 o corte de conexión).
//   POST   /__fault  {"match":"/auth/v1/logout","modo":"500"|"corte"|"perdida","veces":1,"metodo":"PUT"(opcional)}   → los próximos N pedidos a esa ruta fallan de verdad
//     («perdida» = la petición SÍ llega a Auth y se aplica, pero la respuesta se pierde: el resultado que ve la app es INCIERTO)
//   DELETE /__fault                                                              → quita los fallos
//   GET    /__log    → [{m,ruta,estado}]        DELETE /__log → limpia
// Uso: node gateway.mjs <puerto_gateway> <puerto_auth> <puerto_rest> [puerto_storage]   (/storage/v1 → storage-api, solo si se indica)
import http from "node:http";

const [PUERTO, AUTH, REST, STOR] = process.argv.slice(2).map(Number);
if (!PUERTO || !AUTH || !REST) throw new Error("Uso: gateway.mjs <puerto> <puerto_auth> <puerto_rest>");
// ANON_ALIAS / ANON_REAL (opcionales): una app compilada con una llave anon FICTICIA (build sin las llaves locales) funciona igual si el gateway cambia esa llave
// por la anon REAL de la pila local en `apikey` y en `Authorization: Bearer`. Solo para pruebas locales sobre un build ya hecho; no toca los JWT de usuario.
const ALIAS = process.env.ANON_ALIAS, REAL = process.env.ANON_REAL;
const registro = [];
let fallos = [];

function cors(req, res) {
  res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, range, accept");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("access-control-expose-headers", "content-range, content-type");
}
const leer = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__fault") {
    if (req.method === "DELETE") { fallos = []; res.writeHead(204); return res.end(); }
    const b = JSON.parse((await leer(req)).toString() || "{}");
    fallos.push({ match: String(b.match), modo: ["corte", "perdida"].includes(b.modo) ? b.modo : "500", veces: Number(b.veces ?? 1), metodo: b.metodo ? String(b.metodo) : null });
    res.writeHead(204); return res.end();
  }
  if (url.pathname === "/__log") {
    if (req.method === "DELETE") { registro.length = 0; res.writeHead(204); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(registro));
  }
  const destino = url.pathname.startsWith("/auth/v1/") ? { puerto: AUTH, ruta: url.pathname.slice("/auth/v1".length) }
    : url.pathname.startsWith("/rest/v1/") ? { puerto: REST, ruta: url.pathname.slice("/rest/v1".length) }
    : STOR && url.pathname.startsWith("/storage/v1/") ? { puerto: STOR, ruta: url.pathname.slice("/storage/v1".length) } : null;
  if (!destino) { res.writeHead(404); return res.end("no"); }

  const f = fallos.find((x) => x.veces > 0 && url.pathname.startsWith(x.match) && (!x.metodo || x.metodo === req.method));
  let perder = false;
  if (f && f.modo === "perdida") { f.veces -= 1; perder = true; } else if (f) {
    f.veces -= 1;
    registro.push({ m: req.method, ruta: url.pathname, estado: f.modo === "corte" ? "corte" : 500, falloInyectado: true });
    if (f.modo === "corte") return req.socket.destroy();
    res.writeHead(500, { "content-type": "application/json" }); return res.end(JSON.stringify({ code: 500, error_code: "unexpected_failure", msg: "fallo inyectado por la prueba" }));
  }
  const cuerpo = await leer(req);
  const cab = { ...req.headers, host: `127.0.0.1:${destino.puerto}` };
  delete cab["content-length"]; delete cab.connection;
  if (ALIAS && REAL) { if (cab.apikey === ALIAS) cab.apikey = REAL; if (cab.authorization === `Bearer ${ALIAS}`) cab.authorization = `Bearer ${REAL}`; }
  const p = http.request({ host: "127.0.0.1", port: destino.puerto, method: req.method, path: destino.ruta + url.search, headers: { ...cab, "content-length": cuerpo.length } }, (r) => {
    if (perder) { registro.push({ m: req.method, ruta: url.pathname, estado: r.statusCode, falloInyectado: true, respuestaPerdida: true }); r.resume(); return req.socket.destroy(); }
    registro.push({ m: req.method, ruta: url.pathname + (url.search ? "?" + url.search.slice(1).split("&").filter((x) => /^(scope|grant_type)=/.test(x)).join("&") : ""), estado: r.statusCode });
    const h = { ...r.headers }; delete h["access-control-allow-origin"];
    res.writeHead(r.statusCode ?? 502, h); r.pipe(res);
  });
  p.on("error", () => { registro.push({ m: req.method, ruta: url.pathname, estado: 502 }); res.writeHead(502); res.end("gateway"); });
  p.end(cuerpo);
}).listen(PUERTO, "127.0.0.1", () => console.log(`gateway 127.0.0.1:${PUERTO} → auth:${AUTH} rest:${REST}`));
