import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  idPositivo, moduloDe, MODULOS_HOTEL, MODULOS_SALIDA,
  validarEntradaDetalleHotel, validarEntradaDetalleSalida, validarEntradaDetallePaquete,
} from "../lib/tarifario/detalleValidacion.ts";

// EJECUCIÓN REAL de la frontera de validación del detalle bajo demanda
// (Tier 2) — estas funciones son lo único que se interpone entre un body de
// Server Action manipulado (llamable desde el navegador con cualquier JSON)
// y una consulta real a Supabase con `hotel_id`/`bloqueo_id`/`paquete_id`.
// Ningún input malformado debe lanzar un TypeError ni colarse como un id
// válido.

describe("idPositivo() — entero positivo estricto", () => {
  for (const v of [1, 2, 999999]) {
    test(`acepta ${v}`, () => assert.equal(idPositivo(v), v));
  }
  for (const v of [0, -1, -0.5, 1.5, NaN, Infinity, -Infinity, "1", "1.0", null, undefined, true, false, [], {}, [1], { id: 1 }]) {
    test(`rechaza ${JSON.stringify(v)}`, () => assert.equal(idPositivo(v), null));
  }
});

describe("moduloDe() — solo strings dentro del set permitido", () => {
  test("acepta un módulo válido del set", () => assert.equal(moduloDe("bloqueo", MODULOS_HOTEL), "bloqueo"));
  test("rechaza un módulo fuera del set (aunque sea un módulo válido en general)", () => assert.equal(moduloDe("servicios", MODULOS_HOTEL), null));
  for (const v of [1, null, undefined, {}, [], true, "BLOQUEO", " bloqueo", "bloqueo\0", ""]) {
    test(`rechaza no-string / valor manipulado ${JSON.stringify(v)}`, () => assert.equal(moduloDe(v, MODULOS_SALIDA), null));
  }
});

describe("validarEntradaDetalleHotel() — {modulo, hotelId}", () => {
  test("acepta forma válida", () => assert.deepEqual(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10 }), { modulo: "bloqueo", hotelId: 10 }));
  test("acepta porcion_terrestre", () => assert.deepEqual(validarEntradaDetalleHotel({ modulo: "porcion_terrestre", hotelId: 1 }), { modulo: "porcion_terrestre", hotelId: 1 }));
  test("rechaza modulo=servicios (Vista Booking nunca abre un hotel de servicios)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "servicios", hotelId: 10 }), null));
  test("rechaza modulo=dinamico (no aplica a 'Ver opciones' de hotel)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "dinamico", hotelId: 10 }), null));
  test("rechaza hotelId negativo", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: -5 }), null));
  test("rechaza hotelId decimal", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 1.5 }), null));
  test("rechaza hotelId string (inyección de SQL/operadores como texto)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: "10 OR 1=1" }), null));
  test("rechaza null", () => assert.equal(validarEntradaDetalleHotel(null), null));
  test("rechaza undefined", () => assert.equal(validarEntradaDetalleHotel(undefined), null));
  test("rechaza un array", () => assert.equal(validarEntradaDetalleHotel([{ modulo: "bloqueo", hotelId: 10 }]), null));
  test("rechaza un string", () => assert.equal(validarEntradaDetalleHotel("bloqueo:10"), null));
  test("rechaza un número", () => assert.equal(validarEntradaDetalleHotel(10), null));
  test("rechaza objeto vacío", () => assert.equal(validarEntradaDetalleHotel({}), null));
  test("rechaza campo faltante (solo modulo)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo" }), null));
  test("rechaza campo faltante (solo hotelId)", () => assert.equal(validarEntradaDetalleHotel({ hotelId: 10 }), null));
  test("tolera campos extra sin usarlos (no filtra por allowlist estricta de claves, pero tampoco los propaga)", () => {
    const r = validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, extra: "algo" });
    assert.deepEqual(r, { modulo: "bloqueo", hotelId: 10 });
  });
});

describe("validarEntradaDetalleSalida() — discriminado por módulo (bloqueoId vs salidaId)", () => {
  test("bloqueo: acepta bloqueoId", () => assert.deepEqual(validarEntradaDetalleSalida({ modulo: "bloqueo", bloqueoId: 5 }), { modulo: "bloqueo", bloqueoId: 5 }));
  test("dinamico: acepta salidaId", () => assert.deepEqual(validarEntradaDetalleSalida({ modulo: "dinamico", salidaId: 7 }), { modulo: "dinamico", salidaId: 7 }));
  test("bloqueo: rechaza si viene salidaId en vez de bloqueoId", () => assert.equal(validarEntradaDetalleSalida({ modulo: "bloqueo", salidaId: 7 }), null));
  test("dinamico: rechaza si viene bloqueoId en vez de salidaId", () => assert.equal(validarEntradaDetalleSalida({ modulo: "dinamico", bloqueoId: 7 }), null));
  test("rechaza modulo=porcion_terrestre (Vista tabla de salidas no aplica a porción)", () => assert.equal(validarEntradaDetalleSalida({ modulo: "porcion_terrestre", bloqueoId: 5 }), null));
  test("rechaza modulo=servicios", () => assert.equal(validarEntradaDetalleSalida({ modulo: "servicios", bloqueoId: 5 }), null));
  test("rechaza forma no-objeto", () => assert.equal(validarEntradaDetalleSalida("x"), null));
  test("rechaza null", () => assert.equal(validarEntradaDetalleSalida(null), null));
});

describe("validarEntradaDetallePaquete() — {paqueteId}", () => {
  test("acepta forma válida", () => assert.deepEqual(validarEntradaDetallePaquete({ paqueteId: 3 }), { paqueteId: 3 }));
  test("rechaza paqueteId=0", () => assert.equal(validarEntradaDetallePaquete({ paqueteId: 0 }), null));
  test("rechaza sin paqueteId", () => assert.equal(validarEntradaDetallePaquete({}), null));
  test("rechaza array", () => assert.equal(validarEntradaDetallePaquete([3]), null));
});
