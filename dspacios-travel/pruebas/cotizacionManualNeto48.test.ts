// #48 (bloque Portal B2B) — cotización dinámica B2B normal con precio NETO.
//  · vista previa PURA (`vistaNetoManual`) con valores calculados A MANO (los mismos de supabase/scripts/test_317_neto_manual.sql);
//  · la acción real `crearCotizacionManual` con Supabase simulado: qué RPC llega, con qué argumentos, y qué nunca llega a la base;
//  · elegibilidad de edición con NETO fijado.
// La decisión de verdad (rol, margen, descuento) la toma la base: se prueba con test_317_neto_manual.sql sobre Postgres real.
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
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";

type Fila = Record<string, unknown>;
const rpcs: { fn: string; args: Fila }[] = [];
let errorRpc: { fn: string; message: string } | null = null;

function cliente() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "asesor@dspacios.test" } }, error: null }) },
    rpc: async (fn: string, args: Fila) => {
      rpcs.push({ fn, args });
      if (errorRpc && errorRpc.fn === fn) return { data: null, error: { message: errorRpc.message } };
      return { data: fn === "registrar_personas_cotizacion" ? { cotizacion_id: 901, nuevos: 1, reintentos: 0, omitidos: 0 } : 901, error: null };
    },
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, { select: () => b, eq: () => b, maybeSingle: async () => ({ data: tabla === "usuarios" ? { rol: "administracion", activo: true } : null, error: null }), single: async () => ({ data: { id: 901 }, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) });
      return b;
    },
  };
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: false, interno: true, tenant: "mayorista" }), autorizaTenant: () => true },
});

const { crearCotizacionManual, convertirCotizacionManualAContrato } = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const { vistaNetoManual, pctComisionNeto } = await import("../lib/cotizacion/netoManual.ts");
const { elegibilidadEdicion, mensajeEdicion39 } = await import("../lib/cotizacion/edicionServiciosManual.ts");
import type { CotizacionManualInput } from "../lib/cotizacion/liquidacionManual.ts";

// aéreo 800.000 mk 20 % → 1.000.000 · hotel 3.200.000 mk 20 % → 4.000.000 · PVP 5.000.000.
function entrada(sobre: Partial<CotizacionManualInput> = {}): CotizacionManualInput {
  return {
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123456", telefono: "3001112233", email: "a@x.test", nacimiento: "1990-01-01" },
    destino: "Cartagena", fechaIda: "2030-11-10", fechaRegreso: "2030-11-14", pax: 2, ninos: 0, tarifaNino: 0,
    recobro: 0, recobroAliado: 0, moneda: "COP", tipoAsesor: "agencia", asesorInterno: "", agenciaNombre: "Viajes Sol SAS",
    freelanceNombre: "", aliadoId: 7, bnc: null, plazo: "", vigenciaHasta: "2030-11-05", observaciones: "", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo", proveedor: "Avianca", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "HA", costoNeto: 3200000, modo: "mk", pctMarkup: 20, ta: 0 },
    ],
    ...sobre,
  };
}
const llamadas = (fn: string) => rpcs.filter((r) => r.fn === fn);
const NETO = { modalidad: "neto", reconoceRecobro: false, autorizarMargen: false };
beforeEach(() => { rpcs.length = 0; errorRpc = null; });

const serv = [
  { tipo: "aereo", valor: 1000000, costoNeto: 800000 },
  { tipo: "hotel", valor: 4000000, costoNeto: 3200000 },
];
const base = { servicios: serv, total: 5000000, recobro: 0, ninos: 0, tarifaNino: 0, recobroAliado: 0, reconoce: false, pct: 0.12, reglaParticipacion: false, rol: "administracion", autorizarMargen: false };

describe("#48 vista previa del NETO: valores a mano", () => {
  test("agencia 12 %: base 4.000.000 (sin el tiquete) → comisión 480.000 → NETO 4.520.000; costos 4.000.000", () => {
    const v = vistaNetoManual(base);
    assert.equal(v.neto, 4520000);
    assert.equal(v.descuento, 480000);
    assert.equal(v.costos, 4000000);
    assert.equal(v.resultado.base, BigInt(400000000));
    assert.equal(v.resultado.tiquetes, BigInt(100000000));
    assert.equal(v.bloqueo, null);
    assert.equal(v.evaluacion.cumple, true);
  });
  test("recobro 300.000 con participación 100.000 reconocida: base 4.000.000 → 480.000 + 100.000 → NETO 4.720.000", () => {
    const v = vistaNetoManual({ ...base, total: 5300000, recobro: 300000, recobroAliado: 100000, reconoce: true });
    assert.equal(v.neto, 4720000);
    assert.equal(v.descuento, 580000);
  });
  test("sin participación el casillero «reconocer» no cambia nada (como el servidor: reconoce solo cuenta con participación > 0)", () => {
    const sin = vistaNetoManual({ ...base, total: 5300000, recobro: 300000, recobroAliado: 0, reconoce: true });
    const conCasillaApagada = vistaNetoManual({ ...base, total: 5300000, recobro: 300000, recobroAliado: 0, reconoce: false });
    assert.equal(sin.neto, conCasillaApagada.neto);
    // el recobro entra a la base: (5.300.000 − 1.000.000) × 12 % = 516.000 → NETO 4.784.000
    assert.equal(sin.neto, 4784000);
  });
  test("freelance 11 % por defecto → 440.000 → NETO 4.560.000", () => {
    assert.equal(vistaNetoManual({ ...base, pct: pctComisionNeto(null, null, "freelance") }).neto, 4560000);
  });
  test("USD: PVP 2.500, comisión 12 % de 2.000 = 240 → NETO 2.260", () => {
    const v = vistaNetoManual({ ...base, servicios: [{ tipo: "aereo", valor: 500, costoNeto: 400 }, { tipo: "hotel", valor: 2000, costoNeto: 1600 }], total: 2500 });
    assert.equal(v.neto, 2260);
    assert.equal(v.descuento, 240);
  });
  test("% del aliado → parámetro → 12 % agencia / 11 % freelance, a 4 decimales", () => {
    assert.equal(pctComisionNeto(0.1, 0.12, "agencia"), 0.1);
    assert.equal(pctComisionNeto(null, 0.13, "agencia"), 0.13);
    assert.equal(pctComisionNeto(null, null, "agencia"), 0.12);
    assert.equal(pctComisionNeto(null, null, "freelance"), 0.11);
    assert.equal(pctComisionNeto(0.123456, null, "agencia"), 0.1235);
  });
  test("bloqueos: comisión 0, costo cero, bajo costo, margen 4,87 % (autoriza administración, no gerencia), rol venta", () => {
    assert.match(vistaNetoManual({ ...base, pct: 0 }).bloqueo ?? "", /descuento 0/);
    assert.match(vistaNetoManual({ ...base, servicios: serv.map((s) => ({ ...s, costoNeto: 0 })) }).bloqueo ?? "", /costo total es 0/);
    assert.match(vistaNetoManual({ ...base, servicios: [{ tipo: "aereo", valor: 1000000, costoNeto: 900000 }, { tipo: "hotel", valor: 4000000, costoNeto: 3900000 }] }).bloqueo ?? "", /por debajo del costo total/);
    const bajo = [{ tipo: "aereo", valor: 1000000, costoNeto: 900000 }, { tipo: "hotel", valor: 4000000, costoNeto: 3400000 }]; // costos 4.300.000 → 4,87 %
    const sinAut = vistaNetoManual({ ...base, servicios: bajo });
    assert.equal(sinAut.requiereAutorizacion, true);
    assert.match(sinAut.bloqueo ?? "", /marca la autorización/);
    assert.equal(vistaNetoManual({ ...base, servicios: bajo, autorizarMargen: true }).bloqueo, null);
    assert.match(vistaNetoManual({ ...base, servicios: bajo, autorizarMargen: true, rol: "gerencia" }).bloqueo ?? "", /lo autoriza superadmin o administración/);
    assert.match(vistaNetoManual({ ...base, rol: "venta" }).bloqueo ?? "", /Tu rol no puede fijar el precio NETO/);
  });
});

describe("#48 acción crearCotizacionManual: NETO llega a su RPC y nada más", () => {
  test("NETO agencia sin BNC: solo crear_cotizacion_manual_neto, con el aliado por id", async () => {
    const r = await crearCotizacionManual(entrada({ modalidad: NETO }));
    assert.equal(r.ok, true);
    assert.equal(llamadas("crear_cotizacion_manual_neto").length, 1);
    assert.equal(llamadas("crear_cotizacion_manual_con_acuerdo").length, 0, "sin acuerdo #97: NETO no crea una segunda comisión");
    assert.equal(llamadas("crear_cotizacion_manual").length, 0);
    const a = llamadas("crear_cotizacion_manual_neto")[0].args;
    assert.equal(a.p_aliado_id, 7);
    assert.equal(a.p_reconoce, false);
    assert.equal(a.p_autorizar, false);
    assert.equal(a.p_usuario_id, "u-1");
  });
  test("«reconocer» solo viaja en true si hay participación > 0; la autorización viaja tal cual", async () => {
    await crearCotizacionManual(entrada({ recobro: 300000, recobroAliado: 100000, modalidad: { ...NETO, reconoceRecobro: true, autorizarMargen: true } }));
    assert.equal(llamadas("crear_cotizacion_manual_neto")[0].args.p_reconoce, true);
    assert.equal(llamadas("crear_cotizacion_manual_neto")[0].args.p_autorizar, true);
    rpcs.length = 0;
    await crearCotizacionManual(entrada({ recobro: 300000, recobroAliado: 0, modalidad: { ...NETO, reconoceRecobro: true } }));
    assert.equal(llamadas("crear_cotizacion_manual_neto")[0].args.p_reconoce, false);
  });
  test("rechazos de la entrada: nada llega a ninguna RPC", async () => {
    for (const [nombre, sobre, patron] of [
      ["NETO en una venta B2C", { tipoAsesor: "interno" as const, aliadoId: null, agenciaNombre: "", asesorInterno: "Asesor", modalidad: NETO }, /solo aplica a ventas de una agencia o freelance/],
      ["NETO sin aliado del catálogo", { aliadoId: null, modalidad: NETO }, /catálogo/],
      ["modalidad inválida", { modalidad: { modalidad: "otra" } }, /PVP o NETO/],
      ["NETO sin decir si se reconoce el recobro", { modalidad: { modalidad: "neto" } }, /participación del aliado/],
    ] as const) {
      const r = await crearCotizacionManual(entrada(sobre as Partial<CotizacionManualInput>));
      assert.equal(r.ok, false, nombre);
      assert.match(!r.ok ? r.error : "", patron, nombre);
      assert.equal(rpcs.length, 0, `${nombre}: ninguna RPC`);
    }
  });
  test("el rechazo de la base se muestra con su texto (rol, margen) sin detalles internos", async () => {
    errorRpc = { fn: "crear_cotizacion_manual_neto", message: "COMPARATIVA_DATOS: tu rol no puede fijar el precio NETO; pídeselo a gerencia, administración u operaciones." };
    const r = await crearCotizacionManual(entrada({ modalidad: NETO }));
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /^tu rol no puede fijar el precio NETO/);
    errorRpc = { fn: "crear_cotizacion_manual_neto", message: 'new row violates check constraint "cotizacion_neto_neto" (pg_)' };
    const r2 = await crearCotizacionManual(entrada({ modalidad: NETO }));
    assert.equal(r2.ok, false);
    assert.doesNotMatch(!r2.ok ? r2.error : "", /constraint|pg_/);
  });
  test("regresión PVP: sin modalidad o con «pvp» sigue exigiendo BNC y usa el acuerdo #97", async () => {
    const sinBnc = await crearCotizacionManual(entrada());
    assert.equal(sinBnc.ok, false);
    assert.match(!sinBnc.ok ? sinBnc.error : "", /base no comisionable/);
    assert.equal(rpcs.length, 0);
    for (const modalidad of [undefined, { modalidad: "pvp" }]) {
      rpcs.length = 0;
      const r = await crearCotizacionManual(entrada({ bnc: 0, modalidad }));
      assert.equal(r.ok, true);
      assert.equal(llamadas("crear_cotizacion_manual_con_acuerdo").length, 1);
      assert.equal(llamadas("crear_cotizacion_manual_con_acuerdo")[0].args.p_bnc, 0);
      assert.equal(llamadas("crear_cotizacion_manual_neto").length, 0);
    }
  });
  test("regresión B2C: la dinámica normal usa crear_cotizacion_manual", async () => {
    const r = await crearCotizacionManual(entrada({ tipoAsesor: "interno", aliadoId: null, agenciaNombre: "", asesorInterno: "Asesor" }));
    assert.equal(r.ok, true);
    assert.equal(llamadas("crear_cotizacion_manual").length, 1);
    assert.equal(llamadas("crear_cotizacion_manual_neto").length, 0);
  });
});

describe("#48 convertir una cotización NETO antes del primer pago", () => {
  test("el rechazo técnico de la base se traduce en qué hacer; nada más cambia", async () => {
    errorRpc = { fn: "convertir_cotizacion_manual_controlada", message: "NETO: el total congelado de la cotización no es el precio NETO; no se puede convertir." };
    const r = await convertirCotizacionManualAContrato(901);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /registra primero el pago previo/);
    assert.doesNotMatch(!r.ok ? r.error : "", /congelado de la cotización no es/);
  });
});

describe("#48 elegibilidad de edición con NETO fijado", () => {
  const cot = { tipo: "manual", modo: "simple", estado: "abierta", numero_contrato: null, cotizacion_origen_id: null, condicion_pago_congelada_en: null, vigencia_hasta: "2099-01-01", creado_por_id: "u-1" };
  const ctx = { actor: { id: "u-1", rol: "administracion", activo: true }, habilitada: true, hoy: "2030-01-01", tienePagos: false };
  test("sin NETO es editable; con NETO fijado no, con su motivo", () => {
    assert.deepEqual(elegibilidadEdicion(cot, ctx), { ok: true });
    const r = elegibilidadEdicion(cot, { ...ctx, netoFijado: true });
    assert.equal(r.ok, false);
    assert.equal(!r.ok ? r.codigo : "", "NETO_FIJADO");
    assert.match(!r.ok ? r.mensaje : "", /precio NETO fijado/);
  });
  test("el mensaje de la base «tiene precio NETO fijado» se muestra como su texto de elegibilidad, nunca crudo", () => {
    assert.doesNotMatch(mensajeEdicion39("EDICION_39_NO_ELEGIBLE: la cotización tiene precio NETO fijado; no se edita (crea otra cotización)."), /EDICION_39/);
  });
});
