// Focused, bounded checks of the HARNESS itself (HJ-1 / HJ-2) — no journey, no full suites. Synthetic and local.
//   Needs the product build in .next (for the real app start). PostgreSQL ownership checks live in checks_pg_ownership.mjs.
// What it proves: (a) a FOREIGN listener on the launcher's port is never started over and never killed (start refuses; stop without record is a no-op; forged / stale / PID-reuse records are refused);
// (b) the launcher kills only a process whose pid + start time + command line it verified; (c) Next listens ONLY on 127.0.0.1 — and the loopback detector is shown to FAIL for Next's default bind;
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { AQUI, RAIZ, comprobarSoloLoopback, descendientes, escuchas, infoProceso, interfacesExternas } from "./lib.mjs";

const harness = path.join(AQUI, "harness.mjs"), work = fs.mkdtempSync(path.join(os.tmpdir(), "hj103-checks-"));
const P_FOREIGN = 39470, P_APP = 39471, P_RAW = 39473, resultados = [];
const check = (n, ok, d = "") => { resultados.push(ok); console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  — " + d : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const envBase = { ...process.env, HJ_WORK: work, HJ_APP_PORT: String(P_APP) };
const h = (cmd, env = {}) => { const r = spawnSync(process.execPath, [harness, cmd], { env: { ...envBase, ...env }, encoding: "utf8" }); return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") }; };
const propios = [];                                                                                 // processes THIS check started (the only ones it ever kills)
const lanzar = (args, opts = {}) => { const c = spawn(process.execPath, args, { detached: true, windowsHide: true, stdio: "ignore", ...opts }); c.unref(); propios.push(c.pid); return c.pid; };
const matar = (pid) => { try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } };
const http = async (puerto, ruta = "/") => { try { const r = await fetch(`http://127.0.0.1:${puerto}${ruta}`, { signal: AbortSignal.timeout(4000) }); return { status: r.status, texto: await r.text() }; } catch (e) { return { error: String(e?.cause?.code ?? e) }; } };
const vivo = (pid, creado) => { const i = infoProceso(pid); return !!i && (!creado || i.creado === creado); };
const reg = (nombre, obj) => fs.writeFileSync(path.join(work, "procs", `${nombre}.json`), JSON.stringify(obj));
const nextBin = createRequire(path.join(RAIZ, "package.json")).resolve("next/dist/bin/next");

try {
  const ini = h("init"); check("0.1 init generates credentials in a folder OUTSIDE the repository", ini.code === 0 && fs.existsSync(path.join(work, "config.json")), ini.out.split("\n")[0]);
  const dentro = h("init", { HJ_WORK: path.join(RAIZ, "tmp-hj-check") }); check("0.2 init refuses a work folder inside the repository (credentials never tracked)", dentro.code !== 0 && /inside the repository/.test(dentro.out) && !fs.existsSync(path.join(RAIZ, "tmp-hj-check")), dentro.out.trim().slice(0, 100));
  check("0.3 no build is touched: .next/BUILD_ID present and unchanged by the checks", fs.existsSync(path.join(RAIZ, ".next", "BUILD_ID")));
  const buildId = fs.readFileSync(path.join(RAIZ, ".next", "BUILD_ID"), "utf8");

  // ── foreign listener on the launcher's port ──
  const pF = lanzar(["-e", `require('http').createServer((q,r)=>r.end('foreign')).listen(${P_FOREIGN},'127.0.0.1')`]);
  const pApp = lanzar(["-e", `require('http').createServer((q,r)=>r.end('foreign-on-app-port')).listen(${P_APP},'127.0.0.1')`]);   // a second foreign process, on the port the launcher wants
  await sleep(1500);
  const infoF = infoProceso(pF), infoA = infoProceso(pApp);
  check("1.0 two foreign listeners are up (fixture)", !!infoF && !!infoA && (await http(P_FOREIGN)).texto === "foreign" && (await http(P_APP)).texto === "foreign-on-app-port");
  const s1 = h("app-start"); check("1.1 app-start REFUSES an occupied foreign port (non-zero exit, named reason)", s1.code !== 0 && /Refused: port \d+ is already in use/.test(s1.out), s1.out.trim().slice(0, 120));
  check("1.2 …and the foreign process was neither killed nor replaced", vivo(pApp, infoA.creado) && (await http(P_APP)).texto === "foreign-on-app-port");
  const s2 = h("app-stop"); check("1.3 app-stop with NO launcher record is a no-op (nothing owned, nothing stopped)", s2.code === 0 && /sin-registro/.test(s2.out) && vivo(pApp, infoA.creado), s2.out.trim().slice(0, 100));
  reg("app", { nombre: "app", pid: pApp, creado: infoA.creado, marcador: nextBin, puerto: P_APP });
  const s3 = h("app-stop"); check("1.4 a record pointing at a FOREIGN pid (right start time, wrong command line) is refused, foreign survives", /rechazado/.test(s3.out) && vivo(pApp, infoA.creado) && (await http(P_APP)).texto === "foreign-on-app-port", s3.out.trim().slice(0, 140));
  reg("app", { nombre: "app", pid: pApp, creado: "2020-01-01T00:00:00.0000000Z", marcador: nextBin, puerto: P_APP });
  const s4 = h("app-stop"); check("1.5 PID-reuse protection: right pid, WRONG start time → refused, foreign survives", /rechazado/.test(s4.out) && /start time differs/.test(s4.out) && vivo(pApp, infoA.creado), s4.out.trim().slice(0, 140));
  const muerto = lanzar(["-e", "process.exit(0)"]); await sleep(1200); reg("app", { nombre: "app", pid: muerto, creado: "2020-01-01T00:00:00.0000000Z", marcador: nextBin, puerto: P_APP });
  const s5 = h("app-stop"); check("1.6 a stale record of a dead process is just forgotten", s5.code === 0 && /ya-detenido/.test(s5.out) && !fs.existsSync(path.join(work, "procs", "app.json")), s5.out.trim().slice(0, 80));
  reg("app", { nombre: "app", pid: pApp, creado: infoA.creado, marcador: nextBin, puerto: P_APP });
  const s6 = h("app-start"); check("1.7 a forged record never makes start kill the foreign port owner (start still refuses)", s6.code !== 0 && vivo(pApp, infoA.creado) && (await http(P_APP)).texto === "foreign-on-app-port", s6.out.trim().slice(0, 100));
  fs.rmSync(path.join(work, "procs", "app.json"), { force: true });
  matar(pApp); await sleep(800);                                                                    // free the port: the next block starts the REAL app on it

  // ── real start: loopback only, ours only ──
  const a1 = h("app-start"); const lo = await comprobarSoloLoopback(P_APP);
  check("2.1 app-start succeeds on the free port and reports loopback-only", a1.code === 0 && /ONLY on 127\.0\.0\.1/.test(a1.out), a1.out.trim().split("\n").at(-1).slice(0, 140));
  check("2.2 the ONLY listener address is 127.0.0.1", JSON.stringify(lo.direcciones) === JSON.stringify(["127.0.0.1"]), JSON.stringify(lo.direcciones));
  const ext = interfacesExternas();
  check(`2.3 every non-loopback address of this machine (${ext.join(", ") || "none present"}) refuses a connection to the app`, lo.externasAlcanzables.length === 0 && lo.soloLoopback, ext.length ? "refused on " + ext.join(",") : "no external interface: proven by the listener address only");
  const recApp = JSON.parse(fs.readFileSync(path.join(work, "procs", "app.json"), "utf8"));
  check("2.4 the listener belongs to the process the launcher started (pid/descendants) and the record carries its start time", escuchas(P_APP).every((l) => descendientes(recApp.pid).has(l.pid)) && !!recApp.creado, `pid ${recApp.pid}`);
  const resp = await http(P_APP, "/login"); check("2.5 the compiled app answers HTTP on 127.0.0.1", resp.status > 0, `GET /login → ${resp.status ?? resp.error}`);
  const dup = h("app-start"); check("2.6 a second app-start while ours runs is refused and does not disturb it", dup.code !== 0 && /already running/.test(dup.out) && vivo(recApp.pid, recApp.creado));
  check("2.7 the foreign listener on another port is untouched by all of this", vivo(pF, infoF.creado) && (await http(P_FOREIGN)).texto === "foreign");
  const rs = h("app-restart"); const rec2 = JSON.parse(fs.readFileSync(path.join(work, "procs", "app.json"), "utf8"));
  check("2.8 app-restart replaces only our process (old pid gone, new pid owns the port)", rs.code === 0 && rec2.pid !== recApp.pid && !vivo(recApp.pid) && escuchas(P_APP).every((l) => descendientes(rec2.pid).has(l.pid)), `${recApp.pid} → ${rec2.pid}`);
  const st = h("app-stop"); check("2.9 app-stop stops exactly our verified process; port free; foreign still alive", st.code === 0 && /detenido/.test(st.out) && !vivo(rec2.pid) && escuchas(P_APP).length === 0 && vivo(pF, infoF.creado), st.out.trim().slice(0, 80));
  check("2.10 the product build was not touched", fs.readFileSync(path.join(RAIZ, ".next", "BUILD_ID"), "utf8") === buildId);

  // ── negative control: Next's DEFAULT bind (no -H) is NOT loopback-only, and the detector says so ──
  const pRaw = lanzar([nextBin, "start", "-p", String(P_RAW)], { cwd: RAIZ, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512" } });
  for (let i = 0; i < 40 && !escuchas(P_RAW).length; i++) await sleep(500);
  const loRaw = await comprobarSoloLoopback(P_RAW);
  check("3.1 control: `next start` WITHOUT -H listens beyond loopback and the detector reports it (so 2.2/2.3 are meaningful)", !loRaw.soloLoopback && loRaw.direcciones.some((d) => d !== "127.0.0.1"), `listeners ${loRaw.direcciones.join(",")}; reachable on ${loRaw.externasAlcanzables.join(",") || "-"}`);
  matar(pRaw);

} finally {
  for (const p of propios) matar(p);
  try { execFileSync(process.execPath, [harness, "app-stop"], { env: envBase, stdio: "ignore" }); } catch { /* nothing to stop */ }
  fs.rmSync(work, { recursive: true, force: true });
}
const ok = resultados.every(Boolean);
console.log(`\nHARNESS CHECKS ${ok ? "PASSED" : "FAILED"}: ${resultados.filter(Boolean).length}/${resultados.length}`);
process.exit(ok ? 0 : 1);
