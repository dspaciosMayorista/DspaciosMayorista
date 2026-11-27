// Prueba del CICLO DE VIDA sobre la COPIA de ensayo (REV_ENSAYO implícito): detener → iniciar CONSERVA datos, archivos de Storage, correo capturado, cuentas y credenciales, y NO toca la base del dueño ni su foto.
// «Restaurar» es una acción separada: aquí además se comprueba que `restaurar` se niega sin --confirmar y que `preparar` se niega sobre una revisión ya preparada.
//   node supabase/scripts/revision_consolidada/ciclo_vida.mjs        (con el ensayo ARRIBA: REV_ENSAYO=1 node revision.mjs ensayo-iniciar)
import { spawnSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
const AQUI = import.meta.dirname, APP = path.resolve(AQUI, "../../..");
const CFG = path.join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const c = JSON.parse(fs.readFileSync(path.join(CFG, "config.json"), "utf8"));
const REV = (args, ens = true) => spawnSync(process.execPath, [path.join(AQUI, "revision.mjs"), ...args], { cwd: APP, encoding: "utf8", env: { ...process.env, ...(ens ? { REV_ENSAYO: "1" } : {}) } });
const sql = (db, q) => { const r = spawnSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pgrevc", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const res = []; const check = (n, ok, d = "") => { res.push(ok); console.log(`${ok ? "OK   " : "FALLA"} ${n}${ok ? "" : " · " + d}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const correo = async () => (await (await fetch(`http://127.0.0.1:${c.puertos.correo}/api/v1/messages`)).json());
const login = async (alias) => (await fetch(`http://127.0.0.1:${c.puertos.gateway}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: c.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email: `${alias}@consolidada.test`, password: "Consolidada2026!" }) })).status;

const dueno0 = { avisos: sql("rev_consolidada", "select count(*) from public.avisos"), ventas: sql("rev_consolidada", "select count(*) from public.ventas"), usuarios: sql("rev_consolidada", "select count(*) from public.usuarios") };
const foto0 = sql("rev_consolidada_foto", "select count(*) from public.ventas");
// 1) marcas de progreso
sql("rev_consolidada_ensayo", "update public.ventas set observaciones = 'MARCA-CICLO' where numero_contrato = 'DTM-9701'");
const storageDir = path.join(CFG, "storage_ensayo"); fs.mkdirSync(storageDir, { recursive: true }); fs.writeFileSync(path.join(storageDir, "marca-ciclo.txt"), "marca");
await fetch(`http://127.0.0.1:${c.puertos.correo}/api/v1/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ From: { Email: "a@consolidada.test" }, To: [{ Email: "b@consolidada.test" }], Subject: "MARCA-CICLO", Text: "x" }) });
await espera(1000); const antesCorreo = (await correo()).total;
check("antes: la marca de correo está en el buzón de pruebas", (await correo()).messages.some((m) => m.Subject === "MARCA-CICLO"));
check("antes: se puede iniciar sesión con la cuenta real (GoTrue)", (await login("gerencia")) === 200);
// 2) detener
const d = REV(["detener"]); check("detener termina bien y dice que conserva", d.status === 0 && /se conservan/.test(d.stdout), d.stderr || d.stdout);
const abajo = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).stdout;
check("la pila y la base de revisión quedan detenidas (nada consrev_* ni pgrevc corriendo)", !/consrev_|pgrevc/.test(abajo), abajo);
check("la app ya no escucha", await fetch(`http://localhost:${c.puertos.app}/login`).then(() => false, () => true));
// 3) iniciar de nuevo
const i = REV(["iniciar"]); check("iniciar termina bien", i.status === 0 && /Lista/.test(i.stdout), i.stderr || i.stdout);
check("conserva el dato guardado (MARCA-CICLO)", sql("rev_consolidada_ensayo", "select observaciones from public.ventas where numero_contrato = 'DTM-9701'") === "MARCA-CICLO");
check("conserva el archivo de Storage", fs.existsSync(path.join(storageDir, "marca-ciclo.txt")));
const despues = await correo(); check("conserva el correo capturado", despues.total >= antesCorreo && despues.messages.some((m) => m.Subject === "MARCA-CICLO"), `${antesCorreo} → ${despues.total}`);
check("la misma cuenta real inicia sesión de nuevo", (await login("gerencia")) === 200);
check("credenciales y estado intactos", fs.existsSync(path.join(CFG, "credenciales.txt")) && JSON.parse(fs.readFileSync(path.join(CFG, "estado.json"), "utf8")).preparado === true);
// 4) la base del dueño y su foto NO se tocaron
const dueno1 = { avisos: sql("rev_consolidada", "select count(*) from public.avisos"), ventas: sql("rev_consolidada", "select count(*) from public.ventas"), usuarios: sql("rev_consolidada", "select count(*) from public.usuarios") };
check("la base del dueño (rev_consolidada) no cambió", JSON.stringify(dueno0) === JSON.stringify(dueno1), JSON.stringify([dueno0, dueno1]));
check("la foto (rev_consolidada_foto) no cambió", sql("rev_consolidada_foto", "select count(*) from public.ventas") === foto0);
check("la base del dueño NO tiene la marca del ensayo", sql("rev_consolidada", "select coalesce(observaciones, '') from public.ventas where numero_contrato = 'DTM-9701'") !== "MARCA-CICLO");
// 5) acciones destructivas rehúsan sin confirmación
const r = REV(["restaurar"], false); check("restaurar sin --confirmar se niega y no hace nada", r.status !== 0 && /DESCARTA/.test(r.stderr), r.stderr);
const p = REV(["preparar"], false); check("preparar sobre una revisión ya preparada se niega", p.status !== 0 && /ya está preparada/.test(p.stderr), p.stderr);
sql("rev_consolidada_ensayo", "update public.ventas set observaciones = null where numero_contrato = 'DTM-9701' and observaciones = 'MARCA-CICLO'"); fs.rmSync(path.join(storageDir, "marca-ciclo.txt"), { force: true });
console.log(`\n${res.filter(Boolean).length}/${res.length} comprobaciones OK`); process.exit(res.every(Boolean) ? 0 : 1);
