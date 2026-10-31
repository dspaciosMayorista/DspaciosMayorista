import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarServicios, serviciosParaCarrito, type ConsultaServicios, type HotelParaServicios } from "../lib/tarifario/servicioAdicionalPaquete.ts";
import { claveConsultaServicios } from "../lib/tarifario/servicioAdicionalPaquete.ts";
import { hayHoraPendiente } from "../lib/cart/horaPendiente.ts";

const hotel: HotelParaServicios = { paqueteId: 9, hotelNombre: "H", fechaIda: "2026-12-01", fechaRegreso: "2026-12-04", pax: 2, precio: 500, moneda: "COP", firma: "x" };
const consulta = (requiereHora?: string[]): ConsultaServicios => ({
  clave: claveConsultaServicios(hotel) as string, estado: "ok",
  resultados: [{ paqueteId: 9, servicioId: 1, nombre: "Traslado", destino: null, noches: 3, pax: 2, total: 100, moneda: "COP", ...(requiereHora ? { requiereHora } : {}) } as never],
});
const evaluar = (c: ConsultaServicios) => evaluarServicios({ hotel, seleccion: [1], disponibles: [{ servicioId: 1, nombre: "Traslado" }], consulta: c });

test("traslado con hora pendiente NO se puede agregar al carrito (ni como «desde»)", () => {
  const ev = evaluar(consulta(["llegada"]));
  assert.equal(ev.servicios[0].estado, "hora_pendiente");
  assert.equal(ev.listo, false);
  assert.equal(ev.total, null);
  assert.match(ev.bloqueo ?? "", /hora de llegada o salida/);
  assert.deepEqual(serviciosParaCarrito(ev, hotel), []);
});
test("traslado sin franjas pendientes entra normal", () => {
  const ev = evaluar(consulta());
  assert.equal(ev.listo, true);
  assert.equal(serviciosParaCarrito(ev, hotel).length, 1);
});
test("un carrito guardado con un traslado referencial queda bloqueado", () => {
  assert.equal(hayHoraPendiente([{ tipo: "hotel" }, { tipo: "tour", referencial: true }]), true);
  assert.equal(hayHoraPendiente([{ tipo: "tour" }]), false);
});

test("el recorrido del vuelo forma parte de la clave de cotización", () => {
  const a = claveConsultaServicios({ ...hotel, recorrido: { modulo: "bloqueo", bloqueoId: 5 } });
  const b = claveConsultaServicios({ ...hotel, recorrido: { modulo: "bloqueo", bloqueoId: 6 } });
  assert.notEqual(a, b);
  assert.notEqual(a, claveConsultaServicios(hotel));
});
