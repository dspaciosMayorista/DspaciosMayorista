import { test } from "node:test";
import assert from "node:assert/strict";
import { serviciosParaCarrito, type EvaluacionServicios } from "../lib/tarifario/servicioAdicionalPaquete.ts";

const ev = (requiereHora?: string[]): EvaluacionServicios => ({
  listo: true, bloqueo: null, total: null, ...(requiereHora ? { referencial: true } : {}),
  servicios: [{
    servicioId: 1, nombre: "Traslado", estado: "ok", mensaje: null,
    resultado: { paqueteId: 9, servicioId: 1, nombre: "Traslado", destino: null, noches: 3, pax: 2, total: 100, moneda: "COP", ...(requiereHora ? { requiereHora } : {}) } as never,
  }],
});
const hotel = { paqueteId: 9, fechaIda: "2026-12-01", fechaRegreso: "2026-12-04", pax: 2, precio: 500, moneda: "COP", firma: "x" } as never;

test("traslado con hora pendiente entra al carrito marcado como referencial", () => {
  assert.equal(serviciosParaCarrito(ev(["llegada"]), hotel)[0].referencial, true);
});
test("traslado sin franjas pendientes no lleva la marca", () => {
  assert.equal("referencial" in serviciosParaCarrito(ev(), hotel)[0], false);
});
