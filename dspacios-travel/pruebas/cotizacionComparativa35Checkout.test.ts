// #35 — EJECUCIÓN REAL de las acciones de comparativa del checkout
// (app/tarifario/checkout/actions.ts): crearComparativaCarrito,
// elegirOpcionComparativa, solicitarOpcionComparativa y resumenOpcionComparativa.
// Se reemplazan SOLO las fronteras (Supabase, next/headers) y los motores de
// liquidación (computarReserva, liquidarServicioPuntual); la validación, el
// armado de opciones por acomodación, la reliquidación y las decisiones de
// canal/identidad son el código de producción tal cual.
//
// Lo que se demuestra:
//   · nada se inserta directo en `cotizaciones`: todo pasa por la RPC;
//   · la identidad sale de la SESIÓN, nunca del cuerpo (aunque el cuerpo mienta);
//   · la elección reliquida con el motor real y NO emite recibo si el precio cambió;
//   · el canal público usa service-role y el de sesión usa el cliente de la sesión;
//   · la IP sale solo de cabeceras de plataforma, se guarda como huella y nunca cruda.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key";

type Fila = Record<string, unknown>;
type LlamadaRpc = { cliente: "sesion" | "servicio"; nombre: string; args: Record<string, unknown> };
const rpcs: LlamadaRpc[] = [];
const insertsDirectos: { tabla: string; fila: Fila }[] = [];
let TABLAS: Record<string, Fila[]> = {};
let USUARIO: { id: string; email: string } | null = null;
let RESPUESTA_RPC: Record<string, { data?: unknown; error?: { message: string } | null }> = {};
let CABECERAS = new Map<string, string>([["host", "localhost"]]);

function cliente(tipo: "sesion" | "servicio") {
  const from = (tabla: string) => {
    const filtros: [string, unknown][] = [];
    const filas = () => (TABLAS[tabla] ?? []).filter((f) => filtros.every(([k, v]) => f[k] === v));
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, order: () => b, limit: () => b, in: () => b,
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return b; },
      maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      single: async () => ({ data: filas()[0] ?? null, error: null }),
      insert: (fila: Fila) => { insertsDirectos.push({ tabla, fila }); return b; },
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

// ── Motor de tarifas simulado ─────────────────────────────────────────────
const CAP: Record<string, number> = { sencilla: 1, doble: 2, triple: 3, multiple: 4 };
let TARIFA: Record<number, number> = { 1: 300_000, 2: 250_000, 3: 280_000, 4: 200_000 };
const RECARGO_SENCILLA = 1.5;
const FECHAS: Record<number, [string, string]> = {
  1: ["2030-03-01", "2030-03-04"], 2: ["2030-03-01", "2030-03-04"], 3: ["2030-03-08", "2030-03-11"], 4: ["2030-03-01", "2030-03-04"],
};
const NOMBRE: Record<number, string> = { 1: "Hotel Almirante", 2: "Hotel Caribe", 3: "Hotel Lejano", 4: "Hotel Cuarto" };
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number; habitaciones: Record<string, number> }) => {
      const lineasHab = Object.entries(r.habitaciones).filter(([, n]) => n > 0).map(([acom, n]) => ({
        acom, habitaciones: n, pax: n * CAP[acom], pvp: Math.round(TARIFA[r.hotelId] * (acom === "sencilla" ? RECARGO_SENCILLA : 1)),
      }));
      const [ida, regreso] = FECHAS[r.hotelId];
      return {
        ok: true,
        data: {
          meta: { hotel_nombre: NOMBRE[r.hotelId], destino_nombre: "CARTAGENA", fecha_ida: ida, fecha_regreso: regreso },
          precioVenta: lineasHab.reduce((s, l) => s + l.pvp * l.pax, 0), monedaReserva: "COP", lineasHab,
          pvpPorAcom: Object.fromEntries(lineasHab.map((l) => [l.acom, l.pvp])),
          numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: lineasHab.reduce((s, l) => s + l.pax, 0),
          edadesMenoresUsadas: [], serviciosIncluidos: [], distribucionMenores: [], condicionesTarifa: null,
        },
      };
    },
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", {
  namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } },
});
let SERVICIOS: Record<string, { nombre: string; total: number }> = {};
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    liquidarServicioPuntual: async (t: { paqueteId: number; servicioId: number; pax: number; fechaIda: string; fechaRegreso: string }) => {
      const s = SERVICIOS[`${t.paqueteId}-${t.servicioId}`];
      if (!s) return { ok: false, tipo: "no_disponible", mensaje: "Ese servicio no está disponible para esas fechas." };
      return { ok: true, resultado: { servicioId: t.servicioId, paqueteId: t.paqueteId, nombre: s.nombre, destino: "CARTAGENA", descripcion: null, total: s.total, pax: t.pax, noches: 3, moneda: "COP", categoria: "otro" } };
    },
  },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente("sesion") } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente("servicio") } });
mock.module("next/headers", { namedExports: { headers: async () => CABECERAS } });

const A = await import("../app/tarifario/checkout/actions.ts");
const TOKEN = "11111111-2222-3333-4444-555555555555";
const OTRO_TOKEN = "99999999-8888-7777-6666-555555555555";

const CLIENTE = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123456", telefono: "3001112233", email: "ana@x.test" };
function hotel(itemId: string, hotelId: number, paqueteId = 10) {
  const [ida, regreso] = FECHAS[hotelId];
  return {
    itemId, modulo: "porcion_terrestre", paqueteId, hotelId, bloqueoId: null, hotelNombre: NOMBRE[hotelId], destino: "CARTAGENA",
    categoria: "Estandar", regimen: "Desayuno", fechaIda: ida, fechaRegreso: regreso, noches: 3,
    habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
  };
}
const tour = (servicioId: number, hotelItemId: string | null, paqueteId = 10) => ({ servicioId, paqueteId, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, hotelItemId });
const crear = (items: unknown[], tours: unknown[] = [], extra: Record<string, unknown> = {}) => A.crearComparativaCarrito({ items, tours, cliente: CLIENTE, ...extra });
const llamadas = (nombre: string) => rpcs.filter((r) => r.nombre === nombre);

beforeEach(() => {
  rpcs.length = 0; insertsDirectos.length = 0; USUARIO = null;
  TABLAS = {}; RESPUESTA_RPC = {};
  CABECERAS = new Map([["host", "localhost"]]);
  TARIFA = { 1: 300_000, 2: 250_000, 3: 280_000, 4: 200_000 };
  SERVICIOS = { "10-55": { nombre: "City tour", total: 85_000 }, "10-56": { nombre: "Islas", total: 180_000 } };
  RESPUESTA_RPC = { crear_cotizacion_comparativa: { data: 900 } };
  TABLAS.cotizaciones = [{ id: 900, codigo: "C-0900", share_token: TOKEN, modo: "comparativa" }];
});

describe("crearComparativaCarrito — armado de opciones con el motor real", () => {
  test("dos hoteles → UNA llamada a la RPC; ningún insert directo en cotizaciones", async () => {
    const r = await crear([hotel("hA", 1), hotel("hB", 2)]);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.equal(llamadas("crear_cotizacion_comparativa").length, 1);
    assert.equal(insertsDirectos.filter((i) => i.tabla === "cotizaciones").length, 0, "la madre solo se crea por RPC");
    assert.ok(r.ok && r.id === 900 && r.codigo === "C-0900");
  });

  test("cada hotel genera sus acomodaciones uniformes; la del carrito va primero y cada una tiene su total", async () => {
    await crear([hotel("hA", 1), hotel("hB", 2)]);
    const ops = llamadas("crear_cotizacion_comparativa")[0].args.p_opciones as Array<{ opcion_ref: string; acomodacion_ref: string; total: number; tarifa_persona: number; etiqueta: string }>;
    assert.deepEqual(ops.map((o) => `${o.opcion_ref}/${o.acomodacion_ref}`), ["A/doble", "A/sencilla", "B/doble", "B/sencilla"]);
    const por = Object.fromEntries(ops.map((o) => [`${o.opcion_ref}/${o.acomodacion_ref}`, o]));
    assert.equal(por["A/doble"].total, 300_000 * 2);
    assert.equal(por["A/sencilla"].total, 450_000 * 2, "dos sencillas: tarifa de sencilla por persona × 2");
    assert.equal(por["B/doble"].total, 250_000 * 2);
    assert.equal(por["A/doble"].tarifa_persona, 300_000, "tarifa por persona de la acomodación elegida");
    assert.equal(por["A/doble"].etiqueta, "Hotel Almirante");
  });

  test("los servicios vinculados entran SOLO al total de SU hotel (nunca al otro)", async () => {
    await crear([hotel("hA", 1), hotel("hB", 2)], [tour(55, "hA")]);
    const ops = llamadas("crear_cotizacion_comparativa")[0].args.p_opciones as Array<{ opcion_ref: string; acomodacion_ref: string; total: number }>;
    const por = Object.fromEntries(ops.map((o) => [`${o.opcion_ref}/${o.acomodacion_ref}`, o.total]));
    assert.equal(por["A/doble"], 600_000 + 85_000);
    assert.equal(por["B/doble"], 500_000, "el hotel B no cobra el servicio del hotel A");
  });

  test("ninguna opción suma a otra: no hay total global en lo enviado", async () => {
    await crear([hotel("hA", 1), hotel("hB", 2)]);
    const args = llamadas("crear_cotizacion_comparativa")[0].args;
    assert.ok(!/total_global|suma_opciones|precio_venta":\s*\d/.test(JSON.stringify(args.p_cabecera)), "la cabecera de la madre no lleva precio");
  });

  test("la plantilla de cada opción conserva SOLO su hotel (payload de la hija)", async () => {
    await crear([hotel("hA", 1), hotel("hB", 2)]);
    const ops = llamadas("crear_cotizacion_comparativa")[0].args.p_opciones as Array<{ opcion_ref: string; plantilla_hija: { payload: { items: { hotelNombre: string }[] } } }>;
    for (const o of ops) {
      const nombres = o.plantilla_hija.payload.items.map((i) => i.hotelNombre);
      assert.equal(nombres.length, 1);
      assert.equal(nombres[0], o.opcion_ref === "A" ? "Hotel Almirante" : "Hotel Caribe");
    }
  });

  test("la identidad sale de la SESIÓN: un cuerpo que miente (userId/canal/tenant) no cambia nada", async () => {
    await crear([hotel("hA", 1), hotel("hB", 2)], [], { userId: "11111111-1111-1111-1111-111111111111", canal: "interno", tenant: "minorista", actor: { rol: "superadmin" } });
    const a = llamadas("crear_cotizacion_comparativa")[0].args;
    assert.equal(a.p_usuario_id, null, "anónimo: sin sesión no hay actor");
    assert.equal(llamadas("crear_cotizacion_comparativa")[0].cliente, "servicio");
    assert.ok(!JSON.stringify(a.p_cabecera).includes("minorista"));
  });

  test("con sesión interna: el actor es el de la sesión", async () => {
    USUARIO = { id: "22222222-2222-2222-2222-222222222222", email: "asesor@dspacios.test" };
    TABLAS.usuarios = [{ id: USUARIO.id, rol: "venta", activo: true, aliado_id: null }];
    await crear([hotel("hA", 1), hotel("hB", 2)]);
    const a = llamadas("crear_cotizacion_comparativa")[0].args;
    assert.equal(a.p_usuario_id, USUARIO.id);
    assert.equal((a.p_cabecera as { creado_por: string }).creado_por, "asesor@dspacios.test");
    assert.equal(a.p_aliado_id, null);
  });

  test("con sesión B2B vinculada a un aliado: el aliado lo da la BASE (usuarios.aliado_id), no el cliente", async () => {
    USUARIO = { id: "33333333-3333-3333-3333-333333333333", email: "agencia@x.test" };
    TABLAS.usuarios = [{ id: USUARIO.id, rol: "agencia", activo: true, aliado_id: 77 }];
    await crear([hotel("hA", 1), hotel("hB", 2)], [], { aliadoId: 999 });
    const a = llamadas("crear_cotizacion_comparativa")[0].args;
    assert.equal(a.p_aliado_id, 77);
    assert.equal((a.p_cabecera as { payload: { tipoAsesor: string } }).payload.tipoAsesor, "agencia");
  });

  test("un usuario inactivo o con rol de cliente final navega como visitante anónimo", async () => {
    USUARIO = { id: "44444444-4444-4444-4444-444444444444", email: "x@x.test" };
    TABLAS.usuarios = [{ id: USUARIO.id, rol: "cliente_final", activo: true, aliado_id: null }];
    await crear([hotel("hA", 1), hotel("hB", 2)]);
    assert.equal(llamadas("crear_cotizacion_comparativa")[0].args.p_usuario_id, null);
    TABLAS.usuarios = [{ id: USUARIO.id, rol: "administracion", activo: false, aliado_id: null }];
    rpcs.length = 0;
    await crear([hotel("hA", 1), hotel("hB", 2)]);
    assert.equal(llamadas("crear_cotizacion_comparativa")[0].args.p_usuario_id, null);
  });

  test("reglas v1: un hotel, cuatro hoteles, vuelo negociado, Bernalo y servicios sueltos se rechazan SIN llamar a la RPC", async () => {
    const casos: [string, () => Promise<{ ok: boolean; error?: string }>, RegExp][] = [
      ["un hotel", () => crear([hotel("hA", 1)]), /entre 2 y 3 hoteles/],
      ["cuatro hoteles", () => crear([hotel("a", 1), hotel("b", 2), hotel("c", 3), hotel("d", 4)]), /entre 2 y 3 hoteles/],
      ["vuelo negociado", () => crear([{ ...hotel("hA", 1), modulo: "bloqueo", bloqueoId: 5 }, hotel("hB", 2)]), /vuelo negociado/],
      ["servicio suelto", () => crear([hotel("hA", 1), hotel("hB", 2)], [tour(55, null)]), /vinculado a un hotel/],
      ["Bernalo", () => crear([{ modeloTarifario: "unidad", itemId: "u", paqueteId: 1, hotelId: 9, hotelNombre: "B", destino: "X", categoria: "c", alimentacion: "a", salida: { tipo: "sin_vuelo", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04" }, habitaciones: [], precio: 1, moneda: "COP" }, hotel("hB", 2)]), /./],
    ];
    for (const [nombre, f, patron] of casos) {
      const r = await f();
      assert.equal(r.ok, false, nombre);
      assert.match(r.error ?? "", patron, nombre);
    }
    assert.equal(llamadas("crear_cotizacion_comparativa").length, 0);
  });

  test("distinto destino/fechas entre hoteles se rechaza (mismo viaje)", async () => {
    const r = await crear([hotel("hA", 1), hotel("hC", 3)]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /mismo destino, fechas, pasajeros y moneda/);
    assert.equal(llamadas("crear_cotizacion_comparativa").length, 0);
  });

  test("un error de la base llega como mensaje neutro, sin SQL", async () => {
    RESPUESTA_RPC.crear_cotizacion_comparativa = { data: null, error: { message: 'new row for relation "cotizaciones" violates check constraint "cotizaciones_comparativa_forma"' } };
    const r = await crear([hotel("hA", 1), hotel("hB", 2)]);
    assert.equal(r.ok, false);
    assert.ok(!/relation|constraint|violates/i.test(r.ok ? "" : r.error));
  });
});

// Estado de una comparativa recién creada, tal como la guardaría la RPC.
async function madreGuardada() {
  await crear([hotel("hA", 1), hotel("hB", 2)], [tour(55, "hA")]);
  const args = llamadas("crear_cotizacion_comparativa")[0].args;
  const ops = args.p_opciones as Fila[];
  TABLAS.cotizaciones = [{ id: 900, codigo: "C-0900", share_token: "11111111-2222-3333-4444-555555555555", tipo: "comparativa_carrito", modo: "comparativa", estado: "abierta", version: 1, vigencia_hasta: "2099-01-01", destino: "CARTAGENA", fecha_salida: "2030-03-01", fecha_regreso: "2030-03-04", pax: 2 }];
  TABLAS.cotizacion_opciones = ops.map((o) => ({ ...o, cotizacion_id: 900, tarifa_persona: o.tarifa_persona ?? null }));
  rpcs.length = 0; insertsDirectos.length = 0;
}
const ELEGIR = { token: TOKEN, opcionRef: "A", acomodacionRef: "doble", version: 1, clave: "clave-prueba-0001" };
const CLIENTE_PUBLICO = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123456", telefono: "3001112233", email: "" };

describe("elegirOpcionComparativa — reliquida, emite el recibo y consume por el canal correcto", () => {
  test("anónimo: valida identidad ANTES de todo; sin datos no se emite recibo", async () => {
    await madreGuardada();
    const r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: { ...CLIENTE_PUBLICO, numeroDoc: "" } });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /documento/i);
    assert.equal(rpcs.length, 0);
  });

  test("anónimo con datos: recibo canal 'publico' sin actor y consumo por service-role (no por sesión)", async () => {
    await madreGuardada();
    RESPUESTA_RPC = { registrar_validacion_comparativa: { data: "r-1" }, elegir_opcion_comparativa_publica: { data: 901 } };
    TABLAS.cotizaciones.push({ id: 901, codigo: "C-0901", share_token: "tok-901" });
    const r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const v = llamadas("registrar_validacion_comparativa")[0];
    assert.equal(v.cliente, "servicio");
    assert.equal(v.args.p_canal, "publico");
    assert.equal(v.args.p_actor_id, null);
    assert.equal(v.args.p_precio_reliquidado, 600_000 + 85_000, "el precio del recibo sale de la RELIQUIDACIÓN, no del navegador");
    const c = llamadas("elegir_opcion_comparativa_publica")[0];
    assert.equal(c.cliente, "servicio");
    assert.deepEqual(Object.keys(c.args).sort(), ["p_clave", "p_validacion"], "el consumo recibe solo el recibo y la clave");
    assert.equal(llamadas("elegir_opcion_comparativa_sesion").length, 0);
  });

  test("el cuerpo no puede elegir canal ni actor: un anónimo que dice ser 'interno' sigue siendo público", async () => {
    await madreGuardada();
    RESPUESTA_RPC = { registrar_validacion_comparativa: { data: "r-1" }, elegir_opcion_comparativa_publica: { data: 901 } };
    TABLAS.cotizaciones.push({ id: 901, codigo: "C-0901", share_token: "tok-901" });
    await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO, canal: "interno", actor: "x", userId: "11111111-1111-1111-1111-111111111111", precio: 1 });
    const v = llamadas("registrar_validacion_comparativa")[0];
    assert.equal(v.args.p_canal, "publico");
    assert.equal(v.args.p_actor_id, null);
    assert.equal(v.args.p_precio_reliquidado, 685_000);
  });

  test("sesión interna: recibo con el actor de la sesión y consumo con el cliente de SESIÓN (identidad = auth.uid())", async () => {
    await madreGuardada();
    USUARIO = { id: "22222222-2222-2222-2222-222222222222", email: "asesor@dspacios.test" };
    TABLAS.usuarios = [{ id: USUARIO.id, rol: "venta", activo: true, aliado_id: null }];
    TABLAS.cotizaciones.push({ id: 902, codigo: "C-0902", share_token: "tok-902" });
    RESPUESTA_RPC = { registrar_validacion_comparativa: { data: "r-2" }, elegir_opcion_comparativa_sesion: { data: 902 } };
    const r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: null });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const v = llamadas("registrar_validacion_comparativa")[0];
    assert.equal(v.args.p_canal, "interno");
    assert.equal(v.args.p_actor_id, USUARIO.id);
    const c = llamadas("elegir_opcion_comparativa_sesion")[0];
    assert.equal(c.cliente, "sesion", "el consumo usa el cliente con el JWT del usuario, no service-role");
    assert.equal(llamadas("elegir_opcion_comparativa_publica").length, 0);
  });

  test("sesión B2B: canal 'b2b' con su id", async () => {
    await madreGuardada();
    USUARIO = { id: "33333333-3333-3333-3333-333333333333", email: "agencia@x.test" };
    TABLAS.usuarios = [{ id: USUARIO.id, rol: "agencia", activo: true, aliado_id: 77 }];
    TABLAS.cotizaciones.push({ id: 903, codigo: "C-0903", share_token: "tok-903" });
    RESPUESTA_RPC = { registrar_validacion_comparativa: { data: "r-3" }, elegir_opcion_comparativa_sesion: { data: 903 } };
    await A.elegirOpcionComparativa({ ...ELEGIR, cliente: null });
    const v = llamadas("registrar_validacion_comparativa")[0];
    assert.equal(v.args.p_canal, "b2b");
    assert.equal(v.args.p_actor_id, USUARIO.id);
  });

  test("el precio cambió: NO se emite recibo, se devuelve el nuevo valor y hay que confirmar de nuevo", async () => {
    await madreGuardada();
    TARIFA[1] = 320_000;
    const r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.tipo === "precio_actualizado" && r.pvp === 640_000 + 85_000);
    assert.ok(!r.ok && r.reintentable === false, "la comparativa es inmutable: no hay nada que reintentar ni confirmar");
    assert.match(r.ok ? "" : r.error, /comparativa nueva/);
    assert.doesNotMatch(r.ok ? "" : r.error, /confirma de nuevo/i);
    assert.equal(llamadas("registrar_validacion_comparativa").length, 0, "sin recibo no hay elección");
    assert.equal(llamadas("elegir_opcion_comparativa_publica").length, 0);
  });

  test("un servicio que dejó de estar disponible impide la elección (no se crea nada parcial)", async () => {
    await madreGuardada();
    SERVICIOS = {};
    const r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, false);
    assert.equal(llamadas("registrar_validacion_comparativa").length, 0);
  });

  test("versión desactualizada, comparativa no abierta u opción inexistente: mensajes neutros y sin RPC", async () => {
    await madreGuardada();
    let r = await A.elegirOpcionComparativa({ ...ELEGIR, version: 2, cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, false); assert.match(r.ok ? "" : r.error, /cambió/);
    r = await A.elegirOpcionComparativa({ ...ELEGIR, acomodacionRef: "multiple", cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, false); assert.match(r.ok ? "" : r.error, /ya no existe/);
    TABLAS.cotizaciones[0].estado = "descartada";
    r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, false); assert.match(r.ok ? "" : r.error, /ya no está disponible/);
    TABLAS.cotizaciones = [];
    const r2 = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO });
    assert.equal(r2.ok, false); assert.match(r2.ok ? "" : r2.error, /ya no está disponible/, "no existe y no es tuya responden igual");
    assert.equal(rpcs.length, 0);
  });

  test("una madre MANUAL no continúa por checkout para un visitante: solo solicitud", async () => {
    await madreGuardada();
    TABLAS.cotizaciones[0].tipo = "comparativa_manual";
    const r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /solicitud/i);
    assert.equal(rpcs.length, 0);
  });

  test("un error de la base se traduce a un mensaje neutro y 'reintentable' cuando corresponde", async () => {
    await madreGuardada();
    RESPUESTA_RPC = { registrar_validacion_comparativa: { data: "r-1" }, elegir_opcion_comparativa_publica: { data: null, error: { message: "COMPARATIVA_HIJA_ACTIVA: ya hay una opción elegida\nCONTEXT: PL/pgSQL function f211_priv.crear_hija" } } };
    const r = await A.elegirOpcionComparativa({ ...ELEGIR, cliente: CLIENTE_PUBLICO });
    assert.equal(r.ok, false);
    assert.ok(!/PL\/pgSQL|CONTEXT|f211_priv/.test(r.ok ? "" : r.error), "no se filtran nombres internos");
    assert.match(r.ok ? "" : r.error, /opción elegida/);
  });

  test("clave de idempotencia obligatoria y con formato válido", async () => {
    await madreGuardada();
    for (const clave of [undefined, "", "corta", "x".repeat(81), "con espacios y ñ ñ"]) {
      const r = await A.elegirOpcionComparativa({ ...ELEGIR, clave, cliente: CLIENTE_PUBLICO });
      assert.equal(r.ok, false, String(clave));
    }
    assert.equal(rpcs.length, 0);
  });
});

describe("solicitarOpcionComparativa — solo registra una solicitud", () => {
  const SOL = { token: TOKEN, opcionRef: "A", acomodacionRef: "doble", version: 1, clave: "clave-solicitud-1", contacto: { nombre: "Beto Ruiz", telefono: "3109998877", email: "", nota: "" } };

  test("registra por service-role y no toca cotizaciones, recibos ni la elección", async () => {
    RESPUESTA_RPC = { registrar_solicitud_comparativa: { data: { id: 5, estado: "pendiente" } } };
    const r = await A.solicitarOpcionComparativa(SOL);
    assert.deepEqual(r, { ok: true, actualizada: false });
    assert.equal(rpcs.length, 1);
    assert.equal(rpcs[0].nombre, "registrar_solicitud_comparativa");
    assert.equal(rpcs[0].cliente, "servicio");
    assert.equal(insertsDirectos.length, 0);
  });

  test("fuera de Vercel no hay IP confiable: p_ip_huella = null aunque el cliente mande cabeceras", async () => {
    delete process.env.VERCEL;
    CABECERAS = new Map([["host", "localhost"], ["x-forwarded-for", "6.6.6.6"], ["x-real-ip", "7.7.7.7"]]);
    await A.solicitarOpcionComparativa(SOL);
    assert.equal(rpcs[0].args.p_ip_huella, null);
  });

  test("en Vercel usa SOLO la cabecera de la plataforma, la guarda como HUELLA y nunca cruda; un x-forwarded-for del cliente se ignora", async () => {
    process.env.VERCEL = "1";
    try {
      CABECERAS = new Map([["host", "localhost"], ["x-forwarded-for", "6.6.6.6, 203.0.113.7"], ["x-vercel-forwarded-for", "203.0.113.7"]]);
      await A.solicitarOpcionComparativa(SOL);
      const h1 = String(rpcs[0].args.p_ip_huella);
      assert.ok(h1 && !h1.includes("203.0.113.7") && !h1.includes("6.6.6.6"));
      // La misma IP da la misma huella; otra IP, otra huella; el x-forwarded-for solo NO produce huella.
      rpcs.length = 0; await A.solicitarOpcionComparativa({ ...SOL, clave: "clave-solicitud-2" });
      assert.equal(rpcs[0].args.p_ip_huella, h1);
      rpcs.length = 0; CABECERAS = new Map([["host", "localhost"], ["x-vercel-forwarded-for", "198.51.100.9"]]);
      await A.solicitarOpcionComparativa({ ...SOL, clave: "clave-solicitud-3" });
      assert.notEqual(rpcs[0].args.p_ip_huella, h1);
      rpcs.length = 0; CABECERAS = new Map([["host", "localhost"], ["x-forwarded-for", "6.6.6.6"]]);
      await A.solicitarOpcionComparativa({ ...SOL, clave: "clave-solicitud-4" });
      assert.equal(rpcs[0].args.p_ip_huella, null, "un x-forwarded-for escrito por el cliente no cuenta");
    } finally { delete process.env.VERCEL; }
  });

  test("contacto inválido: no se llama a la RPC", async () => {
    for (const contacto of [{ nombre: "A", telefono: "3109998877", email: "", nota: "" }, { nombre: "Beto Ruiz", telefono: "", email: "", nota: "" }, { nombre: "Beto Ruiz", telefono: "123", email: "", nota: "" }, { nombre: "Beto Ruiz", telefono: "", email: "no", nota: "" }]) {
      const r = await A.solicitarOpcionComparativa({ ...SOL, contacto });
      assert.equal(r.ok, false);
    }
    assert.equal(rpcs.length, 0);
  });

  test("el límite devuelve un mensaje neutro (no revela qué tope se alcanzó)", async () => {
    RESPUESTA_RPC = { registrar_solicitud_comparativa: { data: null, error: { message: "COMPARATIVA_LIMITE: no pudimos registrar tu solicitud ahora.\nCONTEXT: ..." } } };
    const r = await A.solicitarOpcionComparativa(SOL);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /más tarde/);
    assert.ok(!/b(50|IP|hora|horas|contacto|madre)b/i.test(r.ok ? "" : r.error));
  });

  test("la identidad de la sesión no interviene: el cuerpo no puede inyectar un usuario", async () => {
    USUARIO = { id: "22222222-2222-2222-2222-222222222222", email: "a@a.test" };
    await A.solicitarOpcionComparativa({ ...SOL, usuarioId: "x", canal: "interno" });
    assert.ok(!JSON.stringify(rpcs[0].args).includes("22222222"));
    assert.ok(!("p_usuario_id" in rpcs[0].args) && !("p_canal" in rpcs[0].args));
  });
});

describe("resumenOpcionComparativa — lectura pública mínima", () => {
  test("devuelve solo datos públicos de UNA opción; el token no es una credencial de escritura", async () => {
    await madreGuardada();
    const r = await A.resumenOpcionComparativa("11111111-2222-3333-4444-555555555555", "A", "doble");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(Object.keys(r.datos).sort(), ["acomodacionRef", "destino", "etiqueta", "fechaRegreso", "fechaSalida", "moneda", "opcionRef", "pax", "tarifaPersona", "tipo", "total", "vencida", "version", "vigenciaHasta", "vuelos"].sort());
    assert.deepEqual(r.datos.vuelos, [], "sin vuelos manuales comunes la lista va vacía (y nunca lleva precio, costo ni proveedor)");
    assert.equal(r.datos.total, 685_000);
    assert.ok(!JSON.stringify(r).includes("plantilla") && !JSON.stringify(r).includes("payload"));
    assert.equal(rpcs.length, 0, "leer no ejecuta ninguna RPC");
    assert.equal(insertsDirectos.length, 0);
  });
  test("token inválido, opción o madre inexistente: la misma respuesta neutra", async () => {
    await madreGuardada();
    for (const [t, o, a] of [["no-es-un-uuid", "A", "doble"], ["11111111-2222-3333-4444-555555555555", "Z", "doble"], ["11111111-2222-3333-4444-555555555555", "A", "Triple!"], ["99999999-2222-3333-4444-555555555555", "A", "doble"]] as const) {
      const r = await A.resumenOpcionComparativa(t, o, a);
      assert.equal(r.ok, false, `${t}/${o}/${a}`);
    }
  });
});

describe("las dos acciones públicas están ligadas al ENLACE de la comparativa", () => {
  const CONTACTO = { nombre: "Beto Ruiz", telefono: "3109998877", email: "", nota: "" };
  const SOL = { token: TOKEN, opcionRef: "A", acomodacionRef: "doble", version: 1, clave: "clave-solicitud-1", contacto: CONTACTO };

  test("un id numérico adivinado SIN enlace se rechaza (elegir y solicitar): ni RPC, ni lectura de la comparativa", async () => {
    await madreGuardada();
    RESPUESTA_RPC = { registrar_validacion_comparativa: { data: "r-1" }, elegir_opcion_comparativa_publica: { data: 901 }, registrar_solicitud_comparativa: { data: { id: 1 } } };
    for (const id of [900, "900", 1, 901]) {
      const e = await A.elegirOpcionComparativa({ madreId: id, opcionRef: "A", acomodacionRef: "doble", version: 1, clave: "clave-prueba-0001", cliente: CLIENTE_PUBLICO });
      assert.equal(e.ok, false);
      assert.match(e.ok ? "" : e.error, /Enlace de la comparativa inválido/);
      const s = await A.solicitarOpcionComparativa({ madreId: id, opcionRef: "A", acomodacionRef: "doble", version: 1, clave: "clave-solicitud-1", contacto: CONTACTO });
      assert.equal(s.ok, false);
      assert.match(s.ok ? "" : s.error, /Enlace de la comparativa inválido/);
    }
    assert.equal(rpcs.length, 0, "ninguna RPC con un id adivinado");
  });

  test("token con forma inválida (corto, no hexadecimal, SQL) se rechaza", async () => {
    await madreGuardada();
    for (const token of ["900", "tok-900", "11111111-2222-3333-4444-55555555555Z", "' or 1=1 --", "", null, 900]) {
      const e = await A.elegirOpcionComparativa({ ...ELEGIR, token, cliente: CLIENTE_PUBLICO });
      const s = await A.solicitarOpcionComparativa({ ...SOL, token });
      assert.equal(e.ok, false, String(token)); assert.equal(s.ok, false, String(token));
    }
    assert.equal(rpcs.length, 0);
  });

  test("un token bien formado pero de otra comparativa o inexistente: respuesta neutra idéntica y sin RPC", async () => {
    await madreGuardada();
    const e = await A.elegirOpcionComparativa({ ...ELEGIR, token: OTRO_TOKEN, cliente: CLIENTE_PUBLICO });
    const s = await A.solicitarOpcionComparativa({ ...SOL, token: OTRO_TOKEN });
    assert.equal(e.ok, false); assert.equal(s.ok, false);
    assert.match(e.ok ? "" : e.error, /ya no está disponible/);
    assert.match(s.ok ? "" : s.error, /ya no está disponible/);
    assert.equal(rpcs.length, 0);
  });

  test("con el token correcto, un madreId extra del cuerpo se IGNORA: la comparativa sale del token", async () => {
    await madreGuardada();
    TABLAS.cotizaciones.push({ id: 777, codigo: "C-0777", share_token: OTRO_TOKEN, modo: "comparativa", tipo: "comparativa_carrito", estado: "abierta", version: 1 });
    RESPUESTA_RPC = { registrar_solicitud_comparativa: { data: { id: 5, estado: "pendiente" } }, registrar_validacion_comparativa: { data: "r-1" }, elegir_opcion_comparativa_publica: { data: 901 } };
    await A.solicitarOpcionComparativa({ ...SOL, madreId: 777 });
    assert.equal(llamadas("registrar_solicitud_comparativa")[0].args.p_madre_id, 900);
    TABLAS.cotizaciones.push({ id: 901, codigo: "C-0901", share_token: "tok-901" });
    await A.elegirOpcionComparativa({ ...ELEGIR, madreId: 777, cliente: CLIENTE_PUBLICO });
    assert.equal(llamadas("registrar_validacion_comparativa")[0].args.p_madre_id, 900);
  });

  test("solicitar contra una cotización que NO es comparativa (token de una cotización simple) se rechaza", async () => {
    TABLAS.cotizaciones = [{ id: 50, codigo: "C-0050", share_token: TOKEN, modo: "simple" }];
    const s = await A.solicitarOpcionComparativa({ ...SOL });
    assert.equal(s.ok, false);
    assert.equal(rpcs.length, 0);
  });
});
