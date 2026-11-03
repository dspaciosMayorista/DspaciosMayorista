import test from "node:test";
import assert from "node:assert/strict";
import { desgloseInterno } from "../lib/cotizacion/desgloseInterno.ts";

const hab = { descripcion: "H · 1 hab Doble (2 pax) · Std / PC", adultos: 2, ninos: 0, tarifa_adulto: 500000, tarifa_nino: 0 };

test("tarifario: grupos, cantidades y suma cuadran con el total guardado", () => {
  const d = desgloseInterno({
    precio_venta: 1339000,
    detalle: { vuelos: [{ id: 1 }], items: [
      hab,
      { descripcion: "H · Niño 1 · Std / PC", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 300000 },
      { descripcion: "Servicio · Tour", adultos: 1, ninos: 0, tarifa_adulto: 40000, tarifa_nino: 0 },
      { descripcion: "Mascota · perro", adultos: 0, ninos: 0, tarifa_adulto: 10000, tarifa_nino: 0 },
      { descripcion: "Ajuste de redondeo del reparto del hotel", adultos: 1, ninos: 0, tarifa_adulto: -1000, tarifa_nino: 0 },
    ] },
  })!;
  assert.deepEqual(d.lineas.map((l) => l.grupo), ["hotel", "hotel", "servicio", "suplemento", "ajuste"]);
  assert.equal(d.lineas[0].cantidad, 2);
  assert.equal(d.lineas[0].unitario, 500000);
  assert.equal(d.suma, 1339000);
  assert.ok(d.cuadra);
  assert.equal(d.avisos.length, 1); // vuelo sin importe propio
});

test("línea de precio total (alojamiento por unidad) y vuelo manual", () => {
  const d = desgloseInterno({ precio_venta: 900000, detalle: { items: [
    { descripcion: "Hotel B · Std / PC · 2 habitación(es), 4 viajero(s)", adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, modo_precio: "total", valor_total: 700000 },
    { descripcion: "Vuelo · BOG-CTG", adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, modo_precio: "total", valor_total: 200000 },
  ], vuelos: [{ id: 1 }] } })!;
  assert.equal(d.lineas[0].cantidad, null);
  assert.equal(d.lineas[1].grupo, "vuelo");
  assert.ok(d.cuadra);
  assert.deepEqual(d.avisos, []);
});

test("forma de cotización manual (cantidad/tarifa_unit/valor)", () => {
  const d = desgloseInterno({ precio_venta: 1250000, detalle: { items: [
    { descripcion: "PAQUETE TURÍSTICO A CTG DEL 01/02/2027 AL 04/02/2027", cantidad: 2, tarifa_unit: 500000, valor: 1000000, orden: 0 },
    { descripcion: "Tarifa por niño", cantidad: 1, tarifa_unit: 250000, valor: 250000, orden: 1 },
  ] } })!;
  assert.equal(d.suma, 1250000);
  assert.ok(d.cuadra);
});

test("no cuadra: se reporta la diferencia sin inventar renglones", () => {
  const d = desgloseInterno({ precio_venta: 1100000, detalle: { items: [hab] } })!;
  assert.equal(d.cuadra, false);
  assert.equal(d.diferencia, 100000);
  assert.equal(d.lineas.length, 1);
});

test("sin renglones guardados: null", () => {
  assert.equal(desgloseInterno({ precio_venta: 5, detalle: null }), null);
  assert.equal(desgloseInterno({ precio_venta: 5, detalle: { items: [] } }), null);
});

test("renglón desconocido: «otro», nunca hotel", () => {
  const d = desgloseInterno({ precio_venta: 70000, detalle: { items: [{ descripcion: "Cargo raro", adultos: 1, ninos: 0, tarifa_adulto: 70000, tarifa_nino: 0 }] } })!;
  assert.equal(d.lineas[0].grupo, "otro");
  assert.ok(d.cuadra);
});

test("importe faltante o inválido: no se vuelve $0, el detalle es incompleto", () => {
  const casos: unknown[] = [
    { descripcion: "H · 1 hab Doble (2 pax) · A / B", adultos: 2, ninos: 0, tarifa_adulto: "abc", tarifa_nino: 0 },
    { descripcion: "H · 1 hab Doble (2 pax) · A / B", adultos: 2, ninos: 0, tarifa_nino: 0 },
    { descripcion: "Hotel B · 2 habitación(es), 4 viajero(s)", adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, modo_precio: "total" },
    { descripcion: "PAQUETE", cantidad: 1, tarifa_unit: 5, valor: null },
    "texto",
  ];
  for (const it of casos) {
    const d = desgloseInterno({ precio_venta: 0, detalle: { items: [it] } })!;
    assert.equal(d.incompleto, true);
    assert.equal(d.lineas[0].subtotal, null);
    assert.equal(d.cuadra, false);
    assert.equal(d.diferencia, null);
  }
});

test("total guardado inválido: incompleto aunque las líneas sean válidas", () => {
  const d = desgloseInterno({ precio_venta: null, detalle: { items: [hab] } })!;
  assert.equal(d.total, null);
  assert.equal(d.incompleto, true);
  assert.equal(d.suma, 1000000);
});
