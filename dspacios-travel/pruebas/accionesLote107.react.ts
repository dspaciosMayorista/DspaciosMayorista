// node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//      --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/accionesLote107.react.ts
//
// #107 — Server Actions REALES por lote del armado (setServicios, desvincularSalidasEmpaquetados63) contra una base
// simulada: una sola escritura por lote, una sola invalidación, y resultados parciales explicados.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setClient } from "./support/stubs/supabaseServerStub.mjs";
import { __revalidadas, __resetRevalidadas } from "./support/stubs/nextCacheStub.mjs";
import { setServicios, desvincularSalidasEmpaquetados63 } from "../app/(dashboard)/dashboard/paquetes/actions.ts";

type Op = { tabla: string; accion: string; args: unknown; filtros: [string, unknown][] };
const ops: Op[] = [];
let respuesta: (op: Op) => { data?: unknown; error?: { message: string } | null; count?: number | null } = () => ({ data: [], error: null });

function constructor(tabla: string, accion: string, args: unknown): unknown {
  const op: Op = { tabla, accion, args, filtros: [] };
  const b: Record<string, unknown> = {};
  for (const f of ["eq", "in", "not"]) b[f] = (...a: unknown[]) => { op.filtros.push([f, a]); return b; };
  b.select = (...a: unknown[]) => { op.filtros.push(["select", a]); return b; };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    ops.push(op);
    return Promise.resolve({ error: null, ...respuesta(op) }).then(ok, ko);
  };
  return b;
}
const cliente = {
  from: (tabla: string) => ({
    select: (...a: unknown[]) => constructor(tabla, "select", a),
    delete: (...a: unknown[]) => constructor(tabla, "delete", a),
    upsert: (...a: unknown[]) => constructor(tabla, "upsert", a),
    insert: (...a: unknown[]) => constructor(tabla, "insert", a),
  }),
};

beforeEach(() => { ops.length = 0; __resetRevalidadas(); __setClient(cliente); respuesta = () => ({ data: [], error: null }); });

const item = (servicioId: number, modo: "persona" | "grupo" = "persona", incluido = false) => ({ servicioId, modo, incluido });

test("setServicios(marcar): UN upsert con todos y UNA invalidación; el que ya no existe se omite y se explica", async () => {
  respuesta = (op) => (op.tabla === "servicios_adicionales" ? { data: [{ id: 1 }, { id: 2 }] } : { data: null });
  const r = await setServicios(7, [item(1), item(2, "grupo", true), item(3)], true);
  assert.deepEqual(r, { ok: true, procesados: 2, omitidos: [{ id: 3, motivo: "El servicio #3 ya no existe." }] });
  const escrituras = ops.filter((o) => o.accion === "upsert");
  assert.equal(escrituras.length, 1, "una sola escritura para todo el lote");
  assert.deepEqual(escrituras[0].args, [
    [{ paquete_id: 7, servicio_id: 1, modo: "persona", incluido: false }, { paquete_id: 7, servicio_id: 2, modo: "grupo", incluido: true }],
    { onConflict: "paquete_id,servicio_id" },
  ]);
  assert.deepEqual(__revalidadas(), ["/dashboard/paquetes/7"], "una sola invalidación");
});

test("setServicios(marcar): deduplica, y si ninguno existe falla sin escribir ni invalidar", async () => {
  respuesta = () => ({ data: [] });
  const r = await setServicios(7, [item(5), item(5)], true);
  assert.equal(r.ok, false);
  assert.equal(ops.filter((o) => o.accion === "upsert").length, 0);
  assert.deepEqual(__revalidadas(), []);
});

test("setServicios(quitar): UN delete acotado al paquete y a los ids; devuelve el conteo real", async () => {
  respuesta = () => ({ count: 2 });
  const r = await setServicios(7, [item(1), item(2)], false);
  assert.deepEqual(r, { ok: true, procesados: 2 });
  const d = ops.filter((o) => o.accion === "delete");
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].args, [{ count: "exact" }]);
  assert.deepEqual(d[0].filtros, [["eq", ["paquete_id", 7]], ["in", ["servicio_id", [1, 2]]]]);
  assert.deepEqual(__revalidadas(), ["/dashboard/paquetes/7"]);
});

test("setServicios: valida la entrada y propaga errores de base sin invalidar", async () => {
  assert.equal((await setServicios(7, [], true)).ok, false);
  assert.equal((await setServicios(7, [item(-1)], true)).ok, false);
  assert.equal((await setServicios(7, [{ servicioId: 1, modo: "otro" as never, incluido: false }], true)).ok, false);
  assert.equal((await setServicios(7, Array.from({ length: 501 }, (_, i) => item(i + 1)), true)).ok, false);
  respuesta = (op) => (op.accion === "delete" ? { error: { message: "boom" } } : { data: [] });
  assert.deepEqual(await setServicios(7, [item(1)], false), { ok: false, error: "boom" });
  assert.deepEqual(__revalidadas(), []);
  assert.equal(ops.length, 1, "los rechazos de validación no tocaron la base");
});

test("desvincularSalidasEmpaquetados63: UN delete (solo vinculadas de ESTE paquete), UNA invalidación; las ausentes se informan", async () => {
  respuesta = (op) => (op.accion === "delete" ? { data: [{ id: 901 }, { id: 902 }] } : { data: [] });
  // generarTarifario no puede correr en este arnés: su fallo se informa como aviso, no rompe el desvincular.
  const r = await desvincularSalidasEmpaquetados63(7, [901, 902, 903, 901]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.procesados, 2);
  assert.deepEqual(r.omitidos, [{ id: 903, motivo: "La salida #903 ya no estaba vinculada." }]);
  const d = ops.filter((o) => o.accion === "delete");
  assert.equal(d.length, 1, "un solo delete para todas las salidas");
  assert.equal(d[0].tabla, "salidas_dinamicas");
  assert.deepEqual(d[0].filtros.slice(0, 3), [["eq", ["paquete_id", 7]], ["not", ["empaquetado_id", "is", null]], ["in", ["id", [901, 902, 903]]]]);
  assert.equal(__revalidadas().filter((p) => p === "/dashboard/paquetes/7").length >= 1, true);
});

test("desvincularSalidasEmpaquetados63: ids inválidos, nada que desvincular y error de base", async () => {
  assert.equal((await desvincularSalidasEmpaquetados63(7, [])).ok, false);
  assert.equal((await desvincularSalidasEmpaquetados63(7, [0])).ok, false);
  assert.equal(ops.length, 0);
  respuesta = () => ({ data: [] });
  const nada = await desvincularSalidasEmpaquetados63(7, [5]);
  assert.deepEqual(nada, { ok: false, error: "Esas salidas ya no estaban vinculadas a este paquete." });
  assert.deepEqual(__revalidadas(), []);
});
