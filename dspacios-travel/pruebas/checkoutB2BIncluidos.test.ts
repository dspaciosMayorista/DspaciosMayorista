// Ejecución REAL de app/tarifario/checkout/actions.ts con dos clientes
// simulados distintos — sesión (sujeta a RLS) y service-role — para dos
// bloqueos de PR #353:
//
// 1. Facturación B2B (`getContextoB2B`): `b2b_solicitudes` solo la leen roles
//    administrativos (migración 193). Con la sesión del aliado devolvía 0
//    filas y NIT/teléfono salían vacíos. Ahora se lee con service-role SOLO
//    tras verificar identidad y relación de agencia, por el id de la cuenta
//    verificada (titular o la agencia del agente), y solo 4 campos.
//    Sin dato de origen no se inventa nada.
// 2. Servicios incluidos del paquete en la cotización: el resumen del
//    documento (asistencia) los refleja, el payload conserva lo que la CxP
//    necesita sin `proveedorId`, y ninguna superficie que llega al navegador
//    o al enlace público lleva costos ni proveedores.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service";

// ── Base simulada ────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
type Consulta = { cliente: "sesion" | "servicio"; tabla: string; columnas: string; filtros: [string, unknown][] };
const consultas: Consulta[] = [];
const inserts: { tabla: string; fila: Fila }[] = [];
let usuarioSesion: { id: string; email: string } | null = null;
let USUARIOS: Fila[] = [];
let SOLICITUDES: Fila[] = [];
// Fallo simulado de la lectura service-role de `b2b_solicitudes`.
let FALLO_SOLICITUD: null | "error" | "excepcion" = null;

function cliente(tipo: "sesion" | "servicio") {
  const from = (tabla: string) => {
    const c: Consulta = { cliente: tipo, tabla, columnas: "", filtros: [] };
    const filas = (): Fila[] => {
      // La RLS de `b2b_solicitudes` (migración 193) no deja leer a B2B:
      // con la sesión del aliado no devuelve nada, sin error.
      const base = tabla === "usuarios" ? USUARIOS : tabla === "b2b_solicitudes" ? (tipo === "servicio" ? SOLICITUDES : []) : [];
      return base.filter((f) => c.filtros.every(([k, v]) => f[k] === v));
    };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: (cols: string) => { c.columnas = cols; consultas.push(c); return b; },
      eq: (k: string, v: unknown) => { c.filtros.push([k, v]); return b; },
      order: () => b, limit: () => b, in: () => b,
      maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      single: async () => ({ data: { id: 77, codigo: "COT-77", share_token: "tok" }, error: null }),
      insert: (fila: Fila) => { inserts.push({ tabla, fila }); return b; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (tipo === "servicio" && tabla === "b2b_solicitudes" && FALLO_SOLICITUD === "error") {
          return Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout on b2b_solicitudes" } }).then(ok, ko);
        }
        if (tipo === "servicio" && tabla === "b2b_solicitudes" && FALLO_SOLICITUD === "excepcion") {
          return Promise.reject(new Error("fetch failed: ECONNRESET dummy.supabase.co")).then(ok, ko);
        }
        return Promise.resolve({ data: filas(), error: null }).then(ok, ko);
      },
    });
    return b;
  };
  return { from, auth: { getUser: async () => ({ data: { user: usuarioSesion }, error: null }) } };
}

// ── Motor de reserva simulado: lo que `computarReserva` resuelve ──────────
type Incluido = { servicioId: number; nombre: string; categoria: "asistencia" | "tour_traslado" | "otro"; incluido: true; costoNeto: number; proveedorId: number | null };
let INCLUIDOS: Incluido[] = [];
let CARGO_GRUPO = 0;
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async () => ({
      ok: true,
      data: {
        meta: { hotel_nombre: "OZ HOTEL CARTAGENA", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
        // Por persona: ya horneado en la tarifa. Por grupo: se cobra una vez aparte.
        precioVenta: 300_000 * 2 + CARGO_GRUPO, monedaReserva: "COP",
        lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 300_000 }], pvpPorAcom: { doble: 300_000 },
        numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: 2, edadesMenoresUsadas: [],
        serviciosIncluidos: INCLUIDOS, distribucionMenores: [], condicionesTarifa: null,
      },
    }),
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", {
  namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa en esta prueba"); } },
});
mock.module("@/lib/reservar/cotizar", {
  namedExports: { liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no se usa" }) },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente("sesion") } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente("servicio") } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });

const { getContextoB2B, crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");

const TITULAR = { id: "u-titular", nombre: "Agencia Uno SAS", email: "agencia@uno.test", rol: "agencia", agencia_id: null, pct_comision: 0.11, activo: true };
const SOL_TITULAR = { usuario_id: "u-titular", nombre: "Agencia Uno SAS", nit: "900123456", email: "facturas@uno.test", telefono: "3001112233" };
const consultasSolicitud = () => consultas.filter((c) => c.tabla === "b2b_solicitudes");

beforeEach(() => {
  consultas.length = 0;
  inserts.length = 0;
  usuarioSesion = null;
  USUARIOS = [];
  SOLICITUDES = [];
  FALLO_SOLICITUD = null;
  INCLUIDOS = [];
  CARGO_GRUPO = 0;
});

describe("getContextoB2B — facturación B2B leída en el servidor con la cuenta verificada", () => {
  test("agencia titular: NIT y teléfono de su solicitud, leída con service-role por SU id y solo 4 campos", async () => {
    usuarioSesion = { id: "u-titular", email: TITULAR.email };
    USUARIOS = [TITULAR];
    SOLICITUDES = [SOL_TITULAR, { usuario_id: "u-otra", nombre: "Otra", nit: "800999", email: "x@otra.test", telefono: "1" }];
    const ctx = await getContextoB2B();
    assert.equal(ctx.esB2B, true);
    assert.deepEqual(ctx.agencia, { nombre: "Agencia Uno SAS", nit: "900123456", email: "facturas@uno.test", telefono: "3001112233" });
    assert.equal(ctx.pctComision, 0.11, "la comisión no cambia");
    const [q] = consultasSolicitud();
    assert.equal(q.cliente, "servicio");
    assert.equal(q.columnas, "nombre, nit, email, telefono");
    assert.deepEqual(q.filtros, [["usuario_id", "u-titular"]]);
    assert.equal(consultasSolicitud().length, 1, "una sola lectura, nunca con la sesión");
  });

  test("agente de una agencia: los datos son los de la agencia TITULAR (relación verificada en el servidor)", async () => {
    usuarioSesion = { id: "u-agente", email: "agente@uno.test" };
    USUARIOS = [{ id: "u-agente", nombre: "Agente", email: "agente@uno.test", rol: "agencia", agencia_id: "u-titular", pct_comision: null, activo: true }, TITULAR];
    SOLICITUDES = [SOL_TITULAR, { usuario_id: "u-agente", nombre: "Agente", nit: "111", email: "agente@uno.test", telefono: "2" }];
    const ctx = await getContextoB2B();
    assert.equal(ctx.esB2B, true);
    assert.equal(ctx.agencia?.nit, "900123456");
    assert.deepEqual(consultasSolicitud()[0].filtros, [["usuario_id", "u-titular"]]);
  });

  test("agente con titular inactiva: sin B2B y sin leer ninguna solicitud", async () => {
    usuarioSesion = { id: "u-agente", email: "agente@uno.test" };
    USUARIOS = [{ id: "u-agente", nombre: "Agente", email: "agente@uno.test", rol: "agencia", agencia_id: "u-titular", pct_comision: null, activo: true }, { ...TITULAR, activo: false }];
    SOLICITUDES = [SOL_TITULAR];
    const ctx = await getContextoB2B();
    assert.equal(ctx.esB2B, false);
    assert.equal(consultasSolicitud().length, 0);
  });

  test("cuenta sin solicitud: nombre y correo del perfil; NIT y teléfono vacíos, nunca inventados", async () => {
    usuarioSesion = { id: "u-titular", email: TITULAR.email };
    USUARIOS = [TITULAR];
    const ctx = await getContextoB2B();
    assert.equal(ctx.esB2B, true);
    assert.deepEqual(ctx.agencia, { nombre: "Agencia Uno SAS", nit: "", email: "agencia@uno.test", telefono: "" });
  });

  test("solicitud con teléfono vacío (no es obligatorio al registrarse): NIT sí, teléfono vacío", async () => {
    usuarioSesion = { id: "u-titular", email: TITULAR.email };
    USUARIOS = [TITULAR];
    SOLICITUDES = [{ ...SOL_TITULAR, telefono: null }];
    const ctx = await getContextoB2B();
    assert.equal(ctx.agencia?.nit, "900123456");
    assert.equal(ctx.agencia?.telefono, "");
  });

  test("no B2B (rol interno, inactivo o sin sesión): sin datos y sin leer solicitudes", async () => {
    for (const perfil of [{ ...TITULAR, rol: "venta" }, { ...TITULAR, activo: false }]) {
      consultas.length = 0;
      usuarioSesion = { id: "u-titular", email: TITULAR.email };
      USUARIOS = [perfil];
      SOLICITUDES = [SOL_TITULAR];
      assert.equal((await getContextoB2B()).esB2B, false);
      assert.equal(consultasSolicitud().length, 0);
    }
    consultas.length = 0;
    usuarioSesion = null;
    assert.equal((await getContextoB2B()).esB2B, false);
    assert.equal(consultasSolicitud().length, 0);
  });

  test("falta la llave de servicio: fallo explícito para el aliado verificado, sin datos parciales ni volver a la sesión", async () => {
    const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const errores: string[] = [];
    const consoleError = console.error;
    console.error = (...m: unknown[]) => { errores.push(m.join(" ")); };
    try {
      usuarioSesion = { id: "u-titular", email: TITULAR.email };
      USUARIOS = [TITULAR];
      SOLICITUDES = [SOL_TITULAR];
      const ctx = await getContextoB2B();
      assert.equal(ctx.esB2B, false);
      assert.equal(ctx.agencia, null, "ni nombre ni correo parciales: nada inventado");
      assert.match(ctx.error ?? "", /problema de configuración del servidor/);
      assert.doesNotMatch(ctx.error ?? "", /SUPABASE|SERVICE|ROLE|KEY|llave/i, "el mensaje no expone detalles internos");
      assert.equal(consultasSolicitud().length, 0, "no se intenta con la sesión (devolvería vacío en silencio)");
      assert.ok(errores.some((e) => /getContextoB2B/.test(e)), "queda registrado en el servidor");
      assert.ok(errores.every((e) => !e.includes("dummy-service")), "sin el valor de ningún secreto en el log");

      // La solicitud falla ANTES de crear la cotización (nada a medias).
      const r = await crearSolicitudReserva({ items: [hotelOz], tours: [], cliente: clienteCot, modo: "neta" }) as { ok: boolean; error?: string };
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /problema de configuración del servidor/);
      assert.equal(inserts.filter((i) => i.tabla === "cotizaciones").length, 0);

      // Un usuario que no es B2B no depende de la llave para este contexto.
      consultas.length = 0;
      USUARIOS = [{ ...TITULAR, rol: "venta" }];
      const otro = await getContextoB2B();
      assert.equal(otro.esB2B, false);
      assert.equal(otro.error ?? null, null);
    } finally {
      process.env.SUPABASE_SERVICE_ROLE_KEY = llave;
      console.error = consoleError;
    }
  });

  test("la lectura service-role de la solicitud falla (error o excepción): error público seguro y NINGUNA cotización", async () => {
    const errores: string[] = [];
    const consoleError = console.error;
    console.error = (...m: unknown[]) => { errores.push(m.join(" ")); };
    try {
      for (const fallo of ["error", "excepcion"] as const) {
        consultas.length = 0;
        inserts.length = 0;
        FALLO_SOLICITUD = fallo;
        usuarioSesion = { id: "u-titular", email: TITULAR.email };
        USUARIOS = [TITULAR];
        SOLICITUDES = [SOL_TITULAR];
        const ctx = await getContextoB2B();
        assert.equal(ctx.esB2B, false, "no se trata como B2B con datos a medias");
        assert.equal(ctx.agencia, null);
        assert.match(ctx.error ?? "", /No pudimos cargar los datos de facturación de tu agencia en este momento/);

        // Flujo completo: se aborta ANTES de crear la cotización (ni como B2C).
        const r = await crearSolicitudReserva({ items: [hotelOz], tours: [], cliente: clienteCot, modo: "neta" }) as { ok: boolean; error?: string };
        assert.equal(r.ok, false);
        assert.match(r.error ?? "", /no se generó ninguna cotización/);
        assert.doesNotMatch(r.error ?? "", /statement|timeout|b2b_solicitudes|ECONNRESET|supabase|57014/i, "sin detalle técnico al público");
        assert.equal(inserts.filter((i) => i.tabla === "cotizaciones").length, 0);
        assert.equal(inserts.filter((i) => i.tabla === "crm_contactos").length, 0);
      }
      assert.ok(errores.some((e) => /getContextoB2B.*codigo=57014/.test(e)), "el servidor registra el código del error");
      assert.ok(errores.some((e) => /getContextoB2B.*codigo=excepcion/.test(e)));
      assert.ok(errores.every((e) => !/dummy-service|statement timeout|ECONNRESET/.test(e)), "sin secretos ni el mensaje técnico completo en el log");
    } finally {
      console.error = consoleError;
    }
  });

  test("no recibe nada del navegador: la agencia no se puede elegir desde el cliente", () => {
    assert.equal(getContextoB2B.length, 0);
  });
});

// ── 2. Incluidos del paquete en la cotización ────────────────────────────
const clienteCot = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
const hotelOz = {
  itemId: "hOZ", modulo: "porcion_terrestre", paqueteId: 34, hotelId: 1, bloqueoId: null, hotelNombre: "OZ HOTEL CARTAGENA", destino: "CARTAGENA",
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
};
const ASISTENCIA: Incluido = { servicioId: 9, nombre: "ASISTENCIA MEDICA", categoria: "asistencia", incluido: true, costoNeto: 40_000, proveedorId: 5 };
const cotizacion = () => inserts.find((i) => i.tabla === "cotizaciones")!.fila;
const INTERNOS = /costoNeto|costo_neto|proveedorId|proveedor_id|"proveedor"|40000|40\.000/;

async function enviarComoB2B(modo: "comisionable" | "neta" = "neta") {
  usuarioSesion = { id: "u-titular", email: TITULAR.email };
  USUARIOS = [TITULAR];
  SOLICITUDES = [SOL_TITULAR];
  return crearSolicitudReserva({ items: [hotelOz], tours: [], cliente: clienteCot, modo }) as Promise<Record<string, unknown> & { ok: boolean; error?: string; mensaje?: string }>;
}

describe("checkout — asistencia incluida por persona (OZ HOTEL, paquete 34)", () => {
  test("el documento dice asistencia Sí; el precio no cambia (ya venía en la tarifa)", async () => {
    INCLUIDOS = [ASISTENCIA];
    const r = await enviarComoB2B();
    assert.equal(r.ok, true, r.error);
    const cot = cotizacion();
    const venta = (cot.detalle as { venta: Fila }).venta;
    assert.equal(venta.asistencia_medica, true);
    assert.equal(cot.precio_venta, 600_000, "por persona no se vuelve a sumar");
    const items = (cot.detalle as { items: { descripcion: string }[] }).items;
    assert.equal(items.filter((i) => /Servicios incluidos por grupo/.test(i.descripcion)).length, 0);
  });

  test("payload (legible por `venta`): identidad + huella opaca; sin costo neto ni proveedor", async () => {
    INCLUIDOS = [ASISTENCIA];
    await enviarComoB2B();
    const payload = cotizacion().payload as { serviciosIncluidos: Fila[] };
    assert.equal(payload.serviciosIncluidos.length, 1, "el incluido queda una sola vez");
    const [inc] = payload.serviciosIncluidos;
    assert.deepEqual(Object.keys(inc).sort(), ["categoria", "huella", "huellaProveedor", "incluido", "nombre", "paqueteId", "ref", "servicioId"]);
    assert.match(String(inc.huellaProveedor), /^[A-Za-z0-9_-]{43}$/, "proveedor como HMAC opaco, nunca el id");
    assert.deepEqual([inc.servicioId, inc.categoria, inc.paqueteId, inc.ref], [9, "asistencia", 34, "item-0"]);
    assert.match(String(inc.huella), /^[A-Za-z0-9_-]{43}$/, "HMAC-SHA256 en base64url");
    assert.doesNotMatch(JSON.stringify(cotizacion().payload), INTERNOS, "ningún costo ni proveedor en todo el payload");
  });

  test("la huella no permite deducir el costo sin la clave del servidor", async () => {
    const { huellaCostoIncluido, claveHuellaIncluidos } = await import("../lib/reservar/incluidosCotizados.ts");
    const conClave = huellaCostoIncluido(claveHuellaIncluidos("dummy-service")!, { ref: "item-0", servicioId: 9, costoNeto: 40_000 });
    const otraClave = huellaCostoIncluido(claveHuellaIncluidos("otra-llave")!, { ref: "item-0", servicioId: 9, costoNeto: 40_000 });
    const otroCosto = huellaCostoIncluido(claveHuellaIncluidos("dummy-service")!, { ref: "item-0", servicioId: 9, costoNeto: 40_001 });
    assert.notEqual(conClave, otraClave, "depende de la clave secreta");
    assert.notEqual(conClave, otroCosto, "cualquier cambio de costo cambia la huella");
    const { createHash } = await import("node:crypto");
    assert.notEqual(conClave, createHash("sha256").update(JSON.stringify(["item-0", 9, 4_000_000])).digest("base64url"), "no es un hash sin clave");
  });

  test("superficies B2B/públicas sin datos internos: respuesta al navegador, mensaje y detalle del enlace público", async () => {
    INCLUIDOS = [ASISTENCIA];
    const r = await enviarComoB2B();
    assert.doesNotMatch(JSON.stringify(r), INTERNOS, "la respuesta de la Server Action no lleva costos ni proveedores");
    assert.doesNotMatch(JSON.stringify(r), /payload|serviciosIncluidos/);
    assert.doesNotMatch(r.mensaje ?? "", INTERNOS);
    assert.match(r.mensaje ?? "", /NIT 900123456/, "el mensaje de facturación ya lleva el NIT");
    // `detalle` es lo que lee /cot/[token] (enlace público). Su formato de
    // documento trae la clave `hoteles[].proveedor`, siempre null en el checkout.
    const detalle = cotizacion().detalle as { hoteles: { proveedor: unknown }[] };
    assert.ok(detalle.hoteles.every((h) => h.proveedor === null));
    assert.doesNotMatch(JSON.stringify(detalle).replaceAll('"proveedor":null', ""), INTERNOS, "`detalle` no lleva costos ni proveedores");
  });
});

describe("checkout — incluido por grupo: se cobra una vez con el pax real", () => {
  test("una sola línea de cargo por grupo y total = tarifa + cargo; resumen y payload sin duplicar", async () => {
    CARGO_GRUPO = 90_000;
    INCLUIDOS = [{ servicioId: 12, nombre: "TRASLADO GRUPAL", categoria: "tour_traslado", incluido: true, costoNeto: 70_000, proveedorId: 8 }];
    const r = await enviarComoB2B("comisionable");
    assert.equal(r.ok, true, r.error);
    const cot = cotizacion();
    assert.equal(cot.precio_venta, 600_000 + 90_000);
    const items = (cot.detalle as { items: { descripcion: string; valor_total?: number }[] }).items;
    const cargos = items.filter((i) => /Servicios incluidos por grupo/.test(i.descripcion));
    assert.equal(cargos.length, 1);
    assert.equal(cargos[0].valor_total, 90_000);
    assert.equal((cot.detalle as { venta: Fila }).venta.tours_traslados, "TRASLADO GRUPAL");
    const payload = cot.payload as { serviciosIncluidos: Fila[] };
    assert.equal(payload.serviciosIncluidos.length, 1);
    assert.doesNotMatch(JSON.stringify(payload), /costoNeto|proveedorId|70000|70\.000/);
  });
});
