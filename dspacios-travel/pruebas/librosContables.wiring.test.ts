// #43-1b — Cableado del libro diario legible y del balance de prueba (inspección de fuente).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const acciones = leer("app/(dashboard)/dashboard/contabilidad/libro-diario/actions.ts");
const paginaLibro = leer("app/(dashboard)/dashboard/contabilidad/libro-diario/page.tsx");
const clienteLibro = leer("app/(dashboard)/dashboard/contabilidad/libro-diario/LibroDiarioClient.tsx");
const paginaBalance = leer("app/(dashboard)/dashboard/contabilidad/balance-prueba/page.tsx");
const layout = leer("app/(dashboard)/layout.tsx");

describe("libro diario", () => {
  test("cabeceras y líneas paginadas con error visible; líneas por lotes de ids", () => {
    const fn = acciones.slice(acciones.indexOf("export async function listarAsientos("), acciones.indexOf("function validarLineas("));
    assert.equal((fn.match(/fetchAllPaginadoConError\(/g) ?? []).length, 2);
    assert.match(fn, /if \(cabeceras\.error\) return \{ ok: false/);
    assert.match(fn, /if \(r\.error\) return \{ ok: false/);
    assert.match(fn, /ids\.slice\(i, i \+ 200\)/);
  });

  test("la página usa el mes en curso por defecto (día de negocio) y valida el rango de la URL", () => {
    assert.match(paginaLibro, /const hoy = fechaNegocio\(\);/);
    assert.match(paginaLibro, /esFechaIso\(sp\.desde\) \? sp\.desde : mes\.desde/);
    assert.match(paginaLibro, /listarAsientos\(\{ desde, hasta \}\)/);
    assert.match(paginaLibro, /const ROLES_CONTABLES = \["superadmin", "gerencia", "administracion"\];/);
  });

  test("eliminar solo se ofrece en asientos manuales (los automáticos se deshacen en su módulo)", () => {
    assert.match(clienteLibro, /const manual = a\.origen === "manual";/);
    assert.match(clienteLibro, /\{manual && \(\s*<button/);
  });
});

describe("balance de prueba", () => {
  test("se calcula desde el libro, paginado y con error visible", () => {
    assert.match(paginaBalance, /from\("asiento_lineas"\)/);
    assert.match(paginaBalance, /asientos_contables!inner\(fecha\)/);
    assert.match(paginaBalance, /\.lte\("asientos_contables\.fecha", hasta\)/);
    assert.equal((paginaBalance.match(/fetchAllPaginadoConError\(/g) ?? []).length, 2);
    assert.doesNotMatch(paginaBalance, /from\("ventas"\)|from\("abonos"\)|from\("cuentas_por_pagar"\)/);
    assert.match(paginaBalance, /const ROLES_CONTABLES = \["superadmin", "gerencia", "administracion"\];/);
  });

  test("menú: Balance de prueba junto a los libros", () => {
    assert.match(layout, /\{ href: "\/dashboard\/contabilidad\/libro-auxiliar", label: "Libro auxiliar" \},\s*\{ href: "\/dashboard\/contabilidad\/balance-prueba", label: "Balance de prueba" \}/);
  });
});
