// Reglas puras de los servicios adicionales como SUBELECCIÓN del hotel:
//   · lib/tarifario/servicioAdicionalPaquete.ts — cotización atada a los
//     datos del hotel, identidad exacta paquete+servicio, bloqueo y total;
//   · lib/cart/vinculoServicios.ts — hotel + servicios en una sola
//     actualización, quitar en cascada, sin huérfanos al hidratar.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  alternarSeleccion, claveConsultaServicios, elegirResultadoServicio, evaluarServicios, serviciosParaCarrito,
  type ConsultaServicios, type HotelParaServicios,
} from "../lib/tarifario/servicioAdicionalPaquete.ts";
import { agregarConjunto, agruparCarrito, crearActualizadorConjunto, normalizarVinculos, quitarConVinculos, serviciosDeHotel } from "../lib/cart/vinculoServicios.ts";

function res(paqueteId: number, servicioId: number, total: number, moneda = "COP", pax = 2) {
  return { servicioId, paqueteId, nombre: `S${servicioId}`, destino: "CARTAGENA", descripcion: null, total, pax, noches: 3, moneda, categoria: "tour" as never };
}

const hotel: HotelParaServicios = {
  paqueteId: 10, hotelNombre: "Hotel Uno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, precio: 1_200_000, moneda: "COP", firma: "Estandar|Desayuno",
};
const disponibles = [{ servicioId: 55, nombre: "Islas" }, { servicioId: 56, nombre: "City tour" }, { servicioId: null, nombre: "Sin id" }];
const consultaOk = (h: HotelParaServicios, resultados: ReturnType<typeof res>[]): ConsultaServicios =>
  ({ clave: claveConsultaServicios(h)!, estado: "ok", resultados });

describe("claveConsultaServicios — los datos del hotel mandan", () => {
  test("sin paquete, fechas, pax o precio no hay clave (no se cotiza)", () => {
    assert.equal(claveConsultaServicios({ ...hotel, paqueteId: null }), null);
    assert.equal(claveConsultaServicios({ ...hotel, fechaIda: null }), null);
    assert.equal(claveConsultaServicios({ ...hotel, fechaRegreso: "2030-03-01" }), null);
    assert.equal(claveConsultaServicios({ ...hotel, pax: 0 }), null);
    assert.equal(claveConsultaServicios({ ...hotel, precio: null }), null);
    assert.ok(claveConsultaServicios(hotel));
  });
  test("cambiar fechas, pax, precio, moneda, paquete o firma (categoría/régimen) cambia la clave", () => {
    const base = claveConsultaServicios(hotel);
    for (const cambio of [
      { fechaIda: "2030-03-02" }, { fechaRegreso: "2030-03-05" }, { pax: 3 }, { precio: 1_300_000 },
      { moneda: "USD" }, { paqueteId: 20 }, { firma: "Superior|Desayuno" },
    ] as Partial<HotelParaServicios>[]) {
      assert.notEqual(claveConsultaServicios({ ...hotel, ...cambio }), base, JSON.stringify(cambio));
    }
  });
});

describe("evaluarServicios", () => {
  test("sin servicios seleccionados: listo, total = solo el hotel (el hotel se agrega normal)", () => {
    const ev = evaluarServicios({ hotel, seleccion: [], disponibles, consulta: null });
    assert.equal(ev.listo, true);
    assert.deepEqual(ev.total, { monto: 1_200_000, moneda: "COP" });
  });

  test("un servicio cotizado: desglose y total hotel + servicio con el precio real (no el «desde»)", () => {
    const ev = evaluarServicios({ hotel, seleccion: [55], disponibles, consulta: consultaOk(hotel, [res(10, 55, 180_000)]) });
    assert.equal(ev.listo, true);
    assert.equal(ev.servicios[0].estado, "ok");
    assert.equal(ev.servicios[0].resultado?.total, 180_000);
    assert.deepEqual(ev.total, { monto: 1_380_000, moneda: "COP" });
  });

  test("varios servicios del mismo paquete suman; duplicados en la selección cuentan una vez", () => {
    const ev = evaluarServicios({ hotel, seleccion: [55, 56, 55], disponibles, consulta: consultaOk(hotel, [res(10, 55, 180_000), res(10, 56, 85_000)]) });
    assert.equal(ev.servicios.length, 2);
    assert.deepEqual(ev.total, { monto: 1_465_000, moneda: "COP" });
  });

  test("otro paquete del mismo destino con el mismo servicio NUNCA se usa", () => {
    const ev = evaluarServicios({ hotel, seleccion: [55], disponibles, consulta: consultaOk(hotel, [res(20, 55, 70_000)]) });
    assert.equal(ev.servicios[0].estado, "sin_precio");
    assert.equal(ev.listo, false);
    assert.equal(ev.total, null);
    assert.equal(elegirResultadoServicio([res(20, 55, 1), res(10, 55, 2)], 10, 55)?.total, 2);
  });

  test("precio no disponible: nombra el servicio, bloquea el conjunto y no muestra total", () => {
    const ev = evaluarServicios({ hotel, seleccion: [55, 56], disponibles, consulta: consultaOk(hotel, [res(10, 55, 180_000)]) });
    assert.equal(ev.listo, false);
    assert.equal(ev.total, null);
    assert.equal(ev.servicios.find((s) => s.servicioId === 56)?.estado, "sin_precio");
    assert.match(ev.bloqueo!, /«City tour»/);
    assert.match(ev.servicios[1].mensaje!, /no tiene un precio vigente en este paquete para estas fechas y 2 pasajeros/);
  });

  test("cambiar fechas/pax después de cotizar invalida la cotización: 'cotizando', sin total, bloqueado", () => {
    const consulta = consultaOk(hotel, [res(10, 55, 180_000)]);
    for (const cambio of [{ fechaIda: "2030-03-02" }, { pax: 3 }, { firma: "Superior|Desayuno" }, { precio: 1_250_000 }] as Partial<HotelParaServicios>[]) {
      const ev = evaluarServicios({ hotel: { ...hotel, ...cambio }, seleccion: [55], disponibles, consulta });
      assert.equal(ev.servicios[0].estado, "cotizando", JSON.stringify(cambio));
      assert.equal(ev.listo, false);
      assert.equal(ev.total, null);
    }
  });

  test("hotel sin datos completos: 'faltan_datos' y bloqueado", () => {
    const ev = evaluarServicios({ hotel: { ...hotel, precio: null }, seleccion: [55], disponibles, consulta: null });
    assert.equal(ev.servicios[0].estado, "faltan_datos");
    assert.equal(ev.listo, false);
  });

  test("moneda distinta a la del hotel: incompatible, nunca se suma", () => {
    const ev = evaluarServicios({ hotel, seleccion: [55], disponibles, consulta: consultaOk(hotel, [res(10, 55, 50, "USD")]) });
    assert.equal(ev.servicios[0].estado, "moneda_distinta");
    assert.equal(ev.total, null);
    assert.equal(ev.listo, false);
  });

  test("hotel en USD con servicio en USD: compatible, el total queda en USD", () => {
    const hotelUsd = { ...hotel, precio: 1_200, moneda: "USD" };
    const ev = evaluarServicios({ hotel: hotelUsd, seleccion: [55], disponibles, consulta: consultaOk(hotelUsd, [res(10, 55, 180, "USD")]) });
    assert.equal(ev.servicios[0].estado, "ok");
    assert.equal(ev.listo, true);
    assert.deepEqual(ev.total, { monto: 1_380, moneda: "USD" });
  });

  test("hotel en USD con servicio en COP: incompatible, nunca se suma", () => {
    const hotelUsd = { ...hotel, precio: 1_200, moneda: "USD" };
    const ev = evaluarServicios({ hotel: hotelUsd, seleccion: [55], disponibles, consulta: consultaOk(hotelUsd, [res(10, 55, 180_000, "COP")]) });
    assert.equal(ev.servicios[0].estado, "moneda_distinta");
    assert.match(ev.servicios[0].mensaje ?? "", /está en COP y el hotel en USD/);
    assert.equal(ev.total, null);
    assert.equal(ev.listo, false);
  });

  test("error técnico de la consulta: bloquea con el mensaje del servidor", () => {
    const ev = evaluarServicios({ hotel, seleccion: [55], disponibles, consulta: { clave: claveConsultaServicios(hotel)!, estado: "error", mensaje: "Búsqueda no disponible" } });
    assert.equal(ev.servicios[0].estado, "error");
    assert.equal(ev.listo, false);
  });

  test("servicios para el carrito: solo con evaluación lista, con fechas del hotel y precio real", () => {
    const ev = evaluarServicios({ hotel, seleccion: [55], disponibles, consulta: consultaOk(hotel, [res(10, 55, 180_000)]) });
    assert.deepEqual(serviciosParaCarrito(ev, hotel, { 55: "foto.jpg" }), [{
      tipo: "tour", paqueteId: 10, servicioId: 55, nombre: "S55", destino: "CARTAGENA", fotoUrl: "foto.jpg",
      fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, pax: 2, precio: 180_000, moneda: "COP",
    }]);
    const malo = evaluarServicios({ hotel, seleccion: [55], disponibles, consulta: null });
    assert.deepEqual(serviciosParaCarrito(malo, hotel), []);
  });

  test("alternarSeleccion agrega y quita sin duplicar", () => {
    assert.deepEqual(alternarSeleccion([55], 56), [55, 56]);
    assert.deepEqual(alternarSeleccion([55, 56], 55), [56]);
  });
});

describe("vínculo hotel ↔ servicios en el carrito", () => {
  type It = { id: string; tipo: string; hotelItemId?: string | null; servicioId?: number | null; nombre?: string };
  const otroHotel: It = { id: "h0", tipo: "hotel" };
  const suelto: It = { id: "t0", tipo: "tour", servicioId: 99 };
  const servicios = [{ tipo: "tour", servicioId: 55 }, { tipo: "tour", servicioId: 56 }, { tipo: "tour", servicioId: 55 }];
  const ids = { hotel: "H1", servicios: ["S1", "S2", "S3"] };

  test("agregarConjunto: hotel + servicios en UNA operación, vinculados y sin duplicados", () => {
    const items = agregarConjunto<It>([otroHotel, suelto], { tipo: "hotel" }, servicios, ids);
    assert.deepEqual(items.map((i) => [i.id, i.tipo, i.hotelItemId ?? null]), [
      ["h0", "hotel", null], ["t0", "tour", null], ["H1", "hotel", null], ["S1", "tour", "H1"], ["S2", "tour", "H1"],
    ]);
  });

  test("el actualizador de addConjunto es PURO: ejecutarlo varias veces con el mismo estado da los mismos ids y vínculos", () => {
    const prev: It[] = [otroHotel, suelto];
    const actualizar = crearActualizadorConjunto<It>({ tipo: "hotel" }, servicios, ids);
    const a = actualizar(prev);
    const b = actualizar(prev);
    const c = actualizar(prev);
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
    assert.notEqual(a, b, "cada ejecución devuelve un arreglo nuevo (no muta)");
    assert.deepEqual(prev, [otroHotel, suelto], "no muta el estado anterior");
    assert.deepEqual(serviciosDeHotel(a, "H1").map((x) => x.id), ["S1", "S2"]);
  });

  test("quitar un servicio deja el hotel; quitar el hotel se lleva sus servicios (no el suelto ni otro hotel)", () => {
    const items = agregarConjunto<It>([otroHotel, suelto], { tipo: "hotel" }, servicios, ids);
    const sinUno = quitarConVinculos(items, "S1");
    assert.deepEqual(sinUno.map((i) => i.id), ["h0", "t0", "H1", "S2"]);
    assert.deepEqual(quitarConVinculos(items, "H1").map((i) => i.id), ["h0", "t0"]);
  });

  test("recargar (JSON de localStorage + normalizarVinculos) conserva el conjunto; descarta servicios cuyo hotel no existe", () => {
    const items = agregarConjunto<It>([otroHotel, suelto], { tipo: "hotel" }, servicios, ids);
    const recargado = normalizarVinculos(JSON.parse(JSON.stringify(items)) as It[]);
    assert.deepEqual(recargado, items);
    const conHuerfano: It[] = [...items, { id: "b", tipo: "tour", servicioId: 2, hotelItemId: "fantasma" }];
    assert.deepEqual(normalizarVinculos(conHuerfano).map((i) => i.id), ["h0", "t0", "H1", "S1", "S2"]);
  });

  test("agruparCarrito: cada hotel con sus servicios debajo; tours sueltos como filas propias", () => {
    const items: It[] = [otroHotel, { id: "a", tipo: "tour", servicioId: 1, hotelItemId: "h0" }, suelto];
    const g = agruparCarrito(items);
    assert.deepEqual(g.map((x) => [x.item.id, x.servicios.map((s) => s.id)]), [["h0", ["a"]], ["t0", []]]);
  });
});
