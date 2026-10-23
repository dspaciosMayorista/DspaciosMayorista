import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// #56 MVP de conversación guiada — ACCIÓN DE SERVIDOR `conversar`. Es un
// endpoint alcanzable con cualquier POST: cada turno revalida sesión, usuario
// activo, rol y tenant ANTES de tocar cualquier consulta, y ante un error
// técnico nunca registra el texto del usuario.

let usuario: { id: string } | null = { id: "u1" };
let perfil: { rol: string; activo: boolean } | null = { rol: "venta", activo: true };
let tenant = "mayorista";
let getUserLlamadas = 0;
const consultas: string[] = [];
const errores: unknown[][] = [];
let explotar = false;

const SESION = {
  auth: {
    getUser: async () => {
      getUserLlamadas++;
      return { data: { user: usuario }, error: null };
    },
  },
  from: () => {
    const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: perfil, error: null }) };
    return b;
  },
};

const sello = { consultado_en: "x", valido_hasta: "y", fuente: "buscarBloqueos", version: "56.1" };
const registrar = (op: string) => {
  consultas.push(op);
  if (explotar) throw new Error("fallo interno con texto del usuario: CC 1234567 ana@example.com");
};

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => SESION } });
mock.module("@/lib/tenant.server", { namedExports: { getTenant: async () => tenant } });
mock.module("@/lib/observabilidad/medicion", {
  namedExports: { generarFlujoId: () => "f1", registrarErrorTecnico: (...a: unknown[]) => errores.push(a) },
});
mock.module("@/lib/salesbot/lectura", {
  namedExports: {
    buscarProgramas: async () => (registrar("buscarProgramas"), { ok: true, datos: { resultados: [], total_encontrados: 0, truncado: false, parcial: false, omitidos_por_presupuesto: 0 }, sello }),
    detallePrograma: async () => (registrar("detallePrograma"), { ok: false, codigo: "no_encontrado", sello }),
    listarAgencias: async () => (registrar("listarAgencias"), { ok: true, datos: [], sello }),
    porcentajeAgencia: async () => (registrar("porcentajeAgencia"), { ok: true, datos: { estado: "no_encontrada" }, sello }),
  },
});
mock.module("@/lib/salesbot/paquetes/lectura", {
  namedExports: {
    MENSAJE_NO_AUTORIZADO_PAQUETES: {
      sin_sesion: "Inicia sesión para consultar.",
      usuario_inactivo: "Tu usuario está inactivo.",
      rol_no_permitido: "Tu rol no tiene acceso a la consulta comercial.",
      agencia_no_permitida: "La consulta comercial opera solo en Mayorista. Cambia la agencia activa.",
    },
    prepararConsultaPaquetes: async () => (registrar("prepararConsultaPaquetes"), { ok: true, ctx: {} }),
    buscarBloqueos: () => (registrar("buscarBloqueos"), { ok: true, datos: { ofertas: [], total_encontradas: 0, truncado: false }, sello }),
    ofertaBloqueoPorClave: () => (registrar("ofertaBloqueoPorClave"), null),
    cotizarBloqueo: async () => (registrar("cotizarBloqueo"), { ok: false, codigo: "no_encontrado", sello }),
    destinosPorcionDisponibles: () => (registrar("destinosPorcionDisponibles"), ["SAN ANDRÉS"]),
    buscarPorcion: async () => (registrar("buscarPorcion"), { ok: false, codigo: "sin_resultados", sello }),
    cotizarPorcion: async () => (registrar("cotizarPorcion"), { ok: false, codigo: "no_encontrado", sello }),
  },
});

const { conversar } = await import("../app/(dashboard)/dashboard/salesbot/actions.ts");

beforeEach(() => {
  usuario = { id: "u1" };
  perfil = { rol: "venta", activo: true };
  tenant = "mayorista";
  getUserLlamadas = 0;
  consultas.length = 0;
  errores.length = 0;
  explotar = false;
});

const EN_BLOQUEO = { v: 1, producto: "bloqueo", destino: "san andres", cualquierDestino: false, fechaIda: null, fechaRegreso: null, adultos: null, habitaciones: null, edadesMenores: null, seleccion: null, combo: null, agenciaId: null, pendiente: null, ultimaLista: [] };

describe("acceso directo a la acción de servidor", () => {
  for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) {
    test(`${rol}: autorizado`, async () => {
      perfil = { rol, activo: true };
      const r = await conversar(null, { tipo: "inicio" });
      assert.equal(r.ok, true);
    });
  }

  const negado = async (motivo: RegExp) => {
    const r = await conversar(EN_BLOQUEO, { tipo: "opcion", valor: "reintentar" });
    assert.equal(r.ok, false);
    assert.match(r.mensajes[0].texto, motivo);
    assert.deepEqual(consultas, [], "sin autorización no se toca ninguna consulta");
    assert.equal(r.estado.producto, null, "el estado se descarta");
  };
  for (const rol of ["control_vuelo", "agencia", "freelance", "cliente_final"]) {
    test(`${rol}: no autorizado, sin consultas`, async () => {
      perfil = { rol, activo: true };
      await negado(/rol no tiene acceso/);
    });
  }
  test("sin sesión", async () => {
    usuario = null;
    await negado(/Inicia sesión/);
  });
  test("usuario inactivo", async () => {
    perfil = { rol: "superadmin", activo: false };
    await negado(/inactivo/);
  });
  test("agencia activa Minorista", async () => {
    tenant = "minorista";
    await negado(/solo en Mayorista/);
  });
  test("cada turno vuelve a revalidar la sesión", async () => {
    await conversar(null, { tipo: "inicio" });
    await conversar(EN_BLOQUEO, { tipo: "opcion", valor: "reintentar" });
    assert.equal(getUserLlamadas, 2);
  });
});

describe("errores sin datos del usuario", () => {
  test("una excepción da un mensaje genérico y el registro no lleva el texto del usuario", async () => {
    explotar = true;
    // El texto llega como destino y dispara la búsqueda, que falla con una excepción.
    const r = await conversar({ ...EN_BLOQUEO, destino: null, pendiente: "destino" }, { tipo: "texto", texto: "mi documento es CC 1234567 y mi correo ana@example.com" });
    assert.ok(consultas.length > 0, "alguna consulta sí se intentó");
    assert.equal(r.ok, false);
    const registrado = JSON.stringify(errores, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v));
    for (const pii of ["1234567", "ana@example.com", "documento"]) assert.equal(registrado.includes(pii), false, pii);
    assert.doesNotMatch(JSON.stringify(r), /1234567|ana@example\.com/);
  });
});
