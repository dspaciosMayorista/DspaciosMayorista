import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contratosDelPortalB2B,
  consultasPortalSupabase,
  COLUMNAS_DECISION,
  escaparLike,
  type PerfilPortal,
} from "../lib/auth/contratosPortalB2B.ts";
import { supabaseEnMemoria, type Fila, type OpcionesMemoria } from "./support/memoriaSupabase.ts";

// ───────────────────────────────────────────────────────────────────────────
// Qué contratos lista el portal B2B (service-role: esta función ES la
// autorización del listado). Se ejercitan las CONSULTAS REALES del portal
// (`consultasPortalSupabase`) contra un PostgREST en memoria.
// Escenario: aliado ANTIGUO "Viajes Antiguos" (ficha 7) y un SOLICITANTE NUEVO
// con el mismo nombre.
// ───────────────────────────────────────────────────────────────────────────

const NOMBRE = "Viajes Antiguos";
const v = (numero: string, extra: Fila): Fila => ({
  numero_contrato: numero, tenant: "mayorista", aliado_id: null, b2b_usuario_id: null,
  agencia_nombre: null, freelance_nombre: null, fecha_salida: "2026-01-01", ...extra,
});
const VENTAS: Fila[] = [
  v("C1-ficha", { aliado_id: 7, agencia_nombre: NOMBRE }),
  v("C2-solo-nombre", { agencia_nombre: NOMBRE, fecha_salida: "2026-02-01" }),
  v("C3-comision-manual", { freelance_nombre: NOMBRE }),
  v("C4-portal-de-otro", { b2b_usuario_id: "u-otro", agencia_nombre: NOMBRE }),
  v("C5-propio", { b2b_usuario_id: "u-nuevo", agencia_nombre: NOMBRE }),
  v("C6-otra-ficha", { aliado_id: 9, agencia_nombre: "Otra" }),
  v("C7-comision-sin-ficha", { agencia_nombre: NOMBRE }),
];
const ALIADOS_B2B: Fila[] = [
  { id: 1, numero_contrato: "C3-comision-manual", aliado_id: 7 },
  { id: 2, numero_contrato: "C3-comision-manual", aliado_id: null },   // la más reciente SIN ficha: no la borra
  { id: 3, numero_contrato: "C7-comision-sin-ficha", aliado_id: null },
];
const SEL = `${COLUMNAS_DECISION}, cliente`;

const perfil = (p: Partial<PerfilPortal> = {}): PerfilPortal => ({
  id: "u-nuevo", rol: "agencia", tenant: "mayorista", activo: true, nombre: NOMBRE, aliadoId: null, accesoLegacyNombre: false, ...p,
});
async function listar(p: PerfilPortal | null, opts: OpcionesMemoria = {}, tablas: Record<string, Fila[]> = { ventas: VENTAS, aliados_b2b: ALIADOS_B2B }) {
  const db = supabaseEnMemoria(tablas, opts);
  const r = await contratosDelPortalB2B(p, consultasPortalSupabase(db as never, SEL));
  return { nums: r.contratos.map((c) => c.numero_contrato).sort(), via: r.via, aviso: r.legacyNoVerificado, db };
}

test("SOLICITANTE NUEVO, aprobado sin enlazar: solo ve lo que compró él; NADA del aliado antiguo", async () => {
  for (const bandera of [false, null]) {
    const { nums, db } = await listar(perfil({ accesoLegacyNombre: bandera }));
    assert.deepEqual(nums, ["C5-propio"], `bandera ${String(bandera)}`);
    assert.equal(db.llamadas.aliados_b2b ?? 0, 0, "sin bandera ni siquiera se buscan candidatos por nombre");
  }
});

test("MISMA CUENTA con enlace aprobado a la ficha 7: ve lo de su ficha (por id), no lo de solo nombre", async () => {
  const { nums, via } = await listar(perfil({ aliadoId: 7 }));
  assert.deepEqual(nums, ["C1-ficha", "C5-propio"]);
  assert.equal(via.get("C1-ficha"), "aliado_id");
});

test("ALIADO ANTIGUO con bandera: ve solo lo SIN ningún id; una ficha en CUALQUIER comisión manual lo excluye", async () => {
  const { nums, via, aviso } = await listar(perfil({ id: "u-antiguo", accesoLegacyNombre: true }));
  assert.deepEqual(nums, ["C2-solo-nombre", "C7-comision-sin-ficha"]);
  assert.equal(via.get("C2-solo-nombre"), "nombre_legacy");
  assert.equal(aviso, false);
  // C3 queda fuera aunque su comisión MÁS RECIENTE no tenga ficha (la vieja sí).
});

for (const [caso, fallar] of [
  ["consulta de fichas con error", (c: { tabla: string }) => (c.tabla === "aliados_b2b" ? "error" : null)],
  ["respuesta de fichas sin conteo", (c: { tabla: string }) => (c.tabla === "aliados_b2b" ? "sin_conteo" : null)],
  ["excepción al consultar fichas", (c: { tabla: string }) => (c.tabla === "aliados_b2b" ? "lanzar" : null)],
] as const) {
  test(`FAIL-CLOSED en el listado: ${caso} → ningún contrato por nombre, y se avisa`, async () => {
    const { nums, aviso } = await listar(
      perfil({ id: "u-nuevo", aliadoId: 7, accesoLegacyNombre: true }),
      { fallar: fallar as OpcionesMemoria["fallar"] }
    );
    // Lo que entra por id sigue; lo que dependía del nombre, no.
    assert.deepEqual(nums, ["C1-ficha", "C5-propio"]);
    assert.equal(aviso, true);
  });
}

test("MÁS DE 1.000 candidatos por nombre con límite de 1.000 filas: verifica todos y excluye los que tienen ficha", async () => {
  // 650 por agencia_nombre + 650 por freelance_nombre = 1.300 candidatos.
  const ventas: Fila[] = [];
  for (let i = 0; i < 1300; i++)
    ventas.push(v(`M-${String(i).padStart(4, "0")}`, i < 650 ? { agencia_nombre: NOMBRE } : { freelance_nombre: NOMBRE }));
  // Ficha en el ÚLTIMO (fuera del primer millar) y en uno del medio.
  const aliados: Fila[] = [
    { id: 1, numero_contrato: "M-1299", aliado_id: 7 },
    { id: 2, numero_contrato: "M-0700", aliado_id: 9 },
  ];
  const { nums, aviso } = await listar(perfil({ id: "u-antiguo", accesoLegacyNombre: true }), { maxFilas: 1000 }, { ventas, aliados_b2b: aliados });
  assert.equal(aviso, false);
  assert.equal(nums.length, 1298);
  assert.ok(!nums.includes("M-1299") && !nums.includes("M-0700"));

  // Si una página de la verificación falla a mitad de camino: nada por nombre.
  const r2 = await listar(perfil({ id: "u-antiguo", accesoLegacyNombre: true }),
    { maxFilas: 1000, fallar: (c) => (c.tabla === "aliados_b2b" && c.llamada === 9 ? "error" : null) },
    { ventas, aliados_b2b: aliados });
  assert.deepEqual(r2.nums, []);
  assert.equal(r2.aviso, true);
});

test("cuenta inactiva, sin rol B2B o sin perfil: lista vacía, sin consultar", async () => {
  for (const p of [
    perfil({ activo: false, aliadoId: 7, accesoLegacyNombre: true }),
    perfil({ activo: null, aliadoId: 7 }),
    perfil({ rol: "operaciones", aliadoId: 7, accesoLegacyNombre: true }),
    perfil({ rol: "cliente_final", accesoLegacyNombre: true }),
    null,
  ]) {
    const { nums, db } = await listar(p);
    assert.deepEqual(nums, [], JSON.stringify(p));
    assert.deepEqual(db.llamadas, {}, "ni siquiera consulta");
  }
});

test("bandera con nombre vacío: no busca por nombre", async () => {
  for (const nombre of ["", "   ", null]) {
    const { nums } = await listar(perfil({ id: "u-x", nombre, accesoLegacyNombre: true }));
    assert.deepEqual(nums, []);
  }
});

// ── Tenant y nombres divergentes (migración 193) ───────────────────────────

const VENTAS_193: Fila[] = [
  ...VENTAS,
  v("C8-otro-tenant", { tenant: "minorista", agencia_nombre: NOMBRE }),                 // mismo nombre, OTRA agencia
  v("C9-mayus-espacios", { agencia_nombre: "  VIAJES ANTIGUOS " }),                      // mismo nombre normalizado
  v("C10-solo-comision", {}),                                                            // ventas sin nombres
  v("C11-nombres-distintos", { agencia_nombre: "Otra Agencia", freelance_nombre: "Otro" }),
  v("C12-freelance", { agencia_nombre: "Otra Agencia", freelance_nombre: NOMBRE }),
  v("C13-contiene", { agencia_nombre: `${NOMBRE} y Cía` }),                               // lo CONTIENE pero no es igual
];
const ALIADOS_193: Fila[] = [
  ...ALIADOS_B2B,
  { id: 10, numero_contrato: "C10-solo-comision", aliado: NOMBRE, aliado_id: null },
  { id: 11, numero_contrato: "C11-nombres-distintos", aliado: NOMBRE, aliado_id: null },
  { id: 12, numero_contrato: "C12-freelance", aliado: "Otro Nombre", aliado_id: null },
];
const T193 = { ventas: VENTAS_193, aliados_b2b: ALIADOS_193 };

test("193 · nombres divergentes: decide SOLO el nombre de ventas, normalizado; el de la comisión manual no abre", async () => {
  const { nums } = await listar(perfil({ id: "u-antiguo", accesoLegacyNombre: true }), {}, T193);
  assert.deepEqual(nums, ["C12-freelance", "C2-solo-nombre", "C7-comision-sin-ficha", "C9-mayus-espacios"]);
  // Fuera: C8 (otro tenant), C10/C11 (nombre solo en aliados_b2b.aliado),
  // C13 (contiene el nombre pero no es igual), C3 (ficha en comisión manual).
});

test("193 · tenant: el aliado de Minorista con el mismo nombre ve SOLO lo de Minorista", async () => {
  const { nums } = await listar(perfil({ id: "u-min", tenant: "minorista", accesoLegacyNombre: true }), {}, T193);
  assert.deepEqual(nums, ["C8-otro-tenant"]);
});

test("193 · tenant nulo: no busca por nombre", async () => {
  const { nums, db } = await listar(perfil({ id: "u-x", tenant: null, accesoLegacyNombre: true }), {}, T193);
  assert.deepEqual(nums, []);
  assert.equal(db.llamadas.ventas ?? 0, 1, "solo la consulta por b2b_usuario_id");
});

test("193 · comodines en el nombre se buscan literales: '_' y '%' no amplían el acceso", async () => {
  const t = {
    ventas: [v("W1", { agencia_nombre: "ViajesXAntiguos" }), v("W2", { agencia_nombre: "Viajes_Antiguos" }), v("W3", { agencia_nombre: "100% Viajes" })],
    aliados_b2b: [],
  };
  assert.deepEqual((await listar(perfil({ id: "u-w", nombre: "Viajes_Antiguos", accesoLegacyNombre: true }), {}, t)).nums, ["W2"]);
  assert.deepEqual((await listar(perfil({ id: "u-w", nombre: "100%", accesoLegacyNombre: true }), {}, t)).nums, []);
  assert.equal(escaparLike("a%b_c\\d"), "a\\%b\\_c\\\\d");
});

for (const [caso, fallo] of [["error", "error"], ["sin conteo", "sin_conteo"], ["página vacía", "vacia"], ["excepción", "lanzar"]] as const) {
  test(`193 · FAIL-CLOSED en la búsqueda de candidatos (${caso}): nada por nombre, se avisa, lo de id sigue`, async () => {
    const { nums, aviso } = await listar(
      perfil({ aliadoId: 7, accesoLegacyNombre: true }),
      {
        maxFilas: fallo === "vacia" ? 1 : undefined,
        fallar: (c) => (c.tabla === "ventas" && c.conteo && (fallo !== "vacia" || (c.desde ?? 0) > 0) ? fallo : null),
      },
      T193
    );
    assert.deepEqual(nums, ["C1-ficha", "C5-propio"]);
    assert.equal(aviso, true);
  });
}

test("wiring: el portal usa el adaptador compartido; las consultas por nombre excluyen ids y no usan .or()", () => {
  const page = readFileSync(new URL("../app/portal/b2b/page.tsx", import.meta.url), "utf8");
  assert.match(page, /import \{ contratosDelPortalB2B, consultasPortalSupabase, COLUMNAS_DECISION \} from "@\/lib\/auth\/contratosPortalB2B"/);
  assert.match(page, /consultasPortalSupabase\(admin, sel\)/);
  assert.match(page, /select\("nombre, rol, activo, agencia_id, pct_comision, aliado_id, tenant, acceso_legacy_nombre"\)/);
  assert.match(page, /legacyNoVerificado &&/, "el aviso de histórico no verificado se muestra");
  assert.doesNotMatch(page.replace(/\/\/.*$/gm, ""), /from\("aliados_b2b"\)/, "la página no consulta fichas por su cuenta");

  const lib = readFileSync(new URL("../lib/auth/contratosPortalB2B.ts", import.meta.url), "utf8");
  const codigo = lib.replace(/\/\/.*$/gm, "");
  // Candidatos: por tenant, sin ids, ilike con comodines escapados, paginado fail-closed.
  assert.match(codigo, /\.eq\("tenant", tenant\)\s*\.ilike\(col, patron\)\s*\.is\("aliado_id", null\)\s*\.is\("b2b_usuario_id", null\)/);
  assert.match(codigo, /const patron = `%\$\{escaparLike\(n\)\}%`/);
  assert.match(codigo, /leerTodoConConteo<FilaContratoPortal>\(/);
  assert.doesNotMatch(codigo, /\.or\(/);
  assert.match(lib, /accesoDocumentoContrato\(perfilAcceso,/, "decide con la misma función que los documentos");
});
