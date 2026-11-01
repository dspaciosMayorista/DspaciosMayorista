// INTEGRACIÓN de la ruta /api/cron/publicacion-tarifario (la continuación sin navegador cuando pg_cron no está habilitado): el GET REAL del código de producción, con el cliente de
// servicio apuntando a PostgREST + Postgres reales. Deja una publicación encolada (lotes ya en la base, como la deja la acción) y comprueba que la ruta, SIN ninguna sesión de usuario,
// la termina; que rechaza sin secreto o con otro; y que una cola vacía no hace nada. La decisión de encadenar otra invocación se prueba en pruebas/continuacionPublicacion.test.ts.
// Lo lanza test_259_publicador_limite.sh con RUTA=1. Sin SQL remoto.
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mock } from "node:test";
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { CT, DB, URL, SECRET, MIGRACION, PROTOTIPO, APP } = process.env;
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co"; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const firmar = (claims) => { const h = b64({ alg: "HS256", typ: "JWT" }); const p = b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 14400 }); return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const cabUsuario = { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${firmar({ sub: "00000000-0000-0000-0000-0000000000a1", role: "authenticated" })}` };
const cabServicio = { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${firmar({ role: "service_role" })}` };
const base = ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-X", "-q", "-d", DB, "-t", "-A"];
const sql = (q) => execFileSync("docker", [...base, "-v", "ON_ERROR_STOP=1", "-c", q], { maxBuffer: 1 << 29 }).toString().trim();
const sqlArchivo = (ruta) => execFileSync("docker", [...base, "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync(ruta), maxBuffer: 1 << 29 }).toString();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const fallos = [];
const comprobar = (ok, texto) => { console.log(`${ok ? "  OK " : "  FALLA"} ${texto}`); if (!ok) fallos.push(texto); };
const rpc = async (cab, fn, cuerpo) => { const r = await fetch(URL + fn, { method: "POST", headers: cab, body: JSON.stringify(cuerpo) }); const t = await r.text(); let j = t; try { j = JSON.parse(t); } catch { /* texto */ } return { http: r.status, j }; };
const huella = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

execFileSync("docker", ["update", "--cpus", "16", CT]);
sqlArchivo(MIGRACION); await dormir(1500); sqlArchivo(PROTOTIPO); await dormir(2500);
sql("truncate public.tarifario_resultado cascade; delete from public.tarifario_publicacion_cola; update public.armado_paquetes set tarifario_por_generacion = false, tarifario_generacion_publicada = null where id = 73");

// Deja una publicación de 3.000 filas ENCOLADA, como la deja la acción (usuario interno): manifiesto + lotes en espera + encolar. Nadie llama a avanzar.
const filas = JSON.parse(sql("select jsonb_agg(jsonb_strip_nulls(e))::text from jsonb_array_elements(public.bench_filas(3000, 73)) e")).map((f) => ({ ...f, paquete_nombre: "ruta" }));
const lotes = [0, 1, 2].map((i) => JSON.stringify(filas.slice(i * 1000, (i + 1) * 1000)));
const tok = (await rpc(cabUsuario, "iniciar_generacion_tarifario", { p_paquete_id: 73 })).j[0];
const man = await rpc(cabUsuario, "tarifario_manifiesto_crear", { p_paquete_id: 73, p_generacion: tok.generacion, p_revision_capturada: tok.revision_capturada, p_moneda: "COP", p_lotes: lotes.map((t, i) => ({ lote: i + 1, filas: 1000, huella: huella(t) })) });
for (let i = 0; i < 3; i++) await rpc(cabUsuario, "tarifario_lote_espera_guardar", { p_paquete_id: 73, p_generacion: tok.generacion, p_lote: i + 1, p_filas_txt: lotes[i] });
const enc = await rpc(cabUsuario, "tarifario_publicacion_encolar", { p_paquete_id: 73, p_generacion: tok.generacion });
comprobar(man.j === "ok" && enc.j === "ok" && sql("select count(*) from public.tarifario_publicacion_cola") === "1", "publicación de 3.000 filas ENCOLADA (3 lotes en espera); nadie llama a avanzar");
comprobar(sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 73") === "0", "todavía no es visible");

// La ruta REAL, con el cliente de servicio apuntando a la base local.
// `next/server` no se resuelve fuera de Next (ESM); se sustituye por un módulo mínimo con la misma forma (NextResponse.json y after).
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { if (s === "next/server") return { url: "data:text/javascript,export const NextResponse={json:(b,i)=>new Response(JSON.stringify(b),{status:(i&&i.status)||200,headers:{'content-type':'application/json'}})};export const after=()=>{throw new Error('fuera de una peticion')};", shortCircuit: true }; return n(s, c); }`));
mock.module("@/lib/supabase/admin", { exports: { createAdminClient: () => ({ rpc: async (fn, args) => { const r = await rpc(cabServicio, fn, args); return r.http === 200 ? { data: r.j, error: null } : { data: null, error: { message: String(r.j?.message ?? JSON.stringify(r.j)) } }; } }) } });
const ruta = await import(pathToFileURL(join(APP, "app/api/cron/publicacion-tarifario/route.ts")).href);
const llamar = (auth) => ruta.GET(new Request("http://localhost/api/cron/publicacion-tarifario", { headers: auth ? { authorization: auth } : {} }));

delete process.env.CRON_SECRET;
let r = await llamar("Bearer x");
comprobar(r.status === 503, `sin CRON_SECRET configurada la ruta falla CERRADO (${r.status})`);
process.env.CRON_SECRET = "secreto-de-prueba";
r = await llamar(null);
comprobar(r.status === 401, `sin Authorization: ${r.status}`);
r = await llamar("Bearer otro");
comprobar(r.status === 401, `con otro secreto: ${r.status}`);
comprobar(sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 73") === "0" && sql("select count(*) from public.tarifario_publicacion_cola") === "1", "los rechazos no tocaron la cola");

r = await llamar("Bearer secreto-de-prueba");
const j = await r.json();
console.log(`  respuesta: ${JSON.stringify(j)}`);
comprobar(r.status === 200 && j.enCola === 0 && j.pasos >= 5 && j.encadenada === false, `con el secreto correcto la ruta corrió el trabajador (${j.pasos} pasos), vació la cola y NO encadena otra invocación`);
comprobar(sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 73") === "3000" && sql("select count(*) from public.tarifario_publicacion_cola") === "0" && sql("select count(*) from public.tarifario_lote_espera") === "0",
          "la publicación quedó VISIBLE (3.000 filas), sin ninguna sesión de usuario, con la cola y la espera vacías");
r = await llamar("Bearer secreto-de-prueba");
const j2 = await r.json();
comprobar(r.status === 200 && j2.pasos === 0 && j2.enCola === 0 && j2.encadenada === false, `con la cola vacía no hace nada y no encadena (${JSON.stringify(j2)})`);

console.log(fallos.length ? `\nRUTA 260: ${fallos.length} FALLA(S)\n - ${fallos.join("\n - ")}` : "\nRUTA 260: todas las comprobaciones pasaron.");
process.exit(fallos.length ? 1 : 0);
