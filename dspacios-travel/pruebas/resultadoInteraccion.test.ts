// Prueba de INTERACCIÓN REACT (renderizado real, eventos reales) — el
// complemento pedido a las pruebas puras (pruebas/filtrosBusqueda.test.ts) y
// de wiring (pruebas/filtrosBusquedaVistaBookingWiring.test.ts): esas dos
// verifican el cálculo y el cableado por fuente, pero ninguna ejecuta React
// de verdad. Esta sí — monta `Resultado` (app/tarifario/BuscadorBooking.tsx)
// con `jsdom`, cambia los selectores de Categoría/Alimentación con eventos
// DOM reales y confirma tres cosas sobre el contrato "Categoría/Alimentación
// ACOTAN el selector interno, no solo qué hoteles aparecen":
//   1) Con `combosPermitidos` activo, el <select> de Categoría/Alimentación
//      SOLO ofrece <option> de los combos permitidos — el combo excluido por
//      el filtro de arriba no es una opción posible.
//   2) El precio mostrado sigue al combo REALMENTE seleccionado.
//   3) "Agregar al carrito" agrega un ítem con la categoría/alimentación/
//      precio del combo seleccionado — nunca el del combo excluido.
// Sin `combosPermitidos` (comportamiento de siempre, sin filtro activo), las
// 3 categorías originales siguen siendo elegibles — no se restringe nada.
//
// Sin librerías de testing de React en este repo (sin jsdom hasta ahora,
// sin @testing-library) — se usa `node:test` + `jsdom` (nueva dependencia,
// ver package.json) + `react-dom/client` + `act`, montando en un `document`
// real. Sin JSX: este archivo lo ejecuta `node --experimental-strip-types`
// directo (sin paso de build que compile JSX), así que todo se escribe con
// `React.createElement`.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// "next/image" no se puede resolver fuera del bundler de Next — el propio
// `pruebas/support/reactLoader.mjs` (usado para correr esta prueba) redirige
// ese specifier a un stub trivial (`pruebas/support/stubs/nextImageStub.mjs`).
// Nunca se instancia de verdad: los fixtures de acá usan `foto: null` en
// todos los casos, así que la rama `<Image>` de `Resultado` nunca se alcanza
// — el stub solo evita que el `import` rompa la resolución de módulos.

// ── Entorno DOM — ANTES de importar React/ReactDOM/el componente bajo
// prueba: React decide su entorno (DOM vs servidor) al cargarse, así que
// `window`/`document`/`navigator` deben existir en el global ANTES del
// primer `import` de "react-dom/client".
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom para que
// React/ReactDOM (pensados para navegador) encuentren un DOM real.
global.window = dom.window;
global.document = dom.window.document;
// Node 20+ ya trae un `navigator` global de solo lectura (Web Platform APIs)
// — no se puede reasignar con `=`, hay que redefinir la propiedad.
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
// Le dice a React que SÍ hay un entorno de prueba real detrás de `act()`
// (si no, emite un warning por cada render/evento y puede no aplanar
// microtasks igual de estricto).
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const h = React.createElement;

// ── Fixture: un resultado PERSONA con 3 combos reales — igual forma que
// pruebas/filtrosBusqueda.test.ts, sin reexportar (evita acoplar los dos
// archivos a un helper compartido que no existe en el repo todavía).
function combo(categoria: string, regimen: string, total: number) {
  return { categoria, regimen, total, pax: 2, menores: { infantes: 0, nino: 0, nino2: 0 } };
}
function resultadoFixture() {
  return {
    hotelId: 1, hotelNombre: "Hotel Almirante", destino: "Cartagena",
    paqueteId: 10, categoria: "Estandar", regimen: "Desayuno",
    paqueteNombre: "Paquete Caribe", total: 400000, noches: 3,
    fechaIda: "2026-10-15", fechaRegreso: "2026-10-18",
    habitaciones: { doble: 1 },
    menores: { infantes: 0, nino: 0, nino2: 0 },
    edadesMenores: [], pax: 2,
    combos: [
      combo("Estandar", "Desayuno", 400000),
      combo("Superior", "Desayuno", 600000),
      combo("Superior", "Todo incluido", 900000),
    ],
    condicion: null,
  } as Parameters<typeof Resultado>[0]["r"];
}

// Lee el <select> de Categoría/Alimentación por el <span> de su rótulo — en
// el JSX real (BuscadorBooking.tsx) el <select> es HIJO del mismo <label>
// que el <span> de texto, así que `label.textContent` incluye también las
// <option> (ej. "CategoríaEstandarSuperior") y un match exacto contra la
// etiqueta nunca calza; el <span> es el único nodo con el texto "puro".
function selectPorEtiqueta(container: HTMLElement, etiqueta: string): HTMLSelectElement {
  const spans = [...container.querySelectorAll("label > span")];
  const span = spans.find((s) => s.textContent?.trim() === etiqueta);
  assert.ok(span, `no se encontró la etiqueta "${etiqueta}"`);
  const select = span!.parentElement?.querySelector("select");
  assert.ok(select, `no se encontró el <select> junto a "${etiqueta}"`);
  return select as HTMLSelectElement;
}

function opcionesDe(select: HTMLSelectElement): string[] {
  return [...select.options].map((o) => o.value);
}

function dispararCambio(select: HTMLSelectElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, valor);
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

describe("Resultado — interacción React real: Categoría/Alimentación ACOTAN el selector interno (con combosPermitidos)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let itemsVistos: unknown[] = [];

  before(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("monta con Categoría=Superior/Alimentación=Desayuno forzados y RESTRINGIDOS — 'Estandar' no es una opción del <select>", () => {
    const r = resultadoFixture();
    // Espía del carrito: un consumidor hermano bajo el MISMO Provider, para
    // leer `items` sin acoplarse a localStorage/temporización de hidratación.
    function CartSpy() {
      const { items } = useCart();
      itemsVistos = items;
      return null;
    }
    root = createRoot(container);
    act(() => {
      root.render(
        h(CartProvider, null,
          h(Resultado, {
            r,
            foto: null,
            info: { estrellas: null, clasificacion: null },
            descripcionPorPaquete: {},
            addonsPorPaquete: new Map(),
            catInicial: "Superior",
            regInicial: "Desayuno",
            combosPermitidos: [
              { categoria: "Superior", regimen: "Desayuno", total: 600000 },
              { categoria: "Superior", regimen: "Todo incluido", total: 900000 },
            ],
          }),
          h(CartSpy, null)
        )
      );
    });

    const selectCategoria = selectPorEtiqueta(container, "Categoría");
    assert.deepEqual(opcionesDe(selectCategoria), ["Superior"], "Estandar no debe ser una opción elegible dentro de la tarjeta");
    assert.equal(selectCategoria.value, "Superior");

    const selectAlimentacion = selectPorEtiqueta(container, "Alimentación");
    assert.deepEqual(opcionesDe(selectAlimentacion), ["Desayuno", "Todo incluido"]);

    // Precio mostrado = el del combo forzado (600.000), no el default barato
    // (400.000, "Estandar") ni ningún otro.
    assert.match(container.textContent ?? "", /\$\s?600\.000/);
    assert.doesNotMatch(container.textContent ?? "", /\$\s?400\.000/);
  });

  test("cambiar Alimentación a 'Todo incluido' (evento DOM real) actualiza el precio Y el combo que iría al carrito — sigue dentro de los combos permitidos", () => {
    const selectAlimentacion = selectPorEtiqueta(container, "Alimentación");
    act(() => { dispararCambio(selectAlimentacion, "Todo incluido"); });
    assert.match(container.textContent ?? "", /\$\s?900\.000/);
    assert.doesNotMatch(container.textContent ?? "", /\$\s?600\.000/);
  });

  test("'Agregar al carrito' agrega el combo REALMENTE seleccionado (Superior/Todo incluido/900000) — nunca el combo excluido por el filtro", () => {
    const boton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Agregar al carrito"));
    assert.ok(boton, "no se encontró el botón 'Agregar al carrito'");
    act(() => { boton!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });

    assert.equal(itemsVistos.length, 1);
    const item = itemsVistos[0] as { categoria: string; regimen: string; precio: number; hotelId: number; paqueteId: number };
    assert.equal(item.categoria, "Superior");
    assert.equal(item.regimen, "Todo incluido");
    assert.equal(item.precio, 900000);
    assert.equal(item.hotelId, 1);
    assert.equal(item.paqueteId, 10);
  });

  test("intentar forzar el <select> nativo a un value fuera de las opciones NO cambia el combo mostrado (jsdom rechaza el value inválido, igual que un navegador real)", () => {
    // Defensa adicional: el propio DOM (no solo React) impide seleccionar
    // "Estandar" en un <select> cuyas <option> no lo incluyen — confirma que
    // la restricción es real a nivel de elemento, no solo de estado React.
    const selectCategoria = selectPorEtiqueta(container, "Categoría");
    const valorAntes = selectCategoria.value;
    dispararCambio(selectCategoria, "Estandar");
    assert.equal(selectCategoria.value, valorAntes, "un <select> nativo ignora un value sin <option> correspondiente");
  });
});

describe("Resultado — cambiar filtros con la tarjeta YA montada: una selección manual cede ante un filtro nuevo más estricto (nunca queda en un combo excluido)", () => {
  // Reproduce el caso real: el asesor filtra por Alimentación=Desayuno (dos
  // categorías válidas, "Estandar" y "Superior"), elige a mano "Superior"
  // dentro de la tarjeta (el usuario SÍ puede moverse libremente dentro de lo
  // permitido) y LUEGO activa Acomodación=Niño 1 arriba — ese filtro nuevo
  // solo lo cumple "Estandar" (ej. "Superior" no tiene tarifa de niño
  // cargada). VistaBooking, al recalcular, le pasaría a esta MISMA tarjeta
  // (sigue montada, no se desmonta/remonta por cada cambio de filtro) un
  // `combosPermitidos` más angosto — se simula aquí re-renderizando el mismo
  // `root` con nuevas props, sin unmount. El combo elegido a mano ("Superior")
  // deja de ser válido: el selector, el precio y el carrito deben caer al
  // único combo que sigue permitido ("Estandar"), nunca quedarse pegados al
  // valor manual ya excluido ni caer en el default original de `r.combos[0]`
  // sin pasar por el filtro vigente.
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let itemsVistos: unknown[] = [];

  function CartSpy() {
    const { items } = useCart();
    itemsVistos = items;
    return null;
  }

  function montar(combosPermitidos: Parameters<typeof Resultado>[0]["combosPermitidos"]) {
    const r = resultadoFixture();
    act(() => {
      root.render(
        h(CartProvider, null,
          h(Resultado, {
            r, foto: null, info: { estrellas: null, clasificacion: null },
            descripcionPorPaquete: {}, addonsPorPaquete: new Map(),
            combosPermitidos,
          }),
          h(CartSpy, null)
        )
      );
    });
  }

  before(() => {
    // `CartProvider` persiste en `localStorage`, compartido por TODO el
    // archivo (mismo `window` de jsdom) — sin limpiarlo, este describe
    // hidrataría con el ítem que ya dejó el describe anterior y contaminaría
    // el conteo de `itemsVistos`.
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // Filtro inicial: Alimentación=Desayuno → dos categorías válidas.
    montar([
      { categoria: "Estandar", regimen: "Desayuno", total: 400000 },
      { categoria: "Superior", regimen: "Desayuno", total: 600000 },
    ]);
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("con el filtro de régimen, el asesor elige a mano 'Superior' (sigue permitido) — precio y carrito lo reflejan", () => {
    const selectCategoria = selectPorEtiqueta(container, "Categoría");
    assert.deepEqual(opcionesDe(selectCategoria), ["Estandar", "Superior"]);
    act(() => { dispararCambio(selectCategoria, "Superior"); });
    assert.equal(selectCategoria.value, "Superior");
    assert.match(container.textContent ?? "", /\$\s?600\.000/);
  });

  test("activar 'Niño 1' (mismo montaje, combosPermitidos se angosta a solo 'Estandar') hace que el selector CEDA la elección manual — nunca queda en 'Superior', ya excluido", () => {
    // Misma tarjeta, sin desmontar: VistaBooking recalculó los filtros
    // generales (Niño 1 activo) y le pasa un `combosPermitidos` nuevo, más
    // estricto, a la MISMA instancia montada.
    montar([{ categoria: "Estandar", regimen: "Desayuno", total: 400000 }]);

    const selectCategoria = selectPorEtiqueta(container, "Categoría");
    assert.deepEqual(opcionesDe(selectCategoria), ["Estandar"], "Superior ya no es una opción: el filtro de Niño 1 lo excluyó");
    assert.equal(selectCategoria.value, "Estandar", "el selector cede la elección manual ante el filtro nuevo, no queda en un valor fantasma");
    assert.match(container.textContent ?? "", /\$\s?400\.000/, "el precio mostrado sigue al combo permitido vigente, no al elegido a mano antes del filtro");
    assert.doesNotMatch(container.textContent ?? "", /\$\s?600\.000/, "el precio del combo ya excluido no debe seguir mostrándose");
  });

  test("'Agregar al carrito' tras el cambio de filtro agrega el combo permitido vigente ('Estandar'/400000) — nunca el manual ya excluido", () => {
    const boton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Agregar al carrito"));
    assert.ok(boton, "no se encontró el botón 'Agregar al carrito'");
    act(() => { boton!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });

    assert.equal(itemsVistos.length, 1);
    const item = itemsVistos[0] as { categoria: string; regimen: string; precio: number };
    assert.equal(item.categoria, "Estandar");
    assert.equal(item.regimen, "Desayuno");
    assert.equal(item.precio, 400000);
  });
});

describe("Resultado — interacción React real: SIN combosPermitidos, el selector conserva las 3 categorías de siempre (sin regresión)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  before(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const r = resultadoFixture();
    act(() => {
      root.render(
        h(CartProvider, null,
          h(Resultado, {
            r, foto: null, info: { estrellas: null, clasificacion: null },
            descripcionPorPaquete: {}, addonsPorPaquete: new Map(),
          })
        )
      );
    });
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("sin filtro activo, 'Estandar' y 'Superior' siguen siendo elegibles (comportamiento previo intacto)", () => {
    const selectCategoria = selectPorEtiqueta(container, "Categoría");
    assert.deepEqual(opcionesDe(selectCategoria), ["Estandar", "Superior"]);
    assert.equal(selectCategoria.value, "Estandar", "sin filtro, el default sigue siendo el más barato (Estandar)");
    assert.match(container.textContent ?? "", /\$\s?400\.000/);
  });

  test("elegir manualmente 'Superior' sigue funcionando (el usuario elige libremente cuando no hay filtro)", () => {
    const selectCategoria = selectPorEtiqueta(container, "Categoría");
    act(() => { dispararCambio(selectCategoria, "Superior"); });
    assert.match(container.textContent ?? "", /\$\s?600\.000/);
  });
});
