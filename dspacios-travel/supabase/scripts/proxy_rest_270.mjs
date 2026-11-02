// Proxy MÍNIMO de SOLO PRUEBAS: la app usa supabase-js (URL/rest/v1/...) y el PostgREST local sirve en la raíz. Reescribe /rest/v1/* → /* y deja pasar todo lo demás con 404.
// Uso: node proxy_rest_270.mjs <puerto> <url_postgrest>
import http from "node:http";
const [puerto, destino] = [Number(process.argv[2]), process.argv[3]];
if (!puerto || !destino) throw new Error("uso: node proxy_rest_270.mjs <puerto> <url_postgrest>");
http.createServer((req, res) => {
  // GoTrue mínimo: el usuario sale del JWT (solo pruebas locales; no se verifica la firma).
  if (req.url?.startsWith("/auth/v1/user")) {
    try {
      const claims = JSON.parse(Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer /i, "").split(".")[1], "base64url").toString());
      if (!claims.sub) throw new Error("sin sub");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: claims.sub, aud: "authenticated", role: "authenticated", email: `${claims.sub}@x.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
    } catch { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "invalid JWT" })); }
    return;
  }
  if (!req.url?.startsWith("/rest/v1/")) { res.writeHead(404); res.end("solo /rest/v1/ y /auth/v1/user"); return; }
  const u = new URL(destino);
  const p = http.request({ host: u.hostname, port: u.port, path: req.url.replace("/rest/v1", ""), method: req.method, headers: { ...req.headers, host: u.host } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  p.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(p);
}).listen(puerto, "127.0.0.1", () => console.log(`proxy ${puerto} -> ${destino}`));
