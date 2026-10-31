// #90 H — AUDITORÍA del flujo integrado comercial tras el PR #398. Pruebas LOCALES con datos simulados: no crea contratos, reservas ni pagos reales ni toca SQL remoto.
// Recorre el checkout público (B2C, SIN sesión) → cotización guardada → conversión por un usuario interno, y verifica moneda, TRM, importes, proveedor, pasajeros y CxP.
// Arnés idéntico al de cobroCarritoConversion.test.ts (clientes en memoria, motor de reserva simulado) + registro de los argumentos de las RPC.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import nodeModule from "node:module";

// "server-only" (no instalado fuera del bundler de Next) y "next/cache" (sin
// mapa de exports resoluble por el ESM de Node) se sirven como módulos
// mínimos SOLO en esta prueba — mismo patrón que
// pruebas/fechaNegocioAbonoReciboAsiento.react.ts.
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service";

// ── Base en memoria y clientes simulados ─────────────────────────────────
type Fila = Record<string, unknown>;
const db: Record<string, Fila[]> = {};
const rpcLog: { fn: string; args: unknown }[] = [];
let usuario: { id: string; email: string } | null = null;
const CATALOGO_SERVICIO: Record<number, Fila> = {
  9: { id: 9, proveedores: { nombre: "Asistencias SA", aplica_retencion: false, pct_retencion: 0 } },
  12: { id: 12, proveedores: { nombre: "Traslados Caribe", aplica_retencion: false, pct_retencion: 0 } },
};

function cliente() {
  const from = (tabla: string) => {
    const filtros: [string, "eq" | "in", unknown][] = [];
    let op: "select" | "insert" | "update" = "select";
    let insertadas: Fila[] = [];
    let patch: Fila = {};
    const coincide = (f: Fila) => filtros.every(([k, o, v]) => (o === "eq" ? f[k] === v : (v as unknown[]).includes(f[k])));
    const leer = (): Fila[] => {
      if (tabla === "servicios_adicionales") return Object.values(CATALOGO_SERVICIO).filter(coincide);
      if (tabla === "hoteles") return [{ id: 1, proveedores: { nombre: "Proveedor Hotel", aplica_retencion: false, pct_retencion: 0 } }].filter(coincide);
      return (db[tabla] ?? []).filter(coincide);
    };
    const resolver = () => {
      if (op === "insert") return { data: insertadas, error: null };
      if (op === "update") { for (const f of db[tabla] ?? []) if (coincide(f)) Object.assign(f, patch); return { data: null, error: null }; }
      return { data: leer(), error: null };
    };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, order: () => b, limit: () => b,
      eq: (k: string, v: unknown) => { filtros.push([k, "eq", v]); return b; },
      in: (k: string, v: unknown[]) => { filtros.push([k, "in", v]); return b; },
      insert: (filas: Fila | Fila[]) => {
        op = "insert";
        insertadas = (Array.isArray(filas) ? filas : [filas]).map((f) =>
          tabla === "cotizaciones" ? { id: 77, codigo: "COT-77", share_token: "tok", estado: "abierta", numero_contrato: null, ...f } : { ...f });
        (db[tabla] ??= []).push(...insertadas);
        return b;
      },
      update: (p: Fila) => { op = "update"; patch = p; return b; },
      maybeSingle: async () => ({ data: leer()[0] ?? null, error: null }),
      single: async () => ({ data: insertadas[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
    });
    return b;
  };
  return {
    from,
    auth: { getUser: async () => ({ data: { user: usuario }, error: null }) },
    rpc: async (fn: string, args: { p_pasajeros?: unknown[] }) => {
      rpcLog.push({ fn, args });
      if (fn === "fecha_referencia_servidor") return { data: "2026-10-11", error: null };
      if (fn === "crear_pasajeros_contrato_multi_con_sillas") return { data: (args.p_pasajeros ?? []).map((_, i) => ({ id: i + 1, orden: i })), error: null };
      return { data: null, error: { message: `rpc no simulado: ${fn}` } };
    },
  };
}

// ── Motor de reserva simulado, por hotel ─────────────────────────────────
type Incluido = { servicioId: number; nombre: string; categoria: "asistencia" | "tour_traslado" | "otro"; incluido: true; costoNeto: number; proveedorId: number | null };
type HotelSim = { nombre: string; moneda: string; pvp: number; neto: number; cargoGrupo: number; incluidos: Incluido[] };
let HOTELES: Record<number, HotelSim> = {};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number }) => {
      const h = HOTELES[r.hotelId];
      return {
        ok: true,
        data: {
          meta: { hotel_nombre: h.nombre, destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
          precioVenta: h.pvp * 2 + h.cargoGrupo, monedaReserva: h.moneda,
          lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: h.pvp }], pvpPorAcom: { doble: h.pvp }, netoPorAcom: { doble: h.neto },
          numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: 2, paxConSilla: 2, edadesMenoresUsadas: [],
          serviciosIncluidos: h.incluidos, distribucionMenores: [], condicionesTarifa: null,
        },
      };
    },
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no se usa" }),
    cotizarPorFechas: async () => { throw new Error("no se usa"); },
    buscarHoteles: async () => { throw new Error("no se usa"); },
    buscarReceptivos: async () => { throw new Error("no se usa"); },
  },
});
type CxP = { tipo_proveedor: string; servicio: string; valor_total: number; proveedor: string | null; servicio_id: number | null };
const financieros: { cxp: CxP[]; costos: Fila }[] = [];
let llamadasNumeracion = 0;
let fallarFinancieroEnLaLlamada: number | null = null; // 1-based, entre las llamadas a registrarFinancieroContrato
mock.module("@/lib/reservar/financieroContrato", {
  namedExports: {
    registrarFinancieroContrato: async (_deps: unknown, a: { cxp: CxP[]; costos: Fila; numeroContrato: string }) => {
      if (fallarFinancieroEnLaLlamada != null && financieros.length + 1 === fallarFinancieroEnLaLlamada) {
        // La función real YA revierte el contrato incompleto antes de devolver el error: el arnés lo replica.
        db.ventas = (db.ventas ?? []).filter((v) => v.numero_contrato !== a.numeroContrato);
        return { ok: false, error: "corte simulado del financiero" };
      }
      financieros.push({ cxp: a.cxp, costos: a.costos });
      return { ok: true };
    },
    revertirContratoIncompleto: async (_deps: unknown, numero: string) => { db.ventas = (db.ventas ?? []).filter((v) => v.numero_contrato !== numero); return { ok: true }; },
  },
});
mock.module("@/lib/contabilidad/asientos", { namedExports: { postearAsientoCxP: async () => ({ ok: true }), eliminarAsientoCxP: async () => ({ ok: true }) } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/asegurarCuentasPorPagar", { namedExports: { asegurarCuentasPorPagar: async () => ({ ok: true }) } });
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async () => ({ ok: true, numero: `DTM-${String(900 + llamadasNumeracion++).padStart(4, "0")}` }) } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true },
});
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: {
    componenteHotelReal: async () => null, componentePaqueteReal: async () => null,
    trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {},
  },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });

const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { totalVisibleContratoItems } = await import("../lib/contrato/valorContratoItem.ts");

const clienteCot = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
const item = (hotelId: number, paqueteId: number, destino = "CARTAGENA") => ({
  modulo: "porcion_terrestre", paqueteId, hotelId, bloqueoId: null, hotelNombre: HOTELES[hotelId].nombre, destino,
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
});
const pasajeros = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
];
const hotel = (nombre: string, moneda: string, pvp: number): HotelSim => ({ nombre, moneda, pvp, neto: Math.round(pvp * 0.7), cargoGrupo: 0, incluidos: [] });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  financieros.length = 0;
  rpcLog.length = 0;
  llamadasNumeracion = 0;
  fallarFinancieroEnLaLlamada = null;
  usuario = null;
});

type Resultado = { ok: boolean; error?: string; numeros?: string[] };
async function cotizar(items: unknown[]) {
  usuario = null; // checkout público (B2C)
  const r = await crearSolicitudReserva({ items, tours: [], cliente: clienteCot });
  assert.equal(r.ok, true, (r as { error?: string }).error);
  return db.cotizaciones[0];
}
/** Convierte como personal interno (rol `rol`) con la elección de cobro dada. `undefined` = se omite la clave. */
async function convertir(nItems: number, eleccion: { monedaCobro?: string | null; trmCobro?: number | string | null; trmCosto?: number | string | null }, agrupar: "todo" | "por_destino" = "todo", rol = "administracion", nTours = 0) {
  usuario = { id: "u-admin", email: "admin@dspacios.test" };
  db.usuarios = [{ id: "u-admin", rol, activo: true }];
  return convertirCotizacionCarrito(77, {
    agrupar, pasajeros, asesorInterno: "Asesor", asignaciones: Array.from({ length: nItems }, () => [1, 2]), asignacionesTours: Array.from({ length: nTours }, () => [1, 2]), ...eleccion,
  }) as Promise<Resultado>;
}
const ventasOrdenadas = () => [...(db.ventas ?? [])].sort((a, b) => String(a.numero_contrato).localeCompare(String(b.numero_contrato)));
const sinNumerar = () => {
  assert.equal(llamadasNumeracion, 0, "no se reservó ningún número");
  assert.equal((db.ventas ?? []).length, 0, "no se creó ningún contrato");
  assert.equal(financieros.length, 0, "no se registró ninguna CxP");
  assert.equal(db.cotizaciones[0].estado, "abierta", "la cotización sigue abierta");
};

// solo de tours con precio simulado aquí; el servidor lee el payload guardado, igual que con una cotización real o histórica.
const tour = (nombre: string, destino: string, precio: number, moneda?: string) => ({
  nombre, destino, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, precio, ...(moneda === undefined ? {} : { moneda }),
});
function cotizacionDirecta(a: { moneda: string | null; items?: unknown[]; tours: unknown[] }) {
  (db.cotizaciones ??= []).push({
    id: 77, codigo: "COT-77", tipo: "carrito", estado: "abierta", tenant: "mayorista", numero_contrato: null, moneda: a.moneda, detalle: {}, share_token: "tok",
    payload: { items: a.items ?? [], tours: a.tours, cliente: clienteCot },
  });
}
const limpiarTodo = () => { for (const k of Object.keys(db)) delete db[k]; financieros.length = 0; llamadasNumeracion = 0; };
const sinEscribir = (que: string) => {
  assert.equal(llamadasNumeracion, 0, `${que}: no se reservó ningún número`);
  assert.equal((db.ventas ?? []).length, 0, `${que}: no se creó ningún contrato`);
  assert.equal(financieros.length, 0, `${que}: no se registró ninguna CxP`);
  assert.equal(db.cotizaciones[0].estado, "abierta", `${que}: la cotización sigue abierta`);
};

// costo viaja EXPLÍCITA, y una obligación en USD detiene la conversión ANTES de numerar o escribir (la ruta financiera del carrito no tiene equivalente COP).
const proveedorRosario = { nombre: "Rosario Tours", aplica_retencion: false, pct_retencion: 0 };
function servicioConCosto(servicioId: number, monedaServicio: string | undefined, precioPersona = 100) {
  CATALOGO_SERVICIO[servicioId] = { id: servicioId, ...(monedaServicio === undefined ? {} : { moneda: monedaServicio }), proveedores: proveedorRosario };
  (db.armado_servicios ??= []).push({
    paquete_id: 34, servicio_id: servicioId, modo: "persona",
    servicios_adicionales: { precio_persona: precioPersona, recargo_individual: null, categoria: "tour_traslado", nombre: "Islas del Rosario", liquidacion: "paquete", proveedor_id: 5, proveedores: proveedorRosario },
  });
  // Sin tarifa «GENERAL»: el precio sale de una vigencia que cubra la fecha del viaje.
  (db.servicio_temporadas ??= []).push({ id: 9000 + servicioId, servicio_id: servicioId, nombre: "VIGENTE", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: precioPersona, recargo_individual: null });
}
async function cotizacionDirectaConItems(items: unknown[]) { cotizacionDirecta({ moneda: "COP", items, tours: [] }); }

const hotelNeto = (nombre: string, moneda: string, pvp: number, neto: number): HotelSim => ({ nombre, moneda, pvp, neto, cargoGrupo: 0, incluidos: [] });
const cxpDe = () => financieros.flatMap((f) => f.cxp) as unknown as Array<{ tipo_proveedor: string; servicio: string; valor_total: number; proveedor: string | null; moneda: string }>;
const pasajerosRpc = () => (rpcLog.find((r) => r.fn === "crear_pasajeros_contrato_multi_con_sillas")?.args as { p_pasajeros?: Array<Record<string, unknown>> } | undefined)?.p_pasajeros ?? [];

describe("#90 H — B2C creada SIN sesión y convertida por un usuario interno (COP)", () => {
  test("la cotización pública nace anónima en mayorista con su moneda; la conversión COP→COP conserva cliente, pasajeros, proveedor, importes y costos", async () => {
    HOTELES = { 1: hotelNeto("OZ HOTEL", "COP", 300_000, 210_000) };
    const cot = await cotizar([item(1, 34)]);
    assert.deepEqual([cot.tenant, cot.tipo, cot.moneda, cot.creado_por, cot.asesor, cot.precio_venta], ["mayorista", "carrito", "COP", null, null, 600_000], "anónima: sin autor ni asesor");

    const r = await convertir(1, { monedaCobro: "COP" });
    assert.equal(r.ok, true, r.error);
    assert.equal(db.ventas.length, 1);
    const [v] = db.ventas;
    assert.deepEqual([v.cliente, v.cliente_documento, v.cliente_email, v.cliente_telefono], ["Ana Pérez", "123", "ana@example.com", "3000000000"], "titular de la cotización");
    assert.deepEqual([v.tenant, v.moneda, v.precio_venta, v.pax, v.moneda_cobro, v.trm_cobro, v.total_cobro], ["mayorista", "COP", 600_000, 2, "COP", null, null], "misma moneda: sin TRM ni total");
    assert.deepEqual(pasajerosRpc().map((p) => p.nombre), ["Ana Pérez", "Luis Gómez"], "los dos pasajeros llegan a la RPC de pasajeros");
    const cxp = cxpDe();
    assert.equal(cxp.length, 1);
    assert.deepEqual([cxp[0].tipo_proveedor, cxp[0].proveedor, cxp[0].valor_total, cxp[0].moneda], ["hotel", "Proveedor Hotel", 420_000, "COP"], "neto 210.000 × 2 pax, proveedor del catálogo, moneda COP explícita");
    assert.deepEqual(financieros[0].costos, { costo_aereo: 0, costo_hotel: 420_000 });
    assert.equal(db.cotizaciones[0].estado, "convertida");
  });

  test("conversión permitida COP→USD (TRM 4.100): total 147 USD congelado; las CxP y costos son idénticos a los de la conversión sin cambio de moneda", async () => {
    HOTELES = { 1: hotelNeto("OZ HOTEL", "COP", 300_000, 210_000) };
    await cotizar([item(1, 34)]);
    const r = await convertir(1, { monedaCobro: "USD", trmCobro: 4100 });
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta, v.moneda_cobro, v.trm_cobro, v.total_cobro], ["COP", 600_000, "USD", 4100, 147]);
    assert.deepEqual(cxpDe().map((c) => [c.valor_total, c.moneda]), [[420_000, "COP"]], "la CxP sigue en COP al neto nominal; el cobro no la toca");
    assert.deepEqual(financieros[0].costos, { costo_aereo: 0, costo_hotel: 420_000 });
  });
});

describe("#90 H/I — B2C en USD: la CxP en USD exige la TRM de costos ANTES de numerar; con ella se registra; costo cero no la pide", () => {
  test("hotel USD con neto POSITIVO, cobrando en USD o en COP con TRM, SIN TRM de costos válida: rechazo explícito, sin número, contrato, CxP, RPC ni cambio de estado", async () => {
    HOTELES = { 1: hotelNeto("Hotel Dólar", "USD", 150, 100) };
    const cot = await cotizar([item(1, 20)]);
    assert.equal(cot.moneda, "USD");
    for (const eleccion of [{ monedaCobro: "USD" }, { monedaCobro: "COP", trmCobro: 4000 }, { monedaCobro: "USD", trmCosto: "" }, { monedaCobro: "USD", trmCosto: "abc" }, { monedaCobro: "USD", trmCosto: 0 }, { monedaCobro: "USD", trmCosto: -3900 }]) {
      const r = await convertir(1, eleccion);
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /TRM de costos/);
      sinNumerar();
      assert.equal(rpcLog.filter((x) => x.fn === "crear_pasajeros_contrato_multi_con_sillas").length, 0, "no se tocaron pasajeros");
      assert.equal(db.cotizaciones[0].detalle != null && (db.cotizaciones[0].detalle as { cobro?: unknown }).cobro, undefined, "la elección de cobro NO se congela si no se creó ningún contrato");
    }
  });

  test("con la TRM de costos: la CxP conserva su valor y moneda USD, lleva su equivalente en COP a ESA tasa (no a la de cobro) y ventas.costo_* queda en USD", async () => {
    HOTELES = { 1: hotelNeto("Hotel Dólar", "USD", 150, 100) };
    await cotizar([item(1, 20)]);
    const r = await convertir(1, { monedaCobro: "COP", trmCobro: 4000, trmCosto: 3900 });
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta, v.moneda_cobro, v.trm_cobro, v.total_cobro], ["USD", 300, "COP", 4000, 1_200_000]);
    const [c] = cxpDe() as unknown as Array<{ valor_total: number; moneda: string; valor_cop_costo: number; trm_costo: number }>;
    assert.deepEqual([c.valor_total, c.moneda, c.trm_costo, c.valor_cop_costo], [200, "USD", 3900, 780_000], "100 USD × 2 pax a la TRM de costos 3.900");
    assert.deepEqual(financieros[0].costos, { costo_aereo: 0, costo_hotel: 200 }, "costo_* en la moneda de la oferta");
    assert.deepEqual((db.cotizaciones[0].detalle as { costo?: unknown }).costo, { trm: 3900 });
  });

  test("un usuario externo (rol agencia) no puede ingresar la TRM de costos: se rechaza antes de numerar", async () => {
    HOTELES = { 1: hotelNeto("Hotel Dólar", "USD", 150, 100) };
    await cotizar([item(1, 20)]);
    const r = await convertir(1, { monedaCobro: "USD", trmCosto: 3900 }, "todo", "agencia");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Solo el personal interno puede ingresar la TRM de costos/);
    sinNumerar();
  });

  test("el mismo hotel USD con neto CERO convierte: contrato USD sin CxP; cobro USD (sin TRM) o COP (TRM 4.000 → 300 × 2 × 4.000 = 2.400.000)", async () => {
    HOTELES = { 1: hotelNeto("Hotel Dólar", "USD", 150, 0) };
    await cotizar([item(1, 20)]);
    const r = await convertir(1, { monedaCobro: "COP", trmCobro: 4000 });
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta, v.moneda_cobro, v.trm_cobro, v.total_cobro], ["USD", 300, "COP", 4000, 1_200_000], "precio 300 USD × 4.000");
    assert.equal(cxpDe().length, 0, "costo cero: no hay obligación");
    limpiarTodo(); usuario = null;
    await cotizar([item(1, 20)]);
    const r2 = await convertir(1, { monedaCobro: "USD" });
    assert.equal(r2.ok, true, r2.error);
    assert.deepEqual([db.ventas[0].moneda, db.ventas[0].moneda_cobro, db.ventas[0].trm_cobro, db.ventas[0].total_cobro], ["USD", "USD", null, null]);
  });
});

// ── H-1 (corregido en #90 I): pruebas ACTIVAS. Antes eran una sonda `todo` que documentaba el defecto; ahora fallan si vuelve a mezclarse una moneda. ──
const proveedorTour = { nombre: "Rosario Tours", aplica_retencion: false, pct_retencion: 0 };
function servicioCatalogo(servicioId: number, moneda: string, precioPersona: number) {
  CATALOGO_SERVICIO[servicioId] = { id: servicioId, moneda, proveedores: proveedorTour };
  (db.armado_servicios ??= []).push({
    paquete_id: 34, servicio_id: servicioId, modo: "persona",
    servicios_adicionales: { precio_persona: precioPersona, recargo_individual: null, categoria: "tour_traslado", nombre: "Islas del Rosario", liquidacion: "paquete", proveedor_id: 5, proveedores: proveedorTour },
  });
  // Sin tarifa «GENERAL»: el precio sale de una vigencia que cubra la fecha del viaje.
  (db.servicio_temporadas ??= []).push({ id: 9000 + servicioId, servicio_id: servicioId, nombre: "VIGENTE", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: precioPersona, recargo_individual: null });
}

describe("#90 H-1 — moneda del servicio distinta de la oferta del carrito", () => {
  test("H-1: oferta USD cuyo servicio del catálogo hoy está en COP (cambió después de cotizar): se detiene ANTES de numerar; no se suman monedas en costo_receptivo ni se congela el cobro", async () => {
    servicioCatalogo(20, "COP", 100_000);
    cotizacionDirecta({ moneda: "USD", tours: [{ ...tour("Islas del Rosario", "CARTAGENA", 300, "USD"), servicioId: 20, paqueteId: 34 }] });
    for (const eleccion of [{ monedaCobro: "USD" }, { monedaCobro: "COP", trmCobro: 4000, trmCosto: 3900 }]) {
      const r = await convertir(0, eleccion, "todo", "administracion", 1);
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /Islas del Rosario: su costo con el proveedor está hoy en COP y la oferta del carrito está en USD; no se mezclan monedas/);
      sinEscribir("H-1 servicio COP en oferta USD");
      assert.equal((db.cotizaciones[0].detalle as { cobro?: unknown }).cobro, undefined, "no se congela el cobro");
      assert.equal(db.cotizaciones[0].estado, "abierta");
    }
  });

  test("H-1 inverso: oferta COP cuyo servicio del catálogo hoy está en USD: también se detiene antes de numerar, aunque se ingrese TRM de costos", async () => {
    servicioCatalogo(20, "USD", 100);
    cotizacionDirecta({ moneda: "COP", tours: [{ ...tour("Islas del Rosario", "CARTAGENA", 300_000, "COP"), servicioId: 20, paqueteId: 34 }] });
    const r = await convertir(0, { monedaCobro: "COP", trmCosto: 3900 }, "todo", "administracion", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Islas del Rosario: su costo con el proveedor está hoy en USD y la oferta del carrito está en COP/);
    sinEscribir("H-1 inverso servicio USD en oferta COP");
  });

  test("H-1 con costo CERO: la moneda distinta del servicio no bloquea (no existe obligación) ni pide TRM de costos; ventas y cotización quedan intactas en su moneda", async () => {
    servicioCatalogo(20, "COP", 0);
    cotizacionDirecta({ moneda: "USD", tours: [{ ...tour("Islas del Rosario", "CARTAGENA", 300, "USD"), servicioId: 20, paqueteId: 34 }] });
    const r = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([db.ventas[0].moneda, db.ventas[0].precio_venta], ["USD", 300]);
    assert.deepEqual(financieros[0].cxp, [], "sin obligación");
    assert.equal((db.cotizaciones[0].detalle as { costo?: unknown }).costo, undefined, "sin obligaciones en USD no se guarda ninguna TRM de costos");
  });

  test("H-1 en un grupo posterior: si el segundo contrato mezcla monedas, NADA se numera ni se crea (tampoco el primero)", async () => {
    servicioCatalogo(20, "COP", 100_000);
    servicioCatalogo(21, "USD", 100);
    cotizacionDirecta({
      moneda: "USD",
      tours: [
        { ...tour("Tour USD", "CARTAGENA", 300, "USD"), servicioId: 21, paqueteId: 34 },
        { ...tour("Islas del Rosario", "SANTA MARTA", 300, "USD"), servicioId: 20, paqueteId: 34 },
      ],
    });
    const r = await convertir(0, { monedaCobro: "USD", trmCosto: 3900 }, "por_destino", "administracion", 2);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Islas del Rosario: su costo con el proveedor está hoy en COP y la oferta del carrito está en USD/);
    sinEscribir("H-1 grupo posterior");
  });
});
