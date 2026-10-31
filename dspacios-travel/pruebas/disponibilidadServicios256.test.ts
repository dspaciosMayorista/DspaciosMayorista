import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// 256 — DISPONIBILIDAD POR FECHA/SALIDA. EJECUCIÓN REAL de generarTarifario() (Server Action con cliente falso) con los casos de aceptación del encargo:
//   · servicio 112 del paquete 73: vigencia válida hasta una fecha y 16 salidas posteriores sin cobertura (+ una TEMP con fechas invertidas que NO cuenta);
//   · servicio 50 del paquete 33: 4 de 16 salidas con cobertura (12 sin ella);
//   · asistencia incluida sin vigencias (servicios 1 y 131).
// Regla: un opcional sin vigencia no se ofrece (o solo en sus tramos) y NO tumba el paquete; un incluido sin vigencia impide publicar SOLO las salidas afectadas
// (nunca se publica una salida omitiendo el servicio); sin ninguna salida vendible el paquete se publica vacío con diagnóstico, sin marcar la generación fallida.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;
type Rpc = { nombre: string; args: Record<string, unknown> };

function cliente(tablas: Tablas) {
  const rpcs: Rpc[] = [];
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
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (tablas[tabla] === undefined) throw new Error(`fixture incompleto: falta la tabla "${tabla}"`);
      const filas = tablas[tabla].filter((r) => filtros.every((f) => f(r)));
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  async function rpc(nombre: string, args: Record<string, unknown>) {
    rpcs.push({ nombre, args });
    if (nombre === "iniciar_generacion_tarifario") return { data: [{ generacion: 3, revision_capturada: 5 }], error: null };
    if (nombre === "publicar_tarifario_resultado") return { data: true, error: null };
    if (nombre === "registrar_diagnostico_tarifario") return { data: true, error: null };
    return { data: null, error: null };
  }
  return { sb: { from, rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) } }, rpcs };
}

let sbServidor: unknown = null;
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { throw new Error("admin no preparado"); } } });
mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => { if (sbServidor == null) throw new Error("createClient() real NUNCA debe invocarse aquí"); return sbServidor; } },
});
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");

const PAQUETE_ID = 73;
const HOTEL = 1;
const dia = (n: number) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const VENTANA = { desde: dia(30), hasta: dia(120) };

// categoria: 'asistencia' | 'tour_traslado' (por defecto); base = precio_persona del catálogo (tarifa base, SIN vigencia).
type Srv = { id: number; incluido?: boolean; nombre: string; categoria?: string; base?: number | null };
const armado = (s: Srv): Fila => ({
  paquete_id: PAQUETE_ID, servicio_id: s.id, modo: "persona", incluido: s.incluido ?? false,
  servicios_adicionales: { nombre: s.nombre, categoria: s.categoria ?? "tour_traslado", precio_persona: 99999, precio_infante: null, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: "COP" },
});
const vigencia = (servicio_id: number, nombre: string, ini: string, fin: string, precio: number): Fila => ({
  servicio_id, nombre, fecha_inicio: ini, fecha_fin: fin, compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: precio, precio_infante: null, recargo_individual: null,
});
const salida = (id: number, ida: number): Fila => ({
  id, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: dia(ida), fecha_regreso: dia(ida + 1), ruta: "BOG - CTG - BOG",
  valor_tiquete: 904000, aplica_mk: true, ta: 0, fee_infante: 80000,
});

function tablas(o: { servicios: Srv[]; vigencias?: Fila[]; salidas: Fila[] }): Tablas {
  return {
    armado_paquetes: [{
      id: PAQUETE_ID, nombre: "Dinámico 73", activo: true, destino_id: 1, pct_mk: 0.2, tipo: "dinamico", impuesto_tipo: "fijo", impuesto_fijo: 0, noches: 1,
      destinos: { nombre: "CARTAGENA" }, moneda_publicacion: "COP", fecha_viaje_inicio: VENTANA.desde, fecha_viaje_fin: VENTANA.hasta,
    }],
    armado_vuelos: [], armado_empaquetados: [],
    armado_servicios: o.servicios.map(armado),
    servicios_adicionales: o.servicios.map((x) => ({ id: x.id, categoria: x.categoria ?? "tour_traslado", precio_persona: x.base ?? null, precio_infante: null, recargo_individual: null })),
    servicio_temporadas: o.vigencias ?? [],
    servicio_tarifa_pax: [],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel", moneda: "COP", modelo_tarifario: "persona", adults_only: false } }],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null }],
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: "Estándar", alimentacion: "PC", temporada: "Base", neto_sencilla: null, neto_doble: 400000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false }],
    salidas_dinamicas: o.salidas,
  };
}

type FilaPub = { modulo: string; servicio_id: number | null; precio_pvp: number; fecha_ida?: string | null; fechas_disponibles?: unknown };
async function generar(t: Tablas) {
  const c = cliente(t);
  sbServidor = c.sb;
  const prev = console.error;
  console.error = () => {};
  try {
    const r = await generarTarifario(PAQUETE_ID);
    const pub = c.rpcs.find((x) => x.nombre === "publicar_tarifario_resultado");
    return { r, publicado: !!pub, filas: ((pub?.args.p_filas ?? []) as FilaPub[]), rpcs: c.rpcs };
  } finally { console.error = prev; sbServidor = null; }
}
const aviso = (g: { r: { ok: boolean; aviso?: string } }) => (g.r.ok ? (g.r.aviso ?? "") : "");
const fechasHotel = (g: { filas: FilaPub[] }) => [...new Set(g.filas.filter((f) => f.modulo === "dinamico").map((f) => f.fecha_ida))].sort();
const sinMarcaFallida = (g: { rpcs: Rpc[] }) => g.rpcs.every((x) => x.nombre !== "marcar_generacion_fallida");

// Regla (257 de producto, sin migración): un incluido SIN tarifa vigente en la fecha de una salida se OMITE de esa salida —no entra al PVP— y el hotel se publica igual.
// Los errores de configuración (franjas horarias, vigencias ambiguas) sí impiden publicar la salida. La asistencia médica sin vigencias usa su tarifa base permanente.
const pvpHotel = (g: { filas: FilaPub[] }, fecha: string) => g.filas.find((f) => f.modulo === "dinamico" && f.fecha_ida === fecha)!.precio_pvp;

describe("73/112: incluido con cobertura parcial → TODAS las salidas se publican; las no cubiertas, sin el servicio", () => {
  // Vigencia válida hasta dia(40); TEMP 2027 con fechas invertidas que NO cubre nada ni aporta tarifa. 3 salidas cubiertas y 16 posteriores sin cobertura (19).
  const cubiertas = [salida(1, 32), salida(2, 34), salida(3, 36)];
  const descubiertas = Array.from({ length: 16 }, (_, i) => salida(100 + i, 70 + i * 2));
  const base = () => tablas({
    servicios: [{ id: 112, incluido: true, nombre: "Servicio 112" }, { id: 1, incluido: false, nombre: "Asistencia 1", categoria: "asistencia", base: null }],
    vigencias: [vigencia(112, "TEMP. 2026", dia(0), dia(40), 87000), vigencia(112, "TEMP. 2027", dia(100), dia(99), 100000)],
    salidas: [...cubiertas, ...descubiertas],
  });

  test("las 19 salidas conservan la oferta del hotel; el aviso dice en cuántas se omitió el servicio; no se marca fallida", async () => {
    const g = await generar(base());
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fechasHotel(g).length, 19, "ninguna salida se pierde");
    assert.match(aviso(g), /Servicios incluidos omitidos por falta de tarifa vigente/);
    assert.match(aviso(g), /«Servicio 112» \(16 salida\(s\)/);
    assert.doesNotMatch(aviso(g), /no se publican|Sin oferta vendible/);
    assert.equal(sinMarcaFallida(g), true);
  });

  test("PVP: la salida cubierta incluye el servicio con la tarifa de SU vigencia (87.000, nunca la invertida); la descubierta es el hotel solo", async () => {
    const g = await generar(base());
    const sinServicio = await generar(tablas({ servicios: [], salidas: [cubiertas[0]] }));
    const solo = pvpHotel(sinServicio, dia(32));
    assert.ok(pvpHotel(g, dia(32)) > solo, "la cubierta lleva el servicio horneado");
    assert.equal(pvpHotel(g, dia(70)), solo, "la descubierta NO lleva el servicio: mismo precio que el hotel sin servicios");
    const con100 = await generar(tablas({ servicios: [{ id: 112, incluido: true, nombre: "Servicio 112" }], vigencias: [vigencia(112, "TEMP. 2026", dia(0), dia(40), 100000)], salidas: [cubiertas[0]] }));
    assert.ok(pvpHotel(con100, dia(32)) > pvpHotel(g, dia(32)), "con 100.000 sería más caro: 87.000 es el que manda");
  });

  test("el diagnóstico se registra para ESA generación con el servicio omitido; la asistencia opcional sin base no se ofrece", async () => {
    const g = await generar(base());
    const d = g.rpcs.find((x) => x.nombre === "registrar_diagnostico_tarifario");
    assert.ok(d);
    assert.equal(d?.args.p_generacion, 3);
    assert.match(String(d?.args.p_diagnostico), /Servicio 112/);
    assert.equal(g.filas.some((f) => f.servicio_id === 1), false);
  });

  test("publicación repetida (reintento): mismas filas, mismo diagnóstico", async () => {
    const a = await generar(base());
    const b = await generar(base());
    assert.deepEqual(a.filas, b.filas);
    assert.equal(aviso(a), aviso(b));
  });

  test("258: tras publicar registra la composición por fecha de ida (112 horneado solo en las 3 cubiertas), con la generación publicada y la regla vigente", async () => {
    const g = await generar(base());
    const rc = g.rpcs.find((x) => x.nombre === "registrar_composicion_publicada");
    assert.ok(rc, "registra la evidencia");
    assert.equal(rc?.args.p_generacion, 3);
    assert.equal(rc?.args.p_regla, 1);
    const filas = rc?.args.p_filas as { fecha_ida: string; servicios_incluidos: number[] }[];
    assert.equal(filas.length, 19);
    const por = new Map(filas.map((f) => [f.fecha_ida, f.servicios_incluidos]));
    for (const d of [32, 34, 36]) assert.deepEqual(por.get(dia(d)), [112], `salida cubierta ${d}: 112 horneado`);
    assert.deepEqual(por.get(dia(70)), [], "salida descubierta: sin servicios horneados");
    const orden = g.rpcs.map((x) => x.nombre);
    assert.ok(orden.indexOf("publicar_tarifario_resultado") < orden.indexOf("registrar_composicion_publicada"), "se registra DESPUÉS de publicar");
  });

  test("258: si el registro de la evidencia falla, la respuesta avisa que las reservas se rechazarán hasta regenerar (las filas quedan publicadas)", async () => {
    const c = cliente(base());
    const orig = c.sb.rpc;
    (c.sb as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> }).rpc = async (n: string, a: Record<string, unknown>) => (n === "registrar_composicion_publicada" ? { data: null, error: { message: "function does not exist" } } : orig(n, a));
    sbServidor = c.sb;
    const prev = console.error; console.error = () => {};
    try {
      const r = await generarTarifario(PAQUETE_ID);
      assert.equal(r.ok, true);
      assert.match(r.ok ? (r.aviso ?? "") : "", /composición publicada[\s\S]*migración 258[\s\S]*rechazarán/);
    } finally { console.error = prev; sbServidor = null; }
  });

  test("ninguna salida cubierta: igual se publica el hotel de TODAS (sin el servicio), no un paquete vacío", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 112, incluido: true, nombre: "Servicio 112" }],
      vigencias: [vigencia(112, "TEMP. 2026", dia(0), dia(10), 87000)],
      salidas: Array.from({ length: 16 }, (_, i) => salida(200 + i, 60 + i)),
    }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fechasHotel(g).length, 16);
    assert.match(aviso(g), /«Servicio 112» \(16 salida\(s\)/);
    assert.doesNotMatch(aviso(g), /Sin oferta vendible/);
  });
});

describe("33/50: incluido con cobertura parcial + asistencia 1 incluida", () => {
  const cubiertas = [salida(1, 32), salida(2, 34), salida(3, 36), salida(4, 38)]; // inventario del 33: 4 de 16 salidas con cobertura del 50 (fixture, no dato de producción)
  const salidas33 = () => [...cubiertas, ...Array.from({ length: 12 }, (_, i) => salida(300 + i, 75 + i))];
  const vig50 = () => [vigencia(50, "TEMP", dia(0), dia(60), 50000)];
  test("con la asistencia permanente (categoría asistencia, base, sin vigencias): 16 salidas; el 50 solo en las 4 cubiertas; la asistencia en todas", async () => {
    const con = await generar(tablas({
      servicios: [{ id: 50, incluido: true, nombre: "Servicio 50" }, { id: 1, incluido: true, nombre: "Asistencia 1", categoria: "asistencia", base: 20000 }],
      vigencias: vig50(), salidas: salidas33(),
    }));
    const soloAsist = await generar(tablas({ servicios: [{ id: 1, incluido: true, nombre: "Asistencia 1", categoria: "asistencia", base: 20000 }], salidas: [cubiertas[0]] }));
    assert.equal(con.r.ok, true, con.r.ok ? "" : con.r.error);
    assert.equal(fechasHotel(con).length, 16);
    assert.match(aviso(con), /«Servicio 50» \(12 salida\(s\)/);
    assert.doesNotMatch(aviso(con), /Asistencia 1»/, "la asistencia permanente nunca se omite");
    assert.ok(pvpHotel(con, dia(32)) > pvpHotel(soloAsist, dia(32)), "en la cubierta están el 50 y la asistencia");
    assert.equal(pvpHotel(con, dia(75)), pvpHotel(soloAsist, dia(32)), "en la descubierta solo queda la asistencia (permanente)");
  });
  test("asistencia incluida SIN base válida ni vigencias: no hay tarifa → se omite (el hotel se publica sin ella)", async () => {
    const g = await generar(tablas({ servicios: [{ id: 1, incluido: true, nombre: "Asistencia 1", categoria: "asistencia", base: null }], salidas: [salida(1, 40)] }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.deepEqual(fechasHotel(g), [dia(40)]);
    assert.match(aviso(g), /«Asistencia 1»/);
  });
  test("asistencia incluida CON vigencias respeta solo sus vigencias: la base no rellena el hueco (se omite en las salidas descubiertas)", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 1, incluido: true, nombre: "Asistencia 1", categoria: "asistencia", base: 20000 }],
      vigencias: [vigencia(1, "V", dia(0), dia(33), 20000)], salidas: salidas33(),
    }));
    const sinServ = await generar(tablas({ servicios: [], salidas: [cubiertas[0]] }));
    assert.equal(fechasHotel(g).length, 16);
    assert.match(aviso(g), /«Asistencia 1» \(15 salida\(s\)/);
    assert.equal(pvpHotel(g, dia(36)), pvpHotel(sinServ, dia(32)), "fuera de su vigencia: hotel solo, sin rellenar con la base");
  });
  test("una vigencia INVERTIDA cuenta como tener vigencias: la base tampoco aplica (se omite)", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 1, incluido: true, nombre: "Asistencia 1", categoria: "asistencia", base: 20000 }],
      vigencias: [vigencia(1, "INV", dia(100), dia(99), 20000)], salidas: [salida(1, 40)],
    }));
    assert.deepEqual(fechasHotel(g), [dia(40)]);
    assert.match(aviso(g), /«Asistencia 1»/);
  });
});

describe("36/133 y 70/132: traslados incluidos (no asistencia)", () => {
  const dieciseis = () => Array.from({ length: 16 }, (_, i) => salida(500 + i, 40 + i)); // inventario: 36 → 0 de 16 con cobertura del 133; 70 → 0 de 16 del 132 (fixtures, no datos de producción)
  test("70/132: 0 de 16 salidas con cobertura (su vigencia es posterior a todas): se omite en las 16 y el hotel se publica en las 16", async () => {
    const g = await generar(tablas({ servicios: [{ id: 132, incluido: true, nombre: "Traslado 132", categoria: "tour_traslado" }], vigencias: [vigencia(132, "V", dia(200), dia(260), 40000)], salidas: dieciseis() }));
    const solo = await generar(tablas({ servicios: [], salidas: [salida(1, 40)] }));
    assert.equal(fechasHotel(g).length, 16);
    assert.equal(pvpHotel(g, dia(40)), pvpHotel(solo, dia(40)));
    assert.match(aviso(g), /«Traslado 132» \(16 salida\(s\)/);
  });
  test("36/133: 0 de 16 salidas con cobertura (sin vigencias aunque tenga base): se omite en las 16; el hotel se publica", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 133, incluido: true, nombre: "Traslado 133", categoria: "tour_traslado", base: 30000 }], salidas: dieciseis(),
    }));
    const solo = await generar(tablas({ servicios: [], salidas: [salida(1, 40)] }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fechasHotel(g).length, 16);
    assert.equal(pvpHotel(g, dia(40)), pvpHotel(solo, dia(40)), "sin la base GENERAL horneada");
    assert.match(aviso(g), /«Traslado 133» \(16 salida\(s\)/);
  });
  test("132 con vigencia que cubre una salida y no la otra: la cubierta lo lleva, la otra no", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 132, incluido: true, nombre: "Traslado 132", categoria: "tour_traslado" }],
      vigencias: [vigencia(132, "V", dia(0), dia(45), 40000)], salidas: [salida(1, 40), salida(2, 60)],
    }));
    const solo = await generar(tablas({ servicios: [], salidas: [salida(1, 40)] }));
    assert.equal(fechasHotel(g).length, 2);
    assert.ok(pvpHotel(g, dia(40)) > pvpHotel(solo, dia(40)));
    assert.equal(pvpHotel(g, dia(60)), pvpHotel(solo, dia(40)));
  });
  test("un incluido con FRANJAS horarias es un error de configuración: la salida no se publica (no se omite en silencio)", async () => {
    const conFranja = { ...vigencia(132, "V", dia(0), dia(100), 40000), servicio_suplementos_franja: [{ id: 1, hora_desde: "20:00", hora_hasta: "23:59", tramo: "ida", tipo: "fijo", valor: 10000, cobro: "por_servicio" }] };
    const g = await generar(tablas({ servicios: [{ id: 132, incluido: true, nombre: "Traslado 132", categoria: "tour_traslado" }], vigencias: [conFranja], salidas: [salida(1, 40)] }));
    assert.deepEqual(g.filas, []);
    assert.match(aviso(g), /Sin oferta vendible/);
    assert.match(aviso(g), /Traslado 132/);
  });
});

describe("dato corrupto en un incluido: no se hornea un precio NaN ni se publica la salida (error de configuración, no omisión)", () => {
  test("precio de infante no numérico: la salida NO se publica y el aviso lo explica; el cero válido (infante gratis) sí se publica", async () => {
    const corrupta = { ...vigencia(50, "V", dia(0), dia(100), 50000), precio_infante: Number.NaN };
    const g = await generar(tablas({ servicios: [{ id: 50, incluido: true, nombre: "Servicio 50" }], vigencias: [corrupta], salidas: [salida(1, 40)] }));
    assert.deepEqual(g.filas, []);
    assert.match(aviso(g), /precio de infante no válido/);
    const gratis = { ...vigencia(50, "V", dia(0), dia(100), 50000), precio_infante: 0 };
    const ok = await generar(tablas({ servicios: [{ id: 50, incluido: true, nombre: "Servicio 50" }], vigencias: [gratis], salidas: [salida(1, 40)] }));
    assert.equal(fechasHotel(ok).length, 1, "el infante gratis (0) es un dato válido");
    assert.ok(ok.filas.every((f) => Number.isFinite(f.precio_pvp)), "ningún PVP NaN");
  });
});

describe("opcionales: se ofrecen solo donde hay vigencia y tarifa válidas; no tumban el paquete", () => {
  test("opcional sin vigencia: no se ofrece, el hotel y las salidas se publican, el aviso lo explica", async () => {
    const g = await generar(tablas({ servicios: [{ id: 7, nombre: "Tour sin vigencia" }], salidas: [salida(1, 40)] }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.filas.some((f) => f.servicio_id === 7), false);
    assert.deepEqual(fechasHotel(g), [dia(40)]);
    assert.match(aviso(g), /Tour sin vigencia/);
  });

  test("opcional con vigencia solo en parte del viaje: fila con los tramos disponibles (jamás todo el viaje)", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 7, nombre: "Tour parcial" }],
      vigencias: [vigencia(7, "A", dia(30), dia(50), 100000), vigencia(7, "B", dia(70), dia(80), 120000)],
      salidas: [salida(1, 40)],
    }));
    const fila = g.filas.find((f) => f.servicio_id === 7);
    assert.deepEqual(fila?.fechas_disponibles, [{ desde: dia(30), hasta: dia(50) }, { desde: dia(70), hasta: dia(80) }]);
    assert.match(aviso(g), /Tour parcial» solo/);
  });

  test("opcional con vigencia en todo el viaje: fechas_disponibles = null (todas las fechas)", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 7, nombre: "Tour completo" }],
      vigencias: [vigencia(7, "A", dia(0), dia(200), 100000)], salidas: [salida(1, 40)],
    }));
    const fila = g.filas.find((f) => f.servicio_id === 7);
    assert.ok(fila);
    assert.equal(fila?.fechas_disponibles ?? null, null);
  });

  test("opcional con vigencia INVERTIDA: no hay tarifa válida, no se ofrece", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 7, nombre: "Tour invertido" }],
      vigencias: [vigencia(7, "TEMP. 2027", dia(100), dia(99), 100000)], salidas: [salida(1, 40)],
    }));
    assert.equal(g.filas.some((f) => f.servicio_id === 7), false);
    assert.match(aviso(g), /Tour invertido/);
  });
});

describe("cableado: el publicador y la lectura usan las columnas de la 256", () => {
  test("la acción registra el diagnóstico con la RPC y los tipos conocen las columnas nuevas", async () => {
    const { readFileSync } = await import("node:fs");
    const act = readFileSync(new URL("../app/(dashboard)/dashboard/paquetes/actions.ts", import.meta.url), "utf8");
    assert.match(act, /registrar_diagnostico_tarifario/);
    assert.match(act, /fechas_disponibles: tramosDisponibles/);
    assert.doesNotMatch(act, /erroresVigencia/, "ya no existe el camino que tumbaba toda la generación");
    const tipos = readFileSync(new URL("../types/database.ts", import.meta.url), "utf8");
    assert.match(tipos, /fechas_disponibles/);
    assert.match(tipos, /tarifario_diagnostico/);
  });
});
