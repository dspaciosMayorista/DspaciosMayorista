import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AcomConfig } from "../lib/acomodaciones.ts";
import type { ComboCotizado } from "../lib/reservar/liquidacionHotel.ts";
import {
  asignarHabitacionesHotel, candidatosDeReparto, clasificarMenoresDeHotel, repartoEstandar, validarOcupacionGlobal,
} from "../lib/reservar/asignacionHabitacionesBusqueda.ts";
import { evaluarComposicionHotel, type EntradaComposicion } from "../lib/reservar/composicionHotelBusqueda.ts";

// #102 — Ocupación de la búsqueda general con datos SINTÉTICOS: reparto por hotel,
// edades por hotel (15 años = adulto en un hotel y niño en otro), conservación de
// viajeros y desglose que suma exactamente el total.

const CFG: AcomConfig[] = [
  { acomodacion: "sencilla", pax_tarifa: 1, pax_max: 2, adt_min: 1, adt_max: 1, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 },
  { acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 2, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
  { acomodacion: "triple", pax_tarifa: 3, pax_max: 4, adt_min: 3, adt_max: 3, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 },
  { acomodacion: "multiple", pax_tarifa: 4, pax_max: 5, adt_min: 4, adt_max: 4, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 },
];

function combo(over: Partial<ComboCotizado> = {}): ComboCotizado {
  return {
    categoria: "Estándar", regimen: "PAM",
    precios: { sencilla: 100, doble: 90, triple: 80, multiple: 70, nino: 50, nino2: 40, infante: 10 },
    preciosMenor2: { nino: 5, nino2: 5, infante: 7 },
    temporadasTarifaPorAcom: {}, ...over,
  };
}

function entrada(over: Partial<EntradaComposicion> & { ninoMax?: number }): EntradaComposicion {
  const { ninoMax = 12, ...rest } = over;
  return {
    res: { combos: [combo()], serviciosGrupoIncluidos: [] },
    filasTarifa: [], pctMk: 0.2, numNoches: 3, adultos: 2, edades: [], reglasAcom: CFG,
    generalEdad: { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax },
    numHabitaciones: 1, ...rest,
  };
}

describe("normalización global", () => {
  test("rechaza lo imposible para cualquier hotel y no decide edades ni tipos", () => {
    assert.equal(validarOcupacionGlobal({ numHabitaciones: 0, adultos: 2, cantidadMenores: 0, maxHabitaciones: 8 }).ok, false);
    assert.equal(validarOcupacionGlobal({ numHabitaciones: 9, adultos: 9, cantidadMenores: 0, maxHabitaciones: 8 }).ok, false);
    assert.equal(validarOcupacionGlobal({ numHabitaciones: 1.5, adultos: 2, cantidadMenores: 0, maxHabitaciones: 8 }).ok, false);
    assert.equal(validarOcupacionGlobal({ numHabitaciones: 3, adultos: 2, cantidadMenores: 0, maxHabitaciones: 8 }).ok, false);
    // 2 adultos + 1 menor en 3 habitaciones: posible en teoría si el hotel trata al menor como adulto.
    assert.equal(validarOcupacionGlobal({ numHabitaciones: 3, adultos: 2, cantidadMenores: 1, maxHabitaciones: 8 }).ok, true);
  });
  test("el reparto estándar es orientación, no veredicto", () => {
    assert.equal(repartoEstandar(1, 2).ok && (repartoEstandar(1, 2) as { texto: string }).texto, "1 Doble");
    assert.equal(repartoEstandar(1, 5).ok, false);
  });
});

describe("reparto de habitaciones por hotel", () => {
  const opc = (acoms: string[]) => CFG.filter((c) => acoms.includes(c.acomodacion)).map((c) => ({ acom: c.acomodacion, config: c }));
  test("1 hab: 2→doble, 3→triple, 4→múltiple solo si el hotel lo vende", () => {
    const todas = opc(["sencilla", "doble", "triple", "multiple"]);
    const dos = asignarHabitacionesHotel({ numHabitaciones: 1, adultosTarifa: 2, ninos: 0, infantes: 0, opciones: todas });
    assert.ok(dos.ok && dos.porAcom.doble === 1);
    const tres = asignarHabitacionesHotel({ numHabitaciones: 1, adultosTarifa: 3, ninos: 0, infantes: 0, opciones: todas });
    assert.ok(tres.ok && tres.porAcom.triple === 1);
    const cuatro = asignarHabitacionesHotel({ numHabitaciones: 1, adultosTarifa: 4, ninos: 0, infantes: 0, opciones: todas });
    assert.ok(cuatro.ok && cuatro.porAcom.multiple === 1);
    const sinMultiple = asignarHabitacionesHotel({ numHabitaciones: 1, adultosTarifa: 4, ninos: 0, infantes: 0, opciones: opc(["sencilla", "doble", "triple"]) });
    assert.equal(sinMultiple.ok, false);
    assert.equal(!sinMultiple.ok && sinMultiple.tipo, "sin_reparto_adultos");
  });
  test("varias habitaciones: conserva exactamente a los adultos y prefiere el reparto más parejo", () => {
    const todas = opc(["sencilla", "doble", "triple", "multiple"]);
    const a = asignarHabitacionesHotel({ numHabitaciones: 2, adultosTarifa: 4, ninos: 0, infantes: 0, opciones: todas });
    assert.ok(a.ok && a.porAcom.doble === 2, "4 adultos en 2 habitaciones → 2 Dobles");
    const b = asignarHabitacionesHotel({ numHabitaciones: 2, adultosTarifa: 3, ninos: 0, infantes: 0, opciones: todas });
    assert.ok(b.ok && b.porAcom.doble === 1 && b.porAcom.sencilla === 1);
    for (const [n, ad] of [[3, 5], [3, 7], [2, 6], [4, 8]] as const) {
      const r = asignarHabitacionesHotel({ numHabitaciones: n, adultosTarifa: ad, ninos: 0, infantes: 0, opciones: todas });
      assert.ok(r.ok, `${ad} adultos en ${n} habitaciones`);
      assert.equal(r.ok && r.habitaciones.reduce((s, h) => s + h.adultos, 0), ad);
      assert.equal(r.ok && r.habitaciones.length, n);
    }
    assert.equal(asignarHabitacionesHotel({ numHabitaciones: 2, adultosTarifa: 9, ninos: 0, infantes: 0, opciones: todas }).ok, false);
  });
  test("un reparto genérico no excluye a un hotel con otra configuración válida", () => {
    // Este hotel define la «doble» para 3 adultos y no vende triple.
    const raro = [{ acom: "doble" as const, config: { ...CFG[1], pax_tarifa: 3, adt_min: 3, adt_max: 3, pax_max: 4 } }];
    assert.equal(repartoEstandar(1, 3).ok && (repartoEstandar(1, 3) as { texto: string }).texto, "1 Triple");
    const r = asignarHabitacionesHotel({ numHabitaciones: 1, adultosTarifa: 3, ninos: 0, infantes: 0, opciones: raro });
    assert.ok(r.ok && r.porAcom.doble === 1);
  });
  test("el orden de candidatos es determinista", () => {
    const todas = opc(["sencilla", "doble", "triple", "multiple"]);
    const a = candidatosDeReparto(3, 5, todas).map((c) => c.map((o) => o.acom).join("+"));
    const b = candidatosDeReparto(3, 5, [...todas].reverse()).map((c) => c.map((o) => o.acom).join("+"));
    assert.deepEqual(a, b);
    assert.equal(a[0], "doble+doble+sencilla");
  });
});

describe("edades por hotel — fronteras 2/3, 12/13, 15 y 17", () => {
  test("infante, niño y tarifa de adulto según el umbral del hotel", () => {
    const c = clasificarMenoresDeHotel([2, 3, 12, 13, 17], 2, 12, true);
    assert.ok(c.ok);
    assert.deepEqual(c.ok && c.infantes, [2]);
    assert.deepEqual(c.ok && c.ninos, [3, 12]);
    assert.deepEqual(c.ok && c.comoAdulto, [13, 17]);
    const t = clasificarMenoresDeHotel([15, 17], 2, 17, true);
    assert.deepEqual(t.ok && t.comoAdulto, []);
    assert.deepEqual(t.ok && t.ninos, [15, 17]);
    // flujo heredado: rechaza, nunca reescribe
    assert.equal(clasificarMenoresDeHotel([15], 2, 12, false).ok, false);
  });
});

describe("2 adultos + menor de 15 años + 1 habitación: depende de cada hotel", () => {
  test("Hotel A (niño hasta 12) cobra TRES adultos en triple; Hotel B (niño hasta 17) cobra doble + Niño 1", () => {
    const a = evaluarComposicionHotel(entrada({ ninoMax: 12, edades: [15] }));
    assert.equal(a.combos.length, 1);
    const ca = a.combos[0];
    assert.deepEqual(ca.habitaciones, { triple: 1 });
    assert.equal(ca.total, 3 * 80);
    assert.equal(ca.pax, 3);
    assert.deepEqual(ca.edadesComoAdulto, [15], "se conserva la edad real del pasajero");
    assert.deepEqual(ca.edadesMenores, []);
    assert.equal(ca.desglose.length, 1);
    assert.equal(ca.desglose[0].clase, "adulto");
    assert.equal(ca.desglose[0].cantidad, 3);

    const b = evaluarComposicionHotel(entrada({ ninoMax: 17, edades: [15] }));
    const cb = b.combos[0];
    assert.deepEqual(cb.habitaciones, { doble: 1 });
    assert.equal(cb.total, 2 * 90 + 50);
    assert.deepEqual(cb.edadesComoAdulto, []);
    assert.deepEqual(cb.edadesMenores, [15]);
    assert.equal(cb.menores.nino, 1);
    assert.deepEqual(cb.desglose.map((l) => l.clase), ["adulto", "nino"]);
    assert.deepEqual(cb.desglose[1].edades, [15]);
  });
  test("Hotel A sin triple: se explica el motivo real en vez de excluir en silencio", () => {
    const sinTriple = combo({ precios: { sencilla: 100, doble: 90, nino: 50, nino2: 40, infante: 10 } });
    const r = evaluarComposicionHotel(entrada({ ninoMax: 12, edades: [15], res: { combos: [sinTriple], serviciosGrupoIncluidos: [] } }));
    assert.equal(r.combos.length, 0);
    assert.match(r.rechazos[0], /3 adulto\(s\) no se pueden repartir en 1 habitación/);
  });
  test("flujo heredado con habitaciones explícitas rechaza una edad de adulto", () => {
    const r = evaluarComposicionHotel(entrada({ ninoMax: 12, edades: [15], numHabitaciones: undefined, habitacionesExplicitas: [{ acom: "doble" }] }));
    assert.equal(r.combos.length, 0);
    assert.match(r.rechazos[0], /corresponde a tarifa de adulto/);
  });
  test("flujo heredado conserva el total de siempre", () => {
    const r = evaluarComposicionHotel(entrada({ ninoMax: 17, edades: [8], numHabitaciones: undefined, habitacionesExplicitas: [{ acom: "doble" }] }));
    assert.equal(r.combos[0].total, 2 * 90 + 50);
  });
});

describe("varios menores con tarifas distintas y desglose exacto", () => {
  test("infante, Niño 1 y Niño 2 en una doble; el desglose suma el total", () => {
    const r = evaluarComposicionHotel(entrada({ ninoMax: 12, edades: [1, 5, 8] }));
    const c = r.combos[0];
    assert.deepEqual(c.habitaciones, { doble: 1 });
    assert.equal(c.menores.infantes + c.menores.nino + c.menores.nino2, 3);
    assert.equal(c.desglose.reduce((s, l) => s + l.subtotal, 0), c.total);
    const clases = c.desglose.map((l) => `${l.clase}${l.menorDeDos ? "<2" : ""}`);
    assert.deepEqual(clases, ["adulto", "infante<2", "nino", "nino2"]);
    // El menor de 1 año usa su tarifa propia de menor de 2 (7), no la de infante «a secas» (10).
    assert.equal(c.desglose[1].tarifa, 7);
    assert.deepEqual(c.desglose[1].edades, [1]);
    assert.deepEqual(c.desglose[2].edades, [5]);
    assert.deepEqual(c.desglose[3].edades, [8]);
  });
  test("no inventa tarifas de niño: sin Niño 2 publicado el combo no se ofrece", () => {
    const sinN2 = combo({ precios: { sencilla: 100, doble: 90, triple: 80, nino: 50, infante: 10 } });
    const r = evaluarComposicionHotel(entrada({ ninoMax: 12, edades: [5, 8], res: { combos: [sinN2], serviciosGrupoIncluidos: [] } }));
    assert.equal(r.combos.length, 0);
  });
  test("distintas acomodaciones con tarifas distintas no se promedian", () => {
    const r = evaluarComposicionHotel(entrada({ numHabitaciones: 2, adultos: 3 }));
    const c = r.combos[0];
    assert.deepEqual(c.habitaciones, { doble: 1, sencilla: 1 });
    assert.deepEqual(c.desglose.map((l) => [l.cantidad, l.tarifa]), [[1, 100], [2, 90]]);
    assert.equal(c.total, 2 * 90 + 100);
  });
  test("misma tarifa en acomodaciones distintas se agrupa en una sola línea", () => {
    const igual = combo({ precios: { sencilla: 90, doble: 90, triple: 80, nino: 50, nino2: 40, infante: 10 } });
    const r = evaluarComposicionHotel(entrada({ numHabitaciones: 2, adultos: 3, res: { combos: [igual], serviciosGrupoIncluidos: [] } }));
    assert.equal(r.combos[0].desglose.length, 1);
    assert.equal(r.combos[0].desglose[0].cantidad, 3);
  });
});

describe("conservación de viajeros", () => {
  test("adultos + menores = pax con silla + infantes, para varias composiciones", () => {
    const casos: [number, number, number[], number][] = [[1, 2, [], 12], [1, 2, [15], 12], [2, 3, [4], 12], [2, 2, [1, 9, 15], 17], [3, 5, [6], 12], [1, 2, [1], 12]];
    for (const [hab, adultos, edades, ninoMax] of casos) {
      const r = evaluarComposicionHotel(entrada({ numHabitaciones: hab, adultos, edades, ninoMax }));
      for (const c of r.combos) {
        const personas = adultos + edades.length;
        const asign = c.asignacion;
        const adultosAsignados = asign.reduce((s, h) => s + h.adultos, 0);
        const menoresAsignados = asign.reduce((s, h) => s + h.nino + h.nino2 + h.infantes, 0);
        assert.equal(adultosAsignados + menoresAsignados, personas, JSON.stringify([hab, adultos, edades, ninoMax]));
        assert.equal(asign.length, hab);
        assert.equal(c.desglose.reduce((s, l) => s + l.subtotal, 0), c.total);
      }
    }
  });
});

describe("política de edades incompleta o ambigua: se señala, no se inventa", () => {
  const fila = (temporada: string, ninoMax: number) => ({
    tipo_habitacion: "Estándar", alimentacion: "PAM", temporada, edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: ninoMax,
  });
  test("la fila de tarifa que el motor dice haber usado no existe: el combo se descarta y se marca para revisión", () => {
    const c = combo({ temporadasTarifaPorAcom: { doble: ["ALTA"], triple: ["ALTA"] } });
    const r = evaluarComposicionHotel(entrada({ res: { combos: [c], serviciosGrupoIncluidos: [] }, edades: [8], filasTarifa: [] }));
    assert.equal(r.combos.length, 0);
    assert.equal(r.falloReglaEdad, true);
  });
  test("dos filas para la misma temporada (configuración duplicada) tampoco se resuelven por la mitad", () => {
    const c = combo({ temporadasTarifaPorAcom: { doble: ["ALTA"] } });
    const r = evaluarComposicionHotel(entrada({ res: { combos: [c], serviciosGrupoIncluidos: [] }, edades: [8], filasTarifa: [fila("ALTA", 12), fila("ALTA", 17)] }));
    assert.equal(r.falloReglaEdad, true);
    assert.equal(r.combos.length, 0);
  });
  test("cada tipo de habitación usa la regla de SU temporada: nunca se mezclan dos reglas para decidir a un mismo menor", () => {
    // Doble liquida en ALTA (niño hasta 12) y Triple en BAJA (niño hasta 17). Con 2 adultos + 15 años en 1 habitación:
    // en Doble el menor sería adulto (necesita Triple) y en Triple sería niño (necesita Doble): ninguna combinación es coherente.
    const c = combo({ categoria: "Estándar", regimen: "PAM", temporadasTarifaPorAcom: { doble: ["ALTA"], triple: ["BAJA"] } });
    const r = evaluarComposicionHotel(entrada({ res: { combos: [c], serviciosGrupoIncluidos: [] }, edades: [15], filasTarifa: [fila("ALTA", 12), fila("BAJA", 17)] }));
    assert.equal(r.combos.length, 0);
    assert.ok(r.rechazos.length > 0, "se explica el motivo");
    // Con un menor de 8 años la regla no cambia la clasificación (niño en ambas): se evalúa normalmente en Doble.
    const ok = evaluarComposicionHotel(entrada({ res: { combos: [c], serviciosGrupoIncluidos: [] }, edades: [8], filasTarifa: [fila("ALTA", 12), fila("BAJA", 17)] }));
    assert.deepEqual(ok.combos[0]?.habitaciones, { doble: 1 });
  });
  test("sin menores el reparto no depende de la regla de edad", () => {
    const r = evaluarComposicionHotel(entrada({ edades: [] }));
    assert.deepEqual(r.combos[0].habitaciones, { doble: 1 });
    assert.equal(r.combos[0].desglose.length, 1);
  });
});
