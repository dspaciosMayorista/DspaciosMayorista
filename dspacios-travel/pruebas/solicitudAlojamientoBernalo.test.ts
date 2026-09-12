import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validarSalidaSeleccionadaBernalo,
  validarSolicitudItemBernalo,
  mismaOcupacionBernalo,
  claveOcupacionCompletaBernalo,
  validarCrearSolicitudInput,
  type DecisionesOcupacionBernalo,
} from "../lib/reservar/solicitudAlojamientoBernalo.ts";
import { validarSolicitudItem } from "../lib/reservar/edadesMenores.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-1 Bernalo — contrato de transporte carrito→checkout. Pruebas
// puras (ejecutables), sin Supabase/Next: cubren la lista "Pruebas
// obligatorias" del encargo que corresponden a este módulo. Las pruebas de
// wiring (checkout/actions.ts, computo.ts, CartContext.tsx/CartDrawer.tsx)
// viven en pruebas/checkoutBernaloWiring.test.ts.
// ─────────────────────────────────────────────────────────────────────────

function habitacionBase(id: string, acom: string, adultos: number, edadesMenores: number[]) {
  return { id, acom, adultos, cantidadMenores: edadesMenores.length, edadesMenores };
}

function itemBernaloBase(overrides: Record<string, unknown> = {}) {
  return {
    modeloTarifario: "unidad",
    itemId: "cart-item-1",
    paqueteId: 10, hotelId: 20, hotelNombre: "Hotel Bernalo", destino: "San Andrés",
    categoria: "Estándar", alimentacion: "PC",
    salida: { tipo: "sin_vuelo", fechaIda: "2026-12-01", fechaRegreso: "2026-12-05" },
    habitaciones: [habitacionBase("doble-0", "doble", 2, [])],
    ...overrides,
  };
}

describe("validarSalidaSeleccionadaBernalo — A1: identidad discriminada, nunca [0]", () => {
  test("acepta bloqueo/empaquetado con id entero positivo", () => {
    assert.deepEqual(validarSalidaSeleccionadaBernalo({ tipo: "bloqueo", id: 5 }), { ok: true, salida: { tipo: "bloqueo", id: 5 } });
    assert.deepEqual(validarSalidaSeleccionadaBernalo({ tipo: "empaquetado", id: 7 }), { ok: true, salida: { tipo: "empaquetado", id: 7 } });
  });

  test("acepta sin_vuelo con fechas válidas (ida < regreso)", () => {
    const r = validarSalidaSeleccionadaBernalo({ tipo: "sin_vuelo", fechaIda: "2026-12-01", fechaRegreso: "2026-12-05" });
    assert.equal(r.ok, true);
  });

  test('rechaza un "tipo" que no es ninguno de los tres válidos (test obligatorio 7)', () => {
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "individual", id: 1 }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "dinamico" }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo(null).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo("bloqueo").ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo([1, 2]).ok, false);
  });

  test("rechaza bloqueo/empaquetado sin id o con id no positivo (test obligatorio 7)", () => {
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "bloqueo" }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "bloqueo", id: 0 }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "bloqueo", id: -3 }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "bloqueo", id: 1.5 }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "bloqueo", id: "1" }).ok, false);
  });

  test("rechaza sin_vuelo con fecha inválida o regreso no posterior a la ida (test obligatorio 7)", () => {
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "sin_vuelo", fechaIda: "no-es-fecha", fechaRegreso: "2026-12-05" }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "sin_vuelo", fechaIda: "2026-12-05", fechaRegreso: "2026-12-01" }).ok, false);
    assert.equal(validarSalidaSeleccionadaBernalo({ tipo: "sin_vuelo", fechaIda: "2026-12-01" }).ok, false);
  });
});

describe("validarSolicitudItemBernalo — reconoce la variante y valida forma", () => {
  test("un ítem bien formado valida y conserva TODAS las decisiones", () => {
    const r = validarSolicitudItemBernalo(itemBernaloBase(), 0);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.item.modeloTarifario, "unidad");
      assert.equal(r.item.paqueteId, 10);
      assert.equal(r.item.hotelId, 20);
      assert.equal(r.item.categoria, "Estándar");
      assert.equal(r.item.alimentacion, "PC");
      assert.deepEqual(r.item.salida, { tipo: "sin_vuelo", fechaIda: "2026-12-01", fechaRegreso: "2026-12-05" });
      assert.equal(r.item.habitaciones.length, 1);
    }
  });

  test("rechaza forma inválida sin lanzar (null, arreglo, texto, número, paqueteId no entero)", () => {
    for (const v of [null, undefined, "item", 42, [], {}, itemBernaloBase({ paqueteId: "10" })]) {
      assert.doesNotThrow(() => validarSolicitudItemBernalo(v, 0));
      assert.equal(validarSolicitudItemBernalo(v, 0).ok, false);
    }
  });

  test("rechaza si la salida embebida es inválida", () => {
    const r = validarSolicitudItemBernalo(itemBernaloBase({ salida: { tipo: "individual" } }), 0);
    assert.equal(r.ok, false);
  });

  test("rechaza si las habitaciones vienen vacías o mal formadas (reutiliza validarHabitacionesOcupacion, Fase 3D)", () => {
    assert.equal(validarSolicitudItemBernalo(itemBernaloBase({ habitaciones: [] }), 0).ok, false);
    assert.equal(validarSolicitudItemBernalo(itemBernaloBase({ habitaciones: [{ id: "x" }] }), 0).ok, false);
  });

  // ── Test obligatorio 2: serializa/deserializa sin perder asociación habitación↔edad ──
  // El round-trip real (carrito → localStorage/HTTP → servidor) serializa el
  // WIRE format (`HabitacionOcupacionEntrada`, con `cantidadMenores` —
  // transportado a propósito como defensa, ver ocupacionPorHabitacion.ts),
  // nunca el ítem YA VALIDADO (`HabitacionOcupacionValidada` no lleva
  // `cantidadMenores`: es un campo derivado, no se re-postea tal cual).
  test("round-trip JSON del WIRE format: la asociación habitación↔edad sobrevive intacta", () => {
    const crudo = itemBernaloBase({
      habitaciones: [
        habitacionBase("doble-0", "doble", 2, [5, 8]),
        habitacionBase("triple-0", "triple", 2, [3]),
      ],
    });
    const r1 = validarSolicitudItemBernalo(crudo, 0);
    assert.equal(r1.ok, true);

    // Simula el transporte real: el WIRE crudo (lo que arma el carrito) pasa
    // por JSON.stringify/parse (localStorage o body HTTP) ANTES de validar.
    const crudoSerializado = JSON.parse(JSON.stringify(crudo));
    const r2 = validarSolicitudItemBernalo(crudoSerializado, 0);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;

    assert.deepEqual(r2.item, r1.item);
    assert.equal(r2.item.habitaciones.length, 2);
    const doble = r2.item.habitaciones.find((h) => h.id === "doble-0")!;
    const triple = r2.item.habitaciones.find((h) => h.id === "triple-0")!;
    assert.deepEqual(doble.edadesMenores, [5, 8]);
    assert.deepEqual(triple.edadesMenores, [3]);
  });

  // ── Test obligatorio 3: dos habitaciones con niños permanecen separadas ──
  test("dos habitaciones con menores NUNCA se aplanan en un solo arreglo de edades", () => {
    const r = validarSolicitudItemBernalo(
      itemBernaloBase({
        habitaciones: [
          habitacionBase("doble-0", "doble", 2, [4, 9]),
          habitacionBase("doble-1", "doble", 2, [11]),
        ],
      }),
      0
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.item.habitaciones.length, 2);
    // Cada habitación conserva SOLO sus propias edades — nunca las 3 edades
    // mezcladas en una sola habitación ni repartidas de otra forma.
    const edadesPorHabitacion = r.item.habitaciones.map((h) => [h.id, h.edadesMenores.slice().sort()]);
    assert.deepEqual(edadesPorHabitacion, [
      ["doble-0", [4, 9]],
      ["doble-1", [11]],
    ]);
  });

  // ── Test obligatorio 4/8: precio/costos/neto/comisión/snapshot no se propagan ──
  // Fase 3F-4A: `precio`/`moneda` SÍ sobreviven, pero renombrados a
  // `precioDeclarado`/`monedaDeclarada` — nunca bajo su nombre crudo (para
  // que nadie los confunda con autoridad de precio) y nunca usados para
  // calcular nada dentro de este módulo (ver la nota del tipo). El resto de
  // campos de dinero/costeo interno sigue completamente prohibido.
  test("un payload con costoNeto/totalNeto/comisionPct/snapshot/payload/markup NUNCA aparece en el ítem validado; precio/moneda solo sobreviven renombrados", () => {
    const crudo = itemBernaloBase({
      precio: 999_999_999, moneda: "USD", costoNeto: 1, totalNeto: 2, totalBruto: 3,
      comisionPct: 50, valorComision: 4, snapshot: { fraude: true }, payload: { x: 1 }, markup: 0.9,
    });
    const r = validarSolicitudItemBernalo(crudo, 0);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const claves = Object.keys(r.item);
    for (const prohibida of ["precio", "moneda", "costoNeto", "totalNeto", "totalBruto", "comisionPct", "valorComision", "snapshot", "payload", "markup"]) {
      assert.ok(!claves.includes(prohibida), `"${prohibida}" no debería sobrevivir en el ítem validado`);
    }
    assert.deepEqual(
      claves.sort(),
      ["alimentacion", "categoria", "destino", "habitaciones", "hotelId", "hotelNombre", "itemId", "modeloTarifario", "monedaDeclarada", "paqueteId", "precioDeclarado", "salida"].sort()
    );
    assert.equal(r.item.precioDeclarado, 999_999_999);
    assert.equal(r.item.monedaDeclarada, "USD");
  });

  // ── Cierre 3F-4A #1: itemId — correlación, nunca autorización ──
  test("itemId es OBLIGATORIO: sin él (o con forma inválida) el ítem se rechaza", () => {
    for (const v of [{ itemId: undefined }, { itemId: null }, { itemId: "" }, { itemId: 123 }, { itemId: {} }]) {
      const r = validarSolicitudItemBernalo(itemBernaloBase(v), 0);
      assert.equal(r.ok, false, `itemId=${JSON.stringify(v.itemId)} debería rechazarse`);
    }
  });

  test("itemId se conserva TAL CUAL — nunca se normaliza/regenera ni se usa para nada más que transportarlo", () => {
    const r = validarSolicitudItemBernalo(itemBernaloBase({ itemId: "abc-123-XYZ" }), 0);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.itemId, "abc-123-XYZ");
  });

  test("dos ítems con el MISMO paqueteId/hotelId pero itemId distinto validan como entradas independientes", () => {
    const r1 = validarSolicitudItemBernalo(itemBernaloBase({ itemId: "cart-item-A" }), 0);
    const r2 = validarSolicitudItemBernalo(itemBernaloBase({ itemId: "cart-item-B" }), 1);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    assert.notEqual(r1.item.itemId, r2.item.itemId);
    assert.equal(r1.item.paqueteId, r2.item.paqueteId);
    assert.equal(r1.item.hotelId, r2.item.hotelId);
  });

  // ── Fase 3F-4A: precioDeclarado/monedaDeclarada — comparación, no autoridad ──
  test("precioDeclarado/monedaDeclarada caen a null cuando el body no los trae o vienen con forma inválida (nunca inventan un número)", () => {
    const sinPrecio = validarSolicitudItemBernalo(itemBernaloBase(), 0);
    assert.equal(sinPrecio.ok, true);
    if (sinPrecio.ok) {
      assert.equal(sinPrecio.item.precioDeclarado, null);
      assert.equal(sinPrecio.item.monedaDeclarada, null);
    }

    const formaInvalida = validarSolicitudItemBernalo(itemBernaloBase({ precio: "1000", moneda: 123, }), 0);
    assert.equal(formaInvalida.ok, true);
    if (formaInvalida.ok) {
      assert.equal(formaInvalida.item.precioDeclarado, null);
      assert.equal(formaInvalida.item.monedaDeclarada, null);
    }

    const noFinito = validarSolicitudItemBernalo(itemBernaloBase({ precio: Number.POSITIVE_INFINITY, moneda: "  " }), 0);
    assert.equal(noFinito.ok, true);
    if (noFinito.ok) {
      assert.equal(noFinito.item.precioDeclarado, null);
      assert.equal(noFinito.item.monedaDeclarada, null);
    }
  });
});

describe("mismaOcupacionBernalo — comparación completa (salida + composición de habitaciones)", () => {
  function decisiones(overrides: Partial<DecisionesOcupacionBernalo> = {}): DecisionesOcupacionBernalo {
    return {
      paqueteId: 10, hotelId: 20, categoria: "Estándar", alimentacion: "PC",
      salida: { tipo: "sin_vuelo", fechaIda: "2026-12-01", fechaRegreso: "2026-12-05" },
      habitaciones: [
        { id: "doble-0", acom: "doble" as never, adultos: 2, edadesMenores: [5] },
        { id: "triple-0", acom: "triple" as never, adultos: 3, edadesMenores: [] },
      ],
      ...overrides,
    };
  }

  // ── Test obligatorio 6: misma composición exacta se reconoce como igual ──
  test("misma composición exacta (incluso con habitaciones/edades en otro orden) es la MISMA ocupación", () => {
    const a = decisiones();
    const b = decisiones({
      habitaciones: [
        { id: "triple-0", acom: "triple" as never, adultos: 3, edadesMenores: [] },
        { id: "doble-0", acom: "doble" as never, adultos: 2, edadesMenores: [5] },
      ],
    });
    assert.equal(mismaOcupacionBernalo(a, b), true);
    assert.equal(claveOcupacionCompletaBernalo(a), claveOcupacionCompletaBernalo(b));
  });

  test("las edades DENTRO de una habitación se normalizan por orden (no cambia la identidad real)", () => {
    const a = decisiones({ habitaciones: [{ id: "doble-0", acom: "doble" as never, adultos: 2, edadesMenores: [8, 3] }] });
    const b = decisiones({ habitaciones: [{ id: "doble-0", acom: "doble" as never, adultos: 2, edadesMenores: [3, 8] }] });
    assert.equal(mismaOcupacionBernalo(a, b), true);
  });

  // ── Test obligatorio 5: dos composiciones distintas NUNCA colisionan ──
  test("una sola edad distinta en una sola habitación ya es una ocupación DISTINTA", () => {
    const a = decisiones();
    const b = decisiones({ habitaciones: [{ id: "doble-0", acom: "doble" as never, adultos: 2, edadesMenores: [6] }, { id: "triple-0", acom: "triple" as never, adultos: 3, edadesMenores: [] }] });
    assert.equal(mismaOcupacionBernalo(a, b), false);
  });

  test("distinta salida (mismas habitaciones) es una ocupación DISTINTA", () => {
    const a = decisiones();
    const b = decisiones({ salida: { tipo: "bloqueo", id: 99 } });
    assert.equal(mismaOcupacionBernalo(a, b), false);
  });

  test("distinta categoría/alimentación/paquete/hotel (misma salida y habitaciones) es una ocupación DISTINTA", () => {
    const a = decisiones();
    assert.equal(mismaOcupacionBernalo(a, decisiones({ categoria: "Suite" })), false);
    assert.equal(mismaOcupacionBernalo(a, decisiones({ alimentacion: "PAM" })), false);
    assert.equal(mismaOcupacionBernalo(a, decisiones({ paqueteId: 11 })), false);
    assert.equal(mismaOcupacionBernalo(a, decisiones({ hotelId: 21 })), false);
  });

  test("distinta CANTIDAD de habitaciones (una tiene una habitación extra) es una ocupación DISTINTA", () => {
    const a = decisiones({ habitaciones: [{ id: "doble-0", acom: "doble" as never, adultos: 2, edadesMenores: [] }] });
    const b = decisiones({ habitaciones: [{ id: "doble-0", acom: "doble" as never, adultos: 2, edadesMenores: [] }, { id: "doble-1", acom: "doble" as never, adultos: 2, edadesMenores: [] }] });
    assert.equal(mismaOcupacionBernalo(a, b), false);
  });
});

describe("validarCrearSolicitudInput — despacha entre persona y Bernalo por ítem (unión discriminada real)", () => {
  const clienteValido = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "a@b.co" };

  test("un carrito con un ítem persona y un ítem Bernalo valida ambos y conserva su forma propia", () => {
    const itemPersona = {
      modulo: "bloqueo", paqueteId: 1, hotelId: 2, bloqueoId: 3, hotelNombre: "Hotel Persona", destino: "Cartagena",
      categoria: "Estándar", regimen: "PC", fechaIda: null, fechaRegreso: null, noches: 3,
      habitaciones: { doble: 1 }, cantidadMenores: 0, edadesMenores: [],
    };
    const r = validarCrearSolicitudInput({ items: [itemPersona, itemBernaloBase()], tours: [], cliente: clienteValido });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.input.items.length, 2);
    assert.equal(r.input.items[0].modeloTarifario, undefined);
    assert.equal(r.input.items[1].modeloTarifario, "unidad");
  });

  test("un ítem Bernalo mal formado bloquea TODA la solicitud (mismo criterio fail-closed que un ítem persona inválido)", () => {
    const r = validarCrearSolicitudInput({ items: [itemBernaloBase({ salida: { tipo: "individual" } })], tours: [], cliente: clienteValido });
    assert.equal(r.ok, false);
  });

  test("un ítem persona SIN modeloTarifario (legado, sin la clave en absoluto) se valida exactamente como antes (validarSolicitudItem)", () => {
    const itemPersona = {
      modulo: "bloqueo", paqueteId: 1, hotelId: 2, bloqueoId: 3, hotelNombre: "Hotel Legado", destino: "Cartagena",
      categoria: "Estándar", regimen: "PC", fechaIda: null, fechaRegreso: null, noches: 3,
      habitaciones: { doble: 1 }, cantidadMenores: 0, edadesMenores: [],
    };
    const rDirecto = validarSolicitudItem(itemPersona, 0);
    const rViaDespacho = validarCrearSolicitudInput({ items: [itemPersona], tours: [], cliente: clienteValido });
    assert.equal(rDirecto.ok, true);
    assert.equal(rViaDespacho.ok, true);
    if (rDirecto.ok && rViaDespacho.ok) {
      assert.deepEqual(rViaDespacho.input.items[0], rDirecto.item);
    }
  });
});
