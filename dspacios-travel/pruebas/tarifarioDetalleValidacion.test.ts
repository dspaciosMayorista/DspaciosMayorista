import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  idPositivo, moduloDe, idsPositivosLimitados, MAX_IDS_ALCANCE, MODULOS_HOTEL, MODULOS_SALIDA,
  validarComboIdentidad, validarCombosPermitidos, MAX_COMBOS_ALCANCE,
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

// ── Ronda 6, ítem 2 — validación del combo estructural compartido ──────────
function comboValido() {
  return {
    modulo: "bloqueo", paquete_id: 1, bloqueo_id: 10, salida_id: null, hotel_id: 7,
    categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP",
  };
}

describe("validarComboIdentidad() — combo estructural (modulo/paquete/bloqueo/salida/hotel/categoría/régimen/fechas/moneda)", () => {
  test("acepta un combo completo válido", () => assert.deepEqual(validarComboIdentidad(comboValido()), comboValido()));
  test("acepta TODOS los campos en null salvo modulo (combo mínimo)", () => {
    const c = { modulo: "servicios", paquete_id: null, bloqueo_id: null, salida_id: null, hotel_id: null, categoria: null, regimen: null, fecha_ida: null, fecha_regreso: null, moneda: null };
    assert.deepEqual(validarComboIdentidad(c), c);
  });
  test("acepta campos ausentes (undefined) tratados como null", () => {
    const r = validarComboIdentidad({ modulo: "bloqueo" });
    assert.deepEqual(r, { modulo: "bloqueo", paquete_id: null, bloqueo_id: null, salida_id: null, hotel_id: null, categoria: null, regimen: null, fecha_ida: null, fecha_regreso: null, moneda: null });
  });
  test("rechaza modulo inválido/ausente", () => {
    assert.equal(validarComboIdentidad({ ...comboValido(), modulo: "invalido" }), null);
    assert.equal(validarComboIdentidad({ ...comboValido(), modulo: undefined }), null);
    assert.equal(validarComboIdentidad({ ...comboValido(), modulo: 1 }), null);
  });
  test("acepta los 4 módulos válidos", () => {
    for (const m of ["bloqueo", "porcion_terrestre", "servicios", "dinamico"]) {
      assert.ok(validarComboIdentidad({ ...comboValido(), modulo: m }) != null, m);
    }
  });
  for (const campo of ["paquete_id", "bloqueo_id", "salida_id", "hotel_id"] as const) {
    test(`rechaza ${campo} inválido (0/-1/decimal/string) — todo o nada`, () => {
      for (const v of [0, -1, 1.5, "10", NaN, true, [], {}]) {
        assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: v }), null, JSON.stringify(v));
      }
    });
    test(`acepta ${campo} en null`, () => {
      assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: null })?.[campo], null);
    });
  }
  for (const campo of ["categoria", "regimen"] as const) {
    test(`rechaza ${campo} no-string / vacío / demasiado largo`, () => {
      assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: 5 }), null);
      assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: "" }), null);
      assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: "x".repeat(121) }), null);
    });
    test(`acepta ${campo} justo en el límite de 120 caracteres`, () => {
      assert.ok(validarComboIdentidad({ ...comboValido(), [campo]: "x".repeat(120) }) != null);
    });
  }
  test("rechaza moneda no-string / vacía / demasiado larga (límite 10)", () => {
    assert.equal(validarComboIdentidad({ ...comboValido(), moneda: 5 }), null);
    assert.equal(validarComboIdentidad({ ...comboValido(), moneda: "" }), null);
    assert.equal(validarComboIdentidad({ ...comboValido(), moneda: "x".repeat(11) }), null);
    assert.ok(validarComboIdentidad({ ...comboValido(), moneda: "x".repeat(10) }) != null);
  });
  for (const campo of ["fecha_ida", "fecha_regreso"] as const) {
    test(`rechaza ${campo} con formato inválido`, () => {
      for (const v of ["2026/12/01", "01-12-2026", "2026-12-1", 20261201, true]) {
        assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: v }), null, JSON.stringify(v));
      }
    });
    test(`rechaza ${campo} que no es un día real del calendario (reusa validarFechaConsulta)`, () => {
      assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: "2026-13-01" }), null);
      assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: "2026-02-30" }), null);
    });
    test(`acepta ${campo} en null`, () => {
      assert.equal(validarComboIdentidad({ ...comboValido(), [campo]: null })?.[campo], null);
    });
  }
  test("rechaza forma no-objeto/null/array", () => {
    for (const v of [null, undefined, "x", 5, true, [comboValido()]]) assert.equal(validarComboIdentidad(v), null);
  });
});

describe("validarCombosPermitidos() — array de combos, acotado y deduplicado", () => {
  test("acepta array vacío (alcance vacío es válido)", () => assert.deepEqual(validarCombosPermitidos([]), []));
  test("acepta un array de combos válidos", () => {
    const r = validarCombosPermitidos([comboValido(), { ...comboValido(), hotel_id: 8 }]);
    assert.equal(r?.length, 2);
  });
  test("rechaza si no es array", () => {
    for (const v of [null, undefined, "x", {}, 5]) assert.equal(validarCombosPermitidos(v), null);
  });
  test("rechaza si CUALQUIER elemento no es un combo válido (todo o nada)", () => {
    assert.equal(validarCombosPermitidos([comboValido(), { modulo: "invalido" }]), null);
  });
  test("⚠️ deduplica por claveCombo — combos idénticos (misma clave estructural) colapsan a uno solo", () => {
    const r = validarCombosPermitidos([comboValido(), { ...comboValido() }, { ...comboValido() }]);
    assert.equal(r?.length, 1);
  });
  test("no deduplica combos con AL MENOS un campo distinto", () => {
    const r = validarCombosPermitidos([comboValido(), { ...comboValido(), categoria: "Suite" }]);
    assert.equal(r?.length, 2);
  });
  test("acepta exactamente el límite (MAX_COMBOS_ALCANCE elementos únicos)", () => {
    const arr = Array.from({ length: MAX_COMBOS_ALCANCE }, (_, i) => ({ ...comboValido(), hotel_id: i + 1 }));
    assert.equal(validarCombosPermitidos(arr)?.length, MAX_COMBOS_ALCANCE);
  });
  test("rechaza un array por encima del límite explícito (antes de deduplicar)", () => {
    const arr = Array.from({ length: MAX_COMBOS_ALCANCE + 1 }, (_, i) => ({ ...comboValido(), hotel_id: i + 1 }));
    assert.equal(validarCombosPermitidos(arr), null);
  });
  test("respeta un límite `max` custom pasado por el caller", () => {
    assert.equal(validarCombosPermitidos([comboValido(), { ...comboValido(), hotel_id: 8 }], 2)?.length, 2);
    assert.equal(validarCombosPermitidos([comboValido(), { ...comboValido(), hotel_id: 8 }, { ...comboValido(), hotel_id: 9 }], 2), null);
  });
});

describe("validarEntradaDetalleHotel() — {modulo, hotelId, combos}", () => {
  test("bloqueo: acepta forma válida con combos", () =>
    assert.deepEqual(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, combos: [comboValido()] }), { modulo: "bloqueo", hotelId: 10, combos: [comboValido()] }));
  test("bloqueo: acepta combos vacío (alcance filtrado a cero combos)", () =>
    assert.deepEqual(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, combos: [] }), { modulo: "bloqueo", hotelId: 10, combos: [] }));
  test("bloqueo: RECHAZA si falta combos — ya no se puede pedir 'todo el hotel' sin declarar el alcance", () =>
    assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10 }), null));
  test("bloqueo: rechaza combos no-array", () =>
    assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, combos: "x" }), null));
  test("bloqueo: rechaza combos con un elemento inválido", () =>
    assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, combos: [comboValido(), { modulo: "invalido" }] }), null));
  test("⚠️ ronda 6 — porcion_terrestre: AHORA TAMBIÉN exige combos (la revisión anterior no exigía ningún alcance para este módulo)", () => {
    assert.equal(validarEntradaDetalleHotel({ modulo: "porcion_terrestre", hotelId: 1 }), null);
    assert.deepEqual(
      validarEntradaDetalleHotel({ modulo: "porcion_terrestre", hotelId: 1, combos: [{ ...comboValido(), modulo: "porcion_terrestre", bloqueo_id: null }] }),
      { modulo: "porcion_terrestre", hotelId: 1, combos: [{ ...comboValido(), modulo: "porcion_terrestre", bloqueo_id: null }] }
    );
  });
  test("porcion_terrestre: acepta combos vacío también", () =>
    assert.deepEqual(validarEntradaDetalleHotel({ modulo: "porcion_terrestre", hotelId: 1, combos: [] }), { modulo: "porcion_terrestre", hotelId: 1, combos: [] }));
  test("rechaza modulo=servicios (Vista Booking nunca abre un hotel de servicios)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "servicios", hotelId: 10, combos: [] }), null));
  test("rechaza modulo=dinamico (no aplica a 'Ver opciones' de hotel)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "dinamico", hotelId: 10, combos: [] }), null));
  test("rechaza hotelId negativo", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: -5, combos: [] }), null));
  test("rechaza hotelId decimal", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 1.5, combos: [] }), null));
  test("rechaza hotelId string (inyección de SQL/operadores como texto)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: "10 OR 1=1", combos: [] }), null));
  test("rechaza null", () => assert.equal(validarEntradaDetalleHotel(null), null));
  test("rechaza undefined", () => assert.equal(validarEntradaDetalleHotel(undefined), null));
  test("rechaza un array", () => assert.equal(validarEntradaDetalleHotel([{ modulo: "bloqueo", hotelId: 10 }]), null));
  test("rechaza un string", () => assert.equal(validarEntradaDetalleHotel("bloqueo:10"), null));
  test("rechaza un número", () => assert.equal(validarEntradaDetalleHotel(10), null));
  test("rechaza objeto vacío", () => assert.equal(validarEntradaDetalleHotel({}), null));
  test("rechaza campo faltante (solo modulo)", () => assert.equal(validarEntradaDetalleHotel({ modulo: "bloqueo" }), null));
  test("rechaza campo faltante (solo hotelId)", () => assert.equal(validarEntradaDetalleHotel({ hotelId: 10 }), null));
  test("tolera campos extra sin usarlos (no filtra por allowlist estricta de claves, pero tampoco los propaga)", () => {
    const r = validarEntradaDetalleHotel({ modulo: "bloqueo", hotelId: 10, combos: [comboValido()], extra: "algo" });
    assert.deepEqual(r, { modulo: "bloqueo", hotelId: 10, combos: [comboValido()] });
  });
});

describe("validarEntradaDetalleSalida() — discriminado por módulo (bloqueoId vs salidaId) + combos", () => {
  test("bloqueo: acepta bloqueoId + combos", () => assert.deepEqual(validarEntradaDetalleSalida({ modulo: "bloqueo", bloqueoId: 5, combos: [] }), { modulo: "bloqueo", bloqueoId: 5, combos: [] }));
  test("dinamico: acepta salidaId + combos", () => assert.deepEqual(validarEntradaDetalleSalida({ modulo: "dinamico", salidaId: 7, combos: [] }), { modulo: "dinamico", salidaId: 7, combos: [] }));
  test("⚠️ ronda 6 — RECHAZA si falta combos (antes no se exigía ningún alcance)", () => {
    assert.equal(validarEntradaDetalleSalida({ modulo: "bloqueo", bloqueoId: 5 }), null);
    assert.equal(validarEntradaDetalleSalida({ modulo: "dinamico", salidaId: 7 }), null);
  });
  test("bloqueo: rechaza si viene salidaId en vez de bloqueoId", () => assert.equal(validarEntradaDetalleSalida({ modulo: "bloqueo", salidaId: 7, combos: [] }), null));
  test("dinamico: rechaza si viene bloqueoId en vez de salidaId", () => assert.equal(validarEntradaDetalleSalida({ modulo: "dinamico", bloqueoId: 7, combos: [] }), null));
  test("rechaza modulo=porcion_terrestre (Vista tabla de salidas no aplica a porción)", () => assert.equal(validarEntradaDetalleSalida({ modulo: "porcion_terrestre", bloqueoId: 5, combos: [] }), null));
  test("rechaza modulo=servicios", () => assert.equal(validarEntradaDetalleSalida({ modulo: "servicios", bloqueoId: 5, combos: [] }), null));
  test("rechaza forma no-objeto", () => assert.equal(validarEntradaDetalleSalida("x"), null));
  test("rechaza null", () => assert.equal(validarEntradaDetalleSalida(null), null));
});

describe("validarEntradaDetallePaquete() — {paqueteId, combos}", () => {
  test("acepta forma válida", () => assert.deepEqual(validarEntradaDetallePaquete({ paqueteId: 3, combos: [] }), { paqueteId: 3, combos: [] }));
  test("⚠️ ronda 6 — RECHAZA si falta combos (antes no se exigía ningún alcance)", () => assert.equal(validarEntradaDetallePaquete({ paqueteId: 3 }), null));
  test("rechaza paqueteId=0", () => assert.equal(validarEntradaDetallePaquete({ paqueteId: 0, combos: [] }), null));
  test("rechaza sin paqueteId", () => assert.equal(validarEntradaDetallePaquete({ combos: [] }), null));
  test("rechaza array", () => assert.equal(validarEntradaDetallePaquete([3]), null));
  test("rechaza combos inválido (todo o nada, incluso con paqueteId válido)", () => assert.equal(validarEntradaDetallePaquete({ paqueteId: 3, combos: "x" }), null));
});
