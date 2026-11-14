// Sección «Servicios incluidos» del documento del cliente: nombre, fechas y a quién cubre, SIN importes ni precios por servicio. Lógica pura.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { leerLineaServicio, serviciosDeDocumento, textoCobertura } from "../lib/contrato/serviciosDocumento.ts";
import { resumenUnidad, resumenCotizacion, type Cupo } from "../lib/cotizacion/resumenPrecios.ts";

const meta = { ref: "item-0", paquete: { id: 7, nombre: "Cartagena" }, hotel: "Hotel Almirante", categoria: "Estándar", regimen: "PC" };
const cupos: Cupo[] = [
  { id: "a1", tipo: "adulto", baseCentavos: 100_000_00 }, { id: "a2", tipo: "adulto", baseCentavos: 100_000_00 }, { id: "a3", tipo: "adulto", baseCentavos: 100_000_00 },
  { id: "n1", tipo: "nino", baseCentavos: 60_000_00 }, { id: "n2", tipo: "nino", baseCentavos: 60_000_00 },
];
const LINEA = "Servicio · Traslado privado · 2030-03-01 → 2030-03-04 · 3 pax — sujeto a confirmación de disponibilidad y tarifa";

describe("lectura de la línea del servicio", () => {
  test("nombre, fechas y pasajeros; la salvedad comercial no es parte del nombre", () => {
    assert.deepEqual(leerLineaServicio(LINEA), { nombre: "Traslado privado", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 3 });
  });
  test("sin fechas, con una sola fecha o sin pax: lo que no está se deja en null (no se inventa)", () => {
    assert.deepEqual(leerLineaServicio("Servicio · Tour Islas · 2 pax"), { nombre: "Tour Islas", fechaIda: null, fechaRegreso: null, pax: 2 });
    assert.deepEqual(leerLineaServicio("Servicio · Cena · 2030-03-02 · 4 pax"), { nombre: "Cena", fechaIda: "2030-03-02", fechaRegreso: null, pax: 4 });
    assert.deepEqual(leerLineaServicio("Servicio · Spa"), { nombre: "Spa", fechaIda: null, fechaRegreso: null, pax: null });
  });
  test("una línea que no es de servicio (vuelo, alojamiento) se ignora", () => {
    assert.equal(leerLineaServicio("Vuelo · Avianca BOG → CTG (Ida) · 2030-03-01 · 2 pax — sujeto a confirmación"), null);
    assert.equal(leerLineaServicio("Hotel Almirante"), null);
  });
});

describe("a quién cubre", () => {
  const resumenCon = (cubre: "todos" | string[]) => resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [(() => {
    const r = resumenUnidad({ ...meta, cupos, servicios: [{ id: "s", nombre: "Traslado privado", modo: "total", precioCentavos: 300_000_00, cubre }] });
    assert.ok(r.ok, r.ok ? "" : r.error); return (r as Extract<typeof r, { ok: true }>).valor;
  })()] });
  test("con el resumen: «3 de 5 pasajeros (2 adultos y 1 menor)»", () => {
    const s = serviciosDeDocumento([{ descripcion: LINEA }], resumenCon(["a1", "a2", "n1"]), 5);
    assert.equal(s.length, 1);
    assert.equal(s[0].cubre, "3 de 5 pasajeros (2 adultos y 1 menor)");
    assert.deepEqual([s[0].nombre, s[0].fechaIda, s[0].fechaRegreso], ["Traslado privado", "2030-03-01", "2030-03-04"]);
  });
  test("cobertura total: «Todos los pasajeros (5)»", () => {
    assert.equal(serviciosDeDocumento([{ descripcion: LINEA }], resumenCon("todos"), 5)[0].cubre, "Todos los pasajeros (5)");
  });
  test("sin resumen se usa el pax de la línea frente al total de la venta (nunca se nombra a nadie)", () => {
    assert.equal(serviciosDeDocumento([{ descripcion: LINEA }], null, 5)[0].cubre, "3 de 5 pasajeros");
    assert.equal(serviciosDeDocumento([{ descripcion: LINEA }], null, 3)[0].cubre, "Todos los pasajeros (3)");
    assert.equal(serviciosDeDocumento([{ descripcion: "Servicio · Spa" }], null, 3)[0].cubre, "Según lo acordado");
  });
  test("texto de cobertura con solo adultos o solo menores", () => {
    assert.equal(textoCobertura({ cubiertos: 2, adultos: 2, menores: 0, total: 5 }), "2 de 5 pasajeros (2 adultos)");
    assert.equal(textoCobertura({ cubiertos: 1, adultos: 0, menores: 1, total: 5 }), "1 de 5 pasajeros (1 menor)");
  });
  test("ninguna salida lleva un importe", () => {
    const s = serviciosDeDocumento([{ descripcion: LINEA }], resumenCon(["a1", "a2", "n1"]), 5);
    assert.doesNotMatch(JSON.stringify(s), /\$|\d{1,3}\.\d{3}|precio|valor/i);
  });
});
