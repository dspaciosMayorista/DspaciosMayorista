import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ordenarYFiltrarResto,
  filtrarPorFiltros,
  filtrosVacios,
  filtrosEfectivos,
  normalizarZonaClave,
  zonasDisponibles,
  estrellasDisponibles,
  zonasEfectivas,
  estrellasEfectivas,
  contarFiltrosActivos,
  hayFiltrosActivos,
  restablecerFiltrosOcultos,
  type ItemResto,
  type FiltrosResto,
} from "../lib/tarifario/inventarioResto.ts";
import { seleccionarRecomendadosGlobalInicial, seleccionarRecomendadosPorDestino, type OfertaPrioridad } from "../lib/tarifario/recomendados.ts";

function item(over: Partial<ItemResto> & { hotelId: number; paqueteId: number; nombre: string }): ItemResto {
  return {
    precio: null,
    estrellas: null,
    zona: null,
    petFriendly: false,
    adultsOnly: false,
    condicion: "desconocido",
    politica: "desconocido",
    ...over,
  };
}

describe("normalizarZonaClave — espacios/mayúsculas para deduplicar, nunca para mostrar", () => {
  test("recorta y colapsa espacios, pasa a minúsculas", () => {
    assert.equal(normalizarZonaClave("  Zona   Norte "), "zona norte");
  });
  test("null/vacío/solo espacios -> null", () => {
    assert.equal(normalizarZonaClave(null), null);
    assert.equal(normalizarZonaClave(undefined), null);
    assert.equal(normalizarZonaClave(""), null);
    assert.equal(normalizarZonaClave("   "), null);
  });
});

describe("zonasDisponibles — solo las presentes en items, deduplicadas, alfabéticas", () => {
  test("dedup por clave normalizada, conserva la primera etiqueta vista", () => {
    const items = [
      { zona: "Zona Norte" },
      { zona: "zona norte" },
      { zona: "Centro" },
      { zona: null },
    ];
    const r = zonasDisponibles(items);
    assert.deepEqual(r.map((z) => z.etiqueta), ["Centro", "Zona Norte"]);
    assert.equal(r.find((z) => z.clave === "zona norte")?.etiqueta, "Zona Norte");
  });
  test("sin items con zona -> lista vacía (nunca una lista global inventada)", () => {
    assert.deepEqual(zonasDisponibles([{ zona: null }]), []);
  });
});

describe("estrellasDisponibles — sin_clasificar al final, descendente", () => {
  test("orden descendente con sin_clasificar al final", () => {
    const r = estrellasDisponibles([{ estrellas: 3 }, { estrellas: null }, { estrellas: 5 }, { estrellas: 3 }]);
    assert.deepEqual(r, [5, 3, "sin_clasificar"]);
  });
});

describe("zonasEfectivas — una zona ya no disponible deja de tener efecto", () => {
  test("intersecta la selección contra las disponibles actuales", () => {
    const disponibles = [{ clave: "centro", etiqueta: "Centro" }];
    const r = zonasEfectivas(new Set(["centro", "norte"]), disponibles);
    assert.deepEqual([...r], ["centro"]);
  });
  test("una zona podada NO revive por sí sola si el mismo destino se vuelve a consultar con la MISMA selección efímera (esta función es solo la intersección de UN instante)", () => {
    // `zonasEfectivas` en sí es una intersección pura de un instante — quien
    // decide si el resultado se vuelve a guardar como estado "crudo" (podando
    // de verdad) es el llamador (VistaBooking, `podarZonasEstrellas`). Esta
    // prueba solo confirma que, para una MISMA selección de entrada, el
    // resultado depende ÚNICAMENTE de las disponibles del instante — nunca de
    // una llamada anterior (sin memoria propia).
    const seleccion = new Set(["centro"]);
    const enDestinoA = zonasEfectivas(seleccion, [{ clave: "norte", etiqueta: "Norte" }]);
    assert.deepEqual([...enDestinoA], [], "en destino A, centro no existe: sin efecto");
    const enDestinoB = zonasEfectivas(seleccion, [{ clave: "centro", etiqueta: "Centro" }]);
    assert.deepEqual([...enDestinoB], ["centro"], "sin memoria propia: con la MISMA selección de entrada, si el destino B sí ofrece 'centro', la intersección lo incluye");
  });

  test("poda REAL encadenada (dos cambios de destino): una zona podada en el primer cambio NO revive en el segundo, aunque el segundo destino la vuelva a ofrecer", () => {
    // Reproduce exactamente lo que hace `podarZonasEstrellas` en VistaBooking:
    // el resultado de CADA poda se usa como entrada CRUDA de la siguiente —
    // nunca se vuelve a partir de la selección original. Esto es lo que
    // impide la reactivación automática (regla cerrada: "no deben revivir
    // automáticamente en un destino posterior").
    let zonas = new Set(["centro"]);
    // Destino 1: "centro" no existe -> se poda de verdad (el resultado
    // reemplaza el estado crudo, no solo se usa para filtrar una vez).
    zonas = zonasEfectivas(zonas, [{ clave: "norte", etiqueta: "Norte" }]);
    assert.deepEqual([...zonas], []);
    // Destino 2: "centro" vuelve a existir -> NO debe revivir, porque el
    // estado crudo que llega a este segundo cambio YA no contiene "centro"
    // (se podó en el paso anterior, no se conservó el original).
    zonas = zonasEfectivas(zonas, [{ clave: "centro", etiqueta: "Centro" }]);
    assert.deepEqual([...zonas], [], "una zona podada no debe revivir aunque el destino siguiente vuelva a ofrecerla");
  });
});

describe("estrellasEfectivas — mismo criterio que zonasEfectivas", () => {
  test("intersecta la selección contra las estrellas disponibles actuales", () => {
    const r = estrellasEfectivas(new Set([5, 3, "sin_clasificar"]), [5, "sin_clasificar"]);
    assert.deepEqual([...r].sort(), [5, "sin_clasificar"].sort());
  });
});

describe("filtrosEfectivos — combina zonasEfectivas/estrellasEfectivas en un solo FiltrosResto", () => {
  test("poda zonas y estrellas ya no disponibles, conserva el resto de campos", () => {
    const f: FiltrosResto = {
      ...filtrosVacios(),
      zonas: new Set(["norte", "sur"]),
      estrellas: new Set([5, 1]),
      petFriendly: true,
      condicion: "con",
    };
    const efectivo = filtrosEfectivos(f, [{ clave: "norte", etiqueta: "Norte" }], [5]);
    assert.deepEqual([...efectivo.zonas], ["norte"]);
    assert.deepEqual([...efectivo.estrellas], [5]);
    assert.equal(efectivo.petFriendly, true);
    assert.equal(efectivo.condicion, "con");
  });

  test("el contador nunca muestra un filtro fantasma: se calcula sobre el resultado de filtrosEfectivos", () => {
    const f: FiltrosResto = { ...filtrosVacios(), zonas: new Set(["norte"]) };
    // "norte" ya no existe en el destino actual -> 0 filtros activos EFECTIVOS,
    // aunque el estado crudo siga teniendo la selección guardada.
    const efectivo = filtrosEfectivos(f, [], []);
    assert.equal(contarFiltrosActivos(efectivo), 0, "el contador no debe mostrar un filtro fantasma");
    assert.equal(contarFiltrosActivos(f), 1, "el estado crudo SÍ conserva la selección (para cuando vuelva a existir)");
  });
});

describe("contarFiltrosActivos / hayFiltrosActivos", () => {
  test("filtros vacíos -> 0, sin activos", () => {
    const f = filtrosVacios();
    assert.equal(contarFiltrosActivos(f), 0);
    assert.equal(hayFiltrosActivos(f), false);
  });
  test("cuenta CATEGORÍAS activas, no checks individuales", () => {
    const f: FiltrosResto = { ...filtrosVacios(), zonas: new Set(["a", "b"]), petFriendly: true };
    assert.equal(contarFiltrosActivos(f), 2);
    assert.equal(hayFiltrosActivos(f), true);
  });
});

describe("ordenarYFiltrarResto — bloques por paquete SIEMPRE, nunca se aplanan", () => {
  test("paquetes en orden ascendente, orden dentro de cada bloque independiente", () => {
    const items = [
      item({ hotelId: 20, paqueteId: 2, nombre: "Zeta", precio: 100 }),
      item({ hotelId: 10, paqueteId: 1, nombre: "Beta", precio: 200 }),
      item({ hotelId: 11, paqueteId: 1, nombre: "Alfa", precio: 100 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.paqueteId), [1, 1, 2]);
    assert.deepEqual(r.map((i) => i.nombre), ["Alfa", "Beta", "Zeta"]);
  });

  test("mismo hotel en dos paquetes con precios distintos: cada oferta ordena de forma independiente en su bloque", () => {
    const items = [
      item({ hotelId: 7, paqueteId: 1, nombre: "Coral", precio: 500 }),
      item({ hotelId: 8, paqueteId: 1, nombre: "Arena", precio: 100 }),
      item({ hotelId: 7, paqueteId: 2, nombre: "Coral", precio: 50 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(
      r.map((i) => [i.paqueteId, i.hotelId, i.precio]),
      [[1, 8, 100], [1, 7, 500], [2, 7, 50]]
    );
  });
});

describe("Orden predeterminado — precio menor, estrellas desc, zona, nombre, hotelId", () => {
  test("precio null SIEMPRE al final, incluso con estrellas altas", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "A", precio: null, estrellas: 5 }),
      item({ hotelId: 2, paqueteId: 1, nombre: "B", precio: 300, estrellas: 1 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.nombre), ["B", "A"]);
  });

  test("precio 0, NaN o negativo se trata como desconocido (nunca 'gratis' ni el más barato) — SIEMPRE al final", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "Cero", precio: 0 }),
      item({ hotelId: 2, paqueteId: 1, nombre: "Nan", precio: NaN }),
      item({ hotelId: 3, paqueteId: 1, nombre: "Negativo", precio: -50 }),
      item({ hotelId: 4, paqueteId: 1, nombre: "Infinito", precio: Infinity }),
      item({ hotelId: 5, paqueteId: 1, nombre: "Real", precio: 10 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.equal(r[0].nombre, "Real", "el único precio válido va primero");
    assert.deepEqual(r.slice(1).map((i) => i.nombre).sort(), ["Cero", "Infinito", "Nan", "Negativo"].sort());
  });

  test("empate en precio: desempata por estrellas descendente, sin clasificar al final", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "A", precio: 100, estrellas: null }),
      item({ hotelId: 2, paqueteId: 1, nombre: "B", precio: 100, estrellas: 4 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.nombre), ["B", "A"]);
  });

  test("empate en precio y estrellas: desempata por zona normalizada, sin zona al final", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "A", precio: 100, estrellas: 3, zona: null }),
      item({ hotelId: 2, paqueteId: 1, nombre: "B", precio: 100, estrellas: 3, zona: "Centro" }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.nombre), ["B", "A"]);
  });

  test("empate total salvo nombre: alfabético", () => {
    const items = [
      item({ hotelId: 2, paqueteId: 1, nombre: "Zebra", precio: 100 }),
      item({ hotelId: 1, paqueteId: 1, nombre: "Arena", precio: 100 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.nombre), ["Arena", "Zebra"]);
  });

  test("empate total incluido el nombre: desempata por hotelId (determinista)", () => {
    const items = [
      item({ hotelId: 9, paqueteId: 1, nombre: "Igual", precio: 100 }),
      item({ hotelId: 4, paqueteId: 1, nombre: "Igual", precio: 100 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.hotelId), [4, 9]);
  });
});

describe("Órdenes manuales — precio desconocido SIEMPRE al final, incluso descendente", () => {
  test("precio_asc / precio_desc: null al final en ambas direcciones", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "A", precio: null }),
      item({ hotelId: 2, paqueteId: 1, nombre: "B", precio: 50 }),
      item({ hotelId: 3, paqueteId: 1, nombre: "C", precio: 10 }),
    ];
    const asc = ordenarYFiltrarResto(items, { orden: "precio_asc", filtros: filtrosVacios() });
    const desc = ordenarYFiltrarResto(items, { orden: "precio_desc", filtros: filtrosVacios() });
    assert.deepEqual(asc.map((i) => i.nombre), ["C", "B", "A"]);
    assert.deepEqual(desc.map((i) => i.nombre), ["B", "C", "A"], "descendente: null sigue al final, nunca 'el mayor'");
  });

  test("precio_asc / precio_desc: 0, NaN y negativos también quedan al final en AMBAS direcciones", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "Cero", precio: 0 }),
      item({ hotelId: 2, paqueteId: 1, nombre: "Nan", precio: NaN }),
      item({ hotelId: 3, paqueteId: 1, nombre: "Negativo", precio: -1 }),
      item({ hotelId: 4, paqueteId: 1, nombre: "Real", precio: 25 }),
    ];
    const asc = ordenarYFiltrarResto(items, { orden: "precio_asc", filtros: filtrosVacios() });
    const desc = ordenarYFiltrarResto(items, { orden: "precio_desc", filtros: filtrosVacios() });
    assert.equal(asc[0].nombre, "Real");
    assert.equal(desc[0].nombre, "Real", "descendente: un precio 0/NaN/negativo nunca se lee como 'el mayor'");
  });

  test("estrellas_desc / estrellas_asc: sin_clasificar siempre después de lo clasificado", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "A", estrellas: null }),
      item({ hotelId: 2, paqueteId: 1, nombre: "B", estrellas: 2 }),
      item({ hotelId: 3, paqueteId: 1, nombre: "C", estrellas: 5 }),
    ];
    const desc = ordenarYFiltrarResto(items, { orden: "estrellas_desc", filtros: filtrosVacios() });
    const asc = ordenarYFiltrarResto(items, { orden: "estrellas_asc", filtros: filtrosVacios() });
    assert.deepEqual(desc.map((i) => i.nombre), ["C", "B", "A"]);
    assert.deepEqual(asc.map((i) => i.nombre), ["B", "C", "A"], "ascendente: sin clasificar sigue al final, nunca 'el menor'");
  });

  test("nombre_asc / nombre_desc", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "Beta" }),
      item({ hotelId: 2, paqueteId: 1, nombre: "Alfa" }),
    ];
    assert.deepEqual(
      ordenarYFiltrarResto(items, { orden: "nombre_asc", filtros: filtrosVacios() }).map((i) => i.nombre),
      ["Alfa", "Beta"]
    );
    assert.deepEqual(
      ordenarYFiltrarResto(items, { orden: "nombre_desc", filtros: filtrosVacios() }).map((i) => i.nombre),
      ["Beta", "Alfa"]
    );
  });
});

describe("Filtros — AND entre categorías, OR dentro de zonas/estrellas", () => {
  const base = [
    item({ hotelId: 1, paqueteId: 1, nombre: "A", zona: "Norte", estrellas: 5, petFriendly: true, adultsOnly: false }),
    item({ hotelId: 2, paqueteId: 1, nombre: "B", zona: "Sur", estrellas: 3, petFriendly: false, adultsOnly: true }),
    item({ hotelId: 3, paqueteId: 1, nombre: "C", zona: "Norte", estrellas: 3, petFriendly: true, adultsOnly: true }),
  ];

  test("OR dentro de zonas: dos zonas seleccionadas traen ofertas de cualquiera de las dos", () => {
    const f: FiltrosResto = { ...filtrosVacios(), zonas: new Set(["norte", "sur"]) };
    const r = ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: f });
    assert.deepEqual(r.map((i) => i.nombre).sort(), ["A", "B", "C"]);
  });

  test("OR dentro de estrellas: varias estrellas seleccionadas se combinan con OR", () => {
    const f: FiltrosResto = { ...filtrosVacios(), estrellas: new Set([5]) };
    const r = ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: f });
    assert.deepEqual(r.map((i) => i.nombre), ["A"]);
  });

  test("AND entre categorías: zona Y estrellas Y petFriendly deben cumplirse todas", () => {
    const f: FiltrosResto = { ...filtrosVacios(), zonas: new Set(["norte"]), estrellas: new Set([3]), petFriendly: true };
    const r = ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: f });
    assert.deepEqual(r.map((i) => i.nombre), ["C"], "solo C cumple norte + 3 estrellas + pet friendly a la vez");
  });

  test("Pet friendly / Adults Only", () => {
    const fPet: FiltrosResto = { ...filtrosVacios(), petFriendly: true };
    const fAO: FiltrosResto = { ...filtrosVacios(), adultsOnly: true };
    assert.deepEqual(ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: fPet }).map((i) => i.nombre), ["A", "C"]);
    // Ambas tienen 3 estrellas y precio null: desempata por zona ("norte" < "sur").
    assert.deepEqual(ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: fAO }).map((i) => i.nombre), ["C", "B"]);
  });
});

describe("Con/Sin condiciones y Flexible/No reembolsable — desconocido nunca cae en ninguno de los dos", () => {
  const base = [
    item({ hotelId: 1, paqueteId: 1, nombre: "Con", condicion: "con", politica: "no_reembolsable" }),
    item({ hotelId: 2, paqueteId: 1, nombre: "Sin", condicion: "sin", politica: "flexible" }),
    item({ hotelId: 3, paqueteId: 1, nombre: "Desconocido", condicion: "desconocido", politica: "desconocido" }),
  ];

  test("Con condiciones: solo 'con', el desconocido queda fuera", () => {
    const f: FiltrosResto = { ...filtrosVacios(), condicion: "con" };
    assert.deepEqual(ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: f }).map((i) => i.nombre), ["Con"]);
  });

  test("Sin condiciones: solo 'sin', el desconocido queda fuera (nunca se clasifica falsamente como sin condiciones)", () => {
    const f: FiltrosResto = { ...filtrosVacios(), condicion: "sin" };
    assert.deepEqual(ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: f }).map((i) => i.nombre), ["Sin"]);
  });

  test("Flexible: solo 'flexible', el desconocido queda fuera (nunca se clasifica falsamente como flexible)", () => {
    const f: FiltrosResto = { ...filtrosVacios(), politica: "flexible" };
    assert.deepEqual(ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: f }).map((i) => i.nombre), ["Sin"]);
  });

  test("No reembolsable: solo 'no_reembolsable', el desconocido queda fuera", () => {
    const f: FiltrosResto = { ...filtrosVacios(), politica: "no_reembolsable" };
    assert.deepEqual(ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: f }).map((i) => i.nombre), ["Con"]);
  });

  test("Todas: incluye también los desconocidos", () => {
    const r = ordenarYFiltrarResto(base, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.equal(r.length, 3);
  });
});

describe("Limpiar filtros restaura resultados", () => {
  test("filtrosVacios() no excluye nada", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "A", zona: "Norte", petFriendly: true }),
      item({ hotelId: 2, paqueteId: 1, nombre: "B", zona: null }),
    ];
    const filtrado = ordenarYFiltrarResto(items, {
      orden: "predeterminado",
      filtros: { ...filtrosVacios(), zonas: new Set(["norte"]) },
    });
    assert.equal(filtrado.length, 1);
    const restaurado = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.equal(restaurado.length, 2);
  });
});

describe("filtrarPorFiltros — filtra SIN reordenar (para RECOMENDADOS: nunca se resuelve por este módulo)", () => {
  test("conserva el orden de entrada — un recomendado incompatible desaparece sin alterar el orden de los demás", () => {
    // Simula 4 recomendados en su orden de prioridad ya resuelto por
    // recomendados.ts (A1, A2, B1, B2) — B1 deja de cumplir el filtro.
    const recomendados = [
      item({ hotelId: 10, paqueteId: 1, nombre: "A1", zona: "Norte" }),
      item({ hotelId: 11, paqueteId: 1, nombre: "A2", zona: "Norte" }),
      item({ hotelId: 20, paqueteId: 2, nombre: "B1", zona: "Sur" }),
      item({ hotelId: 21, paqueteId: 2, nombre: "B2", zona: "Norte" }),
    ];
    const f: FiltrosResto = { ...filtrosVacios(), zonas: new Set(["norte"]) };
    const r = filtrarPorFiltros(recomendados, f);
    assert.deepEqual(r.map((i) => i.nombre), ["A1", "A2", "B2"], "B1 desaparece; A1,A2,B2 conservan su orden/bloque original");
  });

  test("recomendados y resto obedecen los MISMOS filtros (misma función, mismo predicado)", () => {
    const recomendados = [item({ hotelId: 1, paqueteId: 1, nombre: "Rec", petFriendly: false })];
    const resto = [
      item({ hotelId: 2, paqueteId: 1, nombre: "RestoSi", petFriendly: true }),
      item({ hotelId: 3, paqueteId: 1, nombre: "RestoNo", petFriendly: false }),
    ];
    const f: FiltrosResto = { ...filtrosVacios(), petFriendly: true };
    assert.deepEqual(filtrarPorFiltros(recomendados, f), [], "el recomendado sin pet friendly también se excluye");
    assert.deepEqual(
      ordenarYFiltrarResto(resto, { orden: "predeterminado", filtros: f }).map((i) => i.nombre),
      ["RestoSi"]
    );
  });

  test("lista vacía tras filtrar no revienta, ni inventa elementos", () => {
    assert.deepEqual(filtrarPorFiltros([item({ hotelId: 1, paqueteId: 1, nombre: "X" })], { ...filtrosVacios(), condicion: "con" }), []);
  });
});

describe("Comparación alfabética — locale español explícito, determinista", () => {
  test("nombre_asc ordena con criterio español (ñ entre n y o; tildes se agrupan con la letra base)", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "Nube" }),
      item({ hotelId: 2, paqueteId: 1, nombre: "Ñandú" }),
      item({ hotelId: 3, paqueteId: 1, nombre: "Norte" }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "nombre_asc", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.nombre), ["Norte", "Nube", "Ñandú"].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base", numeric: true })));
  });

  test("zona: acentos no rompen el desempate (Á se compara como A con sensitivity 'base')", () => {
    const items = [
      item({ hotelId: 1, paqueteId: 1, nombre: "X", zona: "Ávila", precio: 100 }),
      item({ hotelId: 2, paqueteId: 1, nombre: "Y", zona: "Avilés", precio: 100 }),
    ];
    const r = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    // No debe lanzar y el orden debe ser determinista y estable en repetidas corridas.
    const r2 = ordenarYFiltrarResto(items, { orden: "predeterminado", filtros: filtrosVacios() });
    assert.deepEqual(r.map((i) => i.nombre), r2.map((i) => i.nombre));
  });
});

// ── Integración: selección de recomendados (recomendados.ts) + filtro
// posterior (inventarioResto.ts) — Pet friendly/Adults Only NUNCA promueven
// otra prioridad al excluir la primera. Reproduce el caso obligatorio: un
// paquete con prioridades 1, 2 y 3 configuradas donde la 1 no cumple Pet
// friendly. `seleccionarRecomendadosGlobalInicial` (probada aparte en
// pruebas/recomendados.test.ts) SOLO selecciona las posiciones LITERALES 1 y
// 2 — la 3 nunca entra a la lista de candidatos a filtrar, así que no hay
// forma de que "ascienda" — esta prueba demuestra la garantía de punta a
// punta, no cada pieza por separado.
describe("Pet friendly/Adults Only se aplican DESPUÉS de seleccionar recomendados — nunca promueven otra prioridad", () => {
  function itemDe(o: OfertaPrioridad, petFriendly: boolean): ItemResto {
    return item({ hotelId: o.hotelId, paqueteId: o.paqueteId, nombre: `H${o.hotelId}`, petFriendly });
  }

  test("caso obligatorio — global sin búsqueda: prioridades 1,2,3; la 1 no cumple Pet Friendly -> quedan ÚNICAMENTE la 2 entre los recomendados, la 3 nunca asciende", () => {
    const ofertas: OfertaPrioridad[] = [
      { hotelId: 100, paqueteId: 1, prioridad: 1 }, // NO pet friendly
      { hotelId: 200, paqueteId: 1, prioridad: 2 }, // SÍ pet friendly
      { hotelId: 300, paqueteId: 1, prioridad: 3 }, // SÍ pet friendly (irrelevante: nunca debe entrar)
    ];
    // Paso 1: selección de recomendados (SIN filtros — pet friendly nunca
    // participa en la selección, solo en el filtro posterior).
    const seleccion = seleccionarRecomendadosGlobalInicial(ofertas);
    assert.deepEqual(seleccion.map((o) => o.prioridad), [1, 2], "el estado global inicial solo selecciona las posiciones literales 1 y 2 — la 3 nunca es candidata");

    // Paso 2: construir los ItemResto de la selección (petFriendly real de
    // cada hotel) y aplicar el filtro Pet friendly DESPUÉS.
    const petFriendlyPorHotel: Record<number, boolean> = { 100: false, 200: true, 300: true };
    const itemsRecomendados = seleccion.map((o) => itemDe(o, petFriendlyPorHotel[o.hotelId]));
    const f: FiltrosResto = { ...filtrosVacios(), petFriendly: true };
    const filtrados = filtrarPorFiltros(itemsRecomendados, f);

    assert.deepEqual(filtrados.map((i) => i.hotelId), [200], "la prioridad 1 (no pet friendly) desaparece; queda ÚNICAMENTE la 2 — la 3 JAMÁS entra a la lista, ni siquiera se evalúa");
    assert.ok(!filtrados.some((i) => i.hotelId === 300), "la prioridad 3 nunca debe aparecer entre los recomendados filtrados");
  });

  test("caso obligatorio — búsqueda por destino: prioridades 1..6; si la 1 no cumple Adults Only, quedan 2..6 (las que sí cumplan), la 1 nunca reaparece ni se sustituye por otra fuera del rango 1..6", () => {
    const ofertas: OfertaPrioridad[] = [1, 2, 3, 4, 5, 6].map((p) => ({ hotelId: 100 + p, paqueteId: 1, prioridad: p }));
    const seleccion = seleccionarRecomendadosPorDestino(ofertas, new Set([1]));
    assert.deepEqual(seleccion.map((o) => o.prioridad), [1, 2, 3, 4, 5, 6]);

    const adultsOnlyPorHotel: Record<number, boolean> = { 101: false, 102: true, 103: true, 104: true, 105: true, 106: true };
    const itemsRecomendados = seleccion.map((o) => itemDe(o, false)).map((it) => ({ ...it, adultsOnly: adultsOnlyPorHotel[it.hotelId] ?? false }));
    const f: FiltrosResto = { ...filtrosVacios(), adultsOnly: true };
    const filtrados = filtrarPorFiltros(itemsRecomendados, f);
    assert.deepEqual(filtrados.map((i) => i.hotelId), [102, 103, 104, 105, 106], "la 1 (sin Adults Only) desaparece; el resto conserva su orden/bloque, sin sustituciones");
  });

  test("recomendados y resto obedecen el MISMO filtro Pet friendly/Adults Only — nunca dos criterios distintos", () => {
    const recomendados = [item({ hotelId: 1, paqueteId: 1, nombre: "Rec1", petFriendly: false, adultsOnly: true })];
    const resto = [
      item({ hotelId: 2, paqueteId: 1, nombre: "Resto1", petFriendly: false, adultsOnly: true }),
      item({ hotelId: 3, paqueteId: 1, nombre: "Resto2", petFriendly: true, adultsOnly: true }),
    ];
    const f: FiltrosResto = { ...filtrosVacios(), petFriendly: true, adultsOnly: true };
    assert.deepEqual(filtrarPorFiltros(recomendados, f), [], "Rec1 no cumple petFriendly");
    assert.deepEqual(
      ordenarYFiltrarResto(resto, { orden: "predeterminado", filtros: f }).map((i) => i.nombre),
      ["Resto2"],
      "Resto1 no cumple petFriendly; Resto2 cumple ambos"
    );
  });
});

// ── restablecerFiltrosOcultos — estado GLOBAL (sin destino/búsqueda) ────────
// zona/estrellas/condición/política se vacían (esos controles no se
// muestran en global); Pet friendly/Adults Only NUNCA se tocan (sus
// controles SÍ están visibles en global). Usado por VistaBooking en
// `cambiarSub`/`confirmarDestinoBloqueo`/`confirmarBusquedaPorcion` al
// volver al estado global — nunca con un useEffect.
describe("restablecerFiltrosOcultos — vacía zona/estrellas/condición/política; nunca toca Pet friendly/Adults Only", () => {
  test("vacía los cuatro controles ocultos en global", () => {
    const f: FiltrosResto = {
      ...filtrosVacios(),
      zonas: new Set(["norte"]),
      estrellas: new Set([5]),
      condicion: "con",
      politica: "no_reembolsable",
    };
    const r = restablecerFiltrosOcultos(f);
    assert.deepEqual([...r.zonas], []);
    assert.deepEqual([...r.estrellas], []);
    assert.equal(r.condicion, "todas");
    assert.equal(r.politica, "todas");
  });

  test("Pet friendly/Adults Only permanecen activos y visibles si estaban seleccionados — restablecerFiltrosOcultos nunca los toca", () => {
    const f: FiltrosResto = { ...filtrosVacios(), petFriendly: true, adultsOnly: true, zonas: new Set(["norte"]) };
    const r = restablecerFiltrosOcultos(f);
    assert.equal(r.petFriendly, true, "Pet friendly debe seguir activo");
    assert.equal(r.adultsOnly, true, "Adults Only debe seguir activo");
    assert.deepEqual([...r.zonas], [], "zona sí se vacía");
  });

  test("cambiar Bloqueo -> Porción terrestre en estado global elimina la zona/estrella elegida en Bloqueo", () => {
    // Simula: el usuario eligió zona "Centro" y 5 estrellas mientras exploraba
    // un destino de Bloqueo, y luego cambia a la pestaña Porción terrestre
    // SIN una búsqueda vigente (estado global de esa pestaña).
    const filtrosEnBloqueo: FiltrosResto = { ...filtrosVacios(), zonas: new Set(["centro"]), estrellas: new Set([5]) };
    const filtrosEnPorcionGlobal = restablecerFiltrosOcultos(filtrosEnBloqueo);
    assert.deepEqual([...filtrosEnPorcionGlobal.zonas], [], "la zona de Bloqueo no puede sobrevivir al global de Porción terrestre");
    assert.deepEqual([...filtrosEnPorcionGlobal.estrellas], [], "misma regla para estrellas");
  });
});

describe("Volver al estado global no oculta recomendados — restablecerFiltrosOcultos + filtrarPorFiltros", () => {
  test("seleccionar condición/zona, limpiar búsqueda y volver a global: los recomendados que antes quedaban excluidos vuelven a aparecer", () => {
    // 3 recomendados en su bloque/orden real — dos de ellos NO cumplirían el
    // filtro de zona/condición que el usuario tenía activo en la búsqueda.
    const recomendados = [
      item({ hotelId: 1, paqueteId: 1, nombre: "A1", zona: "Norte", condicion: "con" }),
      item({ hotelId: 2, paqueteId: 1, nombre: "A2", zona: "Sur", condicion: "sin" }), // excluido bajo el filtro viejo
      item({ hotelId: 3, paqueteId: 2, nombre: "B1", zona: "Sur", condicion: "desconocido" }), // también excluido
    ];
    const filtrosEnBusqueda: FiltrosResto = { ...filtrosVacios(), zonas: new Set(["norte"]), condicion: "con" };
    // Mientras la búsqueda estaba activa, solo A1 pasaba el filtro.
    assert.deepEqual(filtrarPorFiltros(recomendados, filtrosEnBusqueda).map((i) => i.nombre), ["A1"]);

    // El usuario limpia la búsqueda -> vuelve al estado global: se
    // restablecen los controles ocultos (nunca con un useEffect, ver
    // VistaBooking `confirmarBusquedaPorcion`).
    const filtrosEnGlobal = restablecerFiltrosOcultos(filtrosEnBusqueda);
    const visiblesEnGlobal = filtrarPorFiltros(recomendados, filtrosEnGlobal);
    assert.deepEqual(
      visiblesEnGlobal.map((i) => i.nombre),
      ["A1", "A2", "B1"],
      "de vuelta en global, NINGÚN recomendado debe quedar oculto por un filtro que ya no se muestra"
    );
  });
});
