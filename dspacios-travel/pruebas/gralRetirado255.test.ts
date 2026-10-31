import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// 255 — RETIRO DE LA TARIFA «GENERAL» COMO FUENTE DE PRECIO. EJECUCIÓN REAL de generarTarifario() (Server Action con cliente falso) y de la cadena
// publicación → cotización → costo. Cada caso describe el DEFECTO anterior (se publicaba/vendía con el precio base GENERAL aunque no hubiera vigencia o rango)
// y el arreglo: lo que se publica es lo que luego se puede cotizar. Desde la 256 la falta de vigencia ya no tumba la generación del paquete: el opcional
// afectado no se ofrece (o solo en sus tramos) y el incluido afectado impide publicar solo esa salida; el diagnóstico dice por qué (ver disponibilidadServicios256).

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
const { redondearVenta, marcar } = await import("../lib/calc/paquetes.ts");
const { construirContextoServicios, calcularResultadoServicio, separarFranjas } = await import("../lib/reservar/liquidacionServicio.ts");
import type { FilaTemporadaConFranjas } from "../lib/reservar/liquidacionServicio.ts";
const { costoNetoServicio } = await import("../lib/calc/servicioTarifa.ts");

const PAQUETE_ID = 255;
const HOTEL = 1;
const dia = (n: number) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const IDA = dia(30);
const REG = dia(31);
const VENTANA = { desde: dia(30), hasta: dia(60) };

type Srv = { id: number; incluido?: boolean; modo?: "persona" | "grupo"; nombre?: string; precio: number | null; infante?: number | null };
const armado = (s: Srv): Fila => ({
  paquete_id: PAQUETE_ID, servicio_id: s.id, modo: s.modo ?? "persona", incluido: s.incluido ?? false,
  servicios_adicionales: { nombre: s.nombre ?? `Servicio ${s.id}`, precio_persona: s.precio, precio_infante: s.infante ?? null, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: "COP" },
});
const vigencia = (servicio_id: number, nombre: string, ini: string, fin: string, extra: Fila = {}): Fila => ({
  servicio_id, nombre, fecha_inicio: ini, fecha_fin: fin, compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: null, precio_infante: null, recargo_individual: null, ...extra,
});

function tablas(o: { servicios: Srv[]; vigencias?: Fila[]; rangos?: Fila[]; ventana?: { desde: string; hasta: string } | null }): Tablas {
  return {
    armado_paquetes: [{
      id: PAQUETE_ID, nombre: "Dinámico 255", activo: true, destino_id: 1, pct_mk: 0.2, tipo: "dinamico", impuesto_tipo: "fijo", impuesto_fijo: 0, noches: 1,
      destinos: { nombre: "CARTAGENA" }, moneda_publicacion: "COP",
      fecha_viaje_inicio: o.ventana === undefined ? VENTANA.desde : (o.ventana?.desde ?? null), fecha_viaje_fin: o.ventana === undefined ? VENTANA.hasta : (o.ventana?.hasta ?? null),
    }],
    armado_vuelos: [], armado_empaquetados: [],
    armado_servicios: o.servicios.map(armado),
    // Catálogo (lo lee la tarifa base permanente: solo la categoría «asistencia» sin vigencias la usa; estos servicios son tours/traslados).
    servicios_adicionales: o.servicios.map((s) => ({ id: s.id, categoria: "tour_traslado", precio_persona: s.precio, precio_infante: s.infante ?? null, recargo_individual: null })),
    servicio_temporadas: o.vigencias ?? [],
    servicio_tarifa_pax: o.rangos ?? [],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel", moneda: "COP", modelo_tarifario: "persona", adults_only: false } }],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null }],
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: "Estándar", alimentacion: "PC", temporada: "Base", neto_sencilla: null, neto_doble: 400000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false }],
    salidas_dinamicas: [{ id: 9, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", valor_tiquete: 904000, aplica_mk: true, ta: 0, fee_infante: 80000 }],
  };
}

type FilaPub = { modulo: string; servicio_id: number | null; tipo_tarifa: string | null; precio_pvp: number; pax_desde?: number | null; pax_hasta?: number | null; descripcion?: string | null };
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

describe("publicación (generarTarifario): sin vigencia o rango NO se publica un precio que luego no se pueda cotizar", () => {
  test("DEFECTO: servicio opcional con SOLO tarifa GENERAL se publicaba. AHORA no se ofrece (sin precio GENERAL), el resto del paquete se publica y el aviso dice por qué", async () => {
    const g = await generar(tablas({ servicios: [{ id: 21, nombre: "Tour solo general", precio: 80000 }] }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.filas.some((f) => f.servicio_id === 21), false, "ninguna fila del servicio: no se publica con el precio GENERAL");
    assert.ok(g.filas.some((f) => f.modulo === "dinamico"), "el hotel del paquete sí se publica");
    assert.match(g.r.ok ? (g.r.aviso ?? "") : "", /Tour solo general/);
    assert.match(g.r.ok ? (g.r.aviso ?? "") : "", /vigencia/i);
    assert.doesNotMatch(g.r.ok ? (g.r.aviso ?? "") : "", /statement|postgres|undefined/i);
  });

  test("DEFECTO: servicio INCLUIDO sin vigencia se horneaba con el precio GENERAL en el hotel. AHORA se omite (sin precio GENERAL horneado) y el hotel se publica igual, con diagnóstico", async () => {
    const g = await generar(tablas({ servicios: [{ id: 22, incluido: true, nombre: "Seguro incluido", precio: 30000 }] }));
    const sin = await generar(tablas({ servicios: [] }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.ok(g.filas.length > 0, "la oferta del hotel se conserva");
    assert.deepEqual(g.filas.map((f) => f.precio_pvp), sin.filas.map((f) => f.precio_pvp), "el precio es el del hotel solo: los 30.000 GENERAL no se hornean");
    assert.doesNotMatch(g.r.ok ? (g.r.aviso ?? "") : "", /Sin oferta vendible/);
    assert.match(g.r.ok ? (g.r.aviso ?? "") : "", /Seguro incluido/);
  });

  test("vigencia que no cubre TODO el viaje del paquete: el opcional se ofrece SOLO en el tramo cubierto", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 21, nombre: "Tour corto", precio: 80000 }],
      vigencias: [vigencia(21, "TEMP", VENTANA.desde, dia(40), { precio_persona: 80000 })],
    }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    const fila = g.filas.find((f) => f.servicio_id === 21) as (FilaPub & { fechas_disponibles?: unknown }) | undefined;
    assert.deepEqual(fila?.fechas_disponibles, [{ desde: VENTANA.desde, hasta: dia(40) }]);
    assert.match(g.r.ok ? (g.r.aviso ?? "") : "", /disponibilidad parcial/);
  });

  test("con vigencia: publica el precio de la VIGENCIA con el margen (no el precio base del servicio)", async () => {
    // El precio base GENERAL del servicio (80.000) NO cuenta: la vigencia dice 100.000 => 100.000 / 0,8 = 125.000.
    const g = await generar(tablas({
      servicios: [{ id: 21, nombre: "Tour", precio: 80000 }],
      vigencias: [vigencia(21, "TEMP", VENTANA.desde, VENTANA.hasta, { precio_persona: 100000 })],
    }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    const fila = g.filas.find((f) => f.modulo === "servicios" && f.servicio_id === 21);
    assert.equal(fila?.precio_pvp, 125000);
  });

  test("entre varias vigencias del viaje se publica la de MENOR neto («desde»)", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 21, precio: null }],
      vigencias: [
        vigencia(21, "BAJA", VENTANA.desde, dia(45), { precio_persona: 80000, prioridad: 1 }),
        vigencia(21, "ALTA", dia(46), VENTANA.hasta, { precio_persona: 120000, prioridad: 1 }),
      ],
    }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.filas.find((f) => f.servicio_id === 21)?.precio_pvp, 100000);
  });

  test("servicio por GRUPO: publica los rangos de la vigencia, jamás los GENERAL; rangos distintos entre vigencias del viaje => falla", async () => {
    const rangosGeneral = [{ servicio_id: 31, pax_desde: 1, pax_hasta: 50, precio: 1000, temporada: "GENERAL" }];
    const ok = await generar(tablas({
      servicios: [{ id: 31, modo: "grupo", precio: null, nombre: "Traslado grupo" }],
      vigencias: [vigencia(31, "TEMP", VENTANA.desde, VENTANA.hasta)],
      rangos: [...rangosGeneral, { servicio_id: 31, pax_desde: 1, pax_hasta: 4, precio: 200000, temporada: "TEMP" }, { servicio_id: 31, pax_desde: 5, pax_hasta: 8, precio: 320000, temporada: "TEMP" }],
    }));
    assert.equal(ok.r.ok, true, ok.r.ok ? "" : ok.r.error);
    const filas = ok.filas.filter((f) => f.servicio_id === 31);
    assert.deepEqual(filas.map((f) => [f.pax_desde, f.pax_hasta, f.precio_pvp]), [[1, 4, 250000], [5, 8, 400000]]);

    const mal = await generar(tablas({
      servicios: [{ id: 31, modo: "grupo", precio: null, nombre: "Traslado grupo" }],
      vigencias: [vigencia(31, "A", VENTANA.desde, dia(45)), vigencia(31, "B", dia(46), VENTANA.hasta)],
      rangos: [
        { servicio_id: 31, pax_desde: 1, pax_hasta: 4, precio: 200000, temporada: "A" },
        { servicio_id: 31, pax_desde: 1, pax_hasta: 6, precio: 260000, temporada: "B" },
      ],
    }));
    assert.equal(mal.r.ok, true, mal.r.ok ? "" : mal.r.error);
    assert.equal(mal.filas.some((f) => f.servicio_id === 31), false, "con rangos incompatibles entre vigencias no se publica ningún precio");
    assert.match(mal.r.ok ? (mal.r.aviso ?? "") : "", /rangos de pasajeros distintos/);
  });

  test("servicio por grupo con vigencia pero SIN rangos propios (solo GENERAL): no se ofrece", async () => {
    const g = await generar(tablas({
      servicios: [{ id: 31, modo: "grupo", precio: null, nombre: "Traslado grupo" }],
      vigencias: [vigencia(31, "TEMP", VENTANA.desde, VENTANA.hasta)],
      rangos: [{ servicio_id: 31, pax_desde: 1, pax_hasta: 8, precio: 200000, temporada: "GENERAL" }],
    }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.filas.some((f) => f.servicio_id === 31), false);
    assert.match(g.r.ok ? (g.r.aviso ?? "") : "", /no tiene rangos de pasajeros/);
  });

  test("traslado con franjas: se publica el precio BASE avisando que falta el recargo por horario; incluido con franjas deja la salida sin publicar", async () => {
    const franja = [{ id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 40000, cobro: "grupo" }];
    const opc = await generar(tablas({
      servicios: [{ id: 41, nombre: "Traslado aeropuerto", precio: null }],
      vigencias: [vigencia(41, "TEMP", VENTANA.desde, VENTANA.hasta, { precio_persona: 50000, servicio_suplementos_franja: franja })],
    }));
    assert.equal(opc.r.ok, true, opc.r.ok ? "" : opc.r.error);
    assert.equal(opc.filas.find((f) => f.servicio_id === 41)?.precio_pvp, 63000); // 50.000 / 0,8 = 62.500 -> al mil
    assert.match(opc.filas.find((f) => f.servicio_id === 41)?.descripcion ?? "", /Precio base/);
    const inc = await generar(tablas({
      servicios: [{ id: 41, incluido: true, nombre: "Traslado aeropuerto", precio: null }],
      vigencias: [vigencia(41, "TEMP", IDA, VENTANA.hasta, { precio_persona: 50000, servicio_suplementos_franja: franja })],
    }));
    assert.equal(inc.r.ok, true, inc.r.ok ? "" : inc.r.error);
    assert.equal(inc.filas.length, 0, "un traslado con franjas no puede ir incluido: la salida no se publica");
    assert.match(inc.r.ok ? (inc.r.aviso ?? "") : "", /no puede ir incluido/);
  });

  test("la falta de vigencia ya no marca la generación como fallida: se publica y el diagnóstico se registra para ESA generación", async () => {
    const g = await generar(tablas({ servicios: [{ id: 21, nombre: "Tour solo general", precio: 80000 }] }));
    assert.equal(g.rpcs.some((x) => x.nombre === "marcar_generacion_fallida"), false);
    const diag = g.rpcs.find((x) => x.nombre === "registrar_diagnostico_tarifario");
    assert.ok(diag, "se registra el diagnóstico");
    assert.match(String(diag?.args.p_diagnostico), /Tour solo general/);
    assert.equal(diag?.args.p_generacion, 3);
  });
});

describe("publicado == cotizado == costeado (mismo suplemento neto y mismo margen)", () => {
  test("el precio publicado de la vigencia, la cotización en vivo y el costo/CxP salen de la misma aritmética", async () => {
    const franja = { id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos" as const, tipo: "monto" as const, valor: 40000, cobro: "grupo" as const };
    const vig = vigencia(51, "TEMP", VENTANA.desde, VENTANA.hasta, { id: 7, precio_persona: 90000 });
    const g = await generar(tablas({ servicios: [{ id: 51, precio: null }], vigencias: [{ ...vig }] }));
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    const publicado = g.filas.find((f) => f.servicio_id === 51)!.precio_pvp; // 90.000 × 1 pax… precio por persona
    // Cotización en vivo para 1 pax SIN franjas: coincide con lo publicado (misma vigencia, mismo margen).
    const ctxSinFranja = construirContextoServicios({
      paquetes: [{ id: PAQUETE_ID, pct_mk: 0.2 }], armado: [{ paquete_id: PAQUETE_ID, servicio_id: 51, modo: "persona" }],
      servicios: [{ id: 51, precio_persona: null, recargo_individual: null, liquidacion: "paquete", moneda: "COP" }], grupos: [], temporadas: [vig as never],
    });
    const par = { servicioId: 51, paqueteId: PAQUETE_ID, nombre: "S", destino: null, descripcion: null };
    const cotizado = calcularResultadoServicio(par, ctxSinFranja, new Date(`${IDA}T00:00:00`), 1, 1);
    assert.equal(cotizado?.total, publicado, "publicado por persona == cotizado para 1 pax");
    assert.equal(publicado, redondearVenta(marcar(90000, 0.2), "COP"));

    // Con franja y hora nocturna: venta y costo suman el MISMO suplemento neto (40.000) antes del margen.
    const { temporadas, franjas } = separarFranjas([{ ...(vig as unknown as FilaTemporadaConFranjas), id: 7, servicio_suplementos_franja: [franja] }]);
    const ctx = construirContextoServicios({
      paquetes: [{ id: PAQUETE_ID, pct_mk: 0.2 }], armado: [{ paquete_id: PAQUETE_ID, servicio_id: 51, modo: "persona" }],
      servicios: [{ id: 51, precio_persona: null, recargo_individual: null, liquidacion: "paquete", moneda: "COP" }], grupos: [], temporadas, franjas,
    });
    const horas = { llegada: "21:00", salida: "10:00" };
    const venta = calcularResultadoServicio(par, ctx, new Date(`${IDA}T00:00:00`), 1, 2, horas);
    const costo = costoNetoServicio({
      temporadas: temporadas as never, grupos: [], franjasPorTemporada: new Map([["TEMP", [franja]]]), modo: "persona", pax: 2, fecha: new Date(`${IDA}T00:00:00`), liquidacion: "paquete", numNoches: 1, horas,
    });
    assert.ok(costo.ok && venta);
    assert.equal(costo.ok && costo.netoSuplementos, 40000);
    assert.equal(costo.ok && costo.costoNeto, 90000 * 2 + 40000);
    assert.equal(venta.total, redondearVenta(marcar(220000, 0.2), "COP"), "venta = (neto + suplemento) con el margen del paquete");
    assert.deepEqual(venta.suplementos, [{ tramo: "llegada", hora: "21:00" }]);
  });
});
