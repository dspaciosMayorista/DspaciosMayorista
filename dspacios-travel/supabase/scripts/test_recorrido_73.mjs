// RECORRIDO COMPLETO del paquete 73 (tipo bloqueo, 32 vuelos, 100 combinaciones hotel×categoría×régimen, 7 acomodaciones = 22.400 filas + 1 de servicio opcional, y el servicio 112 INCLUIDO)
// con el generador REAL (`generarTarifario`, la Server Action de producción) contra Postgres + PostgREST reales y la migración 260 (cola, trabajador, composición 258).
//
// ESTE script se lanza en DOS modos:
//   · árbol propio (sin hotfix): comprueba el flujo por lotes con el generador de esta rama.
//   · árbol COMBINADO (hotfix de traslados 255/256/258 + esta rama; ver docs/tecnico/publicador-tarifario-lotes.md, «Entorno combinado»): además prueba las reglas REALES de la 256/258 —el servicio
//     112 incluido, cuando NO tiene tarifa vigente en la fecha de una salida, se OMITE del precio y de la composición— en una misma publicación con fechas CON y SIN tarifa.
//     Se detecta por la presencia de lib/reservar/composicionPublicada.ts en el árbol.
// Las FUENTES (vuelos, hoteles, tarifas, servicios) las sirve un cliente en memoria (como pruebas/salidaVinculada63Generar.test.ts); TODO lo que es RPC va a la base real.
// Lo lanza test_259_publicador_limite.sh con RECORRIDO=1. Límites que NO se tocan: statement_timeout=30s, lock_timeout=8s. Sin SQL remoto.
import crypto from "node:crypto";
import fs from "node:fs";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mock } from "node:test";
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { CT, DB, URL, SECRET, MIGRACION, PROTOTIPO, APP } = process.env;
process.env.TARIFARIO_PUBLICACION_POR_LOTES = "1";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co"; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy";
delete process.env.CRON_SECRET;   // sin secreto no hay «empujón» HTTP: aquí el trabajador lo corre la propia prueba (como pg_cron, sin sesión)
const CPU = Number(process.env.CPU_73 ?? 0.049);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const firmar = (claims) => { const h = b64({ alg: "HS256", typ: "JWT" }); const p = b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 14400 }); return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const cab = { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${firmar({ sub: "00000000-0000-0000-0000-0000000000a1", role: "authenticated" })}` };
const cabAnon = { accept: "application/json", authorization: `Bearer ${firmar({ role: "anon" })}` };
const base = ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-X", "-q", "-d", DB, "-t", "-A"];
const sql = (q) => execFileSync("docker", [...base, "-v", "ON_ERROR_STOP=1", "-c", q], { maxBuffer: 1 << 29 }).toString().trim();
const sqlArchivo = (ruta) => execFileSync("docker", [...base, "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync(ruta), maxBuffer: 1 << 29 }).toString();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const cpus = (c) => execFileSync("docker", ["update", "--cpus", String(c), CT]);
const fallos = [];
const comprobar = (ok, texto) => { console.log(`${ok ? "  OK " : "  FALLA"} ${texto}`); if (!ok) fallos.push(texto); };

const rpcReal = async (fn, cuerpo) => {
  for (let intento = 0; ; intento++) {
    try {
      const r = await fetch(URL + fn, { method: "POST", headers: cab, body: JSON.stringify(cuerpo) });
      const t = await r.text(); let j = t; try { j = JSON.parse(t); } catch { /* texto */ }
      if (r.ok) return { data: j, error: null };
      return { data: null, error: { message: j?.message ?? String(t), code: j?.code } };
    } catch (e) {
      if (intento >= 3 || !/UND_ERR_SOCKET|ECONNRESET|other side closed/.test(String(e?.cause?.code ?? e?.cause ?? e))) throw e;
      await dormir(200);
    }
  }
};
const getAnon = async (ruta) => { const r = await fetch(URL.replace(/rpc\/$/, "") + ruta, { headers: cabAnon }); return { http: r.status, j: await r.json().catch(() => null) }; };

// ── Mundo: fuentes en memoria con la FORMA del 73 ────────────────────────────────────────────────────────────────────────────
const N_VUELOS = 32, N_HOTELES = 25, CATS = ["Categoria A", "Categoria B"], REGS = ["PC", "PAM"], CORTE = 16;   // las primeras 16 salidas tienen tarifa del 112 en el caso «parcial»
const dia = (k) => new Date(Date.UTC(2026, 11, 1 + 7 * k)).toISOString().slice(0, 10);
const dia3 = (k) => new Date(Date.UTC(2026, 11, 4 + 7 * k)).toISOString().slice(0, 10);
const mundo = { factorTarifa: 1, incluido112: true, vigencia112: "total" /* total | parcial | ninguna */ };
function vigencias112() {
  const v = (id, ini, fin) => ({ id, servicio_id: 112, nombre: "Vigencia traslados", fecha_inicio: ini, fecha_fin: fin, compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 60000, precio_infante: null, recargo_individual: null, servicio_suplementos_franja: [] });
  if (mundo.vigencia112 === "total") return [v(9001, "2026-01-01", "2027-12-31")];
  if (mundo.vigencia112 === "parcial") return [v(9001, dia(0), dia3(CORTE - 1))];   // cubre las estadías de las salidas 0..15; las demás quedan SIN tarifa
  return [];
}
function tablas() {
  const f = mundo.factorTarifa;
  const bloqueos = Array.from({ length: N_VUELOS }, (_, k) => ({ id: 3000 + k, record: `REC${k}`, ruta: "BOG - CTG - BOG", fecha_ida: dia(k), fecha_regreso: dia3(k), tarifa_para_empaquetar: 500000, fee_infante: 50000, moneda: "COP", destino_id: 1 }));
  const hoteles = Array.from({ length: N_HOTELES }, (_, g) => ({ id: 2000 + g, nombre: `Hotel ${g}`, moneda: "COP", modelo_tarifario: "persona", adults_only: false }));
  const tarifas = [];
  for (const ht of hoteles) for (const c of CATS) for (const r of REGS) {
    const b = 100000 + (ht.id % 7) * 5000 + (c === "Categoria B" ? 30000 : 0) + (r === "PAM" ? 20000 : 0);
    tarifas.push({ hotel_id: ht.id, tipo_habitacion: c, alimentacion: r, temporada: "Base", neto_sencilla: Math.round(b * 1.6 * f), neto_doble: Math.round(b * f), neto_triple: Math.round(b * 0.9 * f), neto_multiple: Math.round(b * 0.85 * f), neto_nino: Math.round(b * 0.6 * f), neto_nino2: Math.round(b * 0.5 * f), neto_infante: 0, precio_final_autoritativo: false });
  }
  const sv = (id, nombre, incluido, precio) => ({ paquete_id: 73, servicio_id: id, modo: "persona", incluido, servicios_adicionales: { nombre, categoria: null, precio_persona: precio, precio_infante: null, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: "COP" } });
  const servicios = [sv(1, "Asistencia médica", false, 40000)];
  if (mundo.incluido112) servicios.push(sv(112, "Traslados in/out (incluido)", true, 60000));
  const temporadasServicio = [{ id: 9000, servicio_id: 1, nombre: "Vigencia asistencia", fecha_inicio: "2026-01-01", fecha_fin: "2027-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 40000, precio_infante: null, recargo_individual: null, servicio_suplementos_franja: [] }];
  if (mundo.incluido112) temporadasServicio.push(...vigencias112());
  return {
    armado_paquetes: [{ id: 73, nombre: "Paquete 73", activo: true, destino_id: 1, pct_mk: 0.2, tipo: "bloqueo", impuesto_tipo: "tiquete", impuesto_fijo: 0, noches: 3, destinos: { nombre: "CARTAGENA" }, destinos_aereos_alternativos: false, modo_oferta: null, trm_oferta: null, pvp_infante_fijo: null, moneda_publicacion: "COP", programa_incluye: null }],
    armado_vuelos: bloqueos.map((b) => ({ paquete_id: 73, bloqueo_id: b.id, aplica_mk: true, ta: 0, bloqueos_vuelo: b })),
    armado_empaquetados: [],
    armado_hoteles: hoteles.map((ht) => ({ paquete_id: 73, hotel_id: ht.id, categorias: CATS, regimenes: REGS, hoteles: ht })),
    armado_servicios: servicios,
    hoteles, bloqueos_vuelo: bloqueos, empaquetados: [], salidas_dinamicas: [],
    servicios_adicionales: servicios.map((s) => ({ id: s.servicio_id, nombre: s.servicios_adicionales.nombre, categoria: null, moneda: "COP", precio_persona: s.servicios_adicionales.precio_persona, precio_infante: null, recargo_individual: null })),
    servicio_temporadas: temporadasServicio,
    hotel_temporadas: hoteles.map((ht) => ({ hotel_id: ht.id, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null, orden: 0, id: ht.id })),
    tarifa_hotel: tarifas,
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [], servicio_tarifa_pax: [], hotel_tarifas_unidad: [],
  };
}
function clienteGenerar() {
  const t = tablas();
  function from(tabla) {
    const filtros = []; let uno = false; const b = {};
    b.select = () => b; b.order = () => b; b.range = () => b; b.not = () => b; b.limit = () => b;
    b.eq = (c, v) => { filtros.push((r) => r[c] === v); return b; };
    b.in = (c, v) => { filtros.push((r) => v.includes(r[c])); return b; };
    b.single = () => { uno = true; return b; }; b.maybeSingle = () => { uno = true; return b; };
    b.then = (res, rej) => {
      if (t[tabla] === undefined) throw new Error(`fixture sin la tabla "${tabla}"`);
      const filas = t[tabla].filter((r) => filtros.every((fl) => fl(r)));
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  return { from, rpc: async (fn, args) => { const t0 = performance.now(); try { return await rpcReal(fn, args); } finally { (perfRpc[fn] ??= []).push(Math.round(performance.now() - t0)); } }, auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-0000-0000-0000000000a1" } } }) } };
}
let sbActual = null;
let perfRpc = {};
const resumenRpc = () => Object.entries(perfRpc).filter(([k]) => /lote|avanzar|encolar|manifiesto|estado|iniciar|espera|composicion|diagnostico/.test(k)).map(([k, v]) => `${k.replace("tarifario_", "")}×${v.length} máx ${Math.max(...v)} Σ ${v.reduce((a, b) => a + b, 0)} ms`).join(" · ");
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { throw new Error("generarTarifario no debe usar service-role"); } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { if (!sbActual) throw new Error("createClient() sin cliente"); return sbActual; } } });
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true }; if (s === "next/server") return { url: "data:text/javascript,export const after=()=>{throw new Error('fuera de una peticion')};", shortCircuit: true }; return n(s, c); }`));
const acciones = await import(pathToFileURL(join(APP, "app/(dashboard)/dashboard/paquetes/actions.ts")).href);
const { leerPublicacionPendiente } = await import(pathToFileURL(join(APP, "lib/tarifario/puertoSupabase.ts")).href);
const rutaVerificador = join(APP, "lib", "reservar", "composicionPublicada.ts");
const COMBINADO = existsSync(rutaVerificador);
const verificador = COMBINADO ? await import(pathToFileURL(rutaVerificador).href) : null;
console.log(COMBINADO ? "Entorno COMBINADO: reglas reales de la 256/258 (omisión del incluido sin tarifa por fecha)." : "Árbol propio (sin hotfix): se omiten las comprobaciones de las reglas 256/258.");

async function peticion(fn, ...args) {
  perfRpc = {}; sbActual = clienteGenerar(); const t0 = performance.now();
  const silencio = console.info; const err = console.error; const adv = console.warn; const lineas = []; console.info = (l) => lineas.push(String(l)); console.error = (l) => lineas.push(String(l)); console.warn = (l) => lineas.push(String(l));
  try {
    const r = await fn(...args);
    if (r && r.ok === false) setTimeout(() => {}, 0), process.stdout.write(`    (detalle del fallo en los registros del servidor) ${lineas.join(" || ").slice(0, 700)}\n`);
    return { r, ms: Math.round(performance.now() - t0), medicion: resumenRpc(), lineas };
  }
  finally { console.info = silencio; console.error = err; console.warn = adv; sbActual = null; }
}
// filas visibles por la vista | 1 si TODAS son de la generación publicada (la vista no expone `generacion`; se compara contra la tabla) | generación publicada. Barata: sin subconsulta por fila.
const visibles = () => sql("select v.n || '|' || case when v.n = t.n then 1 else 0 end || '|' || coalesce(ap.tarifario_generacion_publicada, 0) from (select count(*) as n from public.tarifario_resultado_publicable where paquete_id = 73) v, (select count(*) as n from public.tarifario_resultado r join public.armado_paquetes a on a.id = r.paquete_id and r.generacion = a.tarifario_generacion_publicada where r.paquete_id = 73) t, public.armado_paquetes ap where ap.id = 73");
const huellaFilas = (extra = "true") => sql(`select md5(string_agg(concat_ws('~', modulo, bloqueo_id, hotel_id, categoria, regimen, acomodacion, fecha_ida, noches, base_comisionable, impuesto, precio_pvp, precio_pvp_menor2, servicio_id, moneda), '|' order by modulo, bloqueo_id, hotel_id, categoria, regimen, acomodacion, servicio_id)) from public.tarifario_resultado_publicable where paquete_id = 73 and ${extra}`);
const punteros = () => sql("select tarifario_generacion || '|' || coalesce(tarifario_generacion_publicada::text, '') || '|' || tarifario_estado from public.armado_paquetes where id = 73");
const composicion = () => JSON.parse(sql("select coalesce(jsonb_agg(jsonb_build_object('f', fecha_ida, 'g', generacion, 'r', regla, 's', servicios_incluidos) order by fecha_ida), '[]') from public.tarifario_composicion_publicada where paquete_id = 73"));
const trabajador = (max = 60) => { for (let n = 0; n < max; n++) { const j = JSON.parse(sql("select public.tarifario_cola_correr(40000)::text")); if (j.en_cola === 0) return n + 1; } return max; };
const sincronizarDb112 = () => sql(mundo.incluido112
  ? "insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (73, 112, 'persona', true), (73, 1, 'persona', false) on conflict (paquete_id, servicio_id) do update set incluido = excluded.incluido"
  : "delete from public.armado_servicios where paquete_id = 73 and servicio_id = 112");
const publicarMono = async () => { const m = await peticion(acciones.generarTarifario, 73); return m; };
const publicarLotes = async (op = {}) => peticion(acciones.generarTarifario, 73, { porLotes: true, ...op });
const verifica = (c, vivos) => verificador.verificarComposicionPublicada({ generacionPublicada: Number(punteros().split("|")[1]), evidencia: { generacion: c.g, regla: c.r, servicios: c.s }, idsVivos: vivos });

// ── 0. Base: 259 + migración 260 + mundo (servicios en la base, que es lo que lee la activación) ────────────────────────────────
cpus(16); sqlArchivo(MIGRACION); await dormir(1500); sqlArchivo(PROTOTIPO); await dormir(2500);
sql("insert into public.servicios_adicionales (id, nombre) overriding system value values (112, 'Traslados in/out (incluido)') on conflict do nothing");
sincronizarDb112();
sql("truncate public.tarifario_resultado cascade; delete from public.tarifario_publicacion_cola; update public.armado_paquetes set tarifario_por_generacion = false, tarifario_generacion_publicada = null, tipo = 'bloqueo' where id = 73");

// ── 1. Equivalencia: lotes vs publicador monolítico (112 con tarifa en TODAS las fechas; sin estrangular: aquí importa el CONTENIDO) ──
console.log("\n== 1. Equivalencia fila a fila: publicación por lotes vs publicador monolítico (misma fuente, sin estrangular) ==");
const a = await publicarLotes();
console.log(`  lotes: ${JSON.stringify({ ok: a.r.ok, id: a.r.id, pendiente: a.r.pendiente, error: a.r.error })} · ${a.ms} ms · ${a.medicion}`);
comprobar(a.r.ok === true && !a.r.pendiente, "sin estrangular, la publicación por lotes termina en UNA petición (publicada)");
const vA = visibles(); const hA = huellaFilas();
comprobar(vA.startsWith("22401|1|"), `quedan visibles 22.401 filas de una sola generación (${vA})`);
const m = await publicarMono();
console.log(`  monolítico: ${JSON.stringify({ ok: m.r.ok, id: m.r.id, error: m.r.error })} · ${m.ms} ms`);
comprobar(m.r.ok === true && hA === huellaFilas() && hA.length > 10, "el contenido publicado por lotes y por el publicador monolítico es IDÉNTICO (huella md5 de 22.401 filas)");
comprobar(sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 73 and modulo = 'servicios'") === "1", "la fila del servicio opcional (1) está; el 112 incluido NO genera fila propia (va horneado en el PVP)");

// ── 2. Composición de la 258 tras la publicación por lotes (112 con tarifa en todas las fechas) ───────────────────────────────────
console.log("\n== 2. Composición de la 258 (servicio 112 incluido, con tarifa en todas las fechas) ==");
const b = await publicarLotes();
comprobar(b.r.ok === true && !b.r.pendiente, "nueva generación por lotes publicada");
const punt = punteros().split("|");
const comp = composicion();
comprobar(comp.length === N_VUELOS, `una composición por fecha de ida (${comp.length} de ${N_VUELOS})`);
comprobar(comp.every((c) => JSON.stringify(c.s) === "[112]"), "cada fecha acredita exactamente [112]");
comprobar(comp.every((c) => String(c.g) === punt[1]) && comp.every((c) => c.r === 1), `escrita por la generación hoy PUBLICADA (${punt[1]}) y con la regla 1`);
comprobar(sql("select count(distinct fecha_ida) from public.tarifario_resultado_publicable where paquete_id = 73 and modulo = 'bloqueo'") === String(N_VUELOS), "toda fecha de ida publicada tiene composición (el activador exige esto)");
if (verificador) {
  comprobar(comp.every((c) => verifica(c, [112]).ok === true), "la función REAL del hotfix 258 (verificarComposicionPublicada) ACEPTA las 32 salidas con la composición viva [112]");
  comprobar(verifica(comp[0], []).ok === false, "…y RECHAZA si la composición viva dejara de incluir el 112 (la evidencia sí discrimina)");
}

// ── 3. Ventana de 60 s con la CPU estrangulada como en producción; el navegador se «cierra» y la base sigue sola ───────────────────
console.log(`\n== 3. Ventana de 60 s con CPU estrangulada (${CPU}); navegador cerrado; continuación por el trabajador de la base ==`);
cpus(CPU); await dormir(800);
mundo.factorTarifa = 1.01;                         // otra tarifa: filas distintas (otro cálculo) → otra generación
const antes = visibles(); const compAntes = sql("select max(generacion) from public.tarifario_composicion_publicada where paquete_id = 73");
const r1 = await publicarLotes();
console.log(`  petición 1: ${JSON.stringify({ ok: r1.r.ok, pendiente: r1.r.pendiente, error: r1.r.error })} · ${r1.ms} ms\n    ${r1.medicion}`);
comprobar(r1.ms <= 60_000, `la petición 1 TERMINA dentro de la ventana de 60 s (${r1.ms} ms)`);
comprobar(r1.r.ok === true, "la petición 1 no falla");
if (r1.r.pendiente) {
  comprobar(r1.r.pendiente.automatica === true, "queda «pendiente» y AUTOMÁTICA: todos los lotes ya están en la base y la publicación continúa sola");
  comprobar(visibles() === antes, "NAVEGADOR CERRADO aquí: lo publicado antes sigue intacto y completo (nada de la generación nueva es visible)");
  comprobar(sql("select max(generacion) from public.tarifario_composicion_publicada where paquete_id = 73") === compAntes, "la composición publicada tampoco cambió: sigue siendo la de la generación visible");
  const pend = await leerPublicacionPendiente(clienteGenerar(), 73);
  comprobar(!!pend && pend.enCola && pend.faltan >= 0 && pend.total === 23, `al reabrir, la base reporta la publicación EN COLA (faltan ${pend?.faltan} lotes por cargar de ${pend?.total}; con 0 solo falta activar)`);
  const est = await peticion(acciones.estadoPublicacionTarifario, 73);
  comprobar(est.r.ok === true && est.r.pendiente?.automatica === true && est.ms < 5000, `la pantalla consulta el estado sin recalcular: ${est.r.aviso} (${est.ms} ms)`);
  const llamadas = trabajador();
  console.log(`  trabajador de la base (sin pantalla): ${llamadas} llamada(s)`);
} else {
  // Publicó y activó dentro de la propia petición; si no cupo toda la limpieza de la generación anterior, la termina el trabajador de la base (sin pantalla).
  console.log(`  (la petición 1 publicó sola; limpieza pendiente en la cola: ${sql("select count(*) from public.tarifario_publicacion_cola")}) · trabajador: ${trabajador()} llamada(s)`);
}
const vB = visibles().split("|"); const puntB = punteros().split("|");
comprobar(vB[0] === "22401" && vB[1] === "1" && vB[2] === puntB[1] && puntB[2] === "listo", `visible: 22.401 filas, una sola generación (${vB[2]}), la del puntero, estado «${puntB[2]}»`);
const compB = composicion();
comprobar(compB.length === N_VUELOS && compB.every((c) => String(c.g) === puntB[1] && JSON.stringify(c.s) === "[112]"), "la composición acredita la generación nueva en el mismo instante en que se vuelve visible");
comprobar(sql("select count(*) from public.tarifario_resultado where paquete_id = 73") === "22401", "la limpieza retiró la generación anterior (solo quedan las 22.401 filas)");
comprobar(sql("select count(*) from public.tarifario_lote_espera") === "0" && sql("select count(*) from public.tarifario_publicacion_cola") === "0", "la espera y la cola quedaron vacías");

// ── 3b. La ventana ya estaba casi agotada al empezar (la acción llevaba 50 s): no alcanza ni para PREPARAR → pendiente MANUAL; reanudar la completa ──
console.log("\n== 3b. Ventana agotada al preparar los lotes (acción de 50 s previos) ==");
mundo.factorTarifa = 1.02;
const antes3b = visibles();
const s1 = await publicarLotes({ inicioMs: Date.now() - 50_000 });
comprobar(s1.r.ok === true && !!s1.r.pendiente && s1.r.pendiente.automatica === false, `sin tiempo para preparar todos los lotes: «pendiente» NO automática (${s1.r.aviso}) en ${s1.ms} ms`);
comprobar(visibles() === antes3b, "lo publicado antes sigue intacto");
cpus(16); await dormir(500);
const s2 = await peticion(acciones.continuarPublicacionTarifario, 73);
comprobar(s2.r.ok === true, `«Continuar» (otra petición, recalcula las mismas filas y sube lo que falta): ${s2.r.aviso ?? "ok"}`);
if (s2.r.pendiente) trabajador();
comprobar(visibles().split("|")[0] === "22401" && punteros().split("|")[2] === "listo", "tras continuar, queda publicada completa");

// ── 4. Reglas reales de la 256/258: el 112 INCLUIDO con tarifa solo en 16 de las 32 salidas (mismo paquete, una sola publicación) ──────
if (COMBINADO) {
  console.log("\n== 4. 256/258 reales: servicio 112 incluido CON tarifa en 16 salidas y SIN tarifa en las otras 16 ==");
  const fechasCon = (k) => `fecha_ida < '${dia(CORTE)}'`;
  const fechasSin = `fecha_ida >= '${dia(CORTE)}'`;
  // referencias: «total» (112 cubierto en todas) y «ninguna» (112 sin tarifa en ninguna): el caso parcial debe ser exactamente la unión de ambas por fecha
  mundo.factorTarifa = 1; mundo.vigencia112 = "total";
  const ref1 = await publicarLotes(); comprobar(ref1.r.ok === true, "referencia A publicada: 112 con tarifa en todas las fechas");
  const hCon = huellaFilas(fechasCon()); const pCon = sql(`select min(precio_pvp) from public.tarifario_resultado_publicable where paquete_id = 73 and modulo = 'bloqueo' and acomodacion = 'doble' and fecha_ida = '${dia(0)}' and hotel_id = 2000 and categoria = 'Categoria A' and regimen = 'PC'`);
  mundo.vigencia112 = "ninguna";
  const ref2 = await publicarLotes(); comprobar(ref2.r.ok === true, "referencia B publicada: 112 incluido pero SIN tarifa en ninguna fecha (se omite en todas)");
  const compNinguna = composicion();
  comprobar(compNinguna.length === N_VUELOS && compNinguna.every((c) => JSON.stringify(c.s) === "[]"), "referencia B: las 32 fechas acreditan [] (composición VACÍA pero acreditada: el activador exige la fecha, no que traiga servicios)");
  const hSin = huellaFilas(fechasSin); const pSin = sql(`select min(precio_pvp) from public.tarifario_resultado_publicable where paquete_id = 73 and modulo = 'bloqueo' and acomodacion = 'doble' and fecha_ida = '${dia(CORTE)}' and hotel_id = 2000 and categoria = 'Categoria A' and regimen = 'PC'`);

  mundo.vigencia112 = "parcial";
  const par = await publicarLotes();
  console.log(`  parcial: ${JSON.stringify({ ok: par.r.ok, pendiente: par.r.pendiente, error: par.r.error, aviso: par.r.aviso?.slice(0, 160) })} · ${par.ms} ms`);
  comprobar(par.r.ok === true && !par.r.pendiente && visibles().startsWith("22401|1|"), "PUBLICACIÓN: el caso parcial se publica completo por lotes (22.401 filas, una generación): las salidas sin tarifa NO se descartan, se ofrecen sin el 112");
  comprobar(huellaFilas(fechasCon()) === hCon, "PRECIO: las 16 fechas CON tarifa son idénticas a la referencia A (el 112 cobrado y horneado)");
  comprobar(huellaFilas(fechasSin) === hSin, "PRECIO: las 16 fechas SIN tarifa son idénticas a la referencia B (el 112 omitido del precio)");
  comprobar(Number(pCon) > Number(pSin), `PRECIO: la misma habitación cuesta más con el 112 que sin él (${pCon} vs ${pSin})`);
  const cp = composicion();
  const conc = cp.filter((c) => c.f < dia(CORTE)); const sinc = cp.filter((c) => c.f >= dia(CORTE));
  comprobar(conc.length === CORTE && conc.every((c) => JSON.stringify(c.s) === "[112]") && sinc.length === N_VUELOS - CORTE && sinc.every((c) => JSON.stringify(c.s) === "[]"),
            `COMPOSICIÓN: ${CORTE} fechas con [112] y ${N_VUELOS - CORTE} fechas con [] (omitido), todas acreditadas por la generación publicada`);
  const diag = sql("select coalesce(tarifario_diagnostico, '') from public.armado_paquetes where id = 73");
  comprobar(diag.length > 0, `DIAGNÓSTICO de la 256 escrito por la activación junto con el puntero (viajó en el manifiesto): «${diag.slice(0, 110)}…»`);
  const mono = await publicarMono();
  comprobar(mono.r.ok === true && huellaFilas(fechasCon()) === hCon && huellaFilas(fechasSin) === hSin, "EQUIVALENCIA: el publicador monolítico del hotfix produce exactamente las mismas filas que los lotes en el caso parcial");
  const cpm = composicion();
  comprobar(JSON.stringify(cpm.map((c) => [c.f, c.s])) === JSON.stringify(cp.map((c) => [c.f, c.s])), "EQUIVALENCIA: …y la misma composición por fecha");

  // CONSULTA (visitante anónimo por PostgREST: la vista pública) y COTIZACIÓN/RESERVA (la compuerta REAL que usan: verificarComposicionPublicada con la evidencia leída de la base)
  const fCon = dia(3), fSin = dia(CORTE + 3);
  const q = async (f) => (await getAnon(`tarifario_resultado_publicable?paquete_id=eq.73&modulo=eq.bloqueo&fecha_ida=eq.${f}&hotel_id=eq.2000&categoria=eq.Categoria%20A&regimen=eq.PC&acomodacion=eq.doble&select=precio_pvp,fecha_ida,noches`)).j;
  const [rc, rs] = [await q(fCon), await q(fSin)];
  comprobar(Array.isArray(rc) && rc.length === 1 && Array.isArray(rs) && rs.length === 1 && Number(rc[0].precio_pvp) > Number(rs[0].precio_pvp), `CONSULTA (visitante anónimo, vista pública): ${fCon} cuesta ${rc?.[0]?.precio_pvp} (con 112) y ${fSin} cuesta ${rs?.[0]?.precio_pvp} (sin 112)`);
  const exposicion = (await getAnon("tarifario_resultado?paquete_id=eq.73&select=generacion,lote,neto_hotel&limit=1"));
  comprobar(exposicion.http !== 200 || (Array.isArray(exposicion.j) && exposicion.j.length === 0) || exposicion.j?.code, "CONSULTA: el visitante anónimo no puede leer la tabla base con metadatos de generación ni neto_hotel (columna inexistente o sin filas)");
  const evid = async (f) => (await getAnon(`rpc_no_existe`)).http && cp.find((c) => c.f === f);
  const cv = composicion();   // la vigente AHORA: el monolítico de arriba publicó una generación nueva
  const eCon = cv.find((c) => c.f === fCon); const eSin = cv.find((c) => c.f === fSin);
  comprobar(verifica(eCon, [112]).ok === true && verifica(eSin, []).ok === true, "COTIZACIÓN/RESERVA: la compuerta REAL acepta la fecha CON 112 (viva [112]) y la fecha SIN 112 (viva []) con la evidencia publicada");
  comprobar(verifica(eCon, []).ok === false && verifica(eSin, [112]).ok === false, "COTIZACIÓN/RESERVA: …y rechaza la discrepancia en ambos sentidos (cobrar un 112 omitido, u omitir uno cobrado): «regenera el tarifario»");
  void evid;
}

// ── 5. El 112 deja de ser incluido (sale del paquete): la evidencia queda vacía y la publicación sigue siendo válida ─────────────────────
console.log("\n== 5. El 112 sale del paquete ==");
cpus(16); await dormir(500);
mundo.incluido112 = false; mundo.vigencia112 = "total"; sincronizarDb112();
sql("update public.armado_paquetes set tarifario_snapshot_publicable = true where id = 73");
const c5 = await publicarLotes();
comprobar(c5.r.ok === true && !c5.r.pendiente, "publica sin el servicio incluido");
const compC = composicion();
comprobar(compC.length === 0 || compC.every((c) => c.s.length === 0), `sin servicios incluidos la evidencia queda vacía o ausente (${compC.length} filas)`);

console.log(fallos.length ? `\nRECORRIDO 73: ${fallos.length} FALLA(S)\n - ${fallos.join("\n - ")}` : "\nRECORRIDO 73: todas las comprobaciones pasaron.");
process.exit(fallos.length ? 1 : 0);
