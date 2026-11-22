// #127 local review: minimal gateway that reproduces Kong's /auth/v1 and /rest/v1 prefixes and its CORS plugin (no storage). Loopback only.
//   node gateway_127.cjs <puerto> <puerto_gotrue> <puerto_postgrest>
const http = require("node:http");
const [puerto, auth, rest] = process.argv.slice(2).map(Number);
if (!puerto || !auth || !rest) { console.error("uso: gateway_127.cjs <puerto> <gotrue> <postgrest>"); process.exit(2); }
// The browser (the app on 127.0.0.1:3081) calls GoTrue/PostgREST directly: answer the preflight and echo the origin, as Kong's cors plugin does.
const cors = (req, res) => {
  res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-expose-headers", "*");
  res.setHeader("vary", "Origin");
};
http.createServer((req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let destino, ruta = req.url ?? "/";
  if (ruta.startsWith("/auth/v1")) { destino = auth; ruta = ruta.slice("/auth/v1".length) || "/"; }
  else if (ruta.startsWith("/rest/v1")) { destino = rest; ruta = ruta.slice("/rest/v1".length) || "/"; }
  else { res.statusCode = 404; return res.end(); }
  const p = http.request({ host: "127.0.0.1", port: destino, path: ruta, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${destino}` } }, (r) => {
    const h = { ...r.headers }; for (const k of Object.keys(h)) if (k.startsWith("access-control-")) delete h[k];
    res.writeHead(r.statusCode ?? 502, { ...h, ...Object.fromEntries(Object.entries(res.getHeaders())) }); r.pipe(res);
  });
  p.on("error", (e) => { res.statusCode = 502; res.end(String(e)); });
  req.pipe(p);
}).listen(puerto, "127.0.0.1", () => console.log(`gateway 127 en 127.0.0.1:${puerto} (auth ${auth}, rest ${rest})`));
