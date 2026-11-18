// Local stand-in for Supabase Storage public buckets (loopback only). Serves synthetic fixtures with Storage-like
// headers (Cache-Control: max-age=3600, ETag, Accept-Ranges) and injectable faults, and logs every request.
//   /img/<file>            normal              /slow/<ms>/<file>   first byte after <ms>
//   /drip/<kbps>/<file>    throttled body      /fail/<file>        HTTP 500
//   /missing/<file>        HTTP 404            /trunc/<file>       declares full length, closes after 40 %
//   /__log  (JSON)  /__reset
// Usage: node servidor_imagenes.mjs <fixturesDir> [port=54371]
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
const dir = process.argv[2], port = Number(process.argv[3] ?? 54371);
if (!dir) throw new Error("fixturesDir required");
const cache = new Map();
const leer = (f) => { if (!cache.has(f)) { const b = readFileSync(join(dir, f)); cache.set(f, { b, etag: `"${createHash("md5").update(b).digest("hex")}"` }); } return cache.get(f); };
let log = [], activos = 0, pico = 0;
const t0 = () => Number(process.hrtime.bigint() / 1000000n);
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"); const p = u.pathname.split("/").filter(Boolean);
  if (p[0] === "__log") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ pico, log })); }
  if (p[0] === "__reset") { log = []; pico = 0; return res.end("ok"); }
  const modo = p[0]; let ms = 0, kbps = 0, f;
  if (modo === "slow") { ms = Number(p[1]); f = p[2]; } else if (modo === "drip") { kbps = Number(p[1]); f = p[2]; } else f = p[1];
  const ent = { t: t0(), url: req.url, modo, estado: 0, bytes: 0, cond: !!req.headers["if-none-match"], range: req.headers.range ?? null, acc: req.headers.accept?.slice(0, 20) };
  log.push(ent); activos++; pico = Math.max(pico, activos);
  const fin = () => { activos--; ent.fin = t0(); };
  res.on("close", fin);
  if (modo === "missing") { ent.estado = 404; res.statusCode = 404; return res.end("not found"); }
  if (modo === "fail") { ent.estado = 500; res.statusCode = 500; return res.end("boom"); }
  if (!f || !existsSync(join(dir, basename(f)))) { ent.estado = 404; res.statusCode = 404; return res.end("not found"); }
  const { b, etag } = leer(basename(f));
  if (ms) await new Promise((r) => setTimeout(r, ms));
  if (req.headers["if-none-match"] === etag) { ent.estado = 304; res.statusCode = 304; return res.end(); }
  ent.estado = 200;
  res.writeHead(200, { "content-type": f.endsWith(".webp") ? "image/webp" : "image/jpeg", "content-length": b.length, "cache-control": "max-age=3600", etag, "accept-ranges": "bytes" });
  if (modo === "trunc") { res.write(b.subarray(0, Math.floor(b.length * 0.4))); ent.bytes = Math.floor(b.length * 0.4); return setTimeout(() => res.destroy(), 50); }
  if (kbps) { const paso = Math.max(1024, Math.floor(kbps * 1024 / 20)); for (let o = 0; o < b.length; o += paso) { if (res.destroyed) return; res.write(b.subarray(o, o + paso)); ent.bytes = Math.min(b.length, o + paso); await new Promise((r) => setTimeout(r, 50)); } return res.end(); }
  ent.bytes = b.length; res.end(b);
});
srv.keepAliveTimeout = 65000;
srv.listen(port, "127.0.0.1", () => console.log(`imagenes locales en http://127.0.0.1:${port}`));
