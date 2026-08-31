import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  idPositivo, moduloDe, idsPositivosLimitados, MAX_IDS_ALCANCE, MODULOS_HOTEL, MODULOS_SALIDA,
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

describe("idsPositivosLimitados() — array de ids con límite explícito (alcance de detalle bajo demanda)", () => {
  test("acepta array vacío (alcance vacío es válido: 'ninguna salida visible')", () => assert.deepEqual(idsPositivosLimitados([]), []));
  test("acepta array de enteros positivos", () => assert.deepEqual(idsPositivosLimitados([3, 1, 2]), [3, 1, 2]));
  test("rechaza si no es array", () => {
    for (const v of [null, undefined, "1,2,3", {}, 5, true]) assert.equal(idsPositivosLimitados(v), null, JSON.stringify(v));
  });
  test("rechaza si CUALQUIER elemento no es entero positivo válido (todo o nada)", () => {
    assert.equal(idsPositivosLimitados([1, 2, -3]), null);
    assert.equal(idsPositivosLimitados([1, "2", 3]), null);
    assert.equal(idsPositivosLimitados([1, 0, 3]), null);
    assert.equal(idsPositivosLimitados([1, 1.5, 3]), null);
    assert.equal(idsPositivosLimitados([1, null, 3]), null);
    assert.equal(idsPositivosLimitados([1, NaN, 3]), null);
  });
  test("acepta exactamente el límite (MAX_IDS_ALCANCE elementos)", () => {
    const arr = Array.from({ length: MAX_IDS_ALCANCE }, (_, i) => i + 1);
    assert.deepEqual(idsPositivosLimitados(arr), arr);
  });
  test("rechaza un elemento por encima del límite explícito", () => {
    const arr = Array.from({ length: MAX_IDS_ALCANCE + 1 }, (_, i) => i + 1);
    assert.equal(idsPositivosLimitados(arr), null);
  });
  test("respeta un límite `max` custom pasado por el caller", () => {
    assert.deepEqual(idsPositivosLimitados([1, 2], 2), [1, 2]);
    assert.equal(idsPositivosLimitados([1, 2, 3], 2), null);
  });
});

describe("validarEntradaDetalleHotel() — {modulo, hotelId, bloqueoIds?}", () => {
  test("bloqueo: acepta forma válida con bloqueoIds", () =>
    assert.deepEqual(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, bloqueoIds: [5, 6] }), { modulo: "bloqueo", hotelId: 10, bloqueoIds: [5, 6] }));
  test("bloqueo: acepta bloqueoIds vacío (alcance filtrado a cero salidas)", () =>
    assert.deepEqual(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, bloqueoIds: [] }), { modulo: "bloqueo", hotelId: 10, bloqueoIds: [] }));
  test("bloqueo: RECHAZA si falta bloqueoIds — ya no se puede pedir 'todo el hotel' sin declarar el alcance", () =>
    assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10 }), null));
  test("bloqueo: rechaza bloqueoIds no-array", () =>
    assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, bloqueoIds: "5,6" }), null));
  test("bloqueo: rechaza bloqueoIds con un elemento inválido", () =>
    assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, bloqueoIds: [5, -1] }), null));
  test("bloqueo: rechaza bloqueoIds por encima del límite explícito", () => {
    const bloqueoIds = Array.from({ length: MAX_IDS_ALCANCE + 1 }, (_, i) => i + 1);
    assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, bloqueoIds }), null);
  });
  test("porcion_terrestre: acepta SIN bloqueoIds (no tiene concepto de alcance)", () =>
    assert.deepEqual(validarEntradaDetalleHotel({ modulo: "porcion_terrestre", hotelId: 1 }), { modulo: "porcion_terrestre", hotelId: 1 }));
  test("porcion_terrestre: ignora un bloqueoIds sobrante (no forma parte de su contrato)", () => {
    const r = validarEntradaDetalleHotel({ modulo: "porcion_terrestre", hotelId: 1, bloqueoIds: [1, 2] });
    assert.deepEqual(r, { modulo: "porcion_terrestre", hotelId: 1 });
  });
  test("rechaza modulo=servicios (Vista Booking nunca abre un hotel de servicios)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "servicios", hotelId: 10, bloqueoIds: [] }), null));
  test("rechaza modulo=dinamico (no aplica a 'Ver opciones' de hotel)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "dinamico", hotelId: 10, bloqueoIds: [] }), null));
  test("rechaza hotelId negativo", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: -5, bloqueoIds: [] }), null));
  test("rechaza hotelId decimal", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 1.5, bloqueoIds: [] }), null));
  test("rechaza hotelId string (inyección de SQL/operadores como texto)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: "10 OR 1=1", bloqueoIds: [] }), null));
  test("rechaza null", () => assert.equal(validarEntradaDetalleHotel(null), null));
  test("rechaza undefined", () => assert.equal(validarEntradaDetalleHotel(undefined), null));
  test("rechaza un array", () => assert.equal(validarEntradaDetalleHotel([{ modulo: "bloqueo", hotelId: 10 }]), null));
  test("rechaza un string", () => assert.equal(validarEntradaDetalleHotel("bloqueo:10"), null));
  test("rechaza un número", () => assert.equal(validarEntradaDetalleHotel(10), null));
  test("rechaza objeto vacío", () => assert.equal(validarEntradaDetalleHotel({}), null));
  test("rechaza campo faltante (solo modulo)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo" }), null));
  test("rechaza campo faltante (solo hotelId)", () => assert.equal(validarEntradaDetalleHotel({ hotelId: 10 }), null));
  test("tolera campos extra sin usarlos (no filtra por allowlist estricta de claves, pero tampoco los propaga)", () => {
    const r = validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, bloqueoIds: [5], extra: "algo" });
    assert.deepEqual(r, { modulo: "bloqueo", hotelId: 10, bloqueoIds: [5] });
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
