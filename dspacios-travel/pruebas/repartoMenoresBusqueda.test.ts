import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────
// Puente entre la ocupación LEGADA del buscador general (habitaciones por
// tipo + adultos totales + edades PLANAS) y la asociación explícita
// habitación↔edades que exige la cotización por unidad.
//
// Este módulo es PURO (imports relativos con extensión `.ts`, sin `@/`), así
// que —a diferencia de los wiring tests de los componentes— corre de verdad
// bajo `node --test`.
// ─────────────────────────────────────────────────────────────────────────

import { defaultAcomConfig, type AcomConfig } from "../lib/acomodaciones.ts";
import {
  repartirMenoresEnHabitaciones,
  type HabitacionBusqueda,
} from "../lib/reservar/repartoMenoresBusqueda.ts";
import type { ConfigCapacidadHabitacion } from "../lib/reservar/distribucionHabitaciones.ts";

// Config de una habitación "que sí admite menores": el default de `doble`
// tiene `pax_max === pax_tarifa`, así que su capacidad efectiva de niño es 0
// — para probar el reparto de menores hace falta holgura real de pax.
function configConHolgura(
  acom: HabitacionBusqueda["acom"],
  over: Partial<ConfigCapacidadHabitacion> = {}
): ConfigCapacidadHabitacion {
  return { ...defaultAcomConfig(acom), pax_max: defaultAcomConfig(acom).pax_tarifa + 2, chd_max: 2, ...over };
}

const hab = (acom: HabitacionBusqueda["acom"], over: Partial<ConfigCapacidadHabitacion> = {}): HabitacionBusqueda => ({
  acom,
  config: configConHolgura(acom, over),
});

const INFANTE_MAX = 2;
const NINO_MAX = 10;

describe("repartirMenoresEnHabitaciones — asociación habitación↔edades", () => {
  test("sin menores: valida igual (adultos vs pax_tarifa) y devuelve las habitaciones con el reparto vacío", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")],
      adultosDeclarados: 2,
      edades: [],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones.length, 1);
    assert.deepEqual(r.habitaciones[0], {
      id: "doble-0",
      acom: "doble",
      adultos: 2,
      edadesMenores: [],
    });
    assert.equal(r.infantes, 0);
    assert.equal(r.ninos, 0);
  });

  test("una edad que el hotel clasifica como ADULTO se rechaza explícitamente (nunca se 'acomoda' moviéndola de lugar)", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")],
      adultosDeclarados: 2,
      edades: [30],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "edad_adulto");
    assert.match(r.error, /La edad 30 no corresponde a un menor/);
  });

  test("adultos declarados ≠ suma de pax_tarifa: propaga el rechazo del reparto autoritativo sin reinterpretarlo", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")], // pax_tarifa 2
      adultosDeclarados: 3,
      edades: [],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "seleccion_invalida");
  });

  test("un infante y un niño en una habitación con holgura: ambos quedan asociados, en orden de captura", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")],
      adultosDeclarados: 2,
      edades: [1, 7],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.habitaciones[0].edadesMenores, [1, 7]);
    assert.equal(r.infantes, 1);
    assert.equal(r.ninos, 1);
  });

  test("el id de cada habitación es POSICIONAL dentro de su propio tipo (doble-0, doble-1), nunca uno que dejó de existir", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble"), hab("triple"), hab("doble")],
      adultosDeclarados: 2 + 3 + 2,
      edades: [],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(
      r.habitaciones.map((h) => h.id),
      ["doble-0", "triple-0", "doble-1"]
    );
    assert.deepEqual(
      r.habitaciones.map((h) => h.acom),
      ["doble", "triple", "doble"]
    );
  });

  test("los adultos de cada habitación son SIEMPRE su pax_tarifa (la fórmula de precio por habitación no cambia)", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("triple", { pax_max: 5 })],
      adultosDeclarados: 3,
      edades: [4],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones[0].adultos, 3);
  });

  test("más niños que capacidad: se rechaza como selección inválida (razón honesta para no anunciar disponibilidad)", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")], // capacidad efectiva de niño = 2
      adultosDeclarados: 2,
      edades: [5, 6, 7],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "seleccion_invalida");
  });

  test("adults_only no se decide acá (es del hotel, no de la ocupación): con holgura, un menor entra sin drama", () => {
    // La restricción Adults Only se aplica en la Server Action ANTES de
    // llamar este módulo — acá se comprueba que el módulo no la duplica ni la
    // inventa a partir de la config.
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")],
      adultosDeclarados: 2,
      edades: [9],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.ninos, 1);
  });

  test("nunca lanza y siempre devuelve una unión discriminada (contrato estable para el llamador)", () => {
    const casos: unknown[] = [
      { habitaciones: [], adultosDeclarados: 0, edades: [], infanteMax: 2, ninoMax: 10 },
    ];
    for (const c of casos) {
      const r = repartirMenoresEnHabitaciones(c as Parameters<typeof repartirMenoresEnHabitaciones>[0]);
      assert.equal(typeof r.ok, "boolean");
      if (!r.ok) assert.equal(typeof r.error, "string");
    }
  });
});

describe("repartirMenoresEnHabitaciones — la configuración del hotel manda sobre la clasificación", () => {
  test("los umbrales son los del HOTEL recibidos por parámetro (un hotel con infanteMax alto manda al niño a infante)", () => {
    const edades = [6];
    const comoNino = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")],
      adultosDeclarados: 2,
      edades,
      infanteMax: 2,
      ninoMax: 10,
    });
    const comoInfante = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")],
      adultosDeclarados: 2,
      edades,
      infanteMax: 6,
      ninoMax: 12,
    });
    assert.equal(comoNino.ok, true);
    assert.equal(comoInfante.ok, true);
    if (!comoNino.ok || !comoInfante.ok) return;
    assert.equal(comoNino.ninos, 1);
    assert.equal(comoNino.infantes, 0);
    assert.equal(comoInfante.infantes, 1);
    assert.equal(comoInfante.ninos, 0);
  });

  test("una config incoherente del catálogo sale como configuracion_invalida (no se disfraza de 'no disponible')", () => {
    // `pax_max` menor que `pax_tarifa` es un catálogo mal cargado: falla
    // siempre igual, sin importar lo que pidió el cliente.
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [{ acom: "doble", config: { ...defaultAcomConfig("doble"), pax_max: 1 } }],
      adultosDeclarados: 2,
      edades: [],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "configuracion_invalida");
  });
});

describe("repartirMenoresEnHabitaciones — forma del resultado", () => {
  test("cada habitación trae EXACTAMENTE los campos que exige el Caso C del adaptador (+ acom, que permite revalidar)", () => {
    const r = repartirMenoresEnHabitaciones({
      habitaciones: [hab("doble")],
      adultosDeclarados: 2,
      edades: [8],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(Object.keys(r.habitaciones[0]).sort(), ["acom", "adultos", "edadesMenores", "id"]);
  });

  test("no muta la entrada (la lista de habitaciones consultadas queda igual)", () => {
    const habitaciones = [hab("doble")];
    const copia = JSON.parse(JSON.stringify(habitaciones)) as HabitacionBusqueda[];
    repartirMenoresEnHabitaciones({
      habitaciones,
      adultosDeclarados: 2,
      edades: [3],
      infanteMax: INFANTE_MAX,
      ninoMax: NINO_MAX,
    });
    assert.deepEqual(habitaciones, copia);
  });
});

// Guarda contra el drift más caro de este puente: si el módulo dejara de
// delegar el reparto en `distribuirPorHabitaciones` y lo reimplementara, la
// búsqueda empezaría a aceptar ocupaciones que la cotización real rechaza.
describe("repartoMenoresBusqueda.ts — delega, no reimplementa", () => {
  const fuente = readFileSync(new URL("../lib/reservar/repartoMenoresBusqueda.ts", import.meta.url), "utf8");
  // El módulo EXPLICA en su cabecera por qué existe (menciona la cotización y
  // el motor) — las guardas de abajo son sobre el CÓDIGO, no sobre la prosa.
  const codigo = fuente
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*/.test(l))
    .join("\n");

  test("usa la clasificación de edad y el reparto del motor existente", () => {
    assert.match(codigo, /distribuirPorHabitaciones\(/);
    assert.doesNotMatch(codigo, /createClient|createAdminClient|supabase/i);
    assert.doesNotMatch(codigo, /"use server"|"use client"/);
  });

  test("no arrastra la lógica de cotización (solo el TIPO del adaptador)", () => {
    assert.match(codigo, /import type \{ HabitacionConEdadesExplicitas \}/);
    assert.doesNotMatch(codigo, /cotizar|computarReserva/);
  });
});

// Referencia viva: `defaultAcomConfig` es el fallback que usa la Server
// Action cuando el hotel no configuró una acomodación. Si su forma cambiara,
// el reparto de arriba dejaría de ser representativo.
describe("insumo: defaultAcomConfig", () => {
  test("doble por defecto = 2 adultos, sin holgura para menores (pax_max === pax_tarifa)", () => {
    const c: AcomConfig = defaultAcomConfig("doble");
    assert.equal(c.pax_tarifa, 2);
    assert.equal(c.pax_max, 2);
  });
});
