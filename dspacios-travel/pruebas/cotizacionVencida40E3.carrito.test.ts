// #40 E3 — cotización vencida en el carrito/tarifario (creación pública, conversión, reintentos) y renovación de la vigencia por rol.
// Mismo arnés que cobroCarritoConversion.test.ts (clientes en memoria, motor de reserva simulado); el contexto de acceso es variable (CTX).
// numeración y un corte controlado del registro financiero del N-ésimo contrato para probar reintentos tras crear el primero.
import { test, describe, mock, beforeEach, afterEach } from "node:test";
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
const rpcLog: string[] = [];
let CTX: Record<string, unknown> = { ok: true, superadmin: true, tenant: "mayorista" };
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
      if (op === "update") { const hit = (db[tabla] ?? []).filter(coincide); for (const f of hit) Object.assign(f, patch); return { data: hit.map((f) => ({ id: f.id })), error: null }; }
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
      rpcLog.push(fn);
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
  namedExports: { contextoCotizacion: async () => CTX, autorizaTenant: () => true },
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
  rpcLog.length = 0;
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

// ── #40 E3 ───────────────────────────────────────────────────────────────────────────────────────────────────
import { hoyBogota, sumarDiasISO } from "../lib/cotizacion/vigencia.ts";
const { actualizarVigenciaCotizacion, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

const hoy = hoyBogota();
const poner = (v: string | null) => { db.cotizaciones[0].vigencia_hasta = v; };
const vigenciaGuardada = () => db.cotizaciones[0].vigencia_hasta;

describe("#40 E3 · creación pública y conversión con vigencia vencida", () => {
  test("checkout público (B2C): el vencimiento automático es de UN día y no hay forma de elegir la fecha", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    const c = await cotizar([item(1, 34)]);
    assert.equal(c.vigencia_hasta, sumarDiasISO(hoy, 1));
  });

  test("abierta con vigencia de ayer: la conversión se rechaza antes de numerar, reservar ni crear contrato/CxP — y un reintento da lo mismo", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    poner(sumarDiasISO(hoy, -1));
    for (let intento = 0; intento < 2; intento++) {
      const r = await convertir(1, { monedaCobro: "COP" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /vencida/);
      sinNumerar();
    }
  });

  test("hoy y mañana siguen válidos", async () => {
    for (const dias of [0, 1]) {
      for (const k of Object.keys(db)) delete db[k];
      llamadasNumeracion = 0; financieros.length = 0;
      HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
      await cotizar([item(1, 34)]);
      poner(sumarDiasISO(hoy, dias));
      const r = await convertir(1, { monedaCobro: "COP" });
      assert.equal(r.ok, true, `+${dias}: ${r.error}`);
      assert.equal(llamadasNumeracion, 1);
    }
  });

  test("histórica con vigencia nula: convierte y conserva nulo (no se vence por inferencia)", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    poner(null);
    const r = await convertir(1, { monedaCobro: "COP" });
    assert.equal(r.ok, true, r.error);
    assert.equal(vigenciaGuardada(), null);
  });

  test("convertirCotizacion (tarifario): una abierta vencida se rechaza antes de numerar", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
    poner(sumarDiasISO(hoy, -2));
    usuario = { id: "u-admin", email: "admin@dspacios.test" };
    db.usuarios = [{ id: "u-admin", rol: "administracion", activo: true }];
    const r = await convertirCotizacion(77, pasajeros as never);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /vencida/);
    sinNumerar();
  });
});

describe("#40 E3 · renovar la vigencia de una cotización abierta", () => {
  const interno = { ok: true, superadmin: false, tenant: "mayorista", interno: true };
  const externo = { ok: true, superadmin: false, tenant: "mayorista", interno: false };
  beforeEach(async () => {
    CTX = interno;
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_000) };
    await cotizar([item(1, 34)]);
  });
  afterEach(() => { CTX = { ok: true, superadmin: true, tenant: "mayorista" }; });

  test("personal interno: renueva una vencida a hoy; queda convertible", async () => {
    poner(sumarDiasISO(hoy, -3));
    assert.deepEqual(await actualizarVigenciaCotizacion(77, hoy), { ok: true });
    assert.equal(vigenciaGuardada(), hoy);
    const r = await convertir(1, { monedaCobro: "COP" });
    assert.equal(r.ok, true, r.error);
  });
  test("una fecha anterior a hoy o posterior a la salida se rechaza y no se guarda", async () => {
    const antes = vigenciaGuardada();
    const ayer = await actualizarVigenciaCotizacion(77, sumarDiasISO(hoy, -1));
    assert.equal(ayer.ok, false); assert.match(ayer.error ?? "", /anterior a hoy/);
    const tarde = await actualizarVigenciaCotizacion(77, "2030-03-02"); // la salida es 2030-03-01
    assert.equal(tarde.ok, false); assert.match(tarde.error ?? "", /posterior a la fecha de salida/);
    assert.equal(vigenciaGuardada(), antes);
  });
  test("el día de la salida es el tope válido", async () => {
    assert.deepEqual(await actualizarVigenciaCotizacion(77, "2030-03-01"), { ok: true });
    assert.equal(vigenciaGuardada(), "2030-03-01");
  });
  test("un aliado B2B activo de la misma agencia NO adquiere la edición interna: se rechaza y no cambia nada", async () => {
    CTX = externo;
    const antes = vigenciaGuardada();
    const r = await actualizarVigenciaCotizacion(77, sumarDiasISO(hoy, 2));
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /No tienes permiso/);
    assert.equal(vigenciaGuardada(), antes);
  });
  test("sin sesión válida no se renueva", async () => {
    CTX = { ok: false, motivo: "sin_perfil" };
    assert.equal((await actualizarVigenciaCotizacion(77, sumarDiasISO(hoy, 2))).ok, false);
  });
  test("una cotización ya convertida no se renueva", async () => {
    db.cotizaciones[0].estado = "convertida";
    const r = await actualizarVigenciaCotizacion(77, sumarDiasISO(hoy, 2));
    assert.equal(r.ok, false);
  });
});

describe("#40 E3 · conversión PARCIAL de carrito y vigencia vencida", () => {
  const sillas = () => rpcLog.filter((f) => f === "crear_pasajeros_contrato_multi_con_sillas").length;
  beforeEach(() => { CTX = { ok: true, superadmin: true, tenant: "mayorista", interno: true }; });
  afterEach(() => { CTX = { ok: true, superadmin: true, tenant: "mayorista" }; });

  test("primer grupo contratado → vencida → reintento rechazado sin consecutivo ni hijos → renovada → completa SOLO el pendiente; repetir devuelve los mismos contratos", async () => {
    HOTELES = { 1: hotel("OZ HOTEL", "COP", 300_050), 2: hotel("Hotel Rodadero", "COP", 200_050) };
    await cotizar([item(1, 10, "CARTAGENA"), item(2, 11, "SANTA MARTA")]);
    fallarFinancieroEnLaLlamada = 2; // el segundo grupo falla; el primero queda completo
    const r1 = await convertir(2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(r1.ok, false);
    assert.equal(db.ventas.length, 1, "solo el primer contrato quedó");
    const primero = { ...db.ventas[0] };
    fallarFinancieroEnLaLlamada = null;

    // Vence: el reintento NO crea el grupo pendiente, aunque ya haya un grupo contratado.
    poner(sumarDiasISO(hoy, -1));
    const numAntes = llamadasNumeracion, cxpAntes = financieros.length, sillasAntes = sillas(), ventasAntes = db.ventas.length;
    for (let i = 0; i < 2; i++) {
      const r = await convertir(2, { monedaCobro: "COP" }, "por_destino");
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /vencida/);
      assert.equal(llamadasNumeracion, numAntes, "no consume consecutivo");
      assert.equal(financieros.length, cxpAntes, "no crea CxP");
      assert.equal(sillas(), sillasAntes, "no toma sillas ni pasajeros");
      assert.equal(db.ventas.length, ventasAntes, "no crea contratos");
      assert.equal(db.cotizaciones[0].estado, "abierta");
    }
    assert.deepEqual(db.ventas[0], primero, "el contrato existente no se tocó");

    // Renovada: completa solo el grupo pendiente, sin duplicar el primero.
    assert.deepEqual(await actualizarVigenciaCotizacion(77, hoy), { ok: true });
    const ok = await convertir(2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(ok.ok, true, ok.error);
    const vs = ventasOrdenadas();
    assert.equal(vs.length, 2, "se completó el pendiente");
    assert.deepEqual(vs.find((v) => v.numero_contrato === primero.numero_contrato), primero, "el primero intacto");
    assert.equal(llamadasNumeracion, numAntes + 1, "un solo consecutivo nuevo");
    assert.equal(financieros.length, cxpAntes + 1, "una sola CxP nueva");
    assert.equal(sillas(), sillasAntes + 1, "un solo juego de sillas nuevo");
    assert.equal(db.cotizaciones[0].estado, "convertida");

    // Completamente convertida: repetir (incluso vencida) devuelve los contratos existentes, sin crear nada.
    poner(sumarDiasISO(hoy, -5));
    const antes = [llamadasNumeracion, financieros.length, sillas(), db.ventas.length];
    const rep = await convertir(2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(rep.ok, true, rep.error);
    assert.deepEqual([...(rep.numeros ?? [])].sort(), vs.map((v) => v.numero_contrato as string).sort());
    assert.deepEqual([llamadasNumeracion, financieros.length, sillas(), db.ventas.length], antes);
  });
});
