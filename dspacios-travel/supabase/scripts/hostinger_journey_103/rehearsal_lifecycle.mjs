// EXECUTOR REHEARSAL, part 2 (OW-1): stop/start must PRESERVE the review. Runs on the SAME disposable fixture after rehearsal_walkthrough.mjs: fingerprint → `review.mjs stop` → `review.mjs start` (resume) → fingerprint,
// then the review still works (saved-account sign-in, earlier results, another reply recorded) and destructive commands over review progress are refused with nothing changed.
//   HJ_REVIEW_DIR=<rehearsal folder> node rehearsal_lifecycle.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AQUI, ajustesRevision, cargarConfig, sqlDesechable } from "./lib.mjs";
import { abrirNavegador, ingresarConAutofill, prepararPerfil } from "./review_browser.mjs";

const a = ajustesRevision(), cfg = cargarConfig(a), sql = sqlDesechable(a), BASE = `http://127.0.0.1:${cfg.puertos.app}`;
const EVID = path.join(a.work, "evidence"); fs.mkdirSync(EVID, { recursive: true });
const resultados = [];
const afirmar = (n, ok, d = "") => { resultados.push({ nombre: n, ok: !!ok, detalle: String(d).slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${n}${ok ? "" : " · " + String(d).slice(0, 300)}`); };
const review = (...args) => spawnSync(process.execPath, [path.join(AQUI, "review.mjs"), ...args], { env: { ...process.env, HJ_REVIEW_DIR: a.work }, encoding: "utf8" });
const huella = () => { const r = spawnSync(process.execPath, [path.join(AQUI, "review_huella.mjs")], { env: { ...process.env, HJ_REVIEW_DIR: a.work }, encoding: "utf8" }); if (r.status !== 0) throw new Error("fingerprint failed: " + (r.stderr ?? "").slice(0, 200)); return JSON.parse(r.stdout); };
let b = null;
const panel = () => b.evaluar(() => document.querySelector('[data-testid="solicitudes-proveedor"]')?.innerText ?? "");
async function sesion(cuenta) { if (b) await b.cerrar(); await prepararPerfil(a, cfg, cuenta); b = await abrirNavegador(a, cfg); await b.limpiarSesion(); return ingresarConAutofill(b, cfg, a, cuenta); }
const limpio = { ...process.env, HJ_REVIEW_DIR: a.work }; for (const k of ["HJ_WORK", "HJ_SOURCE_PG_CONTAINER", "HJ_SOURCE_TEMPLATE_DB", "HJ_DB", "HJ_APP_PORT"]) delete limpio[k];
const fresco = (texto2) => spawnSync("powershell.exe", ["-NoProfile", "-Command", `Set-Location '${AQUI}'; node review_reply.mjs DTM-2001 '${texto2}'`], { env: limpio, encoding: "utf8" });
let t;

// ───────────── Lifecycle: stop/start preserves the review (OW-1) ─────────────
const hA = huella();
afirmar("L1 fingerprint taken before stop covers the database, uploaded files (rows and bytes), captured mail, simulated mailbox, files and saved accounts", Object.values(hA.tablas).filter((x) => x === "n/a").length === 0 && hA.correoCapturado !== "n/a" && hA.bytesAlmacenados !== "n/a" && hA.ficheros["sim-state.json"] !== "absent" && hA.cuentasNavegador !== "n/a", JSON.stringify({ tablasNA: Object.entries(hA.tablas).filter(([, v]) => v === "n/a").map(([k]) => k), correo: hA.correoCapturado, bytes: hA.bytesAlmacenados.slice(0, 12) }));
const st = review("stop"); afirmar("L2 `review.mjs stop` exits 0 after OBSERVING the stopped state", st.status === 0 && /REVIEW SESSION STOPPED \(checked\)/.test(st.stdout) && !/FAIL/.test(st.stdout), st.stdout.split("\n").filter((x) => /FAIL|STOP/.test(x)).join(" | ").slice(0, 200));
const ss = review("status"); afirmar("L3 `review.mjs status` reports STOPPED (clean) with exit 0", ss.status === 0 && /STOPPED \(clean\)/.test(ss.stdout), ss.stdout.split("\n").at(-2));
afirmar("L4 files kept while stopped: config, credentials folder content, ownership record, review state, simulated mailbox, browser profile", ["config.json", "pg.json", "review-state.json", "sim-state.json", "soporte-walk.pdf", "edge-profile/Default/Login Data"].every((f) => fs.existsSync(path.join(a.work, f))));
const sr = review("start"); afirmar("L5 `review.mjs start` RESUMES (no re-creation), every readiness check is observed OK and the browser autofill is re-verified", sr.status === 0 && /resume the stopped environment/.test(sr.stdout) && /Edge filled the sign-in form/.test(sr.stdout) && !/pg-create|applying 2026/.test(sr.stdout) && /REVIEW SESSION READY/.test(sr.stdout) && !/FAIL/.test(sr.stdout), sr.stdout.split("\n").filter((x) => /FAIL|READY|resume/.test(x)).join(" | ").slice(0, 240));
const hB = huella();
const difs = [...Object.keys(hA.tablas)].filter((k) => hA.tablas[k] !== hB.tablas[k]).concat(Object.keys(hA.ficheros).filter((k) => hA.ficheros[k] !== hB.ficheros[k]), ["correoCapturado", "bytesAlmacenados", "cuentasNavegador"].filter((k) => hA[k] !== hB[k]));
afirmar("L6 fingerprint after start is IDENTICAL to the one before stop (database rows, uploaded bytes, captured mail, simulated mailbox, files, saved accounts)", difs.length === 0, difs.join(", "));
// the review still works after the resume: autofill login, earlier results visible, and another reply is recorded (simulated mailbox kept its numbering)
await sesion("admin103@walk.test"); await b.ir(`${BASE}/dashboard/contratos/DTM-2001`); await b.dormir(3000); t = await panel();
afirmar("L7 after the resume the earlier request still shows «Respondió» and its history", /Respondió/.test(t) && /Código SS-2027-X/.test(t), t.slice(0, 200));
const contarRespuestas = () => Number(sql("select count(*) from public.solicitud_proveedor_eventos e join public.solicitudes_proveedor s on s.id = e.solicitud_id where s.numero_contrato = 'DTM-2001' and e.tipo = 'respuesta'")), antesResp = contarRespuestas();
const rr2 = fresco("Respuesta tras reanudar.");
afirmar("L8 a second reply after the restart is recorded exactly once (the simulated mailbox kept its position)", rr2.status === 0 && /new replies recorded: 1/.test(rr2.stdout) && contarRespuestas() === antesResp + 1, (rr2.stdout + rr2.stderr).replace(/\s+/g, " ").slice(0, 200));
await b.cerrar(); b = null;
// destructive commands over review progress are refused (OW-1), with nothing changed
const hC0 = huella(); const env2 = { ...process.env, HJ_WORK: a.work }; delete env2.HJ_CONFIRM_DESTROY;
const nega = (cmd) => spawnSync(process.execPath, [path.join(AQUI, "harness.mjs"), cmd], { env: env2, encoding: "utf8" });
for (const cmd of ["up", "down", "pg-destroy"]) { const r = nega(cmd); afirmar(`L9 harness «${cmd}» over seeded review progress is refused`, r.status !== 0 && /DESTROY the owner's review progress/.test(r.stdout + r.stderr), (r.stdout + r.stderr).trim().split("\n").at(-1).slice(0, 120)); }
const rs = review("reset"); afirmar("L10 `review.mjs reset` without the explicit flag refuses (exit 2)", rs.status === 2);
const hC1 = huella(); afirmar("L11 after those refusals nothing changed (fingerprints equal; environment still running)", JSON.stringify(hC0) === JSON.stringify(hC1) && review("status").status === 0);

const fallos = resultados.filter((r) => !r.ok);
fs.writeFileSync(path.join(EVID, "rehearsal_lifecycle.json"), JSON.stringify({ ok: fallos.length === 0, total: resultados.length, resultados, huellaAntesDeParar: hA, huellaTrasReanudar: hB }, null, 2));
console.log(`\nLIFECYCLE REHEARSAL ${fallos.length ? "FAILED" : "PASSED"}: ${resultados.length - fallos.length}/${resultados.length}`);
process.exit(fallos.length ? 1 : 0);
