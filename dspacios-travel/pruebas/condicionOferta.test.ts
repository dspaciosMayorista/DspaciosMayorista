import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { combinarTernario, etiquetaCondicion, etiquetaPolitica, type EvidenciaTernaria } from "../lib/tarifario/condicionOferta.ts";
import { filtrarPorFiltros, filtrosVacios, type ItemResto, type FiltrosResto } from "../lib/tarifario/inventarioResto.ts";

describe("combinarTernario — evidencia positiva en CUALQUIER lado gana, sin importar el otro", () => {
  test("hotel positivo + paquete desconocido -> positivo", () => {
    assert.equal(combinarTernario(true, null), true);
  });
  test("hotel desconocido + paquete positivo -> positivo", () => {
    assert.equal(combinarTernario(null, true), true);
  });
  test("hotel positivo + paquete neutro -> positivo (la evidencia positiva no se anula)", () => {
    assert.equal(combinarTernario(true, false), true);
  });
  test("hotel neutro + paquete positivo -> positivo", () => {
    assert.equal(combinarTernario(false, true), true);
  });
  test("ambos positivos -> positivo", () => {
    assert.equal(combinarTernario(true, true), true);
  });
});

describe("combinarTernario — ambos lados CONOCIDOS y neutros -> negativo conocido", () => {
  test("hotel neutro + paquete neutro -> negativo (sin/flexible)", () => {
    assert.equal(combinarTernario(false, false), false);
  });
});

describe("combinarTernario — un paquete neutro NUNCA convierte un hotel desconocido en flexible/sin condición", () => {
  test("hotel desconocido + paquete neutro -> desconocido (NUNCA negativo)", () => {
    assert.equal(combinarTernario(null, false), null);
  });
  test("hotel neutro + paquete desconocido -> desconocido (el paquete también debe confirmar neutralidad)", () => {
    assert.equal(combinarTernario(false, null), null);
  });
  test("ambos desconocidos -> desconocido", () => {
    assert.equal(combinarTernario(null, null), null);
  });
});

describe("Bernalo (unidad): el hotel siempre es desconocido en este eje — solo el paquete puede aportar evidencia", () => {
  test("paquete restringido (positivo) + hotel desconocido -> positivo: SÍ se puede conocer la restricción por el paquete solo", () => {
    assert.equal(combinarTernario(null, true), true);
  });
  test("paquete neutro + hotel desconocido -> desconocido: un paquete neutro NO demuestra que el hotel sea flexible", () => {
    assert.equal(combinarTernario(null, false), null);
  });
});

// ── Conductual de punta a punta: itemDeUnidadExploracion (VistaBooking.tsx) ──
// Reproduce EXACTAMENTE la combinación que hace ese constructor (hotel
// SIEMPRE desconocido para Bernalo en exploración + restriccionPorPaquete
// del paquete) y confirma cómo esas dos etiquetas se comportan al pasar por
// el filtro real (`filtrarPorFiltros`) — no solo el valor devuelto por
// `combinarTernario`, sino su efecto en la grilla.
function itemDeUnidadExploracionSimulado(
  hotelId: number,
  paqueteId: number,
  restriccionPaquete: { condicionNoNeutra: EvidenciaTernaria; restriccionNoNeutra: EvidenciaTernaria } | undefined
): ItemResto {
  // Hotel siempre desconocido en este eje (Bernalo no calcula condicionHotelFechas).
  const hotelCondTri: EvidenciaTernaria = null;
  const hotelRestrTri: EvidenciaTernaria = null;
  const paqueteCondTri: EvidenciaTernaria = restriccionPaquete ? restriccionPaquete.condicionNoNeutra : null;
  const paqueteRestrTri: EvidenciaTernaria = restriccionPaquete ? restriccionPaquete.restriccionNoNeutra : null;
  return {
    hotelId, paqueteId, nombre: `Bernalo ${hotelId}`, precio: null, estrellas: null, zona: null,
    petFriendly: false, adultsOnly: false,
    condicion: etiquetaCondicion(combinarTernario(hotelCondTri, paqueteCondTri)),
    politica: etiquetaPolitica(combinarTernario(hotelRestrTri, paqueteRestrTri)),
  };
}

describe("Bernalo en EXPLORACIÓN — itemDeUnidadExploracion combina con restriccionPorPaquete (nunca 'desconocido' fijo)", () => {
  test("Bernalo exploración + paquete RESTRINGIDO -> aparece con el filtro 'No reembolsable' (política = con)", () => {
    const item = itemDeUnidadExploracionSimulado(500, 50, { condicionNoNeutra: true, restriccionNoNeutra: true });
    assert.equal(item.condicion, "con");
    assert.equal(item.politica, "no_reembolsable");
    const f: FiltrosResto = { ...filtrosVacios(), politica: "no_reembolsable" };
    assert.deepEqual(filtrarPorFiltros([item], f).map((i) => i.hotelId), [500], "el hotel Bernalo debe sobrevivir el filtro 'No reembolsable'");
    const fFlexible: FiltrosResto = { ...filtrosVacios(), politica: "flexible" };
    assert.deepEqual(filtrarPorFiltros([item], fFlexible), [], "nunca debe aparecer bajo 'Flexible'");
  });

  test("Bernalo exploración + paquete NEUTRO -> queda desconocido (nunca se inventa 'flexible' ni 'sin condición')", () => {
    const item = itemDeUnidadExploracionSimulado(501, 51, { condicionNoNeutra: false, restriccionNoNeutra: false });
    assert.equal(item.condicion, "desconocido");
    assert.equal(item.politica, "desconocido");
    const fFlexible: FiltrosResto = { ...filtrosVacios(), politica: "flexible" };
    const fNoReembolsable: FiltrosResto = { ...filtrosVacios(), politica: "no_reembolsable" };
    assert.deepEqual(filtrarPorFiltros([item], fFlexible), [], "un paquete neutro no demuestra que el hotel sea flexible");
    assert.deepEqual(filtrarPorFiltros([item], fNoReembolsable), [], "tampoco debe aparecer como no reembolsable");
    // Solo "Todas" lo muestra.
    assert.deepEqual(filtrarPorFiltros([item], filtrosVacios()).map((i) => i.hotelId), [501]);
  });

  test("Bernalo exploración sin ninguna fila de restriccionPorPaquete (paquete indeterminable) -> también desconocido", () => {
    const item = itemDeUnidadExploracionSimulado(502, 52, undefined);
    assert.equal(item.condicion, "desconocido");
    assert.equal(item.politica, "desconocido");
  });

  test("funciona igual para una oferta RECOMENDADA y una NO recomendada — el constructor no distingue (la marca de recomendación es de la Tarjeta, no del ItemResto)", () => {
    const recomendada = itemDeUnidadExploracionSimulado(503, 53, { condicionNoNeutra: true, restriccionNoNeutra: true });
    const noRecomendada = itemDeUnidadExploracionSimulado(504, 53, { condicionNoNeutra: true, restriccionNoNeutra: true });
    assert.equal(recomendada.condicion, noRecomendada.condicion);
    assert.equal(recomendada.politica, noRecomendada.politica);
  });
});

describe("etiquetaCondicion / etiquetaPolitica — mapeo de tri-estado a las etiquetas de ItemResto", () => {
  test("true/false/null se traducen correctamente para condición", () => {
    assert.equal(etiquetaCondicion(true), "con");
    assert.equal(etiquetaCondicion(false), "sin");
    assert.equal(etiquetaCondicion(null), "desconocido");
  });
  test("true/false/null se traducen correctamente para política", () => {
    assert.equal(etiquetaPolitica(true), "no_reembolsable");
    assert.equal(etiquetaPolitica(false), "flexible");
    assert.equal(etiquetaPolitica(null), "desconocido");
  });
});
