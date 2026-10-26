// #40 E3 — reglas puras de la vigencia vencida y del acceso interno, más el cableado que no se puede ejercitar con dobles baratos
// (crearCotizacion del tarifario, la migración). El comportamiento de las Server Actions está en cotizacionVencida40E3.manual/.carrito.test.ts
// y el de la base en supabase/scripts/test_242_cotizacion_vencida.sh.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cotizacionVencida, hoyBogota, MENSAJE_COTIZACION_VENCIDA, sumarDiasISO } from "../lib/cotizacion/vigencia.ts";
import { resolverContextoCotizacion } from "../lib/cotizacion/accesoPuro.ts";
import { mapearErrorRpc63 } from "../lib/reservar/aceptacion63.ts";
import { ROLES_EXTERNOS, ROLES_INTERNOS } from "../lib/constants.ts";

const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("cotizacionVencida: día de negocio de Bogotá", () => {
  const hoy = "2026-10-26";
  test("ayer vence; hoy y mañana siguen válidos", () => {
    assert.equal(cotizacionVencida(sumarDiasISO(hoy, -1), hoy), true);
    assert.equal(cotizacionVencida(hoy, hoy), false);
    assert.equal(cotizacionVencida(sumarDiasISO(hoy, 1), hoy), false);
  });
  test("vigencia nula o vacía (histórica) no vence por inferencia", () => {
    assert.equal(cotizacionVencida(null, hoy), false);
    assert.equal(cotizacionVencida(undefined, hoy), false);
    assert.equal(cotizacionVencida("", hoy), false);
  });
  test("cruce de medianoche en Bogotá (UTC-5): a las 23:59:59 sigue siendo el mismo día; a las 00:00:00 ya venció", () => {
    const antes = hoyBogota(new Date("2026-10-27T04:59:59Z"));
    const despues = hoyBogota(new Date("2026-10-27T05:00:00Z"));
    assert.equal(antes, "2026-10-26");
    assert.equal(despues, "2026-10-27");
    assert.equal(cotizacionVencida("2026-10-26", antes), false);
    assert.equal(cotizacionVencida("2026-10-26", despues), true);
  });
  test("la medianoche UTC NO es la de Bogotá: a las 22:00 en Bogotá (03:00 UTC del día siguiente) el día de negocio no cambió", () => {
    assert.equal(hoyBogota(new Date("2026-10-27T03:00:00Z")), "2026-10-26");
    assert.equal(cotizacionVencida("2026-10-26", hoyBogota(new Date("2026-10-27T03:00:00Z"))), false);
  });
  test("el mensaje es de negocio y no habla de bases ni RPC", () => {
    assert.match(MENSAJE_COTIZACION_VENCIDA, /vencida/);
    assert.doesNotMatch(MENSAJE_COTIZACION_VENCIDA, /rpc|sql|p63|postgres/i);
  });
});

describe("acceso: solo el personal interno elige o cambia la vigencia", () => {
  test("cada rol interno activo queda marcado interno", () => {
    for (const rol of ROLES_INTERNOS) {
      const ctx = resolverContextoCotizacion({ rol, activo: true }, "mayorista");
      assert.equal(ctx.ok && ctx.interno, true, rol);
    }
  });
  test("agencia, freelance y cliente_final (aliados B2B y clientes) NO son internos aunque estén activos y en la misma agencia", () => {
    for (const rol of ROLES_EXTERNOS) {
      const ctx = resolverContextoCotizacion({ rol, activo: true }, "mayorista");
      assert.equal(ctx.ok, true, rol);
      assert.equal(ctx.ok && ctx.interno, false, rol);
    }
  });
  test("un rol desconocido falla cerrado (no interno)", () => {
    const ctx = resolverContextoCotizacion({ rol: "inventado", activo: true }, "mayorista");
    assert.equal(ctx.ok && ctx.interno, false);
  });
});

describe("la base avisa de una vencida con un mensaje de negocio", () => {
  test("aceptar_oferta_63: COTIZACION_VENCIDA → mensaje de vencida, sin marcar 'cambio'", () => {
    const m = mapearErrorRpc63("COTIZACION_VENCIDA: la cotización 77 venció el 2026-10-25 (hoy en Bogotá: 2026-10-26)");
    assert.equal(m.error, MENSAJE_COTIZACION_VENCIDA);
    assert.equal(m.cambio, false);
  });
});

describe("cableado", () => {
  const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  const migracion = leer("supabase/migrations/20260601000242_cotizacion_vencida_guarda.sql");

  test("crearCotizacion del tarifario ignora la fecha de un rol externo (rige el automático de un día)", () => {
    assert.match(reservar, /vigenciaSolicitada: ctx\.interno === false \? undefined : opts\?\.vigenciaHasta/);
  });
  test("las dos conversiones del servidor que numeran fuera de la base (tarifario y carrito) comparan con el día de negocio ANTES de numerar", () => {
    const iTarifario = reservar.indexOf("export async function convertirCotizacion(");
    const iCarrito = reservar.indexOf("export async function convertirCotizacionCarrito(");
    const iGuardaT = reservar.indexOf("cotizacionVencida(cot.vigencia_hasta, hoyBogota())", iTarifario);
    const iGuardaC = reservar.indexOf("cotizacionVencida(cot.vigencia_hasta, hoyBogota())", iCarrito);
    assert.ok(iTarifario > 0 && iGuardaT > iTarifario && iGuardaT < iCarrito, "guarda en convertirCotizacion");
    assert.ok(iCarrito > 0 && iGuardaC > iCarrito, "guarda en convertirCotizacionCarrito");
    assert.ok(iGuardaT < reservar.indexOf("reservarDesdeTarifarioInterno({", iTarifario), "antes de reservar/numerar (tarifario)");
    assert.ok(iGuardaC < reservar.indexOf("siguienteNumeroContrato(tenantCotizacion)", iCarrito), "antes de numerar (carrito)");
  });
  test("la renovación de vigencia es solo interna y las demás creaciones con fecha explícita también", () => {
    assert.match(reservar, /ctx\.interno === false\) return \{ ok: false, error: "No tienes permiso para cambiar la vigencia\./);
    assert.equal((manual.match(/ctx\.interno === false && input\.vigenciaHasta\?\.trim\(\)/g) ?? []).length, 2, "manual y comparativa manual");
  });
  test("el checkout público no acepta una fecha del navegador", () => {
    const checkout = leer("app/tarifario/checkout/actions.ts");
    assert.doesNotMatch(checkout, /vigenciaSolicitada/);
  });
  test("migración 242: la guarda corre antes de validar y de emitir; aceptar_oferta_63 es envoltura de la base renombrada", () => {
    assert.ok(migracion.indexOf("perform public.p40_exigir_cotizacion_vigente(p_cotizacion_id)") < migracion.indexOf("perform p50_priv.validar_conversion"));
    assert.ok(migracion.indexOf("perform p50_priv.validar_conversion") < migracion.indexOf("p39_priv.emitir"));
    assert.match(migracion, /rename to p40_aceptar_oferta_63_base/);
    assert.match(migracion, /revoke all on function public\.p40_aceptar_oferta_63_base\(.*\) from public, anon, authenticated, service_role/);
    assert.match(migracion, /v_vigencia is not null and v_vigencia < v_hoy/);
  });
});
