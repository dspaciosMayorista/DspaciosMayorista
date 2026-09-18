import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  claveOferta,
  seleccionarRecomendadosGlobalInicial,
  seleccionarRecomendadosPorDestino,
  excluirOfertasRecomendadas,
  agruparOpcionesUnidadPorOferta,
  ofertasConPrioridad,
  textoEtiquetaOferta,
  type OfertaPrioridad,
} from "../lib/tarifario/recomendados.ts";

function oferta(hotelId: number, paqueteId: number, prioridad: number): OfertaPrioridad {
  return { hotelId, paqueteId, prioridad };
}

describe("claveOferta — identidad compuesta hotelId+paqueteId", () => {
  test("hoteles distintos con el mismo paqueteId tienen claves distintas", () => {
    assert.notEqual(claveOferta(1, 10), claveOferta(2, 10));
  });
  test("el MISMO hotel en paquetes distintos tiene claves distintas (nunca deduplica por hotelId solo)", () => {
    assert.notEqual(claveOferta(1, 10), claveOferta(1, 20));
  });
  test("la misma oferta produce siempre la misma clave", () => {
    assert.equal(claveOferta(1, 10), claveOferta(1, 10));
  });
});

describe("Estado global inicial — máximo 2 por paquete, prioridad 1 antes que 2", () => {
  test("paquete con 0 recomendados no aparece", () => {
    const r = seleccionarRecomendadosGlobalInicial([]);
    assert.deepEqual(r, []);
  });

  test("paquete con 1 recomendado muestra 1", () => {
    const r = seleccionarRecomendadosGlobalInicial([oferta(100, 1, 1)]);
    assert.deepEqual(r, [oferta(100, 1, 1)]);
  });

  test("paquete con 6 recomendados muestra SOLO los 2 primeros (prioridad 1 y 2), nunca 3-6", () => {
    const ofertas = [1, 2, 3, 4, 5, 6].map((p) => oferta(100 + p, 1, p));
    const r = seleccionarRecomendadosGlobalInicial(ofertas);
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((o) => o.prioridad), [1, 2]);
    assert.ok(!r.some((o) => o.prioridad >= 3), "no debe aparecer ninguna prioridad 3-6");
  });

  test("prioridad 1 siempre antes que prioridad 2, incluso si el orden de entrada es inverso", () => {
    const r = seleccionarRecomendadosGlobalInicial([oferta(200, 1, 2), oferta(100, 1, 1)]);
    assert.deepEqual(r.map((o) => o.hotelId), [100, 200]);
  });

  test("el mismo hotel físico en DOS paquetes distintos aparece DOS veces (ofertas repetidas conservadas)", () => {
    const r = seleccionarRecomendadosGlobalInicial([oferta(999, 1, 1), oferta(999, 2, 1)]);
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((o) => o.paqueteId).sort(), [1, 2]);
    assert.ok(r.every((o) => o.hotelId === 999));
  });

  test("varios paquetes: cada uno aporta como máximo 2, independientemente", () => {
    const ofertas = [
      oferta(1, 10, 1), oferta(2, 10, 2), oferta(3, 10, 3), // paquete 10: 3 recomendados
      oferta(4, 20, 1), // paquete 20: 1 recomendado
    ];
    const r = seleccionarRecomendadosGlobalInicial(ofertas);
    const porPaquete = new Map<number, number>();
    for (const o of r) porPaquete.set(o.paqueteId, (porPaquete.get(o.paqueteId) ?? 0) + 1);
    assert.equal(porPaquete.get(10), 2);
    assert.equal(porPaquete.get(20), 1);
  });
});

describe("Búsqueda por destino — hasta 6 por paquete coincidente, prioridad 1→6", () => {
  test("muestra hasta 6 recomendados del paquete coincidente, en orden 1→6", () => {
    const ofertas = [6, 4, 2, 5, 1, 3].map((p) => oferta(100 + p, 1, p)); // orden de entrada desordenado a propósito
    const r = seleccionarRecomendadosPorDestino(ofertas, new Set([1]));
    assert.equal(r.length, 6);
    assert.deepEqual(r.map((o) => o.prioridad), [1, 2, 3, 4, 5, 6]);
  });

  test("un paquete NO coincidente con el destino no aporta ninguna oferta, aunque tenga recomendados", () => {
    const ofertas = [oferta(1, 10, 1), oferta(2, 20, 1)];
    const r = seleccionarRecomendadosPorDestino(ofertas, new Set([10]));
    assert.deepEqual(r, [oferta(1, 10, 1)]);
  });

  test("cambiar el conjunto de destino no mezcla resultados anteriores (llamada pura, sin estado compartido)", () => {
    const ofertas = [oferta(1, 10, 1), oferta(2, 20, 1)];
    const r1 = seleccionarRecomendadosPorDestino(ofertas, new Set([10]));
    const r2 = seleccionarRecomendadosPorDestino(ofertas, new Set([20]));
    assert.deepEqual(r1, [oferta(1, 10, 1)]);
    assert.deepEqual(r2, [oferta(2, 20, 1)]);
  });

  test("el mismo hotel físico en paquetes distintos, ambos coincidentes con el destino, aparece separado", () => {
    const ofertas = [oferta(999, 10, 1), oferta(999, 20, 1)];
    const r = seleccionarRecomendadosPorDestino(ofertas, new Set([10, 20]));
    assert.equal(r.length, 2);
  });

  test("una oferta no aparece dos veces (paquete coincidente con más de 6 recomendados nunca ocurre por el CHECK, pero si ocurriera, no se duplica ninguna entrada)", () => {
    const ofertas = [1, 2, 3, 4, 5, 6].map((p) => oferta(100 + p, 1, p));
    const r = seleccionarRecomendadosPorDestino(ofertas, new Set([1]));
    const claves = new Set(r.map((o) => claveOferta(o.hotelId, o.paqueteId)));
    assert.equal(claves.size, r.length);
  });
});

describe("agruparOpcionesUnidadPorOferta — las opciones de un hotel unidad NUNCA se mezclan entre paquetes", () => {
  // Opción confirmada de hotel unidad, con lo mínimo que necesita el
  // agrupador (identidad) + un discriminante legible para las aserciones.
  const op = (hotelId: number, paqueteId: number, categoria: string) => ({ hotelId, paqueteId, categoria });

  test("el MISMO hotel en DOS paquetes produce DOS grupos — cada uno con SOLO las opciones de su paquete", () => {
    const grupos = agruparOpcionesUnidadPorOferta([
      op(7, 100, "Estándar"),
      op(7, 200, "Superior"),
      op(7, 100, "Deluxe"),
    ]);
    assert.equal(grupos.length, 2);
    const g100 = grupos.find((g) => g.paqueteId === 100);
    const g200 = grupos.find((g) => g.paqueteId === 200);
    assert.ok(g100 && g200);
    assert.deepEqual(g100.opciones.map((o) => o.categoria), ["Estándar", "Deluxe"]);
    assert.deepEqual(g200.opciones.map((o) => o.categoria), ["Superior"]);
    // Ninguna opción del paquete 200 se colaría en el grupo del 100 — es
    // exactamente el defecto que esta función existe para impedir.
    assert.ok(g100.opciones.every((o) => o.paqueteId === 100), "el grupo 100 no puede traer opciones de otro paquete");
    assert.ok(g200.opciones.every((o) => o.paqueteId === 200), "el grupo 200 no puede traer opciones de otro paquete");
  });

  test("un hotel en un solo paquete produce UN grupo con todas sus opciones, en el orden de entrada", () => {
    const grupos = agruparOpcionesUnidadPorOferta([op(7, 100, "A"), op(7, 100, "B"), op(7, 100, "C")]);
    assert.equal(grupos.length, 1);
    assert.deepEqual(grupos[0].opciones.map((o) => o.categoria), ["A", "B", "C"]);
  });

  test("hoteles distintos en el mismo paquete son grupos distintos (la clave es el par, no el paquete)", () => {
    const grupos = agruparOpcionesUnidadPorOferta([op(7, 100, "A"), op(8, 100, "B")]);
    assert.equal(grupos.length, 2);
    assert.deepEqual(grupos.map((g) => g.hotelId).sort(), [7, 8]);
  });

  test("no pierde ninguna opción: la suma de los grupos es siempre la lista de entrada", () => {
    const entrada = [op(7, 100, "A"), op(7, 200, "B"), op(8, 100, "C"), op(7, 100, "D")];
    const grupos = agruparOpcionesUnidadPorOferta(entrada);
    const total = grupos.reduce((n, g) => n + g.opciones.length, 0);
    assert.equal(total, entrada.length);
  });

  test("lista vacía produce cero grupos (nunca un grupo fantasma)", () => {
    assert.deepEqual(agruparOpcionesUnidadPorOferta([]), []);
  });

  test("cada grupo expone la identidad que lo define (hotelId y paqueteId), tomada de sus propias opciones", () => {
    const grupos = agruparOpcionesUnidadPorOferta([op(7, 100, "A"), op(9, 200, "B")]);
    for (const g of grupos) {
      assert.ok(g.opciones.every((o) => o.hotelId === g.hotelId && o.paqueteId === g.paqueteId));
    }
  });
});

describe("ofertasConPrioridad — de candidatas a ofertas recomendadas, por identidad de oferta", () => {
  const cand = (hotelId: number, paqueteId: number) => ({ hotelId, paqueteId });

  test("se queda SOLO con las candidatas que tienen prioridad configurada", () => {
    const r = ofertasConPrioridad([cand(1, 10), cand(2, 10), cand(3, 10)], { [claveOferta(1, 10)]: 1, [claveOferta(3, 10)]: 4 });
    assert.deepEqual(r, [oferta(1, 10, 1), oferta(3, 10, 4)]);
  });

  test("el MISMO hotel en dos paquetes toma la prioridad de CADA paquete (nunca la del otro)", () => {
    const r = ofertasConPrioridad([cand(9, 10), cand(9, 20)], { [claveOferta(9, 10)]: 1, [claveOferta(9, 20)]: 5 });
    assert.deepEqual(r, [oferta(9, 10, 1), oferta(9, 20, 5)]);
  });

  test("una candidata sin paqueteId (card no identificable como oferta) se descarta en vez de reventar", () => {
    const r = ofertasConPrioridad(
      [{ hotelId: 1, paqueteId: null }, { hotelId: 2, paqueteId: undefined }, cand(3, 10)],
      { [claveOferta(1, 10)]: 1, [claveOferta(3, 10)]: 2 }
    );
    assert.deepEqual(r, [oferta(3, 10, 2)]);
  });

  test("sin prioridades configuradas no hay ninguna oferta recomendada", () => {
    assert.deepEqual(ofertasConPrioridad([cand(1, 10), cand(2, 10)], {}), []);
  });

  test("prioridad 0 explícita SÍ es una prioridad configurada (no se confunde con 'sin recomendar')", () => {
    // El rango real (1-6) lo garantiza el CHECK de la base; acá lo que se
    // verifica es que la comparación es `!= null` y no una verdad booleana.
    assert.deepEqual(ofertasConPrioridad([cand(1, 10)], { [claveOferta(1, 10)]: 0 }), [oferta(1, 10, 0)]);
  });
});

describe("Estado A → B → A: el tope de 2 y el de 6 conviven sin pisarse", () => {
  test("las MISMAS ofertas dan top 2 sin destino activo y hasta 6 con destino activo", () => {
    const ofertas = [1, 2, 3, 4, 5, 6].map((p) => oferta(100 + p, 1, p));
    const sinDestino = seleccionarRecomendadosGlobalInicial(ofertas);
    const conDestino = seleccionarRecomendadosPorDestino(ofertas, new Set([1]));
    assert.deepEqual(sinDestino.map((o) => o.prioridad), [1, 2]);
    assert.deepEqual(conDestino.map((o) => o.prioridad), [1, 2, 3, 4, 5, 6]);
    // Volver al estado A (búsqueda limpiada) devuelve exactamente el top 2 otra
    // vez — la selección es pura, no queda estado pegado de la búsqueda.
    assert.deepEqual(seleccionarRecomendadosGlobalInicial(ofertas), sinDestino);
  });
});

describe("Orden VISIBLE global — la numeración manda entre paquetes (defecto 3)", () => {
  test("OBLIGATORIO: A/prioridad 2 nunca aparece antes que B/prioridad 1 (estado global inicial)", () => {
    const r = seleccionarRecomendadosGlobalInicial([
      oferta(10, 1, 2), // paquete 1, prioridad 2
      oferta(20, 2, 1), // paquete 2, prioridad 1
    ]);
    assert.deepEqual(r.map((o) => [o.paqueteId, o.prioridad]), [[2, 1], [1, 2]]);
    assert.equal(r[0].prioridad, 1, "la prioridad 1 de CUALQUIER paquete va primero");
  });

  test("OBLIGATORIO: A/prioridad 6 nunca aparece antes que B/prioridad 1 (después de buscar)", () => {
    const r = seleccionarRecomendadosPorDestino(
      [oferta(10, 1, 6), oferta(20, 2, 1)],
      new Set([1, 2])
    );
    assert.deepEqual(r.map((o) => [o.paqueteId, o.prioridad]), [[2, 1], [1, 6]]);
  });

  test("prioridades cruzadas con varios paquetes: el orden visible es 1,1,2,2 (no paquete por paquete)", () => {
    const ofertas = [
      oferta(10, 1, 1), oferta(11, 1, 2), oferta(12, 1, 3),
      oferta(20, 2, 1), oferta(21, 2, 2),
    ];
    const r = seleccionarRecomendadosGlobalInicial(ofertas);
    // El cupo por paquete deja fuera la prioridad 3 del paquete 1; entre las
    // que quedan, el orden es por prioridad y desempata por paqueteId.
    assert.deepEqual(r.map((o) => o.prioridad), [1, 1, 2, 2]);
    assert.deepEqual(r.map((o) => o.paqueteId), [1, 2, 1, 2]);
  });

  test("el cupo por paquete se conserva: top 2 en el estado global aunque el orden sea global", () => {
    const ofertas = [
      oferta(10, 1, 1), oferta(11, 1, 2), oferta(12, 1, 3), // paquete 1: 3 recomendados
      oferta(20, 2, 4), oferta(21, 2, 5),                   // paquete 2: 2 recomendados
    ];
    const r = seleccionarRecomendadosGlobalInicial(ofertas);
    assert.equal(r.length, 4, "2 por paquete, no 5");
    assert.ok(!r.some((o) => o.hotelId === 12), "la prioridad 3 del paquete 1 queda fuera del top 2");
    assert.deepEqual(r.map((o) => o.prioridad), [1, 2, 4, 5]);
  });

  test("el cupo de 6 por paquete también se conserva, y el orden sigue siendo global", () => {
    const ofertas = [
      ...[1, 2, 3, 4, 5, 6, 7].map((p) => oferta(100 + p, 1, p)),   // paquete 1: 7 (la 7 sale)
      ...[1, 2].map((p) => oferta(200 + p, 2, p)),                  // paquete 2: 2
    ];
    const r = seleccionarRecomendadosPorDestino(ofertas, new Set([1, 2]));
    assert.equal(r.length, 8, "6 del paquete 1 + 2 del paquete 2");
    assert.deepEqual(r.map((o) => o.prioridad), [1, 1, 2, 2, 3, 4, 5, 6]);
    assert.deepEqual(r.map((o) => o.paqueteId), [1, 2, 1, 2, 1, 1, 1, 1]);
  });

  test("empate de prioridad entre paquetes: desempata por paqueteId ascendente", () => {
    const r = seleccionarRecomendadosGlobalInicial([oferta(99, 7, 1), oferta(50, 3, 1)]);
    assert.deepEqual(r.map((o) => o.paqueteId), [3, 7]);
  });

  test("misma prioridad y mismo paquete: desempata por hotelId ascendente (determinista)", () => {
    const r = seleccionarRecomendadosGlobalInicial([oferta(9, 1, 1), oferta(4, 1, 1)]);
    assert.deepEqual(r.map((o) => o.hotelId), [4, 9]);
  });

  test("el orden es determinista: el mismo conjunto en cualquier orden de entrada da el mismo resultado", () => {
    const base = [
      oferta(10, 1, 2), oferta(20, 2, 1), oferta(30, 3, 1),
      oferta(11, 1, 1), oferta(21, 2, 3),
    ];
    const esperado = seleccionarRecomendadosGlobalInicial(base);
    const permutaciones = [
      [...base].reverse(),
      [...base].sort((a, b) => a.hotelId - b.hotelId),
      [...base].sort((a, b) => b.prioridad - a.prioridad),
    ];
    for (const p of permutaciones) {
      assert.deepEqual(seleccionarRecomendadosGlobalInicial(p), esperado);
      assert.deepEqual(seleccionarRecomendadosPorDestino(p, new Set([1, 2, 3])), seleccionarRecomendadosPorDestino(base, new Set([1, 2, 3])));
    }
  });

  test("un paquete fuera del destino no aporta, y el orden de los coincidentes sigue siendo global por prioridad", () => {
    const ofertas = [oferta(10, 1, 3), oferta(20, 2, 1), oferta(30, 3, 2)];
    const r = seleccionarRecomendadosPorDestino(ofertas, new Set([1, 3]));
    assert.deepEqual(r.map((o) => [o.paqueteId, o.prioridad]), [[3, 2], [1, 3]]);
  });
});

describe("textoEtiquetaOferta — toda oferta dice su paquete, recomendada o no (hallazgo 2)", () => {
  test("recomendada → 'Recomendado · <paquete>'; no recomendada → '<paquete>'", () => {
    assert.equal(textoEtiquetaOferta("Paquete 3x2", true), "Recomendado · Paquete 3x2");
    assert.equal(textoEtiquetaOferta("Paquete 3x2", false), "Paquete 3x2");
  });

  test("el MISMO hotel en dos paquetes produce dos etiquetas DISTINTAS — es lo que hace legibles las dos tarjetas", () => {
    // El mismo hotel físico, dos ofertas (dos paquetes): los textos no pueden
    // coincidir, o las dos tarjetas se leerían como una duplicada. La etiqueta
    // no recibe el hotelId: solo el nombre del paquete de ESA oferta.
    const normal = textoEtiquetaOferta("Paquete Normal", false);
    const tresx2 = textoEtiquetaOferta("Paquete 3x2", false);
    const normalRecomendado = textoEtiquetaOferta("Paquete Normal", true);
    assert.notEqual(normal, tresx2);
    assert.notEqual(normal, normalRecomendado, "la recomendada se distingue de la normal del MISMO paquete");
    assert.notEqual(normalRecomendado, tresx2);
    assert.deepEqual([normal, tresx2], ["Paquete Normal", "Paquete 3x2"]);
  });

  test("sin nombre de paquete devuelve null en los DOS casos (nunca un badge vacío)", () => {
    for (const recomendada of [true, false]) {
      assert.equal(textoEtiquetaOferta(null, recomendada), null);
      assert.equal(textoEtiquetaOferta(undefined, recomendada), null);
      assert.equal(textoEtiquetaOferta("", recomendada), null);
      assert.equal(textoEtiquetaOferta("   ", recomendada), null, "un nombre de puros espacios no es un nombre");
    }
  });

  test("el nombre se recorta (nunca espacios alrededor del texto visible)", () => {
    assert.equal(textoEtiquetaOferta("  Paquete 3x2  ", false), "Paquete 3x2");
    assert.equal(textoEtiquetaOferta("  Paquete 3x2  ", true), "Recomendado · Paquete 3x2");
  });
});

describe("excluirOfertasRecomendadas — el resto del inventario nunca repite una oferta ya recomendada", () => {
  test("excluye exactamente las ofertas (hotelId,paqueteId) que ya están en recomendadas", () => {
    const items = [
      { hotelId: 1, paqueteId: 10, label: "A" },
      { hotelId: 2, paqueteId: 10, label: "B" },
      { hotelId: 1, paqueteId: 20, label: "C" }, // mismo hotel, paquete distinto — NO se excluye
    ];
    const recomendadas = [oferta(1, 10, 1)];
    const r = excluirOfertasRecomendadas(items, recomendadas);
    assert.deepEqual(r.map((i) => i.label), ["B", "C"]);
  });

  test("items con hotelId null (ej. servicios) nunca se excluyen", () => {
    const items = [{ hotelId: null, paqueteId: 10, label: "servicio" }];
    const r = excluirOfertasRecomendadas(items, [oferta(1, 10, 1)]);
    assert.deepEqual(r.map((i) => i.label), ["servicio"]);
  });

  test("sin recomendadas, no excluye nada", () => {
    const items = [{ hotelId: 1, paqueteId: 10, label: "A" }];
    assert.deepEqual(excluirOfertasRecomendadas(items, []), items);
  });
});
