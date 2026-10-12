// EJECUCIÓN REAL de punta a punta, con clientes simulados (nada remoto):
//   checkout público (`crearSolicitudReserva`) → la cotización queda en una
//   base en memoria → `convertirCotizacionCarrito` convierte ESA cotización.
// Se simulan solo las fronteras externas: Supabase (sesión/servicio), el
// motor `computarReserva`, la numeración, el acceso, las condiciones y la
// escritura financiera atómica (`registrarFinancieroContrato`, donde se
// captura la CxP que se iba a registrar).
//
// Reglas probadas:
//   · incluido POR PERSONA (asistencia, OZ HOTEL/paquete 34): cotización y
//     contrato con asistencia "Sí", precio sin sumarlo otra vez, UNA CxP;
//   · incluido POR GRUPO: cargo una sola vez (una línea en la cotización y en
//     el contrato), total del contrato = cotización = ventas.precio_venta,
//     UNA CxP;
//   · hotel excluido por moneda: no anuncia su asistencia ni la deja en el
//     payload, y la conversión no crea su CxP.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
mock.module("@/lib/reservar/financieroContrato", {
  namedExports: {
    registrarFinancieroContrato: async (_deps: unknown, a: { cxp: CxP[]; costos: Fila }) => { financieros.push({ cxp: a.cxp, costos: a.costos }); return { ok: true }; },
    revertirContratoIncompleto: async () => ({ ok: true }),
  },
});
mock.module("@/lib/contabilidad/asientos", { namedExports: { postearAsientoCxP: async () => ({ ok: true }), eliminarAsientoCxP: async () => ({ ok: true }) } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/asegurarCuentasPorPagar", { namedExports: { asegurarCuentasPorPagar: async () => ({ ok: true }) } });
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async () => ({ ok: true, numero: "DTM-0900" }) } });
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

const ASISTENCIA: Incluido = { servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "asistencia", incluido: true, costoNeto: 40_000, proveedorId: 5 };
const TRASLADO_GRUPO: Incluido = { servicioId: 12, nombre: "TRASLADO GRUPAL", categoria: "tour_traslado", incluido: true, costoNeto: 70_000, proveedorId: 8 };
const clienteCot = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
const item = (hotelId: number, paqueteId: number) => ({
  modulo: "porcion_terrestre", paqueteId, hotelId, bloqueoId: null, hotelNombre: HOTELES[hotelId].nombre, destino: "CARTAGENA",
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
});
const pasajeros = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
];

async function cotizarYConvertir(items: unknown[]) {
  usuario = null; // checkout público (B2C)
  const r = await crearSolicitudReserva({ items, tours: [], cliente: clienteCot });
  assert.equal(r.ok, true, (r as { error?: string }).error);
  const cot = db.cotizaciones[0];
  usuario = { id: "u-admin", email: "admin@dspacios.test" }; // quien convierte (interno)
  const nItems = (cot.payload as { items: unknown[] }).items.length;
  const conv = await convertirCotizacionCarrito(77, {
    agrupar: "todo", pasajeros, asesorInterno: "Asesor", asignaciones: Array.from({ length: nItems }, () => [1, 2]), asignacionesTours: [],
  });
  assert.equal(conv.ok, true, (conv as { error?: string }).error);
  return { cot, venta: db.ventas[0], items: db.contrato_items ?? [], cxp: financieros[0].cxp };
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  financieros.length = 0;
});

describe("incluido POR PERSONA: OZ HOTEL CARTAGENA, paquete 34, asistencia médica", () => {
  test("cotización y contrato con asistencia Sí, precio sin duplicar y una sola CxP de asistencia", async () => {
    HOTELES = { 1: { nombre: "OZ HOTEL CARTAGENA", moneda: "COP", pvp: 300_000, neto: 200_000, cargoGrupo: 0, incluidos: [ASISTENCIA] } };
    const { cot, venta, items, cxp } = await cotizarYConvertir([item(1, 34)]);
    assert.equal((cot.detalle as { venta: Fila }).venta.asistencia_medica, true, "cotización");
    assert.equal(venta.asistencia_medica, true, "contrato (ventas)");
    assert.equal(cot.precio_venta, 600_000);
    assert.equal(venta.precio_venta, 600_000, "por persona ya venía en la tarifa: no se suma otra vez");
    assert.equal(totalVisibleContratoItems(items as never), 600_000, "total del documento del contrato");
    const asist = cxp.filter((c) => c.tipo_proveedor === "asistencia");
    assert.equal(asist.length, 1, "exactamente una CxP de asistencia");
    assert.deepEqual([asist[0].servicio_id, asist[0].valor_total, asist[0].proveedor], [9, 40_000, "Asistencias SA"]);
    assert.equal(cxp.filter((c) => c.servicio_id === 9).length, 1, "ni duplicada como otro tipo");
  });
});

describe("incluido POR GRUPO: se cobra una vez con el pax real", () => {
  test("una línea de cargo en cotización y contrato; totales iguales; una sola CxP", async () => {
    HOTELES = { 1: { nombre: "OZ HOTEL CARTAGENA", moneda: "COP", pvp: 300_000, neto: 200_000, cargoGrupo: 90_000, incluidos: [TRASLADO_GRUPO] } };
    const { cot, venta, items, cxp } = await cotizarYConvertir([item(1, 34)]);
    const lineasCot = (cot.detalle as { items: { descripcion: string; valor_total?: number }[] }).items.filter((i) => /Servicios incluidos por grupo/.test(i.descripcion));
    assert.deepEqual(lineasCot.map((i) => i.valor_total), [90_000], "cotización: una línea");
    const lineasCon = (items as { descripcion: string; valor_total?: number }[]).filter((i) => /Servicios incluidos por grupo/.test(i.descripcion));
    assert.deepEqual(lineasCon.map((i) => i.valor_total), [90_000], "contrato: una línea");
    assert.equal(cot.precio_venta, 690_000);
    assert.equal(venta.precio_venta, cot.precio_venta, "precio del contrato = cotización");
    assert.equal(totalVisibleContratoItems(items as never), cot.precio_venta, "el total del documento del contrato coincide");
    assert.equal(venta.tours_traslados, "TRASLADO GRUPAL");
    const traslado = cxp.filter((c) => c.servicio_id === 12);
    assert.equal(traslado.length, 1, "una sola CxP del incluido por grupo");
    assert.deepEqual([traslado[0].tipo_proveedor, traslado[0].valor_total, traslado[0].proveedor], ["receptivo", 70_000, "Traslados Caribe"]);
  });
});

describe("hotel excluido por moneda: su asistencia no se anuncia ni genera CxP", () => {
  test("COP aceptado + USD excluido con asistencia incluida", async () => {
    HOTELES = {
      1: { nombre: "Hotel Almirante", moneda: "COP", pvp: 300_000, neto: 200_000, cargoGrupo: 0, incluidos: [] },
      3: { nombre: "Hotel Dólar", moneda: "USD", pvp: 150, neto: 100, cargoGrupo: 0, incluidos: [ASISTENCIA] },
    };
    const { cot, venta, cxp } = await cotizarYConvertir([item(1, 10), item(3, 20)]);
    const payload = cot.payload as { items: { hotelId: number }[]; serviciosIncluidos: unknown[] };
    assert.deepEqual(payload.items.map((i) => i.hotelId), [1], "el hotel USD quedó fuera");
    assert.equal((cot.detalle as { venta: Fila }).venta.asistencia_medica, false, "la cotización COP no anuncia la asistencia del hotel excluido");
    assert.deepEqual(payload.serviciosIncluidos, [], "ni la conserva en el payload");
    assert.equal(venta.asistencia_medica, false);
    assert.equal(cxp.filter((c) => c.tipo_proveedor === "asistencia" || c.servicio_id === 9).length, 0, "la conversión no crea su CxP");
  });
});

// ── Costo resuelto OTRA VEZ al convertir, validado contra lo cotizado ─────
// Helpers: cotiza con un estado del catálogo y convierte con otro; si la
// conversión falla, no debe haber escrito nada (ni venta ni financiero).
async function cotizar(items: unknown[]) {
  usuario = null;
  const r = await crearSolicitudReserva({ items, tours: [], cliente: clienteCot });
  assert.equal(r.ok, true, (r as { error?: string }).error);
  return db.cotizaciones[0];
}
async function convertir(nItems = 1) {
  usuario = { id: "u-admin", email: "admin@dspacios.test" };
  return convertirCotizacionCarrito(77, {
    agrupar: "todo", pasajeros, asesorInterno: "Asesor", asignaciones: Array.from({ length: nItems }, () => [1, 2]), asignacionesTours: [],
  }) as Promise<{ ok: boolean; error?: string }>;
}
const sinEscrituras = () => {
  assert.equal((db.ventas ?? []).length, 0, "no se creó ningún contrato");
  assert.equal(financieros.length, 0, "no se registró ninguna CxP");
  for (const t of ["contrato_items", "contrato_hoteles", "contrato_vuelos"]) assert.equal((db[t] ?? []).length, 0, `nada en ${t}`);
  assert.equal(db.cotizaciones[0].estado, "abierta", "la cotización sigue abierta");
};
// Mensaje seguro para cotizaciones con costo en el payload: sin datos internos.
const FORMATO_ANTERIOR = /^Esta cotización se generó con un formato anterior que ya no se puede convertir de forma segura\. Genera una cotización nueva desde el tarifario antes de convertirla\.$/;
const sinDatosInternos = (msg: string | undefined) => assert.doesNotMatch(msg ?? "", /costoNeto|proveedor|40\.?000|38\.?000|\$/);
const ozCon = (incluidos: Incluido[]): HotelSim => ({ nombre: "OZ HOTEL CARTAGENA", moneda: "COP", pvp: 300_000, neto: 200_000, cargoGrupo: 0, incluidos });

describe("conversión: el costo del incluido se resuelve en el servidor y se valida", () => {
  test("la tarifa neta cambió entre cotización y conversión: falla cerrado, sin sustituir el costo", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    await cotizar([item(1, 34)]);
    HOTELES = { 1: ozCon([{ ...ASISTENCIA, costoNeto: 45_000 }]) };
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /la tarifa neta de «ASISTENCIA MEDICA» cambió desde la cotización; no se sustituye automáticamente/);
    sinEscrituras();
  });

  test("el paquete ganó o perdió un incluido desde la cotización: falla cerrado", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    await cotizar([item(1, 34)]);
    HOTELES = { 1: ozCon([]) };
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /los servicios incluidos del paquete cambiaron desde la cotización/);
    sinEscrituras();
  });

  test("las fechas del hotel recalculadas no son las cotizadas: falla cerrado", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    const cot = await cotizar([item(1, 34)]);
    (cot.detalle as { hoteles: Fila[] }).hoteles[0].fecha_ingreso = "2030-03-02";
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /las fechas del hotel ya no coinciden con las cotizadas/);
    sinEscrituras();
  });

  test("los pasajeros recalculados no son los cotizados: falla cerrado", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    const cot = await cotizar([item(1, 34)]);
    (cot.payload as { items: Fila[] }).items[0].pax = 3;
    usuario = { id: "u-admin", email: "admin@dspacios.test" };
    const tres = [...pasajeros, { ...pasajeros[1], nombres: "Eva", numeroDoc: "789" }];
    const r = await convertirCotizacionCarrito(77, { agrupar: "todo", pasajeros: tres, asesorInterno: "Asesor", asignaciones: [[1, 2, 3]], asignacionesTours: [] }) as { ok: boolean; error?: string };
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /los pasajeros del hotel \(2\) no coinciden con los cotizados \(3\)/);
    sinEscrituras();
  });

  test("un costo agregado al payload NUEVO es anómalo: se rechaza antes de escribir, nunca se usa", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    const cot = await cotizar([item(1, 34)]);
    (cot.payload as { serviciosIncluidos: Fila[] }).serviciosIncluidos[0].costoNeto = 40_000;
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", FORMATO_ANTERIOR);
    sinEscrituras();
  });
});

describe("conversión de cotizaciones ANTERIORES (payload con costoNeto, sin huella)", () => {
  const legado = (costoNeto?: number) => [{ servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "asistencia", incluido: true, proveedorId: 5, paqueteId: 34, ...(costoNeto !== undefined ? { costoNeto } : {}) }];

  test("costo IGUAL al recalculado: igual se rechaza, sin contrato ni CxP, con mensaje seguro", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    const cot = await cotizar([item(1, 34)]);
    (cot.payload as Fila).serviciosIncluidos = legado(40_000);
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", FORMATO_ANTERIOR);
    sinDatosInternos(r.error);
    sinEscrituras();
  });

  test("costo DISTINTO al recalculado: se rechaza igual, sin contrato ni CxP", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    const cot = await cotizar([item(1, 34)]);
    (cot.payload as Fila).serviciosIncluidos = legado(38_000);
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", FORMATO_ANTERIOR);
    sinDatosInternos(r.error);
    sinEscrituras();
  });

  test("el mismo escenario en formato NUEVO sí convierte (asistencia Sí, una CxP)", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    await cotizar([item(1, 34)]);
    const r = await convertir();
    assert.equal(r.ok, true, r.error);
    assert.equal(db.ventas[0].asistencia_medica, true);
    assert.deepEqual(financieros[0].cxp.filter((c) => c.servicio_id === 9).map((c) => [c.valor_total, c.proveedor]), [[40_000, "Asistencias SA"]]);
  });

  test("sin costo con qué comparar, o sin el incluido (cotización B2B afectada por el defecto): falla cerrado", async () => {
    for (const guardado of [legado(undefined), []]) {
      for (const k of Object.keys(db)) delete db[k];
      financieros.length = 0;
      HOTELES = { 1: ozCon([ASISTENCIA]) };
      const cot = await cotizar([item(1, 34)]);
      (cot.payload as Fila).serviciosIncluidos = guardado;
      const r = await convertir();
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /Genera una cotización nueva/);
      sinEscrituras();
    }
  });
});

describe("rol venta: el payload de una cotización nueva no le entrega costos ni proveedores", () => {
  test("todo el payload (lo que la RLS deja leer a venta) sin costoNeto, proveedor ni importes netos", async () => {
    HOTELES = { 1: { ...ozCon([ASISTENCIA, TRASLADO_GRUPO]), cargoGrupo: 90_000 } };
    const cot = await cotizar([item(1, 34)]);
    const json = JSON.stringify(cot.payload);
    assert.doesNotMatch(json, /costoNeto|costo_neto|proveedorId|proveedor_id|"proveedor"|40000|70000|"neto"/);
    const r = await convertir();
    assert.equal(r.ok, true, r.error);
    assert.equal(financieros[0].cxp.filter((c) => c.servicio_id === 9).length, 1);
    assert.equal(financieros[0].cxp.filter((c) => c.servicio_id === 12).length, 1);
  });
});

describe("conversión: proveedor y categoría del incluido, aunque el costo siga igual", () => {
  test("cambió el proveedor (mismo costo): falla cerrado sin escribir", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    await cotizar([item(1, 34)]);
    HOTELES = { 1: ozCon([{ ...ASISTENCIA, proveedorId: 6 }]) };
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /el proveedor de «ASISTENCIA MEDICA» cambió desde la cotización/);
    sinEscrituras();
  });

  test("cambió la categoría (mismo costo y proveedor): falla cerrado sin escribir", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    await cotizar([item(1, 34)]);
    HOTELES = { 1: ozCon([{ ...ASISTENCIA, categoria: "otro" }]) };
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /la categoría de «ASISTENCIA MEDICA» cambió desde la cotización/);
    sinEscrituras();
  });

  test("el incluido no tiene proveedor en el catálogo: falla cerrado (no hay CxP a nombre de nadie)", async () => {
    // Sin proveedor desde la cotización hasta la conversión: la huella coincide,
    // pero una CxP sin proveedor no se puede pagar.
    HOTELES = { 1: ozCon([{ ...ASISTENCIA, proveedorId: null }]) };
    await cotizar([item(1, 34)]);
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /«ASISTENCIA MEDICA» no tiene proveedor configurado en el catálogo; no se puede registrar su cuenta por pagar/);
    sinEscrituras();
  });

  test("el id de proveedor existe pero el catálogo no devuelve el proveedor: se revierte y no se registra la CxP", async () => {
    HOTELES = { 1: ozCon([ASISTENCIA]) };
    await cotizar([item(1, 34)]);
    const original = CATALOGO_SERVICIO[9];
    CATALOGO_SERVICIO[9] = { id: 9, proveedores: null };
    try {
      const r = await convertir();
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /el proveedor de «ASISTENCIA MEDICA» no se encontró en el catálogo/);
      assert.equal(financieros.length, 0, "ninguna CxP registrada");
    } finally {
      CATALOGO_SERVICIO[9] = original;
    }
  });

  test("cotización anterior: proveedor distinto o ausente en el payload viejo → falla cerrado", async () => {
    for (const viejo of [
      [{ servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "asistencia", incluido: true, costoNeto: 40_000, proveedorId: 7, paqueteId: 34 }],
      [{ servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "asistencia", incluido: true, costoNeto: 40_000, paqueteId: 34 }],
      [{ servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "otro", incluido: true, costoNeto: 40_000, proveedorId: 5, paqueteId: 34 }],
    ]) {
      for (const k of Object.keys(db)) delete db[k];
      financieros.length = 0;
      HOTELES = { 1: ozCon([ASISTENCIA]) };
      const cot = await cotizar([item(1, 34)]);
      (cot.payload as Fila).serviciosIncluidos = viejo;
      const r = await convertir();
      assert.equal(r.ok, false);
      // Traen `costoNeto`: se rechazan por formato anterior antes de comparar nada.
      assert.match(r.error ?? "", FORMATO_ANTERIOR);
      sinEscrituras();
    }
  });
});

describe("cotizaciones SIN incluidos: convierten como siempre y conservan sus guardas", () => {
  const sinIncluidos = (): HotelSim => ({ nombre: "Hotel Almirante", moneda: "COP", pvp: 300_000, neto: 200_000, cargoGrupo: 0, incluidos: [] });

  test("lista vacía o sin la clave `serviciosIncluidos` (cotización antigua): convierte, sin asistencia ni CxP de servicios", async () => {
    for (const quitarClave of [false, true]) {
      for (const k of Object.keys(db)) delete db[k];
      financieros.length = 0;
      HOTELES = { 1: sinIncluidos() };
      const cot = await cotizar([item(1, 10)]);
      if (quitarClave) delete (cot.payload as Fila).serviciosIncluidos;
      const r = await convertir();
      assert.equal(r.ok, true, r.error);
      assert.equal(db.ventas[0].asistencia_medica, false);
      assert.equal(db.ventas[0].precio_venta, 600_000);
      assert.deepEqual(financieros[0].cxp.map((c) => c.tipo_proveedor), ["hotel"], "solo la CxP del hotel");
    }
  });

  test("la guarda de asignación de pasajeros sigue rechazando antes de escribir", async () => {
    HOTELES = { 1: sinIncluidos() };
    await cotizar([item(1, 10)]);
    usuario = { id: "u-admin", email: "admin@dspacios.test" };
    const r = await convertirCotizacionCarrito(77, { agrupar: "todo", pasajeros, asesorInterno: "Asesor", asignaciones: [[1]], asignacionesTours: [] }) as { ok: boolean; error?: string };
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /la cantidad de pasajeros asignados \(1\) no coincide con la cantidad esperada \(2\)/);
    sinEscrituras();
  });

  test("la guarda de moneda sigue rechazando antes de escribir", async () => {
    HOTELES = { 1: sinIncluidos() };
    await cotizar([item(1, 10)]);
    HOTELES = { 1: { ...sinIncluidos(), moneda: "USD" } };
    const r = await convertir();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /la moneda cambió desde que se generó la cotización/);
    sinEscrituras();
  });
});
