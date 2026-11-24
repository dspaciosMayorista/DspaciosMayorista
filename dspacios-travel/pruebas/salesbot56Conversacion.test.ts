import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  adultosEnFrase,
  destinoEnFrase,
  destinoEnLista,
  esCualquiera,
  extraerFechas,
  interpretarCantidad,
  interpretarComando,
  interpretarHabitaciones,
  interpretarMenores,
  interpretarPosicion,
  interpretarProducto,
  limpiarDestinoLibre,
} from "../lib/salesbot/conversacion/interpretar.ts";
import { estadoInicial, sanearEntrada, sanearEstado } from "../lib/salesbot/conversacion/contrato.ts";

// #56 MVP de conversación guiada — INTÉRPRETE determinista y saneado del
// estado que devuelve el navegador. Ante una intención, fecha o cantidad
// ambigua, el intérprete no adivina: devuelve candidatos o "ambigua".

const HOY = "2026-10-20";

describe("producto", () => {
  test("variantes de palabras, mayúsculas y tildes", () => {
    for (const [t, p] of [
      ["Programas a Turquía", "programa"],
      ["un CIRCUITO por Europa", "programa"],
      ["bloqueo", "bloqueo"],
      ["paquete con vuelo a San Andrés", "bloqueo"],
      ["Porción terrestre", "porcion"],
      ["porcion terrestre", "porcion"],
      ["solo hotel en Cartagena", "porcion"],
      ["sin vuelo", "porcion"],
      ["hotel en santa marta", "porcion"],
    ] as const) {
      assert.deepEqual(interpretarProducto(t), { tipo: "ok", producto: p }, t);
    }
  });
  test("ambiguo: pregunta en vez de adivinar", () => {
    assert.deepEqual(interpretarProducto("quiero un paquete"), { tipo: "ambigua", candidatos: ["bloqueo", "porcion"] });
    assert.deepEqual(interpretarProducto("circuito o bloqueo"), { tipo: "ambigua", candidatos: ["programa", "bloqueo"] });
  });
  test("Servicios y Dinámico no se consultan todavía", () => {
    assert.deepEqual(interpretarProducto("tours en Cartagena"), { tipo: "no_disponible", producto: "servicios" });
    assert.deepEqual(interpretarProducto("salida dinámica"), { tipo: "no_disponible", producto: "dinamico" });
  });
  test("sin señal", () => {
    assert.deepEqual(interpretarProducto("hola"), { tipo: "ninguna" });
  });
});

describe("comandos", () => {
  test("empezar de nuevo, asesor, ayuda, agencia", () => {
    for (const t of ["empezar de nuevo", "Reiniciar", "nueva consulta", "volver a empezar"]) assert.deepEqual(interpretarComando(t), { tipo: "reiniciar" }, t);
    assert.deepEqual(interpretarComando("quiero hablar con un asesor"), { tipo: "asesor" });
    assert.deepEqual(interpretarComando("ayuda"), { tipo: "ayuda" });
    assert.deepEqual(interpretarComando("es para una agencia viajes sol"), { tipo: "agencia", nombre: "viajes sol" });
    assert.deepEqual(interpretarComando("agencia"), { tipo: "agencia", nombre: null });
  });
  test("corregir una respuesta", () => {
    for (const [t, c] of [
      ["cambiar fechas", "fechas"],
      ["corregir el destino", "destino"],
      ["modificar habitaciones", "habitaciones"],
      ["cambiar las edades de los niños", "menores"],
      ["otra opción", "seleccion"],
      ["cambiar adultos", "adultos"],
      ["otra categoría", "combo"],
      ["cambiar producto", "producto"],
    ] as const) {
      assert.deepEqual(interpretarComando(t), { tipo: "corregir", campo: c }, t);
    }
  });
  test("texto normal no es comando", () => {
    assert.equal(interpretarComando("2 dobles"), null);
    assert.equal(interpretarComando("San Andrés"), null);
  });
});

describe("fechas", () => {
  const ok = (t: string) => extraerFechas(t, HOY).menciones;
  test("rango con mes en palabras, ISO y numérico", () => {
    assert.deepEqual(ok("del 10 al 13 de marzo de 2027"), [{ tipo: "ok", fecha: "2027-03-10" }, { tipo: "ok", fecha: "2027-03-13" }]);
    assert.deepEqual(ok("2027-03-10 a 2027-03-13"), [{ tipo: "ok", fecha: "2027-03-10" }, { tipo: "ok", fecha: "2027-03-13" }]);
    assert.deepEqual(ok("10/03/2027 al 13/03/2027"), [{ tipo: "ok", fecha: "2027-03-10" }, { tipo: "ok", fecha: "2027-03-13" }], "13/03 fija la convención día/mes");
    assert.deepEqual(ok("15 de Marzo de 2027"), [{ tipo: "ok", fecha: "2027-03-15" }]);
  });
  test("ambiguas: día/mes intercambiables o sin año → candidatos", () => {
    assert.deepEqual(ok("03/04/2027"), [{ tipo: "ambigua", candidatos: ["2027-04-03", "2027-03-04"] }]);
    assert.deepEqual(ok("15 de marzo"), [{ tipo: "ambigua", candidatos: ["2027-03-15"] }]);
    assert.equal(extraerFechas("en marzo", HOY).mesSinDia, true);
  });
  test("inválidas y pasadas", () => {
    assert.deepEqual(ok("31/02/2027"), [{ tipo: "invalida" }]);
    assert.deepEqual(ok("10/03/2020"), [{ tipo: "pasada" }]);
    assert.deepEqual(ok("2026-10-19"), [{ tipo: "pasada" }]);
  });
});

describe("cantidades, habitaciones y menores", () => {
  test("cantidad exacta o ambigua", () => {
    assert.deepEqual(interpretarCantidad("2"), { tipo: "ok", n: 2 });
    assert.deepEqual(interpretarCantidad("dos adultos"), { tipo: "ok", n: 2 });
    for (const t of ["2 o 3", "unos 4", "entre 2 y 4", "2-3"]) assert.deepEqual(interpretarCantidad(t), { tipo: "ambigua" }, t);
    assert.deepEqual(interpretarCantidad("muchos"), { tipo: "ninguna" });
    assert.equal(adultosEnFrase("para 3 adultos"), 3);
  });
  test("habitaciones por tipo; un número sin tipo es ambiguo", () => {
    assert.deepEqual(interpretarHabitaciones("1 doble"), { tipo: "ok", habitaciones: { doble: 1 } });
    assert.deepEqual(interpretarHabitaciones("dos dobles y una sencilla"), { tipo: "ok", habitaciones: { sencilla: 1, doble: 2 } });
    assert.deepEqual(interpretarHabitaciones("una habitación triple"), { tipo: "ok", habitaciones: { triple: 1 } });
    assert.deepEqual(interpretarHabitaciones("1 individual"), { tipo: "ok", habitaciones: { sencilla: 1 } });
    for (const t of ["2", "3 habitaciones", "2 dobles 3", "2 o 3 dobles"]) assert.deepEqual(interpretarHabitaciones(t), { tipo: "ambigua" }, t);
    assert.deepEqual(interpretarHabitaciones("11 dobles"), { tipo: "invalida" });
  });
  test("menores: sin menores, edades y conteo coherente", () => {
    for (const t of ["sin menores", "no", "ninguno", "solo adultos", "sin niños"]) assert.deepEqual(interpretarMenores(t), { tipo: "ok", edades: [] }, t);
    assert.deepEqual(interpretarMenores("5 y 9"), { tipo: "ok", edades: [5, 9] });
    assert.deepEqual(interpretarMenores("un niño de 5 y otro de 9"), { tipo: "ok", edades: [5, 9] });
    assert.deepEqual(interpretarMenores("2 niños de 4 y 7"), { tipo: "ok", edades: [4, 7] });
    assert.deepEqual(interpretarMenores("2 niños"), { tipo: "ambigua", motivo: "sin_edades" });
    assert.deepEqual(interpretarMenores("3 niños de 4 y 7"), { tipo: "ambigua", motivo: "cantidad_no_coincide" });
    assert.deepEqual(interpretarMenores("19"), { tipo: "invalida" });
  });
});

describe("destino y posición", () => {
  const LISTA = ["SAN ANDRÉS", "CARTAGENA", "SANTA MARTA"];
  test("destino de la lista sin tildes ni mayúsculas; ambiguo con candidatos", () => {
    assert.deepEqual(destinoEnLista("san andres", LISTA), { tipo: "ok", destino: "SAN ANDRÉS" });
    assert.deepEqual(destinoEnLista("quiero Cartagena", LISTA), { tipo: "ok", destino: "CARTAGENA" });
    assert.deepEqual(destinoEnLista("santa", ["SANTA MARTA", "SANTA FE"]), { tipo: "ambiguo", candidatos: ["SANTA MARTA", "SANTA FE"] });
    assert.deepEqual(destinoEnLista("parís", LISTA), { tipo: "ninguno" });
  });
  test("destino libre", () => {
    assert.equal(destinoEnFrase("bloqueo a san andres del 10 al 13 de marzo"), "san andres");
    assert.equal(limpiarDestinoLibre("quiero ir a Europa"), "europa");
    assert.equal(esCualquiera("Cualquiera"), true);
    assert.equal(esCualquiera("no importa"), true);
  });
  test("posición en la lista mostrada", () => {
    assert.equal(interpretarPosicion("2", 5), 2);
    assert.equal(interpretarPosicion("la 3", 5), 3);
    assert.equal(interpretarPosicion("el primero", 5), 1);
    assert.equal(interpretarPosicion("9", 5), null);
    assert.equal(interpretarPosicion("hotel caribe", 5), null);
  });
});

describe("el estado del navegador no es fuente de verdad", () => {
  test("cualquier cosa que no sea un estado → estado inicial", () => {
    for (const v of [null, undefined, 1, "x", [], {}, { v: 2 }]) assert.deepEqual(sanearEstado(v), estadoInicial(), String(v));
  });
  test("campos mal formados quedan vacíos; nada fuera del contrato pasa", () => {
    const e = sanearEstado({
      v: 1,
      producto: "admin",
      destino: "x".repeat(200),
      fechaIda: "2027-02-30",
      fechaRegreso: "2027-03-13",
      adultos: 99,
      habitaciones: { doble: 2, suite: 5, triple: 0 },
      edadesMenores: [5, 30],
      agenciaId: -1,
      pendiente: "borrar_todo",
      ultimaLista: ["blo:1-b2-3", 7, "x".repeat(500)],
      record: "L93FYZ",
      tarifa_neta: 1,
    });
    assert.equal(e.producto, null);
    assert.equal(e.destino, null);
    assert.equal(e.fechaIda, null);
    assert.equal(e.fechaRegreso, null, "sin ida válida no hay regreso");
    assert.equal(e.adultos, null);
    assert.deepEqual(e.habitaciones, { doble: 2 });
    assert.equal(e.edadesMenores, null);
    assert.equal(e.agenciaId, null);
    assert.equal(e.pendiente, null);
    assert.deepEqual(e.ultimaLista, ["blo:1-b2-3"]);
    assert.equal("record" in e, false);
    assert.equal("tarifa_neta" in e, false);
  });
  test("entrada: tipo, forma y longitud", () => {
    assert.deepEqual(sanearEntrada({ tipo: "texto", texto: "  hola " }), { tipo: "texto", texto: "hola" });
    assert.deepEqual(sanearEntrada({ tipo: "opcion", valor: "reiniciar" }), { tipo: "opcion", valor: "reiniciar" });
    assert.deepEqual(sanearEntrada({ tipo: "inicio" }), { tipo: "inicio" });
    for (const v of [null, { tipo: "texto", texto: "" }, { tipo: "texto", texto: "a".repeat(301) }, { tipo: "opcion", valor: 3 }, { tipo: "sql" }]) assert.equal(sanearEntrada(v), null, JSON.stringify(v).slice(0, 40));
  });
});
