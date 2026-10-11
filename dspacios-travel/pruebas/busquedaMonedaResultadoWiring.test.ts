// Moneda de la búsqueda de hoteles (#14): el motor ya conoce la moneda del
// hotel (`evaluarHotelPorFechas` → `hoteles.moneda`, "USD" o "COP"); el
// resultado de `buscarHoteles` debe llevarla y la tarjeta `Resultado`
// (BuscadorBooking.tsx) debe usarla para el precio del hotel y para el
// conjunto hotel + servicios — nunca COP fijo. Prueba de cableado: la
// presentación y el conjunto se prueban en pruebas/servicioAdicionalTarjeta.react.ts
// y pruebas/servicioAdicionalPaquete.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const cotizar = readFileSync(join(RAIZ, "lib/reservar/cotizar.ts"), "utf8");
const buscador = readFileSync(join(RAIZ, "app/tarifario/BuscadorBooking.tsx"), "utf8");

function bloque(fuente: string, inicio: string, fin: string): string {
  const i = fuente.indexOf(inicio);
  assert.notEqual(i, -1, `no se encontró ${inicio}`);
  const j = fuente.indexOf(fin, i + inicio.length);
  assert.notEqual(j, -1, `no se encontró el cierre de ${inicio}`);
  return fuente.slice(i, j);
}

describe("buscarHoteles: el resultado lleva la moneda que resolvió el motor", () => {
  test("BusquedaResultado declara `moneda: string`", () => {
    const tipo = bloque(cotizar, "export type BusquedaResultado = {", "\n};");
    assert.match(tipo, /\n\s*moneda: string;/);
  });

  test("el resultado se arma con `res.moneda` (de evaluarHotelPorFechas), nunca un literal", () => {
    const cuerpo = bloque(cotizar, "export async function buscarHoteles(", "\nexport ");
    assert.match(cuerpo, /const res = evaluarHotelPorFechas\(datos, input\.fechaIda, numNoches\);/);
    const push = bloque(cuerpo, "resultados.push({", "});");
    assert.match(push, /moneda: res\.moneda,/);
    assert.doesNotMatch(push, /moneda: "(COP|USD)"/);
  });

  test("la fórmula de liquidación no cambia: el total sigue saliendo del combo más barato", () => {
    const cuerpo = bloque(cotizar, "export async function buscarHoteles(", "\nexport ");
    const push = bloque(cuerpo, "resultados.push({", "});");
    assert.match(push, /total: mejor\.total,/);
    assert.match(push, /combos: combosValidos,/);
  });
});

describe("Resultado (BuscadorBooking): precio y conjunto en la moneda del resultado", () => {
  // `Resultado` es la última función del archivo: el cuerpo va hasta el final.
  const inicio = buscador.indexOf("export function Resultado(");
  assert.notEqual(inicio, -1, "no se encontró Resultado");
  const cuerpo = buscador.slice(inicio);

  test("el precio del hotel se formatea con la moneda del resultado", () => {
    assert.match(cuerpo, /formatMoneda\(combo\.total, r\.moneda\)/);
    assert.doesNotMatch(cuerpo, /formatCOP\(/);
  });

  test("el conjunto hotel + servicios se evalúa y se pinta con `r.moneda`", () => {
    assert.match(cuerpo, /precio: combo\.total, moneda: r\.moneda,/);
    assert.match(cuerpo, /<DesgloseServicios hotelNombre=\{r\.hotelNombre \?\? ""\} precioHotel=\{combo\.total\} moneda=\{r\.moneda\}/);
    assert.doesNotMatch(cuerpo, /moneda: "COP"|moneda="COP"/, "nunca COP fijo");
  });
});
