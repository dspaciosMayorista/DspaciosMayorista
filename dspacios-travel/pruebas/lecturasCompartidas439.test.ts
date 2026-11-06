import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// #439 — LECTURAS COMPARTIDAS entre las combinaciones de una cotización de tarjeta (lib/reservar/lecturasCompartidas.ts + computarReserva + cotizarTarjetaHotel).
// Recorrido con código REAL: generarTarifario (publica filas, composición y evidencia) → cotizarTarjetaHotel / computarReserva, con servicios incluidos, regla EBB (exige composición)
// y hasta 64 combinaciones. Cliente de Supabase falso que CUENTA las lecturas realmente ejecutadas. Qué se prueba:
//   · igualdad de resultados con y sin memo (todas las combinaciones, tres orígenes);
//   · aislamiento: entre combos (orden inverso), entre llamadas y sin objetos compartidos; ninguna clave lleva categoría/régimen (lo que depende del combo no se memoiza);
//   · lecturas fallidas: el mismo error con y sin memo, y una lectura que lanza no queda guardada;
//   · el combo más barato al final, el límite exacto (64) y el exceso (65) con código propio.
// Las cifras de lecturas y duración que imprime son LOCALES (sin red): no sustituyen una medición remota.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;
type Rpc = { nombre: string; args: Record<string, unknown> };
type Opciones = { errorEn?: string; lanzarUnaVezEn?: string; lecturas?: string[] };

const GENERACION = 3;
const PAQUETE_ID = 439;
const HOTEL = 94;
const ID_FUENTE = 7;

function cliente(tablas: Tablas, opciones: Opciones = {}) {
  const rpcs: Rpc[] = [];
  let yaLanzo = false;
  function from(tabla: string) {
    const filtros: ((r: Fila) => boolean)[] = [];
    let uno = false;
    const b: Record<string, unknown> = {};
    b.select = () => b; b.order = () => b; b.range = () => b; b.limit = () => b; b.not = () => b;
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; };
    b.in = (c: string, v: unknown[]) => { filtros.push((r) => v.includes(r[c])); return b; };
    b.is = (c: string, v: unknown) => { filtros.push((r) => (r[c] ?? null) === v); return b; };
    b.single = () => { uno = true; return b; };
    b.maybeSingle = () => { uno = true; return b; };
    b.upsert = (filas: Fila[]) => {
      const t = (tablas[tabla] ??= []);
      for (const f of filas) {
        const i = t.findIndex((x) => x.paquete_id === f.paquete_id && x.generacion === f.generacion && x.clave === f.clave);
        if (i >= 0) t[i] = f; else t.push(f);
      }
      return Promise.resolve({ error: null });
    };
    b.delete = () => ({ eq: (c: string, v: unknown) => ({ lt: (c2: string, v2: unknown) => { tablas[tabla] = (tablas[tabla] ?? []).filter((r) => !(r[c] === v && Number(r[c2]) < Number(v2))); return Promise.resolve({ error: null }); } }) });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (tablas[tabla] === undefined) throw new Error(`fixture incompleto: falta la tabla "${tabla}"`);
      opciones.lecturas?.push(tabla);
      if (opciones.lanzarUnaVezEn === tabla && !yaLanzo) { yaLanzo = true; return Promise.reject(new Error("fallo transitorio de red")).then(res, rej); }
      if (opciones.errorEn === tabla) return Promise.resolve({ data: null, error: { message: "boom", code: "XX000" } }).then(res, rej);
      const filas = tablas[tabla].filter((r) => filtros.every((f) => f(r)));
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  async function rpc(nombre: string, args: Record<string, unknown>) {
    rpcs.push({ nombre, args });
    if (nombre === "iniciar_generacion_tarifario") return { data: [{ generacion: GENERACION, revision_capturada: 5 }], error: null };
    if (nombre === "publicar_tarifario_resultado" || nombre === "publicar_tarifario_resultado_63") return { data: true, error: null };
    return { data: null, error: null };
  }
  return { sb: { from, rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) } }, rpcs };
}

let adminActual: ReturnType<typeof cliente>["sb"] | null = null;
let sbServidor: unknown = null;
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { if (!adminActual) throw new Error("admin no preparado"); return adminActual; } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { if (sbServidor == null) throw new Error("createClient() real NUNCA debe invocarse aquí"); return sbServidor; } } });
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { REGLA_COMPOSICION_PUBLICADA } = await import("../lib/reservar/composicionPublicada.ts");
const { cotizarTarjetaHotel } = await import("../app/tarifario/cotizarTarjetaActions.ts");
const { crearLecturasCompartidas } = await import("../lib/reservar/lecturasCompartidas.ts");
const Entrada = await import("../lib/tarifario/entradaTarjeta.ts");

const fechaBogota = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const EN_30 = fechaBogota(30);
const EN_31 = fechaBogota(31);

// ── Datos ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Origen = "salida" | "bloqueo" | "empaquetado";
type Combo = { categoria: string; regimen: string };
const CATS = Array.from({ length: 8 }, (_, i) => `Categoría ${i + 1}`);
const REGS = ["PA", "PAE", "PAM", "PC", "FULL", "FULL TROPICAL", "FULL PREMIUM", "PA+OPEN BAR"];
const combosN = (n: number): Combo[] => CATS.flatMap((categoria) => REGS.map((regimen) => ({ categoria, regimen }))).slice(0, n);
/** El combo más barato es el ÚLTIMO: si algo recorta o corta la búsqueda antes, el mínimo se pierde. */
const netoDoble = (i: number, n: number) => (i === n - 1 ? 300_000 : 400_000 + i * 1_000);
const SERVICIOS = [{ id: 11, nombre: "Tour incluido", neto: 80_000, netoInfante: 40_000 }, { id: 12, nombre: "Asistencia", neto: 41_000, netoInfante: 0 }];
const REGLAS_EBB = [{ hotel_id: HOTEL, tipo: "ebb", umbral: 10, pct: 18, activa: true }];
type Opc = { origen: Origen; combos: Combo[]; servicios?: typeof SERVICIOS };

function fuenteVuelo() {
  return { id: ID_FUENTE, destino_id: 1, record: "ABC123", ruta: "BOG - CTG - BOG", fecha_ida: EN_30, fecha_regreso: EN_31, tarifa_para_empaquetar: 904_000, fee_infante: 80_000, moneda: "COP" };
}
const tarifaRows = (o: Opc) => o.combos.map((c, i) => ({ hotel_id: HOTEL, tipo_habitacion: c.categoria, alimentacion: c.regimen, temporada: "Base", neto_sencilla: 520_000, neto_doble: netoDoble(i, o.combos.length), neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, notas: null, precio_final_autoritativo: false }));
const tipoPaquete = (o: Opc) => (o.origen === "salida" ? "dinamico" : "bloqueo");

function tablasGenerar(o: Opc): Tablas {
  const sv = o.servicios ?? SERVICIOS;
  return {
    armado_paquetes: [{ id: PAQUETE_ID, nombre: "Paquete 439", activo: true, destino_id: 1, pct_mk: 0.2, tipo: tipoPaquete(o), impuesto_tipo: "fijo", impuesto_fijo: 0, noches: 1, destinos: { nombre: "CARTAGENA" }, moneda_publicacion: "COP", destinos_aereos_alternativos: false }],
    armado_vuelos: o.origen === "bloqueo" ? [{ paquete_id: PAQUETE_ID, bloqueo_id: ID_FUENTE, aplica_mk: true, ta: 0, bloqueos_vuelo: fuenteVuelo() }] : [],
    armado_empaquetados: o.origen === "empaquetado" ? [{ paquete_id: PAQUETE_ID, empaquetado_id: ID_FUENTE, aplica_mk: true, ta: 0, empaquetados: { ...fuenteVuelo(), activo: true, compra_inicio: null, compra_fin: null } }] : [],
    armado_servicios: sv.map((s) => ({ paquete_id: PAQUETE_ID, servicio_id: s.id, modo: "persona", incluido: true, servicios_adicionales: { nombre: s.nombre, precio_persona: s.neto, precio_infante: s.netoInfante, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: "COP" } })),
    servicio_temporadas: sv.map((s) => ({ servicio_id: s.id, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: s.neto, precio_infante: s.netoInfante, recargo_individual: null })),
    servicio_tarifa_pax: [],
    servicios_adicionales: sv.map((s) => ({ id: s.id, tipo_receptivo: null, combo_incluye_traslado: null, combo_traslado_alcance: null })),
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel 94", moneda: "COP", modelo_tarifario: "persona", adults_only: false } }],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null }],
    tarifa_hotel: tarifaRows(o),
    salidas_dinamicas: o.origen === "salida" ? [{ id: 9, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30, fecha_regreso: EN_31, ruta: "BOG - CTG - BOG", valor_tiquete: 904_000, aplica_mk: true, ta: 0, fee_infante: 80_000, empaquetado_id: null }] : [],
    tarifario_resultado_composicion: [],
    bloqueos_vuelo: o.origen === "bloqueo" ? [fuenteVuelo()] : [],
    empaquetados: o.origen === "empaquetado" ? [{ ...fuenteVuelo(), activo: true, compra_inicio: null, compra_fin: null }] : [],
  };
}

type Resultado = { publicadas: Fila[]; composiciones: Fila[] };
async function generar(o: Opc): Promise<Resultado> {
  const tablas = tablasGenerar(o);
  const g = cliente(tablas);
  sbServidor = g.sb; adminActual = g.sb;
  const prev = console.error; console.error = () => {};
  try {
    const r = await generarTarifario(PAQUETE_ID);
    assert.ok(r.ok, r.ok ? "" : String((r as { error?: string }).error));
    return { publicadas: (g.rpcs.find((x) => x.nombre.startsWith("publicar_tarifario_resultado"))?.args.p_filas ?? []) as Fila[], composiciones: tablas.tarifario_resultado_composicion };
  } finally { console.error = prev; sbServidor = null; adminActual = null; }
}

function tablasReserva(o: Opc, r: Resultado, reglas: Fila[] = REGLAS_EBB): Tablas {
  const sv = o.servicios ?? SERVICIOS;
  return {
    hoteles: [{ id: HOTEL, modelo_tarifario: "persona", tarifa_bajo_solicitud: false, nombre: "Hotel 94", moneda: "COP", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 6, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false }],
    armado_paquetes: [{ id: PAQUETE_ID, pct_mk: 0.2, impuesto_fijo: 0, destino_id: 1, tipo: tipoPaquete(o), tarifario_generacion_publicada: GENERACION, tarifario_revision_publicada: 5, destinos_aereos_alternativos: false }],
    tarifario_resultado_publicable: r.publicadas.map((f) => ({ paquete_id: PAQUETE_ID, bloqueo_id: null, empaquetado_id: null, salida_id: null, ...f, precio_pvp_menor2: f.precio_pvp_menor2 ?? null })),
    tarifario_resultado_composicion: r.composiciones,
    tarifario_composicion_publicada: [{ paquete_id: PAQUETE_ID, fecha_ida: EN_30, generacion: GENERACION, regla: REGLA_COMPOSICION_PUBLICADA, servicios_incluidos: sv.map((s) => s.id).sort((a, b) => a - b) }],
    salidas_dinamicas: o.origen === "salida" ? [{ id: 9, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30, fecha_regreso: EN_31, ruta: "BOG - CTG - BOG", valor_tiquete: 904_000, aplica_mk: true, ta: 0, fee_infante: 80_000, empaquetado_id: null }] : [],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel 94", moneda: "COP", modelo_tarifario: "persona", adults_only: false } }],
    armado_vuelos: [], armado_empaquetados: [], hotel_reglas_descuento: reglas.map((x) => ({ ...x })), // copia: ninguna prueba puede alterar el arreglo compartido
    bloqueos_vuelo: o.origen === "bloqueo" ? [fuenteVuelo()] : [],
    empaquetados_basica: o.origen === "empaquetado" ? [{ id: ID_FUENTE, activo: true, compra_inicio: null, compra_fin: null }] : [],
    empaquetados: o.origen === "empaquetado" ? [{ ...fuenteVuelo(), activo: true, compra_inicio: null, compra_fin: null }] : [],
    hotel_acomodaciones: [
      { hotel_id: HOTEL, acomodacion: "sencilla", pax_tarifa: 1, pax_max: 2, adt_min: 1, adt_max: 1, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 },
      { hotel_id: HOTEL, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
    ],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null }],
    tarifa_hotel: tarifaRows(o),
    armado_servicios: sv.map((s) => ({ paquete_id: PAQUETE_ID, servicio_id: s.id, modo: "persona", incluido: true, servicios_adicionales: { nombre: s.nombre, categoria: "otro", precio_persona: s.neto, precio_infante: s.netoInfante, liquidacion: "paquete", proveedor_id: null } })),
    servicios_adicionales: sv.map((s) => ({ id: s.id, nombre: s.nombre, precio_persona: s.neto, precio_infante: s.netoInfante, categoria: "otro", proveedor_id: null, moneda: "COP" })),
    servicio_temporadas: sv.map((s) => ({ servicio_id: s.id, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: s.neto, precio_infante: s.netoInfante, recargo_individual: null })),
    servicio_tarifa_pax: [],
  };
}

/** Misma entrada que arma cotizarTarjetaHotel por combinación (1 doble, 2 adultos, sin menores). */
const reservaDe = (o: Opc, c: Combo) => ({
  paqueteId: PAQUETE_ID, bloqueoId: o.origen === "bloqueo" ? ID_FUENTE : null, empaquetadoId: o.origen === "empaquetado" ? ID_FUENTE : (o.origen === "bloqueo" ? null : undefined),
  salidaId: o.origen === "salida" ? 9 : undefined, modulo: o.origen === "salida" ? "dinamico" : "bloqueo", hotelId: HOTEL, categoria: c.categoria, regimen: c.regimen,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
  cliente: { nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" },
  tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "", pasajeros: [], servicios: [],
});
const entradaDe = (o: Opc, combos: Combo[] = o.combos) => ({
  modulo: o.origen === "salida" ? "dinamico" : "bloqueo", paqueteId: PAQUETE_ID, hotelId: HOTEL, combos,
  ...(o.origen === "bloqueo" ? { bloqueoId: ID_FUENTE } : o.origen === "empaquetado" ? { empaquetadoId: ID_FUENTE } : { salidaId: 9 }),
});

type Cmp = Awaited<ReturnType<typeof computarReserva>>;
async function computar(o: Opc, t: Tablas, combos: Combo[], conMemo: boolean, opc: Opciones = {}, memoExterno?: ReturnType<typeof crearLecturasCompartidas>): Promise<{ res: Cmp[]; lecturas: string[]; memo: ReturnType<typeof crearLecturasCompartidas> }> {
  const lecturas: string[] = [];
  const c = cliente(t, { ...opc, lecturas });
  adminActual = c.sb; sbServidor = c.sb;
  const memo = memoExterno ?? crearLecturasCompartidas();
  try {
    const res: Cmp[] = [];
    for (const k of combos) res.push(await computarReserva(c.sb as never, reservaDe(o, k) as never, undefined, conMemo ? memo : undefined));
    return { res, lecturas, memo };
  } finally { adminActual = null; sbServidor = null; }
}
async function tarjeta(o: Opc, t: Tablas, entrada: unknown, opc: Opciones = {}) {
  const lecturas: string[] = [];
  const c = cliente(t, { ...opc, lecturas });
  adminActual = c.sb; sbServidor = c.sb;
  const t0 = performance.now();
  try { return { r: await cotizarTarjetaHotel(entrada), lecturas, ms: Math.round(performance.now() - t0) }; } finally { adminActual = null; sbServidor = null; }
}

// ── 1. El memo en sí ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("crearLecturasCompartidas (memo de UNA llamada)", () => {
  test("ejecuta una vez por clave; claves distintas (categoría, régimen, origen, fecha) NO se mezclan", async () => {
    const m = crearLecturasCompartidas();
    let n = 0;
    const lee = (v: string) => () => { n++; return Promise.resolve({ data: v, error: null }); };
    assert.deepEqual(await m.memo("hotel:1|cat:A|reg:PC|b7|2030-01-01", lee("a")), { data: "a", error: null });
    assert.deepEqual(await m.memo("hotel:1|cat:A|reg:PC|b7|2030-01-01", lee("zzz")), { data: "a", error: null }, "misma clave: se reutiliza");
    for (const k of ["hotel:1|cat:B|reg:PC|b7|2030-01-01", "hotel:1|cat:A|reg:PAM|b7|2030-01-01", "hotel:1|cat:A|reg:PC|b8|2030-01-01", "hotel:1|cat:A|reg:PC|b7|2030-01-02"]) {
      assert.deepEqual(await m.memo(k, lee(k)), { data: k, error: null }, "clave distinta: lectura propia");
    }
    assert.equal(n, 5);
    assert.deepEqual(m.estadisticas(), { ejecutadas: 5, reutilizadas: 1 });
  });

  test("cada solicitante recibe una COPIA: mutar el resultado de un combo no altera al siguiente", async () => {
    const m = crearLecturasCompartidas();
    const lee = () => Promise.resolve({ data: { temporadas: [{ nombre: "Base", rangos: [1, 2] }], mapa: new Map([["a", new Set([1])]]) }, error: null });
    const a = await m.memo("k", lee);
    a.data!.temporadas[0].nombre = "ALTERADO"; a.data!.temporadas.push({ nombre: "extra", rangos: [] }); a.data!.mapa.get("a")!.add(99);
    const b = await m.memo("k", lee);
    assert.equal(b.data!.temporadas.length, 1);
    assert.equal(b.data!.temporadas[0].nombre, "Base");
    assert.deepEqual([...b.data!.mapa.get("a")!], [1]);
    assert.notEqual(a, b);
  });

  test("aislamiento entre llamadas: un memo nuevo no ve lo guardado por otro (sin estado de módulo)", async () => {
    const m1 = crearLecturasCompartidas(), m2 = crearLecturasCompartidas();
    let n = 0;
    const lee = () => { n++; return Promise.resolve(n); };
    assert.equal(await m1.memo("k", lee), 1);
    assert.equal(await m2.memo("k", lee), 2, "otra llamada = otra lectura");
    assert.equal(await m1.memo("k", lee), 1);
  });

  test("un resultado con error se conserva tal cual; una lectura que LANZA no se guarda (se reintenta y se relanza)", async () => {
    const m = crearLecturasCompartidas();
    let n = 0;
    const conError = () => { n++; return Promise.resolve({ data: null, error: { message: "boom" } }); };
    assert.deepEqual(await m.memo("e", conError), { data: null, error: { message: "boom" } });
    assert.deepEqual(await m.memo("e", conError), { data: null, error: { message: "boom" } });
    assert.equal(n, 1, "el error devuelto como dato se reutiliza (mismo error para todos los combos)");
    let intentos = 0;
    const lanza = () => { intentos++; return intentos === 1 ? Promise.reject(new Error("red")) : Promise.resolve("ok"); };
    await assert.rejects(() => m.memo("t", lanza), /red/);
    assert.equal(await m.memo("t", lanza), "ok", "la excepción no quedó guardada");
    assert.equal(intentos, 2);
  });

  test("una clave vacía o no textual se rechaza", async () => {
    const m = crearLecturasCompartidas();
    await assert.rejects(() => m.memo("", () => Promise.resolve(1)), /clave/);
    await assert.rejects(() => m.memo(undefined as never, () => Promise.resolve(1)), /clave/);
  });
});

// ── 2. Igualdad con y sin memo, aislamiento entre combos, tres orígenes ──────────────────────────────────────────────────────────────────────────────
for (const origen of ["bloqueo", "salida", "empaquetado"] as const) {
  describe(`igualdad con y sin memo · origen ${origen} · servicios incluidos + EBB (composición)`, () => {
    const o: Opc = { origen, combos: combosN(6) };
    test("todas las combinaciones dan EXACTAMENTE el mismo resultado; con memo se leen menos filas y los combos no se contaminan (orden inverso)", async () => {
      const r = await generar(o);
      const t = () => tablasReserva(o, r);
      const sin = await computar(o, t(), o.combos, false);
      const con = await computar(o, t(), o.combos, true);
      assert.deepEqual(con.res, sin.res, "con memo = sin memo, combinación por combinación");
      assert.ok(sin.res.every((x) => x.ok), sin.res.map((x) => (x.ok ? "" : x.error)).join(" | "));
      const conRev = await computar(o, t(), [...o.combos].reverse(), true);
      assert.deepEqual([...conRev.res].reverse(), sin.res, "el orden de las combinaciones no cambia ningún resultado");
      assert.ok(con.lecturas.length < sin.lecturas.length, `con memo ${con.lecturas.length} < sin memo ${sin.lecturas.length}`);
      assert.deepEqual(con.memo.estadisticas().ejecutadas + con.memo.estadisticas().reutilizadas > 0, true);
      // Se usó la composición (EBB exige composición): el descuento aparece en cada combinación.
      for (const x of con.res) if (x.ok) assert.ok(x.data.descuentoHotel, "la regla EBB se aplicó con la composición publicada");
    });
  });
}

describe("ninguna clave memoizada depende del combo; las lecturas propias del combo siguen siendo por combo", () => {
  test("las claves son las mismas para combinaciones distintas y no llevan categoría ni régimen", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(3) };
    const r = await generar(o);
    const clavesPorCombo: string[][] = [];
    const lecturas: string[] = [];
    const c = cliente(tablasReserva(o, r), { lecturas });
    adminActual = c.sb; sbServidor = c.sb;
    try {
      for (const k of o.combos) {
        const claves: string[] = [];
        const espia = { memo: <T,>(clave: string, leer: () => PromiseLike<T>) => { claves.push(clave); return Promise.resolve(leer()) as Promise<T>; }, estadisticas: () => ({ ejecutadas: 0, reutilizadas: 0 }) };
        const x = await computarReserva(c.sb as never, reservaDe(o, k) as never, undefined, espia as never);
        assert.ok(x.ok, x.ok ? "" : x.error);
        clavesPorCombo.push(claves);
      }
    } finally { adminActual = null; sbServidor = null; }
    assert.ok(clavesPorCombo[0].length >= 8, `se memoizan las lecturas idénticas (${clavesPorCombo[0].length} claves)`);
    assert.deepEqual(clavesPorCombo[1], clavesPorCombo[0]);
    assert.deepEqual(clavesPorCombo[2], clavesPorCombo[0]);
    for (const k of clavesPorCombo[0]) {
      assert.ok(!/Categor[ií]a|PAM|FULL|\bPC\b|\bPA\b|PAE/.test(k), `la clave «${k}» no debe llevar categoría ni régimen`);
      assert.ok(k.includes(String(PAQUETE_ID)) || k.includes(String(HOTEL)) || k.includes(String(ID_FUENTE)), `la clave «${k}» debe llevar paquete, hotel u origen`);
    }
    // La fila publicada, la tarifa neta y la composición del combo se leen en CADA combinación: nunca se compartieron.
    const porTabla = (t: string) => lecturas.filter((x) => x === t).length;
    assert.equal(porTabla("tarifario_resultado_publicable"), 3);
    assert.equal(porTabla("tarifa_hotel"), 3);
    assert.equal(porTabla("tarifario_resultado_composicion"), 3);
  });

  test("sin memo, computarReserva se comporta como siempre (cada lectura se ejecuta)", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(3) };
    const r = await generar(o);
    const sin = await computar(o, tablasReserva(o, r), o.combos, false);
    const una = await computar(o, tablasReserva(o, r), o.combos.slice(0, 1), false);
    assert.equal(sin.lecturas.length, una.lecturas.length * 3, "sin memo, el costo es exactamente lineal");
  });
});

// ── 3. Lecturas fallidas ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("lecturas fallidas: el mismo error con y sin memo", () => {
  for (const tabla of ["hotel_temporadas", "armado_servicios", "hotel_reglas_descuento", "hoteles", "armado_paquetes", "hotel_acomodaciones", "tarifario_composicion_publicada"]) {
    test(`error de «${tabla}»`, async () => {
      const o: Opc = { origen: "bloqueo", combos: combosN(4) };
      const r = await generar(o);
      const sin = await computar(o, tablasReserva(o, r), o.combos, false, { errorEn: tabla });
      const con = await computar(o, tablasReserva(o, r), o.combos, true, { errorEn: tabla });
      assert.deepEqual(con.res, sin.res, "idénticos con y sin memo");
      assert.ok(con.lecturas.filter((x) => x === tabla).length <= sin.lecturas.filter((x) => x === tabla).length);
    });
  }

  test("el error de una lectura compartida se ve en TODAS las combinaciones (no se oculta tras la primera) y se lee una sola vez", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(4) };
    const r = await generar(o);
    const con = await computar(o, tablasReserva(o, r), o.combos, true, { errorEn: "hotel_temporadas" });
    assert.ok(con.res.every((x) => !x.ok && /vigencia de temporadas/.test(x.error)), con.res.map((x) => (x.ok ? "ok" : x.error)).join(" | "));
    assert.equal(con.lecturas.filter((x) => x === "hotel_temporadas").length, 1);
  });

  test("una lectura que LANZA una vez no deja la lectura guardada: la combinación siguiente la reintenta y calcula", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(2) };
    const r = await generar(o);
    const t = tablasReserva(o, r);
    const lecturas: string[] = [];
    const c = cliente(t, { lecturas, lanzarUnaVezEn: "hotel_acomodaciones" });
    adminActual = c.sb; sbServidor = c.sb;
    const memo = crearLecturasCompartidas();
    try {
      await assert.rejects(() => computarReserva(c.sb as never, reservaDe(o, o.combos[0]) as never, undefined, memo), /fallo transitorio/);
      const ok = await computarReserva(c.sb as never, reservaDe(o, o.combos[1]) as never, undefined, memo);
      assert.ok(ok.ok, ok.ok ? "" : ok.error);
    } finally { adminActual = null; sbServidor = null; }
  });
});

// ── 4. Aislamiento entre llamadas de la acción ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe("cotizarTarjetaHotel: el memo muere con la llamada", () => {
  test("una segunda llamada ve los datos NUEVOS (nada se reutiliza entre llamadas ni usuarios)", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(3) };
    const r = await generar(o);
    const t1 = tablasReserva(o, r);
    const a = await tarjeta(o, t1, entradaDe(o));
    assert.equal(a.r.ok, true);
    const t2 = tablasReserva(o, r);
    (t2.armado_paquetes[0] as Fila).pct_mk = 0.5; // otro snapshot: el memo anterior, de existir global, devolvería el viejo
    (t2.hotel_reglas_descuento as Fila[]).length = 0;
    const b = await tarjeta(o, t2, entradaDe(o));
    assert.equal(b.r.ok, true);
    if (a.r.ok && b.r.ok) assert.equal(b.r.descuentoHotel, null, "la segunda llamada no arrastra las reglas de la primera");
  });
});

describe("las claves distinguen hotel y origen: un memo compartido POR ERROR entre dos hoteles no mezcla datos", () => {
  test("hotel 94 (con regla EBB) y hotel 95 (sin reglas) con UN solo memo dan lo mismo que con memos separados", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(3) };
    const r = await generar(o);
    const t = tablasReserva(o, r);
    // Hotel 95 = copia del 94 con SU propia identidad y sin reglas de descuento (el 94 sí las tiene).
    const como95 = (f: Fila): Fila => ({ ...f, hotel_id: 95, ...(f.id === HOTEL ? { id: 95 } : {}), ...(typeof f.clave === "string" ? { clave: f.clave.replace(`|${HOTEL}|`, "|95|") } : {}) });
    for (const tabla of ["armado_hoteles", "hotel_acomodaciones", "hotel_temporadas", "tarifa_hotel", "tarifario_resultado_publicable", "tarifario_resultado_composicion"]) t[tabla] = [...t[tabla], ...t[tabla].map(como95)];
    t.hoteles = [...t.hoteles, { ...t.hoteles[0], id: 95, nombre: "Hotel 95" }];
    const reserva = (c: Combo, hotelId: number) => ({ ...reservaDe(o, c), hotelId });
    const correr = async (compartido: boolean) => {
      const c = cliente(t); adminActual = c.sb; sbServidor = c.sb;
      const memo = crearLecturasCompartidas();
      try {
        const out: Cmp[] = [];
        for (const h of [HOTEL, 95]) for (const k of o.combos) out.push(await computarReserva(c.sb as never, reserva(k, h) as never, undefined, compartido ? memo : crearLecturasCompartidas()));
        return out;
      } finally { adminActual = null; sbServidor = null; }
    };
    const compartido = await correr(true), separados = await correr(false);
    assert.deepEqual(compartido, separados);
    const [de94, de95] = [compartido.slice(0, 3), compartido.slice(3)];
    assert.ok(de94.every((x) => x.ok && x.data.descuentoHotel), "el 94 conserva su regla EBB");
    assert.ok(de95.every((x) => !x.ok || x.data.descuentoHotel == null), "el 95 NO hereda la regla del 94");
  });
});

// ── 5. Recorrido completo con hasta 64 combinaciones ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("recorrido completo (generador real, servicios incluidos, EBB con composición): el combo más barato al final y el límite", () => {
  for (const n of [16, 64]) {
    test(`${n} combinaciones: se calculan TODAS, resultado idéntico a la referencia sin memo y el mínimo (el último) se encuentra`, async () => {
      const o: Opc = { origen: "bloqueo", combos: combosN(n) };
      const r = await generar(o);
      const t = () => tablasReserva(o, r);
      const ref = await computar(o, t(), o.combos, false);
      assert.ok(ref.res.every((x) => x.ok), ref.res.filter((x) => !x.ok).map((x) => (x.ok ? "" : x.error))[0]);
      const refMin = Math.min(...ref.res.map((x) => (x.ok ? x.data.pvpPorAcom.doble : Infinity)));
      const { r: res, lecturas, ms } = await tarjeta(o, t(), entradaDe(o));
      assert.equal(res.ok, true, res.ok ? "" : res.error);
      if (!res.ok) return;
      assert.equal(res.combos.length, n, "ninguna combinación se pierde");
      assert.equal(res.precio, refMin, "el precio mínimo coincide con el de la referencia sin memo");
      assert.equal(res.categoria, o.combos[n - 1].categoria, "el más barato es el último");
      assert.equal(res.regimen, o.combos[n - 1].regimen);
      res.combos.forEach((c, i) => { const x = ref.res[i]; assert.ok(x.ok); if (x.ok) assert.deepEqual(c.precios, x.data.pvpPorAcom, `combo ${i}`); });
      // REPORTE (local, sin red): consultas reales ejecutadas contra el cliente falso y duración.
      console.log(`REPORTE439 n=${n}: consultas con memo=${lecturas.length}, sin memo=${ref.lecturas.length}, por combo propio≈${((lecturas.length - 0) / n).toFixed(1)}; duración local de la acción=${ms} ms (sin red)`);
      assert.ok(lecturas.length < ref.lecturas.length);
      const porTabla = (t: string[]) => t.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
      console.log(`REPORTE439 n=${n}: por tabla con memo=${JSON.stringify(porTabla(lecturas))}`);
    });
  }

  test("límite exacto: MAX_COMBOS_TARJETA combinaciones se aceptan y se calculan todas", async () => {
    assert.equal(Entrada.MAX_COMBOS_TARJETA, 64);
    const o: Opc = { origen: "bloqueo", combos: combosN(Entrada.MAX_COMBOS_TARJETA) };
    const r = await generar(o);
    const { r: res } = await tarjeta(o, tablasReserva(o, r), entradaDe(o));
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.combos.length, 64);
  });

  test("exceso: 65 combinaciones se RECHAZAN con código propio, sin leer tarifas y sin presentarlo como ausencia de tarifa", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(64) };
    const r = await generar(o);
    const exceso = [...combosN(64), { categoria: "Categoría 9", regimen: "PC" }];
    const v = Entrada.validarEntradaTarjeta(entradaDe(o, exceso));
    assert.equal(v.ok, false);
    if (!v.ok) { assert.equal(v.codigo, "combos_exceden_limite"); assert.equal(v.recibidas, 65); assert.equal(v.limite, 64); }
    const logs: string[] = []; const prev = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const { r: res, lecturas } = await tarjeta(o, tablasReserva(o, r), entradaDe(o, exceso));
      assert.equal(res.ok, false);
      if (!res.ok) { assert.equal(res.error, Entrada.MENSAJE_TARJETA); assert.equal(res.motivos, undefined, "público: sin motivo interno"); }
      assert.deepEqual(lecturas.filter((x) => x !== "usuarios"), [], "no se leyó ninguna tabla de tarifas");
    } finally { console.error = prev; }
    assert.ok(logs.some((l) => l.includes("entrada_rechazada codigo=combos_exceden_limite") && l.includes("combos_recibidos=65") && l.includes("limite=64")), logs.join(" | "));
    assert.ok(!logs.some((l) => /categoria=|regimen=|Categoría 9/.test(l)), "el registro no copia valores de la entrada");
  });

  test("un rol interno activo ve el motivo del exceso («no es ausencia de tarifa»)", async () => {
    const o: Opc = { origen: "bloqueo", combos: combosN(2) };
    const r = await generar(o);
    const exceso = combosN(64).concat([{ categoria: "Categoría 9", regimen: "PC" }]);
    const t = tablasReserva(o, r);
    t.usuarios = [{ id: "u1", rol: "venta", activo: true }];
    const c = cliente(t);
    (c.sb as { auth: unknown }).auth = { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) };
    adminActual = c.sb; sbServidor = c.sb;
    const prev = console.error; console.error = () => {};
    try {
      const res = await cotizarTarjetaHotel(entradaDe(o, exceso));
      assert.equal(res.ok, false);
      if (!res.ok) { assert.equal(res.error, Entrada.MENSAJE_TARJETA); assert.match(res.motivos?.[0] ?? "", /no es ausencia de tarifa.*recibidas 65, máximo 64/); }
    } finally { console.error = prev; adminActual = null; sbServidor = null; }
  });
});

// ── 6. Rechazos de entrada: código estable, registro seguro y sin tocar la base ───────────────────────────────────────────────────────────────────────
describe("entrada inválida: código estable y registro seguro", () => {
  const ok = { modulo: "bloqueo", paqueteId: PAQUETE_ID, hotelId: HOTEL, bloqueoId: ID_FUENTE, empaquetadoId: null, salidaId: null, combos: [{ categoria: "Estándar", regimen: "PC" }] };
  const casos: [string, unknown, string][] = [
    ["null", null, "entrada_no_es_objeto"], ["arreglo", [], "entrada_no_es_objeto"], ["módulo inventado", { ...ok, modulo: "servicios" }, "modulo_invalido"],
    ["paqueteId como texto", { ...ok, paqueteId: "33" }, "ids_invalidos"], ["hotelId decimal", { ...ok, hotelId: 94.5 }, "ids_invalidos"], ["bloqueoId negativo", { ...ok, bloqueoId: -1 }, "ids_invalidos"],
    ["combos no es arreglo", { ...ok, combos: "Estándar|PC" }, "combos_no_es_arreglo"], ["sin combinaciones", { ...ok, combos: [] }, "combos_vacios"],
    ["categoría vacía", { ...ok, combos: [{ categoria: " ", regimen: "PC" }] }, "combo_invalido"], ["régimen largo", { ...ok, combos: [{ categoria: "E", regimen: "x".repeat(121) }] }, "combo_invalido"],
    ["elemento nulo", { ...ok, combos: [null] }, "combo_invalido"],
    ["bloqueo sin origen", { ...ok, bloqueoId: null }, "origen_ausente_bloqueo"], ["dinámico sin salida", { ...ok, modulo: "dinamico", bloqueoId: null }, "salida_ausente_dinamico"],
    ["porción sin fechas", { ...ok, modulo: "porcion_terrestre", bloqueoId: null }, "fechas_invalidas"],
  ];
  for (const [nombre, entrada, codigo] of casos) {
    test(`${nombre} → ${codigo}`, async () => {
      const v = Entrada.validarEntradaTarjeta(entrada);
      assert.equal(v.ok, false);
      if (!v.ok) assert.equal(v.codigo, codigo);
      const logs: string[] = []; const prev = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
      const lecturas: string[] = [];
      const c = cliente({ usuarios: [] }, { lecturas });
      adminActual = c.sb; sbServidor = c.sb;
      try {
        const r = await cotizarTarjetaHotel(entrada);
        assert.equal(r.ok, false);
        assert.deepEqual(lecturas.filter((x) => x !== "usuarios"), [], "no toca tarifas");
      } finally { console.error = prev; adminActual = null; sbServidor = null; }
      assert.ok(logs.some((l) => l.includes(`entrada_rechazada codigo=${codigo}`)), `registro con el código: ${logs.join(" | ")}`);
      assert.ok(!logs.some((l) => /Estándar|xxxxxxxx/.test(l)), "el registro nunca copia valores de la entrada");
    });
  }
  test("justo en el límite pasa la validación; uno más se rechaza", () => {
    const m = Entrada.MAX_COMBOS_TARJETA;
    assert.equal(Entrada.validarEntradaTarjeta({ ...ok, combos: combosN(m) }).ok, true);
    const e = Entrada.validarEntradaTarjeta({ ...ok, combos: [...combosN(m), { categoria: "X", regimen: "Y" }] });
    assert.equal(e.ok, false);
    if (!e.ok) assert.equal(e.codigo, "combos_exceden_limite");
  });
});
