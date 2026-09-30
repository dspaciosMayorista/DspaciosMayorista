// Origen y ruta al EDITAR un bloqueo (lib/vuelos/rutaBloqueo.ts, usado por
// EditarBloqueoForm). Antes, si el origen guardado no casaba con el catálogo
// de destinos (o no había destino), el combo arrancaba vacío y guardar
// cualquier otro campo escribía `origen`/`ruta` en null sin avisar. Regla:
//   - origen y destino SIN cambiar → se conservan origen y ruta guardados
//     (aunque el origen esté fuera del catálogo o el destino sea nulo);
//   - cambio con origen y destino válidos → se recalcula como siempre;
//   - cambio sin origen o destino válido → bloqueo con mensaje, sin vacíos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  iataDeDestino,
  origenIdDesdeGuardado,
  rutaAutomatica,
  resolverOrigenRutaEdicion,
  MSG_ORIGEN_INVALIDO,
  MSG_DESTINO_INVALIDO,
  type DestinoIata,
} from "../lib/vuelos/rutaBloqueo.ts";

const destinos: DestinoIata[] = [
  { id: 1, nombre: "BOGOTA", codigo_iata: "BOG" },
  { id: 2, nombre: "CARTAGENA", codigo_iata: "CTG" },
  { id: 3, nombre: "SAN ANDRES", codigo_iata: "ADZ" },
  { id: 4, nombre: "MEDELLIN", codigo_iata: null },
];

describe("helpers de catálogo (mismo comportamiento que tenía el formulario)", () => {
  test("iataDeDestino usa el IATA, o el nombre si no hay IATA, en mayúsculas", () => {
    assert.equal(iataDeDestino(destinos, 2), "CTG");
    assert.equal(iataDeDestino(destinos, 4), "MEDELLIN");
    assert.equal(iataDeDestino(destinos, ""), "");
    assert.equal(iataDeDestino(destinos, 99), "");
  });

  test("origenIdDesdeGuardado casa por IATA o nombre exacto, sin distinguir mayúsculas", () => {
    assert.equal(origenIdDesdeGuardado(destinos, "bog"), 1);
    assert.equal(origenIdDesdeGuardado(destinos, " Cartagena "), 2);
    assert.equal(origenIdDesdeGuardado(destinos, "Bogotá"), "", "la tilde no casa: es justo el caso fuera de catálogo");
    assert.equal(origenIdDesdeGuardado(destinos, ""), "");
  });

  test("rutaAutomatica arma IATA-IATA-IATA o queda vacía si falta uno", () => {
    assert.equal(rutaAutomatica("BOG", "CTG"), "BOG - CTG - BOG");
    assert.equal(rutaAutomatica("", "CTG"), "");
    assert.equal(rutaAutomatica("BOG", ""), "");
  });
});

describe("resolverOrigenRutaEdicion", () => {
  // Bloqueo guardado con un origen que el catálogo no reconoce.
  const fueraDeCatalogo = {
    destinos,
    origenGuardado: "Bogotá",
    rutaGuardada: "BOG-CTG-BOG",
    origenIdInicial: origenIdDesdeGuardado(destinos, "Bogotá"),
    destinoIdInicial: 2 as number | "",
  };
  // Bloqueo guardado con origen del catálogo pero SIN destino.
  const sinDestino = {
    destinos,
    origenGuardado: "BOG",
    rutaGuardada: "BOG - CTG - BOG",
    origenIdInicial: 1 as number | "",
    destinoIdInicial: "" as number | "",
  };

  describe("origen y destino sin cambiar: conserva lo guardado", () => {
    test("origen fuera del catálogo", () => {
      assert.equal(fueraDeCatalogo.origenIdInicial, "");
      const r = resolverOrigenRutaEdicion({ ...fueraDeCatalogo, origenId: "", destinoId: 2 });
      assert.deepEqual(r, { ok: true, modo: "conservado", origen: "Bogotá", ruta: "BOG-CTG-BOG" });
    });

    test("destino original nulo (con origen del catálogo)", () => {
      const r = resolverOrigenRutaEdicion({ ...sinDestino, origenId: 1, destinoId: "" });
      assert.deepEqual(r, { ok: true, modo: "conservado", origen: "BOG", ruta: "BOG - CTG - BOG" });
    });

    test("destino original nulo y origen fuera del catálogo", () => {
      const r = resolverOrigenRutaEdicion({ ...fueraDeCatalogo, destinoIdInicial: "", origenId: "", destinoId: "" });
      assert.deepEqual(r, { ok: true, modo: "conservado", origen: "Bogotá", ruta: "BOG-CTG-BOG" });
    });

    test("origen reconocido: no reescribe una ruta guardada con otro formato", () => {
      const r = resolverOrigenRutaEdicion({
        destinos, origenGuardado: "BOG", rutaGuardada: "BOG-CTG-BOG",
        origenIdInicial: 1, destinoIdInicial: 2, origenId: 1, destinoId: 2,
      });
      assert.deepEqual(r, { ok: true, modo: "conservado", origen: "BOG", ruta: "BOG-CTG-BOG" });
    });
  });

  describe("con cambios y ruta formable: recalcula", () => {
    test("origen fuera del catálogo: el usuario elige otro origen y destino", () => {
      const r = resolverOrigenRutaEdicion({ ...fueraDeCatalogo, origenId: 1, destinoId: 3 });
      assert.deepEqual(r, { ok: true, modo: "recalculado", origen: "BOG", ruta: "BOG - ADZ - BOG" });
    });

    test("origen fuera del catálogo: el usuario elige solo un origen válido", () => {
      const r = resolverOrigenRutaEdicion({ ...fueraDeCatalogo, origenId: 1, destinoId: 2 });
      assert.deepEqual(r, { ok: true, modo: "recalculado", origen: "BOG", ruta: "BOG - CTG - BOG" });
    });

    test("destino original nulo: el usuario elige un destino", () => {
      const r = resolverOrigenRutaEdicion({ ...sinDestino, origenId: 1, destinoId: 3 });
      assert.deepEqual(r, { ok: true, modo: "recalculado", origen: "BOG", ruta: "BOG - ADZ - BOG" });
    });
  });

  describe("con cambios y ruta NO formable: bloquea, nunca devuelve vacíos", () => {
    test("cambia el destino con el origen fuera del catálogo → pide un origen válido", () => {
      const r = resolverOrigenRutaEdicion({ ...fueraDeCatalogo, origenId: "", destinoId: 3 });
      assert.deepEqual(r, { ok: false, campo: "origen", error: MSG_ORIGEN_INVALIDO });
    });

    test("vacía el origen que era válido → pide un origen válido", () => {
      const r = resolverOrigenRutaEdicion({ ...sinDestino, destinoIdInicial: 2, origenId: "", destinoId: 2 });
      assert.deepEqual(r, { ok: false, campo: "origen", error: MSG_ORIGEN_INVALIDO });
    });

    test("vacía el destino que era válido → pide un destino válido", () => {
      const r = resolverOrigenRutaEdicion({ ...sinDestino, destinoIdInicial: 2, origenId: 1, destinoId: "" });
      assert.deepEqual(r, { ok: false, campo: "destino", error: MSG_DESTINO_INVALIDO });
    });

    test("ningún resultado permitido lleva origen o ruta vacíos tras un cambio", () => {
      const ids: (number | "")[] = ["", 1, 2, 3];
      for (const origenId of ids) for (const destinoId of ids) {
        const r = resolverOrigenRutaEdicion({ ...fueraDeCatalogo, origenId, destinoId });
        if (r.ok && r.modo === "recalculado") {
          assert.ok(r.origen && r.ruta, `origen/ruta vacíos con origen=${origenId} destino=${destinoId}`);
        }
      }
    });

    test("los mensajes son claros sobre qué elegir", () => {
      assert.match(MSG_ORIGEN_INVALIDO, /Elige un origen del catálogo/);
      assert.match(MSG_DESTINO_INVALIDO, /Elige un destino del catálogo/);
    });
  });
});
