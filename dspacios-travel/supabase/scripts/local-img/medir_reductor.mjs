// Runs the REAL lib/imagenes/reducirImagen.ts (types stripped, no re-implementation) inside Edge on the synthetic fixtures
// and reports input/output bytes, dimensions, type and time. Same-origin with the image stand-in (127.0.0.1:54371), no CORS.
// Usage: node medir_reductor.mjs <salida.json>
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const salida = process.argv[2];
const fuente = stripTypeScriptTypes(readFileSync(fileURLToPath(new URL("../../../lib/imagenes/reducirImagen.ts", import.meta.url)), "utf8")).replace(/^export /gm, "");
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const perfil = mkdtempSync(join(tmpdir(), "edge-red-"));
const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${perfil}`, "--disable-gpu", "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let url; for (let i = 0; i < 60 && !url; i++) { try { url = (await (await fetch("http://127.0.0.1:9334/json/version")).json()).webSocketDebuggerUrl; } catch { await dormir(500); } }
const sock = new WebSocket(url); await new Promise((r) => sock.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
sock.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
try {
  const { targetId } = await send("Target.createTarget", { url: "http://127.0.0.1:54371/__reset" });
  const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, s); await dormir(800);
  const expr = `(async () => { ${fuente}
    const archivos = ${JSON.stringify([1,2,3,4,5,6].flatMap((i) => [`huge-${i}.jpg`, `large-${i}.jpg`]).concat(["exif6.jpg", "ok-1.jpg"]))};
    const out = [];
    for (const n of archivos) {
      const blob = await (await fetch("/img/" + n)).blob();
      const f = new File([blob], n, { type: "image/jpeg" });
      const t0 = performance.now(); const r = await reducirImagen(f); const ms = Math.round(performance.now() - t0);
      const bmp = await createImageBitmap(r); const dim = [bmp.width, bmp.height]; bmp.close();
      const bmp0 = await createImageBitmap(f); const dim0 = [bmp0.width, bmp0.height]; bmp0.close();
      out.push({ n, inBytes: f.size, inDim: dim0.join("x"), outBytes: r.size, outDim: dim.join("x"), outType: r.type, outName: r.name, untouched: r === f, ms, b64: r === f ? null : await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(r); }) });
    }
    for (const tipo of ["image/gif", "image/svg+xml"]) { const f = new File([new Uint8Array(1000)], "x", { type: tipo }); out.push({ n: tipo, untouched: (await reducirImagen(f)) === f }); }
    return out; })()`;
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s);
  const val = r.result.value ?? r.exceptionDetails;
  // Save the reducer's real outputs next to the fixtures (red-<name>.webp) so the matrix can be re-run on them.
  const dirFx = process.env.FIXTURES;
  if (dirFx) for (const o of val) if (o.b64) writeFileSync(join(dirFx, `red-${o.n.replace(/\.jpg$/, "")}.webp`), Buffer.from(o.b64, "base64"));
  for (const o of val) delete o.b64;
  writeFileSync(salida, JSON.stringify(val, null, 1));
  console.log(val.length, "files measured");
} finally { try { await send("Browser.close"); } catch { /* closing */ } edge.kill(); await dormir(500); try { rmSync(perfil, { recursive: true, force: true }); } catch { /* in use */ } }
