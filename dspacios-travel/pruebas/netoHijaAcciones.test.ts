// #50 — EJECUCIÓN REAL de las Server Actions que tocan la modalidad PVP/NETO, con Supabase simulado.
// Se reemplazan SOLO las fronteras (Supabase, next/headers, next/cache y los motores de tarifas); la validación,
// las decisiones de canal/identidad y el armado del snapshot son el código de producción tal cual.
//
// Lo que se demuestra (pruebas S1, P1 y U1 del lado de la aplicación; la base lo decide en CI, test_222_neto_hija.sql):
//   · elegir con modalidad va por el recibo `registrar_validacion_comparativa_n50` (con la modalidad, la respuesta
//     de recobro y la autorización); sin modalidad, por el de siempre; una modalidad mal formada no llega a la base;
//   · solicitarOpcionComparativa NO cambia (D-1: toda hija es asistida; la modalidad la fija el equipo);
//   · confirmar una solicitud con modalidad va por `resolver_solicitud_comparativa_n50`; rechazar, nunca;
//   · el primer pago de una hija NETO arma el snapshot con los valores NETO sellados y el total NETO;
//   · contextoModalidadNeto: solo B2B con aliado, por tenant y rol; venta no recibe cuentas; la vista previa usa
//     el mismo cálculo que la base.
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

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key";

type Fila = Record<string, unknown>;
type LlamadaRpc = { cliente: "sesion" | "servicio"; nombre: string; args: Record<string, unknown> };
const rpcs: LlamadaRpc[] = [];
let TABLAS: Record<string, Fila[]> = {};
let USUARIO: { id: string; email: string } | null = null;
let RESPUESTA_RPC: Record<string, { data?: unknown; error?: { message: string } | null }> = {};

function cliente(tipo: "sesion" | "servicio") {
  const from = (tabla: string) => {
    const filtros: [string, unknown][] = [];
    const filas = () => (TABLAS[tabla] ?? []).filter((f) => filtros.every(([k, v]) => f[k] === v));
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, order: () => b, limit: () => b, in: () => b, insert: () => b, update: () => b,
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return b; },
      maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      single: async () => ({ data: filas()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: filas(), error: null }).then(ok, ko),
    });
    return b;
  };
  const rpc = async (nombre: string, args: Record<string, unknown>) => {
    rpcs.push({ cliente: tipo, nombre, args });
    const r = RESPUESTA_RPC[nombre] ?? { data: null, error: null };
    return { data: r.data ?? null, error: r.error ?? null };
  };
  return { from, rpc, auth: { getUser: async () => ({ data: { user: USUARIO }, error: null }) } };
}

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente("sesion") } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente("servicio") } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });
mock.module("@/lib/reservar/computo", { namedExports: { computarReserva: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/cotizar", { namedExports: { liquidarServicioPuntual: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: {
    contextoCotizacion: async () => ({ ok: true, superadmin: false, tenant: "mayorista" }),
    autorizaTenant: (ctx: { ok: boolean; superadmin?: boolean; tenant?: string }, t: string | null) => ctx.ok && (ctx.superadmin || ctx.tenant === t),
  },
});

const C = await import("../app/tarifario/checkout/actions.ts");
const M = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const P = await import("../app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");

const TOKEN = "11111111-2222-3333-4444-555555555555";
const llamadas = (nombre: string) => rpcs.filter((r) => r.nombre === nombre);
const ADMIN = { id: "u-admin", email: "admin@dspacios.test" };

function madreManual(extra: Fila = {}): Fila {
  return {
    id: 900, tipo: "comparativa_manual", modo: "comparativa", estado: "abierta", version: 1, share_token: TOKEN, tenant: "mayorista",
    vigencia_hasta: "2099-01-01", moneda: "COP", aliado_id: 922201, payload: { tipoAsesor: "agencia" }, ...extra,
  };
}
const OPCION_A = { cotizacion_id: 900, opcion_ref: "A", acomodacion_ref: "unica", total: 10_000_000, moneda: "COP", plantilla_hija: {
  payload: { recobro: 500_000, ninos: 0, tarifaNino: 0, recobroAliado: 250_000, tipoAsesor: "agencia" } } };
const SERVICIOS_MADRE: Fila[] = [
  { id: 1, cotizacion_id: 900, orden: 0, tipo_servicio: "aereo", valor: 2_000_000, costo_neto: 1_900_000, opcion_ref: null },
  { id: 2, cotizacion_id: 900, orden: 1, tipo_servicio: "hotel", valor: 6_000_000, costo_neto: 5_100_000, opcion_ref: null },
  { id: 3, cotizacion_id: 900, orden: 2, tipo_servicio: "traslado", valor: 1_000_000, costo_neto: 850_000, opcion_ref: null },
  { id: 4, cotizacion_id: 900, orden: 3, tipo_servicio: "asistencia", valor: 500_000, costo_neto: 400_000, opcion_ref: null },
];

beforeEach(() => {
  rpcs.length = 0; USUARIO = ADMIN;
  RESPUESTA_RPC = {
    registrar_validacion_comparativa: { data: "val-1" }, registrar_validacion_comparativa_n50: { data: "val-1" },
    elegir_opcion_comparativa_sesion: { data: 777 },
    resolver_solicitud_comparativa: { data: 778 }, resolver_solicitud_comparativa_n50: { data: 778 },
    registrar_personas_cotizacion: { data: { cotizacion_id: 777, nuevos: 1, reintentos: 0, omitidos: 0 } },
    registrar_solicitud_comparativa: { data: { id: 5, estado: "pendiente" } },
  };
  TABLAS = {
    usuarios: [{ id: ADMIN.id, rol: "administracion", activo: true, aliado_id: null, tenant: "mayorista" }],
    cotizaciones: [madreManual(), { id: 777, tenant: "mayorista", tipo: "manual", payload: {}, creado_por_id: ADMIN.id, propietario_id: null, aliado_id: 922201 },
      { id: 778, tenant: "mayorista", tipo: "manual", payload: {}, creado_por_id: ADMIN.id, propietario_id: null, aliado_id: 922201 }],
    cotizacion_opciones: [OPCION_A],
    cotizacion_servicios: SERVICIOS_MADRE,
    aliados: [{ id: 922201, tipo: "agencia", pct_comision: 0.12 }],
    parametros_tributarios: [],
  };
});

const eleccion = (extra: Record<string, unknown> = {}) => ({ token: TOKEN, opcionRef: "A", acomodacionRef: "unica", version: 1, clave: "clave-neto-0001", cliente: null, ...extra });

describe("elegirOpcionComparativa — la modalidad va por el recibo n50", () => {
  test("elegir con modalidad NETO usa el recibo n50 con la modalidad, el recobro y la autorización; el consumo, la sesión", async () => {
    const r = await C.elegirOpcionComparativa(eleccion({ modalidad: "neto", reconoceRecobro: true, autorizarMargen: false }));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.equal(llamadas("registrar_validacion_comparativa").length, 0, "no usa el recibo anterior");
    const [rec] = llamadas("registrar_validacion_comparativa_n50");
    assert.equal(rec.cliente, "servicio");
    assert.equal(rec.args.p_modalidad, "neto"); assert.equal(rec.args.p_reconoce, true); assert.equal(rec.args.p_autorizar, false);
    assert.equal(rec.args.p_canal, "interno"); assert.equal(rec.args.p_actor_id, ADMIN.id);
    assert.equal(rec.args.p_precio_reliquidado, 10_000_000);
    const [consumo] = llamadas("elegir_opcion_comparativa_sesion");
    assert.equal(consumo.cliente, "sesion", "la elección usa la identidad de la sesión");
    assert.deepEqual(consumo.args, { p_validacion: "val-1", p_clave: "clave-neto-0001" });
  });

  test("elegir con modalidad PVP lleva la modalidad sin recobro", async () => {
    await C.elegirOpcionComparativa(eleccion({ modalidad: "pvp" }));
    const [rec] = llamadas("registrar_validacion_comparativa_n50");
    assert.equal(rec.args.p_modalidad, "pvp"); assert.equal(rec.args.p_reconoce, null); assert.equal(rec.args.p_autorizar, false);
  });

  test("sin modalidad: el recibo de siempre, sin ningún parámetro nuevo", async () => {
    const r = await C.elegirOpcionComparativa(eleccion());
    assert.equal(r.ok, true);
    assert.equal(llamadas("registrar_validacion_comparativa_n50").length, 0);
    const [rec] = llamadas("registrar_validacion_comparativa");
    assert.ok(rec);
    assert.deepEqual(Object.keys(rec.args).sort(), ["p_acomodacion_ref", "p_actor_id", "p_canal", "p_datos_cliente", "p_disponibilidad_ok", "p_madre_id", "p_moneda", "p_opcion_ref", "p_precio_reliquidado", "p_version"]);
  });

  test("una modalidad mal formada no llega a la base", async () => {
    for (const malo of [{ modalidad: "bruto" }, { modalidad: "neto" }, { modalidad: "neto", reconoceRecobro: "si" }]) {
      const r = await C.elegirOpcionComparativa(eleccion(malo));
      assert.equal(r.ok, false, JSON.stringify(malo));
    }
    assert.equal(rpcs.length, 0, "ninguna RPC");
  });

  test("la bandera de autorizar solo vale si es literalmente true", async () => {
    await C.elegirOpcionComparativa(eleccion({ modalidad: "neto", reconoceRecobro: false, autorizarMargen: "true" }));
    assert.equal(llamadas("registrar_validacion_comparativa_n50")[0].args.p_autorizar, false);
  });

  test("sin sesión interna (canal público) la modalidad no se acepta: ninguna RPC", async () => {
    USUARIO = null;
    const r = await C.elegirOpcionComparativa(eleccion({ modalidad: "pvp" }));
    assert.equal(r.ok, false);
    assert.equal(rpcs.length, 0);
  });

  test("una comparativa de carrito no admite modalidad", async () => {
    TABLAS.cotizaciones = [madreManual({ tipo: "comparativa_carrito" })];
    const r = await C.elegirOpcionComparativa(eleccion({ modalidad: "pvp" }));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /comparativa manual/);
    assert.equal(llamadas("registrar_validacion_comparativa_n50").length + llamadas("registrar_validacion_comparativa").length, 0);
  });

  test("un rechazo de la base (margen) llega al usuario con su explicación y no consume el recibo", async () => {
    RESPUESTA_RPC.elegir_opcion_comparativa_sesion = { error: { message: "COMPARATIVA_DATOS: el total NETO (8850000) no cubre el margen mínimo del 6 %. Requiere autorización de superadmin o administración." } };
    const r = await C.elegirOpcionComparativa(eleccion({ modalidad: "neto", reconoceRecobro: true }));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /no cubre el margen mínimo/);
  });

  test("solicitarOpcionComparativa NO cambia: nunca lleva modalidad (toda hija es asistida)", async () => {
    TABLAS.cotizaciones = [madreManual()];
    const r = await C.solicitarOpcionComparativa({
      token: TOKEN, opcionRef: "A", acomodacionRef: "unica", version: 1, clave: "clave-sol-0001",
      contacto: { nombre: "Ana", telefono: "3101112233", email: "", nota: "" }, modalidad: "neto", reconoceRecobro: true,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const [s] = llamadas("registrar_solicitud_comparativa");
    assert.ok(s);
    assert.ok(!Object.keys(s.args).some((k) => /modalidad|reconoce|autorizar|solicitante|origen/i.test(k)), Object.keys(s.args).join(","));
  });
});

describe("resolverSolicitudComparativa — confirmar con modalidad", () => {
  test("confirmar con NETO usa la RPC n50 con la identidad de la sesión", async () => {
    const r = await M.resolverSolicitudComparativa(5, "confirmar", "", "clave-res-0001", { modalidad: "neto", reconoceRecobro: false, autorizarMargen: true });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.equal(llamadas("resolver_solicitud_comparativa").length, 0);
    const [x] = llamadas("resolver_solicitud_comparativa_n50");
    assert.equal(x.cliente, "sesion");
    assert.deepEqual(x.args, { p_solicitud: 5, p_decision: "confirmar", p_motivo: null, p_clave: "clave-res-0001", p_modalidad: "neto", p_reconoce: false, p_autorizar: true });
  });

  test("sin modalidad: la RPC de siempre con los mismos 4 parámetros", async () => {
    await M.resolverSolicitudComparativa(5, "confirmar", "", "clave-res-0002");
    assert.equal(llamadas("resolver_solicitud_comparativa_n50").length, 0);
    assert.deepEqual(llamadas("resolver_solicitud_comparativa")[0].args, { p_solicitud: 5, p_decision: "confirmar", p_motivo: null, p_clave: "clave-res-0002" });
  });

  test("rechazar ignora la modalidad: va por la RPC de siempre", async () => {
    await M.resolverSolicitudComparativa(5, "rechazar", "no hay cupo", "clave-res-0003", { modalidad: "neto", reconoceRecobro: true });
    assert.equal(llamadas("resolver_solicitud_comparativa_n50").length, 0);
    assert.equal(llamadas("resolver_solicitud_comparativa")[0].args.p_motivo, "no hay cupo");
  });

  test("una modalidad mal formada no llega a la base", async () => {
    const r = await M.resolverSolicitudComparativa(5, "confirmar", "", "clave-res-0004", { modalidad: "neto" });
    assert.equal(r.ok, false);
    assert.equal(rpcs.length, 0);
  });

  test("un rechazo de la base se muestra con su texto limpio", async () => {
    RESPUESTA_RPC.resolver_solicitud_comparativa_n50 = { error: { message: "COMPARATIVA_DATOS: tu rol no puede fijar el precio NETO; pídeselo a gerencia, administración u operaciones." } };
    const r = await M.resolverSolicitudComparativa(5, "confirmar", "", "clave-res-0005", { modalidad: "neto", reconoceRecobro: true });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /tu rol no puede fijar el precio NETO/);
  });
});

describe("registrarPagoPrevio — snapshot NETO", () => {
  const COT = {
    id: 77, tipo: "manual", modo: "simple", estado: "abierta", tenant: "mayorista", fecha_salida: "2099-11-10", precio_venta: 10_000_000,
    moneda: "COP", economico_rev: 5, condicion_pago_congelada_en: null,
  };
  const SERV = [
    { id: 1, tipo_servicio: "aereo", valor: 2_000_000, nombre_servicio: "Aéreo" }, { id: 2, tipo_servicio: "hotel", valor: 6_000_000, nombre_servicio: "Hotel A" },
    { id: 3, tipo_servicio: "traslado", valor: 1_000_000, nombre_servicio: "Traslados" }, { id: 4, tipo_servicio: "asistencia", valor: 500_000, nombre_servicio: "Asistencia" },
  ].map((s) => ({ ...s, cotizacion_id: 77 }));
  const pagar = () => P.registrarPagoPrevio(77, { valor: 1_000_000, moneda: "COP", formaPago: "Transferencia" }, "clave-pago-0001");
  beforeEach(() => {
    RESPUESTA_RPC.registrar_pago_previo_rev = { data: "OK|9" };
    TABLAS.cotizaciones = [COT];
    TABLAS.cotizacion_servicios = SERV;
    TABLAS.cotizacion_neto = [];
    TABLAS.cotizacion_neto_componentes = [];
  });

  test("hija PVP o sin sello: el snapshot de siempre (valores PVP; exigido 4.250.000)", async () => {
    const r = await pagar();
    assert.equal(r.ok, true, r.error);
    const [x] = llamadas("registrar_pago_previo_rev");
    assert.deepEqual((x.args.p_snapshot as Fila[]).map((f) => f.valor_componente), [2_000_000, 6_000_000, 1_000_000, 500_000]);
    assert.equal(x.args.p_exigido_total_moneda, 4_250_000);
  });

  test("hija NETO: el snapshot lleva los valores NETO sellados y el exigido sale del NETO (3.980.000)", async () => {
    TABLAS.cotizacion_neto = [{ cotizacion_id: 77, modalidad: "neto", neto_total: 8_850_000 }];
    TABLAS.cotizacion_neto_componentes = [
      { cotizacion_id: 77, orden: 0, neto: 2_000_000 }, { cotizacion_id: 77, orden: 1, neto: 5_280_000 },
      { cotizacion_id: 77, orden: 2, neto: 880_000 }, { cotizacion_id: 77, orden: 3, neto: 440_000 },
    ];
    const r = await pagar();
    assert.equal(r.ok, true, r.error);
    const [x] = llamadas("registrar_pago_previo_rev");
    assert.deepEqual((x.args.p_snapshot as Fila[]).map((f) => f.valor_componente), [2_000_000, 5_280_000, 880_000, 440_000]);
    assert.equal(x.args.p_exigido_total_moneda, 3_980_000);
    assert.equal(x.args.p_rev_esperada, 5);
  });

  test("hija NETO con el reparto incompleto: se detiene sin llamar a la base", async () => {
    TABLAS.cotizacion_neto = [{ cotizacion_id: 77, modalidad: "neto", neto_total: 8_850_000 }];
    TABLAS.cotizacion_neto_componentes = [{ cotizacion_id: 77, orden: 0, neto: 2_000_000 }];
    const r = await pagar();
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /reparto del precio NETO/);
    assert.equal(llamadas("registrar_pago_previo_rev").length, 0);
  });

  test("hija sellada en PVP: se comporta como PVP", async () => {
    TABLAS.cotizacion_neto = [{ cotizacion_id: 77, modalidad: "pvp", neto_total: null }];
    const r = await pagar();
    assert.equal(r.ok, true, r.error);
    assert.equal(llamadas("registrar_pago_previo_rev")[0].args.p_exigido_total_moneda, 4_250_000);
  });
});

describe("contextoModalidadNeto — qué ofrece la interfaz", () => {
  test("B2B con aliado y rol que fija NETO: vista previa con el MISMO cálculo que la base (V1)", async () => {
    const ctx = await P.contextoModalidadNeto({ token: TOKEN });
    assert.equal(ctx.permite, true);
    if (!ctx.permite) return;
    assert.equal(ctx.puedeNeto, true); assert.equal(ctx.puedeAutorizar6, true); assert.equal(ctx.puedeAutorizar2, false);
    const v = ctx.vista["A/unica"];
    assert.equal(v.moneda, "COP");
    assert.equal(v.conReconoce.neto, 8_850_000); assert.equal(v.conReconoce.descuento, 1_150_000);
    assert.equal(v.conReconoce.base, 7_500_000); assert.equal(v.conReconoce.ordinaria, 900_000); assert.equal(v.conReconoce.participacion, 250_000);
    assert.equal(v.conReconoce.costos, 8_250_000); assert.equal(v.conReconoce.cumple, true); assert.equal(v.conReconoce.margen, 0.067797);
    assert.equal(v.sinReconoce.neto, 9_040_000); assert.equal(v.sinReconoce.descuento, 960_000); assert.equal(v.sinReconoce.participacion, 0);
  });

  test("por solicitud: el contexto sale de la comparativa de la solicitud", async () => {
    TABLAS.cotizacion_comparativa_solicitudes = [{ id: 5, cotizacion_id: 900 }];
    const ctx = await P.contextoModalidadNeto({ solicitudId: 5 });
    assert.equal(ctx.permite, true);
  });

  test("superadmin puede autorizar también el 2 %; gerencia puede fijar NETO pero no autorizar el 6 %", async () => {
    TABLAS.usuarios = [{ id: ADMIN.id, rol: "superadmin", activo: true, tenant: "minorista" }];
    let ctx = await P.contextoModalidadNeto({ token: TOKEN });
    assert.ok(ctx.permite && ctx.puedeAutorizar2 && ctx.puedeAutorizar6, "superadmin de otra agencia: acceso global");
    TABLAS.usuarios = [{ id: ADMIN.id, rol: "gerencia", activo: true, tenant: "mayorista" }];
    ctx = await P.contextoModalidadNeto({ token: TOKEN });
    assert.ok(ctx.permite && ctx.puedeNeto && !ctx.puedeAutorizar6 && !ctx.puedeAutorizar2);
  });

  test("venta ve que debe elegir, pero no recibe NETO ni cuentas (costos y márgenes)", async () => {
    TABLAS.usuarios = [{ id: ADMIN.id, rol: "venta", activo: true, tenant: "mayorista" }];
    const ctx = await P.contextoModalidadNeto({ token: TOKEN });
    assert.ok(ctx.permite);
    if (ctx.permite) { assert.equal(ctx.puedeNeto, false); assert.deepEqual(ctx.vista, {}); }
  });

  test("no ofrece nada: sin sesión, otra agencia, usuario inactivo, rol ajeno, B2C, sin aliado, carrito, madre cerrada o token inválido", async () => {
    const casos: [string, () => void, { token?: string; solicitudId?: number }][] = [
      ["sin sesión", () => { USUARIO = null; }, { token: TOKEN }],
      ["otra agencia", () => { TABLAS.usuarios = [{ id: ADMIN.id, rol: "administracion", activo: true, tenant: "minorista" }]; }, { token: TOKEN }],
      ["inactivo", () => { TABLAS.usuarios = [{ id: ADMIN.id, rol: "administracion", activo: false, tenant: "mayorista" }]; }, { token: TOKEN }],
      ["rol B2B", () => { TABLAS.usuarios = [{ id: ADMIN.id, rol: "agencia", activo: true, tenant: "mayorista" }]; }, { token: TOKEN }],
      ["B2C", () => { TABLAS.cotizaciones = [madreManual({ payload: { tipoAsesor: "interno" } })]; }, { token: TOKEN }],
      ["sin aliado", () => { TABLAS.cotizaciones = [madreManual({ aliado_id: null })]; }, { token: TOKEN }],
      ["carrito", () => { TABLAS.cotizaciones = [madreManual({ tipo: "comparativa_carrito" })]; }, { token: TOKEN }],
      ["madre descartada", () => { TABLAS.cotizaciones = [madreManual({ estado: "descartada" })]; }, { token: TOKEN }],
      ["token inválido", () => {}, { token: "no-es-un-token" }],
      ["sin identificador", () => {}, {}],
      ["solicitud inexistente", () => {}, { solicitudId: 999 }],
    ];
    for (const [nombre, preparar, entrada] of casos) {
      TABLAS.usuarios = [{ id: ADMIN.id, rol: "administracion", activo: true, tenant: "mayorista" }];
      TABLAS.cotizaciones = [madreManual()];
      USUARIO = ADMIN;
      preparar();
      const ctx = await P.contextoModalidadNeto(entrada);
      assert.equal(ctx.permite, false, nombre);
    }
  });
});
