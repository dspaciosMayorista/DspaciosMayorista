import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  construirAddonsIntentDesdeItem,
  construirAddonsIntentDesdeCarrito,
  type ItemCarritoAddons,
  type ItemHotelPersonaAddons,
  type ItemHotelUnidadAddons,
} from "../lib/cart/addonsIntent.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no wiring) de la construcción del "AddonsIntent" que
// precarga Receptivos al pulsar "+ Agregar servicios / tours" desde el
// carrito.
//
// Causa confirmada del defecto: `CartDrawer.irAAgregarTours` filtraba
// EXCLUSIVAMENTE `HotelCartItemPersona` (`i.modeloTarifario !== "unidad"`) —
// un carrito con SOLO un hotel unidad ("Hotel Prueba Odair") dejaba `ref`
// como `undefined`, se llamaba `setAddonsIntent(null)` como si hubiera
// funcionado, y el drawer se cerraba sin ninguna navegación.
// ─────────────────────────────────────────────────────────────────────────

function itemPersona(over: Partial<ItemHotelPersonaAddons> = {}): ItemHotelPersonaAddons {
  return {
    tipo: "hotel",
    modeloTarifario: undefined,
    paqueteId: 10,
    destino: "CARTAGENA",
    fechaIda: "2026-12-01",
    fechaRegreso: "2026-12-04",
    pax: 2,
    ...over,
  };
}

function itemUnidadSinVuelo(over: Partial<ItemHotelUnidadAddons> = {}): ItemHotelUnidadAddons {
  return {
    tipo: "hotel",
    modeloTarifario: "unidad",
    paqueteId: 20,
    destino: "CARTAGENA",
    salida: { tipo: "sin_vuelo", fechaIda: "2026-12-01", fechaRegreso: "2026-12-04" },
    habitaciones: [{ adultos: 2, edadesMenores: [] }],
    ...over,
  };
}

describe("construirAddonsIntentDesdeItem — hotel PERSONA conserva el comportamiento actual", () => {
  test("destino/fechaIda/fechaRegreso/pax se conservan tal cual (nunca precio ni datos financieros)", () => {
    const intent = construirAddonsIntentDesdeItem(itemPersona());
    assert.deepEqual(intent, { paqueteId: 10, destino: "CARTAGENA", fechaIda: "2026-12-01", fechaRegreso: "2026-12-04", pax: 2 });
  });

  test("sin destino, sin fechas o con pax inválido (0/negativo/decimal) → null (referencia no utilizable)", () => {
    assert.equal(construirAddonsIntentDesdeItem(itemPersona({ destino: null })), null);
    assert.equal(construirAddonsIntentDesdeItem(itemPersona({ destino: "" })), null);
    assert.equal(construirAddonsIntentDesdeItem(itemPersona({ fechaIda: null })), null);
    assert.equal(construirAddonsIntentDesdeItem(itemPersona({ fechaRegreso: null })), null);
    assert.equal(construirAddonsIntentDesdeItem(itemPersona({ pax: 0 })), null);
    assert.equal(construirAddonsIntentDesdeItem(itemPersona({ pax: -1 })), null);
    assert.equal(construirAddonsIntentDesdeItem(itemPersona({ pax: 2.5 })), null);
  });

  // ── Requisito 1/3 del fix "add-ons propios reemplazados por el catálogo
  // general del destino": el intent transporta paqueteId, normalizado como
  // entero positivo en la frontera pública (item.paqueteId llega `unknown`,
  // como cualquier otro campo persistido en localStorage). ──────────────────
  test("PAQUETE ID: se conserva tal cual cuando es un entero positivo real", () => {
    const intent = construirAddonsIntentDesdeItem(itemPersona({ paqueteId: 77 }));
    assert.equal(intent!.paqueteId, 77);
  });

  test("PAQUETE ID inválido (0, negativo, decimal, string, null, undefined, NaN, objeto) → el ítem completo se descarta como referencia (null)", () => {
    const invalidos: unknown[] = [0, -1, 2.5, "10", null, undefined, NaN, Infinity, {}, [10]];
    for (const paqueteId of invalidos) {
      assert.equal(
        construirAddonsIntentDesdeItem(itemPersona({ paqueteId })),
        null,
        `paqueteId=${JSON.stringify(paqueteId)} debería descartar el ítem`
      );
    }
  });
});

describe("construirAddonsIntentDesdeItem — hotel UNIDAD (sin_vuelo) construye destino/fechas/pax correctamente", () => {
  test("destino del ítem + fechas de salida.fechaIda/fechaRegreso + pax = adultos + edadesMenores de TODAS las habitaciones", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({
      habitaciones: [
        { adultos: 2, edadesMenores: [] },
        { adultos: 1, edadesMenores: [7] },
      ],
    }));
    assert.deepEqual(intent, { paqueteId: 20, destino: "CARTAGENA", fechaIda: "2026-12-01", fechaRegreso: "2026-12-04", pax: 4 });
  });

  test("DOS adultos + UN menor de 8 años → pax 3, NUNCA 8 (no confunde la edad del menor con un conteo)", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({
      habitaciones: [{ adultos: 2, edadesMenores: [8] }],
    }));
    assert.ok(intent);
    assert.equal(intent!.pax, 3);
    assert.notEqual(intent!.pax, 8);
  });

  test("varias habitaciones con varios menores suman adultos + CADA edad (nunca solo la cantidad de habitaciones)", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({
      habitaciones: [
        { adultos: 2, edadesMenores: [5, 9] },
        { adultos: 2, edadesMenores: [3] },
      ],
    }));
    assert.equal(intent!.pax, 2 + 2 + 2 + 1); // 2 hab de 2 adultos + 3 menores
  });

  test("edadesMenores no-array o con valores no numéricos no rompe: se cuenta como 0 menores en esa habitación (fail-closed, nunca lanza)", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({
      habitaciones: [{ adultos: 2, edadesMenores: "no-es-un-array" as unknown }],
    }));
    assert.equal(intent!.pax, 2);
    const intent2 = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({
      habitaciones: [{ adultos: 2, edadesMenores: [7, null, "x", undefined] as unknown }],
    }));
    assert.equal(intent2!.pax, 3); // 2 adultos + solo el 7 (el resto se descarta)
  });

  test("pax total <= 0 (sin adultos ni menores) → null", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({ habitaciones: [] }));
    assert.equal(intent, null);
  });

  test("sin destino → null", () => {
    assert.equal(construirAddonsIntentDesdeItem(itemUnidadSinVuelo({ destino: null })), null);
  });

  // ── Requisito 1/2/3: hotel UNIDAD también transporta/valida paqueteId ──────
  test("PAQUETE ID: se conserva tal cual cuando es un entero positivo real", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({ paqueteId: 88 }));
    assert.equal(intent!.paqueteId, 88);
  });

  test("PAQUETE ID inválido (0, negativo, decimal, string, null, undefined, NaN, objeto) → el ítem completo se descarta como referencia (null), igual que persona", () => {
    const invalidos: unknown[] = [0, -1, 2.5, "20", null, undefined, NaN, Infinity, {}, [20]];
    for (const paqueteId of invalidos) {
      assert.equal(
        construirAddonsIntentDesdeItem(itemUnidadSinVuelo({ paqueteId })),
        null,
        `paqueteId=${JSON.stringify(paqueteId)} debería descartar el ítem`
      );
    }
  });
});

describe("construirAddonsIntentDesdeItem — salida bloqueo/empaquetado NUNCA inventa fechas (falla cerrado)", () => {
  test("salida.tipo === 'bloqueo' (solo trae id, sin fechas propias en el ítem) → null, no se inventa nada", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({ salida: { tipo: "bloqueo", id: 42 } }));
    assert.equal(intent, null);
  });

  test("salida.tipo === 'empaquetado' → null, no se inventa nada", () => {
    const intent = construirAddonsIntentDesdeItem(itemUnidadSinVuelo({ salida: { tipo: "empaquetado", id: 7 } }));
    assert.equal(intent, null);
  });
});

describe("construirAddonsIntentDesdeItem — tours nunca participan como referencia", () => {
  test("un ítem tipo:'tour' siempre produce null", () => {
    assert.equal(construirAddonsIntentDesdeItem({ tipo: "tour" }), null);
  });
});

describe("construirAddonsIntentDesdeCarrito — elige el hotel MÁS RECIENTE compatible, sin priorizar ningún modelo", () => {
  test("hotel unidad como ÚNICO hotel del carrito funciona (el defecto real: antes quedaba undefined)", () => {
    const carrito: ItemCarritoAddons[] = [itemUnidadSinVuelo({ destino: "CARTAGENA" })];
    const intent = construirAddonsIntentDesdeCarrito(carrito);
    assert.deepEqual(intent, { paqueteId: 20, destino: "CARTAGENA", fechaIda: "2026-12-01", fechaRegreso: "2026-12-04", pax: 2 });
  });

  test("con varios hoteles usa el MÁS RECIENTE (último del arreglo) compatible — persona más reciente que unidad", () => {
    const carrito: ItemCarritoAddons[] = [
      itemUnidadSinVuelo({ destino: "SAN ANDRÉS", habitaciones: [{ adultos: 2, edadesMenores: [] }] }),
      itemPersona({ destino: "CARTAGENA", pax: 5 }),
    ];
    const intent = construirAddonsIntentDesdeCarrito(carrito);
    assert.equal(intent!.destino, "CARTAGENA");
    assert.equal(intent!.pax, 5);
  });

  test("con varios hoteles usa el MÁS RECIENTE aunque sea unidad — nunca prioriza persona por ser persona", () => {
    const carrito: ItemCarritoAddons[] = [
      itemPersona({ destino: "SANTA MARTA", pax: 5 }),
      itemUnidadSinVuelo({ destino: "CARTAGENA", habitaciones: [{ adultos: 2, edadesMenores: [8] }] }),
    ];
    const intent = construirAddonsIntentDesdeCarrito(carrito);
    assert.equal(intent!.destino, "CARTAGENA");
    assert.equal(intent!.pax, 3);
  });

  test("el hotel más reciente es INCOMPATIBLE (bloqueo sin fechas) → sigue buscando hacia atrás, usa el siguiente compatible", () => {
    const carrito: ItemCarritoAddons[] = [
      itemPersona({ destino: "SANTA MARTA", pax: 4 }),
      itemUnidadSinVuelo({ salida: { tipo: "bloqueo", id: 1 } }), // el más reciente, pero sin fechas
    ];
    const intent = construirAddonsIntentDesdeCarrito(carrito);
    assert.equal(intent!.destino, "SANTA MARTA");
    assert.equal(intent!.pax, 4);
  });

  // ── Requisito "paquete A y paquete B del mismo destino no mezclan
  // servicios": a nivel de intent, esto significa que el paqueteId elegido es
  // SIEMPRE el del hotel que realmente ganó la referencia — nunca el de otro
  // ítem del mismo carrito, aunque compartan destino. ────────────────────────
  test("dos hoteles del MISMO destino pero de paquetes DISTINTOS (A y B) — el intent lleva el paqueteId del hotel elegido, nunca el del otro", () => {
    const carritoAGana: ItemCarritoAddons[] = [
      itemPersona({ paqueteId: 111, destino: "CARTAGENA", pax: 2 }), // paquete A, más antiguo
      itemPersona({ paqueteId: 222, destino: "CARTAGENA", pax: 3 }), // paquete B, más reciente → gana
    ];
    const intentB = construirAddonsIntentDesdeCarrito(carritoAGana);
    assert.equal(intentB!.paqueteId, 222);
    assert.notEqual(intentB!.paqueteId, 111);

    const carritoBIncompatible: ItemCarritoAddons[] = [
      itemPersona({ paqueteId: 111, destino: "CARTAGENA", pax: 2 }), // paquete A, único compatible
      itemUnidadSinVuelo({ paqueteId: 222, destino: "CARTAGENA", salida: { tipo: "bloqueo", id: 9 } }), // paquete B, más reciente pero SIN fechas
    ];
    const intentA = construirAddonsIntentDesdeCarrito(carritoBIncompatible);
    assert.equal(intentA!.paqueteId, 111); // cae al paquete A, nunca inventa/mezcla con el 222 descartado
  });

  test("tours en el carrito nunca participan como referencia, ni siendo los más recientes", () => {
    const carrito: ItemCarritoAddons[] = [
      itemPersona({ destino: "CARTAGENA", pax: 2 }),
      { tipo: "tour" },
      { tipo: "tour" },
    ];
    const intent = construirAddonsIntentDesdeCarrito(carrito);
    assert.equal(intent!.destino, "CARTAGENA");
  });

  test("ningún hotel del carrito produce un intent válido (todos incompatibles, o solo hay tours, o el carrito está vacío) → null", () => {
    assert.equal(construirAddonsIntentDesdeCarrito([]), null);
    assert.equal(construirAddonsIntentDesdeCarrito([{ tipo: "tour" }]), null);
    assert.equal(
      construirAddonsIntentDesdeCarrito([itemUnidadSinVuelo({ salida: { tipo: "bloqueo", id: 1 } })]),
      null
    );
    assert.equal(
      construirAddonsIntentDesdeCarrito([itemPersona({ destino: null }), itemUnidadSinVuelo({ destino: null })]),
      null
    );
  });

  test("no muta el arreglo de entrada", () => {
    const carrito: ItemCarritoAddons[] = [itemPersona(), itemUnidadSinVuelo()];
    const copia = [...carrito];
    construirAddonsIntentDesdeCarrito(carrito);
    assert.deepEqual(carrito, copia);
  });
});
