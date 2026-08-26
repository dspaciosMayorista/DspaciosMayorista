import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolverContextoCrearContrato } from "../lib/contrato/contextoPuro.ts";

// resolverContextoCrearContrato — el gate fail-closed de crearContrato()
// (revisión posterior al PR #274): a diferencia de resolverContextoCotizacion
// (que sirve también el autoservicio B2B, sin exigir un rol interno), este
// SÍ exige un rol con permiso real de escritura sobre `ventas`
// (`autorizadoPorRol`, calculado en el wrapper impuro vía `puedeEscribir
// ("ventas", rol)` — ver lib/contrato/contexto.ts) porque crearContrato() es
// un flujo puramente interno sin equivalente de autoservicio.
describe("resolverContextoCrearContrato", () => {
  test("perfil ausente (null) → no autorizado, sin sesión", () => {
    const ctx = resolverContextoCrearContrato(null, true, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /sesión/i);
  });

  test("perfil ausente (undefined) → no autorizado", () => {
    const ctx = resolverContextoCrearContrato(undefined, true, "mayorista");
    assert.equal(ctx.ok, false);
  });

  test("activo = false → no autorizado, aunque el rol tenga permiso", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: false }, true, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /sesión/i);
  });

  test("activo = null → no autorizado (fallar cerrado, no abierto)", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: null }, true, "mayorista");
    assert.equal(ctx.ok, false);
  });

  test("activo = undefined → no autorizado", () => {
    const ctx = resolverContextoCrearContrato({ rol: "venta", activo: undefined }, true, "mayorista");
    assert.equal(ctx.ok, false);
  });

  test("activo = true pero rol SIN permiso (autorizadoPorRol=false) → no autorizado, mensaje distinto", () => {
    const ctx = resolverContextoCrearContrato({ rol: "agencia", activo: true }, false, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /rol.*permiso/i);
  });

  test("activo = true Y rol con permiso → autorizado, expone tenant y rol", () => {
    const ctx = resolverContextoCrearContrato({ rol: "venta", activo: true }, true, "mayorista");
    assert.equal(ctx.ok, true);
    if (ctx.ok) {
      assert.equal(ctx.tenant, "mayorista");
      assert.equal(ctx.rol, "venta");
    }
  });

  test("activo = true, rol superadmin, tenant minorista → autorizado", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: true }, true, "minorista");
    assert.equal(ctx.ok, true);
    if (ctx.ok) { assert.equal(ctx.tenant, "minorista"); assert.equal(ctx.rol, "superadmin"); }
  });

  test("activo = false Y autorizadoPorRol = true → SIGUE sin autorizar (activo se revisa antes que el rol)", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: false }, true, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /sesión/i);
  });
});
