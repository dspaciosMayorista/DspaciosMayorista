// Moneda de los importes del carrito (lib/cart/monedaCarrito.ts): nunca se
// suman COP y USD en un solo total; los ítems antiguos sin moneda quedan "por
// confirmar"; la previsión explica lo que hará el servidor con un carrito de
// varias monedas (crearCotizacionCarrito en app/tarifario/checkout/actions.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  comisionSobre, formatImporte, monedaDeItem, preverCotizacion, resumirMonedas,
} from "../lib/cart/monedaCarrito.ts";

const hotel = (id: string, precio: number, moneda?: string | null, nombre = `Hotel ${id}`) =>
  ({ id, tipo: "hotel", hotelNombre: nombre, precio, ...(moneda !== undefined ? { moneda } : {}) });
const unidad = (id: string, precio: number, moneda: string | null, nombre = `Unidad ${id}`) =>
  ({ id, tipo: "hotel", modeloTarifario: "unidad", hotelNombre: nombre, precio, moneda });
const tour = (id: string, precio: number, moneda?: string | null, hotelItemId?: string, nombre = `Tour ${id}`) =>
  ({ id, tipo: "tour", nombre, precio, ...(moneda !== undefined ? { moneda } : {}), ...(hotelItemId ? { hotelItemId } : {}) });

describe("monedaDeItem / formatImporte", () => {
  test("normaliza la moneda y no inventa una para ítems antiguos", () => {
    assert.equal(monedaDeItem({ moneda: "usd" }), "USD");
    assert.equal(monedaDeItem({ moneda: " COP " }), "COP");
    assert.equal(monedaDeItem({}), null, "hotel por persona guardado antes del cambio: sin moneda");
    assert.equal(monedaDeItem({ moneda: null }), null);
    assert.equal(monedaDeItem({ moneda: "" }), null);
  });

  test("cada importe en su moneda; sin moneda, sin símbolo y marcado por confirmar", () => {
    assert.match(formatImporte(1_200_000, "COP"), /^\$\s?1\.200\.000$/);
    assert.equal(formatImporte(1_200, "USD"), "USD $1,200");
    assert.equal(formatImporte(1_200_000, null), "1.200.000 · moneda por confirmar");
  });
});

describe("resumirMonedas: total único solo con una moneda conocida", () => {
  test("solo COP: total único en COP", () => {
    const r = resumirMonedas([hotel("h1", 1_200_000, "COP"), tour("t1", 180_000, "COP", "h1")]);
    assert.deepEqual(r.unica, { moneda: "COP", monto: 1_380_000 });
    assert.equal(r.sinMoneda, 0);
  });

  test("solo USD: total único en USD (nunca presentado como pesos)", () => {
    const r = resumirMonedas([hotel("h1", 1_200, "USD"), tour("t1", 180, "USD", "h1")]);
    assert.deepEqual(r.unica, { moneda: "USD", monto: 1_380 });
  });

  test("mixto: un subtotal por moneda en orden de aparición y SIN total único", () => {
    const r = resumirMonedas([hotel("h1", 1_200_000, "COP"), unidad("u1", 900, "USD"), tour("t1", 100, "USD")]);
    assert.equal(r.unica, null);
    assert.deepEqual(r.subtotales, [{ moneda: "COP", monto: 1_200_000, items: 1 }, { moneda: "USD", monto: 1_000, items: 2 }]);
  });

  test("ítem antiguo sin moneda: no entra a ningún subtotal y anula el total único", () => {
    const r = resumirMonedas([hotel("h1", 1_200_000), hotel("h2", 500_000, "COP")]);
    assert.equal(r.unica, null);
    assert.equal(r.sinMoneda, 1);
    assert.deepEqual(r.subtotales, [{ moneda: "COP", monto: 500_000, items: 1 }]);
  });

  test("carrito vacío: nada que totalizar", () => {
    assert.deepEqual(resumirMonedas([]), { subtotales: [], sinMoneda: 0, unica: null });
  });
});

describe("preverCotizacion: refleja la regla del servidor sin decidir nada", () => {
  test("la moneda es la del PRIMER hotel; los hoteles en otra moneda quedan fuera", () => {
    const p = preverCotizacion([hotel("h1", 1_200_000, "COP"), hotel("h2", 900, "USD", "Hotel Dubái")]);
    assert.equal(p.moneda, "COP");
    assert.equal(p.origen, "hotel");
    assert.deepEqual(p.excluidos, [{ id: "h2", etiqueta: "Hotel Dubái", moneda: "USD" }]);
    assert.deepEqual(p.bloqueantes, []);
    assert.equal(p.montoIncluido, 1_200_000);
  });

  test("orden de la solicitud: hoteles por persona antes que por unidad, aunque el de unidad esté primero en el carrito", () => {
    const p = preverCotizacion([unidad("u1", 900, "USD"), hotel("h1", 1_200_000, "COP")]);
    assert.equal(p.moneda, "COP");
    assert.deepEqual(p.excluidos.map((e) => e.id), ["u1"]);
  });

  test("hotel en otra moneda CON servicios vinculados: el servidor rechazaría la solicitud", () => {
    const p = preverCotizacion([hotel("h1", 1_200_000, "COP"), hotel("h2", 900, "USD", "Hotel Dubái"), tour("t1", 80, "USD", "h2")]);
    assert.deepEqual(p.bloqueantes, [{ id: "h2", etiqueta: "Hotel Dubái", moneda: "USD" }]);
    assert.deepEqual(p.excluidos, [], "su servicio vinculado no se lista aparte");
  });

  test("servicio independiente en otra moneda: excluido; servicio vinculado en moneda distinta a su hotel: bloquea", () => {
    const p = preverCotizacion([hotel("h1", 1_200_000, "COP"), tour("t1", 50, "USD"), tour("t2", 60, "USD", "h1", "Tour vinculado")]);
    assert.deepEqual(p.excluidos.map((e) => e.id), ["t1"]);
    assert.deepEqual(p.bloqueantes.map((b) => b.etiqueta), ["Tour vinculado"]);
  });

  test("solo servicios en varias monedas: NO se anticipa moneda, exclusiones ni monto", () => {
    // El primer servicio (USD) puede quedar no disponible al re-liquidar: el
    // servidor lo excluye y el siguiente (COP) fija la moneda. El cliente no
    // lo puede saber, así que no afirma nada.
    const p = preverCotizacion([tour("t1", 50, "USD"), tour("t2", 100_000, "COP")]);
    assert.equal(p.moneda, null);
    assert.equal(p.origen, null);
    assert.equal(p.indeterminada, "servicios");
    assert.deepEqual(p.excluidos, []);
    assert.deepEqual(p.bloqueantes, []);
    assert.equal(p.montoIncluido, null);
  });

  test("solo servicios, todos en la misma moneda: esa moneda es segura", () => {
    const p = preverCotizacion([tour("t1", 50, "USD"), tour("t2", 80, "USD")]);
    assert.equal(p.moneda, "USD");
    assert.equal(p.origen, "servicio");
    assert.equal(p.indeterminada, null);
    assert.deepEqual(p.excluidos, []);
  });

  test("solo servicios con uno sin moneda registrada: no se anticipa", () => {
    const p = preverCotizacion([tour("t1", 50, "USD"), tour("t2", 80)]);
    assert.equal(p.moneda, null);
    assert.equal(p.porConfirmar, 1);
  });

  test("con hoteles, un servicio independiente no cambia la moneda (los hoteles no se saltan)", () => {
    const p = preverCotizacion([tour("t1", 50, "USD"), hotel("h1", 1_200_000, "COP")]);
    assert.equal(p.moneda, "COP");
    assert.equal(p.origen, "hotel");
    assert.deepEqual(p.excluidos.map((e) => e.id), ["t1"]);
  });

  test("si el primer hotel no tiene moneda registrada, no se anticipa nada", () => {
    const p = preverCotizacion([hotel("h1", 1_200_000), hotel("h2", 900, "USD")]);
    assert.equal(p.moneda, null);
    assert.equal(p.indeterminada, "sin_moneda");
    assert.equal(p.montoIncluido, null);
    assert.equal(p.porConfirmar, 1);
  });

  test("con un ítem por confirmar más adelante: moneda conocida pero sin monto estimado", () => {
    const p = preverCotizacion([hotel("h1", 1_200_000, "COP"), hotel("h2", 500_000)]);
    assert.equal(p.moneda, "COP");
    assert.equal(p.montoIncluido, null);
    assert.equal(p.porConfirmar, 1);
  });
});

describe("comisionSobre: comisión B2B de presentación sobre UNA moneda", () => {
  test("COP y USD con el mismo porcentaje", () => {
    assert.deepEqual(comisionSobre(1_380_000, 0.1), { comision: 138_000, neto: 1_242_000 });
    assert.deepEqual(comisionSobre(1_380, 0.1), { comision: 138, neto: 1_242 });
  });
});
