import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveHuellaIncluidos, incluidosParaPayload, validarIncluidosConversion } from "../lib/reservar/incluidosCotizados.ts";
import type { ServicioEfectivo } from "../lib/reservar/serviciosPaquete.ts";

// Un incluido sin tarifa vigente se OMITE al cotizar. La conversión recalcula en el servidor y compara con lo cotizado: si la composición (servicios) o el costo ya no
// coincide, rechaza y pide cotizar de nuevo — nunca sustituye en silencio una venta anterior.
const clave = claveHuellaIncluidos("llave-de-prueba")!;
const ref = "h1";
const srv = (servicioId: number, nombre: string, costoNeto: number): ServicioEfectivo => ({ servicioId, nombre, categoria: "otro", incluido: true, costoNeto, proveedorId: 7 });
const item = { ref, paqueteId: 73, pax: 2 };
const fechas = { ida: "2026-12-01", regreso: "2026-12-02" };
const recalculo = (incluidos: ServicioEfectivo[]) => ({ totalPax: 2, fechaIda: "2026-12-01", fechaRegreso: "2026-12-02", incluidos });
const validar = (cotizados: ServicioEfectivo[], actuales: ServicioEfectivo[]) => validarIncluidosConversion({
  hotelNombre: "Hotel", item, fechasCotizadas: fechas, recalculo: recalculo(actuales),
  guardados: incluidosParaPayload(cotizados, { ref, paqueteId: 73 }, clave), clave,
});

describe("conversión de una cotización con incluidos omitidos", () => {
  test("cotizado SIN el servicio omitido y recalculado igual (sigue sin tarifa): convierte, sin servicio, sin costo ni CxP", () => {
    const r = validar([], []);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.incluidos, []);
  });
  test("cotizado CON el servicio y hoy ya no tiene tarifa vigente (se omitiría): se rechaza, no se quita en silencio", () => {
    const r = validar([srv(112, "Servicio 112", 87000)], []);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /servicios incluidos del paquete cambiaron/);
  });
  test("cotizado SIN el servicio y hoy sí tiene tarifa (se agregaría): se rechaza, no se agrega en silencio", () => {
    const r = validar([], [srv(112, "Servicio 112", 87000)]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /servicios incluidos del paquete cambiaron/);
  });
  test("mismo servicio pero con otro costo neto: se rechaza (no se sustituye)", () => {
    const r = validar([srv(112, "Servicio 112", 87000)], [srv(112, "Servicio 112", 100000)]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /cambió desde la cotización/);
  });
  test("misma composición y costo: convierte con lo RECALCULADO", () => {
    const r = validar([srv(112, "Servicio 112", 87000)], [srv(112, "Servicio 112", 87000)]);
    assert.equal(r.ok, true);
  });
});
