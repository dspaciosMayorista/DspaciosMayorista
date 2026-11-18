// #124 — Reproduces the calculator "stale version" message with the REAL server actions (launched by repro_124_conflicto_calculadora.sh,
// which creates a throw-away database + PostgREST). Only `next/headers`, `next/cache` and `server-only` are replaced.
// Every case prints: what the client holds (expected version), what the database holds (current version) and the action result.
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import nodeModule from "node:module";
import http from "node:http";

const REST = process.env.R124_REST, SECRETO = process.env.R124_SECRETO, PS = process.env.R124_PS;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const USUARIOS = { // synthetic users of the local4360 photo
  operaciones: { id: "da5a0c23-2b3e-42b5-a36d-6ed5c041150c", email: "operaciones@local4360.test", sesion: "00000000-0000-4000-8000-0000000a1240" },
  superadmin: { id: "d01aeaca-6789-4ba2-a6db-70526b640a25", email: "superadmin@local4360.test", sesion: "00000000-0000-4000-8000-0000000a1241" },
};
const tokenDe = (u) => jwt({ role: "authenticated", sub: u.id, session_id: u.sesion, aud: "authenticated" });
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }) });
delete process.env.CRON_SECRET; delete process.env.MANTENIMIENTO_CLAVE;

const destino = new URL(REST);
const proxy = http.createServer((req, res) => {
  if (req.url.startsWith("/__/auth/v1/user")) { // minimal GoTrue: answers with the user of the bearer token
    const t = (req.headers.authorization ?? "").replace(/^Bearer /, ""); let sub = USUARIOS.operaciones.id;
    try { sub = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub ?? sub; } catch { /* default */ }
    const u = Object.values(USUARIOS).find((x) => x.id === sub) ?? USUARIOS.operaciones;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {} })); return;
  }
  const ruta = req.url.replace(/^\/__\/rest\/v1/, "").replace(/^\/__/, "") || "/";
  const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers: { ...req.headers, host: destino.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${proxy.address().port}/__`;

function iniciarSesion(clave) {
  const u = USUARIOS[clave];
  const sesion = JSON.stringify({ access_token: tokenDe(u), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: u.id, aud: "authenticated", role: "authenticated" } });
  globalThis.__r124 = { cookie: { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") } };
}
iniciarSesion("operaciones");
const datos = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
nodeModule.registerHooks({ resolve(s, c, n) {
  if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
  if (s === "next/headers") return { url: datos("export async function cookies(){ const c = globalThis.__r124.cookie; return { getAll: () => [c], get: (n) => (n === c.name ? c : undefined), set(){} }; } export async function headers(){ return new Headers(); }"), shortCircuit: true };
  if (s === "next/cache") return { url: datos("export function revalidatePath(){} export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
  if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) { for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* next */ } } }
  return n(s, c);
} });

const sql = (q) => execSync(`${PS} -c "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
let fallos = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const verDb = (h) => Number(sql(`select version from public.hotel_calculadora where hotel_id = ${h}`));
const paramsDb = (h) => JSON.parse(sql(`select params::text from public.hotel_calculadora where hotel_id = ${h}`));
const caso = (t) => console.log(`\n== ${t}`);
const guardar = async (h, tipo, params, versionCliente) => { const antes = verDb(h); const r = await hoteles.guardarCalculadora(h, tipo, params, versionCliente);
  console.log(`  compare: client sends v${versionCliente} | database held v${antes} | result: ${r.ok ? `ok → v${r.version}` : `REJECTED${r.desactualizada ? " (desactualizada)" : ""}: ${r.error}`}`); return r; };
// (hoteles imported below)
const hoteles = await import("../../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
const H = 436004; // Dubai without day groups, bases reference the vigencia "ALTA"
const TEMP_ALTA = 4360041, TEMP_CERRADA = 4360043;
const inputTemp = (nombre) => ({ hotelId: H, nombre, inicio: "2027-01-01", fin: "2027-03-31", prioridad: 1 });
const restaurar = () => { // back to the seed state between cases (renames undone through SQL; each write bumps the version, which is fine: cases re-read it)
  sql(`update public.hotel_temporadas set nombre = 'ALTA' where id = ${TEMP_ALTA}`);
  sql(`update public.hotel_temporadas set nombre = 'CERRADA' where id = ${TEMP_CERRADA}`);
  sql(`update public.tarifa_hotel set temporada = 'ALTA' where hotel_id = ${H} and temporada <> 'BAJA'`);
  sql(`update public.hotel_calculadora set params = replace(params::text, 'ALTA 2027', 'ALTA')::jsonb where hotel_id = ${H}`);
};
const conCambio = (p, pct) => ({ ...p, modificadores: { ...p.modificadores, sencilla_pct: pct } });

console.log(`Seed: hotel ${H} calculator v${verDb(H)}; stored bases = ${JSON.stringify(paramsDb(H).bases.map((b) => b.temporada))}`);
const previas = () => JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'hotel_id', hotel_id, 'tipo_habitacion', tipo_habitacion, 'alimentacion', alimentacion, 'temporada', temporada, 'neto_sencilla', neto_sencilla, 'neto_doble', neto_doble, 'neto_triple', neto_triple, 'neto_multiple', neto_multiple, 'neto_nino', neto_nino, 'neto_nino2', neto_nino2, 'neto_infante', neto_infante)), '[]') from public.tarifa_hotel where hotel_id = ${H}`));

caso("1. Open → edit → save (no external change)");
let v = verDb(H); let p = paramsDb(H);
let r = await guardar(H, "dubai", conCambio(p, 55), v);
ok(r.ok && r.version === v + 1, "save succeeds and returns v+1");

caso("2. Open → save → edit → save again with the version the first save returned");
r = await guardar(H, "dubai", conCambio(p, 60), r.version);
ok(r.ok && r.version === v + 2, "second save succeeds (client chains the returned version)");
const vTras2 = r.version;

caso("3. Open → save → generate (does generating bump the calculator version?)");
const g = await hoteles.generarTarifasCalculadora(H, "agregar", previas());
console.log(`  generate: ${g.ok ? `ok (${g.generadas} rows)` : g.error}`);
ok(verDb(H) === vTras2, `generate does NOT change hotel_calculadora.version (db v${verDb(H)})`);

caso("4. Generate, then save again from the same form (client keeps the version of its last save)");
r = await guardar(H, "dubai", conCambio(p, 62), vTras2);
ok(r.ok, "save after generate succeeds: generate leaves the version untouched, so there is no obsolete token");

caso("5a. SAME USER, same page: rename vigencia ALTA→'ALTA 2027' (referenced by the calculator), then save from the still-open form");
v = r.version; p = paramsDb(H);
const ren = await hoteles.actualizarTemporada(TEMP_ALTA, inputTemp("ALTA 2027"));
console.log(`  rename result: ${ren.ok ? `ok${ren.aviso ? " — " + ren.aviso : ""}` : ren.error}`);
console.log(`  bases now stored: ${JSON.stringify(paramsDb(H).bases.map((b) => b.temporada))} | db version v${verDb(H)} (client still holds v${v})`);
ok(verDb(H) === v + 1, "the rename cascade rewrote hotel_calculadora (version +1) — written by the SAME user");
const stale = await guardar(H, "dubai", conCambio(p, 65), v);
ok(!stale.ok && stale.desactualizada === true && stale.motivo === "cambio" && stale.actual?.version === verDb(H), "stale form is rejected as motivo=cambio and the stored copy (version + params) comes back for the editor to explain");
ok(!/otra persona/i.test(stale.error), "the message no longer guesses an actor");
ok(JSON.stringify(paramsDb(H).bases.map((b) => b.temporada)) === '["ALTA 2027","ALTA 2027"]' || paramsDb(H).bases.every((b) => b.temporada === "ALTA 2027"), "stored calculator untouched by the rejected save");

caso("5b. Same user: the user would have overwritten the rename if the version had simply been refreshed (why the guard must stay)");
console.log(`  a form that still holds the OLD season name would write bases named 'ALTA' → orphaning every tariff generated under 'ALTA 2027'`);

caso("6a. UNRELATED change: rename vigencia CERRADA (not referenced by the calculator)");
restaurar(); v = verDb(H); p = paramsDb(H);
await hoteles.actualizarTemporada(TEMP_CERRADA, { ...inputTemp("CERRADA 2020"), inicio: "2027-07-01", fin: "2027-07-31", compraInicio: "2020-01-01", compraFin: "2020-12-31" });
ok(verDb(H) === v, `unrelated rename does not bump the calculator (db v${verDb(H)})`);
r = await guardar(H, "dubai", conCambio(p, 51), v); ok(r.ok, "save still succeeds");

caso("6b. RELATED non-name change: edit the dates of ALTA (name kept)");
restaurar(); v = verDb(H); p = paramsDb(H);
await hoteles.actualizarTemporada(TEMP_ALTA, { ...inputTemp("ALTA"), fin: "2027-03-30" });
ok(verDb(H) === v, `date edit of a referenced vigencia does not bump the calculator (db v${verDb(H)})`);
sql(`update public.hotel_temporadas set fecha_fin = '2027-03-31' where id = ${TEMP_ALTA}`);

caso("7. GENUINE concurrent save by another session (two users, same base version)");
restaurar(); v = verDb(H); p = paramsDb(H);
iniciarSesion("superadmin");
const otra = await guardar(H, "dubai", conCambio(p, 70), v);
iniciarSesion("operaciones");
const mia = await guardar(H, "dubai", conCambio(p, 80), v);
ok(otra.ok && !mia.ok && mia.desactualizada === true && mia.motivo === "cambio" && mia.actual?.version === otra.version, "first writer wins; second is rejected with motivo=cambio and the winner copy (optimistic concurrency preserved)");
const actor = sql(`select coalesce(actor_email, '(none)') || ' | v' || coalesce(despues->>'version','?') || ' | registro_id=' || coalesce(registro_id::text,'?') from public.auditoria where tabla = 'hotel_calculadora' order by id desc limit 1`);
console.log(`  audit log (existing trigger 087), last hotel_calculadora write: ${actor}`);

caso("9. Write DENIED by RLS (session ended / no agency context): 0 rows, same message although the version matches");
restaurar(); v = verDb(H); p = paramsDb(H);
sql(`update auth.sessions set not_after = now() - interval '1 minute' where id = '${USUARIOS.operaciones.sesion}'`);
r = await guardar(H, "dubai", conCambio(p, 90), v);
ok(!r.ok && r.motivo === "sin_permiso" && !r.desactualizada, `client version ${v} == database version ${verDb(H)}: classified as sin_permiso (not stale), nothing adopted`);
console.log(`  message: ${r.error}`);
sql(`update auth.sessions set not_after = null where id = '${USUARIOS.operaciones.sesion}'`);

caso("8a. Substitution flow (Mixta, hotel 436002): save(version) then substitute; revert path uses the version of the first save");
const HM = 436002; const vm = verDb(HM); const pm = paramsDb(HM);
const s1 = await guardar(HM, "mixta", pm, vm);
const s2 = await guardar(HM, "mixta", pm, s1.version);
ok(s1.ok && s2.ok, "save + revert chain works while nobody else writes (substitution itself does not touch hotel_calculadora)");
const s3 = await guardar(HM, "mixta", pm, vm);
ok(!s3.ok && s3.desactualizada, "a second tab of the same user (or a stale closure) sending the old version is rejected; within ONE form the buttons are disabled while pending");

caso("8b. Day-group path (hotel 436001 has groups on ALTA): group panel opened with the calculator version, then ALTA is renamed");
const gr = await import("../../app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
const H1 = 436001, T1 = 4360011, SEMANA = "00000000-0000-4000-8000-000000000011";
const cfg = await gr.leerConfigGrupos(T1); const vcg = Number(sql(`select version from public.hotel_calculadora where hotel_id = ${H1}`));
await hoteles.actualizarTemporada(T1, { hotelId: H1, nombre: "ALTA 2027", inicio: "2027-01-01", fin: "2027-03-31", prioridad: 1 });
const vdb = Number(sql(`select version from public.hotel_calculadora where hotel_id = ${H1}`));
const gres = await gr.guardarCalculoGrupo(T1, cfg.config.huella, SEMANA, "dubai", vcg, null, [{ categoria: "Estándar", precio: 120000 }], null, []);
console.log(`  compare: group panel sends calcVersion v${vcg} | database holds v${vdb} | result: ${gres.ok ? "ok" : `REJECTED${gres.desactualizada ? " (desactualizada)" : ""}: ${gres.error}`}`);
ok(vdb === vcg + 1 && !gres.ok && gres.desactualizada === true, "the group panel is also rejected after a rename (the vigencia fingerprint changed first; the calculator version moved +1 too). Its own message names the vigencia, not a person");

console.log(`\n${fallos === 0 ? "ALL CHECKS PASSED" : `${fallos} CHECK(S) FAILED`}`);
proxy.close(); process.exit(fallos === 0 ? 0 : 1);
