import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseHora, horaEnFranja, segmentosFranja, validarFranjas, evaluarSuplementos, describirFranja, validarHorasTramos, tramosConFranja,
  type FranjaSuplemento,
} from "../lib/calc/trasladoFranjas.ts";

const f = (o: Partial<FranjaSuplemento> = {}): FranjaSuplemento => ({
  hora_desde: "19:00", hora_hasta: "06:00", tramo: "llegada", tipo: "monto", valor: 50_000, cobro: "grupo", ...o,
});
const min = (h: string) => parseHora(h)!;

describe("parseHora", () => {
  test("formatos válidos y rechazo de basura", () => {
    assert.equal(parseHora("00:00"), 0);
    assert.equal(parseHora("7:05"), 425);
    assert.equal(parseHora("19:30:00"), 1170);
    assert.equal(parseHora("07:05 pm"), 19 * 60 + 5);
    assert.equal(parseHora("12:00 am"), 0);
    assert.equal(parseHora("12:00 pm"), 720);
    for (const mala of ["", "25:00", "12:60", "abc", "7", "13:00 pm", null, undefined, 1900]) assert.equal(parseHora(mala), null, String(mala));
  });
  test("24:00 solo como hora final", () => {
    assert.equal(parseHora("24:00"), null);
    assert.equal(parseHora("24:00", true), 1440);
    assert.equal(parseHora("24:01", true), null);
  });
});

describe("franja que cruza medianoche 19:00–06:00 (inicio incluido, fin excluido)", () => {
  const nocturna = f();
  test("límites exactos", () => {
    assert.equal(horaEnFranja(min("18:59"), nocturna), false);
    assert.equal(horaEnFranja(min("19:00"), nocturna), true);
    assert.equal(horaEnFranja(min("23:59"), nocturna), true);
    assert.equal(horaEnFranja(min("00:00"), nocturna), true);
    assert.equal(horaEnFranja(min("05:59"), nocturna), true);
    assert.equal(horaEnFranja(min("06:00"), nocturna), false);
    assert.equal(horaEnFranja(min("12:00"), nocturna), false);
  });
  test("franja diurna normal y todo el día", () => {
    const dia = f({ hora_desde: "08:00", hora_hasta: "17:00" });
    assert.equal(horaEnFranja(min("07:59"), dia), false);
    assert.equal(horaEnFranja(min("08:00"), dia), true);
    assert.equal(horaEnFranja(min("16:59"), dia), true);
    assert.equal(horaEnFranja(min("17:00"), dia), false);
    const todo = f({ hora_desde: "00:00", hora_hasta: "24:00" });
    assert.equal(horaEnFranja(min("23:59"), todo), true);
    assert.equal(horaEnFranja(min("00:00"), todo), true);
  });
  test("hasta 00:00 equivale a hasta medianoche (sin segmento vacío)", () => {
    assert.deepEqual(segmentosFranja(f({ hora_desde: "22:00", hora_hasta: "00:00" })), [[1320, 1440]]);
  });
  test("desde == hasta es ambiguo y se rechaza", () => {
    assert.equal(segmentosFranja(f({ hora_desde: "10:00", hora_hasta: "10:00" })), null);
    assert.match(validarFranjas([f({ hora_desde: "10:00", hora_hasta: "10:00" })])[0], /no pueden ser iguales/);
  });
});

describe("validación y solapes", () => {
  test("franjas contiguas no se solapan (el fin no se incluye)", () => {
    assert.deepEqual(validarFranjas([f({ hora_desde: "19:00", hora_hasta: "23:00" }), f({ hora_desde: "23:00", hora_hasta: "06:00" })]), []);
  });
  test("solape en el mismo tramo, incluso cruzando medianoche", () => {
    assert.match(validarFranjas([f(), f({ hora_desde: "05:00", hora_hasta: "08:00" })]).join("|"), /se solapan/);
    assert.match(validarFranjas([f({ hora_desde: "22:00", hora_hasta: "02:00" }), f({ hora_desde: "01:00", hora_hasta: "03:00" })]).join("|"), /se solapan/);
  });
  test("mismo horario en tramos distintos NO se solapa; «ambos» sí choca con cualquiera de los dos", () => {
    assert.deepEqual(validarFranjas([f({ tramo: "llegada" }), f({ tramo: "salida" })]), []);
    assert.match(validarFranjas([f({ tramo: "ambos" }), f({ tramo: "salida", hora_desde: "20:00", hora_hasta: "21:00" })]).join("|"), /se solapan/);
  });
  test("valor, tipo, cobro, tramo y horas inválidos", () => {
    assert.ok(validarFranjas([f({ valor: 0 })]).length);
    assert.ok(validarFranjas([f({ valor: Number.NaN })]).length);
    assert.ok(validarFranjas([f({ valor: -5 })]).length);
    assert.ok(validarFranjas([f({ hora_desde: "25:00" })]).length);
    assert.ok(validarFranjas([{ ...f(), tramo: "otro" as never }]).length);
    assert.ok(validarFranjas([{ ...f(), tipo: "x" as never }]).length);
    assert.ok(validarFranjas([{ ...f(), cobro: "x" as never }]).length);
  });
});

describe("evaluarSuplementos", () => {
  const base = 400_000;
  test("solo llegada (ida): cobra la llegada nocturna, no la salida", () => {
    const r = evaluarSuplementos([f({ tramo: "llegada" })], { llegada: "21:30", salida: "14:00" }, base, 4);
    assert.ok(r.ok);
    assert.equal(r.ok && r.suplementos.length, 1);
    assert.equal(r.ok && r.suplementos[0].tramo, "llegada");
    assert.equal(r.ok && r.netoTotal, 50_000);
  });
  test("solo salida (regreso)", () => {
    const r = evaluarSuplementos([f({ tramo: "salida" })], { llegada: "21:30", salida: "03:15" }, base, 2);
    assert.ok(r.ok && r.suplementos.length === 1 && r.suplementos[0].tramo === "salida" && r.netoTotal === 50_000);
  });
  test("ambos: un cargo por CADA tramo que cumple, nunca dos por el mismo tramo", () => {
    const franjas = [f({ tramo: "ambos" })];
    const los2 = evaluarSuplementos(franjas, { llegada: "20:00", salida: "05:00" }, base, 2);
    assert.ok(los2.ok && los2.suplementos.length === 2 && los2.netoTotal === 100_000);
    const uno = evaluarSuplementos(franjas, { llegada: "20:00", salida: "10:00" }, base, 2);
    assert.ok(uno.ok && uno.suplementos.length === 1 && uno.suplementos[0].tramo === "llegada");
    const ninguno = evaluarSuplementos(franjas, { llegada: "10:00", salida: "10:00" }, base, 2);
    assert.ok(ninguno.ok && ninguno.suplementos.length === 0 && ninguno.netoTotal === 0);
  });
  test("monto por grupo vs por persona", () => {
    const g = evaluarSuplementos([f({ cobro: "grupo", valor: 30_000 })], { llegada: "22:00" }, base, 5);
    const p = evaluarSuplementos([f({ cobro: "persona", valor: 30_000 })], { llegada: "22:00" }, base, 5);
    assert.ok(g.ok && g.netoTotal === 30_000);
    assert.ok(p.ok && p.netoTotal === 150_000);
  });
  test("porcentaje del neto base", () => {
    const r = evaluarSuplementos([f({ tipo: "porcentaje", valor: 25 })], { llegada: "22:00" }, base, 3);
    assert.ok(r.ok && r.netoTotal === 100_000);
  });
  test("hora faltante o ilegible: no cobra y deja el tramo pendiente (nunca supone)", () => {
    const franjas = [f({ tramo: "ambos" })];
    const r = evaluarSuplementos(franjas, { llegada: "22:00" }, base, 2);
    assert.ok(r.ok);
    assert.deepEqual(r.ok && r.pendientes, ["salida"]);
    assert.equal(r.ok && r.netoTotal, 50_000);
    const sin = evaluarSuplementos(franjas, {}, base, 2);
    assert.ok(sin.ok && sin.netoTotal === 0 && sin.pendientes.length === 2);
    const mala = evaluarSuplementos(franjas, { llegada: "tarde", salida: "" }, base, 2);
    assert.ok(mala.ok && mala.pendientes.length === 2);
  });
  test("tramo sin franjas no pide hora", () => {
    const r = evaluarSuplementos([f({ tramo: "llegada" })], { llegada: "22:00" }, base, 2);
    assert.ok(r.ok && r.pendientes.length === 0);
    assert.deepEqual(tramosConFranja([f({ tramo: "llegada" })]), ["llegada"]);
  });
  test("datos corruptos con solape: falla cerrado, no elige una ni suma las dos", () => {
    const r = evaluarSuplementos([f(), f({ hora_desde: "20:00", hora_hasta: "21:00" })], { llegada: "20:30" }, base, 2);
    assert.equal(r.ok, false);
  });
});

describe("descripción legible y horas de entrada", () => {
  test("describe horario, medianoche, tramo y cargo", () => {
    const t = describirFranja(f({ tramo: "ambos", valor: 50_000, cobro: "persona" }));
    assert.match(t, /llegada y salida/);
    assert.match(t, /19:00/);
    assert.match(t, /06:00/);
    assert.match(t, /cruza la medianoche/);
    assert.match(t, /por persona/);
    assert.match(describirFranja(f({ tipo: "porcentaje", valor: 15, hora_desde: "08:00", hora_hasta: "17:00" })), /15% del neto base/);
  });
  test("validarHorasTramos normaliza, tolera vacío y rechaza texto ilegible", () => {
    assert.deepEqual(validarHorasTramos(undefined), { ok: true, horas: {} });
    assert.deepEqual(validarHorasTramos({ llegada: "7:05 pm", salida: "" }), { ok: true, horas: { llegada: "19:05" } });
    assert.equal(validarHorasTramos({ llegada: "tarde" }).ok, false);
    assert.equal(validarHorasTramos([]).ok, false);
    assert.equal(validarHorasTramos("19:00").ok, false);
  });
});
