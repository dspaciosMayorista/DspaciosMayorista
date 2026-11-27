// OW-2 / OW-3 focused checks of the review wrapper — no services, no Docker, no database. Injects the child-process runner, so nothing is started.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIR_REVISION_POR_DEFECTO, ajustesRevision } from "./lib.mjs";
import { ejecutar } from "./review.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url)), res = [];
const check = (n, ok, d = "") => { res.push(ok); console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  — " + d : ""}`); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), "hj103-reviewchk-"));
fs.writeFileSync(path.join(work, "config.json"), JSON.stringify({ jwtSecret: "x", anonKey: "x", serviceKey: "x", rolesPassword: "x", puertos: { gateway: 19080, auth: 19081, rest: 19082, correo: 19083, app: 3047, sim: 19086, storage: 19084 } }));
const captura = () => { const l = []; return { l, log: (...x) => l.push(x.join(" ")), err: (...x) => l.push(x.join(" ")) }; };
const env = { ...process.env, HJ_REVIEW_DIR: work }; delete env.HJ_WORK;
const filasOk = [{ nombre: "x", ok: true }], filasMal = [{ nombre: "x", ok: false, detalle: "down" }];
const todoFalla = () => ({ status: 1 }), todoBien = () => ({ status: 0 });
try {
  // OW-2 — the auditor's probe: every child step fails
  let c = captura(); let codigo = await ejecutar("stop", [], { spawn: todoFalla, env, log: c.log, err: c.err, verificarDetenido: () => filasOk });
  check("O2.1 stop: when the child step fails the exit status is non-zero", codigo !== 0, `exit ${codigo}`);
  check("O2.2 …and the output never claims the session stopped", !/SESSION STOPPED/.test(c.l.join("\n")) && /STOP FAILED/.test(c.l.join("\n")));
  c = captura(); codigo = await ejecutar("stop", [], { spawn: todoBien, env, log: c.log, err: c.err, verificarDetenido: () => filasMal });
  check("O2.3 stop: the child step «succeeds» but the OBSERVED state is not stopped → non-zero, honest message", codigo !== 0 && /STOP FAILED/.test(c.l.join("\n")) && /FAIL .*x/.test(c.l.join("\n")));
  c = captura(); codigo = await ejecutar("stop", [], { spawn: todoBien, env, log: c.log, err: c.err, verificarDetenido: () => filasOk });
  check("O2.4 stop: success only when the step succeeded AND the stopped state was observed", codigo === 0 && /SESSION STOPPED \(checked\)/.test(c.l.join("\n")));
  c = captura(); codigo = await ejecutar("start", [], { spawn: todoFalla, env, log: c.log, err: c.err, verificarListo: async () => filasOk });
  check("O2.5 start: failing steps → non-zero and «NOT READY» (never «READY»)", codigo !== 0 && /NOT READY/.test(c.l.join("\n")) && !/REVIEW SESSION READY/.test(c.l.join("\n")));
  c = captura(); codigo = await ejecutar("start", [], { spawn: todoBien, env, log: c.log, err: c.err, verificarListo: async () => filasMal });
  check("O2.6 start: steps «succeed» but readiness fails → non-zero, NOT READY, the failing check is listed", codigo !== 0 && /NOT READY/.test(c.l.join("\n")) && /FAIL .*x/.test(c.l.join("\n")));
  c = captura(); codigo = await ejecutar("reset", [], { spawn: todoBien, env, log: c.log, err: c.err });
  check("O2.7 reset without the explicit flag refuses (exit 2) and runs nothing", codigo === 2 && !c.l.some((x) => /^==/.test(x)));
  // OW-1 guard of the wrapper itself: seeded review whose container record is missing is never re-created
  fs.writeFileSync(path.join(work, "review-state.json"), JSON.stringify({ seeded: true })); c = captura();
  let llamadas = 0; codigo = await ejecutar("start", [], { spawn: () => { llamadas++; return { status: 0 }; }, env, log: c.log, err: c.err });
  check("O1.1 start on a seeded review with a missing container record refuses to re-create anything", codigo === 1 && llamadas === 0, c.l.join(" ").slice(0, 100));
  // OW-3 — one settings function for every review entry point
  const fuentes = ["review.mjs", "review_reply.mjs", "seed_review.mjs", "review_browser.mjs", "review_huella.mjs"].map((f) => [f, fs.readFileSync(path.join(AQUI, f), "utf8")]);
  check("O3.1 every review entry point resolves its settings through ajustesRevision (none calls ajustes() directly)", fuentes.every(([, t]) => /ajustesRevision/.test(t) && !/[^a-zA-Z]ajustes\(\)/.test(t)), fuentes.map(([f]) => f).join(", "));
  const sinEnv = { ...process.env }; for (const k of ["HJ_WORK", "HJ_REVIEW_DIR"]) delete sinEnv[k];
  check("O3.2 with no environment the review folder is %USERPROFILE%\\hostinger-review-103 for all of them", ajustesRevision(sinEnv).work === path.resolve(DIR_REVISION_POR_DEFECTO) && path.basename(DIR_REVISION_POR_DEFECTO) === "hostinger-review-103");
  check("O3.3 HJ_REVIEW_DIR moves every entry point to the same folder", ajustesRevision({ ...sinEnv, HJ_REVIEW_DIR: work }).work === path.resolve(work));
  // a FRESH process of the standalone W8 helper, with only the documented setting, reads that folder (and says which)
  const r = spawnSync(process.execPath, [path.join(AQUI, "review_reply.mjs"), "DTM-2001"], { env: { ...sinEnv, HJ_REVIEW_DIR: path.join(work, "otra") }, encoding: "utf8" });
  check("O3.4 a fresh process of review_reply.mjs honours HJ_REVIEW_DIR (it looks for the config in THAT folder)", r.status !== 0 && /No config at .*otra.*config\.json/.test((r.stdout ?? "") + (r.stderr ?? "")), ((r.stderr ?? "") + (r.stdout ?? "")).trim().split("\n").find((x) => /No config/.test(x))?.slice(0, 120));
} finally { fs.rmSync(work, { recursive: true, force: true }); }
const ok = res.every(Boolean);
console.log(`\nREVIEW WRAPPER CHECKS ${ok ? "PASSED" : "FAILED"}: ${res.filter(Boolean).length}/${res.length}`);
process.exit(ok ? 0 : 1);
