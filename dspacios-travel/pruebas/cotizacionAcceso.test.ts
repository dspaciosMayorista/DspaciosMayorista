import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverContextoCotizacion, autorizaTenant, type ContextoCotizacion } from "../lib/cotizacion/accesoPuro.ts";

// ───────────────────────────────────────────────────────────────────────────
// resolverContextoCotizacion — debe fallar CERRADO. `perfil.activo` que no
// sea EXACTAMENTE `true` bloquea, incluido un superadmin: el rol nunca debe
// poder saltarse el chequeo de actividad.
// ───────────────────────────────────────────────────────────────────────────

test("perfil ausente (null) → no autorizado", () => {
  const ctx = resolverContextoCotizacion(null, "mayorista");
  assert.equal(ctx.ok, false);
  if (!ctx.ok) assert.equal(ctx.motivo, "sin_perfil");
});

test("perfil ausente (undefined) → no autorizado", () => {
  const ctx = resolverContextoCotizacion(undefined, "mayorista");
  assert.equal(ctx.ok, false);
  if (!ctx.ok) assert.equal(ctx.motivo, "sin_perfil");
});

test("activo = false (rol normal) → no autorizado", () => {
  const ctx = resolverContextoCotizacion({ rol: "venta", activo: false }, "mayorista");
  assert.equal(ctx.ok, false);
  if (!ctx.ok) assert.equal(ctx.motivo, "usuario_inactivo");
});

test("activo = null (rol normal) → no autorizado (fallar cerrado, no abierto)", () => {
  const ctx = resolverContextoCotizacion({ rol: "venta", activo: null }, "mayorista");
  assert.equal(ctx.ok, false);
  if (!ctx.ok) assert.equal(ctx.motivo, "usuario_inactivo");
});

test("activo = undefined (rol normal) → no autorizado", () => {
  const ctx = resolverContextoCotizacion({ rol: "venta", activo: undefined }, "mayorista");
  assert.equal(ctx.ok, false);
});

test("activo = false Y rol = superadmin → SIGUE sin autorizar (el rol no salta el chequeo de actividad)", () => {
  const ctx = resolverContextoCotizacion({ rol: "superadmin", activo: false }, "mayorista");
  assert.equal(ctx.ok, false);
  if (!ctx.ok) assert.equal(ctx.motivo, "usuario_inactivo");
});

test("activo = null Y rol = superadmin → SIGUE sin autorizar", () => {
  const ctx = resolverContextoCotizacion({ rol: "superadmin", activo: null }, "mayorista");
  assert.equal(ctx.ok, false);
});

test("activo = undefined Y rol = superadmin → SIGUE sin autorizar", () => {
  const ctx = resolverContextoCotizacion({ rol: "superadmin", activo: undefined }, "mayorista");
  assert.equal(ctx.ok, false);
});

test("activo = true, rol = venta → autorizado, superadmin=false", () => {
  const ctx = resolverContextoCotizacion({ rol: "venta", activo: true }, "mayorista");
  assert.equal(ctx.ok, true);
  if (ctx.ok) { assert.equal(ctx.superadmin, false); assert.equal(ctx.tenant, "mayorista"); }
});

test("activo = true, rol = gerencia → autorizado, superadmin=false (gerencia NO es alcance global aquí)", () => {
  const ctx = resolverContextoCotizacion({ rol: "gerencia", activo: true }, "minorista");
  assert.equal(ctx.ok, true);
  if (ctx.ok) { assert.equal(ctx.superadmin, false); assert.equal(ctx.tenant, "minorista"); }
});

test("activo = true, rol = superadmin → autorizado, superadmin=true", () => {
  const ctx = resolverContextoCotizacion({ rol: "superadmin", activo: true }, "mayorista");
  assert.equal(ctx.ok, true);
  if (ctx.ok) assert.equal(ctx.superadmin, true);
});

// ───────────────────────────────────────────────────────────────────────────
// autorizaTenant
// ───────────────────────────────────────────────────────────────────────────

const noAutorizado: ContextoCotizacion = { ok: false, motivo: "usuario_inactivo" };
const mayoristaNormal: ContextoCotizacion = { ok: true, superadmin: false, tenant: "mayorista" };
const minoristaNormal: ContextoCotizacion = { ok: true, superadmin: false, tenant: "minorista" };
const gerenciaMayorista: ContextoCotizacion = { ok: true, superadmin: false, tenant: "mayorista" };
const superadminCtx: ContextoCotizacion = { ok: true, superadmin: true, tenant: "mayorista" };

test("contexto no autorizado nunca pasa, sin importar la fila", () => {
  assert.equal(autorizaTenant(noAutorizado, "mayorista"), false);
  assert.equal(autorizaTenant(noAutorizado, "minorista"), false);
  assert.equal(autorizaTenant(noAutorizado, null), false);
});

test("usuario de mayorista: solo filas de mayorista", () => {
  assert.equal(autorizaTenant(mayoristaNormal, "mayorista"), true);
  assert.equal(autorizaTenant(mayoristaNormal, "minorista"), false);
  assert.equal(autorizaTenant(mayoristaNormal, null), false);
});

test("usuario de minorista: solo filas de minorista", () => {
  assert.equal(autorizaTenant(minoristaNormal, "minorista"), true);
  assert.equal(autorizaTenant(minoristaNormal, "mayorista"), false);
  assert.equal(autorizaTenant(minoristaNormal, null), false);
});

test("gerencia NO tiene alcance global aquí: igual de acotada que cualquier otro rol interno", () => {
  assert.equal(autorizaTenant(gerenciaMayorista, "mayorista"), true);
  assert.equal(autorizaTenant(gerenciaMayorista, "minorista"), false);
});

test("superadmin: alcance global, incluida una fila sin tenant (null)", () => {
  assert.equal(autorizaTenant(superadminCtx, "mayorista"), true);
  assert.equal(autorizaTenant(superadminCtx, "minorista"), true);
  assert.equal(autorizaTenant(superadminCtx, null), true);
});
