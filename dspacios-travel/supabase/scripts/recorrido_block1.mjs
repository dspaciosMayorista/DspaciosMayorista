// REAL-ACTION DRIVER for block 1 (Codex F1/F2). Launched by recorrido_block1.sh (which creates the disposable database + PostgREST).
// Only `next/headers` (the session cookie, scoped PER CALL with AsyncLocalStorage so several users can act at the same time), `next/cache` and `server-only`
// are replaced; the server actions themselves are the real code. The pause / injected failure are TEST-ONLY triggers of the throwaway database
// (public.t_gate*): they are armed and released from here and do nothing otherwise.
import { createHmac } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import nodeModule from "node:module";
import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";

const REST = process.env.RB1_REST, SECRETO = process.env.RB1_SECRETO, PS = process.env.RB1_PS, ESC = process.env.RB1_ESCENARIO || "todos";
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const U = (n) => `00000000-0000-4000-8000-00000000b${n}`, S = (n) => `00000000-0000-4000-8000-00000000c${n}`;
const USUARIOS = {
  A: { n: "101", email: "b1-oper-a@x.test" }, B: { n: "102", email: "b1-oper-b@x.test" }, ADMIN: { n: "103", email: "b1-admin@x.test" },
  VENTA_DUENO: { n: "104", email: "b1-venta-dueno@x.test" }, VENTA_OTRO: { n: "105", email: "b1-venta-otro@x.test" },
  CONTROL_VUELO: { n: "106", email: "b1-control-vuelo@x.test" }, MINORISTA: { n: "107", email: "b1-minorista@x.test" },
  SUPER: { n: "108", email: "b1-super@x.test" }, ALIADO: { n: "109", email: "b1-aliado@x.test" },
};
const COOKIES = {};
for (const [k, u] of Object.entries(USUARIOS)) {
  const token = jwt({ role: "authenticated", sub: U(u.n), session_id: S(u.n), aud: "authenticated" });
  const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: U(u.n), aud: "authenticated", role: "authenticated" } });
  COOKIES[k] = { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") };
  u.id = U(u.n);
}
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: REST.replace(/\/$/, "") + "/__", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) });
delete process.env.CRON_SECRET; delete process.env.MANTENIMIENTO_CLAVE;

const destino = new URL(REST);
// Pause gates (HTTP level): a matching request is HELD until the gate opens; `retenidas` counts requests currently held (proof that the actor reached that step).
const puertas = {
  pausa_hotel: { cerrada: false, retenidas: 0, esperando: [], match: (m, r) => m === "POST" && r.startsWith("/contrato_hoteles") },
  // Holds ONLY the first matching request (the numbering call of the loser that is made to lose its claim).
  pausa_numero: { cerrada: false, retenidas: 0, esperando: [], soloPrimera: true, yaRetuvo: false, match: (m, r) => m === "POST" && r.startsWith("/rpc/reservar_numero_contrato") },
  // Holds ONLY the first claim request: the caller is paused after its initial state read and before it acquires the claim (Codex C1).
  pausa_reclamo: { cerrada: false, retenidas: 0, esperando: [], soloPrimera: true, yaRetuvo: false, match: (m, r) => m === "POST" && r.startsWith("/rpc/reclamar_conversion_cotizacion") },
  pausa_voucher: { cerrada: false, retenidas: 0, esperando: [], match: (m, r) => m === "POST" && r.startsWith("/rpc/guardar_vouchers_vuelo") },
};
globalThis.__puertas = puertas;
globalThis.__conteo = {};
const proxy = http.createServer((req, res) => {
  // Minimal GoTrue: getUser() asks /auth/v1/user with the session token; answer with the user of THAT token (several sessions at once).
  if (req.url.startsWith("/__/auth/v1/user")) {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    let sub = null; try { sub = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub; } catch { /* anon */ }
    const u = Object.values(USUARIOS).find((x) => x.id === sub);
    if (!u) { res.writeHead(401, { "content-type": "application/json" }); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {} })); return;
  }
  const ruta = req.url.replace(/^\/__\/rest\/v1/, "").replace(/^\/__/, "") || "/";
  // Request counter (measurement of added requests): key = METHOD + first two path segments.
  { const k = `${req.method} /${ruta.split("?")[0].split("/").slice(1, 3).join("/")}`; globalThis.__conteo[k] = (globalThis.__conteo[k] ?? 0) + 1; }
  const reenviar = (cuerpo) => {
    const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers: { ...req.headers, host: destino.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    p.end(cuerpo);
  };
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const cuerpo = Buffer.concat(chunks);
    const puerta = Object.values(puertas).find((g) => g.cerrada && g.match(req.method, ruta) && !(g.soloPrimera && g.yaRetuvo));
    if (!puerta) return reenviar(cuerpo);
    if (puerta.soloPrimera) puerta.yaRetuvo = true;
    puerta.retenidas++;
    puerta.esperando.push(() => { puerta.retenidas--; reenviar(cuerpo); });
  });
});
proxy.keepAliveTimeout = 65_000; // with Node's default 5 s the client reuses a closed socket («fetch failed») after an idle gap
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${proxy.address().port}/__`;

globalThis.__rb1 = { als: new AsyncLocalStorage() };
const datos = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
nodeModule.registerHooks({ resolve(s, c, n) {
  if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
  if (s === "next/headers") return { url: datos("export async function cookies(){ const c = globalThis.__rb1.als.getStore().cookie; return { getAll: () => [c], get: (n) => (n === c.name ? c : undefined), set(){} }; } export async function headers(){ return new Map(); }"), shortCircuit: true };
  if (s === "next/cache") return { url: datos("export function revalidatePath(){} export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
  if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) { for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* next */ } } }
  return n(s, c);
} });
/** Runs `fn` as the given user (its own cookie jar for the whole async call tree). */
const como = (quien, fn) => globalThis.__rb1.als.run({ cookie: COOKIES[quien] }, fn);

const sql = (q) => execSync(`${PS} -c "${q.replace(/\s*\n\s*/g, " ").replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 20000, que = "condición") { const t0 = Date.now(); for (;;) { const v = cond(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${que}`); await dormir(150); } }
let fallos = 0, total = 0;
const ok = (c, m) => { total++; console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const seq = () => Number(sql("select case when is_called then last_value else 0 end from public.contrato_seq_mayorista"));
// 'pausa_*' = HTTP pause gate of the proxy; 'fallar_*' = failure-injection trigger of the throwaway database.
const gate = (k, on) => {
  const g = globalThis.__puertas[k];
  if (g) { g.cerrada = on; if (on && g.soloPrimera) g.yaRetuvo = false; if (!on) { const w = g.esperando.splice(0); w.forEach((f) => f()); } return; }
  sql(on ? `insert into public.t_gate values ('${k}') on conflict do nothing` : `delete from public.t_gate where k = '${k}'`);
};
const retenidas = (k) => globalThis.__puertas[k].retenidas;

// NEGATIVE CONTROL (RB1_PREVIO=1): the round-1 behaviour is rebuilt from the current file in a temporary sibling module — no pre-claim, and ANY existing header
// returned as success on a duplicate-key conflict — so the same scenarios must FAIL. The temporary file is removed on exit.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
const RUTA_ACCIONES = "app/(dashboard)/dashboard/reservar/actions.ts", RUTA_PREVIA = "app/(dashboard)/dashboard/reservar/actions.previa-r1.ts";
if (process.env.RB1_PREVIO === "1" || process.env.RB1_PREVIO === "2") {
  let src = readFileSync(`../../${RUTA_ACCIONES}`.replace("../../", "./"), "utf8").replace(/\r\n/g, "\n");
  const cambios = [
    ["if (adminConv && !payload.oferta63) {", "if (false) {"],
    ["if (previo) return previo;", "{ const { data: antiguo } = await createAdminClient().from('ventas').select('numero_contrato, contrato_uid').eq('cotizacion_id', cotizacionOrigen).maybeSingle(); if (antiguo?.numero_contrato) return { ok: true, numero: antiguo.numero_contrato, ...(antiguo.contrato_uid ? { contratoUid: antiguo.contrato_uid } : {}) }; }"],
  ];
  // Mode 2 = the round-2 behaviour: claim + completeness, but NO revalidation of the state once the claim is held (Codex C1).
  if (process.env.RB1_PREVIO === "2") cambios.splice(0, cambios.length, ["if (adminConv && tokenReclamo) {\n        const bajoReclamo", "if (false) {\n        const bajoReclamo"]);
  for (const [a, b] of cambios) { if (!src.includes(a)) throw new Error(`negative control: text not found: ${a.slice(0, 60)}`); src = src.replace(a, b); }
  writeFileSync(`./${RUTA_PREVIA}`, src);
  process.on("exit", () => { try { rmSync(`./${RUTA_PREVIA}`); } catch { /* already gone */ } });
  console.log(process.env.RB1_PREVIO === "2" ? "NEGATIVE CONTROL 2: round-2 behaviour (claim + completeness, no revalidation under the claim)" : "NEGATIVE CONTROL: running the round-1 conversion behaviour (no claim; any existing header accepted)");
}
const reservar = await import(process.env.RB1_PREVIO === "1" || process.env.RB1_PREVIO === "2" ? `../../${RUTA_PREVIA}` : `../../${RUTA_ACCIONES}`);
const vouchers = await import("../../app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");

const IDA = "2027-06-07", REG = "2027-06-10"; // 3 nights
let docSeq = 5000000;
const docDe = new Map(); const doc = (k) => { if (!docDe.has(k)) docDe.set(k, String(++docSeq)); return docDe.get(k); };
const pasajeros = (tag) => [1, 2].map((i) => ({ nombres: `Pax${i}`, apellidos: tag, tipoDoc: "CC", numeroDoc: doc(tag + i), fechaNacimiento: `1985-03-0${(i % 9) + 1}`, nacionalidad: "Colombia", esInfante: false }));
const reservaDe = (tag) => ({
  paqueteId: 9401, bloqueoId: null, modulo: "porcion_terrestre", hotelId: 9401, fechaIda: IDA, fechaRegreso: REG, categoria: "Estándar", regimen: "PAM",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
  cliente: { nombres: "Cliente", apellidos: tag, tipoDoc: "CC", numeroDoc: doc("C" + tag), telefono: "3000000000", email: "cliente@local.test" },
  tipoAsesor: "interno", asesorInterno: "B1 Operaciones A", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: pasajeros(tag), servicios: [],
});
const nuevaCotizacion = async (tag, quien = "A") => { const c = await como(quien, () => reservar.crearCotizacion(reservaDe(tag))); if (!c.ok) throw new Error(`crearCotizacion ${tag}: ${c.error}`); return c.id; };
/** Everything a conversion may leave behind, for ONE quotation (by quotation id) and its contract (if any). */
const foto = (cot) => {
  const n = sql(`select coalesce((select numero_contrato from public.ventas where cotizacion_id = ${cot}), '')`);
  const cuenta = (t, col = "numero_contrato") => (n ? Number(sql(`select count(*) from public.${t} where ${col} = '${n}'`)) : 0);
  return {
    numero: n || null, financiero: n ? sql(`select financiero_estado from public.ventas where numero_contrato = '${n}'`) : null,
    ventas: Number(sql(`select count(*) from public.ventas where cotizacion_id = ${cot}`)),
    cotizacion: sql(`select estado || '|' || coalesce(numero_contrato, '') from public.cotizaciones where id = ${cot}`),
    pasajeros: cuenta("contrato_pasajeros"), hoteles: cuenta("contrato_hoteles"), items: cuenta("contrato_items"), cxp: cuenta("cuentas_por_pagar") + cuenta("contrato_obligaciones_previstas"), // since #75 the payables of a PENDING contract live as «previstas» until confirmation
    reclamo: Number(sql(`select count(*) from public.cotizacion_conversion_reclamo where cotizacion_id = ${cot}`)),
  };
};

// ───────────────────────────── F1 ─────────────────────────────
async function f1() {
  console.log("\n### F1 · conversion: separate sessions, pause after the header, injected downstream failure");
  gate("pausa_hotel", false); gate("fallar_hotel", false);

  // S1 — winner paused AFTER its header was committed (header 'pendiente'); loser from ANOTHER session in the meantime.
  console.log("\n-- S1 winner paused after the header; concurrent loser; then release");
  const cot1 = await nuevaCotizacion("S1");
  const seq0 = seq();
  gate("pausa_hotel", true);
  const ganadora = como("A", () => reservar.convertirCotizacion(cot1, pasajeros("S1")));
  ganadora.then((r) => { if (!r.ok) console.log("  [winner returned early]", r.error); });
  await hasta(() => foto(cot1).ventas === 1 && retenidas("pausa_hotel") >= 1, 30000, "la ganadora retenida tras su cabecera");
  const f1a = foto(cot1);
  ok(f1a.financiero === "pendiente" && f1a.pasajeros >= 0 && f1a.hoteles === 0, `winner header committed and INCOMPLETE (financiero_estado=${f1a.financiero}, hotels=${f1a.hoteles}) — ${f1a.numero}`);
  const seqMid = seq();
  const perdedora = await como("B", () => reservar.convertirCotizacion(cot1, pasajeros("S1")));
  const f1b = foto(cot1);
  ok(!perdedora.ok && /se está convirtiendo/.test(perdedora.error ?? ""), `loser (another session) is told it is IN PROGRESS, not success (${perdedora.ok ? "OK?!" : perdedora.error})`);
  ok(seq() === seqMid, `loser spent NO contract number (sequence ${seqMid} -> ${seq()})`);
  ok(f1b.ventas === 1 && f1b.numero === f1a.numero && f1b.cotizacion.startsWith("abierta") , `still ONE header, quotation NOT marked converted (${f1b.cotizacion})`);
  const perdedora2 = await como("ADMIN", () => reservar.convertirCotizacion(cot1, pasajeros("S1")));
  ok(!perdedora2.ok && seq() === seqMid, `a third session (administracion) gets the same answer and spends nothing`);
  gate("pausa_hotel", false);
  const rGan = await ganadora;
  ok(rGan.ok && rGan.numero === f1a.numero, `winner completes with ITS number (${rGan.ok ? rGan.numero : rGan.error})`);
  const f1c = foto(cot1);
  ok(f1c.financiero === "completo" && f1c.cotizacion === `convertida|${f1a.numero}` && f1c.pasajeros === 2 && f1c.hoteles >= 1 && f1c.cxp >= 1 && f1c.reclamo === 0,
    `complete contract: ${JSON.stringify(f1c)}`);
  const replay = await como("B", () => reservar.convertirCotizacion(cot1, pasajeros("S1")));
  ok(replay.ok && replay.numero === f1a.numero && seq() === seqMid + 0, `replay after completion returns the SAME contract and spends nothing (${replay.ok ? replay.numero : replay.error})`);
  ok(seq() - seq0 === 1, `exactly ONE number spent for the whole S1 (${seq0} -> ${seq()})`);

  // S2 — winner paused, loser tries (in progress), then the winner's downstream write FAILS (injected): everything is undone, retry succeeds.
  console.log("\n-- S2 injected downstream failure after the header");
  const cot2 = await nuevaCotizacion("S2");
  const seqB = seq();
  gate("pausa_hotel", true);
  const ganadora2 = como("A", () => reservar.convertirCotizacion(cot2, pasajeros("S2")));
  await hasta(() => foto(cot2).ventas === 1 && retenidas("pausa_hotel") >= 1, 30000, "la ganadora S2 retenida");
  const numS2 = foto(cot2).numero;
  const per2 = await como("B", () => reservar.convertirCotizacion(cot2, pasajeros("S2")));
  ok(!per2.ok && /se está convirtiendo/.test(per2.error ?? "") && seq() === seqB + 1, `loser sees IN PROGRESS during the pause, no extra number (${seqB} -> ${seq()})`);
  gate("fallar_hotel", true); gate("pausa_hotel", false);
  const rGan2 = await ganadora2;
  gate("fallar_hotel", false);
  const f2 = foto(cot2);
  ok(!rGan2.ok, `winner reports the failure (${rGan2.ok ? "OK?!" : rGan2.error.slice(0, 120)})`);
  ok(f2.ventas === 0 && f2.numero === null && f2.pasajeros === 0 && f2.cxp === 0 && f2.reclamo === 0 && f2.cotizacion.startsWith("abierta|"),
    `nothing left behind: header, passengers, payables gone; quotation unchanged (${JSON.stringify(f2)})`);
  ok(sql(`select count(*) from public.ventas where numero_contrato = '${numS2}'`) === "0", `the winner's contract ${numS2} no longer exists (no dangling converted quotation)`);
  const retry2 = await como("B", () => reservar.convertirCotizacion(cot2, pasajeros("S2")));
  const f2b = foto(cot2);
  ok(retry2.ok && f2b.financiero === "completo" && f2b.cotizacion === `convertida|${retry2.numero}` && f2b.ventas === 1, `retry after the failure builds ONE complete contract (${retry2.ok ? retry2.numero : retry2.error})`);

  // S3 — simultaneous start from two sessions without any pause (several rounds): one contract, one number.
  console.log("\n-- S3 simultaneous start (5 rounds, two sessions each)");
  let s3ok = true; const detalle = [];
  for (let i = 1; i <= 5; i++) {
    const cot = await nuevaCotizacion(`S3R${i}`); const s0 = seq();
    const [r1, r2] = await Promise.all([como("A", () => reservar.convertirCotizacion(cot, pasajeros(`S3R${i}`))), como("B", () => reservar.convertirCotizacion(cot, pasajeros(`S3R${i}`)))]);
    const f = foto(cot); const gastados = seq() - s0;
    const bien = f.ventas === 1 && f.financiero === "completo" && f.reclamo === 0 && gastados === 1
      && [r1, r2].filter((r) => r.ok).every((r) => r.numero === f.numero) && [r1, r2].filter((r) => r.ok).length >= 1
      && [r1, r2].filter((r) => !r.ok).every((r) => /se está convirtiendo/.test(r.error ?? ""));
    detalle.push(`R${i}: A=${r1.ok ? r1.numero : "en curso"} B=${r2.ok ? r2.numero : "en curso"} gastados=${gastados}`); if (!bien) s3ok = false;
  }
  console.log("   " + detalle.join(" | "));
  ok(s3ok, "every round: ONE complete contract, ONE number spent, any answer is either the same completed contract or an in-progress error");

  // S4 — lease semantics: a live lease with no header (another process alive) blocks without spending; an expired one is taken over.
  console.log("\n-- S4 lease: live lease blocks, expired lease is taken over, other tenant cannot reach it");
  const cot4 = await nuevaCotizacion("S4"); const s4 = seq();
  sql(`insert into public.cotizacion_conversion_reclamo (cotizacion_id, token, expira_en) values (${cot4}, gen_random_uuid(), now() + interval '5 minutes')`);
  const bloqueada = await como("A", () => reservar.convertirCotizacion(cot4, pasajeros("S4")));
  ok(!bloqueada.ok && /se está convirtiendo/.test(bloqueada.error ?? "") && seq() === s4 && foto(cot4).ventas === 0, `live lease, no header: in-progress error, nothing spent or created`);
  sql(`update public.cotizacion_conversion_reclamo set expira_en = now() - interval '1 second' where cotizacion_id = ${cot4}`);
  const tomada = await como("A", () => reservar.convertirCotizacion(cot4, pasajeros("S4")));
  ok(tomada.ok && seq() === s4 + 1 && foto(cot4).reclamo === 0, `expired lease taken over: contract ${tomada.ok ? tomada.numero : tomada.error}, one number, lease released`);
  const cot4b = await nuevaCotizacion("S4B");
  const ajena = await como("MINORISTA", () => reservar.convertirCotizacion(cot4b, pasajeros("S4B")));
  ok(!ajena.ok && foto(cot4b).reclamo === 0 && foto(cot4b).ventas === 0, `a user of the OTHER agency is refused before any lease/number (${ajena.ok ? "OK?!" : ajena.error})`);

  // S5 — backstop for a LOST claim: B holds the claim, is paused right before it spends a number, its claim is removed (as if it had expired and been taken over),
  // A then converts normally (header committed, paused at its hotel step) and B resumes: B numbers and hits ventas_cotizacion_id_key (23505).
  // Sub-run S5a: A still INCOMPLETE when B resumes -> B must answer IN PROGRESS. Sub-run S5b: A COMPLETE when B resumes -> B returns A's contract and links the quotation.
  for (const variante of ["S5a", "S5b"]) {
    console.log(`
-- ${variante} backstop: lost claim, 23505 on the unique key (${variante === "S5a" ? "winner still incomplete" : "winner already complete"} when the loser resumes)`);
    const cot5 = await nuevaCotizacion(variante);
    const s0 = seq();
    gate("pausa_numero", true);
    const perdedoraP = como("B", () => reservar.convertirCotizacion(cot5, pasajeros(variante)));
    await hasta(() => retenidas("pausa_numero") >= 1, 30000, "the loser held right before numbering");
    sql(`delete from public.cotizacion_conversion_reclamo where cotizacion_id = ${cot5}`);   // the loser's claim is gone (expired and taken over)
    gate("pausa_hotel", true);
    const gan5 = como("A", () => reservar.convertirCotizacion(cot5, pasajeros(variante)));
    await hasta(() => foto(cot5).ventas === 1 && retenidas("pausa_hotel") >= 1, 30000, "the winner held after its header");
    const numA = foto(cot5).numero;
    if (variante === "S5b") { gate("pausa_hotel", false); const r = await gan5; ok(r.ok && foto(cot5).financiero === "completo", `winner completes first (${r.ok ? r.numero : r.error})`); }
    gate("pausa_numero", false);
    const rB = await perdedoraP;
    if (variante === "S5a") {
      ok(!rB.ok && /se está convirtiendo/.test(rB.error ?? ""), `loser hit the unique key against an INCOMPLETE header and answered IN PROGRESS (${rB.ok ? "OK?!" : rB.error.slice(0, 60)})`);
      ok(foto(cot5).ventas === 1 && foto(cot5).cotizacion.startsWith("abierta"), "still one header, quotation not converted by the loser");
      gate("pausa_hotel", false); const r = await gan5;
      ok(r.ok && foto(cot5).financiero === "completo" && foto(cot5).cotizacion === `convertida|${numA}`, `winner finishes: ${JSON.stringify(foto(cot5))}`);
    } else {
      ok(rB.ok && rB.numero === numA && foto(cot5).cotizacion === `convertida|${numA}` && foto(cot5).ventas === 1, `loser hit the unique key against a COMPLETE header: returns THAT contract (${rB.ok ? rB.numero : rB.error}) and links the quotation`);
    }
    ok(foto(cot5).reclamo === 0, "no claim left behind");
    console.log(`   numbers spent in ${variante}: ${seq() - s0} (the winner's, plus the loser's: the only path that can burn one — documented)`);
    ok(seq() - s0 === 2, `${variante}: exactly two numbers (winner + the loser that lost its claim), still ONE contract`);
  }

  // S6 (Codex C1) — NORMAL stale-read interleaving, no expired/stolen lease: B reads «ninguna» and is paused right before acquiring its claim; A converts completely and releases;
  // B resumes, acquires a FRESH claim and must REVALIDATE under it: it returns A's contract and never reaches numbering.
  console.log("\n-- S6 B paused after its initial «none» read and before the claim; A completes and releases; B resumes");
  {
    const cot6 = await nuevaCotizacion("S6"); const s0 = seq();
    gate("pausa_reclamo", true);
    const bP = como("B", () => reservar.convertirCotizacion(cot6, pasajeros("S6")));
    await hasta(() => retenidas("pausa_reclamo") >= 1, 30000, "B held right before acquiring its claim");
    ok(foto(cot6).ventas === 0 && foto(cot6).reclamo === 0, "B has read «none» and holds no claim; nothing exists yet");
    const rA = await como("A", () => reservar.convertirCotizacion(cot6, pasajeros("S6")));
    const fA = foto(cot6);
    ok(rA.ok && fA.financiero === "completo" && fA.reclamo === 0 && seq() - s0 === 1, `A completes (${rA.ok ? rA.numero : rA.error}) and released its claim; one number so far (${seq() - s0})`);
    gate("pausa_reclamo", false);
    const rB = await bP;
    const fB = foto(cot6);
    ok(rB.ok && rB.numero === fA.numero, `B returns A's EXISTING contract (${rB.ok ? rB.numero : rB.error})`);
    ok(seq() - s0 === 1, `exactly ONE number spent in total (${s0} -> ${seq()}): B did not reach numbering`);
    ok(fB.ventas === 1 && fB.financiero === "completo" && fB.cotizacion === `convertida|${fA.numero}` && fB.reclamo === 0 && fB.pasajeros === 2, `one complete contract, quotation linked, no claim left: ${JSON.stringify(fB)}`);
  }
  // S7 — same interleaving but the winner FAILS after its header (injected) and reverts: B's stale «none» was right, B must convert (one retry, one contract).
  console.log("\n-- S7 same gate; the winner's downstream write fails (injected) and reverts; B resumes and converts");
  {
    const cot7 = await nuevaCotizacion("S7"); const s0 = seq();
    gate("pausa_reclamo", true);
    const bP = como("B", () => reservar.convertirCotizacion(cot7, pasajeros("S7")));
    await hasta(() => retenidas("pausa_reclamo") >= 1, 30000, "B held right before acquiring its claim");
    gate("fallar_hotel", true);
    const rA = await como("A", () => reservar.convertirCotizacion(cot7, pasajeros("S7")));
    gate("fallar_hotel", false);
    const fA = foto(cot7);
    ok(!rA.ok && fA.ventas === 0 && fA.pasajeros === 0 && fA.cxp === 0 && fA.reclamo === 0 && fA.cotizacion.startsWith("abierta"), `A failed and left nothing behind (${rA.ok ? "OK?!" : rA.error.slice(0, 70)}); claim released`);
    gate("pausa_reclamo", false);
    const rB = await bP;
    const fB = foto(cot7);
    ok(rB.ok && fB.ventas === 1 && fB.financiero === "completo" && fB.cotizacion === `convertida|${rB.ok ? rB.numero : ""}` && fB.reclamo === 0, `B converts after the winner's failure: ONE complete contract (${rB.ok ? rB.numero : rB.error})`);
    ok(seq() - s0 === 2, `two numbers: the failed winner's (burned, unchanged behaviour) and B's (${s0} -> ${seq()})`);
  }
  // S8 — revalidation finds an INCOMPLETE header under a fresh claim (the winner's claim is gone, e.g. expired): B must answer «in progress», spend NO number and release its claim.
  console.log("\n-- S8 B acquires a claim while an INCOMPLETE header exists (winner's claim gone): in progress, no number, claim released");
  {
    const cot8 = await nuevaCotizacion("S8");
    gate("pausa_reclamo", true);
    const bP = como("B", () => reservar.convertirCotizacion(cot8, pasajeros("S8")));
    await hasta(() => retenidas("pausa_reclamo") >= 1, 30000, "B held right before acquiring its claim");
    gate("pausa_hotel", true);
    const aP = como("A", () => reservar.convertirCotizacion(cot8, pasajeros("S8")));
    await hasta(() => foto(cot8).ventas === 1 && retenidas("pausa_hotel") >= 1, 30000, "A held after its header");
    sql(`delete from public.cotizacion_conversion_reclamo where cotizacion_id = ${cot8}`);   // A's claim is gone (expired)
    const sMid = seq();
    gate("pausa_reclamo", false);
    const rB = await bP;
    ok(!rB.ok && /se está convirtiendo/.test(rB.error ?? ""), `B revalidated under its claim and answered IN PROGRESS (${rB.ok ? "OK?!" : rB.error.slice(0, 60)})`);
    ok(seq() === sMid && foto(cot8).reclamo === 0 && foto(cot8).ventas === 1, `no number spent by B (${sMid} -> ${seq()}); B's claim released`);
    gate("pausa_hotel", false);
    const rA = await aP;
    ok(rA.ok && foto(cot8).financiero === "completo" && foto(cot8).cotizacion === `convertida|${rA.ok ? rA.numero : ""}`, `A finishes: one complete contract (${rA.ok ? rA.numero : rA.error})`);
  }
}

// ───────────────────────────── F2 ─────────────────────────────
async function f2() {
  console.log("\n### F2 · air vouchers per CONTRACTED SERVICE (ADL-041/042): saved service identity (not the PNR), issued URLs through the serving boundary, reconciliation, signals, atomicity, roles");
  const { identidadDe } = await import("../../lib/contrato/identidad.ts");
  const { accesoVoucherPorToken } = await import("../../lib/voucher/accesoVoucher.server.ts");
  const { vueloVisible } = await import("../../lib/voucher/pnrVoucher.ts");
  const { contratoPagadoCompleto } = await import("../../lib/voucher/pagoCompleto.ts");
  const { cargarGestionContratos } = await import("../../lib/gestionContratos/cargar.server.ts");
  const gestion = await import("../../app/(dashboard)/dashboard/gestion-contratos/actions.ts");
  const editorVuelos = await import("../../app/(dashboard)/dashboard/vuelos/contrato-vuelos-actions.ts");
  const contenidoActs = await import("../../app/(dashboard)/dashboard/contratos/[numero]/contenido-actions.ts");
  const uidDe = (n) => sql(`select contrato_uid from public.ventas where numero_contrato = '${n}'`);
  const idDe = (n) => identidadDe(n, uidDe(n));
  const SV = (k) => `00000000-0000-4000-9000-${String(k).padStart(12, "0")}`;
  const crear = (n, o = {}) => {
    const { asesor = "B1 Administracion", aliado = false, precio = 1000000, pax = 3 } = o;
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, aerolinea, asesor, estado, precio_venta, moneda${aliado ? ", aliado_id, tipo_asesor, agencia_nombre" : ""})
      values ('${n}', 'Cliente ${n}', 'mayorista', 'dinamico', 'Avianca', '${asesor}', 'confirmado', ${precio}, 'COP'${aliado ? ", 9409, 'agencia', 'B1 ALIADO AGENCIA'" : ""})`);
    for (let i = 0; i < pax; i++) sql(`insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden) values ('${n}', 'Pasajero${i} Prueba', 'Pasajero${i}', 'Prueba', ${i})`);
  };
  let orden = 0;
  // `svc` = the SAVED service of the leg (null → the default trigger gives every leg a contract receives in one transaction ONE service).
  const leg = (n, dir, o, d, f, vuelo, record, svc = null) => sql(`insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, destino_codigo, fecha_salida, numero_vuelo, hora_salida, hora_llegada, record, servicio_aereo, orden)
      values ('${n}', 'Avianca', '${dir}', '${o}', '${d}', '${f}', '${vuelo}', '08:15', '09:45', ${record ? `'${record}'` : "null"}, ${svc ? `'${svc}'` : "null"}, ${orden++})`);
  const idaVuelta = (n, rIda, rReg, base, svc) => { leg(n, "ida", "BOG", "CTG", "2027-06-07", `AV${base}1`, rIda, svc); leg(n, "regreso", "CTG", "BOG", "2027-06-10", `AV${base}2`, rReg, svc); };
  const filas = (n) => Number(sql(`select count(*) from public.vouchers where numero_contrato = '${n}' and tipo = 'vuelo'`));
  const lista = (n) => sql(`select servicio_clave || '|' || id || '|' || share_token || '|' || revision || '|' || md5(contenido::text) || '|' || estado from public.vouchers where numero_contrato = '${n}' and tipo = 'vuelo' order by id`).split("\n").filter(Boolean);
  const porClave = (n, clave) => lista(n).find((l) => l.split("|")[0] === String(clave));
  const campo = (l, i) => (l ?? "|||||").split("|")[i]; // 0 clave, 1 id, 2 token, 3 revision, 4 md5, 5 estado
  const contenidoDe = (n, clave) => JSON.parse(sql(`select contenido::text from public.vouchers where numero_contrato = '${n}' and tipo = 'vuelo' and servicio_clave = '${clave}'`));
  const huella = (n, tipo) => sql(`select coalesce(md5(string_agg(id || share_token::text || contenido::text || revision::text, '|' order by id)), 'none') from public.vouchers where numero_contrato = '${n}' and tipo = '${tipo}'`);
  const gen = (quien, n) => como(quien, () => vouchers.generarVoucherVuelo(n, idDe(n)));
  const filaGestion = async (n) => { const g = await como("SUPER", () => cargarGestionContratos({ numero: n })); if (g.estado !== "ok") throw new Error(`gestión: ${g.estado}`); return g.datos.filas.find((f) => f.numero === n)?.voucher; };
  const pagoRpc = () => (globalThis.__conteo["POST /rpc/contratos_pagados_completos"] ?? 0);
  const abrir = (quien, tok) => como(quien, () => accesoVoucherPorToken(tok));
  const pagar = (n) => sql(`insert into public.abonos (numero_contrato, valor_abono) values ('${n}', 1000000)`);
  // The legs as the flight editor would send them back (servicio "" = keep the saved one); `cambia(t, i)` edits the payload.
  const tramosDe = (n, cambia = () => ({})) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(t)), '[]') from (select id, aerolinea, record, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, numero_vuelo, fecha_salida, hora_salida, hora_llegada, servicios from public.contrato_vuelos where numero_contrato = '${n}' order by orden, id) t`))
    .map((t, i) => ({ id: t.id, aerolinea: t.aerolinea ?? "", record: t.record ?? "", direccion: t.direccion ?? "", origenCodigo: t.origen_codigo ?? "", origenCiudad: t.origen_ciudad ?? "", destinoCodigo: t.destino_codigo ?? "", destinoCiudad: t.destino_ciudad ?? "",
      numeroVuelo: t.numero_vuelo ?? "", fecha: t.fecha_salida ?? "", horaSalida: t.hora_salida ?? "", horaLlegada: t.hora_llegada ?? "", servicios: t.servicios ?? "", servicio: "", ...cambia(t, i) }));
  const editor = (n, tramos, quien = "CONTROL_VUELO") => como(quien, () => editorVuelos.guardarTramosContrato(n, tramos, idDe(n)));
  const svcDeLeg = (id) => sql(`select coalesce(servicio_aereo::text, '') from public.contrato_vuelos where id = ${id}`);
  gate("fallar_voucher", false); gate("pausa_voucher", false);

  // ───────────── A · PNR: missing / present, paid / unpaid access, contract unaffected ─────────────
  console.log("\n-- A1 generation WITHOUT a saved PNR is allowed; the legs of a reservation share ONE service by default");
  crear("DTM-9511", { aliado: true });
  sql(`insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, destino_codigo, fecha_salida, numero_vuelo, hora_salida, hora_llegada, orden) values
    ('DTM-9511', 'Avianca', 'ida', 'BOG', 'CTG', '2027-06-07', 'AV111', '08:15', '09:45', 0), ('DTM-9511', 'Avianca', 'regreso', 'CTG', 'BOG', '2027-06-10', 'AV112', '08:15', '09:45', 1)`);
  sql("insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-9511', 'hotel', 'Hotel X', '{\"clase\":\"hotel\",\"x\":1}'), ('DTM-9511', 'servicios', 'Prov Y', '{\"clase\":\"servicios\",\"y\":2}')");
  const otros0 = huella("DTM-9511", "hotel") + huella("DTM-9511", "servicios");
  const servicioA1 = sql("select distinct servicio_aereo from public.contrato_vuelos where numero_contrato = 'DTM-9511'");
  const a1 = await gen("ADMIN", "DTM-9511");
  const [clave1, id1, tok1] = (lista("DTM-9511")[0] ?? "||").split("|");
  ok(a1.ok && a1.creados === 1 && filas("DTM-9511") === 1 && !/pnr/i.test(JSON.stringify(contenidoDe("DTM-9511", clave1))), `no PNR saved: the voucher is created (${JSON.stringify(a1)}) and carries no PNR field`);
  ok(/^[0-9a-f-]{36}$/.test(servicioA1) && clave1 === servicioA1, `the legs got ONE saved service by default (${servicioA1}) and the voucher key IS that saved service, not a leg id, name or position`);
  const j1 = contenidoDe("DTM-9511", clave1);
  ok(j1.tramos.length === 2 && j1.pasajeros.length === 3, "both legs of the round trip are in ONE voucher; the 3 passengers are listed once (not one voucher per passenger)");

  console.log("\n-- A2 unpaid contract: the ally cannot open it");
  const aliadoImpago = await abrir("ALIADO", tok1);
  ok(!aliadoImpago.ok && aliadoImpago.motivo === "pago_incompleto", `ally, contract not paid: denied (${aliadoImpago.ok ? "OPENED?!" : aliadoImpago.motivo})`);

  console.log("\n-- A3 the PNR is saved LATER on each leg with DIFFERENT PNRs (real flight editor): the voucher is flagged, regeneration keeps the SAME link");
  const sPnr = await editor("DTM-9511", tramosDe("DTM-9511", (t, i) => ({ record: i === 0 ? "XYZ123" : "QWE456" })));
  ok(sPnr.ok && sql("select count(*) from public.contrato_vuelos where numero_contrato = 'DTM-9511' and record in ('XYZ123','QWE456')") === "2" && svcDeLeg(sPnr.tramos[0].id) === servicioA1 && svcDeLeg(sPnr.tramos[1].id) === servicioA1, `the editor saves a different PNR per leg and both legs stay in the SAME service (${sPnr.ok ? "ok" : sPnr.error})`);
  ok(campo(lista("DTM-9511")[0], 5) === "revisar" && campo(lista("DTM-9511")[0], 3) === "1", "the saved change flags the issued voucher «revisar» at once (revision 1) — before anyone regenerates");
  const a3 = await gen("ADMIN", "DTM-9511");
  const [, id3, tok3, rev3, , est3] = lista("DTM-9511")[0].split("|");
  ok(a3.ok && a3.creados === 0 && a3.actualizados === 1 && filas("DTM-9511") === 1 && id3 === id1 && tok3 === tok1 && est3 === "vigente" && rev3 === "2", `regeneration: SAME row and link, back to «vigente», one real content change (${JSON.stringify(a3)}, revision ${rev3})`);
  const c3 = contenidoDe("DTM-9511", clave1);
  ok(c3.tramos[0].pnr === "XYZ123" && c3.tramos[1].pnr === "QWE456" && filas("DTM-9511") === 1, "ONE voucher shows each saved record against ITS leg (XYZ123 on the outbound, QWE456 on the return); no passenger-to-leg assignment invented");

  console.log("\n-- A4 internal preview of the UNPAID contract hides every PNR (and says so); the ally is still denied");
  const interno = await abrir("ADMIN", tok1);
  ok(interno.ok && interno.modo === "interno", "internal staff open the preview before payment");
  const p0 = pagoRpc();
  const vInterno = await como("ADMIN", () => vueloVisible(interno.voucher.contenido, interno.modo, "DTM-9511", contratoPagadoCompleto));
  ok(!/XYZ123|QWE456|pnr/i.test(JSON.stringify(vInterno.contenido)) && vInterno.pnrPendientePago === true && pagoRpc() - p0 === 1, `unpaid: no PNR reaches what the page renders and a note is shown (payment lookups for this view: ${pagoRpc() - p0})`);
  ok(!(await abrir("ALIADO", tok1)).ok, "ally, still unpaid: denied");

  console.log("\n-- A5 paid contract: the ally opens it and sees both PNRs with NO extra payment lookup; internal staff see them too");
  pagar("DTM-9511");
  const p1 = pagoRpc();
  const aliadoPago = await abrir("ALIADO", tok1);
  const p2 = pagoRpc();
  ok(aliadoPago.ok && aliadoPago.modo === "aliado", `paid: the ally opens the voucher (payment lookups in the existing access check: ${p2 - p1})`);
  const vAliado = await como("ALIADO", () => vueloVisible(aliadoPago.voucher.contenido, aliadoPago.modo, "DTM-9511", contratoPagadoCompleto));
  ok(vAliado.contenido.tramos[0].pnr === "XYZ123" && vAliado.contenido.tramos[1].pnr === "QWE456" && vAliado.pnrPendientePago === false && pagoRpc() === p2, `the ally view shows XYZ123 / QWE456 per leg and adds ${pagoRpc() - p2} requests`);
  const interno2 = await abrir("ADMIN", tok1);
  const vInterno2 = await como("ADMIN", () => vueloVisible(interno2.voucher.contenido, "interno", "DTM-9511", contratoPagadoCompleto));
  ok(vInterno2.contenido.tramos[0].pnr === "XYZ123" && !vInterno2.pnrPendientePago, "internal preview of the paid contract shows the PNRs (one payment lookup, only because a PNR exists)");
  sql("update public.abonos set valor_abono = 10 where numero_contrato = 'DTM-9511'");
  ok(!(await abrir("ALIADO", tok1)).ok, "if the balance rises again the ally is blocked again (nothing is deleted)");
  sql("update public.abonos set valor_abono = 1000000 where numero_contrato = 'DTM-9511'");
  ok(!(await abrir("VENTA_OTRO", tok1)).ok && !(await abrir("MINORISTA", tok1)).ok, "a colleague venta user and the other agency cannot open it");

  console.log("\n-- A6 the contract (customer document) never receives the PNR");
  const sinComentarios = (f) => readFileSync(f, "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
  ok(!/\.record\b|\brecord:|PNR/.test(sinComentarios("components/contrato/ContratoDocumento.tsx")) && !/\.record\b|\brecord[,:]/.test(sinComentarios("app/contrato/[numero]/page.tsx")), "ContratoDocumento and the contract page do not read or render record/PNR in code (the customer contract keeps hiding it)");

  console.log("\n-- A7 the PNRs removed again: regeneration is still allowed (absence never blocks) and keeps the link");
  sql("update public.contrato_vuelos set record = null where numero_contrato = 'DTM-9511'");
  const a7 = await gen("ADMIN", "DTM-9511");
  ok(a7.ok && a7.actualizados === 1 && !/pnr/i.test(JSON.stringify(contenidoDe("DTM-9511", clave1))) && campo(lista("DTM-9511")[0], 2) === tok1 && campo(lista("DTM-9511")[0], 5) === "vigente", "regenerated without PNR: same link, no PNR field, «vigente»");
  ok(huella("DTM-9511", "hotel") + huella("DTM-9511", "servicios") === otros0, "hotel and service vouchers are byte-identical after all the air regenerations");

  // ───────────── B · distinct services, independent of the PNR ─────────────
  console.log("\n-- B1 one service with DIFFERENT PNRs per leg = ONE voucher; two services with the SAME PNR = TWO vouchers; services with NO PNR stay separate");
  crear("DTM-9512", { pax: 3 });
  idaVuelta("DTM-9512", "AAA111", "BBB222", 21, SV(121));        // one service: outbound AAA111, return BBB222
  idaVuelta("DTM-9512", "SAME00", "SAME00", 31, SV(122));        // another service with a record equal to...
  idaVuelta("DTM-9512", "SAME00", "SAME00", 41, SV(123));        // ...this third one
  leg("DTM-9512", "ida", "CTG", "SMR", "2027-06-12", "AV901", null, SV(124)); leg("DTM-9512", "ida", "SMR", "CTG", "2027-06-14", "AV902", null, SV(125)); // two services without any PNR
  const b1 = await gen("ADMIN", "DTM-9512");
  const l1 = lista("DTM-9512");
  ok(b1.ok && b1.creados === 5 && l1.length === 5 && new Set(l1.map((l) => campo(l, 2))).size === 5 && l1.map((l) => campo(l, 0)).sort().join() === [121, 122, 123, 124, 125].map(SV).sort().join(), `5 saved services (PNRs: AAA111+BBB222 / SAME00 / SAME00 / none / none) → exactly 5 vouchers with 5 distinct links (${JSON.stringify(b1)})`);
  const cA = contenidoDe("DTM-9512", SV(121));
  ok(cA.tramos.length === 2 && cA.tramos[0].pnr === "AAA111" && cA.tramos[1].pnr === "BBB222" && cA.tramos.every((t) => /^AV2/.test(t.numeroVuelo)) && contenidoDe("DTM-9512", SV(122)).tramos.every((t) => /^AV3/.test(t.numeroVuelo)),
    "the round trip with two PNRs is ONE voucher that shows each record on its leg; the same-record services keep only their own legs");
  ok(cA.pasajeros.length === 3 && /no hay registrada una asignación/.test(readFileSync("components/voucher/VoucherVueloDocumento.tsx", "utf8")), "passengers stay a contract-level list and the document still says no passenger-to-segment assignment is registered");

  console.log("\n-- B2 identical replay: nothing changes, no revision, no new link");
  const b2 = await gen("A", "DTM-9512");
  ok(b2.ok && b2.creados === 0 && b2.actualizados === 0 && JSON.stringify(lista("DTM-9512")) === JSON.stringify(l1), `identical retry by another operator: ${JSON.stringify(b2)} and every row (id, token, revision, content, state) is identical`);

  console.log("\n-- B3 regenerate after ONE service changed: its link is kept, the other services and the hotel voucher are untouched");
  sql("insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-9512', 'hotel', 'Hotel X', '{\"clase\":\"hotel\"}')");
  const hotel3 = huella("DTM-9512", "hotel");
  sql("update public.contrato_vuelos set numero_vuelo = 'AV399' where numero_contrato = 'DTM-9512' and numero_vuelo = 'AV312'");
  const marca3 = lista("DTM-9512");
  ok(marca3.filter((l) => campo(l, 5) === "revisar").map((l) => campo(l, 0)).join() === SV(122) && marca3.filter((l) => campo(l, 5) === "vigente").length === 4, "editing a leg flags ONLY its own service «revisar» (the other four stay «vigente»)");
  const b3 = await gen("ADMIN", "DTM-9512");
  const l3 = lista("DTM-9512");
  ok(b3.ok && b3.creados === 0 && b3.actualizados === 1 && campo(porClave("DTM-9512", SV(122)), 2) === campo(l1.find((l) => campo(l, 0) === SV(122)), 2) && l3.every((l) => campo(l, 5) === "vigente"), `service 122 regenerated at the SAME link; every voucher «vigente» again (${JSON.stringify(b3)})`);
  ok(l3.filter((l) => campo(l, 0) !== SV(122)).every((l) => l === l1.find((x) => campo(x, 0) === campo(l, 0))), "the other four services are byte-identical");
  ok(huella("DTM-9512", "hotel") === hotel3, "the hotel voucher is byte-identical");

  console.log("\n-- B4 a leg with NO saved service is refused BEFORE anything is written (never assigned by PNR, position or id)");
  const antesB4 = JSON.stringify(lista("DTM-9512"));
  sql("update public.contrato_vuelos set servicio_aereo = null where numero_contrato = 'DTM-9512' and numero_vuelo = 'AV902'");
  const b4 = await gen("ADMIN", "DTM-9512");
  ok(!b4.ok && /sin servicio aéreo asociado/.test(b4.error), `generation refused with a clear message (${b4.ok ? "OK?!" : b4.error.slice(0, 90)})`);
  const lB4 = lista("DTM-9512");
  ok(JSON.stringify(lB4.filter((l) => campo(l, 0) !== SV(125))) === JSON.stringify(JSON.parse(antesB4).filter((l) => campo(l, 0) !== SV(125))), "no voucher was created, changed or retired by the refused attempt (the orphaned service's voucher is flagged by the leg change itself)");
  const asoc = await editor("DTM-9512", tramosDe("DTM-9512", (t) => (t.numero_vuelo === "AV902" ? { servicio: SV(124) } : {})));
  ok(asoc.ok && svcDeLeg(asoc.tramos.find((t) => t.numero_vuelo === "AV902").id) === SV(124), "staff associate the leg explicitly in the flight editor (to service 124)");
  ok(campo(porClave("DTM-9512", SV(124)), 5) === "revisar", "the leg joining service 124 flags that voucher «revisar» at once (its itinerary changed) — before anyone regenerates");
  const b4b = await gen("ADMIN", "DTM-9512");
  ok(b4b.ok && campo(porClave("DTM-9512", SV(124)), 5) === "vigente" && campo(porClave("DTM-9512", SV(125)), 5) === "retirado" && filas("DTM-9512") === 5, `after the explicit association the generation works; the service left without legs is «retirado» and kept (${JSON.stringify(b4b)})`);

  // ───────────── C · Gestión de contratos: the internal signal ─────────────
  console.log("\n-- C1 Gestión de contratos: acknowledge, replay, leg change (before regenerating), regeneration, re-acknowledge");
  const acuse = (n, accion = "marcar") => como("SUPER", () => gestion.registrarSeguimiento({ numero: n, uid: uidDe(n), tipo: "voucher_entregado", accion, canal: "correo" }));
  const v0 = await filaGestion("DTM-9512");
  ok(v0.n === 6 && v0.entrega === "pendiente" && v0.actualizado === false && v0.aereoNoVigente === 1, `no acknowledgment yet: 6 vouchers = 5 air (one retired earlier) + the hotel one, delivery pending, no «updated» signal, the retired one counted as not current (${v0.entrega}, aereoNoVigente ${v0.aereoNoVigente})`);
  const r1 = await acuse("DTM-9512"), r1b = await acuse("DTM-9511");
  const v1 = await filaGestion("DTM-9512");
  ok(r1.ok && r1b.ok && v1.entrega === "entregado" && v1.actualizado === false, "the superadmin registers the manual delivery: «entregado» (an acknowledgment of the staff, nothing sent)");
  const antesGen = JSON.stringify(lista("DTM-9512"));
  await gen("ADMIN", "DTM-9512");
  const v2 = await filaGestion("DTM-9512");
  ok(JSON.stringify(lista("DTM-9512")) === antesGen && v2.entrega === "entregado" && v2.actualizado === false && v2.acuseAnterior === false, "an IDENTICAL regeneration after the delivery raises NO signal");
  sql("update public.contrato_vuelos set hora_salida = '10:30' where numero_contrato = 'DTM-9512' and numero_vuelo = 'AV211'");
  const v3 = await filaGestion("DTM-9512");
  ok(v3.entrega === "pendiente" && v3.actualizado === true && v3.acuseAnterior === true && v3.aereoNoVigente === 2 && v3.evento === "marcar", `a leg change after the delivery already raises the signal, BEFORE regenerating: pendiente + updated + ${v3.aereoNoVigente} vouchers not current (the changed one + the retired one), earlier acknowledgment still visible`);
  const cGen3 = await gen("ADMIN", "DTM-9512");
  const v3b = await filaGestion("DTM-9512");
  ok(cGen3.ok && cGen3.actualizados === 1 && v3b.aereoNoVigente === 1 && v3b.actualizado === true && v3b.entrega === "pendiente", "regenerating returns the voucher to current; the communication stays pending until staff register it again");
  const c3b = await gen("ADMIN", "DTM-9512");
  const v3c = await filaGestion("DTM-9512");
  ok(c3b.actualizados === 0 && JSON.stringify(v3c) === JSON.stringify(v3b), "retrying adds nothing: the notice is not duplicated");
  const vOtro = await filaGestion("DTM-9511");
  ok(vOtro.entrega === "entregado" && vOtro.actualizado === false, "the other contract (also acknowledged, not touched) is not flagged");
  const retiro = await acuse("DTM-9512", "desmarcar");
  ok(!retiro.ok, "retiring the superseded acknowledgment is refused (there is nothing current to retire)");
  const r4 = await acuse("DTM-9512");
  const v4 = await filaGestion("DTM-9512");
  ok(r4.ok && v4.entrega === "entregado" && v4.actualizado === false, "registering the communication again clears the signal; it never claimed delivery, reading or acceptance by the customer");

  console.log("\n-- C2 roles: only the superadmin sees Gestión or registers acknowledgments");
  const rolesG = {};
  for (const quien of ["ADMIN", "A", "VENTA_DUENO", "ALIADO"]) { const g = await como(quien, () => cargarGestionContratos({ numero: "DTM-9512" })); const r = await como(quien, () => gestion.registrarSeguimiento({ numero: "DTM-9512", uid: uidDe("DTM-9512"), tipo: "voucher_entregado", accion: "marcar", canal: "correo" })); rolesG[quien] = `${g.estado}/${r.ok ? "si" : "no"}`; }
  console.log("   " + JSON.stringify(rolesG));
  ok(Object.values(rolesG).every((v) => v === "sin_permiso/no"), "administracion, operaciones, venta and the ally: no Gestión, no acknowledgment");

  // ───────────── D · transitions through the REAL actions, with the issued URLs checked at the serving boundary ─────────────
  console.log("\n-- D1 remove the lowest-id leg («anchor») of a service through the flight editor: the issued URL stops serving the old itinerary; regeneration keeps the SAME link");
  crear("DTM-9520", { aliado: true }); pagar("DTM-9520");
  idaVuelta("DTM-9520", "KKK111", "LLL222", 51, SV(151)); idaVuelta("DTM-9520", "MMM333", "MMM333", 61, SV(152));
  await gen("ADMIN", "DTM-9520");
  const [kX, , tX] = lista("DTM-9520").find((l) => campo(l, 0) === SV(151)).split("|"), tY = campo(porClave("DTM-9520", SV(152)), 2);
  ok(kX === SV(151) && (await abrir("ALIADO", tX)).ok && (await abrir("ALIADO", tY)).ok, "both issued URLs open for the paid ally (current)");
  const idAncla = Number(sql("select min(id) from public.contrato_vuelos where numero_contrato = 'DTM-9520' and servicio_aereo = '" + SV(151) + "'"));
  const d1 = await editor("DTM-9520", tramosDe("DTM-9520").filter((t) => t.id !== idAncla));
  ok(d1.ok && sql(`select count(*) from public.contrato_vuelos where id = ${idAncla}`) === "0", `the anchor leg ${idAncla} is removed through the real editor (${d1.ok ? "ok" : d1.error})`);
  const rAliado = await abrir("ALIADO", tX), rInterno = await abrir("ADMIN", tX), rY = await abrir("ALIADO", tY);
  ok(!rAliado.ok && rAliado.motivo === "no_vigente", `the OLD issued URL no longer serves the old itinerary to the ally (${rAliado.ok ? "SERVED?!" : rAliado.motivo})`);
  ok(rInterno.ok && rInterno.voucher.estado === "revisar", "internal staff still reach it, marked «revisar» (the page prints an explicit «desactualizado» banner)");
  ok(rY.ok && rY.voucher.estado === "vigente", "the other service's URL is untouched and current");
  ok((await filaGestion("DTM-9520")).aereoNoVigente === 1, "Gestión counts one air voucher as not current");
  const d1b = await gen("ADMIN", "DTM-9520");
  const rAliado2 = await abrir("ALIADO", tX);
  ok(d1b.ok && campo(porClave("DTM-9520", SV(151)), 2) === tX && rAliado2.ok && rAliado2.voucher.contenido.tramos.length === 1 && campo(porClave("DTM-9520", SV(151)), 5) === "vigente", `regeneration keeps the SAME link for the SAME service; it now serves the UPDATED itinerary (1 leg), «vigente» (${JSON.stringify(d1b)})`);

  console.log("\n-- D2 remove a whole service through the editor: its URL is RETIRED (history kept), regeneration never revives or recreates it");
  const d2 = await editor("DTM-9520", tramosDe("DTM-9520").filter((t) => svcDeLeg(t.id) !== SV(152)));
  const rY2 = await abrir("ALIADO", tY), rY2i = await abrir("ADMIN", tY);
  ok(d2.ok && !rY2.ok && rY2.motivo === "no_vigente" && rY2i.ok && rY2i.voucher.estado === "retirado" && campo(porClave("DTM-9520", SV(152)), 5) === "retirado", `the removed service's URL is «retirado» immediately: the ally gets no itinerary; staff see the state (${rY2.ok ? "SERVED?!" : rY2.motivo})`);
  const d2b = await gen("ADMIN", "DTM-9520");
  ok(d2b.ok && filas("DTM-9520") === 2 && campo(porClave("DTM-9520", SV(152)), 5) === "retirado" && campo(porClave("DTM-9520", SV(152)), 2) === tY && campo(porClave("DTM-9520", SV(151)), 5) === "vigente", "regeneration after the removal: the retired voucher row (token, history) is kept, not revived, not duplicated; the surviving service stays current");
  const vG = await filaGestion("DTM-9520");
  ok(vG.aereoNoVigente === 1, "Gestión keeps showing the retired voucher as not current until it is dealt with");

  console.log("\n-- D3 MERGE two services explicitly in the editor: the absorbed one is retired, the surviving one keeps its link and shows both legs after regeneration");
  crear("DTM-9521", { aliado: true }); pagar("DTM-9521");
  idaVuelta("DTM-9521", null, null, 71, SV(171)); idaVuelta("DTM-9521", null, null, 81, SV(172));
  await gen("ADMIN", "DTM-9521");
  const [tP, tQ] = [campo(porClave("DTM-9521", SV(171)), 2), campo(porClave("DTM-9521", SV(172)), 2)];
  const d3 = await editor("DTM-9521", tramosDe("DTM-9521", (t) => (svcDeLeg(t.id) === SV(172) ? { servicio: SV(171) } : {})));
  ok(d3.ok && d3.tramos.every((t) => t.servicio_aereo === SV(171)), "the staff move the legs of service 172 into service 171 (explicit choice in the editor)");
  const mQ = await abrir("ALIADO", tQ), mP = await abrir("ALIADO", tP);
  ok(!mQ.ok && mQ.motivo === "no_vigente" && campo(porClave("DTM-9521", SV(172)), 5) === "retirado" && !mP.ok && mP.motivo === "no_vigente" && campo(porClave("DTM-9521", SV(171)), 5) === "revisar", "after the merge neither old URL serves an itinerary until regenerated (absorbed = retirado; surviving = revisar)");
  const d3b = await gen("ADMIN", "DTM-9521");
  const mP2 = await abrir("ALIADO", tP);
  ok(d3b.ok && mP2.ok && mP2.voucher.contenido.tramos.length === 4 && campo(porClave("DTM-9521", SV(171)), 2) === tP && !(await abrir("ALIADO", tQ)).ok, `the surviving service keeps its link and now lists the 4 legs; the absorbed URL stays retired (${JSON.stringify(d3b)})`);

  console.log("\n-- D4 SPLIT explicitly: a leg moves to «nuevo:1» — the original keeps its link; the new service gets a NEW voucher/link on regeneration");
  crear("DTM-9522", { aliado: true }); pagar("DTM-9522");
  idaVuelta("DTM-9522", null, null, 91, SV(191));
  await gen("ADMIN", "DTM-9522");
  const tR = campo(porClave("DTM-9522", SV(191)), 2);
  const d4 = await editor("DTM-9522", tramosDe("DTM-9522", (t) => (t.direccion === "regreso" ? { servicio: "nuevo:1" } : {})));
  ok(d4.ok && new Set(d4.tramos.map((t) => t.servicio_aereo)).size === 2 && campo(porClave("DTM-9522", SV(191)), 5) === "revisar", "the split creates a second saved service and flags the original");
  const d4b = await gen("ADMIN", "DTM-9522");
  const l4 = lista("DTM-9522");
  const nuevaClave = l4.map((l) => campo(l, 0)).find((k) => k !== SV(191));
  ok(d4b.ok && d4b.creados === 1 && d4b.actualizados === 1 && l4.length === 2 && campo(porClave("DTM-9522", SV(191)), 2) === tR && campo(porClave("DTM-9522", nuevaClave), 2) !== tR && l4.every((l) => campo(l, 5) === "vigente"), `original keeps its link (now 1 leg); the new service has its own voucher and link (${JSON.stringify(d4b)})`);

  console.log("\n-- D5 the contract-content editor (superadmin) re-creates the legs of a SINGLE service: link kept; with several services it refuses and changes nothing");
  crear("DTM-9515"); idaVuelta("DTM-9515", "CCC333", "CCC333", 41, SV(141));
  await gen("ADMIN", "DTM-9515");
  const [k0, i0, t0] = lista("DTM-9515")[0].split("|");
  const legsNuevos = ["ida", "regreso"].map((d, i) => ({ aerolinea: "Avianca", record: "CCC333", direccion: d, origenCodigo: i ? "CTG" : "BOG", destinoCodigo: i ? "BOG" : "CTG", numeroVuelo: `AV41${i + 1}`, fecha: i ? "2027-06-10" : "2027-06-07", horaSalida: "08:15", horaLlegada: "09:45", servicios: "" }));
  const gv = await como("SUPER", () => contenidoActs.guardarVuelosContrato("DTM-9515", legsNuevos, idDe("DTM-9515")));
  ok(gv.ok && sql("select count(distinct servicio_aereo) from public.contrato_vuelos where numero_contrato = 'DTM-9515'") === "1" && campo(lista("DTM-9515")[0], 5) === "revisar", "legs re-created with NEW ids inherit the single saved service; the voucher is flagged «revisar»");
  const d5 = await gen("ADMIN", "DTM-9515");
  ok(d5.ok && filas("DTM-9515") === 1 && campo(lista("DTM-9515")[0], 1) === i0 && campo(lista("DTM-9515")[0], 2) === t0 && k0 === SV(141) && campo(lista("DTM-9515")[0], 0) === SV(141) && campo(lista("DTM-9515")[0], 5) === "vigente", `regeneration keeps voucher ${i0} and its link (key ${SV(141)} unchanged although every leg id changed)`);
  const antesMulti = JSON.stringify(lista("DTM-9512")), legsMulti = sql("select string_agg(id::text, ',' order by id) from public.contrato_vuelos where numero_contrato = 'DTM-9512'");
  const gvMulti = await como("SUPER", () => contenidoActs.guardarVuelosContrato("DTM-9512", legsNuevos, idDe("DTM-9512")));
  ok(!gvMulti.ok && /varios servicios aéreos/.test(gvMulti.error) && sql("select string_agg(id::text, ',' order by id) from public.contrato_vuelos where numero_contrato = 'DTM-9512'") === legsMulti && JSON.stringify(lista("DTM-9512")) === antesMulti, "with several services the content editor refuses BEFORE touching anything (no guessing which service the new legs belong to)");

  console.log("\n-- D6 ambiguous editor input is rejected before any mutation");
  const antesD6 = JSON.stringify(lista("DTM-9512")), legsD6 = sql("select md5(string_agg(id || coalesce(servicio_aereo::text, '') || coalesce(numero_vuelo, ''), '|' order by id)) from public.contrato_vuelos where numero_contrato = 'DTM-9512'");
  const nuevoAmbiguo = [...tramosDe("DTM-9512"), { id: null, aerolinea: "Avianca", record: "", direccion: "ida", origenCodigo: "BOG", origenCiudad: "", destinoCodigo: "CTG", destinoCiudad: "", numeroVuelo: "AV777", fecha: "2027-06-20", horaSalida: "", horaLlegada: "", servicios: "", servicio: "" }];
  const d6 = await editor("DTM-9512", nuevoAmbiguo);
  const d6b = await editor("DTM-9512", tramosDe("DTM-9512", (t, i) => (i === 0 ? { servicio: SV(999) } : {})));
  ok(!d6.ok && /varios servicios aéreos/.test(d6.error) && !d6b.ok && /no existe en este contrato/.test(d6b.error) && JSON.stringify(lista("DTM-9512")) === antesD6
    && sql("select md5(string_agg(id || coalesce(servicio_aereo::text, '') || coalesce(numero_vuelo, ''), '|' order by id)) from public.contrato_vuelos where numero_contrato = 'DTM-9512'") === legsD6, "a new leg with no service among several services, and an unknown service id, are both rejected; legs and vouchers are untouched");

  // ───────────── E · atomicity, concurrency and stale reads ─────────────
  console.log("\n-- E1 atomic: a failure on the SECOND service rolls back the whole regeneration");
  crear("DTM-9513"); idaVuelta("DTM-9513", "DDD444", "DDD444", 51, SV(131)); idaVuelta("DTM-9513", "EEE555", "EEE555", 61, SV(132));
  await gen("ADMIN", "DTM-9513");
  const l5 = lista("DTM-9513");
  sql("update public.contrato_vuelos set numero_vuelo = numero_vuelo || 'X' where numero_contrato = 'DTM-9513'");
  const flagged = lista("DTM-9513");
  gate(`fallar_voucher:${SV(132)}`, true);
  const e1 = await gen("ADMIN", "DTM-9513");
  gate(`fallar_voucher:${SV(132)}`, false);
  ok(!e1.ok && JSON.stringify(lista("DTM-9513")) === JSON.stringify(flagged) && flagged.every((l) => campo(l, 5) === "revisar"), `service 2 fails (${e1.ok ? "OK?!" : e1.error.slice(0, 70)}): service 1 was NOT updated either — rows, tokens, revisions and states are as before`);
  const e1b = await gen("ADMIN", "DTM-9513");
  ok(e1b.ok && e1b.actualizados === 2 && lista("DTM-9513").every((l, i) => campo(l, 2) === campo(l5[i], 2) && campo(l, 5) === "vigente"), "the retry applies both changes at once, links unchanged, both «vigente»");

  console.log("\n-- E2 failure on the RETIREMENT step rolls back everything too");
  crear("DTM-9523"); idaVuelta("DTM-9523", null, null, 11, SV(231)); idaVuelta("DTM-9523", null, null, 12, SV(232));
  await gen("ADMIN", "DTM-9523");
  sql("update public.contrato_vuelos set servicio_aereo = '" + SV(231) + "' where numero_contrato = 'DTM-9523'"); // merge: 232 loses its legs
  const antesE2 = JSON.stringify(lista("DTM-9523"));
  sql("insert into public.vouchers (numero_contrato, tipo, proveedor, servicio_clave, contenido) values ('DTM-9523', 'vuelo', 'Servicio aéreo', 'legado-prueba', '{\"clase\":\"vuelo\"}')");
  const antesE2b = JSON.stringify(lista("DTM-9523"));
  gate("fallar_voucher:legado-prueba", true);
  const e2 = await gen("ADMIN", "DTM-9523");
  gate("fallar_voucher:legado-prueba", false);
  ok(!e2.ok && JSON.stringify(lista("DTM-9523")) === antesE2b && antesE2b !== antesE2, `failure while retiring the legacy voucher: the service upsert is rolled back too (${e2.ok ? "OK?!" : e2.error.slice(0, 60)})`);
  const e2b = await gen("ADMIN", "DTM-9523");
  ok(e2b.ok && e2b.retirados === 1 && campo(porClave("DTM-9523", "legado-prueba"), 5) === "retirado" && campo(porClave("DTM-9523", SV(231)), 5) === "vigente", `retry: the legacy voucher without a service is retired, the current one is «vigente» (${JSON.stringify(e2b)})`);

  console.log("\n-- E3 stale read: a flight-editor save lands between the application's read and the database write → rejected, nothing stored as «vigente»");
  crear("DTM-9524", { aliado: true }); pagar("DTM-9524"); idaVuelta("DTM-9524", null, null, 21, SV(241)); idaVuelta("DTM-9524", null, null, 22, SV(242));
  await gen("ADMIN", "DTM-9524");
  const tE3 = campo(porClave("DTM-9524", SV(241)), 2);
  sql("update public.contrato_vuelos set hora_salida = '11:11' where numero_contrato = 'DTM-9524' and numero_vuelo = 'AV211'"); // the voucher must be regenerated
  gate("pausa_voucher", true);
  const pe = gen("ADMIN", "DTM-9524");
  await hasta(() => retenidas("pausa_voucher") >= 1, 30000, "the generation held right before the write");
  const ed3 = await editor("DTM-9524", tramosDe("DTM-9524", (t) => (t.numero_vuelo === "AV212" ? { horaLlegada: "22:22" } : {})));  // changes a field of the service whose voucher is being regenerated
  gate("pausa_voucher", false);
  const re = await pe;
  const rE3 = await abrir("ALIADO", tE3);
  ok(ed3.ok && !re.ok && /cambiaron mientras se generaba/.test(re.error) && !rE3.ok && rE3.motivo === "no_vigente", `the held regeneration is refused with SERVICIOS_CAMBIARON (${re.ok ? "OK?!" : re.error.slice(0, 70)}); the issued URL does NOT serve the stale itinerary as current`);
  const re2 = await gen("ADMIN", "DTM-9524");
  const rE3b = await abrir("ALIADO", tE3);
  ok(re2.ok && rE3b.ok && rE3b.voucher.contenido.tramos.some((t) => t.horaLlegada === "22:22"), "retrying after the concurrent save produces the up-to-date itinerary at the same link");

  console.log("\n-- E4 two simultaneous first generations of a two-service contract (held at the HTTP layer, released together)");
  crear("DTM-9514"); idaVuelta("DTM-9514", "FFF666", "FFF666", 71, SV(341)); idaVuelta("DTM-9514", "GGG777", "GGG777", 81, SV(342));
  gate("pausa_voucher", true);
  const pa = gen("ADMIN", "DTM-9514"), pb = gen("A", "DTM-9514");
  await hasta(() => retenidas("pausa_voucher") >= 2, 30000, "both requests held");
  gate("pausa_voucher", false);
  const [ra, rb] = await Promise.all([pa, pb]);
  ok(ra.ok && rb.ok && filas("DTM-9514") === 2 && ((ra.creados ?? 0) + (rb.creados ?? 0)) === 2 && lista("DTM-9514").every((l) => campo(l, 3) === "0"), `both succeed, TWO rows, each created exactly once, revision 0 (${JSON.stringify([ra, rb])})`);

  // ───────────── F · carried over: failed reads, roles, service vouchers, no legs ─────────────
  // ───────────── V5-1 · validation-to-write race: a writer that validated an older state must never overwrite a later invalidation ─────────────
  // The pause is INSIDE the database: a test-only BEFORE trigger on vouchers (fixture) waits on advisory lock 981338, held by a separate blocker session, when the gate row
  // «pausa_escritura_voucher:<contract>» exists. That is AFTER the RPC took its locks and validated services + leg fingerprint, and BEFORE its upsert (checked below by pg_locks).
  console.log("\n-- V5-1 two real sessions: the voucher write is paused AFTER the fingerprint validation; a flight edit is attempted meanwhile");
  const PSB = PS.replace("docker exec -i", "docker exec -i -e PGAPPNAME=rb1_bloqueo");
  const bloqueadorPid = () => sql("select coalesce(max(pid), 0) from pg_stat_activity where application_name = 'rb1_bloqueo'");
  const soltarBloqueador = () => { sql("select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name = 'rb1_bloqueo'"); };
  const esperandoAdvisory = () => Number(sql("select count(*) from pg_locks where locktype = 'advisory' and not granted"));
  const esperandoLock = () => Number(sql("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'"));
  const advisoryDeOtros = () => Number(sql("select count(*) from pg_locks l where l.locktype = 'advisory' and l.granted and l.pid not in (select pid from pg_stat_activity where application_name = 'rb1_bloqueo')"));
  /** Runs `generar()` paused right before its voucher write, then `editar()` while it is paused; releases the pause; returns both outcomes and whether the edit was blocked during the pause. */
  async function conPausa(n, generar, editar) {
    sql(`insert into public.t_gate values ('pausa_escritura_voucher:${n}') on conflict do nothing`);
    const bloqueador = spawn("sh", ["-c", `${PSB} -c "select pg_advisory_lock(981338)" -c "select pg_sleep(600)"`], { stdio: "ignore" });
    await hasta(() => bloqueadorPid() !== "0" && Number(sql("select count(*) from pg_locks l join pg_stat_activity a using (pid) where l.locktype = 'advisory' and l.granted and a.application_name = 'rb1_bloqueo'")) >= 1, 20000, "blocker session holding the barrier");
    const g = generar();
    await hasta(() => esperandoAdvisory() >= 1, 30000, "the generation waiting at the barrier (after validation, before the write)");
    const locksDeLaGeneracion = advisoryDeOtros();
    let editoHecho = false;
    const e = editar().finally(() => { editoHecho = true; });
    // Without the lock protocol (negative controls) the edit is NOT queued: record that as «not blocked» instead of aborting the whole run.
    let encolada = true;
    try { await hasta(() => esperandoLock() >= 2 || editoHecho, 30000, "the edit waiting for the generation (lock queue)"); } catch { encolada = false; }
    await dormir(800);
    const bloqueada = !editoHecho && encolada;
    soltarBloqueador(); bloqueador.kill();
    const [rg, re] = await Promise.all([g, e]);
    sql(`delete from public.t_gate where k = 'pausa_escritura_voucher:${n}'`);
    return { rg, re, bloqueada, locksDeLaGeneracion };
  }
  const horaDeLeg = (n, vuelo) => sql(`select hora_salida from public.contrato_vuelos where numero_contrato = '${n}' and numero_vuelo = '${vuelo}'`);
  const horaVoucher = (n, clave, i = 0) => contenidoDe(n, clave).tramos[i].horaSalida;
  const cambiaHora = (vuelo, hora) => (t) => (t.numero_vuelo === vuelo ? { horaSalida: hora } : {});

  console.log("\n-- V1 existing vouchers, same-field edit during the pause; an UNRELATED contract is not held");
  crear("DTM-9527", { aliado: true }); pagar("DTM-9527"); idaVuelta("DTM-9527", null, null, 71, SV(271)); idaVuelta("DTM-9527", null, null, 72, SV(272));
  crear("DTM-9532"); idaVuelta("DTM-9532", null, null, 73, SV(273));
  await gen("ADMIN", "DTM-9527");
  const tokV1 = campo(porClave("DTM-9527", SV(271)), 2), tokV1b = campo(porClave("DTM-9527", SV(272)), 2);
  sql("update public.contrato_vuelos set hora_salida = '10:11' where numero_contrato = 'DTM-9527' and numero_vuelo = 'AV711'");   // A: the voucher is now «revisar»; the generation below will WRITE content built from A
  sql("update public.contrato_vuelos set hora_salida = '10:12' where numero_contrato = 'DTM-9527' and numero_vuelo = 'AV721'");
  let otroContrato = null;
  const w1 = await conPausa("DTM-9527", () => gen("ADMIN", "DTM-9527"), async () => {
    const r = await editor("DTM-9527", tramosDe("DTM-9527", cambiaHora("AV711", "12:22")));
    return r;
  });
  ok(w1.locksDeLaGeneracion >= 1 && w1.bloqueada, "while the write was paused (validation already done) the generation held the contract lock and the flight edit was BLOCKED, not applied");
  ok(w1.rg.ok && w1.re.ok, `both complete after the release (generation ${JSON.stringify(w1.rg)}; edit ${w1.re.ok ? "ok" : w1.re.error})`);
  ok(horaDeLeg("DTM-9527", "AV711") === "12:22" && horaVoucher("DTM-9527", SV(271)) === "10:11", "legs hold the LATER edit (12:22); the voucher content is the earlier validated one (10:11)");
  ok(campo(porClave("DTM-9527", SV(271)), 5) === "revisar", "the voucher is «revisar»: the later invalidation was NOT overwritten by the stale generation");
  const aV1 = await abrir("ALIADO", tokV1);
  ok(!aV1.ok && aV1.motivo === "no_vigente", `the issued URL does not serve the stale 10:11 itinerary as current (${aV1.ok ? "SERVED?!" : aV1.motivo})`);
  ok(campo(porClave("DTM-9527", SV(272)), 2) === tokV1b && campo(porClave("DTM-9527", SV(271)), 2) === tokV1, "links are stable (same tokens)");
  const w1r = await gen("ADMIN", "DTM-9527");
  const aV1r = await abrir("ALIADO", tokV1);
  ok(w1r.ok && campo(porClave("DTM-9527", SV(271)), 5) === "vigente" && horaVoucher("DTM-9527", SV(271)) === "12:22" && aV1r.ok && campo(porClave("DTM-9527", SV(271)), 2) === tokV1, "regeneration restores «vigente» with the UPDATED content (12:22) at the SAME link");
  // unrelated contract: a generation of ANOTHER contract is not held by the pause of this one
  // the leg update goes FIRST: with the gate armed, even the trigger's voucher flag would wait at the barrier
  sql("update public.contrato_vuelos set hora_salida = '09:09' where numero_contrato = 'DTM-9527' and numero_vuelo = 'AV711'");
  sql("insert into public.t_gate values ('pausa_escritura_voucher:DTM-9527') on conflict do nothing");
  const blqU = spawn("sh", ["-c", `${PSB} -c "select pg_advisory_lock(981338)" -c "select pg_sleep(600)"`], { stdio: "ignore" });
  await hasta(() => bloqueadorPid() !== "0" && Number(sql("select count(*) from pg_locks l join pg_stat_activity a using (pid) where l.locktype = 'advisory' and l.granted and a.application_name = 'rb1_bloqueo'")) >= 1, 20000, "blocker 2");
  const gPausada = gen("ADMIN", "DTM-9527");
  await hasta(() => esperandoAdvisory() >= 1, 30000, "paused generation (unrelated check)");
  const gOtro = await gen("ADMIN", "DTM-9532");   // must complete while the other contract's generation is paused
  otroContrato = gOtro.ok && filas("DTM-9532") === 1;
  soltarBloqueador(); blqU.kill(); await gPausada;
  sql("delete from public.t_gate where k = 'pausa_escritura_voucher:DTM-9527'");
  ok(otroContrato, "an UNRELATED contract's generation completed while this contract's write was paused (the lock is per contract)");

  console.log("\n-- V2 FIRST generation (no voucher yet) paused after validation; edit meanwhile");
  crear("DTM-9528", { aliado: true }); pagar("DTM-9528"); idaVuelta("DTM-9528", null, null, 74, SV(281));
  const w2 = await conPausa("DTM-9528", () => gen("ADMIN", "DTM-9528"), () => editor("DTM-9528", tramosDe("DTM-9528", cambiaHora("AV741", "13:33"))));
  ok(w2.bloqueada && w2.rg.ok && w2.re.ok && filas("DTM-9528") === 1, `first generation created the voucher; the edit waited and then applied (${JSON.stringify(w2.rg)})`);
  const tokV2 = campo(lista("DTM-9528")[0], 2);
  ok(campo(lista("DTM-9528")[0], 5) === "revisar" && horaVoucher("DTM-9528", SV(281)) !== "13:33" && horaDeLeg("DTM-9528", "AV741") === "13:33", "the brand-new voucher is «revisar» (not a stale «vigente»): content older than the saved legs is flagged");
  const aV2 = await abrir("ALIADO", tokV2);
  ok(!aV2.ok && aV2.motivo === "no_vigente", "its URL is not served as current");
  await gen("ADMIN", "DTM-9528");
  ok(campo(lista("DTM-9528")[0], 5) === "vigente" && horaVoucher("DTM-9528", SV(281)) === "13:33" && campo(lista("DTM-9528")[0], 2) === tokV2, "regeneration: updated content, same link");

  console.log("\n-- V3 service removal during the pause");
  crear("DTM-9530", { aliado: true }); pagar("DTM-9530"); idaVuelta("DTM-9530", null, null, 75, SV(301)); idaVuelta("DTM-9530", null, null, 76, SV(302));
  await gen("ADMIN", "DTM-9530");
  const tok301 = campo(porClave("DTM-9530", SV(301)), 2), tok302 = campo(porClave("DTM-9530", SV(302)), 2);
  sql("update public.contrato_vuelos set hora_salida = '07:07' where numero_contrato = 'DTM-9530'");   // both services need a write
  const w3 = await conPausa("DTM-9530", () => gen("ADMIN", "DTM-9530"), () => editor("DTM-9530", tramosDe("DTM-9530").filter((t) => t.numeroVuelo.startsWith("AV75"))));
  ok(w3.bloqueada && w3.rg.ok && w3.re.ok, `the removal of service 302 waited for the generation and then applied (${JSON.stringify(w3.rg)})`);
  const a302 = await abrir("ALIADO", tok302), a301 = await abrir("ALIADO", tok301);
  ok(campo(porClave("DTM-9530", SV(302)), 5) === "retirado" && !a302.ok && a302.motivo === "no_vigente", "the removed service's voucher is «retirado» (the stale generation did not resurrect it as vigente) and its URL is not served");
  ok(campo(porClave("DTM-9530", SV(301)), 5) === "vigente" && a301.ok && campo(porClave("DTM-9530", SV(301)), 2) === tok301, "the surviving service stays current at its same link");

  console.log("\n-- V4 atomic failure of the paused generation: the edit still lands, nothing is left «vigente» with stale content");
  crear("DTM-9531", { aliado: true }); pagar("DTM-9531"); idaVuelta("DTM-9531", null, null, 77, SV(311)); idaVuelta("DTM-9531", null, null, 78, SV(312));
  await gen("ADMIN", "DTM-9531");
  sql("update public.contrato_vuelos set hora_salida = '06:06' where numero_contrato = 'DTM-9531'");
  gate(`fallar_voucher:${SV(312)}`, true);
  const w4 = await conPausa("DTM-9531", () => gen("ADMIN", "DTM-9531"), () => editor("DTM-9531", tramosDe("DTM-9531", cambiaHora("AV771", "14:44"))));
  gate(`fallar_voucher:${SV(312)}`, false);
  ok(w4.bloqueada && !w4.rg.ok && w4.re.ok, `the generation failed and rolled back (${w4.rg.ok ? "OK?!" : w4.rg.error.slice(0, 50)}); the edit applied after it`);
  ok(lista("DTM-9531").every((l) => campo(l, 5) === "revisar") && horaDeLeg("DTM-9531", "AV771") === "14:44", "both vouchers stay «revisar»: no partial write, no vigente with stale content");
  const w4r = await gen("ADMIN", "DTM-9531");
  ok(w4r.ok && lista("DTM-9531").every((l) => campo(l, 5) === "vigente") && horaVoucher("DTM-9531", SV(311)) === "14:44", "the retry produces the up-to-date content for both");

  console.log("\n-- V6 the contract-content editor (plain statements, NO ventas lock) is protected by the leg trigger alone");
  crear("DTM-9534", { aliado: true }); pagar("DTM-9534"); idaVuelta("DTM-9534", null, null, 79, SV(341));
  await gen("ADMIN", "DTM-9534");
  const tok341 = campo(lista("DTM-9534")[0], 2);
  sql("update public.contrato_vuelos set hora_salida = '05:05' where numero_contrato = 'DTM-9534' and numero_vuelo = 'AV791'");
  const legsContenido = (hora) => ["ida", "regreso"].map((d, i) => ({ aerolinea: "Avianca", record: "", direccion: d, origenCodigo: i ? "CTG" : "BOG", destinoCodigo: i ? "BOG" : "CTG", numeroVuelo: `AV79${i + 1}`, fecha: i ? "2027-06-10" : "2027-06-07", horaSalida: hora, horaLlegada: "09:45", servicios: "" }));
  const w6 = await conPausa("DTM-9534", () => gen("ADMIN", "DTM-9534"), () => como("SUPER", () => contenidoActs.guardarVuelosContrato("DTM-9534", legsContenido("15:55"), idDe("DTM-9534"))));
  ok(w6.bloqueada && w6.rg.ok && w6.re.ok, "the content editor's leg statements waited for the paused generation (leg trigger lock) and then applied");
  ok(campo(lista("DTM-9534")[0], 5) === "revisar" && horaDeLeg("DTM-9534", "AV791") === "15:55" && campo(lista("DTM-9534")[0], 2) === tok341, "voucher «revisar» (not stale vigente), same row and link");
  await gen("ADMIN", "DTM-9534");
  ok(campo(lista("DTM-9534")[0], 5) === "vigente" && horaVoucher("DTM-9534", SV(341)) === "15:55", "regeneration restores the updated content");

  console.log("\n-- V7 lock-order storm: generations and edits of the same contract in parallel never deadlock and never leave a stale «vigente»");
  crear("DTM-9533", { aliado: true }); pagar("DTM-9533"); idaVuelta("DTM-9533", null, null, 81, SV(331)); idaVuelta("DTM-9533", null, null, 82, SV(332));
  await gen("ADMIN", "DTM-9533");
  const errores = [];
  for (let r = 1; r <= 4; r++) {
    const salidas = await Promise.all([
      gen("ADMIN", "DTM-9533"), editor("DTM-9533", tramosDe("DTM-9533", cambiaHora("AV811", `10:${r}1`))), gen("A", "DTM-9533"),
      editor("DTM-9533", tramosDe("DTM-9533", cambiaHora("AV821", `11:${r}1`))), gen("ADMIN", "DTM-9533"),
    ]);
    for (const s of salidas) if (!s.ok) errores.push(s.error);
  }
  const mensajesRaros = errores.filter((e) => /deadlock|40P01|timeout|canceling/i.test(e));
  const invariante = () => ["AV811", "AV821"].every((vuelo, i) => {
    const clave = SV(331 + i), est = campo(porClave("DTM-9533", clave), 5);
    return est !== "vigente" || horaVoucher("DTM-9533", clave) === horaDeLeg("DTM-9533", vuelo);
  });
  ok(mensajesRaros.length === 0, `20 concurrent operations (${errores.length} refused as «cambiaron mientras se generaba» / editor conflicts, 0 deadlocks or timeouts: ${JSON.stringify(mensajesRaros)})`);
  ok(invariante(), "invariant after the storm: every «vigente» voucher shows exactly the hours saved in its legs");
  const stormFinal = await gen("ADMIN", "DTM-9533");
  ok(stormFinal.ok && lista("DTM-9533").every((l) => campo(l, 5) === "vigente") && invariante(), "a final regeneration leaves both current and consistent");

  // ───────────── V5-2 · legacy ida+regreso fields invalidate an issued voucher ─────────────
  console.log("\n-- V5-2 legacy single-row itinerary: every rendered legacy field invalidates the issued URL; regeneration restores the content at the same link");
  const crearLegado = (n, o = {}) => {
    crear(n, o);
    sql(`insert into public.contrato_vuelos (numero_contrato, servicio_aereo, aerolinea, origen_codigo, destino_codigo, fecha_salida, vuelo_ida, hora_salida_ida, hora_llegada_ida, fecha_regreso, vuelo_regreso, hora_salida_reg, hora_llegada_reg, record, orden)
      values ('${n}', '${o.svc}', 'Avianca', 'BOG', 'CTG', '2027-06-07', 'LG100', '08:00', '09:30', '2027-06-10', 'LG200', '18:00', '19:30', 'LEGPNR1', 0)`);
  };
  crearLegado("DTM-9535", { aliado: true, svc: SV(351) }); pagar("DTM-9535");
  crearLegado("DTM-9536", { aliado: true, svc: SV(361) });                     // NOT paid
  await gen("ADMIN", "DTM-9535"); await gen("ADMIN", "DTM-9536");
  const cLeg = contenidoDe("DTM-9535", SV(351));
  ok(cLeg.tramos.length === 2 && cLeg.tramos[0].numeroVuelo === "LG100" && cLeg.tramos[1].numeroVuelo === "LG200" && cLeg.tramos[1].fecha === "2027-06-10", "the legacy row renders as TWO legs (outbound LG100, return LG200 with the return date)");
  const tokLeg = campo(lista("DTM-9535")[0], 2), tokLegImpago = campo(lista("DTM-9536")[0], 2);
  const legacyRes = [];
  const campos = [
    ["vuelo_ida", "LG111", (c) => c.tramos[0].numeroVuelo], ["vuelo_regreso", "LG222", (c) => c.tramos[1].numeroVuelo],
    ["hora_salida_ida", "10:00", (c) => c.tramos[0].horaSalida], ["hora_llegada_ida", "11:30", (c) => c.tramos[0].horaLlegada],
    ["hora_salida_reg", "20:00", (c) => c.tramos[1].horaSalida], ["hora_llegada_reg", "21:30", (c) => c.tramos[1].horaLlegada],
    ["fecha_regreso", "2027-06-12", (c) => c.tramos[1].fecha],
  ];
  const ackLeg = await acuse("DTM-9535");
  for (const [col, nuevo, lee] of campos) {
    sql(`update public.contrato_vuelos set ${col} = ${col} where numero_contrato = 'DTM-9535'`);                                  // identical save
    const noop = campo(lista("DTM-9535")[0], 5), revNoop = campo(lista("DTM-9535")[0], 3);
    sql(`update public.contrato_vuelos set ${col} = '${nuevo}' where numero_contrato = 'DTM-9535'`);                              // real change
    const viejo = await abrir("ALIADO", tokLeg), interno = await abrir("ADMIN", tokLeg);
    const estado = campo(lista("DTM-9535")[0], 5);
    const sig = await filaGestion("DTM-9535");
    const g = await gen("ADMIN", "DTM-9535");
    const nuevoAcceso = await abrir("ALIADO", tokLeg);
    legacyRes.push({ col, noop: noop === "vigente" && revNoop !== undefined, estado, viejoNoVigente: !viejo.ok && viejo.motivo === "no_vigente", internoRevisar: interno.ok && interno.voucher.estado === "revisar", senal: sig.actualizado === true && sig.aereoNoVigente === 1, regen: g.ok && nuevoAcceso.ok && lee(nuevoAcceso.voucher.contenido) === nuevo && campo(lista("DTM-9535")[0], 2) === tokLeg && campo(lista("DTM-9535")[0], 5) === "vigente" });
  }
  console.log("   " + JSON.stringify(legacyRes.map((r) => [r.col, r.noop, r.estado, r.viejoNoVigente, r.internoRevisar, r.senal, r.regen])));
  ok(ackLeg.ok && legacyRes.every((r) => r.noop && r.estado === "revisar" && r.viejoNoVigente && r.internoRevisar && r.senal && r.regen), "each of the 7 legacy fields: identical save flags nothing; a real change makes the OLD url non-current before regeneration (ally: no_vigente, staff: revisar), raises the Gestión signal, and regeneration restores the updated value at the SAME link");
  // display order: only the RESULTING order matters (the editor normalizes orden on a save); swapping two legs changes the issued document
  const estOrden = lista("DTM-9527").find((l) => campo(l, 0) === SV(271));
  sql("update public.contrato_vuelos set orden = orden + 100 where numero_contrato = 'DTM-9527' and servicio_aereo = '" + SV(271) + "'");
  ok(lista("DTM-9527").find((l) => campo(l, 0) === SV(271)) === estOrden, "renumbering orden without changing the order (+100 on both legs) flags nothing");
  sql("update public.contrato_vuelos set orden = case numero_vuelo when 'AV711' then 2000 else 1000 end where numero_contrato = 'DTM-9527' and servicio_aereo = '" + SV(271) + "'");
  ok(campo(lista("DTM-9527").find((l) => campo(l, 0) === SV(271)), 5) === "revisar", "swapping the two legs (a different order in the issued document) makes the voucher non-current");
  await gen("ADMIN", "DTM-9527");
  ok(contenidoDe("DTM-9527", SV(271)).tramos[0].numeroVuelo === "AV712" && campo(lista("DTM-9527").find((l) => campo(l, 0) === SV(271)), 5) === "vigente", "regeneration lists the legs in the new order and restores «vigente»");
  sql("update public.contrato_vuelos set vuelo_ida = 'LG999', hora_salida_ida = '23:00' where numero_contrato = 'DTM-9536'");
  const impago = await abrir("ALIADO", tokLegImpago), otroVenta = await abrir("VENTA_OTRO", tokLeg), minorista = await abrir("MINORISTA", tokLeg);
  ok(!impago.ok && impago.motivo === "pago_incompleto" && !otroVenta.ok && !minorista.ok, `viewers who must not see it get nothing: unpaid ally ${impago.ok ? "OPENED?!" : impago.motivo}, colleague venta ${otroVenta.ok ? "OPENED?!" : otroVenta.motivo}, other agency ${minorista.ok ? "OPENED?!" : minorista.motivo}`);
  const internoImpago = await abrir("ADMIN", tokLegImpago);
  ok(internoImpago.ok && internoImpago.voucher.estado === "revisar", "the unpaid contract's changed legacy voucher is «revisar» for staff (flagged even though nobody outside may open it)");

  console.log("\n-- E5 deleting a contract that has legs: 338 adds NO new failure mode (the voucher trigger is not in the way)");
  // OBSERVATION (pre-existing, reproduced WITHOUT migration 338 and WITHOUT vouchers): in this database the identity guard of 284 refuses `eliminar_contrato` for a contract that still has contrato_vuelos
  // rows (the cascade delete of the legs reports «el contrato cambió»). So the comparison below is between a contract WITH an issued air voucher and one WITHOUT any: they must behave the same.
  const adminActs = await import("../../app/(dashboard)/dashboard/contratos/[numero]/admin-actions.ts");
  crear("DTM-9525"); idaVuelta("DTM-9525", "DEL111", "DEL111", 31, SV(251)); await gen("ADMIN", "DTM-9525");
  crear("DTM-9526"); idaVuelta("DTM-9526", "DEL222", "DEL222", 32, SV(252));
  const e5 = await como("SUPER", () => adminActs.eliminarContrato("DTM-9525", false, idDe("DTM-9525")));
  const e5base = await como("SUPER", () => adminActs.eliminarContrato("DTM-9526", false, idDe("DTM-9526")));
  ok(e5.ok === e5base.ok && e5.error === e5base.error && filas("DTM-9525") === (e5.ok ? 0 : 1), `same outcome with and without an issued air voucher (with: ${e5.ok ? "deleted" : e5.error.slice(0, 50)} · without: ${e5base.ok ? "deleted" : e5base.error.slice(0, 50)}) — 338 does not change contract deletion`);

  console.log("\n-- F1 a failed REQUIRED read is rejected and the vouchers are kept");
  const antesF = huella("DTM-9512", "vuelo");
  sql("revoke select on public.contrato_pasajeros from authenticated");
  const f1a = await gen("ADMIN", "DTM-9512");
  sql("grant select on public.contrato_pasajeros to authenticated");
  ok(!f1a.ok && /pasajeros/.test(f1a.error) && huella("DTM-9512", "vuelo") === antesF, `passenger read error is NOT an empty list (${f1a.ok ? "OK?!" : f1a.error})`);
  sql("revoke select on public.contrato_vuelos_basica from authenticated");
  const f1b = await gen("ADMIN", "DTM-9512");
  sql("grant select on public.contrato_vuelos_basica to authenticated");
  ok(!f1b.ok && huella("DTM-9512", "vuelo") === antesF, `flight read error rejected, vouchers unchanged (${f1b.ok ? "OK?!" : f1b.error})`);

  console.log("\n-- F2 roles/tenants: who can write the air vouchers");
  const rolesV = {};
  for (const quien of ["VENTA_DUENO", "VENTA_OTRO", "CONTROL_VUELO", "MINORISTA", "ALIADO"]) { const r = await gen(quien, "DTM-9512"); rolesV[quien] = r.ok ? "ok" : r.error; }
  console.log("   " + JSON.stringify(rolesV));
  ok(Object.values(rolesV).every((v) => v !== "ok") && huella("DTM-9512", "vuelo") === antesF, "venta, control_vuelo, the other agency and the ally are all refused and nothing changes");
  ok((await gen("A", "DTM-9512")).ok, "operaciones (same agency) can regenerate");

  console.log("\n-- F3 regenerating the SERVICE vouchers (real action) leaves the air vouchers and the hotel voucher untouched");
  sql("insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant) values ('DTM-9512', 'Receptivo X', 'receptivo', 'Traslado aeropuerto', 100000, 'mayorista')");
  const aire = huella("DTM-9512", "vuelo"), hotel = huella("DTM-9512", "hotel");
  const rs = await como("ADMIN", () => vouchers.generarVouchersServicios("DTM-9512", idDe("DTM-9512")));
  ok(rs.ok && huella("DTM-9512", "vuelo") === aire && huella("DTM-9512", "hotel") === hotel, `air vouchers (id, token, content, revision, state) and hotel voucher byte-identical after the service vouchers were regenerated (${JSON.stringify(rs)})`);
  sql("insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, estado) values ('DTM-9505', 'Sin vuelos', 'mayorista', 'dinamico', 'confirmado')");
  const rSin = await gen("ADMIN", "DTM-9505");
  ok(!rSin.ok && /no tiene vuelos/.test(rSin.error) && filas("DTM-9505") === 0, "a contract with no saved legs produces no voucher");
}

// ───────────────────── F1 with a FLIGHT origin (negotiated block with seats; Promoción without / with record; record entered later) ─────────────────────
async function origen() {
  console.log("\n### F1/#40 · conversion of FLIGHT packages: seats, Promoción without record, Promoción with record, record entered later");
  const paquetes = await import("../../app/(dashboard)/dashboard/paquetes/actions.ts");
  const g = await como("ADMIN", () => paquetes.generarTarifario(9402));
  console.log("   generarTarifario(9402):", JSON.stringify(g).slice(0, 300));
  console.log("   tarifario_resultado:", sql("select coalesce(bloqueo_id::text, 'null') || '/' || coalesce(empaquetado_id::text, 'null') || ':' || count(*) from public.tarifario_resultado where paquete_id = 9402 group by bloqueo_id, empaquetado_id order by 1").replace(/\n/g, " ; "));
  ok(g.ok, "the REAL generator published the flight package (block + two Promociones)");

  const contrato = await import("../../app/(dashboard)/dashboard/vuelos/contrato-vuelos-actions.ts");
  const { identidadDe } = await import("../../lib/contrato/identidad.ts");
  const idDe = (n) => identidadDe(n, sql(`select contrato_uid from public.ventas where numero_contrato = '${n}'`));
  const reservaVuelo = (tag, o) => ({ ...reservaDe(tag), paqueteId: 9402, modulo: "bloqueo", fechaIda: undefined, fechaRegreso: undefined, bloqueoId: o.bloqueo ?? null, empaquetadoId: o.emp ?? null });
  const cotizar = async (tag, o) => { const c = await como("A", () => reservar.crearCotizacion(reservaVuelo(tag, o))); if (!c.ok) throw new Error(`crearCotizacion ${tag}: ${c.error}`); return c.id; };
  const cupos = () => Number(sql("select cupos_disponibles from public.cupos_por_bloqueo where id = 9402"));
  const sillasDe = (n) => (n ? Number(sql(`select count(*) from public.sillas where numero_contrato = '${n}'`)) : 0);
  const emp = (id) => sql(`select md5(row(e.*)::text) from public.empaquetados e where id = ${id}`);
  const tramos = (n) => sql(`select coalesce(string_agg(coalesce(aerolinea,'-') || '/' || coalesce(record,'-') || '/' || coalesce(direccion,'-'), ' ; ' order by orden, id), '') from public.contrato_vuelos where numero_contrato = '${n}'`);

  const VARIANTES = [
    { nombre: "negotiated block (seats)", tag: "O1", o: { bloqueo: 9402 }, silla: true },
    { nombre: "Promoción WITHOUT record", tag: "O2", o: { emp: 9403 }, empId: 9403 },
    { nombre: "Promoción WITH record", tag: "O3", o: { emp: 9404 }, empId: 9404 },
  ];
  for (const v of VARIANTES) {
    console.log(`\n-- ${v.nombre}: winner paused after the header, loser in another session, release`);
    const cot = await cotizar(v.tag, v.o);
    const empAntes = v.empId ? emp(v.empId) : null, cuposAntes = cupos(), s0 = seq();
    gate("pausa_hotel", true);
    const gan = como("A", () => reservar.convertirCotizacion(cot, pasajeros(v.tag)));
    gan.then((r) => { if (!r.ok) console.log("   [winner returned early]", r.error); });
    await hasta(() => foto(cot).ventas === 1 && retenidas("pausa_hotel") >= 1, 30000, "winner held after its header");
    const f0 = foto(cot);
    ok(f0.financiero === "pendiente", `header committed and still INCOMPLETE (${f0.numero}: ${f0.financiero})`);
    const cuposMid = cupos();
    const per = await como("B", () => reservar.convertirCotizacion(cot, pasajeros(v.tag)));
    ok(!per.ok && /se está convirtiendo/.test(per.error ?? "") && seq() === s0 + 1, `loser: IN PROGRESS, no number spent (${s0} -> ${seq()})`);
    ok(cupos() === cuposMid && sillasDe(f0.numero) === sillasDe(f0.numero), `loser changed no seat (available ${cuposMid} -> ${cupos()})`);
    if (v.silla) ok(sillasDe(f0.numero) === 2 && cuposMid === cuposAntes - 2, `winner already holds its 2 seats while pending (available ${cuposAntes} -> ${cuposMid})`);
    gate("pausa_hotel", false);
    const r = await gan;
    const f1x = foto(cot);
    ok(r.ok && f1x.financiero === "completo" && f1x.cotizacion === `convertida|${f0.numero}` && f1x.pasajeros === 2 && f1x.cxp >= 1, `winner completes: ${JSON.stringify(f1x)}`);
    if (v.silla) ok(sillasDe(f1x.numero) === 2 && cupos() === cuposAntes - 2 && Number(sql(`select count(*) from public.sillas where numero_contrato = '${f1x.numero}' and estado = 'en_plazo'`)) === 2, `2 seats en_plazo, availability ${cuposAntes} -> ${cupos()}`);
    console.log(`   flight legs of ${f1x.numero}: ${tramos(f1x.numero)} · empaquetado_ref_id=${sql(`select coalesce(empaquetado_ref_id::text, '-') from public.ventas where numero_contrato = '${f1x.numero}'`)} · tipo_paquete=${sql(`select tipo_paquete from public.ventas where numero_contrato = '${f1x.numero}'`)}`);
    if (v.empId) ok(emp(v.empId) === empAntes, "the shared Promoción row is byte-identical after the conversion");
    v.numero = f1x.numero;

    console.log(`-- ${v.nombre}: injected downstream failure (new quotation)`);
    const cotF = await cotizar(v.tag + "F", v.o);
    const cuposF0 = cupos(), sF = seq();
    gate("fallar_hotel", true);
    const rf = await como("A", () => reservar.convertirCotizacion(cotF, pasajeros(v.tag + "F")));
    gate("fallar_hotel", false);
    const ff = foto(cotF);
    ok(!rf.ok && ff.ventas === 0 && ff.pasajeros === 0 && ff.cxp === 0 && ff.reclamo === 0 && ff.cotizacion.startsWith("abierta|") && cupos() === cuposF0,
      `failure: no header/passengers/payables, quotation unchanged, seats released (available ${cuposF0} -> ${cupos()}), lease released`);
    if (v.empId) ok(emp(v.empId) === empAntes, "the shared Promoción row is still byte-identical");
    const rr = await como("B", () => reservar.convertirCotizacion(cotF, pasajeros(v.tag + "F")));
    ok(rr.ok && foto(cotF).financiero === "completo", `retry builds ONE complete contract (${rr.ok ? rr.numero : rr.error})`);
    v.numeroF = rr.ok ? rr.numero : null;
  }

  console.log("\n-- record entered LATER from the contract (Promoción without record); sibling contract and the Promoción untouched");
  // Both contracts converted above from the Promoción WITHOUT record (the normal one and the retry after the injected failure) are siblings of the same Promoción.
  const objetivo = VARIANTES[1].numero, otro = VARIANTES[1].numeroF;
  const empAntes = emp(9403), tramosOtro0 = tramos(otro);
  const filasObj = sql(`select id || ',' || coalesce(direccion,'') || ',' || coalesce(origen_codigo,'') || ',' || coalesce(destino_codigo,'') || ',' || coalesce(fecha_salida::text,'') from public.contrato_vuelos where numero_contrato = '${objetivo}' order by orden, id`).split("\n").filter(Boolean);
  console.log(`   target ${objetivo} legs: ${JSON.stringify(filasObj)} · sibling ${otro}`);
  const entrada = filasObj.map((l) => { const [id, direccion, o, d, f] = l.split(","); return { id: Number(id), aerolinea: "LATAM", record: "LATE77", direccion, origenCodigo: o, destinoCodigo: d, numeroVuelo: "", fecha: f, horaSalida: "", horaLlegada: "", servicios: "" }; });
  const g1 = await como("CONTROL_VUELO", () => contrato.guardarTramosContrato(objetivo, entrada, idDe(objetivo)));
  ok(g1.ok, `the operational flight role saves the record from the contract editor (${g1.ok ? "ok" : g1.error})`);
  ok(sql(`select count(*) from public.contrato_vuelos where numero_contrato = '${objetivo}' and record = 'LATE77'`) === String(entrada.length), "record stored on EVERY leg of THAT contract");
  ok(emp(9403) === empAntes && tramos(otro) === tramosOtro0, "the Promoción row and the sibling contract's legs are unchanged");
  const g2 = await como("CONTROL_VUELO", () => contrato.guardarTramosContrato(objetivo, entrada, idDe(objetivo)));
  ok(g2.ok && sql(`select count(*) from public.contrato_vuelos where numero_contrato = '${objetivo}'`) === String(entrada.length), "the identical save again is idempotent (no duplicated legs)");

  console.log("\n-- editor-link eligibility = the authoritative view (Codex F3)");
  const { createClient } = await import("../../lib/supabase/server.ts");
  const enVista = (quien, n) => como(quien, async () => { const sb = await createClient(); const { data, error } = await sb.from("ventas_vuelo_sistema").select("numero_contrato").eq("numero_contrato", n).maybeSingle(); return error ? `error:${error.code}` : data ? "si" : "no"; });
  sql("insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, estado, asesor) values ('DTM-9601', 'Solo tramo sin aerolinea', 'mayorista', 'dinamico', 'confirmado', 'B1 Venta Dueno'), ('DTM-9602', 'Solo tierra', 'mayorista', 'dinamico', 'confirmado', 'B1 Venta Dueno')");
  sql("insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, origen_codigo, destino_codigo, fecha_salida, orden) values ('DTM-9601', null, 'ida', 'BOG', 'CTG', '2027-06-07', 0)");
  const tabla = {};
  for (const [n, etiqueta] of [["DTM-9601", "dynamic, saved leg, NO airline"], ["DTM-9602", "dynamic, land only"], [objetivo, "Promoción contract"]]) {
    tabla[etiqueta] = {};
    for (const quien of ["ADMIN", "A", "CONTROL_VUELO", "VENTA_DUENO", "MINORISTA"]) tabla[etiqueta][quien] = await enVista(quien, n);
  }
  console.log("   " + JSON.stringify(tabla));
  ok(tabla["dynamic, saved leg, NO airline"].ADMIN === "si" && tabla["dynamic, saved leg, NO airline"].A === "si", "saved-leg-only contract WITHOUT airline qualifies (the page now shows the link, like the list/editor)");
  ok(tabla["dynamic, land only"].ADMIN === "no" && tabla["dynamic, land only"].A === "no", "genuine land-only contract: no row, no link");
  ok(tabla["Promoción contract"].ADMIN === "si", "Promoción contract qualifies");
  ok(["VENTA_DUENO", "MINORISTA"].every((q) => Object.values(tabla).every((t) => t[q] !== "si")), "venta and the other agency never get a row (the page does not even ask venta)");
}

if (ESC === "todos" || ESC === "f1") await f1();
if (ESC === "todos" || ESC === "origen") await origen();
if (ESC === "todos" || ESC === "f2") await f2();

console.log(`\n=== ${fallos} fallo(s) de ${total}`);
proxy.close();
process.exit(fallos ? 1 : 0);
