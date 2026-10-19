// #39 fase 1 — EJECUCIÓN REAL de las Server Actions con Supabase simulado.
//
// Comprueba qué llama cada acción y con qué argumentos (no la base: eso lo
// prueba el CI de la 216/217):
//   · crear va por la RPC `crear_cotizacion_manual` con el usuario de la SESIÓN y
//     el tenant del contexto; ya no inserta directo en cotizaciones/servicios;
//   · editar servicios y niños/recobro exigen motivo y revisión y van por su RPC;
//   · titular e incluye solo actualizan una cotización ABIERTA;
//   · pago, anulación y conversión manual van por los wrappers (la única puerta);
//     el pago pasa la revisión leída ANTES que los servicios.
//   · ninguna acción llama ya a las RPC 198 directo.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {} export function revalidateTag() {}")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Fila = Record<string, unknown>;
type Consulta = { cliente: "sesion" | "admin"; tabla: string; op: "select" | "insert" | "update" | "delete"; valores: unknown; filtros: [string, unknown][] };

const E = {
  rpc: [] as { cliente: string; fn: string; args: Record<string, unknown> }[],
  todasRpc: [] as string[],
  consultas: [] as Consulta[],
  usuario: { id: "u-1", email: "asesor@dspacios.test" } as { id: string; email: string } | null,
  perfil: { rol: "administracion", activo: true, tenant: "mayorista", nombre: "Admin" } as Fila | null,
  ctx: { ok: true, superadmin: false, tenant: "mayorista" } as Record<string, unknown>,
  cot: null as Fila | null,
  servicios: [] as Fila[],
  pago: null as Fila | null,
  filasUpdate: [{ id: 1 }] as Fila[],
  respRpc: (fn: string): { data: unknown; error: unknown } => { void fn; return { data: 1, error: null }; },
};

function cliente(tipo: "sesion" | "admin") {
  return {
    auth: { getUser: async () => ({ data: { user: E.usuario }, error: null }) },
    rpc: async (fn: string, args: Record<string, unknown>) => { E.rpc.push({ cliente: tipo, fn, args }); E.todasRpc.push(fn); return E.respRpc(fn); },
    from: (tabla: string) => {
      const q: Consulta = { cliente: tipo, tabla, op: "select", valores: null, filtros: [] };
      const resolver = () => {
        E.consultas.push(q);
        if (q.op === "update") return { data: E.filasUpdate, error: null };
        if (q.op !== "select") return { data: null, error: null };
        if (tabla === "usuarios") return { data: E.perfil, error: null };
        if (tabla === "cotizaciones") return { data: E.cot, error: null };
        if (tabla === "cotizacion_servicios") return { data: E.servicios, error: null };
        if (tabla === "cotizacion_pagos_previos") return { data: E.pago, error: null };
        return { data: null, error: null };
      };
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        insert: (v: unknown) => { q.op = "insert"; q.valores = v; return b; },
        update: (v: unknown) => { q.op = "update"; q.valores = v; return b; },
        delete: () => { q.op = "delete"; return b; },
        eq: (k: string, v: unknown) => { q.filtros.push([k, v]); return b; },
        in: () => b, order: () => b,
        maybeSingle: async () => resolver(),
        single: async () => resolver(),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
      });
      return b;
    },
  };
}

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente("sesion") } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente("admin") } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: {
    contextoCotizacion: async () => E.ctx,
    autorizaTenant: (ctx: { ok: boolean; superadmin?: boolean; tenant?: string }, t: string | null) => ctx.ok && (ctx.superadmin || ctx.tenant === t),
  },
});

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";

const M = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const P = await import("../app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
const { construirCotizacionManual, liquidarServicios } = await import("../lib/cotizacion/liquidacionManual.ts");
import type { CotizacionManualInput, ServicioManual } from "../lib/cotizacion/liquidacionManual.ts";

const VIEJAS = ["registrar_pago_previo", "anular_pago_previo", "convertir_cotizacion_a_contrato", "transferir_pagos_previos_a_abonos"];
const escrituras = (tabla: string) => E.consultas.filter((c) => c.tabla === tabla && c.op !== "select");

const SERV: ServicioManual[] = [
  { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo", proveedor: "Avianca", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
  { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "HA", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0 },
];
const ENTRADA: CotizacionManualInput = {
  cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1", telefono: "3", email: "a@x.test", nacimiento: "1990-01-01" },
  destino: "Cartagena", fechaIda: "2099-11-10", fechaRegreso: "2099-11-14", pax: 2, ninos: 1, tarifaNino: 100000,
  recobro: 50000, recobroAliado: 0, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor", agenciaNombre: "",
  freelanceNombre: "", plazo: "", vigenciaHasta: "", observaciones: "", incluye: "", noIncluye: "", servicios: SERV,
};
const COT = {
  id: 77, tipo: "manual", modo: "simple", estado: "abierta", tenant: "mayorista", pax: 2, destino: "Cartagena",
  fecha_salida: "2099-11-10", fecha_regreso: "2099-11-14", precio_venta: 1_650_000, moneda: "COP", economico_rev: 5,
  condicion_pago_congelada_en: null, payload: ENTRADA, detalle: { venta: { cliente: "Ana Pérez" } },
};

beforeEach(() => {
  E.rpc.length = 0; E.consultas.length = 0;
  E.usuario = { id: "u-1", email: "asesor@dspacios.test" };
  E.perfil = { rol: "administracion", activo: true, tenant: "mayorista", nombre: "Admin" };
  E.ctx = { ok: true, superadmin: false, tenant: "mayorista" };
  E.cot = { ...COT };
  E.servicios = liquidarServicios(SERV).map((f, i) => ({ id: 100 + i, ...f }));
  E.pago = null;
  E.filasUpdate = [{ id: 1 }];
  E.respRpc = () => ({ data: 1, error: null });
});

describe("crearCotizacionManual → RPC con autor estable", () => {
  test("una sola RPC con el usuario de la sesión, el tenant del contexto y la cabecera de la fórmula única; sin INSERT directo", async () => {
    E.respRpc = () => ({ data: 501, error: null });
    const r = await M.crearCotizacionManual(ENTRADA);
    assert.deepEqual(r, { ok: true, id: 501 });
    assert.equal(E.rpc.length, 1);
    const [llamada] = E.rpc;
    assert.equal(llamada.fn, "crear_cotizacion_manual");
    assert.equal(llamada.cliente, "admin");
    assert.equal(llamada.args.p_usuario_id, "u-1");
    assert.equal(llamada.args.p_tenant, "mayorista");
    const esperado = construirCotizacionManual(ENTRADA, { vigencia: (llamada.args.p_cabecera as { vigencia_hasta: string }).vigencia_hasta });
    assert.ok(esperado.ok);
    assert.deepEqual(llamada.args.p_cabecera, esperado.cabecera);
    assert.deepEqual(llamada.args.p_servicios, esperado.servicios);
    assert.equal(escrituras("cotizaciones").length + escrituras("cotizacion_servicios").length, 0, "nada de INSERT directo");
  });
  test("sin contexto autorizado o sin sesión: no llama a la base", async () => {
    E.ctx = { ok: false, motivo: "sin_perfil" };
    assert.equal((await M.crearCotizacionManual(ENTRADA)).ok, false);
    E.ctx = { ok: true, superadmin: false, tenant: "mayorista" };
    E.usuario = null;
    assert.equal((await M.crearCotizacionManual(ENTRADA)).ok, false);
    assert.equal(E.rpc.length, 0);
  });
  test("error propio de la RPC → mensaje claro", async () => {
    E.respRpc = () => ({ data: null, error: { message: "EDICION_39_NO_AUTORIZADO: no tienes permiso para crear cotizaciones." } });
    const r = await M.crearCotizacionManual(ENTRADA);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /permiso/);
  });
});

describe("editarServiciosCotizacionManual", () => {
  const nuevos: ServicioManual[] = [{ tipo: "hotel", plataforma: "Booking", nombre: "Hotel B", proveedor: "HB", costoNeto: 560000, modo: "mk", pctMarkup: 20, ta: 0 }];
  test("motivo vacío o revisión inválida: no llama a la base", async () => {
    assert.equal((await M.editarServiciosCotizacionManual(77, { revEsperada: 5, motivo: "  ", servicios: nuevos })).ok, false);
    assert.equal((await M.editarServiciosCotizacionManual(77, { revEsperada: 0, motivo: "x", servicios: nuevos })).ok, false);
    assert.equal(E.rpc.length, 0);
  });
  test("tenant ajeno, carrito o no abierta: no llama a la base", async () => {
    E.cot = { ...COT, tenant: "minorista" };
    assert.equal((await M.editarServiciosCotizacionManual(77, { revEsperada: 5, motivo: "x", servicios: nuevos })).ok, false);
    E.cot = { ...COT, tipo: "carrito" };
    assert.equal((await M.editarServiciosCotizacionManual(77, { revEsperada: 5, motivo: "x", servicios: nuevos })).ok, false);
    E.cot = { ...COT, estado: "convertida" };
    assert.equal((await M.editarServiciosCotizacionManual(77, { revEsperada: 5, motivo: "x", servicios: nuevos })).ok, false);
    assert.equal(E.rpc.length, 0);
  });
  test("ok: RPC con revisión, motivo recortado, filas liquidadas y total que conserva recobro + niños", async () => {
    E.respRpc = () => ({ data: 8, error: null });
    const r = await M.editarServiciosCotizacionManual(77, { revEsperada: 5, motivo: "  cambio de hotel ", servicios: nuevos });
    assert.deepEqual(r, { ok: true, rev: 8 });
    const [l] = E.rpc;
    assert.equal(l.fn, "editar_servicios_cotizacion_manual");
    assert.equal(l.args.p_usuario_id, "u-1");
    assert.equal(l.args.p_rev_esperada, 5);
    assert.equal(l.args.p_motivo, "cambio de hotel");
    assert.deepEqual(l.args.p_servicios, liquidarServicios(nuevos));
    const cambios = l.args.p_cambios as { precio_venta: number; hotel: string; items: { valor: number }[] };
    assert.equal(cambios.precio_venta, 700_000 + 50_000 + 100_000);
    assert.equal(cambios.hotel, "Hotel B");
    assert.equal(cambios.items.reduce((s, i) => s + i.valor, 0), cambios.precio_venta);
    assert.equal(escrituras("cotizaciones").length + escrituras("cotizacion_servicios").length, 0);
  });
  test("rechazo de revisión de la base → pide recargar", async () => {
    E.respRpc = () => ({ data: null, error: { message: "EDICION_39_REVISION: la cotización cambió mientras la editabas" } });
    const r = await M.editarServiciosCotizacionManual(77, { revEsperada: 5, motivo: "x", servicios: nuevos });
    assert.match((r as { error: string }).error, /recarga/);
  });
});

describe("actualizarRecobroNinosCotizacionManual (C5)", () => {
  test("sin motivo: no llama a la base", async () => {
    const r = await M.actualizarRecobroNinosCotizacionManual(77, { ninos: 0, tarifaNino: 0, recobro: 0, recobroAliado: 0 }, { revEsperada: 5, motivo: "" });
    assert.equal(r.ok, false);
    assert.equal(E.rpc.length, 0);
  });
  test("ok: por la RPC, sin UPDATE directo del precio", async () => {
    const r = await M.actualizarRecobroNinosCotizacionManual(77, { ninos: 2, tarifaNino: 10, recobro: 5, recobroAliado: 0 }, { revEsperada: 5, motivo: "niño extra" });
    assert.deepEqual(r, { ok: true });
    const [l] = E.rpc;
    assert.equal(l.fn, "actualizar_recobro_ninos_manual");
    assert.equal(l.args.p_rev_esperada, 5);
    const c = l.args.p_cambios as { precio_venta: number; ninos: number };
    assert.equal(c.ninos, 2);
    assert.equal(c.precio_venta, 1_500_000 + 5 + 2 * 10);
    assert.equal(escrituras("cotizaciones").length, 0);
  });
});

describe("titular e incluye: solo sobre una cotización abierta", () => {
  test("el UPDATE filtra estado=abierta y 0 filas avisa", async () => {
    const t = { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "9", nacimiento: "1990-01-01", telefono: "", email: "" };
    assert.deepEqual(await M.actualizarTitularCotizacionManual(77, t), { ok: true });
    assert.deepEqual(await M.actualizarIncluyeCotizacionManual(77, "a", "b"), { ok: true });
    const ups = escrituras("cotizaciones");
    assert.equal(ups.length, 2);
    for (const u of ups) assert.ok(u.filtros.some(([k, v]) => k === "estado" && v === "abierta"), "filtra estado");
    E.filasUpdate = [];
    const r = await M.actualizarIncluyeCotizacionManual(77, "a", "b");
    assert.match((r as { error: string }).error, /ya no está abierta/);
  });
});

describe("dinero: la única puerta son los wrappers", () => {
  test("convertir → convertir_cotizacion_manual_controlada; la madre no", async () => {
    E.cot = { ...COT, modo: "simple" };
    E.respRpc = () => ({ data: "DTM-0600", error: null });
    assert.deepEqual(await M.convertirCotizacionManualAContrato(77), { ok: true, numero: "DTM-0600" });
    assert.equal(E.rpc[0].fn, "convertir_cotizacion_manual_controlada");
    assert.deepEqual(E.rpc[0].args, { p_cotizacion_id: 77, p_usuario_id: "u-1" });
    E.rpc.length = 0;
    E.cot = { ...COT, modo: "comparativa" };
    assert.equal((await M.convertirCotizacionManualAContrato(77)).ok, false);
    assert.equal(E.rpc.length, 0);
  });
  test("primer pago → registrar_pago_previo_rev con la revisión leída y el snapshot", async () => {
    E.respRpc = () => ({ data: "OK|9", error: null });
    const r = await P.registrarPagoPrevio(77, { valor: 100000, moneda: "COP", formaPago: "transferencia", referencia: "R1" }, "clave-1");
    assert.deepEqual(r, { ok: true, pagoId: 9 });
    const [l] = E.rpc;
    assert.equal(l.fn, "registrar_pago_previo_rev");
    assert.equal(l.args.p_rev_esperada, 5);
    assert.ok(Array.isArray(l.args.p_snapshot) && (l.args.p_snapshot as unknown[]).length === 2, "snapshot de 2 componentes");
    // La revisión se leyó en la consulta de la cotización, ANTES que la de servicios.
    const iCot = E.consultas.findIndex((c) => c.tabla === "cotizaciones");
    const iServ = E.consultas.findIndex((c) => c.tabla === "cotizacion_servicios");
    assert.ok(iCot >= 0 && iServ > iCot);
  });
  test("pago con la cotización ya congelada: sin snapshot, mismo wrapper", async () => {
    E.cot = { ...COT, condicion_pago_congelada_en: "2099-01-01T00:00:00Z" };
    E.respRpc = () => ({ data: "OK|10", error: null });
    await P.registrarPagoPrevio(77, { valor: 1, moneda: "COP", formaPago: "efectivo" }, "clave-2");
    assert.equal(E.rpc[0].fn, "registrar_pago_previo_rev");
    assert.equal("p_snapshot" in E.rpc[0].args, false);
  });
  test("rechazo de revisión del wrapper → mensaje sin el código interno", async () => {
    E.respRpc = () => ({ data: null, error: { message: "PAGO_39_REVISION: la cotización cambió desde que se preparó el pago; recarga la página e inténtalo de nuevo." } });
    const r = await P.registrarPagoPrevio(77, { valor: 1, moneda: "COP", formaPago: "efectivo" }, "clave-3");
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.error ?? "", /PAGO_39/);
    assert.match(r.error ?? "", /recarga/);
  });
  test("anular → anular_pago_previo_controlado", async () => {
    E.pago = { cotizacion_id: 77, tenant: "mayorista", estado: "activo" };
    E.respRpc = () => ({ data: "OK", error: null });
    assert.deepEqual(await P.anularPagoPrevio(9, "error"), { ok: true });
    assert.equal(E.rpc[0].fn, "anular_pago_previo_controlado");
    assert.deepEqual(E.rpc[0].args, { p_pago_id: 9, p_motivo: "error", p_usuario_id: "u-1" });
  });
  test("ninguna acción llamó a las RPC 198 directo", () => {
    // Registro acumulado de TODA la corrida (no se limpia entre pruebas).
    assert.ok(E.todasRpc.length >= 8, "la corrida ejerció las acciones");
    assert.equal(E.todasRpc.filter((fn) => VIEJAS.includes(fn)).length, 0);
  });
});
