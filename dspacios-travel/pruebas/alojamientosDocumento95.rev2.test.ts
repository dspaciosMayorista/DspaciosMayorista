// B95-15/18 — alojamiento elegido para el documento del cliente (módulo puro). Solo campos descriptivos; ciudad y fechas solo con UN hotel; nada interno.
import test from "node:test";
import assert from "node:assert/strict";
import { alojamientosDeServicios } from "../lib/cotizacion/alojamientosDocumento.ts";
import { absorberAjusteRedondeo } from "../lib/contrato/absorberAjusteRedondeo.ts";

const viaje = { destino: "Cartagena", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04" };
const hotel = (extra: Record<string, unknown> = {}) => ({ tipo: "hotel", nombre: "Hotel B", categoria: "Estándar", regimen: "PC", acomodacion: "1 hab Doble", proveedor: "Interno SA", plataforma: "Booking", costoNeto: 900000, compra: "plataforma", ...extra });

test("un hotel: nombre, categoría, plan, acomodación, ciudad y fechas del viaje; jamás proveedor, plataforma, costo ni compra", () => {
  const r = alojamientosDeServicios([{ tipo: "aereo", nombre: "Avianca", costoNeto: 5 }, hotel()], viaje);
  assert.deepEqual(r, [{ nombre: "Hotel B", categoria: "Estándar", alimentacion: "PC", acomodacion: "1 hab Doble", detalle_acomodacion: null, ciudad: "Cartagena", fecha_ingreso: "2030-03-01", fecha_salida: "2030-03-04" }]);
  assert.doesNotMatch(JSON.stringify(r), /Interno SA|Booking|900000|plataforma|compra/);
});
test("varios hoteles: sin ciudad ni fechas inventadas (no se sabe a qué noches corresponde cada uno), en el orden de la cotización", () => {
  const r = alojamientosDeServicios([hotel({ nombre: "Uno" }), hotel({ nombre: "Dos", regimen: "PAM" })], viaje);
  assert.deepEqual(r.map((h) => [h.nombre, h.alimentacion, h.ciudad, h.fecha_ingreso, h.fecha_salida]), [["Uno", "PC", null, null, null], ["Dos", "PAM", null, null, null]]);
});
test("datos ausentes o no válidos no se inventan: null; fila sin nombre y entradas que no son lista se ignoran", () => {
  assert.deepEqual(alojamientosDeServicios(undefined, viaje), []);
  assert.deepEqual(alojamientosDeServicios([hotel({ nombre: "  " }), "x", null, { tipo: "traslado", nombre: "T" }], viaje), []);
  const r = alojamientosDeServicios([hotel({ categoria: "", regimen: undefined, acomodacion: 5 })], { destino: " ", fechaIda: "01/03/2030", fechaRegreso: null });
  assert.deepEqual([r[0].categoria, r[0].alimentacion, r[0].acomodacion, r[0].ciudad, r[0].fecha_ingreso, r[0].fecha_salida], [null, null, null, null, null, null]);
});

// absorberAjusteRedondeo: cuentas a mano en centavos.
const fila = (id: number, descripcion: string, adultos: number, ninos: number, ta: number, tn: number) => ({ id, descripcion, modo_precio: "por_persona", adultos, ninos, tarifa_adulto: ta, tarifa_nino: tn });
const AJ = "Ajuste de redondeo del reparto del hotel";
test("ajuste −1 con 2 adultos: tarifa 715.227,50 y la fila vale 1.430.455 exactos; el niño no cambia", () => {
  const r = absorberAjusteRedondeo([fila(1, "PAQUETE", 2, 1, 715228, 150000), fila(2, AJ, 1, 0, -1, 0)]);
  assert.equal(r.absorbido, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].tarifa_adulto, 715227.5);
  assert.equal(r.items[0].tarifa_nino, 150000);
  assert.equal(Math.round(r.items[0].adultos * r.items[0].tarifa_adulto * 100), 143045500);
});
test("la suma de las filas con el residuo plegado = la suma de las filas guardadas, al centavo (también con 3 adultos y un ajuste de 1 peso)", () => {
  const originales = [fila(1, "PAQUETE", 3, 1, 476818, 150000), fila(2, AJ, 1, 0, 1, 0)];
  const guardado = originales.reduce((s, i) => s + Math.round(i.adultos * i.tarifa_adulto * 100) + Math.round(i.ninos * i.tarifa_nino * 100), 0);
  const r = absorberAjusteRedondeo(originales);
  assert.equal(r.absorbido, true);
  const visible = r.items.reduce((s, i) => s + Math.round(i.adultos * i.tarifa_adulto * 100) + Math.round(i.ninos * i.tarifa_nino * 100), 0);
  assert.equal(visible, guardado);
});
test("sin fila de adultos que lo reciba, o con reparto en fracciones de centavo: la línea YA NO se conserva para el cliente; sinReparto=true y nada se inventa", () => {
  const r1 = absorberAjusteRedondeo([fila(1, "Niño 1 · X", 0, 1, 0, 100), fila(2, AJ, 1, 0, 5, 0)]);
  assert.equal(r1.absorbido, false);
  assert.equal(r1.sinReparto, true);
  assert.deepEqual(r1.items.map((i) => i.id), [1], "la fila de ajuste desaparece; la fila del niño queda intacta");
  assert.equal(r1.items[0].tarifa_nino, 100);
  const items = [fila(1, "A", 1, 0, 100, 0), fila(2, "B", 2, 0, 90, 0), fila(3, AJ, 1, 0, 0.01, 0)];
  const r = absorberAjusteRedondeo(items);
  assert.equal(r.absorbido, false);
  assert.equal(r.sinReparto, true);
  assert.deepEqual(r.items.map((i) => [i.id, i.tarifa_adulto]), [[1, 100], [2, 90]], "ninguna tarifa se modifica ni se reparte desigual");
});
test("el ajuste sin reparto no pierde ni inventa importes: las filas restantes quedan EXACTAMENTE como se guardaron (el total lo da el documento desde las líneas guardadas)", () => {
  const original = [fila(1, "Niño 1 · X", 0, 2, 0, 50), fila(2, AJ, 1, 0, -3, 0)];
  const r = absorberAjusteRedondeo(original);
  assert.equal(r.sinReparto, true);
  assert.deepEqual(r.items, [original[0]]);
});
test("línea de ajuste en modo total (valor_total) también se retira del cliente", () => {
  const aj = { ...fila(2, AJ, 0, 0, 0, 0), modo_precio: "total", valor_total: -2 };
  const r = absorberAjusteRedondeo([fila(1, "PAQUETE", 2, 0, 100, 0), aj]);
  assert.equal(r.absorbido, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].tarifa_adulto, 99);
});
test("sin línea de ajuste: nada cambia y sinReparto=false", () => {
  const r = absorberAjusteRedondeo([fila(1, "PAQUETE", 2, 0, 100, 0)]);
  assert.deepEqual([r.absorbido, r.sinReparto, r.items.length], [false, false, 1]);
});
test("solo la constante exacta se pliega y los servicios no reciben el residuo", () => {
  const r = absorberAjusteRedondeo([fila(1, "Servicio · Tour", 1, 0, 10, 0), fila(2, "Ajuste de redondeo del paquete", 1, 0, 5, 0)]);
  assert.equal(r.absorbido, false);
  const r2 = absorberAjusteRedondeo([fila(1, "Servicio · Tour", 2, 0, 10, 0), fila(2, "Doble", 2, 0, 100, 0), fila(3, AJ, 1, 0, -2, 0)]);
  assert.equal(r2.absorbido, true);
  assert.equal(r2.items.find((i) => i.id === 1)!.tarifa_adulto, 10, "el servicio queda intacto");
  assert.equal(r2.items.find((i) => i.id === 2)!.tarifa_adulto, 99);
});
