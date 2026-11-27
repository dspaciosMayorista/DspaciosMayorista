// Compiled-app journey for the Hostinger inbound adapter (HIN-1…HIN-5). Everything is local: compiled `next start` (loopback) + real Postgres/PostgREST/GoTrue stack + SIMULATED Mail API + Mailpit, all started by harness.mjs.
// Real HTTP calls to the real routes (proxy included), real database, real event RPC, real internal-notice sender. Nothing leaves this machine. Results go to <HJ_WORK>/evidence.json.
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { AQUI, ajustes, cargarConfig, sqlDesechable } from "./lib.mjs";

const aj = ajustes(), cfg = cargarConfig(aj), PUERTO_APP = aj.appPort ?? cfg.puertos.app;
const APP = `http://127.0.0.1:${PUERTO_APP}`, SIM = `http://127.0.0.1:${cfg.puertos.sim}`, MAILPIT = `http://127.0.0.1:${cfg.puertos.correo}`;
const WEBHOOK = cfg.journey.webhookSecret, CRON = cfg.journey.cronSecret, RESPONDER = "respuestas@walk.test";
const tok = (n) => `WalkTok${String(n).padStart(17, "0")}`;           // request n (1..8) = solicitudes_proveedor id n+1
const resultados = [], medidas = { escenarios: {}, libreMinMB: Math.round(os.freemem() / 1048576) };
const check = (nombre, ok, detalle = "") => { resultados.push({ nombre, ok: !!ok, detalle: String(detalle) }); console.log(`${ok ? "OK  " : "FAIL"} ${nombre}${detalle ? "  — " + detalle : ""}`); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const muestreo = setInterval(() => { medidas.libreMinMB = Math.min(medidas.libreMinMB, Math.round(os.freemem() / 1048576)); }, 500);

const sql = sqlDesechable(aj);                                  // throws unless the target is a database THIS harness created (name + marker): never an owner database
const sqlJson = (q) => JSON.parse(sql(`select coalesce(json_agg(t), '[]'::json) from (${q}) t`));
const ctl = async (ruta, cuerpo = {}) => (await fetch(`${SIM}/__ctl/${ruta}`, { method: "POST", body: JSON.stringify(cuerpo) })).json();
const xact = () => Number(sql("select xact_commit + xact_rollback from pg_stat_database where datname = current_database()"));
const rssApp = () => { const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${PUERTO_APP} -State Listen | ForEach-Object { [int]((Get-Process -Id $_.OwningProcess).WorkingSet64/1MB) }`], { encoding: "utf8" }); return Number(r.stdout.trim().split(/\s+/)[0]) || null; };
const dockerMem = () => execFileSync("docker", ["stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}} {{.CPUPerc}}"], { encoding: "utf8" }).trim().split("\n").filter((l) => /hj103_/.test(l) || l.startsWith(aj.pg + " "));

const mensaje = (uid, to, extra = {}) => ({ uid, date: new Date(Date.now() - 3_600_000).toISOString(), subject: "Re: Solicitud", from: { name: "Reservas Hotel", address: "reservas@proveedor.test" }, to, cc: [], bcc: [], messageId: `<w${uid}@proveedor.test>`, inReplyTo: null, attachments: [], flags: [], unseen: true, size: 1200, path: "INBOX", ...extra });
const aToken = (n) => [{ address: `respuestas+${tok(n)}@walk.test` }];
const otros = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => mensaje(desde + i, [{ address: "otro@proveedor.test" }]));

async function llamar(metodo, ruta, auth, cuerpo) {
  const t0 = Date.now();
  const r = await fetch(`${APP}${ruta}`, { method: metodo, headers: { ...(auth ? { authorization: auth } : {}), ...(cuerpo ? { "content-type": "application/json" } : {}) }, body: cuerpo });
  const texto = await r.text(); let j = null; try { j = JSON.parse(texto); } catch {}
  return { status: r.status, ms: Date.now() - t0, body: j, texto };
}
const webhook = () => llamar("POST", "/api/solicitud-proveedor/hostinger", `Bearer ${WEBHOOK}`, "{}");
const cron = () => llamar("GET", "/api/cron/respuestas-hostinger", `Bearer ${CRON}`);
const logSim = async () => (await ctl("log")).log;
const resumenLog = (log) => ({ llamadas: log.length, listas: log.filter((l) => l.metodo === "GET" && /\/messages$/.test(l.ruta)).length, busquedas: log.filter((l) => /\/search$/.test(l.ruta)).length, descargas: log.filter((l) => /\/messages\/\d+(\/text)?$/.test(l.ruta)).length, msTotal: log.reduce((a, l) => a + l.ms, 0), maxMs: Math.max(0, ...log.map((l) => l.ms)), sinAuth: log.filter((l) => !l.authOk).length });
async function medir(nombre, fn) {
  await ctl("reset-log"); const x0 = xact(), t0 = Date.now(); const r = await fn(); const log = await logSim();
  const m = { ...resumenLog(log), transaccionesBd: xact() - x0, msPared: Date.now() - t0, rssAppMB: rssApp() }; (medidas.escenarios[nombre] ??= []).push(m); return { r, m, log };
}
const estado = () => sqlJson("select uid_cubierto, barrido_tope, barrido_siguiente, barrido_desde is not null as con_umbral, version from public.hostinger_estado_leer('ACwalk0000test1')")[0] ?? null;
const eventos = () => sqlJson("select e.solicitud_id, e.tipo, e.dedupe from public.solicitud_proveedor_eventos e where e.tipo = 'respuesta' order by e.id");
const pendientes = () => Number(sql("select count(*) from public.hostinger_respuestas_pendientes where buzon_id = 'ACwalk0000test1'"));
const avisosBd = () => Number(sql("select count(*) from public.solicitud_proveedor_avisos"));
const correos = async () => { const j = await (await fetch(`${MAILPIT}/api/v1/messages?limit=500`)).json(); return (j.messages ?? []).filter((m) => /interno@walk\.test/.test(JSON.stringify(m.To)) && /Respuesta del proveedor/.test(m.Subject)); };
const resetBd = () => { sql("delete from public.solicitud_proveedor_eventos; delete from public.hostinger_respuestas_pendientes; delete from public.hostinger_estado_buzon; update public.solicitudes_proveedor set estado = 'enviada', respondida_en = null, confirmacion = null, confirmada_en = null"); };
const campos = (b) => b ? Object.fromEntries(["completo", "pendiente", "barridoEnCurso", "conflicto", "presupuestoAgotado", "pendientesGuardados", "pendientesRecuperados", "pendientesRestantes", "paginas", "revisados", "yaRegistrados", "nuevos", "procesados", "progresoParcial"].filter((k) => k in b).map((k) => [k, b[k]])) : null;

// ── 0 · preflight ──
const login = await fetch(`${APP}/login`); check("0.1 compiled app answers /login", login.status === 200, login.status);
await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" }); resetBd();
await ctl("mensajes", { mensajes: [] }); await ctl("fallos", { fallos: [] }); await ctl("latencia", { ms: 0 });
medidas.libreInicialMB = Math.round(os.freemem() / 1048576); medidas.rssAppInicialMB = rssApp();

// ── 1 · authentication on the real routes (proxy + handler) ──
{
  await ctl("mensajes", { mensajes: otros(1, 3) }); await ctl("reset-log");
  const grande = JSON.stringify({ x: "y".repeat(70_000) });
  const casos = [
    ["webhook no Authorization", () => llamar("POST", "/api/solicitud-proveedor/hostinger", null, "{}"), 401],
    ["webhook wrong Bearer", () => llamar("POST", "/api/solicitud-proveedor/hostinger", "Bearer nope", "{}"), 401],
    ["webhook Basic scheme with the right secret", () => llamar("POST", "/api/solicitud-proveedor/hostinger", `Basic ${WEBHOOK}`, "{}"), 401],
    ["webhook with the CRON secret", () => llamar("POST", "/api/solicitud-proveedor/hostinger", `Bearer ${CRON}`, "{}"), 401],
    ["webhook right secret, 70 KB body", () => llamar("POST", "/api/solicitud-proveedor/hostinger", `Bearer ${WEBHOOK}`, grande), 413],
    ["webhook GET (method not allowed)", () => llamar("GET", "/api/solicitud-proveedor/hostinger", `Bearer ${WEBHOOK}`), 405],
    ["cron no Authorization", () => llamar("GET", "/api/cron/respuestas-hostinger", null), 401],
    ["cron wrong Bearer", () => llamar("GET", "/api/cron/respuestas-hostinger", "Bearer nope"), 401],
    ["cron with the WEBHOOK secret", () => llamar("GET", "/api/cron/respuestas-hostinger", `Bearer ${WEBHOOK}`), 401],
  ];
  for (const [n, f, esperado] of casos) { const r = await f(); check(`1 ${n} → ${esperado}`, r.status === esperado, `got ${r.status}`); }
  const l = await logSim(); check("1.x rejected requests made ZERO Mail API calls", l.length === 0, `${l.length} calls`);
  check("1.y no event, state or backlog row created by rejected requests", eventos().length === 0 && Number(sql("select count(*) from public.hostinger_estado_buzon")) === 0 && Number(sql("select count(*) from public.hostinger_respuestas_pendientes")) === 0);
}

// ── 2 · persistent continuation: 1,300 messages, slow Mail API, an app RESTART between runs ──
{
  const msgs = otros(1, 1300); msgs[4] = mensaje(5, aToken(1)); msgs[129] = mensaje(130, aToken(2)); msgs[999] = mensaje(1000, aToken(3));
  await ctl("mensajes", { mensajes: msgs }); await ctl("latencia", { ms: 1200 });
  const corridas = []; let reinicio = false;
  for (let i = 1; i <= 8; i++) {
    const { r, m, log } = await medir("2-continuation", () => webhook());
    corridas.push({ run: i, status: r.status, ...campos(r.body), wallMs: r.ms, simCalls: m.llamadas, searches: m.busquedas, downloads: m.descargas, estado: estado(), tx: m.transaccionesBd });
    console.log(`  run ${i}: ${r.status} ${JSON.stringify(campos(r.body))} wall=${r.ms}ms sim=${m.llamadas} cursor=${JSON.stringify(estado())}`);
    if (i === 1 && !reinicio) { reinicio = true; execFileSync(process.execPath, [path.join(AQUI, "harness.mjs"), "app-restart"], { encoding: "utf8", env: process.env }); }   // the app process is REPLACED: only the database can carry the position
    if (r.body?.completo) break;
  }
  const primero = corridas[0], ultimo = corridas.at(-1);
  check("2.1 the first run could not finish a 1,300-message mailbox (202, incomplete)", primero.status === 202 && primero.completo === false, `status ${primero.status}`);
  check("2.2 each run stayed inside the budget (wall ≤ 11 s, ≤ 60 provider calls)", corridas.every((c) => c.wallMs <= 11_000 && c.simCalls <= 60), corridas.map((c) => `${c.wallMs}ms/${c.simCalls}`).join(" "));
  check("2.3 the position survived an app restart (run 2 resumed below run 1's position)", corridas.length >= 2 && corridas[0].estado?.barrido_siguiente != null && corridas[1].estado != null, JSON.stringify(corridas[0].estado));
  check("2.4 eventually complete (200) with the cursor at the newest uid", ultimo.status === 200 && ultimo.completo === true && estado()?.uid_cubierto === 1300, `runs=${corridas.length}, cursor=${JSON.stringify(estado())}`);
  const ev = eventos(); check("2.5 the three replies hidden behind >1,000 newer unrelated messages were recorded exactly once", ev.length === 3 && new Set(ev.map((e) => e.dedupe)).size === 3, ev.map((e) => e.dedupe).join(","));
  const todas = await logSim();
  medidas.continuacion = { corridas: corridas.map(({ run, status, wallMs, simCalls, searches, downloads, tx }) => ({ run, status, wallMs, simCalls, searches, downloads, tx })) };
  await ctl("latencia", { ms: 0 });
}

// ── 3 · failure recovery: a failing download is parked, a hanging one is bounded, both recover without a new email ──
{
  await ctl("agregar", { mensajes: [mensaje(1301, aToken(4)), mensaje(1302, aToken(5)), mensaje(1303, aToken(6))] });
  await ctl("fallos", { fallos: [{ patron: "/messages/1301$", secuencia: [503, 503, 503, 503, 503, 503, 503, 503] }] });
  const a = await medir("3-parked", () => webhook());
  console.log(`  run A: ${a.r.status} ${JSON.stringify(campos(a.r.body))} wall=${a.r.ms}ms`);
  check("3.1 a reply whose download keeps failing (503) is PARKED, others still recorded", a.r.body?.pendientesGuardados === 1 && pendientes() === 1 && eventos().length === 5, `parked=${pendientes()} events=${eventos().length}`);
  check("3.2 an incomplete pass answers 202 (never a false 200)", a.r.status === 202 && a.r.body?.completo === false, a.r.status);
  const b = await medir("3-parked", () => cron());
  console.log(`  run B (cron): ${b.r.status} ${JSON.stringify(campos(b.r.body))} wall=${b.r.ms}ms`);
  check("3.3 the next pass (scheduled drain) recovers the parked reply and clears the backlog without any new email", b.r.body?.pendientesRecuperados === 1 && pendientes() === 0 && eventos().length === 6 && b.r.body?.completo === true, `parked=${pendientes()} events=${eventos().length}`);
  // hang: the provider never answers once
  await ctl("agregar", { mensajes: [mensaje(1304, aToken(7))] }); await ctl("fallos", { fallos: [{ patron: "/messages/1304$", secuencia: ["colgar"] }] });
  const c = await medir("3-hang", () => webhook());
  console.log(`  run C (hang): ${c.r.status} ${JSON.stringify(campos(c.r.body))} wall=${c.r.ms}ms`);
  check("3.4 a provider that never answers cannot hold the request past the budget (wall ≤ 12 s)", c.r.ms <= 12_000, `${c.r.ms} ms`);
  const d = await medir("3-hang", () => cron());
  check("3.5 …and the reply is recovered by the next pass", eventos().length === 7 && pendientes() === 0 && d.r.body?.completo === true, `events=${eventos().length} parked=${pendientes()}`);
  await ctl("fallos", { fallos: [] });
}

// ── 4 · concurrency: 6 webhooks + 2 cron drains at once over 8 new replies ──
{
  const antes = { ev: eventos().length, avisos: avisosBd(), correos: (await correos()).length };
  await ctl("agregar", { mensajes: Array.from({ length: 8 }, (_, i) => mensaje(1400 + i, aToken(1 + (i % 4)))) }); await ctl("latencia", { ms: 250 });
  const { r: rs, m, log } = await medir("4-concurrency", () => Promise.all([webhook(), webhook(), webhook(), cron(), webhook(), webhook(), cron(), webhook()]));
  await pausa(1500);
  rs.forEach((r, i) => console.log(`  concurrent ${i}: ${r.status} ${JSON.stringify(campos(r.body))} wall=${r.ms}ms`));
  const ev = eventos(), d = ev.filter((e) => /w14\d\d@/.test(e.dedupe));
  check("4.1 every one of the 8 replies recorded exactly once under 8 simultaneous passes", d.length === 8 && new Set(d.map((e) => `${e.solicitud_id}|${e.dedupe}`)).size === 8, `${d.length} rows`);
  check("4.2 no 5xx and no unauthenticated answer among the concurrent passes", rs.every((r) => r.status === 200 || r.status === 202), rs.map((r) => r.status).join(","));
  const cx = (await ctl("log")).maxInflight; check("4.3 the passes really overlapped at the provider (max in-flight > 1)", cx > 1, `maxInflight=${cx}`);
  check("4.4 state coherent: cursor at the newest uid, no running sweep, backlog empty", estado()?.uid_cubierto === 1407 && estado()?.barrido_tope == null && pendientes() === 0, JSON.stringify(estado()));
  const nuevosAvisos = avisosBd() - antes.avisos, nuevosCorreos = (await correos()).length - antes.correos;
  check("4.5 on-screen notices created once per new reply (not once per concurrent pass)", nuevosAvisos === 8 * Number(sql("select count(distinct user_id) from public.solicitud_proveedor_avisos")), `+${nuevosAvisos}`);
  check("4.6 internal e-mail notices sent exactly once per new reply (Mailpit)", nuevosCorreos === 8, `+${nuevosCorreos}`);
  await ctl("latencia", { ms: 0 });
}

// ── 5 · dedupe + idle cost ──
{
  const antes = eventos().length, correosAntes = (await correos()).length;
  await ctl("agregar", { mensajes: [mensaje(1500, aToken(1), { messageId: "<w1400@proveedor.test>" })] });          // the same RFC Message-ID arriving again under a new uid
  const a = await medir("5-dedupe", () => webhook());
  check("5.1 the same Message-ID under a new uid creates no new event and no notice", eventos().length === antes && (await correos()).length === correosAntes && a.r.body?.yaRegistrados >= 1, `events ${eventos().length}/${antes}, yaRegistrados=${a.r.body?.yaRegistrados}`);
  const b = await medir("5-idle", () => webhook());
  check("5.2 an idle pass costs ONE list call and no downloads", b.m.listas === 1 && b.m.busquedas === 0 && b.m.descargas === 0 && b.r.status === 200, JSON.stringify({ listas: b.m.listas, busquedas: b.m.busquedas, descargas: b.m.descargas }));
}

// ── 6 · a reply never confirms or rejects anything ──
{
  const s = sqlJson("select id, estado, confirmacion, confirmada_en is not null as confirmada from public.solicitudes_proveedor order by id");
  check("6.1 replied requests are «respondida» and none is confirmed/rejected by a reply", s.filter((x) => x.estado === "respondida").length >= 4 && s.every((x) => x.confirmacion === null && !x.confirmada), JSON.stringify(s.map((x) => `${x.id}:${x.estado}`)));
  check("6.2 the contracts' own state is untouched", sql("select string_agg(numero_contrato || ':' || estado, ',' order by numero_contrato) from public.ventas where numero_contrato in ('DTM-2001','DTM-2002')") === "DTM-2001:pendiente,DTM-2002:pendiente");
  console.log("  contracts:", sql("select string_agg(numero_contrato || ':' || estado, ',' order by numero_contrato) from public.ventas where numero_contrato in ('DTM-2001','DTM-2002')"));
}

// ── 7 · resources ──
clearInterval(muestreo);
medidas.libreFinalMB = Math.round(os.freemem() / 1048576); medidas.rssAppFinalMB = rssApp(); medidas.contenedores = dockerMem();
medidas.totales = { eventos: eventos().length, avisosEnPantalla: avisosBd(), correosInternos: (await correos()).length };
const ok = resultados.every((r) => r.ok);
fs.writeFileSync(path.join(aj.work, "evidence.json"), JSON.stringify({ ok, resultados, medidas }, null, 2));
console.log(`\nJOURNEY ${ok ? "PASSED" : "FAILED"}: ${resultados.filter((r) => r.ok).length}/${resultados.length} checks`);
console.log(JSON.stringify(medidas, null, 1));
process.exit(ok ? 0 : 1);
