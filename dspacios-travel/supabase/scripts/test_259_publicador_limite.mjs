// Escenarios de la prueba de la 259 contra PostgreSQL + PostgREST REALES (ruta de la app). Lo lanza test_259_publicador_limite.sh; no se corre suelto.
// Env: CT (contenedor pg), DB, URL (PostgREST, termina en /rpc/), SECRET (JWT), MIGRACION (ruta del .sql de la 259), CPUS_PREVIA (NanoCpus a restaurar, lo hace el .sh).
// Imprime una tabla ANTES/DESPUÉS y termina con código ≠ 0 si alguna comprobación falla.
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";

const { CT, DB, URL, SECRET, MIGRACION } = process.env;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const h = b64({ alg: "HS256", typ: "JWT" });
const p = b64({ sub: "00000000-0000-0000-0000-0000000000a1", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 7200 });
const cab = { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}` };
const base = ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-X", "-q", "-d", DB, "-t", "-A"];
const sql = (q) => execFileSync("docker", [...base, "-v", "ON_ERROR_STOP=1", "-c", q], { maxBuffer: 1 << 29 }).toString().trim();
const sqlArchivo = (ruta) => execFileSync("docker", [...base, "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync(ruta), maxBuffer: 1 << 29 }).toString();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const fallos = [];
const comprobar = (ok, texto) => { console.log(`${ok ? "  OK " : "  FALLA"} ${texto}`); if (!ok) fallos.push(texto); };
const FN = "public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)";
const estado = () => sql("select tarifario_generacion || '|' || coalesce(tarifario_generacion_publicada::text, 'NUNCA') || '|' || (select count(*) from tarifario_resultado where paquete_id = 73) from armado_paquetes where id = 73").split("|");

async function iniciar() {
  const r = await fetch(URL + "iniciar_generacion_tarifario", { method: "POST", headers: cab, body: JSON.stringify({ p_paquete_id: 73 }) });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error("iniciar_generacion_tarifario: " + JSON.stringify(j));
  return { generacion: j[0].generacion, revision: j[0].revision_capturada };
}
async function publicar(n, tok, { texto } = {}) {
  const filas = texto ?? sql(`select texto from public.bench_payload where n = ${n}`);
  const cuerpo = `{"p_paquete_id":73,"p_generacion":${tok.generacion},"p_revision_capturada":${tok.revision},"p_moneda":"COP","p_filas":${filas}}`;
  const t0 = performance.now();
  const r = await fetch(URL + "publicar_tarifario_resultado", { method: "POST", headers: cab, body: cuerpo });
  const t = await r.text();
  let codigo = null; try { codigo = JSON.parse(t).code ?? null; } catch { /* true/false */ }
  return { n, gen: tok.generacion, http: r.status, ms: Math.round(performance.now() - t0), ok: t === "true", stale: t === "false", codigo };
}
const cpus = (c) => execFileSync("docker", ["update", "--cpus", String(c), CT]);
function retener(seg) {
  const proc = spawn("docker", [...base, "-c", `begin; select id from public.armado_paquetes where id = 73 for update; select pg_sleep(${seg}); commit;`], { stdio: "ignore" });
  return { fin: new Promise((res) => proc.on("exit", () => res(performance.now()))) };
}
async function retenidoYa() { for (let i = 0; i < 200; i++) { if (sql("select count(*) from pg_stat_activity where state = 'active' and query like '%pg_sleep(%' and query not like '%pg_stat_activity%'") !== "0") return; await dormir(50); } }
const tabla = (titulo, filas) => { console.log(`\n${titulo}`); for (const f of filas) console.log(`  ${String(f.n).padStart(6)} filas · ${String(f.ms).padStart(6)} ms · http ${f.http}${f.codigo ? " · " + f.codigo : ""}${f.ok ? " · publicó" : ""}`); };

// ── 1. Calibración: CPU del contenedor Postgres tal que el 33 (3.187) publique y el 73 (12.669) se cancele con 57014, como en Preview ─────────────────
let antes = null;
for (const c of [0.12, 0.09, 0.07, 0.2, 0.3, 0.05]) {
  cpus(c); await dormir(500);
  const a = await publicar(3187, await iniciar());
  const b = await publicar(12669, await iniciar());
  if (a.ok && b.codigo === "57014") { antes = { cpus: c, r: [a, b] }; break; }
}
if (!antes) { console.log("No se pudo reproducir el síntoma (33 publica y 73 se cancela) con ninguna limitación de CPU; esta máquina no sirve para la prueba."); process.exit(3); }
console.log(`Calibración: CPU del contenedor = ${antes.cpus} núcleo(s).`);
const antes7 = await publicar(7413, await iniciar());
tabla("ANTES de la 259 (límite del rol: 8 s)", [antes.r[0], antes7, antes.r[1]]);
comprobar(antes.r[1].codigo === "57014", "ANTES: el 73 (12.669 filas) se cancela con 57014 statement timeout (síntoma reproducido)");

// ── 2. Aplicar la 259 y esperar la recarga de PostgREST ─────────────────────────────────────────────────────────────────────────────────────────────
sqlArchivo(MIGRACION); await dormir(3000);
comprobar(sql(`select proconfig::text from pg_proc where oid = to_regprocedure('${FN}')`).includes("statement_timeout=30s"), "la 259 dejó statement_timeout=30s en la entrada base");

// ── 3. DESPUÉS: 3.187, 7.413 y 12.669 filas — todas publican, todas las filas, generación publicada = la pedida ─────────────────────────────────────
const despues = [];
for (const n of [3187, 7413, 12669]) {
  const tok = await iniciar(); const r = await publicar(n, tok); despues.push(r);
  const [gen, pub, filas] = estado();
  comprobar(r.ok && Number(filas) === n && pub === String(tok.generacion) && gen === String(tok.generacion), `DESPUÉS ${n} filas: publicó ${r.ms} ms, quedaron ${filas} filas y generación publicada = ${pub}`);
}
tabla("DESPUÉS de la 259 (límite de la función: 30 s)", despues);

// ── 3b. DESPUÉS + payload compacto (sin claves null, como lo envía la app): misma publicación, menos bytes ──────────────────────────────────────────────
const compacto = [];
for (const n of [3187, 7413, 12669]) {
  const tok = await iniciar(); const r = await publicar(n, tok, { texto: sql(`select texto_c from public.bench_payload where n = ${n}`) }); compacto.push(r);
  const [, pub, filas] = estado();
  comprobar(r.ok && Number(filas) === n && pub === String(tok.generacion), `payload compacto ${n} filas: publicó ${r.ms} ms con las ${filas} filas`);
}
tabla("DESPUÉS + payload compacto (−22 % de bytes)", compacto);

// ── 3c. Llamadas POSTERIORES a la publicación de las migraciones 256/258 (si están en la base): no están dentro del publicador, se miden aparte ──────────
if (sql("select to_regprocedure('public.registrar_composicion_publicada(bigint,bigint,smallint,jsonb)') is not null")  === "t") {
  const gen = estado()[1];
  const filas = Array.from({ length: 19 }, (_, i) => ({ fecha_ida: `2026-12-${String(1 + i).padStart(2, "0")}`, servicios_incluidos: i < 3 ? [112] : [] }));
  const llamar = async (fn, cuerpo) => { const t0 = performance.now(); const r = await fetch(URL + fn, { method: "POST", headers: cab, body: JSON.stringify(cuerpo) }); await r.text(); return { fn, http: r.status, ms: Math.round(performance.now() - t0) }; };
  const a = await llamar("registrar_composicion_publicada", { p_paquete_id: 73, p_generacion: Number(gen), p_regla: 1, p_filas: filas });
  const b = await llamar("registrar_diagnostico_tarifario", { p_paquete_id: 73, p_generacion: Number(gen), p_diagnostico: "Servicios incluidos omitidos por falta de tarifa vigente: 16 de 19 salidas." });
  console.log(`  INFO  tras publicar (256/258): ${a.fn} ${a.ms} ms (http ${a.http}) · ${b.fn} ${b.ms} ms (http ${b.http})`);
}

// ── 3d. COTA: el máximo teórico de la configuración del 73 (32 vuelos × 100 combinaciones × 7 acomodaciones = 22.400 + 1 servicio) ────────────────────
if (process.env.COTA === "1") {
  const tok = await iniciar();
  const r = await publicar(22401, tok, { texto: sql("select texto_c from public.bench_payload where n = 22401") });
  const [, pub, filas] = estado();
  comprobar(r.ok && Number(filas) === 22401 && pub === String(tok.generacion), `COTA SINTÉTICA 22.401 filas (no es una generación real bajo la 256; payload compacto): publicó en ${r.ms} ms con las ${filas} filas — margen frente a 30 s: ${(30000 / r.ms).toFixed(2)}×`);
}

// ── 4. El límite vale por PostgREST, NO por SQL directo (queda como defensa: quien llame por SQL conserva los 8 s del rol) ───────────────────────────
{
  const tok = await iniciar();
  const filas = sql("select texto from public.bench_payload where n = 12669").replace(/'/g, "''");
  const t0 = performance.now();
  let error = "";
  try {
    // El cuerpo (12 MB) va por stdin: un argumento de línea de comandos no admite ese tamaño.
    execFileSync("docker", [...base, "-v", "ON_ERROR_STOP=1"], {
      input: `begin; set local role authenticated; set local statement_timeout = '8s'; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true) \\g /dev/null\n` +
        `select ${FN.replace("(bigint,bigint,bigint,text,jsonb)", "")}(73, ${tok.generacion}, ${tok.revision}, 'COP', '${filas}'::jsonb);\ncommit;\n`,
      maxBuffer: 1 << 29, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) { error = String(e.stderr ?? e.message); }
  comprobar(/statement timeout/.test(error), `por SQL directo (sin PostgREST) rige el límite del rol: cancelado a ${Math.round(performance.now() - t0)} ms`);
}

// ── 5. Espera por candado acotada aunque el límite de ejecución sea 30 s ────────────────────────────────────────────────────────────────────────────
{
  const tok = await iniciar(); const t0 = performance.now();
  const ret = retener(16); await retenidoYa();
  const r = await publicar(3187, tok);
  comprobar(r.codigo === "55P03" && r.ms < 12000, `paquete retenido 16 s: la publicación NO espera 30 s, falla con 55P03 lock timeout a los ${r.ms} ms`);
  await ret.fin; void t0;
  // El límite de espera es el de LA FUNCIÓN (no solo el del rol): con 3 s en la función, falla a ~3 s aunque el rol diga 8 s.
  sql(`alter function ${FN} set lock_timeout = '3s'`); await dormir(2500);
  const tok2 = await iniciar(); const ret2 = retener(12); await retenidoYa();
  const r2 = await publicar(3187, tok2);
  comprobar(r2.codigo === "55P03" && r2.ms < 6500, `lock_timeout de la función = 3 s: falla con 55P03 a los ${r2.ms} ms (la función manda sobre el rol)`);
  await ret2.fin;
  sql(`alter function ${FN} set lock_timeout = '8s'`); await dormir(2500);
}

// ── 6. Rollback al superar el límite (se baja a 3 s SOLO en la prueba): filas anteriores y generación publicada intactas ──────────────────────────────
{
  const previo = estado();
  sql(`alter function ${FN} set statement_timeout = '3s'`); await dormir(2500);
  const tok = await iniciar(); const r = await publicar(12669, tok);
  const [, pubDespues, filasDespues] = estado();
  comprobar(r.codigo === "57014", `límite de la función superado (${r.ms} ms): 57014`);
  comprobar(filasDespues === previo[2] && pubDespues === previo[1], `ROLLBACK: filas anteriores (${previo[2]}) y generación publicada (${previo[1]}) intactas tras el timeout`);
  sql(`alter function ${FN} set statement_timeout = '30s'`); await dormir(2500);
}

// ── 7. Rollback ante ERROR de datos (llave foránea inexistente): nada cambia ─────────────────────────────────────────────────────────────────────────
{
  const previo = estado();
  const malo = sql("select replace(texto, '\"bloqueo_id\": 3000', '\"bloqueo_id\": 99999999') from public.bench_payload where n = 3187");
  const tok = await iniciar(); const r = await publicar(3187, tok, { texto: malo });
  const [, pubDespues, filasDespues] = estado();
  comprobar(r.http >= 400 && !r.ok, `payload inválido rechazado (http ${r.http}${r.codigo ? ", " + r.codigo : ""})`);
  comprobar(filasDespues === previo[2] && pubDespues === previo[1], "ROLLBACK ante error: filas anteriores y generación publicada intactas");
}

// ── 8. Concurrencia sobre el MISMO paquete: gana la generación más nueva; la otra no deja filas ni estado obsoleto ───────────────────────────────────
{
  const a = await iniciar(); await dormir(150); const b = await iniciar();
  const [ra, rb] = await Promise.all([publicar(12669, a), publicar(7413, b)]);
  const [gen, pub, filas] = estado();
  comprobar(ra.stale && rb.ok, `A (gen ${a.generacion}, 12.669) descartada por obsoleta; B (gen ${b.generacion}, 7.413) publicó`);
  comprobar(pub === String(b.generacion) && gen === String(b.generacion) && Number(filas) === 7413, `estado final: generación publicada = ${pub} (la más nueva), ${filas} filas (las de B)`);
}

// ── 9. Efecto colateral medido (informativo): otro escritor de la fila del paquete mientras corre una publicación larga ────────────────────────────────
{
  const tok = await iniciar(); const larga = publicar(12669, tok);
  await dormir(Math.round(antes.r[1].ms * 0.5));
  const t0 = performance.now(); let msg = "ok";
  try { await iniciar(); } catch (e) { msg = String(e.message).slice(0, 60); }
  console.log(`  INFO  otro «Generar» durante una publicación larga esperó ${Math.round(performance.now() - t0)} ms (${msg}); lock_timeout 8 s lo acota`);
  await larga;
}

console.log(fallos.length ? `\nFALLARON ${fallos.length} comprobaciones:\n - ${fallos.join("\n - ")}` : "\nTODAS LAS COMPROBACIONES PASARON");
process.exit(fallos.length ? 1 : 0);
