import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type ClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";

// #90 — `cotizarTarjetaHotel` (app/tarifario/cotizarTarjetaActions.ts) con roles reales:
// INTERNO y ACTIVO (rol + `activo` resueltos en el SERVIDOR vía `canalDeRol`, nunca por algo
// que mande el navegador) ve el motivo real de negocio; B2B (agencia/freelance), anónimo (sin
// sesión) y un INTERNO DESACTIVADO (gate suplente, ciclo 2: `activo=false` con JWT todavía
// vivo) ven EXACTAMENTE el mismo mensaje genérico de siempre, sin ningún dato adicional.
//
// Fixture deliberadamente mínimo: sin fila de `armado_paquetes` para el paquete pedido,
// `liquidarHotelPaquete` devuelve `null` (paquete no encontrado) y `computarReserva`
// responde "No hay tarifa para esas fechas / categoría / régimen." para el único combo
// pedido — la misma familia de mensaje que "hueco de tarifa", clasificada como tal.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let clienteActual: ClienteFalso = crearClienteFalso({});
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteActual } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteActual } });

const { cotizarTarjetaHotel } = await import("@/app/tarifario/cotizarTarjetaActions.ts");

const PAQUETE = 61, HOTEL = 72;
const FECHAS = { fechaIda: "2030-10-15", fechaRegreso: "2030-10-19" };
const COMBOS = [{ categoria: "Estándar King", regimen: "FULL" }];

function tablas(usuarios: TablasFalsas["usuarios"]): TablasFalsas {
  return {
    hoteles: [{ id: HOTEL, modelo_tarifario: "persona", tarifa_bajo_solicitud: false, adults_only: false, pet_friendly: false }],
    armado_paquetes: [], // sin fila para PAQUETE: liquidarHotelPaquete -> null (paquete no encontrado)
    usuarios,
  };
}

async function cotizar(usuarioAutenticado: { id: string } | null, usuarios: TablasFalsas["usuarios"]) {
  clienteActual = crearClienteFalso(tablas(usuarios), { usuarioAutenticado });
  return cotizarTarjetaHotel({ modulo: "porcion_terrestre", paqueteId: PAQUETE, hotelId: HOTEL, ...FECHAS, combos: COMBOS });
}

const MOTIVO_HUECO = "Sin tarifa vigente para alguna noche del rango: hueco entre temporadas, temporada sin doble, o una temporada cuya compra aún no abre o ya venció.";

describe("cotizarTarjetaHotel: el motivo real solo llega a un rol interno CON SESIÓN ACTIVA", () => {
  test("rol interno activo (venta): error genérico + motivo real, sin texto crudo", async () => {
    const r = await cotizar({ id: "u1" }, [{ id: "u1", rol: "venta", activo: true }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /No pudimos calcular el precio/);
    assert.deepEqual(r.motivos, [MOTIVO_HUECO]);
  });

  test("rol interno activo (superadmin): también ve el motivo", async () => {
    const r = await cotizar({ id: "u2" }, [{ id: "u2", rol: "superadmin", activo: true }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual(r.motivos, [MOTIVO_HUECO]);
  });

  test("rol B2B (agencia) activo: el mismo mensaje genérico de siempre, SIN motivos", async () => {
    const r = await cotizar({ id: "u3" }, [{ id: "u3", rol: "agencia", activo: true }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /No pudimos calcular el precio/);
    assert.equal(r.motivos, undefined, "B2B no debe recibir ningún dato adicional");
  });

  test("rol B2B (freelance) activo: el mismo mensaje genérico de siempre, SIN motivos", async () => {
    const r = await cotizar({ id: "u4" }, [{ id: "u4", rol: "freelance", activo: true }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivos, undefined);
  });

  test("sin sesión (público anónimo): el mismo mensaje genérico de siempre, SIN motivos", async () => {
    const r = await cotizar(null, []);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /No pudimos calcular el precio/);
    assert.equal(r.motivos, undefined);
  });

  test("usuario autenticado pero sin fila en `usuarios` (rol null): se trata como externo", async () => {
    const r = await cotizar({ id: "u5" }, []);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivos, undefined);
  });

  test("gate suplente ciclo 2 — rol interno DESACTIVADO (venta, activo=false, JWT todavía vivo): mismo mensaje genérico de siempre, SIN motivos", async () => {
    const r = await cotizar({ id: "u6" }, [{ id: "u6", rol: "venta", activo: false }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /No pudimos calcular el precio/);
    assert.equal(r.motivos, undefined, "un interno inactivo no debe recibir el motivo real");
  });

  test("gate suplente ciclo 2 — superadmin DESACTIVADO también cae a externo", async () => {
    const r = await cotizar({ id: "u7" }, [{ id: "u7", rol: "superadmin", activo: false }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivos, undefined);
  });
});
