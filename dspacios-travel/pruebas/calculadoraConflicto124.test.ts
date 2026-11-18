// #124 — pure comparison of two stored copies of a hotel calculator: what changed, never who changed it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarRenombre, clasificarCambio, estable, nombresTemporada, textoAviso } from "../lib/hoteles/calculadoraConflicto.ts";

const dubai = (t: string, extra: Record<string, unknown> = {}) => ({
  regimen_base: "PAM", modificadores: { sencilla_pct: 50, nino_pct: -50 }, suplementos: [{ regimen: "PC", monto: 45000 }],
  bases: [{ categoria: "Estándar", temporada: t, precio: 100000 }, { categoria: "Superior", temporada: "BAJA", precio: 80000 }],
  promos: [{ temporadaBase: t, temporadaPromo: "PROMO", regimen: "PAM", descuentoPct: 10 }], ...extra,
});
const mixta = (t: string) => ({
  regimen: "PAM", bases: [{ categoria: "Estándar", temporada: t, doble: 300000 }],
  bases_por_regimen: { PAM: [{ categoria: "Estándar", temporada: t, doble: 300000 }], PC: [{ categoria: "Estándar", temporada: t, doble: 330000 }] },
});
const c = (tipo: string, params: Record<string, unknown>, version = 1) => ({ version, tipo, params });

test("estable ignora el orden de las claves (jsonb no lo conserva) y los undefined", () => {
  assert.equal(estable({ a: 1, b: { c: [1, { y: 2, x: undefined, z: 3 }] } }), estable({ b: { c: [1, { z: 3, y: 2 }] }, a: 1 }));
  assert.notEqual(estable({ a: 1 }), estable({ a: 2 }));
});

test("nombresTemporada reúne bases, bases por régimen y promociones", () => {
  assert.deepEqual([...nombresTemporada(dubai("ALTA"))].sort(), ["ALTA", "BAJA", "PROMO"]);
  assert.deepEqual([...nombresTemporada(mixta("ALTA"))], ["ALTA"]);
});

test("renombre confirmado: Dubai (bases + promoción) y Mixta (bases + bases por régimen)", () => {
  assert.deepEqual(clasificarCambio(c("dubai", dubai("ALTA")), c("dubai", dubai("ALTA 2027"), 2)), { causa: "renombre", de: "ALTA", a: "ALTA 2027" });
  assert.deepEqual(clasificarCambio(c("mixta", mixta("ALTA")), c("mixta", mixta("ALTA 2027"), 2)), { causa: "renombre", de: "ALTA", a: "ALTA 2027" });
});

test("un renombre mezclado con otro cambio NO se reporta como renombre (no se adivina)", () => {
  const nueva = dubai("ALTA 2027", { modificadores: { sencilla_pct: 40, nino_pct: -50 } });
  const r = clasificarCambio(c("dubai", dubai("ALTA")), c("dubai", nueva, 2));
  assert.equal(r.causa, "valores");
});

test("cambio de valores: lista las secciones que difieren, en español", () => {
  const r = clasificarCambio(c("dubai", dubai("ALTA")), c("dubai", dubai("ALTA", { modificadores: { sencilla_pct: 40, nino_pct: -50 }, infante_nota: "x" }), 3));
  assert.deepEqual(r, { causa: "valores", secciones: ["modificadores", "nota de infante"] });
});

test("cambio de tipo, contenido igual con otro orden de claves, y sin copia conocida", () => {
  assert.deepEqual(clasificarCambio(c("dubai", dubai("ALTA")), c("mixta", mixta("ALTA"), 2)), { causa: "tipo", de: "dubai", a: "mixta" });
  const reordenado = JSON.parse(JSON.stringify(dubai("ALTA"), ["regimen_base", "promos", "bases", "suplementos", "modificadores", "categoria", "temporada", "precio", "regimen", "monto", "nino_pct", "sencilla_pct", "temporadaBase", "temporadaPromo", "descuentoPct"]));
  assert.equal(clasificarCambio(c("dubai", dubai("ALTA")), c("dubai", reordenado, 2)).causa, "igual");
  assert.deepEqual(clasificarCambio(null, c("dubai", dubai("ALTA"))), { causa: "valores", secciones: [] });
});

test("aplicarRenombre trabaja sobre una copia y no toca el original", () => {
  const original = dubai("ALTA");
  const copia = aplicarRenombre("dubai", original, "ALTA", "ALTA 2027") as ReturnType<typeof dubai>;
  assert.equal(original.bases[0].temporada, "ALTA");
  assert.equal(copia.bases[0].temporada, "ALTA 2027");
  assert.equal(copia.promos[0].temporadaBase, "ALTA 2027");
});

test("textoAviso: nunca nombra a una persona, dice si se guardó algo y cuál es la salida", () => {
  const base = { origen: "clic" as const, versionAntes: 4, versionAhora: 5 };
  const casos = [
    textoAviso({ ...base, causa: { causa: "renombre", de: "ALTA", a: "ALTA 2027" }, conCambiosLocales: false, conservados: false }),
    textoAviso({ ...base, causa: { causa: "renombre", de: "ALTA", a: "ALTA 2027" }, conCambiosLocales: true, conservados: true }),
    textoAviso({ ...base, causa: { causa: "valores", secciones: ["bases por categoría y temporada"] }, conCambiosLocales: true, conservados: false }),
    textoAviso({ ...base, causa: { causa: "tipo", de: "dubai", a: "mixta" }, conCambiosLocales: false, conservados: false }),
  ];
  for (const t of casos) assert.doesNotMatch(t, /otra persona|alguien|usuario/i, t);
  assert.match(casos[0], /Tu clic no guardó nada[\s\S]*Repite la acción/);
  assert.match(casos[1], /Todavía NO están guardados/);
  assert.match(casos[2], /siguen en pantalla[\s\S]*Recargar la página también lo descarta/);
  assert.match(casos[0], /versión 4 → 5/);
});
