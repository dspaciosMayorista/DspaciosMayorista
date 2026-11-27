// #33 / B95-6 — each comparative option charges the child at ITS hotel's tariff. Totals are worked out by hand; nothing is read from a shared price.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { construirComparativaManual, type EntradaComparativaManual } from "../lib/cotizacion/comparativa.ts";

const entrada = (extra: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual => ({
  cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1", telefono: "3001112233", email: "", nacimiento: "" },
  destino: "Cartagena", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, moneda: "COP", ninos: 1, tarifaNino: 0, recobro: 0, recobroAliado: 0,
  tipoAsesor: "interno", asesorInterno: "Asesora", agenciaNombre: "", freelanceNombre: "", plazo: "", vigenciaHasta: "", observaciones: "", incluye: "", noIncluye: "",
  servicios: [
    { tipo: "aereo", plataforma: "", nombre: "Avianca", proveedor: "", costoNeto: 500_000, modo: "ta", pctMarkup: 0, ta: 30_455 },
    { tipo: "hotel", plataforma: "", nombre: "Hotel A", proveedor: "", costoNeto: 800_000, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "A" },
    { tipo: "hotel", plataforma: "", nombre: "Hotel B", proveedor: "", costoNeto: 900_000, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "B" },
  ],
  ...extra,
});
const armar = (extra: Partial<EntradaComparativaManual>) => {
  const r = construirComparativaManual(entrada(extra), { hoy: "2030-02-01" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.datos;
};

test("hotel A gratis para el niño y hotel B a 150.000: A = 530.455 + 800.000; B = 530.455 + 900.000 + 150.000", () => {
  const d = armar({ tarifaNinoPorOpcion: { A: 0, B: 150_000 } });
  assert.deepEqual(d.opciones.map((o) => o.total), [1_330_455, 1_580_455]);
  const [a, b] = d.opciones.map((o) => (o.plantilla_hija.detalle as { items: { descripcion: string; cantidad: number; tarifa_unit: number; valor: number }[] }).items.find((i) => i.descripcion === "Tarifa por niño")!);
  assert.deepEqual([a.cantidad, a.tarifa_unit, a.valor], [1, 0, 0]);
  assert.deepEqual([b.cantidad, b.tarifa_unit, b.valor], [1, 150_000, 150_000]);
});

test("la hija de cada opción guarda SU tarifa de niño en el payload (de ahí sale el contrato al elegirla); la madre conserva el mapa", () => {
  const d = armar({ ninos: 2, tarifaNinoPorOpcion: { A: 100_000, B: 175_000 } });
  const pay = (i: number) => (d.opciones[i].plantilla_hija.payload as { ninos: number; tarifaNino: number; tarifaNinoPorOpcion?: unknown });
  assert.deepEqual([pay(0).ninos, pay(0).tarifaNino, pay(1).ninos, pay(1).tarifaNino], [2, 100_000, 2, 175_000]);
  assert.equal(pay(0).tarifaNinoPorOpcion, undefined, "la hija no arrastra el mapa de la comparativa");
  assert.deepEqual((d.cabecera.payload as { tarifaNinoPorOpcion: unknown }).tarifaNinoPorOpcion, { A: 100_000, B: 175_000 });
  assert.deepEqual(d.opciones.map((o) => o.total), [530_455 + 800_000 + 200_000, 530_455 + 900_000 + 350_000]);
});

test("con niños, falta la tarifa de una opción (o es inválida) → error; nunca se reutiliza una tarifa común", () => {
  for (const mapa of [undefined, { A: 100_000 }, { A: 100_000, B: -1 }, { A: 100_000, B: Number.NaN }]) {
    const r = construirComparativaManual(entrada({ tarifaNino: 999_999, tarifaNinoPorOpcion: mapa as never }), { hoy: "2030-02-01" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /tarifa de niño de la Opción/);
  }
});

test("sin niños no se pide ni se usa ninguna tarifa de niño", () => {
  const d = armar({ ninos: 0, tarifaNino: 123, tarifaNinoPorOpcion: undefined });
  assert.deepEqual(d.opciones.map((o) => o.total), [1_330_455, 1_430_455]);
  for (const o of d.opciones) assert.ok(!(o.plantilla_hija.detalle as { items: { descripcion: string }[] }).items.some((i) => i.descripcion === "Tarifa por niño"));
});

test("wiring: el formulario envía el mapa por opción y exige un valor en cada opción antes de crear", () => {
  const f = fs.readFileSync("app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx", "utf8");
  assert.ok(f.includes("tarifaNinoPorOpcion: nNinos > 0"));
  assert.ok(f.includes("Tarifa por niño de la Opción"));
  assert.ok(/Number\(numNinos\) > 0 && !comparativa/.test(f), "el campo único de tarifa por niño no se muestra en una comparativa");
});
