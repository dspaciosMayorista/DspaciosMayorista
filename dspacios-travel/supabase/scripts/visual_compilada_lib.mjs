// Biblioteca del arnés de inspección de la app COMPILADA (next start) con sesiones reales, PostgREST desechable y Edge sobre CDP.
// Derivada de visual_block1.mjs. Lanzada por lanzar_visual_compilada.sh. Sin dependencias.
//   · proxy 127.0.0.1:<proxy>/__ : REST → PostgREST desechable; /auth/v1/user → GoTrue mínimo (solo reconoce a los usuarios declarados); /storage/v1/object → Storage en memoria.
//   · la app es el build de producción (`next start`) con NEXT_PUBLIC_SUPABASE_URL apuntando a ese proxy.
//   · Edge headless por CDP; el ancho móvil usa emulación real de dispositivo (mobile: true, 390 px de viewport), no un contenedor angosto.
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString("base64url");

export async function iniciar({ rest, secreto, usuarios, salida, appDir, appPuerto = 3099, proxyPuerto = 54399, cdpPuerto = 9244, anonLiteral = "anon-local-vc", prefijo = "/__", reescribirUrl = null, edgeRuta = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", storage = true }) {
  const OUT = path.join(salida, "visual"); fs.mkdirSync(OUT, { recursive: true });
  const APP = `http://127.0.0.1:${appPuerto}`;
  const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 7200 })); return `${h}.${c}.${createHmac("sha256", secreto).update(`${h}.${c}`).digest("base64url")}`; };
  const ANON = jwt({ role: "anon" }), SERVICE = jwt({ role: "service_role" });
  const medidas = []; const peticiones = {}; const objetos = new Map(); const eventosApp = [];
  const destino = new URL(rest);

  const proxy = http.createServer((req, res) => {
    if (req.url.startsWith(`${prefijo}/auth/v1/user`)) {
      const bearer = String(req.headers.authorization || "").replace(/^Bearer /i, "");
      let sub = null; try { sub = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub; } catch { /* anon */ }
      const u = Object.values(usuarios).find((x) => x.id === sub);
      if (!u) { res.writeHead(401, { "content-type": "application/json" }); res.end("{}"); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {} })); return;
    }
    if (storage && req.url.startsWith(`${prefijo}/storage/v1/`)) {
      const ruta = decodeURIComponent(req.url.split("/storage/v1/")[1].split("?")[0]);
      const trozos = []; req.on("data", (d) => trozos.push(d));
      req.on("end", () => {
        const cuerpo = Buffer.concat(trozos);
        peticiones[`${req.method} storage`] = (peticiones[`${req.method} storage`] ?? 0) + 1;
        res.setHeader("content-type", "application/json");
        if (ruta.startsWith("object/sign/") && req.method === "POST") { res.writeHead(200); res.end(JSON.stringify({ signedURL: `/${ruta}?token=falso` })); return; }
        if (ruta.startsWith("object/") && req.method === "POST") { const k = ruta.slice(7); if (objetos.has(k)) { res.writeHead(409); res.end(JSON.stringify({ statusCode: "409", error: "Duplicate" })); return; } objetos.set(k, cuerpo.length); res.writeHead(200); res.end(JSON.stringify({ Id: k, Key: k })); return; }
        if (ruta.startsWith("object/") && req.method === "DELETE") { const { prefixes } = JSON.parse(cuerpo.toString() || "{}"); const bucket = ruta.slice(7); const q = []; for (const p of prefixes ?? []) if (objetos.delete(`${bucket}/${p}`)) q.push({ name: p }); res.writeHead(200); res.end(JSON.stringify(q)); return; }
        res.writeHead(404); res.end("{}");
      });
      return;
    }
    const ruta = (req.url.startsWith(prefijo) ? req.url.slice(prefijo.length) : req.url).replace(/^\/rest\/v1/, "") || "/";
    { const k = `${req.method} /${ruta.split("?")[0].split("/").slice(1, 3).join("/")}`; peticiones[k] = (peticiones[k] ?? 0) + 1; }
    const headers = { ...req.headers, host: destino.host };
    if (headers.authorization === `Bearer ${anonLiteral}`) headers.authorization = `Bearer ${ANON}`;
    if (headers.apikey === anonLiteral) headers.apikey = ANON;
    const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(p);
  });
  proxy.keepAliveTimeout = 65_000;
  await new Promise((ok) => proxy.listen(proxyPuerto, "127.0.0.1", ok));

  // Next fija NEXT_PUBLIC_* al compilar. Si el build se hizo con una URL de Supabase que Node no puede usar (p. ej. el puerto 1 está en la lista de puertos
  // prohibidos de fetch), este --require reescribe SOLO esa URL hacia el proxy, dentro del proceso del servidor. El código compilado de la app no cambia.
  let precarga = "";
  if (reescribirUrl) {
    const arch = path.resolve(OUT, "reescribir-fetch.cjs");
    fs.writeFileSync(arch, `const f = globalThis.fetch; const de = ${JSON.stringify(reescribirUrl)}; const a = "http://127.0.0.1:" + process.env.VC_PROXY_PORT;
globalThis.fetch = (input, init) => { const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (u.startsWith(de)) { const n = a + u.slice(de.length); input = typeof input === "string" || input instanceof URL ? n : new Request(n, input); } return f(input, init); };\n`);
    precarga = ` --require "${arch.replace(/\\/g, "/")}"`;
  }
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(appPuerto), "-H", "127.0.0.1"], {
    cwd: appDir, env: { ...process.env, VC_PROXY_PORT: String(proxyPuerto), NODE_OPTIONS: "--max-old-space-size=1024" + precarga, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${proxyPuerto}${prefijo}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonLiteral, SUPABASE_SERVICE_ROLE_KEY: SERVICE, PORT: String(appPuerto) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (d) => eventosApp.push(String(d))); app.stderr.on("data", (d) => eventosApp.push(String(d)));
  let edge = null;
  const limpiar = () => { try { app.kill(); } catch { /* ya no está */ } try { proxy.close(); } catch { /* ya no está */ } try { edge?.kill(); } catch { /* ya no está */ } };
  process.on("exit", limpiar);
  for (let i = 0; i < 90; i++) { try { const r = await fetch(`${APP}/login`, { redirect: "manual" }); if (r.status < 500) break; } catch { /* aún no */ } await dormir(500); }
  const buildId = fs.readFileSync(path.join(appDir, ".next", "BUILD_ID"), "utf8");

  const perfil = fs.mkdtempSync(path.join(process.env.TEMP || ".", "edge-vc-"));
  edge = spawn(edgeRuta, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${cdpPuerto}`, `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${cdpPuerto}/json/version`); if (r.ok) break; } catch { /* aún no */ } await dormir(250); }

  async function pestana(quien) {
    const t = await (await fetch(`http://127.0.0.1:${cdpPuerto}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map(); const eventos = [];
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method) eventos.push(d); };
    const cmd = (method, params = {}) => new Promise((res) => { const n = ++id; pend.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
    await cmd("Page.enable"); await cmd("Runtime.enable"); await cmd("Network.enable"); await cmd("DOM.enable");
    // Las pestañas de un mismo perfil COMPARTEN cookies: cada una reafirma SU sesión antes de navegar.
    const fijarSesion = async () => {
      if (!quien) { await cmd("Network.deleteCookies", { name: "sb-127-auth-token", url: APP }); return; }
      const u = usuarios[quien];
      const token = jwt({ role: "authenticated", sub: u.id, session_id: u.sesion ?? u.id, aud: "authenticated" });
      const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, refresh_token: "x", user: { id: u.id, aud: "authenticated", role: "authenticated" } });
      await cmd("Network.setCookie", { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url"), url: APP });
    };
    await fijarSesion();
    const api = {
      cmd, eventos, quien,
      // Emulación REAL de dispositivo: en móvil el viewport es de verdad de 390 px (meta viewport, media queries y barras de desplazamiento incluidos).
      async vista(ancho, alto = 900) {
        await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: ancho < 600 ? 2 : 1, mobile: ancho < 600, screenWidth: ancho, screenHeight: alto });
        if (ancho < 600) await cmd("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36" });
        else await cmd("Emulation.setUserAgentOverride", { userAgent: "" });
        await dormir(350);
      },
      async ir(url, ancho = 1280, esperaMs = 2500) {
        await cmd("Page.bringToFront"); await fijarSesion(); await api.vista(ancho); eventos.length = 0; await cmd("Page.navigate", { url });
        const t0 = Date.now(); while (Date.now() - t0 < 30000 && !eventos.some((e) => e.method === "Page.loadEventFired")) await dormir(150);
        await dormir(esperaMs);
      },
      async eval(expr) { const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return `__ERROR__ ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`; return r.result?.result?.value; },
      async texto() { for (let i = 0; i < 10; i++) { await cmd("Page.bringToFront"); const t = await api.eval("document.body ? (document.body.innerText || document.body.textContent) : ''"); if (typeof t === "string" && t.length > 40) return t; await dormir(500); } return ""; },
      /** Captura de página completa + medidas: desborde horizontal real (viewport visual y documento) y texto recortado. */
      async captura(nombre, ancho, selector = null) {
        await cmd("Page.bringToFront"); await api.vista(ancho);
        const m = await cmd("Page.getLayoutMetrics");
        const alto = Math.min(7000, Math.ceil(m.result?.cssContentSize?.height ?? 900));
        await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: ancho < 600 ? 2 : 1, mobile: ancho < 600, screenWidth: ancho, screenHeight: alto }); await dormir(400);
        const s = await cmd("Page.captureScreenshot", { format: "png" });
        const archivo = path.join(OUT, `${nombre}-${ancho}.png`); fs.writeFileSync(archivo, Buffer.from(s.result.data, "base64"));
        const dim = await api.eval(`(() => {
          const raiz = ${selector ? `document.querySelector(${JSON.stringify(selector)}) || document.body` : "document.body"};
          const iw = window.innerWidth;
          const fuera = []; const recortados = [];
          for (const e of raiz.querySelectorAll('*')) {
            const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) continue;
            if (cs.position === 'fixed' || e.closest('.sr-only')) continue;
            if (r.right > iw + 1 || r.left < -1) fuera.push((e.tagName + '.' + String(e.className).slice(0, 40)).slice(0, 70) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
            if (e.children.length === 0 && e.textContent.trim() && cs.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis') recortados.push(e.textContent.trim().slice(0, 50));
          }
          return { sw: document.documentElement.scrollWidth, iw, bw: document.body.scrollWidth, fuera: fuera.slice(0, 6), nFuera: fuera.length, recortados: recortados.slice(0, 6) };
        })()`);
        const med = { nombre, ancho, archivo, alto, scrollWidth: dim?.sw, innerWidth: dim?.iw, bodyScrollWidth: dim?.bw, desbordaHorizontal: (dim?.sw ?? 0) > (dim?.iw ?? 0) + 1, elementosFueraDelViewport: dim?.nFuera, ejemplosFuera: dim?.fuera, textoRecortado: dim?.recortados };
        medidas.push(med); return med;
      },
      /** Pone un archivo en un <input type=file> (el que devuelve la expresión) como lo haría la persona. */
      async elegirArchivo(exprInput, archivos) {
        const o = await cmd("Runtime.evaluate", { expression: exprInput, returnByValue: false });
        const objectId = o.result?.result?.objectId; if (!objectId) return false;
        const r = await cmd("DOM.setFileInputFiles", { objectId, files: archivos }); return !r.error;
      },
      errores() { return eventos.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text).slice(0, 5); },
      async cerrar() { ws.close(); await fetch(`http://127.0.0.1:${cdpPuerto}/json/close/${t.id}`).catch(() => {}); },
    };
    return api;
  }
  return { APP, OUT, buildId, pestana, medidas, peticiones, objetos, eventosApp, jwt, limpiar, escribirMedidas: (n = "mediciones.json") => fs.writeFileSync(path.join(OUT, n), JSON.stringify({ buildId, medidas, peticiones }, null, 2)) };
}
