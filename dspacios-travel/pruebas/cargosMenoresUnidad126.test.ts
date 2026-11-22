// #126-B — cargo explícito de cada menor en un alojamiento por unidad. Importes esperados calculados a mano (ver cada caso).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cargosMenoresUnidad, textoCargoMenor, type CargoMenorUnidad } from "../lib/reservar/cargosMenoresUnidad.ts";
import type { ResultadoValido, MenorClasificado, SuplementoAplicado } from "../lib/calc/unidadAlojamiento.ts";

const marcar = (costo: number, mk: number) => costo / (1 - mk); // misma regla pública del motor (margen), declarada aquí a propósito
const fmt = (n: number) => `$${n}`;

function hab(p: {
  unidadCobro: ResultadoValido["unidadCobro"]; noches: number; totalBruto: number; comisionPct: number;
  menores: MenorClasificado[]; suplementos?: SuplementoAplicado[]; desglose?: ResultadoValido["desglose"];
}): { resultado: ResultadoValido } {
  const totalNeto = Math.round(p.totalBruto * (1 - p.comisionPct / 100));
  return {
    resultado: {
      ok: true, unidadCobro: p.unidadCobro, cantidadUnidades: 1, noches: p.noches, desglose: p.desglose ?? [],
      totalBrutoPorNoche: 0, totalBrutoPorEstadia: 0, totalBruto: p.totalBruto, comisionPct: p.comisionPct, valorComision: p.totalBruto - totalNeto, totalNeto,
      menoresClasificados: p.menores, suplementosAplicados: p.suplementos ?? [], capacidadUtilizada: [],
    } as unknown as ResultadoValido,
  };
}
const menor = (edad: number, cat: MenorClasificado["categoriaTarifaria"]): MenorClasificado =>
  ({ edadAnios: edad, categoriaTarifaria: cat, reglaAplicada: {} as MenorClasificado["reglaAplicada"], valorAplicado: null });

test("habitación con cupo lleno: el niño de 8 años paga su suplemento por noche; el efecto en venta sale del markup (a mano: 168.750)", () => {
  // base 400.000×3 = 1.200.000 + niño 50.000×3 = 150.000 → bruto 1.350.000; comisión 10 % → neto 1.215.000; sin el niño: 1.080.000.
  // markup 20 %: 1.215.000/0,8 = 1.518.750 ; 1.080.000/0,8 = 1.350.000 → cargo de venta = 168.750.
  const h = hab({
    unidadCobro: "habitacion", noches: 3, totalBruto: 1_350_000, comisionPct: 10, menores: [menor(8, "nino")],
    suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 50_000, cantidad: 1, valorTotal: 50_000 }],
  });
  const r = cargosMenoresUnidad([h], 0.2, marcar);
  assert.deepEqual(r, [{ habitacion: 1, edad: 8, clase: "nino", cobro: "por_noche", cargoVenta: 168_750, noches: 3 }]);
  assert.match(textoCargoMenor(r[0], fmt), /^Niño de 8 años: cargo propio \$168750 en total \(se cobra por noche, 3 noches; ya incluido en el total\)$/);
});

test("el mismo niño con cupo incluido en la unidad: sin cargo propio y sin importe inventado", () => {
  const h = hab({ unidadCobro: "habitacion", noches: 3, totalBruto: 1_200_000, comisionPct: 10, menores: [menor(8, "nino")] });
  const r = cargosMenoresUnidad([h], 0.2, marcar);
  assert.deepEqual(r, [{ habitacion: 1, edad: 8, clase: "nino", cobro: "incluido", cargoVenta: null, noches: 3 }]);
  assert.equal(textoCargoMenor(r[0], fmt), "Niño de 8 años: incluido en la unidad, sin cargo propio");
});

test("dos niños y un solo cupo libre: el primero (orden recibido) va incluido y el segundo paga", () => {
  // bruto: 1.200.000 + 50.000×3 = 1.350.000 (solo UN niño paga); comisión 0 ; markup 0 → efecto = 150.000
  const h = hab({
    unidadCobro: "apartamento", noches: 3, totalBruto: 1_350_000, comisionPct: 0, menores: [menor(5, "nino"), menor(7, "nino")],
    suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 50_000, cantidad: 1, valorTotal: 50_000 }],
  });
  const r = cargosMenoresUnidad([h], 0, marcar);
  assert.deepEqual(r.map((x) => [x.edad, x.cobro, x.cargoVenta]), [[5, "incluido", null], [7, "por_noche", 150_000]]);
});

test("un menor de 11–17 que la regla clasifica como adulto paga como adulto: nunca se muestra como niño ni con importe aparte", () => {
  const h = hab({ unidadCobro: "habitacion", noches: 2, totalBruto: 800_000, comisionPct: 0, menores: [menor(13, "adulto")] });
  const r = cargosMenoresUnidad([h], 0.2, marcar);
  assert.deepEqual(r, [{ habitacion: 1, edad: 13, clase: "como_adulto", cobro: "como_adulto", cargoVenta: null, noches: 2 }]);
  assert.match(textoCargoMenor(r[0], fmt), /paga como adulto/);
});

test("unidad por persona: el infante con seguro por ESTADÍA cuesta una sola vez (a mano: 30.000) y el niño por noche (70.000 × 3 = 210.000)", () => {
  // adultos 2×100.000×3 = 600.000 ; infante 30.000 una vez ; niño 70.000×3 = 210.000 → bruto 840.000; comisión 0, markup 0.
  const h = hab({
    unidadCobro: "persona", noches: 3, totalBruto: 840_000, comisionPct: 0, menores: [{ ...menor(2, "infante"), valorAplicado: 30_000 }, { ...menor(9, "nino"), valorAplicado: 70_000 }],
    desglose: [
      { concepto: "Adultos", tipo: "base", cantidad: 2, valorUnitario: 100_000, valorTotal: 200_000, unidadIndex: null, periodicidad: "por_noche" },
      { concepto: "Infantes", tipo: "menor", cantidad: 1, valorUnitario: 30_000, valorTotal: 30_000, unidadIndex: null, periodicidad: "por_estadia" },
      { concepto: "Niños", tipo: "menor", cantidad: 1, valorUnitario: 70_000, valorTotal: 70_000, unidadIndex: null, periodicidad: "por_noche" },
    ],
  });
  const r = cargosMenoresUnidad([h], 0, marcar);
  assert.deepEqual(r.map((x) => [x.clase, x.cobro, x.cargoVenta]), [["infante", "por_estadia", 30_000], ["nino", "por_noche", 210_000]]);
  assert.match(textoCargoMenor(r[0], fmt), /^Infante de 2 años: cargo propio \$30000 una sola vez por toda la estadía \(ya incluido en el total\)$/);
});

test("varias habitaciones: cada menor lleva su número de habitación; una habitación sin menores no aporta filas", () => {
  const a = hab({ unidadCobro: "habitacion", noches: 1, totalBruto: 300_000, comisionPct: 0, menores: [] });
  const b = hab({ unidadCobro: "habitacion", noches: 1, totalBruto: 300_000, comisionPct: 0, menores: [menor(1, "infante")] });
  const r = cargosMenoresUnidad([a, b], 0, marcar);
  assert.equal(r.length, 1);
  assert.equal(r[0].habitacion, 2);
  assert.equal(r[0].cobro, "incluido");
});

test("sin menores no hay filas; nunca aparecen netos, brutos ni comisiones en el resultado", () => {
  const r = cargosMenoresUnidad([hab({ unidadCobro: "pareja", noches: 2, totalBruto: 500_000, comisionPct: 15, menores: [menor(6, "nino")], suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 40_000, cantidad: 1, valorTotal: 40_000 }] })], 0.1, marcar);
  const claves = new Set(r.flatMap((x: CargoMenorUnidad) => Object.keys(x)));
  assert.deepEqual([...claves].sort(), ["cargoVenta", "clase", "cobro", "edad", "habitacion", "noches"]);
  assert.deepEqual(cargosMenoresUnidad([], 0.1, marcar), []);
});

test("recalcular con una noche más (4 en vez de 3) cambia el cargo propio del niño; el incluido sigue incluido", () => {
  const mk = (noches: number) => hab({
    unidadCobro: "habitacion", noches, totalBruto: 400_000 * noches + 50_000 * noches, comisionPct: 0, menores: [menor(8, "nino"), menor(4, "infante")],
    suplementos: [{ tipo: "menor_adicional", categoriaMenor: "nino", valor: 50_000, cantidad: 1, valorTotal: 50_000 }],
  });
  assert.equal(cargosMenoresUnidad([mk(3)], 0, marcar)[0].cargoVenta, 150_000);   // 50.000 × 3
  assert.equal(cargosMenoresUnidad([mk(4)], 0, marcar)[0].cargoVenta, 200_000);   // 50.000 × 4
  assert.equal(cargosMenoresUnidad([mk(4)], 0, marcar)[1].cobro, "incluido");
});

test("una tarifa de $0 configurada por el hotel se lee «sin cargo propio», nunca «cargo propio $0»", () => {
  const r = cargosMenoresUnidad([hab({
    unidadCobro: "habitacion", noches: 3, totalBruto: 1_200_000, comisionPct: 0, menores: [menor(2, "infante")],
    suplementos: [{ tipo: "menor_adicional", categoriaMenor: "infante", valor: 0, cantidad: 1, valorTotal: 0 }],
  })], 0.2, marcar);
  assert.deepEqual(r, [{ habitacion: 1, edad: 2, clase: "infante", cobro: "por_noche", cargoVenta: 0, noches: 3 }]);
  assert.equal(textoCargoMenor(r[0], fmt), "Infante de 2 años: sin cargo propio (tarifa $0 del hotel)");
});
