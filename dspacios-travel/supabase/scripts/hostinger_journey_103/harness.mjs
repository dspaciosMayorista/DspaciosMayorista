// Hostinger journey harness (#103): ONE reproducible local sequence — init → up → seed → sim-start → app-start → run → app-stop → sim-stop → down. See README.md.
// Everything is loopback and disposable. The PostgreSQL container that gets MUTATED is never a setting: it is the dedicated container `hj103_pg` that `pg-create` makes (ownership-verified before every mutation).
// Settings (environment): HJ_WORK, HJ_DB, HJ_APP_PORT, and — only for `pg-create` — HJ_SOURCE_PG_CONTAINER / HJ_SOURCE_TEMPLATE_DB (read-only source of the base schema). See lib.mjs `ajustes`.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { AQUI, BUZON, ETIQUETA, ETIQUETA_PG, PG_PROPIO, RAIZ, ajustes, cargarConfig, comprobarSoloLoopback, contrasenaRevision, crearBdDesechable, detenerPropio, escuchas, exigirConfirmacionDestruccion, exigirContenedorPropio, exigirTrabajoFueraDelRepo, iniciarConfig, iniciarPropio, psql, requerir, sqlDesechable, validarBdDesechable, verificarPropio } from "./lib.mjs";

const a = ajustes(), orden = process.argv[2];
const N = { net: "hj103_net", auth: "hj103_auth", rest: "hj103_rest", mail: "hj103_mail", stor: "hj103_stor" };
const VOL = { mail: "hj103_mail_data", stor: "hj103_stor_data" };          // named volumes: captured mail and uploaded files survive an ordinary stop/start
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const dockerOk = (...args) => { try { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const logs = () => { fs.mkdirSync(path.join(a.work, "logs"), { recursive: true }); return (n) => path.join(a.work, "logs", n); };
const nextBin = () => createRequire(path.join(RAIZ, "package.json")).resolve("next/dist/bin/next");
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const log = (...x) => console.log(...x);

/** Environment of the COMPILED app: local stack + Hostinger entry pointing at the simulated Mail API (loopback only, enforced by the app itself). */
export function entornoApp(cfg) {
  const p = cfg.puertos;
  return {
    ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${p.gateway}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: cfg.anonKey, SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey,
    SOLICITUD_PROVEEDOR_EMAIL: "captura", SOLICITUD_PROVEEDOR_CAPTURA_URL: `http://127.0.0.1:${p.correo}`, SOLICITUD_PROVEEDOR_REMITENTE: "solicitudes@walk.test", SOLICITUD_PROVEEDOR_RESPONDER_A: "respuestas@walk.test", SOLICITUD_PROVEEDOR_AVISO_EMAILS: "interno@walk.test",
    SOLICITUD_PROVEEDOR_HOSTINGER: "activo", SOLICITUD_PROVEEDOR_HOSTINGER_WEBHOOK_SECRET: cfg.journey.webhookSecret, SOLICITUD_PROVEEDOR_HOSTINGER_TOKEN: cfg.journey.apiToken, SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID: BUZON,
    SOLICITUD_PROVEEDOR_HOSTINGER_API_URL: `http://127.0.0.1:${p.sim}`, CRON_SECRET: cfg.journey.cronSecret, NODE_OPTIONS: "--max-old-space-size=1024",
  };
}
const puertoApp = (cfg) => a.appPort ?? cfg.puertos.app;
const http200 = (url) => { try { return execFileSync("curl.exe", ["-s", "-o", "NUL", "-w", "%{http_code}", url], { encoding: "utf8" }) === "200"; } catch { return false; } };
/** Waits (bounded) until GoTrue and the storage API answer; throws with their logs otherwise. */
function esperarPila(cfg) {
  const p = cfg.puertos; let ok = false, st = false;
  for (let i = 0; i < 90 && !(ok && st); i++) { ok = ok || http200(`http://127.0.0.1:${p.auth}/health`); st = st || http200(`http://127.0.0.1:${p.storage}/status`); if (!(ok && st)) sleep(2000); }
  requerir(ok, "GoTrue did not become healthy: " + dockerOk("logs", "--tail", "15", N.auth));
  requerir(st, "The storage API did not become healthy: " + dockerOk("logs", "--tail", "15", N.stor));
  sleep(2000);
}
function iniciarGateway(cfg) {
  const p = cfg.puertos;
  iniciarPropio(a, { nombre: "gateway", cmd: process.execPath, args: [path.join(AQUI, "gateway.mjs"), String(p.gateway), String(p.auth), String(p.rest), String(p.storage)], env: process.env, puerto: p.gateway, marcador: path.join(AQUI, "gateway.mjs"), log: logs()("gateway.log") });
}

const comandos = {
  init() { const c = iniciarConfig(a); log(`config ready in ${a.work} (generated credentials stay there; never copy them into the repository)`); log("ports:", JSON.stringify(c.puertos)); },

  "build-env"() {                                  // prints the environment the PRODUCT BUILD must be made with (the gateway URL and anon key are inlined into the bundle)
    const c = cargarConfig(a); log(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${c.puertos.gateway}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${c.anonKey}`);
  },

  /** Creates the DEDICATED PostgreSQL container (the only one the harness will ever mutate) and loads the base schema into it from a read-only source (pg_dump). The source is never modified. */
  "pg-create"() {
    requerir(a.pg === PG_PROPIO, `pg-create makes only the dedicated container ${PG_PROPIO}; unset HJ_PG_CONTAINER.`);
    requerir(a.fuente && a.fuentePlantilla, "Set HJ_SOURCE_PG_CONTAINER and HJ_SOURCE_TEMPLATE_DB: an existing container + template database that are only READ (pg_dump) to seed the dedicated container.");
    requerir(a.fuente !== PG_PROPIO, "The source container cannot be the dedicated one.");
    exigirTrabajoFueraDelRepo(a.work); fs.mkdirSync(a.work, { recursive: true });
    requerir(dockerOk("inspect", "-f", "{{.Id}}", PG_PROPIO) === null, `Refused: a container named ${PG_PROPIO} already exists; it is not touched. If it is the harness's own, run: node harness.mjs pg-destroy.`);
    const dx = (c, pass, db, sql) => execFileSync("docker", ["exec", "-e", `PGPASSWORD=${pass}`, c, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-t", "-A", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    requerir(dx(a.fuente, a.fuentePass, "postgres", `select count(*) from pg_database where datname = '${a.fuentePlantilla.replace(/'/g, "''")}'`) === "1", `Source template database ${a.fuentePlantilla} not found in ${a.fuente}.`);   // read-only
    const password = randomBytes(16).toString("hex");
    docker("run", "-d", "--name", PG_PROPIO, "--label", `${ETIQUETA}=1`, "--label", `${ETIQUETA_PG}=dedicated`, "--memory", "768m", "-e", `POSTGRES_PASSWORD=${password}`, a.imagen);
    const id = docker("inspect", "-f", "{{.Id}}", PG_PROPIO);
    fs.writeFileSync(path.join(a.work, "pg.json"), JSON.stringify({ nombre: PG_PROPIO, id, password, imagen: a.imagen, creado: new Date().toISOString() }), { mode: 0o600 });     // the ownership record is written BEFORE anything is executed inside
    let listo = false; for (let i = 0; i < 90 && !listo; i++) { try { listo = dx(PG_PROPIO, password, "postgres", "select 1") === "1"; } catch { /* starting */ } if (!listo) sleep(2000); }
    requerir(listo, "The dedicated PostgreSQL container did not become ready.");
    sleep(3000);
    const a2 = ajustes();                                                                     // re-read with the new record
    psql(a2, "postgres", `create database ${a2.plantilla}`);
    const volcado = path.join(a.work, "template.dump"), fd = fs.openSync(volcado, "w");
    const d = spawnSync("docker", ["exec", "-e", `PGPASSWORD=${a.fuentePass}`, a.fuente, "pg_dump", "-h", "127.0.0.1", "-U", "supabase_admin", "-Fc", "-d", a.fuentePlantilla], { stdio: ["ignore", fd, "pipe"], encoding: "utf8" }); fs.closeSync(fd);
    requerir(d.status === 0, "pg_dump of the source template failed: " + String(d.stderr).slice(0, 200));
    const fin = fs.openSync(volcado, "r");
    const rs = spawnSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${password}`, PG_PROPIO, "pg_restore", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", a2.plantilla], { stdio: [fin, "pipe", "pipe"], encoding: "utf8" }); fs.closeSync(fin);
    fs.rmSync(volcado, { force: true });
    // pg_restore reports benign errors for objects owned by the managed image (e.g. grants on graphql_public functions): the restore is accepted only if the public schema matches the source
    const cuenta = "select count(*) from information_schema.tables where table_schema = 'public'", enOrigen = dx(a.fuente, a.fuentePass, a.fuentePlantilla, cuenta), enCopia = psql(a2, a2.plantilla, cuenta);
    requerir(Number(enCopia) > 50 && enCopia === enOrigen, `The restored template does not match the source (public tables: source ${enOrigen}, copy ${enCopia}); pg_restore: ${String(rs.stderr).slice(0, 200)}`);
    log(`dedicated PostgreSQL container ${PG_PROPIO} ready (ownership recorded in ${path.join(a.work, "pg.json")}); template database ${a2.plantilla} loaded read-only from ${a.fuente}/${a.fuentePlantilla}`);
  },
  /** Removes the dedicated container — only after verifying it is the one this work folder created. */
  "pg-destroy"() {
    exigirContenedorPropio(a, { parado: true });
    exigirConfirmacionDestruccion(a, "pg-destroy");
    docker("rm", "-f", "-v", PG_PROPIO); fs.rmSync(path.join(a.work, "pg.json"), { force: true }); log(`removed ${PG_PROPIO}`);
  },

  up() {
    exigirContenedorPropio(a);                                  // FIRST: before ports, teardown, template, database or role statements
    exigirConfirmacionDestruccion(a, "up");                      // `up` recreates the database: never over seeded review progress
    const cfg = cargarConfig(a), p = cfg.puertos;
    for (const [n, port] of Object.entries({ gateway: p.gateway, auth: p.auth, rest: p.rest, correo: p.correo, storage: p.storage })) { const o = escuchas(port); requerir(!o.length, `Refused: port ${port} (${n}) is in use by pid ${o[0]?.pid}; left untouched.`); }
    for (const c of Object.values(N)) { const et = dockerOk("inspect", "-f", `{{index .Config.Labels "${ETIQUETA}"}}`, c); if (et !== null) requerir(et === "1", `Refused: a container named ${c} exists and was not created by this harness.`); }
    this.down({ conservarConfig: true, silencioso: true });
    crearBdDesechable(a);
    psql(a, "postgres", `alter role authenticator with password '${cfg.rolesPassword}'; alter role supabase_auth_admin with password '${cfg.rolesPassword}'; alter role supabase_storage_admin with password '${cfg.rolesPassword}';`);
    psql(a, a.db, fs.readFileSync(path.join(AQUI, "auth_owner_fix.sql"), "utf8"), { input: true });
    const dirMig = path.join(RAIZ, "supabase", "migrations");
    const migraciones = fs.readdirSync(dirMig).filter((x) => /^20260601\d{6}_.*\.sql$/.test(x) && Number(x.slice(8, 14)) >= 315).sort();
    requerir(migraciones.length > 0, "No migrations >= 315 found in this checkout (unexpected).");
    for (const f of migraciones) { log("applying", f); psql(a, a.db, fs.readFileSync(path.join(dirMig, f), "utf8"), { input: true }); }
    requerir(psql(a, a.db, "select (to_regclass('public.solicitudes_proveedor') is not null and to_regclass('public.hostinger_estado_buzon') is not null)::text") === "true", "Migrations >= 315 did not produce the expected tables (328/330).");
    psql(a, a.db, "create or replace function auth.uid() returns uuid language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$");
    docker("network", "create", "--label", `${ETIQUETA}=1`, N.net); docker("network", "connect", N.net, a.pg, "--alias", "hj103_pg");
    docker("volume", "create", "--label", `${ETIQUETA}=1`, VOL.mail); docker("volume", "create", "--label", `${ETIQUETA}=1`, VOL.stor);
    docker("run", "-d", "--name", N.mail, "--label", `${ETIQUETA}=1`, "--network", N.net, "--memory", "64m", "-v", `${VOL.mail}:/data`, "-e", "MP_DATABASE=/data/mailpit.db", "-p", `127.0.0.1:${p.correo}:8025`, "public.ecr.aws/supabase/mailpit:v1.31.3");
    docker("run", "-d", "--name", N.auth, "--label", `${ETIQUETA}=1`, "--network", N.net, "--memory", "192m", "-p", `127.0.0.1:${p.auth}:9999`,
      "-e", "GOTRUE_API_HOST=0.0.0.0", "-e", "GOTRUE_API_PORT=9999", "-e", `API_EXTERNAL_URL=http://127.0.0.1:${p.gateway}`, "-e", "GOTRUE_DB_DRIVER=postgres", "-e", `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${cfg.rolesPassword}@hj103_pg:5432/${a.db}?search_path=auth`,
      "-e", `GOTRUE_SITE_URL=http://localhost:${p.app}`, "-e", "GOTRUE_DISABLE_SIGNUP=true", "-e", "GOTRUE_JWT_ADMIN_ROLES=service_role", "-e", "GOTRUE_JWT_AUD=authenticated", "-e", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated", "-e", "GOTRUE_JWT_EXP=3600", "-e", `GOTRUE_JWT_SECRET=${cfg.jwtSecret}`,
      "-e", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true", "-e", "GOTRUE_MAILER_AUTOCONFIRM=true", "-e", "GOTRUE_EXTERNAL_PHONE_ENABLED=false", "-e", "GOTRUE_SMTP_HOST=hj103_mail", "-e", "GOTRUE_SMTP_PORT=1025", "-e", "GOTRUE_SMTP_ADMIN_EMAIL=no-responder@local.test", "-e", "GOTRUE_PASSWORD_MIN_LENGTH=6", "-e", "GOTRUE_LOG_LEVEL=warn",
      "--label", `${ETIQUETA}=1`, "public.ecr.aws/supabase/gotrue:v2.197.0");
    docker("run", "-d", "--name", N.rest, "--label", `${ETIQUETA}=1`, "--network", N.net, "--memory", "160m", "-p", `127.0.0.1:${p.rest}:3000`, "-e", `PGRST_DB_URI=postgres://authenticator:${cfg.rolesPassword}@hj103_pg:5432/${a.db}`,
      "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", `PGRST_JWT_SECRET=${cfg.jwtSecret}`, "-e", "PGRST_DB_USE_LEGACY_GUCS=false", "-e", "PGRST_DB_MAX_ROWS=1000", "public.ecr.aws/supabase/postgrest:v16.4");
    docker("run", "-d", "--name", N.stor, "--label", `${ETIQUETA}=1`, "--network", N.net, "--memory", "256m", "-v", `${VOL.stor}:/var/lib/storage`, "-p", `127.0.0.1:${p.storage}:5000`,
      "-e", `ANON_KEY=${cfg.anonKey}`, "-e", `SERVICE_KEY=${cfg.serviceKey}`, "-e", `PGRST_JWT_SECRET=${cfg.jwtSecret}`, "-e", `AUTH_JWT_SECRET=${cfg.jwtSecret}`, "-e", "POSTGREST_URL=http://hj103_rest:3000", "-e", `DATABASE_URL=postgres://supabase_storage_admin:${cfg.rolesPassword}@hj103_pg:5432/${a.db}`,
      "-e", "FILE_SIZE_LIMIT=52428800", "-e", "STORAGE_BACKEND=file", "-e", "FILE_STORAGE_BACKEND_PATH=/var/lib/storage", "-e", "TENANT_ID=hj103", "-e", "REGION=local", "-e", "GLOBAL_S3_BUCKET=hj103", "-e", "ENABLE_IMAGE_TRANSFORMATION=false", "public.ecr.aws/supabase/storage-api:v1.84.19");
    esperarPila(cfg);
    iniciarGateway(cfg);
    log(`stack ready: gateway 127.0.0.1:${p.gateway}, mailpit 127.0.0.1:${p.correo}, database ${a.db}`);
  },

  async seed() {
    validarBdDesechable(a);                                    // BEFORE anything is written
    const cfg = cargarConfig(a), sql = sqlDesechable(a), p = cfg.puertos;
    const USUARIOS = [["sup103@walk.test", "Super Walk", "superadmin"], ["admin103@walk.test", "Admin Walk", "administracion"], ["ops103@walk.test", "Ops Walk", "operaciones"], ["venta103@walk.test", "Venta Walk", "venta"]];
    const pass = contrasenaRevision(cfg);
    for (const [email, nombre, rol] of USUARIOS) {
      const r = await fetch(`http://127.0.0.1:${p.gateway}/auth/v1/admin/users`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
      const j = await r.json(); requerir(r.ok || /already|registered/i.test(JSON.stringify(j)), `create ${email}: ${JSON.stringify(j)}`);
      const id = j.id ?? sql(`select id from auth.users where email = '${email}'`);
      sql(`insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${id}', '${email}', '${nombre}', '${rol}', true, 'mayorista') on conflict (id) do update set rol = excluded.rol, activo = true`);
    }
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, fecha_regreso, pax, estado, asesor, precio_venta) values
      ('DTM-2001', 'Cliente Walkthrough', 'mayorista', 'CARTAGENA', '2027-03-26', '2027-03-30', 3, 'pendiente', 'Admin Walk', 3000000),
      ('DTM-2002', 'Otro Cliente', 'mayorista', 'CARTAGENA', '2027-05-01', '2027-05-04', 2, 'pendiente', 'Admin Walk', 2000000) on conflict (numero_contrato) do nothing`);
    sql(`insert into public.solicitudes_proveedor (tenant, tipo, numero_contrato, contrato_uid, proveedor, destinatarios, asunto, token_respuesta, clave_envio, estado, enviada_en)
      select 'mayorista', 'solicitud', v.nc, (select contrato_uid from public.ventas where numero_contrato = v.nc), 'Hotel Prueba 103', array['hotel@proveedor.test'], 'Solicitud Walk ' || n, 'WalkTok' || lpad(n::text, 17, '0'), 'walk-clave-' || n, 'enviada', now() - interval '2 hours'
      from generate_series(1, 8) n cross join lateral (select case when n % 2 = 1 then 'DTM-2001' else 'DTM-2002' end as nc) v on conflict (clave_envio) do nothing`);
    log(`seeded: ${USUARIOS.length} users, 2 contracts, ${sql("select count(*) from public.solicitudes_proveedor")} requests`);
  },

  "sim-start"() {
    const cfg = cargarConfig(a), L = logs(); const r = iniciarPropio(a, { nombre: "sim", cmd: process.execPath, args: [path.join(AQUI, "mailapi_sim.mjs"), String(cfg.puertos.sim), BUZON, cfg.journey.apiToken, path.join(a.work, "sim-state.json")], env: process.env, puerto: cfg.puertos.sim, marcador: path.join(AQUI, "mailapi_sim.mjs"), log: L("sim.log") });
    log(`simulated Mail API on 127.0.0.1:${cfg.puertos.sim} (pid ${r.pid})`);
  },
  "sim-stop"() { log(JSON.stringify(detenerPropio(a, "sim"))); },

  async "app-start"() {
    const cfg = cargarConfig(a), puerto = puertoApp(cfg), L = logs();
    requerir(fs.existsSync(path.join(RAIZ, ".next", "BUILD_ID")), "No product build (.next/BUILD_ID). Build it first (see README: build-env).");
    const r = iniciarPropio(a, { nombre: "app", cmd: process.execPath, args: [nextBin(), "start", "-H", "127.0.0.1", "-p", String(puerto)], env: { ...entornoApp(cfg) }, puerto, marcador: nextBin(), log: L("app.log"), esperarMs: 90_000 });
    const lo = await comprobarSoloLoopback(puerto);
    if (!lo.soloLoopback) { detenerPropio(a, "app"); throw new Error(`The app is not loopback-only: listeners ${lo.direcciones.join(",")}, reachable on ${lo.externasAlcanzables.join(",") || "-"}. Stopped it.`); }
    log(`app listening ONLY on ${lo.direcciones.join(",")}:${puerto} (pid ${r.pid}); non-loopback addresses of this machine refuse connections`);
  },
  "app-stop"() { log(JSON.stringify(detenerPropio(a, "app"))); },
  async "app-restart"() { log(JSON.stringify(detenerPropio(a, "app"))); await comandos["app-start"](); },

  status() {
    const cfg = cargarConfig(a);
    for (const n of ["gateway", "sim", "app"]) log(n.padEnd(8), JSON.stringify({ ...verificarPropio(a, n), info: undefined }));
    log("containers:", docker("ps", "-a", "--filter", `label=${ETIQUETA}=1`, "--format", "{{.Names}} {{.Status}}").replace(/\n/g, "; ") || "-");
    log("ports:", JSON.stringify(Object.fromEntries(Object.entries(cfg.puertos).map(([k, v]) => [k, escuchas(v).length > 0]))));
  },

  /** NON-destructive stop: processes and containers stop; the database, volumes (captured mail, uploaded files), simulated mailbox, config and credentials are all kept. */
  stop() {
    for (const n of ["app", "sim", "gateway"]) log(n, JSON.stringify(detenerPropio(a, n)));
    for (const c of [N.stor, N.rest, N.auth, N.mail]) { if (dockerOk("inspect", "-f", `{{index .Config.Labels "${ETIQUETA}"}}`, c) === "1") { docker("stop", c); log(`stopped ${c}`); } }
    exigirContenedorPropio(a, { parado: true }); if (dockerOk("inspect", "-f", "{{.State.Running}}", PG_PROPIO) === "true") { docker("stop", PG_PROPIO); log(`stopped ${PG_PROPIO}`); }
    log("stopped; nothing was deleted (database, captured mail, uploaded files, simulated mailbox, config and credentials are kept)");
  },
  /** Resumes a stopped environment exactly where it was (no re-creation, no re-seeding). */
  resume() {
    exigirContenedorPropio(a, { parado: true });
    const cfg = cargarConfig(a), p = cfg.puertos;
    for (const [n, port] of Object.entries({ gateway: p.gateway, auth: p.auth, rest: p.rest, correo: p.correo, storage: p.storage })) { const o = escuchas(port); requerir(!o.length, `Refused: port ${port} (${n}) is in use by pid ${o[0]?.pid}; left untouched.`); }
    for (const c of [N.mail, N.auth, N.rest, N.stor]) requerir(dockerOk("inspect", "-f", `{{index .Config.Labels "${ETIQUETA}"}}`, c) === "1", `Nothing to resume: container ${c} does not exist (use review.mjs start to create the environment).`);
    docker("start", PG_PROPIO);
    let listo = false; for (let i = 0; i < 60 && !listo; i++) { try { exigirContenedorPropio(a); listo = psql(a, "postgres", "select 1") === "1"; } catch { /* starting */ } if (!listo) sleep(2000); }
    requerir(listo, "The dedicated PostgreSQL container did not become ready again.");
    validarBdDesechable(a);
    for (const c of [N.mail, N.auth, N.rest, N.stor]) docker("start", c);
    esperarPila(cfg); iniciarGateway(cfg);
    log(`resumed: gateway 127.0.0.1:${p.gateway}, mailpit 127.0.0.1:${p.correo}, database ${a.db} (no data was changed)`);
  },

  down(o = {}) {
    exigirConfirmacionDestruccion(a, "down");                   // FIRST: a refused destructive command must not have stopped anything
    for (const n of ["app", "sim", "gateway"]) { const r = detenerPropio(a, n); if (!o.silencioso) log(n, JSON.stringify(r)); }
    exigirConfirmacionDestruccion(a, "down");                   // destructive teardown: refused over seeded review progress unless explicitly confirmed
    for (const c of [N.stor, N.rest, N.auth, N.mail]) { const et = dockerOk("inspect", "-f", `{{index .Config.Labels "${ETIQUETA}"}}`, c); if (et === "1") dockerOk("rm", "-f", c); else if (et !== null && !o.silencioso) log(`container ${c} is not ours: left alone`); }
    for (const v of Object.values(VOL)) { if (dockerOk("volume", "inspect", "-f", `{{index .Labels "${ETIQUETA}"}}`, v) === "1") dockerOk("volume", "rm", "-f", v); }
    exigirContenedorPropio(a);                                  // everything below touches PostgreSQL / its network: refuse (after the process/container cleanup above) unless the container is the dedicated one
    if (dockerOk("network", "inspect", "-f", `{{index .Labels "${ETIQUETA}"}}`, N.net) === "1") { dockerOk("network", "disconnect", N.net, a.pg); dockerOk("network", "rm", N.net); }
    if (validarBdDesechable(a, { puedeNoExistir: true })) { psql(a, "postgres", `drop database ${a.db} with (force)`); if (!o.silencioso) log(`dropped ${a.db}`); }
    if (!o.silencioso) log("teardown done (the work folder with generated config is kept; delete it by hand if you want)");
  },
};

if (path.basename(process.argv[1] ?? "") === "harness.mjs") {
  const f = comandos[orden]; if (!f) { console.error("Usage: node harness.mjs init|build-env|pg-create|pg-destroy|up|stop|resume|seed|sim-start|app-start|app-restart|app-stop|sim-stop|status|down"); process.exit(2); }
  try { await f.call(comandos); } catch (e) { console.error("harness:", e instanceof Error ? e.message : e); process.exit(1); }
}
