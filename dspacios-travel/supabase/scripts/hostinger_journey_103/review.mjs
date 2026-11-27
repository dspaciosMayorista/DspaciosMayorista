// Owner review session (#103) — lifecycle of the WHOLE local review environment with the existing harness commands. Local, loopback, synthetic. Nothing runs until `start` is requested.
//   node review.mjs start        first time: dedicated PostgreSQL container + stack + review data + simulator + app (≈3–4 min). Afterwards: RESUMES the stopped environment exactly where it was (no re-creation, no re-seeding)
//   node review.mjs stop         stops app, simulator, stack and the dedicated container; DELETES NOTHING (database, captured mail, uploaded files, simulated mailbox, config, credentials and browser profile are kept)
//   node review.mjs status       real readiness checks (exit 0 = running and ready, or cleanly stopped; 1 = anything else)
//   node review.mjs reply DTM-2001 ["text"]    plays the supplier's reply (walkthrough W8) with these same review settings
//   node review.mjs browser [account]          opens the dedicated review browser profile (saved synthetic accounts) on the login page
//   node review.mjs browser-prepare [account] [--verify]   (re)seeds that profile; --verify proves in a real Edge that the form is filled
//   node review.mjs fingerprint  prints a fingerprint of the review progress (database, captured mail, uploaded files, simulated mailbox, config, saved accounts)
//   node review.mjs reset --destroy-review-data   EXPLICIT, owner-authorized only: deletes the review database, volumes and dedicated container (config, credentials and browser profile are kept)
// Settings (same for every review script): HJ_REVIEW_DIR (or HJ_WORK), default %USERPROFILE%\hostinger-review-103; HJ_SOURCE_PG_CONTAINER / HJ_SOURCE_TEMPLATE_DB (read-only schema source), defaults pg127 / plantilla127.
// Every failing step is reported and makes the exit status non-zero; a final «ready» / «stopped» is printed only after it was checked.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PG_PROPIO, ajustesRevision, cargarConfig, comprobarSoloLoopback, escuchas, leerEstadoRevision, sqlDesechable } from "./lib.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const http = async (url, init) => { try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) }); return r.status; } catch { return 0; } };
const dockerEstado = (nombre) => { const r = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", nombre], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : "absent"; };

/** Real readiness of a RUNNING environment: every line is observed, none is assumed. */
export async function comprobarListo(a, cfg) {
  const p = cfg.puertos, filas = [];
  const fila = (n, ok, d = "") => filas.push({ nombre: n, ok: !!ok, detalle: d });
  fila("compiled app answers /login", (await http(`http://127.0.0.1:${a.appPort ?? p.app}/login`)) === 200);
  fila("sign-in service (GoTrue via gateway)", (await http(`http://127.0.0.1:${p.gateway}/auth/v1/health`)) === 200);
  fila("data API (PostgREST via gateway)", (await http(`http://127.0.0.1:${p.gateway}/rest/v1/`, { headers: { apikey: cfg.anonKey } })) === 200);
  fila("file storage", (await http(`http://127.0.0.1:${p.storage}/status`)) === 200);
  fila("captured-mail inbox (Mailpit)", (await http(`http://127.0.0.1:${p.correo}/api/v1/info`)) === 200);
  fila("simulated Mail API", (await http(`http://127.0.0.1:${p.sim}/__ctl/log`, { method: "POST", body: "{}" })) === 200);
  try { const n = sqlDesechable(a)("select count(*) from public.usuarios where email like '%103@walk.test' and activo"); fila("review data present (4 active accounts)", n === "4", `accounts=${n}`); } catch (e) { fila("review data present (4 active accounts)", false, String(e.message).slice(0, 100)); }
  try { const lo = await comprobarSoloLoopback(a.appPort ?? p.app); fila("app listens only on 127.0.0.1", lo.soloLoopback, lo.direcciones.join(",")); } catch (e) { fila("app listens only on 127.0.0.1", false, String(e.message).slice(0, 80)); }
  return filas;
}
/** Real state of a STOPPED environment: nothing listening, containers not running, and the files that carry the review kept. */
export function comprobarDetenido(a, cfg) {
  const p = cfg.puertos, filas = [], fila = (n, ok, d = "") => filas.push({ nombre: n, ok: !!ok, detalle: d });
  for (const [n, port] of Object.entries({ app: a.appPort ?? p.app, gateway: p.gateway, auth: p.auth, rest: p.rest, correo: p.correo, storage: p.storage, sim: p.sim })) fila(`nothing listens on ${n} port ${port}`, escuchas(port).length === 0);
  for (const c of [PG_PROPIO, "hj103_auth", "hj103_rest", "hj103_mail", "hj103_stor"]) { const e = dockerEstado(c); fila(`container ${c} is not running`, e !== "true", e === "absent" ? "absent" : "stopped"); }
  for (const f of ["config.json", "pg.json", "review-state.json"]) fila(`kept: ${f}`, fs.existsSync(path.join(a.work, f)));
  return filas;
}
const imprimir = (filas, log) => { for (const f of filas) log(`  ${f.ok ? "OK  " : "FAIL"} ${f.nombre}${f.detalle ? "  — " + f.detalle : ""}`); return filas.every((f) => f.ok); };

export async function ejecutar(orden, args = [], opciones = {}) {
  const { spawn = spawnSync, env = process.env, log = console.log, err = console.error, verificarListo = comprobarListo, verificarDetenido = comprobarDetenido } = opciones;
  const a = ajustesRevision(env), entorno = { ...env, HJ_WORK: a.work, HJ_SOURCE_PG_CONTAINER: a.fuente, HJ_SOURCE_TEMPLATE_DB: a.fuentePlantilla };
  const fallos = [];
  const paso = (titulo, script, ...rest) => { log(`\n== ${titulo}`); const r = spawn(process.execPath, [path.join(AQUI, script), ...rest], { env: entorno, stdio: "inherit" }); const ok = r?.status === 0; if (!ok) { fallos.push(titulo); err(`   STEP FAILED: ${titulo} (exit ${r?.status ?? "none"})`); } return ok; };
  const cargar = () => cargarConfig(a);

  if (orden === "start") {
    if (!fs.existsSync(path.join(a.work, "config.json"))) { err(`No config in ${a.work}: it must hold the config that matches the product build.`); return 2; }
    const est = leerEstadoRevision(a), hayContenedor = fs.existsSync(path.join(a.work, "pg.json"));
    if (est.seeded && !hayContenedor) { err("This review was already seeded but its dedicated-container record is missing. Refusing to re-create it over a possible review: ask the executor (reset is explicit and destructive)."); return 1; }
    const pasos = est.seeded
      ? [["resume the stopped environment (nothing re-created, nothing re-seeded)", "harness.mjs", "resume"], ["simulated Mail API", "harness.mjs", "sim-start"], ["compiled app (loopback only)", "harness.mjs", "app-start"]]
      : [...(!hayContenedor ? [["dedicated PostgreSQL container", "harness.mjs", "pg-create"]] : []), ["stack", "harness.mjs", "up"], ["review data", "seed_review.mjs"], ["simulated Mail API", "harness.mjs", "sim-start"], ["compiled app (loopback only)", "harness.mjs", "app-start"]];
    for (const [t, s, ...r] of pasos) if (!paso(t, s, ...r)) break;
    if (fallos.length) { err(`\nNOT READY — failed step: ${fallos.join("; ")}. The review data seed is not atomic: running \`node review.mjs start\` again is safe (it is idempotent). Do not report the environment as ready.`); return 1; }
    log("\n== checking readiness"); const cfg = cargar(), filas = await verificarListo(a, cfg);
    if (!imprimir(filas, log)) { err("\nNOT READY — a readiness check failed (see above). Run `node review.mjs status` after fixing; nothing was reset."); return 1; }
    if (!paso("review browser: saved synthetic accounts + a REAL Edge autofill check", "review_browser.mjs", "prepare", "--verify")) { err("\nNOT READY — the review browser profile could not be verified (the environment itself is up). Saved-account selection is NOT confirmed; do not rely on it."); return 1; }
    log(`\nREVIEW SESSION READY (every check above observed, including the saved-account autofill) — http://127.0.0.1:${a.appPort ?? cfg.puertos.app}/login   accounts: ${path.join(a.work, "review_credentials.txt")}   browser: node review.mjs browser\nCaptured outgoing mail: http://127.0.0.1:${cfg.puertos.correo}`);
    return 0;
  }
  if (orden === "stop") {
    paso("stop everything without deleting anything", "harness.mjs", "stop");
    log("\n== checking the stopped state"); const filas = comprobarDetenidoSafe(verificarDetenido, a, cargar, err);
    const ok = imprimir(filas, log) && fallos.length === 0;
    if (!ok) { err(`\nSTOP FAILED${fallos.length ? ` — failed step: ${fallos.join("; ")}` : ""} — the environment may still be (partly) running. Nothing was deleted. Run \`node review.mjs status\`.`); return 1; }
    log(`\nREVIEW SESSION STOPPED (checked). Nothing was deleted: database, captured mail, uploaded files, simulated mailbox, config, credentials and browser profile are kept in ${a.work}. Resume with: node review.mjs start`);
    return 0;
  }
  if (orden === "status") {
    const cfg = cargar(), ocupados = Object.values({ app: a.appPort ?? cfg.puertos.app, gateway: cfg.puertos.gateway, correo: cfg.puertos.correo }).some((x) => escuchas(x).length > 0);
    if (ocupados) { const filas = await verificarListo(a, cfg), ok = imprimir(filas, log); log(ok ? "RUNNING AND READY" : "RUNNING BUT NOT READY"); return ok ? 0 : 1; }
    const filas = verificarDetenido(a, cfg), ok = imprimir(filas, log); log(ok ? "STOPPED (clean)" : "STOPPED/PARTIAL — inconsistent"); return ok ? 0 : 1;
  }
  if (orden === "reply") return paso("supplier reply (W8)", "review_reply.mjs", ...args) ? 0 : 1;
  if (orden === "browser") return paso("review browser", "review_browser.mjs", "open", ...args) ? 0 : 1;
  if (orden === "browser-prepare") return paso("review browser profile", "review_browser.mjs", "prepare", ...args) ? 0 : 1;
  if (orden === "fingerprint") return paso("fingerprint", "review_huella.mjs") ? 0 : 1;
  if (orden === "reset") {
    if (!args.includes("--destroy-review-data")) { err("reset DELETES the review database, uploaded files, captured mail and the dedicated container. It is explicit and owner-authorized only: add --destroy-review-data."); return 2; }
    entorno.HJ_CONFIRM_DESTROY = "yes";
    paso("tear down the stack and the review database", "harness.mjs", "down"); paso("remove the dedicated container", "harness.mjs", "pg-destroy");
    if (!fallos.length) { for (const f of ["review-state.json", "sim-state.json"]) fs.rmSync(path.join(a.work, f), { force: true }); }
    if (fallos.length) { err(`\nRESET INCOMPLETE — failed step: ${fallos.join("; ")}.`); return 1; }
    log(`\nREVIEW DATA DELETED (explicit reset). Config, credentials and browser profile are kept in ${a.work}.`); return 0;
  }
  err("Usage: node review.mjs start|stop|status|reply <contract> [text]|browser [account]|browser-prepare [account] [--verify]|fingerprint|reset --destroy-review-data"); return 2;
}
function comprobarDetenidoSafe(verificar, a, cargar, err) { try { return verificar(a, cargar()); } catch (e) { err("cannot check the stopped state: " + e.message); return [{ nombre: "stopped-state check", ok: false, detalle: String(e.message).slice(0, 100) }]; } }

if (path.basename(process.argv[1] ?? "") === "review.mjs") process.exit(await ejecutar(process.argv[2], process.argv.slice(3)));
