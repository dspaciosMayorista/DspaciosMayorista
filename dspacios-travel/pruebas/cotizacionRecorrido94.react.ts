// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #94/#52 — RECORRIDO COMPLETO de la cotización normal con servicios parciales: la cobertura que captura el panel (misma forma que arma la página, ver
// coberturaServicios94.react.ts) entra por la acción real `crearSolicitudReserva` (base en memoria, nada remoto), la cotización queda guardada, se REABRE desde ese
// JSON y se imprime con el componente real `ContratoDocumento`. Se exige el mismo reparto y el mismo total en la acción, el documento y la reapertura.
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
  "next/headers": "export async function headers() { return new Map([[\"host\", \"localhost\"]]); }",
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
// Inyección de fallo: la inserción en esta tabla devuelve error y NO persiste nada (prueba de fallos de la conversión).
let FALLO_INSERT: string | null = null;
// Opcional: el fallo solo aplica si las filas a insertar cumplen esto (p. ej. distinguir los ítems de tours de los del hotel en la misma tabla).
let FALLO_FILTRO: ((filas: Fila[]) => boolean) | null = null;
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
    let fallaEsta = false;
    let patch: Fila = {};
    const coincide = (f: Fila) => filtros.every(([k, o, v]) => (o === "eq" ? f[k] === v : (v as unknown[]).includes(f[k])));
    const leer = (): Fila[] => {
      if (tabla === "servicios_adicionales") return Object.values(CATALOGO_SERVICIO).filter(coincide);
      if (tabla === "hoteles") return [{ id: 1, proveedores: { nombre: "Proveedor Hotel", aplica_retencion: false, pct_retencion: 0 } }].filter(coincide);
      return (db[tabla] ?? []).filter(coincide);
    };
    const resolver = () => {
      if (op === "insert") return fallaEsta ? { data: null, error: { message: "fallo simulado de la base" } } : { data: insertadas, error: null };
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
        fallaEsta = FALLO_INSERT === tabla && (!FALLO_FILTRO || FALLO_FILTRO(insertadas));
        if (!fallaEsta) (db[tabla] ??= []).push(...insertadas);
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
// Tour del tarifario simulado: null = el servicio no está disponible (comportamiento de siempre).
let TOUR_SIM: Record<string, unknown> | null = null;
// Variante por servicio (por id) para cotizar varios servicios distintos en la misma solicitud.
let TOUR_POR_ID: Record<number, Record<string, unknown>> = {};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number; habitaciones?: Record<string, number> }) => {
      const h = HOTELES[r.hotelId];
      const dobles = r.habitaciones?.doble ?? 1, sencillas = r.habitaciones?.sencilla ?? 0;
      const lineas = [...(dobles ? [{ acom: "doble", habitaciones: dobles, pax: dobles * 2, pvp: h.pvp }] : []), ...(sencillas ? [{ acom: "sencilla", habitaciones: sencillas, pax: sencillas, pvp: h.pvp }] : [])];
      const pax = dobles * 2 + sencillas;
      return {
        ok: true,
        data: {
          meta: { hotel_nombre: h.nombre, destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
          precioVenta: h.pvp * pax + h.cargoGrupo, monedaReserva: h.moneda,
          lineasHab: lineas, pvpPorAcom: { doble: h.pvp, sencilla: h.pvp }, netoPorAcom: { doble: h.neto, sencilla: h.neto },
          numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: pax, paxConSilla: pax, edadesMenoresUsadas: [],
          serviciosIncluidos: h.incluidos, distribucionMenores: [], condicionesTarifa: null,
        },
      };
    },
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    liquidarServicioPuntual: async (e: { servicioId?: number }) => (TOUR_SIM ? { ok: true, resultado: { ...TOUR_SIM, ...(TOUR_POR_ID[e?.servicioId ?? -1] ?? {}) } } : { ok: false, tipo: "no_disponible", mensaje: "no se usa" }),
    cotizarPorFechas: async () => { throw new Error("no se usa"); },
    buscarHoteles: async () => { throw new Error("no se usa"); },
    buscarReceptivos: async () => { throw new Error("no se usa"); },
  },
});
type CxP = { tipo_proveedor: string; servicio: string; valor_total: number; proveedor: string | null; servicio_id: number | null };
const financieros: { cxp: CxP[]; costos: Fila }[] = [];
const reversiones: string[] = [];
mock.module("@/lib/reservar/financieroContrato", {
  namedExports: {
    registrarFinancieroContrato: async (_deps: unknown, a: { cxp: CxP[]; costos: Fila }) => { financieros.push({ cxp: a.cxp, costos: a.costos }); return { ok: true }; },
    revertirContratoIncompleto: async (_d: unknown, numero: string) => { reversiones.push(numero); return { ok: true }; },
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

const { crearSolicitudReserva, cuposDeCarrito } = await import("../app/tarifario/checkout/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { totalVisibleContratoItems } = await import("../lib/contrato/valorContratoItem.ts");
const { resumenAplicable } = await import("../lib/cotizacion/resumenPrecios.ts");

const ASISTENCIA: Incluido = { servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "asistencia", incluido: true, costoNeto: 40_000, proveedorId: 5 };
const clienteCot = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
const item = (hotelId: number, paqueteId: number) => ({
  modulo: "porcion_terrestre", paqueteId, hotelId, bloqueoId: null, hotelNombre: HOTELES[hotelId].nombre, destino: "CARTAGENA",
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
});
beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  financieros.length = 0;
  reversiones.length = 0;
  FALLO_INSERT = null;
  FALLO_FILTRO = null;
  TOUR_SIM = null;
  TOUR_POR_ID = {};
});
const ozCon = (incluidos: Incluido[]): HotelSim => ({ nombre: "OZ HOTEL CARTAGENA", moneda: "COP", pvp: 300_000, neto: 200_000, cargoGrupo: 0, incluidos });
const TOUR = { servicioId: 12, paqueteId: 34, nombre: "Tour Islas", destino: "CARTAGENA", descripcion: null, noches: 3, pax: 2, total: 200_000, moneda: "COP", categoria: "tour_traslado" };
const tourEntrada = { servicioId: 12, paqueteId: 34, hotelItemId: null, nombre: "Tour Islas", destino: "CARTAGENA", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, precio: 1, moneda: "COP" };
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { formatMoneda } = await import("../lib/utils.ts");

type Detalle = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const planoTxt = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const $ = (n: number) => formatMoneda(n, "COP").replace(/\s+/g, "");
const sinEspacios = (t: string) => t.replace(/\s+/g, "");
// Igual que app/cotizacion/[id]/page.tsx: el documento se arma SOLO con lo guardado en la cotización.
const imprimir = (d: Detalle) => renderToStaticMarkup(createElement(ContratoDocumento as never, {
  venta: d.venta, pasajeros: d.pasajeros ?? [], hoteles: d.hoteles ?? [], vuelos: d.vuelos ?? [], items: d.items ?? [], habitacionesBernalo: [], composicionBernalo: [],
  totalPagado: 0, esCotizacion: true, codigo: "COT-77", vigenciaHasta: null, agencia: null, incluye: d.incluye ?? null, noIncluye: d.noIncluye ?? null,
  tituloPaquete: d.tituloPaquete ?? null, resumenPrecios: d.resumenPrecios ?? null, paqueteSnapshot: null,
} as never));

describe("#94 recorrido: capturar → guardar → reabrir → imprimir con el mismo reparto y total", () => {
  test("dos servicios parciales superpuestos sobre 3 pasajeros", async () => {
    HOTELES = { 1: ozCon([]) };
    db.tarifario_resumen = [{ paquete_id: 34, paquete_nombre: "Cartagena Esencial" }];
    TOUR_SIM = { ...TOUR, pax: 2, total: 200_000 };
    TOUR_POR_ID = { 12: { servicioId: 12, nombre: "Tour A" }, 13: { servicioId: 13, nombre: "Tour B" } };
    usuario = null;
    // Cobertura exactamente como la arma el panel de la página (pruebas/coberturaServicios94.react.ts).
    const cobertura = {
      cupos: { 0: { "adulto:doble": [1, 2], "adulto:sencilla": [1] } },
      tours: { 0: { hotel: 0, cubre: ["adulto:doble#1", "adulto:doble#2"] }, 1: { hotel: 0, cubre: ["adulto:doble#2", "adulto:sencilla#1"] } },
      manuales: {},
    };
    const r = await crearSolicitudReserva({
      items: [{ ...item(1, 34), habitaciones: { doble: 1, sencilla: 1 }, pax: 3 }],
      tours: [{ ...tourEntrada, servicioId: 12, nombre: "Tour A", pax: 2 }, { ...tourEntrada, servicioId: 13, nombre: "Tour B", pax: 2 }],
      cliente: clienteCot, cobertura,
    }) as { ok: boolean; error?: string };
    assert.equal(r.ok, true, r.error);

    // 1) Lo guardado: tres grupos con precio completo por persona; suman el total de la cotización.
    const fila = db.cotizaciones[0];
    const guardado = JSON.parse(JSON.stringify(fila.detalle)) as Detalle; // lo que devolvería la base al reabrir
    assert.equal(fila.precio_venta, 1_300_000, "3 × 300.000 de hotel + 2 servicios de 200.000");
    assert.equal(guardado.resumenPendiente, undefined);
    const u = guardado.resumenPrecios.unidades[0];
    assert.deepEqual(u.grupos.map((g: Detalle) => [g.cantidad, g.tarifaCentavos / 100, g.incluye]),
      [[1, 500_000, ["Tour A", "Tour B"]], [1, 400_000, ["Tour A"]], [1, 400_000, ["Tour B"]]]);
    assert.equal(u.grupos.reduce((s: number, g: Detalle) => s + g.subtotalCentavos, 0) + u.ajusteCentavos, 130_000_000);
    assert.equal(guardado.resumenPrecios.totalCentavos, 130_000_000);

    // 2) Documento impreso: mismo reparto, mismo total y ningún importe por servicio.
    const html = imprimir(guardado);
    const t = planoTxt(html);
    assert.ok(html.includes('data-testid="resumen-precios"'), "se usa el resumen por pasajero");
    for (const frag of [`${$(500_000)}`, `${$(400_000)}`, "Alojamiento · Tour A · Tour B", "Alojamiento · Tour A", "Alojamiento · Tour B", $(1_300_000)]) {
      assert.ok(sinEspacios(t).includes(sinEspacios(frag)), `el documento muestra ${frag}`);
    }
    assert.equal(sinEspacios(t).includes(sinEspacios($(200_000))), false, "no se muestra el importe de un servicio");
    assert.equal(sinEspacios(t).includes(sinEspacios($(100_000))), false, "ni su parte por persona");

    // 3) Reapertura e impresión repetidas: idéntico (mismo reparto y total, sin recalcular).
    assert.equal(imprimir(JSON.parse(JSON.stringify(guardado))), html);
  });

  test("si la cobertura guardada ya no corresponde al acuerdo (total distinto) el documento NO muestra un reparto viejo", async () => {
    HOTELES = { 1: ozCon([]) };
    TOUR_SIM = { ...TOUR, pax: 2, total: 200_000 };
    usuario = null;
    const r = await crearSolicitudReserva({
      items: [{ ...item(1, 34), habitaciones: { doble: 1, sencilla: 1 }, pax: 3 }], tours: [{ ...tourEntrada, pax: 2 }], cliente: clienteCot,
      cobertura: { cupos: { 0: { "adulto:doble": [1, 2], "adulto:sencilla": [1] } }, tours: { 0: { hotel: 0, cubre: ["adulto:doble#1", "adulto:sencilla#1"] } } },
    }) as { ok: boolean; error?: string };
    assert.equal(r.ok, true, r.error);
    const guardado = JSON.parse(JSON.stringify(db.cotizaciones[0].detalle)) as Detalle;
    assert.ok(guardado.resumenPrecios);
    const alterado = { ...guardado, items: guardado.items.map((i: Detalle) => (i.descripcion?.startsWith("Servicio ·") ? { ...i, tarifa_adulto: 1 } : i)) };
    assert.equal(imprimir(alterado).includes('data-testid="resumen-precios"'), false, "total del acuerdo cambió: sin reparto");
  });
});
