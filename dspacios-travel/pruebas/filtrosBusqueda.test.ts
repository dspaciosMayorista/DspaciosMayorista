import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  filtrosBusquedaVacios,
  hayFiltroBusquedaActivo,
  personaCoincideFiltros,
  unidadCoincideFiltros,
  type FiltrosBusquedaBooking,
} from "../lib/tarifario/filtrosBusqueda.ts";
import { claveOferta, ofertasConPrioridad, seleccionarRecomendadosPorDestino } from "../lib/tarifario/recomendados.ts";
import type { BusquedaResultado } from "../lib/reservar/cotizar.ts";
import type { OpcionUnidadConfirmada } from "../lib/tarifario/evaluarDisponibilidadUnidad.ts";

// ── Fixtures sintéticos ──────────────────────────────────────────────────

function combo(categoria: string, regimen: string, total: number, menores: { nino?: number; nino2?: number } = {}) {
  return {
    categoria, regimen, total, pax: 2,
    menores: { infantes: 0, nino: menores.nino ?? 0, nino2: menores.nino2 ?? 0 },
  };
}

function resultado(over: Partial<BusquedaResultado> & { hotelId: number; paqueteId: number }): BusquedaResultado {
  return {
    hotelId: over.hotelId,
    hotelNombre: over.hotelNombre ?? `Hotel ${over.hotelId}`,
    destino: over.destino ?? "Cartagena",
    paqueteId: over.paqueteId,
    categoria: over.categoria ?? "Estandar",
    regimen: over.regimen ?? "Desayuno",
    paqueteNombre: over.paqueteNombre ?? `Paquete ${over.paqueteId}`,
    total: over.total ?? 500000,
    noches: 3,
    fechaIda: "2026-10-15",
    fechaRegreso: "2026-10-18",
    habitaciones: over.habitaciones ?? { doble: 1 },
    menores: over.menores ?? { infantes: 0, nino: 0, nino2: 0 },
    edadesMenores: [],
    pax: 2,
    combos: over.combos ?? [combo(over.categoria ?? "Estandar", over.regimen ?? "Desayuno", over.total ?? 500000)],
    condicion: null,
  };
}

function opcion(over: Partial<OpcionUnidadConfirmada> & { hotelId: number; paqueteId: number }): OpcionUnidadConfirmada {
  return {
    hotelId: over.hotelId,
    hotelNombre: over.hotelNombre ?? `Hotel unidad ${over.hotelId}`,
    paqueteId: over.paqueteId,
    paqueteNombre: over.paqueteNombre ?? `Paquete ${over.paqueteId}`,
    destinoNombre: over.destinoNombre ?? "Cartagena",
    categoria: over.categoria ?? "Estandar",
    alimentacion: over.alimentacion ?? "Desayuno",
    moneda: "COP",
    precioVenta: over.precioVenta ?? 400000,
    paxTotal: 2,
    fechaIda: "2026-10-15",
    fechaRegreso: "2026-10-18",
    ocupacion: [{ id: "h1", acom: "doble", adultos: 2, edadesMenores: [] }],
  };
}

const SIN_FILTRO: FiltrosBusquedaBooking = filtrosBusquedaVacios();

describe("filtrosBusquedaVacios / hayFiltroBusquedaActivo", () => {
  test("sin filtros: hayFiltroBusquedaActivo es false", () => {
    assert.equal(hayFiltroBusquedaActivo(filtrosBusquedaVacios()), false);
  });
  test("cualquier campo activo lo vuelve true", () => {
    assert.equal(hayFiltroBusquedaActivo({ ...SIN_FILTRO, texto: "abc" }), true);
    assert.equal(hayFiltroBusquedaActivo({ ...SIN_FILTRO, categoria: "Superior" }), true);
    assert.equal(hayFiltroBusquedaActivo({ ...SIN_FILTRO, regimen: "Todo incluido" }), true);
    assert.equal(hayFiltroBusquedaActivo({ ...SIN_FILTRO, acomodacion: "doble" }), true);
  });
  test("texto en blanco (solo espacios) NO cuenta como filtro activo", () => {
    assert.equal(hayFiltroBusquedaActivo({ ...SIN_FILTRO, texto: "   " }), false);
  });
});

describe("personaCoincideFiltros — GLOBAL (sin filtros)", () => {
  test("sin ningún filtro, cualquier resultado coincide, no fuerza combo y NO restringe el selector interno", () => {
    const r = resultado({ hotelId: 1, paqueteId: 10 });
    const m = personaCoincideFiltros(r, SIN_FILTRO);
    assert.deepEqual(m, { coincide: true, comboForzado: null, combosRestringidos: null });
  });
});

describe("personaCoincideFiltros — Buscar hotel (texto)", () => {
  test("coincide por nombre de hotel (case-insensitive)", () => {
    const r = resultado({ hotelId: 1, paqueteId: 10, hotelNombre: "Hotel Almirante Cartagena" });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, texto: "almirante" });
    assert.equal(m.coincide, true);
  });
  test("coincide por nombre de PAQUETE, no solo de hotel", () => {
    const r = resultado({ hotelId: 1, paqueteId: 10, hotelNombre: "Otro Hotel", paqueteNombre: "Promo 3x2" });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, texto: "3x2" });
    assert.equal(m.coincide, true);
  });
  test("no coincide si el texto no aparece en ningún lado", () => {
    const r = resultado({ hotelId: 1, paqueteId: 10, hotelNombre: "Hotel X", paqueteNombre: "Paquete Y" });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, texto: "zzz" });
    assert.equal(m.coincide, false);
  });
});

describe("personaCoincideFiltros — Categoría / Alimentación (combos)", () => {
  test("combo por defecto YA cumple el filtro: coincide, y el 'forzado' resuelve exactamente al mismo combo por defecto (mismo resultado visual, calculado con una sola regla)", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, categoria: "Superior", regimen: "Desayuno", total: 500000,
      combos: [combo("Superior", "Desayuno", 500000), combo("Superior", "Todo incluido", 700000)],
    });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, categoria: "Superior" });
    assert.equal(m.coincide, true);
    assert.ok(m.coincide);
    // Con filtro de categoría/alimentación activo, la función SIEMPRE
    // resuelve el combo más barato entre los válidos (nunca distingue "ya
    // era el de siempre" de "hubo que cambiarlo") — acá coincide con el
    // default porque el default YA era el más barato que cumple.
    assert.deepEqual(m.comboForzado, { categoria: "Superior", regimen: "Desayuno", total: 500000 });
    // Contrato de restricción: con categoría activa, el selector interno de
    // la tarjeta queda limitado a los DOS combos "Superior" — nunca a los 2
    // originales si alguno no fuera "Superior" (acá los dos SÍ lo son, así
    // que el restringido coincide con la lista completa, pero por construir
    // el subconjunto, no por casualidad).
    assert.deepEqual(m.combosRestringidos, [
      { categoria: "Superior", regimen: "Desayuno", total: 500000 },
      { categoria: "Superior", regimen: "Todo incluido", total: 700000 },
    ]);
  });

  test("SIN ningún filtro de categoría/alimentación/niño, nunca se calcula combo forzado ni se restringe el selector (aunque haya varios combos)", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, categoria: "Superior", regimen: "Desayuno", total: 500000,
      combos: [combo("Superior", "Desayuno", 500000), combo("Superior", "Todo incluido", 700000)],
    });
    const m = personaCoincideFiltros(r, SIN_FILTRO);
    assert.deepEqual(m, { coincide: true, comboForzado: null, combosRestringidos: null });
  });

  test("el combo por defecto NO cumple pero otro combo del mismo hotel sí: fuerza ESE combo (el más barato entre los que cumplen) y RESTRINGE el selector a los combos que sí cumplen — el combo excluido no puede volver a elegirse dentro de la tarjeta", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, categoria: "Estandar", regimen: "Desayuno", total: 400000,
      combos: [
        combo("Estandar", "Desayuno", 400000), // default, no cumple "Superior"
        combo("Superior", "Desayuno", 600000),
        combo("Superior", "Todo incluido", 900000),
      ],
    });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, categoria: "Superior" });
    assert.equal(m.coincide, true);
    assert.ok(m.coincide);
    // El más barato entre los que cumplen "Superior" es el de Desayuno (600000).
    assert.deepEqual(m.comboForzado, { categoria: "Superior", regimen: "Desayuno", total: 600000 });
    // "Estandar" (el default original) queda AFUERA del selector restringido
    // — el usuario no puede, dentro de la tarjeta, volver a un combo que el
    // filtro de arriba ya descartó.
    assert.deepEqual(m.combosRestringidos, [
      { categoria: "Superior", regimen: "Desayuno", total: 600000 },
      { categoria: "Superior", regimen: "Todo incluido", total: 900000 },
    ]);
    assert.ok(!m.combosRestringidos!.some((c) => c.categoria === "Estandar"), "Estandar no debe quedar seleccionable");
  });

  test("categoría Y régimen combinados: exige AMBOS en el MISMO combo, nunca mezclar de dos combos distintos, y restringe a un ÚNICO combo elegible", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, categoria: "Estandar", regimen: "Desayuno", total: 400000,
      combos: [
        combo("Estandar", "Desayuno", 400000),
        combo("Superior", "Desayuno", 600000),
        combo("Superior", "Todo incluido", 900000),
      ],
    });
    // "Superior" + "Todo incluido" SÍ coexisten en un combo real (900000).
    const okAmbos = personaCoincideFiltros(r, { ...SIN_FILTRO, categoria: "Superior", regimen: "Todo incluido" });
    assert.equal(okAmbos.coincide, true);
    assert.ok(okAmbos.coincide);
    assert.deepEqual(okAmbos.comboForzado, { categoria: "Superior", regimen: "Todo incluido", total: 900000 });
    // Con categoría Y régimen fijos, solo puede sobrevivir un combo — el
    // selector queda con una sola opción posible, sin margen para "volver"
    // a Desayuno o a Estandar.
    assert.deepEqual(okAmbos.combosRestringidos, [{ categoria: "Superior", regimen: "Todo incluido", total: 900000 }]);
  });

  test("categoría existe pero NO con el régimen pedido: sin coincidencia (cero combos válidos)", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, categoria: "Estandar", regimen: "Desayuno", total: 400000,
      combos: [combo("Estandar", "Desayuno", 400000), combo("Superior", "Desayuno", 600000)],
    });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, categoria: "Superior", regimen: "Todo incluido" });
    assert.deepEqual(m, { coincide: false });
  });

  test("categoría inexistente en ningún combo: sin coincidencia", () => {
    const r = resultado({ hotelId: 1, paqueteId: 10 });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, categoria: "Presidencial" });
    assert.equal(m.coincide, false);
  });
});

describe("personaCoincideFiltros — Acomodación (habitaciones)", () => {
  test("la composición buscada SÍ incluye la habitación pedida: coincide, sin forzar combo ni restringir el selector (Acomodación por habitación no acota combos)", () => {
    const r = resultado({ hotelId: 1, paqueteId: 10, habitaciones: { doble: 1 } });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, acomodacion: "doble" });
    assert.deepEqual(m, { coincide: true, comboForzado: null, combosRestringidos: null });
  });
  test("la composición buscada NO incluye la habitación pedida: sin coincidencia (gate global, no por hotel)", () => {
    const r = resultado({ hotelId: 1, paqueteId: 10, habitaciones: { doble: 1 } });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, acomodacion: "triple" });
    assert.deepEqual(m, { coincide: false });
  });
  test("Acomodación=Niño 1: exige un combo con menores.nino > 0 (varía por combo, no por habitación)", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, categoria: "Estandar", regimen: "Desayuno", total: 400000,
      combos: [combo("Estandar", "Desayuno", 400000, {}), combo("Estandar", "Todo incluido", 550000, { nino: 1 })],
    });
    const sinNino = personaCoincideFiltros(r, { ...SIN_FILTRO, acomodacion: "nino" });
    assert.equal(sinNino.coincide, true);
    assert.ok(sinNino.coincide);
    assert.deepEqual(sinNino.comboForzado, { categoria: "Estandar", regimen: "Todo incluido", total: 550000 });
    // El combo sin niño ("Desayuno") también queda excluido del selector:
    // eligió Acomodación=Niño1 arriba, así que dentro de la tarjeta solo
    // puede ofrecerse el combo que SÍ trae Niño 1.
    assert.deepEqual(sinNino.combosRestringidos, [{ categoria: "Estandar", regimen: "Todo incluido", total: 550000 }]);
  });
  test("Acomodación=Niño 2 sin ningún combo que lo tenga: sin coincidencia", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10,
      combos: [combo("Estandar", "Desayuno", 400000, { nino: 1 })],
    });
    const m = personaCoincideFiltros(r, { ...SIN_FILTRO, acomodacion: "nino2" });
    assert.deepEqual(m, { coincide: false });
  });
});

describe("personaCoincideFiltros — combinados (texto + categoría + acomodación)", () => {
  test("todos los criterios deben cumplirse a la vez", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, hotelNombre: "Hotel Caribe", habitaciones: { doble: 1 },
      combos: [combo("Estandar", "Desayuno", 400000), combo("Superior", "Desayuno", 600000)],
    });
    const okTodos = personaCoincideFiltros(r, { texto: "caribe", categoria: "Superior", regimen: "", acomodacion: "doble" });
    assert.equal(okTodos.coincide, true);
    const fallaTexto = personaCoincideFiltros(r, { texto: "zzz", categoria: "Superior", regimen: "", acomodacion: "doble" });
    assert.equal(fallaTexto.coincide, false);
    const fallaAcom = personaCoincideFiltros(r, { texto: "caribe", categoria: "Superior", regimen: "", acomodacion: "triple" });
    assert.equal(fallaAcom.coincide, false);
  });
});

describe("unidadCoincideFiltros — modelo unidad (Bernalo)", () => {
  function grupo(opciones: OpcionUnidadConfirmada[]) {
    return { hotelId: opciones[0].hotelId, paqueteId: opciones[0].paqueteId, opciones };
  }

  test("sin filtros: coincide, sin forzar opción ni restringir el selector", () => {
    const g = grupo([opcion({ hotelId: 1, paqueteId: 10 })]);
    const m = unidadCoincideFiltros(g, SIN_FILTRO);
    assert.deepEqual(m, { coincide: true, opcionForzada: null, opcionesRestringidas: null });
  });

  test("Acomodación activa (CUALQUIER valor): excluye el grupo completo — el modelo unidad no tiene esa columna", () => {
    const g = grupo([opcion({ hotelId: 1, paqueteId: 10 })]);
    for (const valor of ["sencilla", "doble", "triple", "multiple", "nino", "nino2"]) {
      const m = unidadCoincideFiltros(g, { ...SIN_FILTRO, acomodacion: valor });
      assert.deepEqual(m, { coincide: false }, `acomodacion=${valor} debería excluir unidad`);
    }
  });

  test("Buscar hotel: coincide por nombre de hotel o de paquete", () => {
    const g = grupo([opcion({ hotelId: 1, paqueteId: 10, hotelNombre: "Decameron Barú", paqueteNombre: "Todo incluido" })]);
    assert.equal(unidadCoincideFiltros(g, { ...SIN_FILTRO, texto: "decameron" }).coincide, true);
    assert.equal(unidadCoincideFiltros(g, { ...SIN_FILTRO, texto: "todo incluido" }).coincide, true);
    assert.equal(unidadCoincideFiltros(g, { ...SIN_FILTRO, texto: "zzz" }).coincide, false);
  });

  test("Categoría/Alimentación: la opción por defecto (más barata) no cumple pero otra sí — fuerza la más barata de las que cumplen", () => {
    const barata = opcion({ hotelId: 1, paqueteId: 10, categoria: "Estandar", alimentacion: "Desayuno", precioVenta: 300000 });
    const media = opcion({ hotelId: 1, paqueteId: 10, categoria: "Superior", alimentacion: "Desayuno", precioVenta: 500000 });
    const cara = opcion({ hotelId: 1, paqueteId: 10, categoria: "Superior", alimentacion: "Todo incluido", precioVenta: 800000 });
    const g = grupo([barata, media, cara]);
    const m = unidadCoincideFiltros(g, { ...SIN_FILTRO, categoria: "Superior" });
    assert.equal(m.coincide, true);
    assert.ok(m.coincide);
    assert.equal(m.opcionForzada?.precioVenta, 500000);
    assert.equal(m.opcionForzada?.alimentacion, "Desayuno");
    // La opción "Estandar" (barata) queda FUERA del selector restringido —
    // el usuario no puede volver a "Estandar" dentro de la tarjeta.
    assert.deepEqual(m.opcionesRestringidas, [media, cara]);
  });

  test("Categoría inexistente en el grupo: sin coincidencia", () => {
    const g = grupo([opcion({ hotelId: 1, paqueteId: 10, categoria: "Estandar" })]);
    const m = unidadCoincideFiltros(g, { ...SIN_FILTRO, categoria: "Presidencial" });
    assert.deepEqual(m, { coincide: false });
  });

  test("grupo sin opciones (defensivo): nunca coincide", () => {
    const g = { hotelId: 1, paqueteId: 10, opciones: [] as OpcionUnidadConfirmada[] };
    assert.deepEqual(unidadCoincideFiltros(g, SIN_FILTRO), { coincide: false });
  });
});

// ── Prioridades estables: los filtros generales NUNCA reordenan/promueven
// recomendados — se aplican DESPUÉS de que `seleccionarRecomendadosPorDestino`
// ya fijó qué ofertas son 1/2/3 de cada paquete. Esta prueba compone las
// MISMAS funciones puras que usa VistaBooking.tsx (ofertasConPrioridad →
// seleccionarRecomendadosPorDestino → filtrar con "continue", nunca
// reconstruir la selección) — si esa composición cambiara de orden en el
// componente real, la guarda de wiring (filtrosBusquedaVistaBookingWiring)
// lo detecta por texto fuente; esta prueba detecta si la COMBINACIÓN de
// piezas puras deja de comportarse como "hueco, nunca promoción".
describe("Prioridades estables ante filtros generales (persona)", () => {
  test("excluir la prioridad 1 (recomendada) deja un HUECO — la prioridad 2 NO ocupa su lugar como recomendada", () => {
    const paqueteId = 10;
    const prioridades: Record<string, number> = {
      [claveOferta(1, paqueteId)]: 1, // Hotel Nice (no incluirá "spa" en el nombre)
      [claveOferta(2, paqueteId)]: 2, // Hotel Con Spa
    };
    const resultados = [
      resultado({ hotelId: 1, paqueteId, hotelNombre: "Hotel Playa" }),
      resultado({ hotelId: 2, paqueteId, hotelNombre: "Hotel Con Spa" }),
    ];

    // Paso 1: EXACTAMENTE como VistaBooking.tsx — recomendados se calculan
    // sobre el universo COMPLETO, sin ningún filtro general aplicado todavía.
    const ofertas = ofertasConPrioridad(resultados, prioridades);
    const paqueteIds = new Set([paqueteId]);
    const recomendadas = seleccionarRecomendadosPorDestino(ofertas, paqueteIds);
    assert.deepEqual(recomendadas.map((o) => o.hotelId), [1, 2], "ambas entran como recomendadas antes de filtrar");

    // Paso 2: el usuario escribe "spa" en "Buscar hotel" — un filtro que
    // SOLO el hotel 2 cumple. Recorremos `recomendadas` (YA FIJA) aplicando
    // el filtro con `continue` — nunca reconstruimos `recomendadas`.
    const filtros: FiltrosBusquedaBooking = { ...SIN_FILTRO, texto: "spa" };
    const vistasComoRecomendadas: number[] = [];
    for (const o of recomendadas) {
      const r = resultados.find((x) => x.hotelId === o.hotelId)!;
      const m = personaCoincideFiltros(r, filtros);
      if (!m.coincide) continue; // hueco — NUNCA se sustituye por otra oferta
      vistasComoRecomendadas.push(o.hotelId);
    }

    // La prioridad 1 (hotel 1) desaparece por no cumplir el filtro; la
    // prioridad 2 (hotel 2) permanece EXACTAMENTE en su propio lugar — no
    // "sube" a ocupar el primero, simplemente el bloque de recomendados
    // ahora tiene un elemento menos.
    assert.deepEqual(vistasComoRecomendadas, [2]);
    // La prueba explícita de "no promoción": si el código promoviera, un
    // tercer hotel (prioridad 3, sin entrada en `prioridades` porque el
    // límite es 1-6 y acá solo configuramos 2) jamás podría aparecer aquí
    // de todas formas — la garantía real es que `recomendadas` (calculada
    // en el Paso 1) nunca se vuelve a tocar/recalcular en el Paso 2.
  });

  test("ningún resultado cumple el filtro: la lista de recomendados visibles queda vacía, nunca se cae a mostrar 'el resto' en su lugar", () => {
    const paqueteId = 20;
    const prioridades = { [claveOferta(5, paqueteId)]: 1 };
    const resultados = [resultado({ hotelId: 5, paqueteId, hotelNombre: "Único Hotel" })];
    const recomendadas = seleccionarRecomendadosPorDestino(
      ofertasConPrioridad(resultados, prioridades),
      new Set([paqueteId])
    );
    const filtros: FiltrosBusquedaBooking = { ...SIN_FILTRO, categoria: "Presidencial" };
    const visibles = recomendadas.filter((o) => {
      const r = resultados.find((x) => x.hotelId === o.hotelId)!;
      return personaCoincideFiltros(r, filtros).coincide;
    });
    assert.deepEqual(visibles, []);
  });
});

describe("Cambio de filtro después de buscar / limpiar filtros (comportamiento esperado, no un detalle de implementación)", () => {
  test("el mismo resultado puede pasar de 'coincide' a 'no coincide' y volver a 'coincide' según el filtro vigente — es una función pura del filtro actual, no de un estado acumulado", () => {
    const r = resultado({
      hotelId: 1, paqueteId: 10, categoria: "Estandar",
      combos: [combo("Estandar", "Desayuno", 400000), combo("Superior", "Desayuno", 600000)],
    });
    // Buscar (sin filtro) → coincide.
    assert.equal(personaCoincideFiltros(r, filtrosBusquedaVacios()).coincide, true);
    // El usuario elige Categoría = Presidencial (no existe) → deja de coincidir.
    assert.equal(personaCoincideFiltros(r, { ...SIN_FILTRO, categoria: "Presidencial" }).coincide, false);
    // "Limpiar filtros" → vuelve exactamente al estado vacío, sin arrastrar nada
    // (ni combo forzado ni restricción del selector).
    assert.deepEqual(personaCoincideFiltros(r, filtrosBusquedaVacios()), { coincide: true, comboForzado: null, combosRestringidos: null });
  });
});
