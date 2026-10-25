// #22 — detalle de hotel en pestañas: lógica PURA de presentación (lib/hoteles/tarifasVista.ts) y guardas de código.
// Nada de esto calcula importes: solo cómo se rotulan (COP/USD, cero vs. sin dato) y cómo se agrupan para leerlos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatCOP, formatUSD } from "../lib/utils.ts";
import {
  agruparTarifasPorVigenciaRegimen, formatNetoTarifa, normalizarPestanaHotel, PESTANAS_HOTEL, type VigenciaRef,
} from "../lib/hoteles/tarifasVista.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirHotel = "app/(dashboard)/dashboard/producto/hoteles/[id]";
const fuente = (f: string) => readFileSync(join(raiz, dirHotel, f), "utf8");

describe("formatNetoTarifa — moneda del hotel y valores cero", () => {
  test("COP entero es idéntico a formatCOP (los importes en pesos no cambian de aspecto)", () => {
    for (const v of [1, 99000, 180000, 1234567, 25000000]) assert.equal(formatNetoTarifa(v, "COP"), formatCOP(v));
    assert.equal(formatNetoTarifa(180000), formatCOP(180000), "sin moneda = COP");
  });

  test("DEFECTO CONFIRMADO (#22): formatCOP aplicado a un neto en USD lo rotula como pesos; formatNetoTarifa lo rotula USD", () => {
    assert.match(formatCOP(150), /^\$\s150$/, "así se veía una tarifa de 150 USD en la tabla (sin 'USD')");
    assert.doesNotMatch(formatCOP(150), /USD/);
    assert.equal(formatNetoTarifa(150, "USD"), "USD $150");
    assert.equal(formatNetoTarifa(150, "USD"), formatUSD(150), "coincide con el rotulado USD del resto de la app para enteros");
  });

  test("USD con centavos NO se redondea (formatUSD lo mostraría como USD $86)", () => {
    assert.equal(formatUSD(85.5), "USD $86");
    assert.equal(formatNetoTarifa(85.5, "USD"), "USD $85.50");
    assert.equal(formatNetoTarifa("85.5", "usd"), "USD $85.50", "acepta numeric de Postgres como texto y moneda en minúsculas");
  });

  test("DEFECTO CONFIRMADO (#22): el cero es un valor real (gratis) y no se muestra como guion; null/undefined/vacío sí", () => {
    const celdaAnterior = (base: number | null) => (base ? formatCOP(base) : "—");
    assert.equal(celdaAnterior(0), "—", "así se escondía un 0 cargado");
    assert.equal(formatNetoTarifa(0, "COP"), formatCOP(0));
    assert.equal(formatNetoTarifa(0, "USD"), "USD $0");
    assert.equal(formatNetoTarifa(null, "COP"), "—");
    assert.equal(formatNetoTarifa(undefined, "USD"), "—");
    assert.equal(formatNetoTarifa("", "COP"), "—");
    assert.equal(formatNetoTarifa(Number.NaN, "COP"), "—");
  });
});

describe("agruparTarifasPorVigenciaRegimen — partición exacta por vigencia × alimentación", () => {
  const vig: VigenciaRef[] = [
    { nombre: "ALTA", fecha_inicio: "2026-12-15", fecha_fin: "2027-01-10" },
    { nombre: "BAJA", fecha_inicio: "2026-02-01", fecha_fin: "2026-06-30" },
    { nombre: "BAJA", fecha_inicio: "2026-09-01", fecha_fin: "2026-11-30" },
  ];
  const fila = (id: number, c: string | null, r: string | null, t: string | null) => ({ id, tipo_habitacion: c, alimentacion: r, temporada: t, neto_doble: id * 1000 });
  const tarifas = [
    fila(1, "SUPERIOR", "PAM", "ALTA"), fila(2, "ESTANDAR", "PAM", "ALTA"), fila(3, "ESTANDAR", "PC", "ALTA"),
    fila(4, "ESTANDAR", "PAM", "BAJA"), fila(5, "SUITE", "PAM", "HUERFANA"), fila(6, null, null, null),
  ];

  test("cada tarifa queda en exactamente un grupo y no se altera ninguna", () => {
    const antes = JSON.stringify(tarifas);
    const grupos = agruparTarifasPorVigenciaRegimen(tarifas, vig);
    assert.equal(JSON.stringify(tarifas), antes, "no muta la entrada");
    const ids = grupos.flatMap((g) => g.filas.map((f) => f.id)).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6]);
    for (const g of grupos) for (const f of g.filas) assert.equal(f.neto_doble, f.id * 1000, "los importes viajan intactos");
  });

  test("orden: inicio de la vigencia (sin vigencia al final), luego régimen; dentro del grupo, categoría", () => {
    const grupos = agruparTarifasPorVigenciaRegimen(tarifas, vig);
    assert.deepEqual(grupos.map((g) => [g.temporada, g.alimentacion]), [
      ["BAJA", "PAM"], ["ALTA", "PAM"], ["ALTA", "PC"], ["HUERFANA", "PAM"], [null, null],
    ]);
    assert.deepEqual(grupos[1].filas.map((f) => f.tipo_habitacion), ["ESTANDAR", "SUPERIOR"]);
  });

  test("expone todas las vigencias del nombre y marca las huérfanas con lista vacía", () => {
    const grupos = agruparTarifasPorVigenciaRegimen(tarifas, vig);
    assert.equal(grupos.find((g) => g.temporada === "BAJA")!.vigencias.length, 2);
    assert.deepEqual(grupos.find((g) => g.temporada === "HUERFANA")!.vigencias, []);
    assert.deepEqual(grupos.find((g) => g.temporada === null)!.vigencias, []);
  });

  test("sin tarifas no hay grupos", () => assert.deepEqual(agruparTarifasPorVigenciaRegimen([], vig), []));
});

describe("pestaña inicial (?tab=)", () => {
  test("valores válidos se respetan; ausente o desconocido cae en Configuración", () => {
    assert.deepEqual([...PESTANAS_HOTEL], ["configuracion", "temporadas", "tarifas"]);
    assert.equal(normalizarPestanaHotel("tarifas"), "tarifas");
    assert.equal(normalizarPestanaHotel(["temporadas", "tarifas"]), "temporadas");
    assert.equal(normalizarPestanaHotel(undefined), "configuracion");
    assert.equal(normalizarPestanaHotel("<script>"), "configuracion");
  });
});

describe("guardas de código del detalle de hotel", () => {
  test("ninguna pantalla del detalle formatea con formatCOP (siempre la moneda del hotel)", () => {
    for (const f of ["HotelDetalleClient.tsx", "CalculadoraEditor.tsx", "TarifasHistorial.tsx"]) {
      assert.doesNotMatch(fuente(f), /formatCOP/, `${f} no debe usar formatCOP`);
    }
  });

  test("ningún importe se oculta por ser cero (`valor ? … : \"—\"`)", () => {
    assert.doesNotMatch(fuente("HotelDetalleClient.tsx"), /\(base\)\s*\?|base \? format/);
  });

  test("page.tsx entrega a las pestañas la moneda del hotel y la pestaña de ?tab=", () => {
    const page = fuente("page.tsx");
    assert.match(page, /moneda=\{moneda\}/);
    assert.match(page, /pestanaInicial=\{/);
    assert.match(page, /searchParams: Promise<\{ tab\?/);
    // Los cálculos y la lectura de datos no se tocaron: solo cambió dónde se pinta cada bloque.
    assert.match(page, /sb\.from\("tarifa_hotel"\)\.select\("\*"\)\.eq\("hotel_id", hotelId\)\.order\("id", \{ ascending: false \}\)/);
  });

  test("las tres pestañas montan SIEMPRE sus paneles (ocultos con `hidden`, no desmontados) para no perder borradores", () => {
    const src = fuente("HotelDetalleClient.tsx");
    assert.equal((src.match(/role="tabpanel"/g) ?? []).length, 3);
    assert.equal((src.match(/hidden=\{activa !== "/g) ?? []).length, 3);
    assert.doesNotMatch(src, /activa === "(configuracion|temporadas|tarifas)" &&/);
  });
});
