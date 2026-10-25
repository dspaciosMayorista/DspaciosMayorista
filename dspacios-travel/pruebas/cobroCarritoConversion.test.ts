// #90 F — conversión de una cotización de CARRITO a contrato(s): moneda de COBRO obligatoria y expresa, validada en el servidor.
// Misma arquitectura de simulación que conversionIncluidosEjecucion.test.ts (clientes en memoria, motor de reserva simulado), con un contador de
// numeración y un corte controlado del registro financiero del N-ésimo contrato para probar reintentos tras crear el primero.
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
async function convertir(nItems: number, eleccion: { monedaCobro?: string | null; trmCobro?: number | string | null }, agrupar: "todo" | "por_destino" = "todo", rol = "administracion", nTours = 0) {
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

describe("conversión de carrito: moneda de cobro obligatoria y expresa", () => {
  test("COP → USD: el contrato conserva COP y su precio; se cobra en USD (TRM 4100) redondeado al dólar hacia arriba; costos y CxP no cambian", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    const base = await convertir(1, { monedaCobro: "COP" }); // referencia SIN conversión
    assert.equal(base.ok, true, base.error);
    const cxpBase = JSON.stringify(financieros[0].cxp);
    const costosBase = JSON.stringify(financieros[0].costos);
    for (const k of Object.keys(db)) delete db[k]; financieros.length = 0; llamadasNumeracion = 0;

    await cotizar([item(1, 34)]);
    const r = await convertir(1, { monedaCobro: "USD", trmCobro: 4100 });
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta], ["COP", 600_000], "la oferta conserva su moneda e importe");
    assert.deepEqual([v.moneda_cobro, v.trm_cobro, v.total_cobro], ["USD", 4100, 147], "600.000 / 4.100 = 146,34 → 147 USD (una sola conversión, hacia arriba)");
    assert.equal(JSON.stringify(financieros[0].cxp), cxpBase, "las CxP no se reconvierten");
    assert.equal(JSON.stringify(financieros[0].costos), costosBase, "los costos no se reconvierten");
    assert.deepEqual((db.cotizaciones[0].detalle as { cobro: unknown }).cobro, { moneda: "USD", trm: 4100 }, "la elección queda congelada en la cotización");
  });

  test("USD → COP: oferta USD cobrada en pesos (TRM 4100): 300 × 4.100,5 → COP al mil hacia arriba (carrito sin obligaciones con proveedores)", async () => {
    cotizacionDirecta({ moneda: "USD", tours: [tour("Tour histórico", "CARTAGENA", 300, "USD")] });
    const r = await convertir(0, { monedaCobro: "COP", trmCobro: "4100.5" }, "todo", "administracion", 1);
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta], ["USD", 300]);
    assert.deepEqual([v.moneda_cobro, v.trm_cobro, v.total_cobro], ["COP", 4100.5, 1_231_000], "300 × 4.100,5 = 1.230.150 → 1.231.000");
  });
  test("misma moneda elegida de forma expresa (COP y USD): queda registrada, sin TRM ni total, aunque llegue una TRM", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    const r = await convertir(1, { monedaCobro: "COP", trmCobro: 4000 });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([db.ventas[0].moneda_cobro, db.ventas[0].trm_cobro, db.ventas[0].total_cobro], ["COP", null, null]);
    for (const k of Object.keys(db)) delete db[k]; financieros.length = 0; llamadasNumeracion = 0;
    cotizacionDirecta({ moneda: "USD", tours: [tour("Tour histórico", "CARTAGENA", 300, "USD")] });
    const r2 = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(r2.ok, true, r2.error);
    assert.deepEqual([db.ventas[0].moneda_cobro, db.ventas[0].trm_cobro, db.ventas[0].total_cobro], ["USD", null, null]);
    assert.deepEqual((db.cotizaciones[0].detalle as { cobro: unknown }).cobro, { moneda: "USD", trm: null });
  });

  test("omisión o invalidación: se rechaza ANTES de numerar o escribir nada (omitida, vacía, inválida, TRM faltante/cero/negativa/texto, rol sin permiso)", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    const casos: Array<[string, Parameters<typeof convertir>[1], RegExp, string?]> = [
      ["moneda omitida", {}, /Elige la moneda de cobro/],
      ["moneda null", { monedaCobro: null }, /Elige la moneda de cobro/],
      ["moneda vacía", { monedaCobro: "" }, /Elige la moneda de cobro/],
      ["moneda inválida", { monedaCobro: "EUR" }, /COP o USD/],
      ["otra moneda sin TRM", { monedaCobro: "USD" }, /exige la TRM de cobro/],
      ["TRM cero", { monedaCobro: "USD", trmCobro: 0 }, /TRM de cobro debe ser un número positivo/],
      ["TRM negativa", { monedaCobro: "USD", trmCobro: -5 }, /TRM de cobro debe ser un número positivo/],
      ["TRM texto", { monedaCobro: "USD", trmCobro: "abc" }, /TRM de cobro debe ser un número positivo/],
      ["TRM sin moneda", { trmCobro: 4000 }, /moneda de cobro debe ser COP o USD/],
      ["otra moneda sin ser personal interno", { monedaCobro: "USD", trmCobro: 4000 }, /Solo el personal interno/, "agencia"],
    ];
    for (const [que, eleccion, patron, rol] of casos) {
      const r = await convertir(1, eleccion, "todo", rol);
      assert.equal(r.ok, false, `${que}: debía rechazarse`);
      assert.match(r.error ?? "", patron, que);
      sinNumerar();
    }
  });

  test("varios destinos, «por destino»: UNA elección para todos; el total de CADA contrato se convierte por separado (151 + 101 USD); «todo» convierte el total único (251)", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_050), 2: hotel("Hotel Rodadero", "COP", 200_050) };
    await cotizar([item(1, 10, "CARTAGENA"), item(2, 11, "SANTA MARTA")]);
    const r = await convertir(2, { monedaCobro: "USD", trmCobro: 4000 }, "por_destino");
    assert.equal(r.ok, true, r.error);
    const vs = ventasOrdenadas();
    assert.equal(vs.length, 2, "un contrato por destino");
    assert.deepEqual(vs.map((v) => v.precio_venta), [600_100, 400_100], "las ofertas no cambian");
    assert.deepEqual(vs.map((v) => [v.moneda_cobro, v.trm_cobro, v.total_cobro]), [["USD", 4000, 151], ["USD", 4000, 101]], "cada contrato se convierte una vez y hacia arriba");

    for (const k of Object.keys(db)) delete db[k]; financieros.length = 0; llamadasNumeracion = 0;
    await cotizar([item(1, 10, "CARTAGENA"), item(2, 11, "SANTA MARTA")]);
    const r2 = await convertir(2, { monedaCobro: "USD", trmCobro: 4000 }, "todo");
    assert.equal(r2.ok, true, r2.error);
    assert.equal(db.ventas.length, 1);
    assert.deepEqual([db.ventas[0].precio_venta, db.ventas[0].moneda_cobro, db.ventas[0].total_cobro], [1_000_200, "USD", 251], "1.000.200 / 4.000 = 250,05 → 251");
  });

  test("reintento tras crear el primer contrato: otra moneda u otra TRM se rechaza; la misma elección continúa sin duplicar y con el mismo cobro", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_050), 2: hotel("Hotel Rodadero", "COP", 200_050) };
    await cotizar([item(1, 10, "CARTAGENA"), item(2, 11, "SANTA MARTA")]);
    fallarFinancieroEnLaLlamada = 2; // el segundo contrato falla; el primero queda completo
    const r1 = await convertir(2, { monedaCobro: "USD", trmCobro: 4000 }, "por_destino");
    assert.equal(r1.ok, false);
    assert.equal(db.ventas.length, 1, "solo el primer contrato quedó");
    const primero = { ...db.ventas[0] };
    assert.deepEqual((db.cotizaciones[0].detalle as { cobro: unknown }).cobro, { moneda: "USD", trm: 4000 }, "la elección se congeló con el primer contrato");
    fallarFinancieroEnLaLlamada = null;
    const numerosAntes = llamadasNumeracion;

    for (const [que, eleccion] of [
      ["otra TRM", { monedaCobro: "USD", trmCobro: 4100 }],
      ["otra moneda", { monedaCobro: "COP" }],
      ["omitida", {}],
    ] as const) {
      const r = await convertir(2, eleccion, "por_destino");
      assert.equal(r.ok, false, que);
      assert.match(r.error ?? "", que === "omitida" ? /Elige la moneda de cobro/ : /ya quedaron congeladas/, que);
      assert.equal(db.ventas.length, 1, `${que}: no se creó nada`);
      assert.equal(llamadasNumeracion, numerosAntes, `${que}: no se gastó consecutivo`);
    }
    const ok = await convertir(2, { monedaCobro: "USD", trmCobro: 4000 }, "por_destino");
    assert.equal(ok.ok, true, ok.error);
    const vs = ventasOrdenadas();
    assert.equal(vs.length, 2, "se completó el segundo, sin duplicar el primero");
    assert.deepEqual(vs[0], primero, "el primer contrato no se tocó");
    assert.deepEqual([vs[1].precio_venta, vs[1].moneda_cobro, vs[1].trm_cobro, vs[1].total_cobro], [400_100, "USD", 4000, 101]);
    assert.equal(db.cotizaciones[0].estado, "convertida");
  });

  test("una cotización ya convertida no admite una elección distinta de la congelada, pero devuelve los mismos contratos con la misma", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    const r1 = await convertir(1, { monedaCobro: "USD", trmCobro: 4100 });
    assert.equal(r1.ok, true, r1.error);
    const r2 = await convertir(1, { monedaCobro: "USD", trmCobro: 4000 });
    assert.equal(r2.ok, false);
    assert.match(r2.error ?? "", /ya quedaron congeladas/);
    const r3 = await convertir(1, { monedaCobro: "USD", trmCobro: 4100 });
    assert.equal(r3.ok, true);
    assert.deepEqual(r3.numeros, r1.numeros);
    assert.equal(db.ventas.length, 1);
  });

  test("conversión parcial ANTERIOR a este cambio (contratos sin elección congelada): solo continúa en la moneda de la oferta, sin TRM", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_050), 2: hotel("Hotel Rodadero", "COP", 200_050) };
    await cotizar([item(1, 10, "CARTAGENA"), item(2, 11, "SANTA MARTA")]);
    fallarFinancieroEnLaLlamada = 2;
    await convertir(2, { monedaCobro: "COP" }, "por_destino");
    fallarFinancieroEnLaLlamada = null;
    delete (db.cotizaciones[0].detalle as Record<string, unknown>).cobro; // como una conversión parcial previa al cambio
    const n = llamadasNumeracion;
    const r = await convertir(2, { monedaCobro: "USD", trmCobro: 4000 }, "por_destino");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /se cobran en la moneda de la oferta/);
    assert.equal(llamadasNumeracion, n);
    const ok = await convertir(2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(ok.ok, true, ok.error);
    assert.equal(db.ventas.length, 2);
  });
});

// ── Grupos de SOLO tours y monedas de las unidades (#90 F) ───────────────────────────────────────
// Un tour del payload trae su moneda (la fija el checkout). Estos casos arman la cotización a mano porque el checkout público no permite un carrito
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

describe("conversión de carrito: grupos de solo tours conservan la moneda de la oferta", () => {
  test("solo tours USD cobrados en USD: ventas.moneda = USD, el importe de la oferta intacto y SIN conversión", async () => {
    cotizacionDirecta({ moneda: "USD", tours: [tour("Islas del Rosario", "CARTAGENA", 100, "USD"), tour("Tour Ciudad", "CARTAGENA", 50, "USD")] });
    const r = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 2);
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta], ["USD", 150], "antes caía en COP");
    assert.deepEqual([v.moneda_cobro, v.trm_cobro, v.total_cobro], ["USD", null, null], "misma moneda: no convierte");
  });

  test("solo tours USD cobrados en COP: la TRM elegida se aplica UNA vez (150 × 4.100,5 = 615.075 → 616.000)", async () => {
    cotizacionDirecta({ moneda: "USD", tours: [tour("Islas del Rosario", "CARTAGENA", 100, "USD"), tour("Tour Ciudad", "CARTAGENA", 50, "USD")] });
    const r = await convertir(0, { monedaCobro: "COP", trmCobro: "4100.5" }, "todo", "administracion", 2);
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta], ["USD", 150]);
    assert.deepEqual([v.moneda_cobro, v.trm_cobro, v.total_cobro], ["COP", 4100.5, 616_000]);
  });

  test("«por destino» con un hotel USD y solo tours USD: el hotel tiene una obligación en USD, así que NADA se numera ni se crea (tampoco el grupo de tours)", async () => {
    HOTELES = { 3: hotel("Hotel Dólar", "USD", 150) };
    await cotizar([item(3, 20, "CARTAGENA")]);
    assert.equal(db.cotizaciones[0].moneda, "USD");
    (db.cotizaciones[0].payload as { tours: unknown[] }).tours = [tour("Tour Santa Marta", "SANTA MARTA", 150, "USD")];
    const r = await convertir(1, { monedaCobro: "COP", trmCobro: 4100 }, "por_destino", "administracion", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Hotel Hotel Dólar: su costo con el proveedor está en USD/);
    sinEscribir("hotel USD + tours USD");
  });

  test("«por destino» con DOS grupos de solo tours USD (sin obligaciones): ambos contratos USD con la MISMA elección de cobro, cada total convertido una vez", async () => {
    cotizacionDirecta({ moneda: "USD", tours: [tour("Tour Cartagena", "CARTAGENA", 300, "USD"), tour("Tour Santa Marta", "SANTA MARTA", 150, "USD")] });
    const r = await convertir(0, { monedaCobro: "COP", trmCobro: 4100 }, "por_destino", "administracion", 2);
    assert.equal(r.ok, true, r.error);
    const vs = ventasOrdenadas();
    assert.equal(vs.length, 2);
    assert.deepEqual(vs.map((v) => [v.moneda, v.precio_venta]), [["USD", 300], ["USD", 150]], "ambas ofertas en USD");
    assert.deepEqual(vs.map((v) => [v.moneda_cobro, v.trm_cobro, v.total_cobro]), [["COP", 4100, 1_230_000], ["COP", 4100, 615_000]]);
    assert.deepEqual((db.cotizaciones[0].detalle as { cobro: unknown }).cobro, { moneda: "COP", trm: 4100 });
  });
  test("datos incoherentes: una unidad en otra moneda se rechaza ANTES de numerar o escribir el primer contrato, aunque esté en el segundo grupo", async () => {
    HOTELES = { 3: hotel("Hotel Dólar", "USD", 150) };
    await cotizar([item(3, 20, "CARTAGENA")]);
    (db.cotizaciones[0].payload as { tours: unknown[] }).tours = [tour("Tour en pesos", "SANTA MARTA", 400_000, "COP")];
    const r = await convertir(1, { monedaCobro: "USD" }, "por_destino", "administracion", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Tour en pesos \(contrato SANTA MARTA\): su moneda \(COP\) no coincide con la de la cotización \(USD\)/);
    sinEscribir("por destino");

    // Mezcla dentro del mismo contrato («todo»): tampoco se suman importes de monedas distintas.
    const r2 = await convertir(1, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(r2.ok, false);
    assert.match(r2.error ?? "", /Tour en pesos.*no coincide/);
    sinEscribir("todo");
  });

  test("cotización histórica SIN moneda: se toma la de sus unidades explícitas (USD); si discrepan, se rechaza sin escribir", async () => {
    cotizacionDirecta({ moneda: null, tours: [tour("Tour A", "CARTAGENA", 100, "USD"), tour("Tour B", "CARTAGENA", 50, "USD")] });
    const ok = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 2);
    assert.equal(ok.ok, true, ok.error);
    assert.deepEqual([db.ventas[0].moneda, db.ventas[0].precio_venta, db.ventas[0].moneda_cobro, db.ventas[0].total_cobro], ["USD", 150, "USD", null]);

    limpiarTodo();
    cotizacionDirecta({ moneda: null, tours: [tour("Tour A", "CARTAGENA", 100, "USD"), tour("Tour B", "SANTA MARTA", 400_000, "COP")] });
    const mala = await convertir(0, { monedaCobro: "USD" }, "por_destino", "administracion", 2);
    assert.equal(mala.ok, false);
    assert.match(mala.error ?? "", /no coincide con la de la cotización/);
    sinEscribir("histórica incoherente");
  });

  test("un tour histórico SIN moneda declarada hereda la de la cotización (no se le inventa otra)", async () => {
    cotizacionDirecta({ moneda: "USD", tours: [tour("Tour viejo", "CARTAGENA", 80)] });
    const r = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([db.ventas[0].moneda, db.ventas[0].precio_venta], ["USD", 80]);
  });

  test("reintento tras el primer grupo (solo tours USD) con el segundo (solo tours USD) caído: otra TRM se rechaza; la misma completa con USD y el mismo cobro", async () => {
    cotizacionDirecta({ moneda: "USD", tours: [tour("Tour Cartagena", "CARTAGENA", 300, "USD"), tour("Tour Santa Marta", "SANTA MARTA", 150, "USD")] });
    fallarFinancieroEnLaLlamada = 2; // cae el segundo contrato
    const r1 = await convertir(0, { monedaCobro: "COP", trmCobro: 4100 }, "por_destino", "administracion", 2);
    assert.equal(r1.ok, false);
    assert.equal(db.ventas.length, 1, "solo el primer contrato quedó");
    const primero = { ...db.ventas[0] };
    assert.deepEqual([primero.moneda, primero.moneda_cobro, primero.total_cobro], ["USD", "COP", 1_230_000]);
    fallarFinancieroEnLaLlamada = null;
    const n = llamadasNumeracion;

    for (const [que, eleccion] of [["otra TRM", { monedaCobro: "COP", trmCobro: 4000 }], ["otra moneda", { monedaCobro: "USD" }]] as const) {
      const r = await convertir(0, eleccion, "por_destino", "administracion", 2);
      assert.equal(r.ok, false, que);
      assert.match(r.error ?? "", /ya quedaron congeladas/, que);
      assert.equal(db.ventas.length, 1, que);
      assert.equal(llamadasNumeracion, n, `${que}: no se gastó consecutivo`);
    }
    const ok = await convertir(0, { monedaCobro: "COP", trmCobro: 4100 }, "por_destino", "administracion", 2);
    assert.equal(ok.ok, true, ok.error);
    const vs = ventasOrdenadas();
    assert.equal(vs.length, 2);
    assert.deepEqual(vs[0], primero, "el primer contrato no se tocó");
    assert.deepEqual([vs[1].moneda, vs[1].precio_venta, vs[1].moneda_cobro, vs[1].trm_cobro, vs[1].total_cobro], ["USD", 150, "COP", 4100, 615_000]);
  });
});

// ── Moneda REAL de costos y CxP del carrito (#90 F) ──────────────────────────────────────────────
// Reproduce el caso real: carrito USD con un tour con servicioId y costo neto positivo. Antes de este cambio la venta quedaba en USD pero la CxP llegaba a
// registrarFinancieroContrato SIN moneda (la base la guarda como COP) y su asiento devengaba el nominal en dólares como pesos. Ahora la moneda real de cada
// costo viaja EXPLÍCITA, y una obligación en USD detiene la conversión ANTES de numerar o escribir (la ruta financiera del carrito no tiene equivalente COP).
const proveedorRosario = { nombre: "Rosario Tours", aplica_retencion: false, pct_retencion: 0 };
function servicioConCosto(servicioId: number, monedaServicio: string | undefined, precioPersona = 100) {
  CATALOGO_SERVICIO[servicioId] = { id: servicioId, ...(monedaServicio === undefined ? {} : { moneda: monedaServicio }), proveedores: proveedorRosario };
  (db.armado_servicios ??= []).push({
    paquete_id: 34, servicio_id: servicioId, modo: "persona",
    servicios_adicionales: { precio_persona: precioPersona, recargo_individual: null, categoria: "tour_traslado", nombre: "Islas del Rosario", liquidacion: "paquete", proveedor_id: 5, proveedores: proveedorRosario },
  });
}
async function cotizacionDirectaConItems(items: unknown[]) { cotizacionDirecta({ moneda: "COP", items, tours: [] }); }
const tourConServicio = (servicioId: number, moneda: string, precio: number) => ({ ...tour("Islas del Rosario", "CARTAGENA", precio, moneda), servicioId, paqueteId: 34 });

describe("CxP del carrito: moneda real de cada costo, sin asignar USD en bloque", () => {
  test("REPRODUCCIÓN: carrito USD con un tour (servicioId, costo neto positivo): se detiene ANTES de numerar; no se crea contrato ni obligación mal denominada", async () => {
    servicioConCosto(20, "USD");
    cotizacionDirecta({ moneda: "USD", tours: [tourConServicio(20, "USD", 300)] });
    const r = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Islas del Rosario: su costo con el proveedor está en USD y la ruta financiera del carrito todavía no registra obligaciones en dólares/);
    sinEscribir("tour USD con costo neto");
    assert.equal(db.cotizaciones[0].estado, "abierta");
  });

  test("USD con una moneda del servicio indeterminable (columna ausente): en un contrato USD no se asume nada y se detiene antes de numerar", async () => {
    servicioConCosto(22, undefined);
    cotizacionDirecta({ moneda: "USD", tours: [tourConServicio(22, "USD", 300)] });
    const r = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /no se puede determinar la moneda de su costo/);
    sinEscribir("servicio sin moneda en contrato USD");
  });

  test("COP: el mismo tour con servicioId en un carrito COP registra su CxP con moneda COP EXPLÍCITA y el importe nominal intacto (cobro en USD no la toca)", async () => {
    servicioConCosto(21, "COP", 100_000);
    cotizacionDirecta({ moneda: "COP", tours: [tourConServicio(21, "COP", 300_000)] });
    const r = await convertir(0, { monedaCobro: "USD", trmCobro: 4000 }, "todo", "administracion", 1);
    assert.equal(r.ok, true, r.error);
    const [v] = db.ventas;
    assert.deepEqual([v.moneda, v.precio_venta, v.moneda_cobro, v.trm_cobro, v.total_cobro], ["COP", 300_000, "USD", 4000, 75]);
    assert.equal(financieros.length, 1);
    const cxp = financieros[0].cxp;
    assert.equal(cxp.length, 1);
    assert.deepEqual([cxp[0].tipo_proveedor, cxp[0].valor_total, (cxp[0] as unknown as { moneda: string }).moneda, cxp[0].servicio_id], ["receptivo", 200_000, "COP", 21], "nominal sin convertir y con moneda explícita");
    assert.deepEqual(financieros[0].costos, { costo_aereo: 0, costo_hotel: 0, costo_receptivo: 200_000 });
  });

  test("un servicio en USD dentro de un carrito COP es una obligación en USD: se detiene aunque el contrato sea COP (no se asigna la moneda del contrato)", async () => {
    servicioConCosto(20, "USD");
    cotizacionDirecta({ moneda: "COP", tours: [tourConServicio(20, "COP", 300_000)] });
    const r = await convertir(0, { monedaCobro: "COP" }, "todo", "administracion", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /su costo con el proveedor está en USD/);
    sinEscribir("servicio USD en contrato COP");
  });

  test("hotel por persona COP: su CxP lleva moneda COP explícita y el importe nominal de siempre", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    const r = await convertir(1, { monedaCobro: "COP" });
    assert.equal(r.ok, true, r.error);
    const hotelCxp = financieros[0].cxp.find((c) => c.tipo_proveedor === "hotel") as unknown as { valor_total: number; moneda: string };
    assert.deepEqual([hotelCxp.valor_total, hotelCxp.moneda], [420_000, "COP"], "neto 210.000 × 2 pax, sin convertir, con moneda explícita");
  });

  test("hotel por persona USD: su obligación en dólares detiene la conversión antes de numerar", async () => {
    HOTELES = { 3: hotel("Hotel Dólar", "USD", 150) };
    await cotizar([item(3, 20)]);
    const r = await convertir(1, { monedaCobro: "USD" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Hotel Hotel Dólar: su costo con el proveedor está en USD/);
    sinEscribir("hotel USD");
  });

  // Vuelo de un BLOQUEO (aéreo por persona): la moneda sale del bloqueo, no del contrato.
  const itemBloqueo = () => ({ ...item(1, 34), modulo: "bloqueo", bloqueoId: 31 });
  const montarBloqueo = (monedaBloqueo: string | undefined) => {
    (db.bloqueos_vuelo ??= []).push({
      id: 31, aerolinea: "Avianca", ...(monedaBloqueo === undefined ? {} : { moneda: monedaBloqueo }), record: "L93FYZ", ruta: "BOG - CTG - BOG", tarifa_para_empaquetar: 500_000, fee_infante: 0,
      fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04", vuelo_ida: "AV1", vuelo_regreso: "AV2", proveedores: { nombre: "Avianca SA", aplica_retencion: false, pct_retencion: 0 },
    });
    (db.cupos_por_bloqueo ??= []).push({ id: 31, cupos_disponibles: 10 });
  };

  test("aéreo de un bloqueo COP: CxP aérea con moneda COP explícita e importe nominal (500.000 × 2 pax con silla)", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizacionDirectaConItems([itemBloqueo()]);
    montarBloqueo("COP");
    const r = await convertir(1, { monedaCobro: "COP" });
    assert.equal(r.ok, true, r.error);
    const aereo = financieros[0].cxp.find((c) => c.tipo_proveedor === "aereo") as unknown as { valor_total: number; moneda: string };
    assert.deepEqual([aereo.valor_total, aereo.moneda], [1_000_000, "COP"]);
  });

  test("aéreo de un bloqueo en USD dentro de un contrato COP: obligación en USD → se detiene antes de numerar (no se le asigna COP por la moneda del contrato)", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizacionDirectaConItems([itemBloqueo()]);
    montarBloqueo("USD");
    const r = await convertir(1, { monedaCobro: "COP" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Vuelo de OZ HOTEL: su costo con el proveedor está en USD/);
    sinEscribir("vuelo USD en contrato COP");
  });

  test("aéreo de un bloqueo sin moneda acreditada en un contrato COP: se registra como COP (el default histórico, explícito); la CxP no queda sin moneda", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizacionDirectaConItems([itemBloqueo()]);
    montarBloqueo(undefined);
    const r = await convertir(1, { monedaCobro: "COP" });
    assert.equal(r.ok, true, r.error);
    assert.equal((financieros[0].cxp.find((c) => c.tipo_proveedor === "aereo") as unknown as { moneda: string }).moneda, "COP");
  });

  test("reintento tras el primer contrato en un carrito COP con CxP: la elección congelada manda y las CxP del segundo llevan su moneda real explícita", async () => {
    servicioConCosto(21, "COP", 100_000);
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_050) };
    await cotizar([item(1, 10, "CARTAGENA")]);
    (db.cotizaciones[0].payload as { tours: unknown[] }).tours = [{ ...tourConServicio(21, "COP", 300_000), destino: "SANTA MARTA" }];
    fallarFinancieroEnLaLlamada = 2;
    const r1 = await convertir(1, { monedaCobro: "USD", trmCobro: 4000 }, "por_destino", "administracion", 1);
    assert.equal(r1.ok, false);
    assert.equal(db.ventas.length, 1);
    fallarFinancieroEnLaLlamada = null;
    const bad = await convertir(1, { monedaCobro: "USD", trmCobro: 4100 }, "por_destino", "administracion", 1);
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /ya quedaron congeladas/);
    const ok = await convertir(1, { monedaCobro: "USD", trmCobro: 4000 }, "por_destino", "administracion", 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(db.ventas.length, 2);
    const cxps = financieros.flatMap((f) => f.cxp) as unknown as Array<{ tipo_proveedor: string; valor_total: number; moneda: string }>;
    assert.ok(cxps.length >= 2 && cxps.every((c) => c.moneda === "COP"), JSON.stringify(cxps));
    assert.equal(cxps.find((c) => c.tipo_proveedor === "receptivo")?.valor_total, 200_000, "nominal intacto");
  });
});

// ── Solo las CxP que REALMENTE se crearían (importe positivo) se evalúan (#90 F) ────────────────────
// La revisión previa usa las mismas fórmulas y condiciones que la creación (lib/reservar/costosObligacionesCarrito.ts + decidirCxP): un costo USD en cero no
// crea CxP y no bloquea; uno positivo sí la crearía y detiene la conversión antes de numerar.
const incluido = (costoNeto: number) => ({ servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "asistencia" as const, incluido: true as const, costoNeto, proveedorId: 5 });
const hotelConIncluido = (moneda: string, pvp: number, costoNeto: number): HotelSim => ({ ...hotel("OZ HOTEL", moneda, pvp), incluidos: [incluido(costoNeto)] });

describe("revisión previa de moneda: costo USD cero no bloquea, costo USD positivo sí", () => {
  const itemBloqueo = () => ({ ...item(1, 34), modulo: "bloqueo", bloqueoId: 31 });
  const montarBloqueo = (moneda: string) => {
    (db.bloqueos_vuelo ??= []).push({
      id: 31, aerolinea: "Avianca", moneda, record: "L93FYZ", ruta: "BOG - CTG - BOG", tarifa_para_empaquetar: 500_000, fee_infante: 0,
      fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04", vuelo_ida: "AV1", vuelo_regreso: "AV2", proveedores: { nombre: "Avianca SA", aplica_retencion: false, pct_retencion: 0 },
    });
    (db.cupos_por_bloqueo ??= []).push({ id: 31, cupos_disponibles: 10 });
  };
  test("tour USD con servicioId: costo neto CERO → se convierte (venta USD, sin CxP); costo neto POSITIVO → se detiene antes de numerar", async () => {
    servicioConCosto(20, "USD", 0);
    cotizacionDirecta({ moneda: "USD", tours: [tourConServicio(20, "USD", 300)] });
    const cero = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(cero.ok, true, cero.error);
    assert.deepEqual([db.ventas[0].moneda, db.ventas[0].precio_venta], ["USD", 300]);
    assert.deepEqual(financieros[0].cxp, [], "con costo cero no se crea ninguna obligación");

    limpiarTodo();
    servicioConCosto(20, "USD", 100);
    cotizacionDirecta({ moneda: "USD", tours: [tourConServicio(20, "USD", 300)] });
    const pos = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(pos.ok, false);
    assert.match(pos.error ?? "", /Islas del Rosario: su costo con el proveedor está en USD/);
    sinEscribir("tour USD positivo");
  });

  test("tour cuyo servicio ya no está en el paquete: no genera CxP, así que su moneda no se evalúa (se convierte)", async () => {
    CATALOGO_SERVICIO[23] = { id: 23, moneda: "USD", proveedores: proveedorRosario }; // sin fila en armado_servicios
    cotizacionDirecta({ moneda: "USD", tours: [tourConServicio(23, "USD", 300)] });
    const r = await convertir(0, { monedaCobro: "USD" }, "todo", "administracion", 1);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(financieros[0].cxp, []);
  });

  test("servicio INCLUIDO en USD de un hotel COP: costo cero → se convierte sin esa CxP; costo positivo → se detiene antes de numerar", async () => {
    CATALOGO_SERVICIO[9] = { ...CATALOGO_SERVICIO[9], moneda: "USD" };
    HOTELES = { 1: hotelConIncluido("COP", 300_000, 0) };
    await cotizar([item(1, 34)]);
    const cero = await convertir(1, { monedaCobro: "COP" });
    assert.equal(cero.ok, true, cero.error);
    const tipos = financieros[0].cxp.map((c) => c.tipo_proveedor);
    assert.deepEqual(tipos, ["hotel"], "solo la CxP del hotel (COP); el incluido en cero no crea obligación");
    assert.equal((financieros[0].cxp[0] as unknown as { moneda: string }).moneda, "COP");

    limpiarTodo();
    HOTELES = { 1: hotelConIncluido("COP", 300_000, 40_000) };
    await cotizar([item(1, 34)]);
    const pos = await convertir(1, { monedaCobro: "COP" });
    assert.equal(pos.ok, false);
    assert.match(pos.error ?? "", /ASISTENCIA MEDICA: su costo con el proveedor está en USD/);
    sinEscribir("incluido USD positivo");
  });

  test("hotel por persona en USD: neto CERO → se convierte sin CxP de hotel; neto POSITIVO → se detiene antes de numerar", async () => {
    HOTELES = { 3: { ...hotel("Hotel Dólar", "USD", 150), neto: 0 } };
    await cotizar([item(3, 20)]);
    const cero = await convertir(1, { monedaCobro: "USD" });
    assert.equal(cero.ok, true, cero.error);
    assert.deepEqual([db.ventas[0].moneda, db.ventas[0].precio_venta], ["USD", 300]);
    assert.deepEqual(financieros[0].cxp, [], "con neto cero no hay obligación con el hotel");

    limpiarTodo();
    HOTELES = { 3: hotel("Hotel Dólar", "USD", 150) };
    await cotizar([item(3, 20)]);
    const pos = await convertir(1, { monedaCobro: "USD" });
    assert.equal(pos.ok, false);
    assert.match(pos.error ?? "", /Hotel Hotel Dólar: su costo con el proveedor está en USD/);
    sinEscribir("hotel USD positivo");
  });

  test("vuelo de un bloqueo en USD: tarifa y fee CERO → se convierte sin CxP aérea; tarifa POSITIVA → se detiene antes de numerar", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizacionDirectaConItems([itemBloqueo()]);
    montarBloqueo("USD");
    Object.assign(db.bloqueos_vuelo[0], { tarifa_para_empaquetar: 0, fee_infante: 0 });
    const cero = await convertir(1, { monedaCobro: "COP" });
    assert.equal(cero.ok, true, cero.error);
    assert.deepEqual(financieros[0].cxp.map((c) => c.tipo_proveedor), ["hotel"], "el vuelo en cero no crea obligación");

    limpiarTodo();
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizacionDirectaConItems([itemBloqueo()]);
    montarBloqueo("USD");
    const pos = await convertir(1, { monedaCobro: "COP" });
    assert.equal(pos.ok, false);
    assert.match(pos.error ?? "", /Vuelo de OZ HOTEL: su costo con el proveedor está en USD/);
    sinEscribir("vuelo USD positivo");
  });
});

describe("la revisión previa y pushCxP deciden igual", () => {
  test("el fuente usa UNA sola decisión (decidirCxP) y las MISMAS funciones de costo en la revisión previa y en la creación", () => {
    const src = fs.readFileSync(new URL("../app/(dashboard)/dashboard/reservar/actions.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const cuerpo = src.slice(src.indexOf("export async function convertirCotizacionCarrito("));
    const previa = cuerpo.slice(cuerpo.indexOf("Obligaciones (CxP) de la conversión"), cuerpo.indexOf("`contratosPorGrupo`/`claveDeGrupo`/`detalleBase` ya se inicializaron"));
    const creacion = cuerpo.slice(cuerpo.indexOf("const estadoObligaciones"));
    assert.match(previa, /evaluarObligaciones\(/);
    assert.match(creacion, /decidirCxP\(\{ origen: servicio, moneda: monedaCosto, valor, monedaContrato: monedaGrupo \}\)/);
    for (const fn of ["costoHotelPersona(", "costoAereoBloqueo(", "costoVueloBernalo(", "costoTourParaCxP(", "liquidarCostoTour("]) {
      assert.ok(previa.includes(fn), `la revisión previa no usa ${fn}`);
      assert.ok(creacion.includes(fn), `la creación no usa ${fn}`);
    }
    // Las fórmulas en línea ya no existen: una sola fuente.
    assert.doesNotMatch(cuerpo, /netoPorAcom\["nino"\] \* numNinos/);
    assert.doesNotMatch(cuerpo, /Number\(bq\.tarifa_para_empaquetar\) \|\| 0\) \* paxConSilla/);
    assert.doesNotMatch(cuerpo, /dv\.costo_neto \* resultado\.paxConSilla/);
    assert.doesNotMatch(cuerpo, /precioServicio\(modo, netoPersona/);
  });
});
