import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autorizarCuentasPorPagarContrato,
  mensajeCxpDenegado,
  ROLES_ESCRITURA_CXP,
} from "../lib/contrato/accesoCuentasPorPagar.ts";

// Decisión PURA de quién puede generar cuentas por pagar de un contrato con
// service-role (completarProveedores). Debe reflejar la policy
// "cpp: acceso contable" (migración 116): rol en superadmin/gerencia/
// administracion/operaciones + puede_ver_tenant (superadmin y gerencia ven
// cualquier agencia; el resto solo la suya) + usuario activo (migración 140).

const may = { tenant: "mayorista" };
const min = { tenant: "minorista" };
const perfil = (rol: string | null, tenant = "mayorista", activo: boolean | null = true) => ({ rol, tenant, activo });

test("sin sesión o sin perfil: denegado", () => {
  assert.deepEqual(autorizarCuentasPorPagarContrato(null, may), { permitido: false, motivo: "sin_sesion" });
});

test("usuario inactivo (activo false o null): denegado aunque sea superadmin", () => {
  assert.deepEqual(autorizarCuentasPorPagarContrato(perfil("superadmin", "mayorista", false), may), { permitido: false, motivo: "inactivo" });
  assert.deepEqual(autorizarCuentasPorPagarContrato(perfil("superadmin", "mayorista", null), may), { permitido: false, motivo: "inactivo" });
});

test("roles sin escritura de CxP: denegados en su propia agencia", () => {
  for (const rol of ["venta", "control_vuelo", "agencia", "freelance", "cliente_final", null, "", "SUPERADMIN"]) {
    assert.deepEqual(autorizarCuentasPorPagarContrato(perfil(rol), may), { permitido: false, motivo: "rol" }, `rol ${rol}`);
  }
});

test("contrato no visible para la sesión (null o sin tenant): denegado", () => {
  assert.deepEqual(autorizarCuentasPorPagarContrato(perfil("administracion"), null), { permitido: false, motivo: "contrato" });
  assert.deepEqual(autorizarCuentasPorPagarContrato(perfil("superadmin"), { tenant: null }), { permitido: false, motivo: "contrato" });
});

test("administracion/operaciones: solo contratos de su agencia", () => {
  for (const rol of ["administracion", "operaciones"]) {
    assert.deepEqual(autorizarCuentasPorPagarContrato(perfil(rol, "mayorista"), may), { permitido: true });
    assert.deepEqual(autorizarCuentasPorPagarContrato(perfil(rol, "minorista"), min), { permitido: true });
    assert.deepEqual(autorizarCuentasPorPagarContrato(perfil(rol, "mayorista"), min), { permitido: false, motivo: "tenant" });
    assert.deepEqual(autorizarCuentasPorPagarContrato(perfil(rol, "minorista"), may), { permitido: false, motivo: "tenant" });
  }
  assert.deepEqual(autorizarCuentasPorPagarContrato({ rol: "operaciones", activo: true, tenant: null }, may), { permitido: false, motivo: "tenant" });
});

test("superadmin y gerencia: cualquier agencia (igual que puede_ver_tenant)", () => {
  for (const rol of ["superadmin", "gerencia"]) {
    assert.deepEqual(autorizarCuentasPorPagarContrato(perfil(rol, "mayorista"), min), { permitido: true });
    assert.deepEqual(autorizarCuentasPorPagarContrato(perfil(rol, "minorista"), may), { permitido: true });
  }
});

test("los roles permitidos son exactamente los de la RLS de cuentas_por_pagar", () => {
  assert.deepEqual([...ROLES_ESCRITURA_CXP], ["superadmin", "gerencia", "administracion", "operaciones"]);
});

test("el mensaje de 'otra agencia' no revela que el contrato existe", () => {
  assert.equal(mensajeCxpDenegado("tenant"), mensajeCxpDenegado("contrato"));
});
