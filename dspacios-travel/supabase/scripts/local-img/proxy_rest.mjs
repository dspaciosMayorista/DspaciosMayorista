// Strips the /rest/v1 prefix Supabase's gateway adds, so supabase-js can talk straight to PostgREST (no Kong, no auth).
// Usage: node proxy_rest.mjs <listenPort> <postgrestPort>
import http from "node:http";
const [lp, up] = [Number(process.argv[2]), Number(process.argv[3])];
const s = http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, "") || "/";
  if (req.url.startsWith("/auth/v1")) { res.statusCode = 401; return res.end("{}"); }
  const o = http.request({ host: "127.0.0.1", port: up, path, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  o.on("error", () => { res.statusCode = 502; res.end(); }); req.pipe(o);
});
s.keepAliveTimeout = 65000; s.listen(lp, "127.0.0.1", () => console.log(`rest proxy ${lp} -> ${up}`));
