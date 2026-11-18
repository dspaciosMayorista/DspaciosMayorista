import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AcomConfig } from "../lib/acomodaciones.ts";
import type { ComboCotizado } from "../lib/reservar/liquidacionHotel.ts";
import { evaluarComposicionHotel, type EntradaComposicion } from "../lib/reservar/composicionHotelBusqueda.ts";

// INTEGRACIÓN #125 + #102: el «niño gratis por habitación» de la búsqueda vive ahora en el motor compartido de composición (el mismo que usan la tarjeta, la tabla y la noche adicional).
// Datos SINTÉTICOS: markup 20 %, adulto doble 125.000 PVP por persona, niño Niño 1 neto promocional 45.000 × 3 noches = 135.000 → PVP 169.000 (135.000 / 0,8 redondeado al mil).
const CFG: AcomConfig[] = [
  { acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 2, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
  { acomodacion: "triple", pax_tarifa: 3, pax_max: 4, adt_min: 3, adt_max: 3, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 },
];
const NOCHE = (indice: number, neto: number, promocion = "PRE BF") => ({ indice, neto, promocion, edadMin: null, edadMax: null });
const BASE = { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, servicios: [] };

function combo(over: Partial<ComboCotizado> = {}): ComboCotizado {
  return {
    categoria: "Estandar", regimen: "PAM",
    precios: { doble: 125_000, triple: 115_000, nino: 169_000, nino2: 140_000 },
    netos: { doble: 100_000, triple: 92_000, nino: 135_000, nino2: 112_000 },
    temporadasTarifaPorAcom: {},
    ninoGratisNoches: { nino: [NOCHE(0, 45_000), NOCHE(1, 45_000), NOCHE(2, 45_000)] },
    ...over,
  } as ComboCotizado;
}
function entrada(over: Partial<EntradaComposicion> = {}): EntradaComposicion {
  return {
    res: { combos: [combo()], serviciosGrupoIncluidos: [], composicionBase: BASE, moneda: "COP" } as never,
    filasTarifa: [], pctMk: 0.2, numNoches: 3, adultos: 2, edades: [8], reglasAcom: CFG,
    generalEdad: { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 },
    numHabitaciones: 1, ...over,
  };
}

describe("#125 en el motor compartido de la búsqueda (#102)", () => {
  test("2 adultos + 1 niño de 8 años: el niño es gratis; el total son solo los adultos y el beneficio se reporta con su descripción", () => {
    const r = evaluarComposicionHotel(entrada());
    assert.equal(r.combos.length, 1);
    const c = r.combos[0];
    assert.equal(c.beneficioNinoGratis?.total, -169_000, "se condona el PVP completo del niño (recompuesto una vez)");
    assert.match(c.beneficioNinoGratis?.descripcion ?? "", /Niño gratis por habitación · PRE BF \(hab\. 1: niño de 8 años \(Niño 1\)\)/);
    assert.equal(c.total, 250_000, "2 adultos × 125.000 (el niño queda en 0)");
    assert.equal(c.desglose.reduce((t, l) => t + (l.subtotal ?? 0), 0) + (c.beneficioNinoGratis?.total ?? 0) >= 0, true);
  });
  test("sin menores el beneficio no existe y el resultado es el de siempre", () => {
    const r = evaluarComposicionHotel(entrada({ adultos: 2, edades: [] }));
    assert.equal(r.combos[0].beneficioNinoGratis, undefined);
    assert.equal(r.combos[0].total, 250_000);
  });
  test("solo se pregunta si la composición cabe (sugerencias de fechas): no se calcula precio ni beneficio", () => {
    const r = evaluarComposicionHotel(entrada({ soloFactibilidad: true }));
    assert.equal(r.combos.length, 1);
    assert.equal(r.combos[0].beneficioNinoGratis, undefined);
    assert.equal(r.combos[0].total, 250_000 + 169_000, "el niño se cuenta completo: aquí solo importa que quepa");
  });
  test("sin el desglose del precio del hotel el combo NO se ofrece como si el niño gratis no existiera: se explica", () => {
    const sinBase = entrada({ res: { combos: [combo()], serviciosGrupoIncluidos: [], moneda: "COP" } as never });
    const r = evaluarComposicionHotel(sinBase);
    assert.equal(r.combos.length, 0);
    assert.match(r.rechazos.join(" | "), /no se pudo aislar el precio de su alojamiento/);
    const sinMoneda = entrada({ res: { combos: [combo()], serviciosGrupoIncluidos: [], composicionBase: BASE } as never });
    const r2 = evaluarComposicionHotel(sinMoneda);
    assert.equal(r2.combos.length, 0);
    assert.match(r2.rechazos.join(" | "), /no se pudo aislar el precio de su alojamiento/);
  });
  test("dos niños en la misma habitación: solo uno es gratis (el primero elegible con su tarifa real); el otro paga la suya", () => {
    const c2 = combo({ ninoGratisNoches: { nino: [NOCHE(0, 45_000), NOCHE(1, 45_000), NOCHE(2, 45_000)], nino2: [NOCHE(0, 37_000), NOCHE(1, 37_000), NOCHE(2, 38_000)] } });
    const r = evaluarComposicionHotel(entrada({ res: { combos: [c2], serviciosGrupoIncluidos: [], composicionBase: BASE, moneda: "COP" } as never, edades: [8, 5] }));
    const b = r.combos[0].beneficioNinoGratis;
    assert.equal(b?.total, -169_000, "exactamente UN niño gratis por habitación");
    assert.equal(r.combos[0].total, 250_000 + 140_000, "adultos + el Niño 2, que sigue pagando");
  });
  test("un menor mayor que el umbral de niño del hotel paga como adulto y NO es elegible al niño gratis (la regla de edad del hotel manda)", () => {
    const r = evaluarComposicionHotel(entrada({ edades: [12], generalEdad: { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 } }));
    assert.equal(r.combos[0].beneficioNinoGratis, undefined, "a los 12 años paga como adulto: 3 adultos en una Triple");
    assert.equal(r.combos[0].total, 3 * 115_000);
  });
  test("cableado: buscarHoteles expone el beneficio del combo más barato y la noche adicional / tabla usan el mismo motor", async () => {
    const { readFileSync } = await import("node:fs");
    const cotizar = readFileSync(new URL("../lib/reservar/cotizar.ts", import.meta.url), "utf8");
    const motor = readFileSync(new URL("../lib/reservar/composicionHotelBusqueda.ts", import.meta.url), "utf8");
    assert.match(cotizar, /\.\.\.\(mejor\.beneficioNinoGratis \? \{ beneficioNinoGratis: mejor\.beneficioNinoGratis \} : \{\}\)/);
    assert.match(motor, /calcularBeneficioNinoGratis\(\{/);
    assert.match(motor, /!e\.soloFactibilidad && combo\.ninoGratisNoches/);
    const liq = readFileSync(new URL("../lib/reservar/liquidacionHotel.ts", import.meta.url), "utf8");
    assert.match(liq, /soloFactibilidad: true/);
  });
});
