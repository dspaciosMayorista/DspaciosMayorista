// #40 E3 — cotización vencida en la conversión manual y vigencia elegida solo por el personal interno (Server Actions reales, Supabase simulado).
// Mismo arnés que cotizacionEdicion39Acciones.test.ts.
//
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

// #42 (219): después de crear, la acción registra al titular en el registro de personas por la
// fachada `registrar_personas_cotizacion`. Es la ÚNICA llamada adicional y no es financiera.
const RPC_PERSONAS = "registrar_personas_cotizacion";
const registroOk = (fn: string) => ({ data: fn === RPC_PERSONAS ? { cotizacion_id: 501, nuevos: 1, reintentos: 0, omitidos: 0 } : 501, error: null });

// ── #40 E3 · cotización vencida (conversión manual) y vigencia solo del personal interno ─────────────────────
import { hoyBogota as hoyBogota40, sumarDiasISO as sumarDiasISO40 } from "../lib/cotizacion/vigencia.ts";

describe("#40 E3 · vigencia: conversión manual y quién la elige", () => {
  const hoy = hoyBogota40();
  const conVigencia = (v: string | null, estado = "abierta") => { E.cot = { ...COT, modo: "simple", estado, vigencia_hasta: v }; };
  const convierte = () => { E.rpc.length = 0; E.respRpc = () => ({ data: "DTM-0600", error: null }); return M.convertirCotizacionManualAContrato(77); };

  test("abierta con vigencia de ayer: se rechaza ANTES de llamar a la base (no numera)", async () => {
    conVigencia(sumarDiasISO40(hoy, -1));
    const r = await convierte();
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /vencida/);
    assert.equal(E.rpc.length, 0, "ni siquiera se llama a la RPC");
  });
  test("el día indicado (hoy) y mañana siguen válidos", async () => {
    for (const v of [hoy, sumarDiasISO40(hoy, 1)]) {
      conVigencia(v);
      assert.deepEqual(await convierte(), { ok: true, numero: "DTM-0600" }, v);
      assert.equal(E.rpc[0].fn, "convertir_cotizacion_manual_controlada");
    }
  });
  test("histórica con vigencia nula: no vence por inferencia", async () => {
    conVigencia(null);
    assert.deepEqual(await convierte(), { ok: true, numero: "DTM-0600" });
  });
  test("una ya convertida con fecha pasada sigue siendo un reintento válido (la base devuelve el mismo número)", async () => {
    conVigencia(sumarDiasISO40(hoy, -5), "convertida");
    assert.deepEqual(await convierte(), { ok: true, numero: "DTM-0600" });
  });
  test("el rechazo de la base por COTIZACION_VENCIDA se traduce al mensaje de negocio", async () => {
    conVigencia(hoy);
    E.rpc.length = 0;
    E.respRpc = () => ({ data: null, error: { message: "COTIZACION_VENCIDA: la cotización 77 venció el 2026-10-25" } });
    const r = await M.convertirCotizacionManualAContrato(77);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /^La cotización está vencida/);
  });

  test("un rol externo (aliado B2B) que envía una vigencia al crear una manual se rechaza sin llamar a la base", async () => {
    E.ctx = { ok: true, superadmin: false, tenant: "mayorista", interno: false };
    E.rpc.length = 0;
    const r = await M.crearCotizacionManual({ ...ENTRADA, vigenciaHasta: sumarDiasISO40(hoy, 3) });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /permiso para elegir la vigencia/);
    assert.equal(E.rpc.length, 0);
  });
  test("personal interno: una fecha válida viaja a la cabecera; una anterior a hoy se rechaza", async () => {
    E.ctx = { ok: true, superadmin: false, tenant: "mayorista", interno: true };
    E.respRpc = registroOk;
    const futura = sumarDiasISO40(hoy, 4);
    const ok = await M.crearCotizacionManual({ ...ENTRADA, vigenciaHasta: futura });
    assert.equal(ok.ok, true);
    assert.equal((E.rpc[0].args.p_cabecera as { vigencia_hasta: string }).vigencia_hasta, futura);
    E.rpc.length = 0;
    const mala = await M.crearCotizacionManual({ ...ENTRADA, vigenciaHasta: sumarDiasISO40(hoy, -1) });
    assert.equal(mala.ok, false);
    assert.match((mala as { error: string }).error, /anterior a hoy/);
    assert.equal(E.rpc.length, 0);
  });
  test("comparativa manual: un rol externo tampoco elige la vigencia", async () => {
    E.ctx = { ok: true, superadmin: false, tenant: "mayorista", interno: false };
    E.rpc.length = 0;
    const r = await M.crearComparativaManual({ vigenciaHasta: sumarDiasISO40(hoy, 3) } as never);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /permiso para elegir la vigencia/);
    assert.equal(E.rpc.length, 0);
  });
});
