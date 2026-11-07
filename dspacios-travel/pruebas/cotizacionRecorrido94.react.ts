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
// Composición que produciría el motor para el hotel (solo el hotel: los tours y servicios manuales del carrito se cobran fuera de ella).
let COMPOSICION_SIM: Record<string, unknown> | null = null;
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
          serviciosIncluidos: h.incluidos, distribucionMenores: [], condicionesTarifa: null, composicion: COMPOSICION_SIM,
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
  COMPOSICION_SIM = null;
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
    // Estructura de siempre: una fila por grupo (Ítem · Adultos · Niños · Tarifa Adulto · Tarifa Niño · Valor total), Ítem = «Paquete Turístico {Destino}».
    const filas = [...html.matchAll(/<tr[^>]*data-testid="resumen-grupo"[^>]*>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/\s+/g, "")));
    assert.deepEqual(filas.map((f) => [f[0], f[1], f[3], f[5]]), [
      ["PaqueteTurísticoCARTAGENA", "1", $(500_000), $(500_000)], ["PaqueteTurísticoCARTAGENA", "1", $(400_000), $(400_000)], ["PaqueteTurísticoCARTAGENA", "1", $(400_000), $(400_000)],
    ], "tres filas separadas: tienen servicios distintos aunque dos coincidan en tarifa");
    assert.ok(sinEspacios(t).includes(sinEspacios($(1_300_000))), "el total");
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

const { ComposicionPrecio } = await import("../components/cotizacion/ComposicionPrecio.tsx");
const { leerComposicionCotizacion } = await import("../lib/cotizacion/composicionPrecio.ts");

// ── Composición INTERNA: caso observado (alojamiento 1.104.000 + adicionales 90.000 y 142.000 = total 1.336.000) ──
describe("#94 composición interna: concilia hotel + servicios del carrito con el total guardado", () => {
  const compHotel = (total: number) => ({
    version: 1, moneda: "COP", trm: null, markup: { tipo: "global", pct: 0.2 }, impuestoIncluido: 0, adicionales: [], total, cuadra: true,
    lineas: [{ clave: "doble", etiqueta: "1 hab Doble (2 pax)", pax: 2, pvpPorPersona: total / 2, total, componentes: [{ tipo: "hotel", nombre: "Hotel", neto: 400_000, venta: total / 2 }] }],
  });
  const montar = () => {
    HOTELES = { 1: { nombre: "OZ HOTEL CARTAGENA", moneda: "COP", pvp: 552_000, neto: 400_000, cargoGrupo: 0, incluidos: [] } };
    COMPOSICION_SIM = compHotel(1_104_000);
    TOUR_SIM = { ...TOUR, pax: 2, total: 90_000 };
    TOUR_POR_ID = { 12: { servicioId: 12, nombre: "Tour Islas", total: 90_000 }, 13: { servicioId: 13, nombre: "City tour", total: 142_000 } };
    usuario = null;
  };
  const emitir = () => crearSolicitudReserva({
    items: [{ ...item(1, 34), itemId: "h1" }],
    tours: [{ ...tourEntrada, servicioId: 12, nombre: "Tour Islas", pax: 2 }, { ...tourEntrada, servicioId: 13, nombre: "City tour", pax: 2 }],
    cliente: clienteCot, cobertura: { tours: { 0: { hotel: 0 }, 1: { hotel: 0 } } },
  }) as Promise<{ ok: boolean; error?: string }>;
  const ficha = (guardada: unknown, total: number | null) => renderToStaticMarkup(createElement(ComposicionPrecio as never, { guardada, totalCotizacion: total } as never)).replace(/&nbsp;| /g, " ");
  const plano = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  test("ORIGEN: lo guardado ya incluye los adicionales (antes solo el hotel: 1.104.000 frente a un total de 1.336.000)", async () => {
    montar();
    const r = await emitir();
    assert.equal(r.ok, true, r.error);
    assert.equal(db.cotizaciones[0].precio_venta, 1_336_000);
    const guardado = JSON.parse(JSON.stringify(db.cotizacion_composicion[0].composicion));
    assert.equal(guardado.hoteles[0].composicion.total, 1_104_000, "la composición del hotel no se toca");
    assert.deepEqual(guardado.servicios.map((x: { nombre: string; total: number; tipo: string }) => [x.nombre, x.total, x.tipo]), [["Tour Islas", 90_000, "tour"], ["City tour", 142_000, "tour"]]);
    assert.equal(guardado.total, 1_336_000);
    assert.ok(!JSON.stringify(guardado.servicios).match(/neto/i), "no se inventa un neto para los servicios");
  });

  test("la ficha interna muestra el hotel, cada servicio y la conciliación con el total", async () => {
    montar();
    await emitir();
    const guardada = leerComposicionCotizacion(JSON.parse(JSON.stringify(db.cotizacion_composicion[0].composicion)));
    assert.ok(guardada);
    const t = plano(ficha(guardada, db.cotizaciones[0].precio_venta as number));
    for (const frag of ["1 hab Doble (2 pax)", "Tour Islas", "City tour"]) assert.ok(t.includes(frag), frag);
    for (const n of [1_104_000, 90_000, 142_000, 1_336_000]) assert.ok(sinEspacios(t).includes(sinEspacios(formatMoneda(n, "COP"))), String(n));
    assert.match(ficha(guardada, 1_336_000), /data-testid="composicion-cuadra"/);
    assert.doesNotMatch(ficha(guardada, 1_336_000), /composicion-difiere/);
  });

  test("si el total vigente no coincide con hotel + servicios se avisa (nunca se oculta la diferencia)", async () => {
    montar();
    await emitir();
    const guardada = leerComposicionCotizacion(JSON.parse(JSON.stringify(db.cotizacion_composicion[0].composicion)));
    assert.match(ficha(guardada, 1_300_000), /data-testid="composicion-difiere"/);
  });

  test("una composición guardada antes (solo hotel) se declara incompleta en vez de pasar por buena", () => {
    const vieja = leerComposicionCotizacion({ version: 1, hoteles: [{ ref: "item-0", nombre: "OZ", composicion: compHotel(1_104_000) }] });
    const h = ficha(vieja, 1_336_000);
    assert.match(h, /composicion-difiere/);
    assert.match(plano(h), /antes de conservar los servicios del carrito/);
  });

  test("el documento del cliente de ese mismo caso muestra solo precios completos por pasajero y el total", async () => {
    montar();
    await emitir();
    const html = imprimir(JSON.parse(JSON.stringify(db.cotizaciones[0].detalle)) as Detalle);
    const t = planoTxt(html);
    assert.ok(sinEspacios(t).includes(sinEspacios(formatMoneda(1_336_000, "COP"))));
    assert.equal(sinEspacios(t).includes(sinEspacios(formatMoneda(90_000, "COP"))), false);
    assert.equal(sinEspacios(t).includes(sinEspacios(formatMoneda(142_000, "COP"))), false);
    assert.doesNotMatch(t, /Composici[oó]n|Neto p\/p|markup/i);
  });
});

// ── Ítem editable en cotizaciones exclusivamente de Tarifario (sin servicios manuales ni adicionales) ──
describe("#94 Ítem del paquete: valor por defecto, edición sin manuales, guardar, reabrir e imprimir", () => {
  const filas = (html: string) => [...html.matchAll(/<tr[^>]*data-testid="resumen-grupo"[^>]*>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim()));
  const emitirTarifario = (extra: Record<string, unknown> = {}) => crearSolicitudReserva({ items: [item(1, 34)], tours: [], cliente: clienteCot, ...extra }) as Promise<{ ok: boolean; error?: string }>;

  test("por defecto: «Paquete Turístico {Destino}», no el hotel, la categoría ni los servicios", async () => {
    HOTELES = { 1: ozCon([]) };
    usuario = null;
    assert.equal((await emitirTarifario()).ok, true);
    const html = imprimir(JSON.parse(JSON.stringify(db.cotizaciones[0].detalle)) as Detalle);
    const f = filas(html);
    assert.deepEqual(f.map((x) => [x[0], x[1], x[2]]), [["Paquete Turístico CARTAGENA", "2", "0"]]);
    assert.doesNotMatch(f[0][0], /OZ|HOTEL|Estandar|Desayuno/i);
  });

  test("editado sin manuales: se guarda, y al reabrir e imprimir sale el mismo texto con los mismos valores", async () => {
    HOTELES = { 1: ozCon([]) };
    usuario = null;
    assert.equal((await emitirTarifario({ tituloPaquete: "Escapada Caribe 2030" })).ok, true);
    const guardado = JSON.parse(JSON.stringify(db.cotizaciones[0].detalle)) as Detalle;
    assert.equal(guardado.tituloPaquete, "Escapada Caribe 2030");
    const html = imprimir(guardado);
    assert.deepEqual(filas(html).map((x) => x[0]), ["Escapada Caribe 2030"]);
    assert.equal(imprimir(JSON.parse(JSON.stringify(guardado))), html, "reapertura idéntica");
    assert.ok(sinEspacios(planoTxt(html)).includes(sinEspacios(formatMoneda(600_000, "COP"))));
  });

  test("las descripciones del hotel siguen en su lugar (sección de alojamiento), fuera de la columna Ítem", async () => {
    HOTELES = { 1: ozCon([]) };
    usuario = null;
    await emitirTarifario();
    const d = JSON.parse(JSON.stringify(db.cotizaciones[0].detalle)) as Detalle;
    const t = planoTxt(imprimir(d));
    assert.match(t, /OZ HOTEL CARTAGENA/, "el hotel aparece en el documento");
    assert.match(d.hoteles[0].nombre ?? "", /OZ HOTEL CARTAGENA/);
  });
});

// ── Fixtures para capturas comparables (solo con CAPTURAS_94=<carpeta>; en la corrida normal se omite) ──
// Escribe el HTML del documento del cliente y de la ficha interna (componente `ComposicionPrecio`) del mismo caso, SIN navegador ni base real:
// son salidas de los componentes reales con datos simulados.
describe("#94 fixtures de captura (solo con CAPTURAS_94)", { skip: !process.env.CAPTURAS_94 }, () => {
  const compHotel = (total: number, pax: number) => ({
    version: 1, moneda: "COP", trm: null, markup: { tipo: "global", pct: 0.2 }, impuestoIncluido: 0, adicionales: [], total, cuadra: true,
    lineas: [{ clave: "doble", etiqueta: `1 hab Doble (${pax} pax)`, pax, pvpPorPersona: total / pax, total, componentes: [{ tipo: "hotel", nombre: "Hotel", neto: 400_000, venta: total / pax }] }],
  });
  test("escribe los fixtures", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const dir = process.env.CAPTURAS_94 as string;
    mkdirSync(dir, { recursive: true });
    // Caso observado: alojamiento 1.104.000 + adicionales 90.000 y 142.000 = 1.336.000.
    HOTELES = { 1: { nombre: "OZ HOTEL CARTAGENA", moneda: "COP", pvp: 552_000, neto: 400_000, cargoGrupo: 0, incluidos: [] } };
    COMPOSICION_SIM = compHotel(1_104_000, 2);
    TOUR_SIM = { ...TOUR, pax: 2, total: 90_000 };
    TOUR_POR_ID = { 12: { servicioId: 12, nombre: "Tour Islas", total: 90_000 }, 13: { servicioId: 13, nombre: "City tour", total: 142_000 } };
    usuario = null;
    const r = await crearSolicitudReserva({
      items: [{ ...item(1, 34), itemId: "h1" }], tituloPaquete: "Paquete Turístico Cartagena 3 noches",
      tours: [{ ...tourEntrada, servicioId: 12, nombre: "Tour Islas", pax: 2 }, { ...tourEntrada, servicioId: 13, nombre: "City tour", pax: 2 }],
      cliente: clienteCot, cobertura: { tours: { 0: { hotel: 0 }, 1: { hotel: 0 } } },
    }) as { ok: boolean; error?: string };
    assert.equal(r.ok, true, r.error);
    const detalle = JSON.parse(JSON.stringify(db.cotizaciones[0].detalle));
    const despues = leerComposicionCotizacion(JSON.parse(JSON.stringify(db.cotizacion_composicion[0].composicion)));
    const antes = leerComposicionCotizacion({ version: 1, hoteles: [{ ref: "item-0", nombre: "OZ", composicion: compHotel(1_104_000, 2) }] });
    const ficha = (g: unknown) => renderToStaticMarkup(createElement(ComposicionPrecio as never, { guardada: g, totalCotizacion: 1_336_000 } as never));
    writeFileSync(`${dir}/documento.html`, imprimir(detalle));
    writeFileSync(`${dir}/ficha_antes.html`, ficha(antes));
    writeFileSync(`${dir}/ficha_despues.html`, ficha(despues));
    // Servicios parciales y superpuestos sobre 3 pasajeros (Tour A: 2 de la doble; Tour B: 1 de la doble y la sencilla).
    HOTELES = { 1: { nombre: "OZ HOTEL CARTAGENA", moneda: "COP", pvp: 300_000, neto: 200_000, cargoGrupo: 0, incluidos: [] } };
    COMPOSICION_SIM = null;
    TOUR_SIM = { ...TOUR, pax: 2, total: 200_000 };
    TOUR_POR_ID = { 12: { servicioId: 12, nombre: "Tour A", total: 200_000 }, 13: { servicioId: 13, nombre: "Tour B", total: 200_000 } };
    for (const k of Object.keys(db)) delete db[k];
    const r2 = await crearSolicitudReserva({
      items: [{ ...item(1, 34), habitaciones: { doble: 1, sencilla: 1 }, pax: 3 }],
      tours: [{ ...tourEntrada, servicioId: 12, nombre: "Tour A", pax: 2 }, { ...tourEntrada, servicioId: 13, nombre: "Tour B", pax: 2 }],
      cliente: clienteCot,
      cobertura: { cupos: { 0: { "adulto:doble": [1, 2], "adulto:sencilla": [1] } }, tours: { 0: { hotel: 0, cubre: ["adulto:doble#1", "adulto:doble#2"] }, 1: { hotel: 0, cubre: ["adulto:doble#2", "adulto:sencilla#1"] } } },
    }) as { ok: boolean; error?: string };
    assert.equal(r2.ok, true, r2.error);
    writeFileSync(`${dir}/documento_parciales.html`, imprimir(JSON.parse(JSON.stringify(db.cotizaciones[0].detalle))));
  });
});
