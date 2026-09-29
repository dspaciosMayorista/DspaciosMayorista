// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Prueba de la Server Action REAL `completarProveedores`
// (contratos/[numero]/gestion-actions.ts). `asegurarCuentasPorPagar` escribe con
// service-role; aquí está sustituida por un stub que registra si se invocó.
// Las pruebas negativas exigen que NO se invoque: la autorización tiene que
// cortar ANTES de tocar service-role.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setClient } from "./support/stubs/supabaseServerStub.mjs";
import { __revalidadas, __resetRevalidadas } from "./support/stubs/nextCacheStub.mjs";
import { __llamadasAsegurar, __resetAsegurar } from "./support/stubs/asegurarCxpStub.mjs";
import { completarProveedores } from "../app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts";

type Perfil = { rol: string; activo: boolean; tenant: string } | null;

/**
 * Cliente de sesión falso. `contratoVisible` es lo que devolvería la RLS de
 * `ventas` para esta sesión (null = no lo ve). Registra las tablas leídas.
 */
function sesion(userId: string | null, perfil: Perfil, contratoVisible: { tenant: string } | null) {
  const leidas: string[] = [];
  const sb = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from(tabla: string) {
      leidas.push(tabla);
      const fila = tabla === "usuarios" ? perfil : tabla === "ventas" ? contratoVisible : null;
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: fila, error: null }),
      };
      return b;
    },
  };
  __setClient(sb);
  return leidas;
}

beforeEach(() => {
  __resetAsegurar();
  __resetRevalidadas();
});

const NUMERO = "DTM-0451";

test("anónimo: denegado, sin tocar service-role ni leer el contrato", async () => {
  const leidas = sesion(null, null, { tenant: "mayorista" });
  const r = await completarProveedores(NUMERO);
  assert.equal(r.ok, false);
  assert.deepEqual(__llamadasAsegurar(), []);
  assert.deepEqual(leidas, [], "sin sesión no se consulta nada más");
  assert.deepEqual(__revalidadas(), []);
});

test("B2B (agencia, freelance) y cliente_final: denegados aunque vieran el contrato", async () => {
  for (const rol of ["agencia", "freelance", "cliente_final"]) {
    __resetAsegurar();
    sesion("u-b2b", { rol, activo: true, tenant: "mayorista" }, { tenant: "mayorista" });
    const r = await completarProveedores(NUMERO);
    assert.deepEqual(r, { ok: false, error: "Tu rol no tiene permiso para generar cuentas por pagar." }, rol);
    assert.deepEqual(__llamadasAsegurar(), [], `${rol}: service-role no se toca`);
  }
});

test("venta y control_vuelo (internos sin escritura de CxP): denegados", async () => {
  for (const rol of ["venta", "control_vuelo"]) {
    __resetAsegurar();
    sesion("u-int", { rol, activo: true, tenant: "mayorista" }, { tenant: "mayorista" });
    assert.equal((await completarProveedores(NUMERO)).ok, false, rol);
    assert.deepEqual(__llamadasAsegurar(), [], rol);
  }
});

test("contrato de otra agencia: denegado (aunque la lectura lo devolviera)", async () => {
  sesion("u-ope", { rol: "operaciones", activo: true, tenant: "mayorista" }, { tenant: "minorista" });
  const r = await completarProveedores("MIN-0012");
  assert.deepEqual(r, { ok: false, error: "Contrato no encontrado o sin acceso." });
  assert.deepEqual(__llamadasAsegurar(), []);
});

test("contrato no visible para la sesión (RLS de ventas) o usuario inactivo: denegado", async () => {
  sesion("u-adm", { rol: "administracion", activo: true, tenant: "mayorista" }, null);
  assert.deepEqual(await completarProveedores(NUMERO), { ok: false, error: "Contrato no encontrado o sin acceso." });
  sesion("u-sup", { rol: "superadmin", activo: false, tenant: "mayorista" }, { tenant: "mayorista" });
  assert.equal((await completarProveedores(NUMERO)).ok, false);
  sesion("u-sin-perfil", null, { tenant: "mayorista" });
  assert.equal((await completarProveedores(NUMERO)).ok, false);
  assert.deepEqual(__llamadasAsegurar(), []);
});

test("personal autorizado de la misma agencia: completa y revalida el contrato", async () => {
  for (const rol of ["administracion", "operaciones"]) {
    __resetAsegurar();
    __resetRevalidadas();
    sesion("u-ok", { rol, activo: true, tenant: "mayorista" }, { tenant: "mayorista" });
    assert.deepEqual(await completarProveedores(NUMERO), { ok: true, creadas: 2 }, rol);
    assert.deepEqual(__llamadasAsegurar(), [NUMERO], `${rol}: se invoca una vez, con ese contrato`);
    assert.deepEqual(__revalidadas(), [`/dashboard/contratos/${NUMERO}`]);
  }
});

test("gerencia y superadmin: también en la otra agencia (misma regla que la RLS)", async () => {
  sesion("u-ger", { rol: "gerencia", activo: true, tenant: "mayorista" }, { tenant: "minorista" });
  assert.equal((await completarProveedores("MIN-0012")).ok, true);
  assert.deepEqual(__llamadasAsegurar(), ["MIN-0012"]);
});

test("un fallo de asegurarCuentasPorPagar se informa y no revalida", async () => {
  __resetAsegurar({ ok: false, creadas: 0, error: "falló el insert" });
  sesion("u-ok", { rol: "administracion", activo: true, tenant: "mayorista" }, { tenant: "mayorista" });
  assert.deepEqual(await completarProveedores(NUMERO), { ok: false, error: "falló el insert" });
  assert.deepEqual(__revalidadas(), []);
});
