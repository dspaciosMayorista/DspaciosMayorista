// #42 — procedencia del contacto CRM auxiliar del checkout.
//
// Parte A: decisión pura (`origenContactoTarifario`). Parte B: la acción REAL `crearSolicitudReserva` por las tres
// rutas (B2C anónimo, aliado B2B autenticado y B2B asistido #102), con el motor de precios simulado y un cliente de
// servicio que registra cada llamada. Se prueba que el origen sale del contexto validado en el servidor, que
// categoría/tenant/consentimiento no cambian y que el registro central de personas se invoca igual en las tres.
// Datos sintéticos.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  origenContactoTarifario, ORIGEN_CONTACTO_B2C, ORIGEN_CONTACTO_B2B, ORIGEN_CONTACTO_B2B_ASISTIDA,
} from "../lib/crm/contactoTarifario.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service";

describe("origenContactoTarifario (puro)", () => {
  test("textos fijos: B2C conserva el literal que reconoce la 207", () => {
    assert.equal(ORIGEN_CONTACTO_B2C, "Cotización tarifario (B2C)");
    assert.equal(ORIGEN_CONTACTO_B2B, "Cotización tarifario (B2B)");
    assert.equal(ORIGEN_CONTACTO_B2B_ASISTIDA, "Cotización tarifario (B2B asistida)");
  });
  test("las cuatro combinaciones; asistida gana sobre sesión B2B", () => {
    assert.equal(origenContactoTarifario({ asistida: false, aliadoAutenticado: false }), ORIGEN_CONTACTO_B2C);
    assert.equal(origenContactoTarifario({ asistida: false, aliadoAutenticado: true }), ORIGEN_CONTACTO_B2B);
    assert.equal(origenContactoTarifario({ asistida: true, aliadoAutenticado: false }), ORIGEN_CONTACTO_B2B_ASISTIDA);
    assert.equal(origenContactoTarifario({ asistida: true, aliadoAutenticado: true }), ORIGEN_CONTACTO_B2B_ASISTIDA);
  });
});

type Fila = Record<string, unknown>;
const insertsContacto: Fila[] = [];
const rpcs: { fn: string; args: Fila }[] = [];
type Sesion = { id: string; email: string; perfil: Fila } | null;
let usuario: Sesion = null;
let asistencia: unknown = null; // contexto que devolvería prepararAsistenciaB2B (ya validado en servidor)

function admin() {
  return {
    from(tabla: string) {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: 77, codigo: "COT-77", share_token: "tok" }, error: null }),
        update: () => b, upsert: () => b, delete: () => b,
        insert: (fila: Fila) => {
          if (tabla === "crm_contactos") { insertsContacto.push(fila); return Promise.resolve({ data: null, error: null }); }
          return b;
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
      });
      return b;
    },
    rpc: async (fn: string, args: Fila) => {
      rpcs.push({ fn, args });
      return { data: fn === "sellar_creador_cotizacion" ? "sellada" : { nuevos: 1, reintentos: 0, omitidos: 0 }, error: null };
    },
  };
}
const sesion = {
  from: (tabla: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, or: () => b,
      maybeSingle: async () => ({ data: tabla === "usuarios" && usuario ? usuario.perfil : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
    });
    return b;
  },
  auth: { getUser: async () => ({ data: { user: usuario ? { id: usuario.id, email: usuario.email } : null }, error: null }) },
};

mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async () => ({
      ok: true,
      data: {
        meta: { hotel_nombre: "OZ HOTEL CARTAGENA", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
        precioVenta: 600_000, impuestoTotal: 0, monedaReserva: "COP",
        lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 300_000 }], pvpPorAcom: { doble: 300_000 },
        numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: 2, edadesMenoresUsadas: [],
        serviciosIncluidos: [], distribucionMenores: [], condicionesTarifa: null,
      },
    }),
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/cotizar", { namedExports: { liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no se usa" }) } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sesion } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => admin() } });
mock.module("@/lib/cotizacion/asistidaB2BServidor", {
  namedExports: {
    prepararAsistenciaB2B: async () => ({ ok: true, contexto: asistencia }),
    listarAliadosParaAsistencia: async () => ({ ok: true, aliados: [] }),
  },
});
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });

const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");

const hotelOz = {
  itemId: "hOZ", modulo: "porcion_terrestre", paqueteId: 34, hotelId: 1, bloqueoId: null, hotelNombre: "OZ HOTEL CARTAGENA", destino: "CARTAGENA",
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
};
const cliente = { nombres: "Ana", apellidos: "Prueba", numeroDoc: "1000000001", telefono: "3000000000", email: "ana@example.test", tipoDoc: "CE" };
const solicitar = (extra: Fila = {}) =>
  crearSolicitudReserva({ items: [hotelOz], tours: [], cliente, ...extra }) as Promise<Record<string, unknown> & { ok: boolean; error?: string }>;

const aliadoB2B = { id: "u-agencia", email: "agencia@example.test", perfil: { nombre: "Agencia Uno", email: "agencia@example.test", rol: "agencia", agencia_id: null, pct_comision: 0.1, activo: true, aliado_id: null } };
const interno = { id: "u-venta", email: "venta@example.test", perfil: { nombre: "Venta Uno", email: "venta@example.test", rol: "venta", agencia_id: null, pct_comision: null, activo: true, aliado_id: null } };
const contextoAsistido = {
  actor: { id: "u-venta", email: "venta@example.test", rol: "venta", superadmin: false, nombre: "Venta Uno" },
  aliado: {
    id: 5, nombre: "Agencia Cinco", tipo: "agencia", pctAliado: 0.1, pct: 0.1, pctOrigen: "aliado",
    fiscal: { nombre: "Agencia Cinco", documento: "900123456", tipoDocumento: "NIT", telefono: null, email: null, direccion: null },
  },
  modo: "comisionable",
};

const registro = () => rpcs.filter((r) => r.fn === "registrar_personas_cotizacion");
beforeEach(() => { insertsContacto.length = 0; rpcs.length = 0; usuario = null; asistencia = null; });

describe("crearSolicitudReserva (real) — origen del contacto CRM por ruta", () => {
  test("B2C anónimo: origen B2C; el registro de personas queda provisional (sin tipo)", async () => {
    const r = await solicitar();
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(insertsContacto.length, 1);
    assert.equal(insertsContacto[0].origen, ORIGEN_CONTACTO_B2C);
    assert.equal(registro().length, 1);
    assert.equal(registro()[0].args.p_usuario_id, null);
    assert.equal(rpcs.filter((x) => x.fn === "sellar_creador_cotizacion").length, 0);
    const t = (registro()[0].args.p_participantes as Fila[])[0];
    assert.equal(t.rol, "titular");
    assert.equal(t.numero_doc, "1000000001");
    assert.equal(t.tipo_doc, null);
  });

  test("aliado B2B autenticado: origen B2B (no B2C); se sella al aliado y se conserva el tipo", async () => {
    usuario = aliadoB2B;
    const r = await solicitar({ modo: "comisionable" });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(insertsContacto.length, 1);
    assert.equal(insertsContacto[0].origen, ORIGEN_CONTACTO_B2B);
    assert.equal(registro().length, 1);
    assert.equal(registro()[0].args.p_usuario_id, "u-agencia");
    assert.equal(rpcs.filter((x) => x.fn === "sellar_creador_cotizacion").length, 1);
    const t = (registro()[0].args.p_participantes as Fila[])[0];
    assert.equal(t.tipo_doc, "CE");
    assert.equal(t.numero_doc, "1000000001");
  });

  test("B2B asistido #102 (sesión interna + aliado del catálogo): origen B2B asistida; sellado al asistente", async () => {
    usuario = interno;
    asistencia = contextoAsistido;
    const r = await solicitar({ asistencia: { canal: "b2b", aliadoId: 5, modo: "comisionable" } });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(insertsContacto.length, 1);
    assert.equal(insertsContacto[0].origen, ORIGEN_CONTACTO_B2B_ASISTIDA);
    assert.equal(registro().length, 1);
    assert.equal(registro()[0].args.p_usuario_id, "u-venta");
    const t = (registro()[0].args.p_participantes as Fila[])[0];
    assert.equal(t.tipo_doc, "CE");
  });

  test("el navegador no decide el origen: un 'origen' o canal B2B enviado sin contexto validado sigue siendo B2C", async () => {
    const r = await solicitar({ origen: "Cotización tarifario (B2B asistida)", canal: "b2b", asistencia: { canal: "b2c" } });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(insertsContacto[0].origen, ORIGEN_CONTACTO_B2C);
  });

  test("lo demás del contacto no cambia en ninguna ruta: cliente_final, tenant mayorista y sin tocar el consentimiento", async () => {
    const rutas: (() => void)[] = [
      () => { usuario = null; asistencia = null; },
      () => { usuario = aliadoB2B; asistencia = null; },
      () => { usuario = interno; asistencia = contextoAsistido; },
    ];
    for (const preparar of rutas) {
      insertsContacto.length = 0;
      preparar();
      const r = await solicitar(asistencia ? { asistencia: { canal: "b2b", aliadoId: 5, modo: "comisionable" } } : {});
      assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
      const c = insertsContacto[0];
      assert.equal(c.categoria, "cliente_final");
      assert.equal(c.tenant, "mayorista");
      assert.equal(c.nombre, "Ana Prueba");
      assert.equal(c.documento, "1000000001");
      assert.equal(c.tipo_doc, "CE");
      for (const k of ["acepta_publicidad", "no_contactar"]) assert.ok(!(k in c), `no debe enviar ${k}`);
    }
  });
});
