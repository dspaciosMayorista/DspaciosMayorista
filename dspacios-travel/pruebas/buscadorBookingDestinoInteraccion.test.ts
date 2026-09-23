// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) para el
// cierre de accesibilidad del selector Destino de `BuscadorBooking.tsx`: el
// texto "Destino" vivía en un <label> sin ninguna asociación con el
// `SelectTrigger` de Base UI (un <button role="combobox">), así que su
// nombre accesible salía del placeholder/valor mostrado, nunca del <label>
// visual de arriba. El fix asocia ambos con `aria-labelledby` usando el
// `idBase` que el resto del formulario ya usa para sus otros campos.
//
// Dos cosas verificadas acá, ambas con eventos DOM reales (no invocando
// callbacks internos a mano):
//   1) El trigger tiene nombre accesible EXACTAMENTE "Destino" (vía
//      `aria-labelledby`, que solo concatena el texto del <label>
//      referenciado — nunca el placeholder/valor mostrado).
//   2) Elegir un destino (abriendo el desplegable real de Base UI y
//      haciendo clic en una opción) sigue guardando su nombre e ID
//      correctamente — se observa en los argumentos REALES que
//      `BuscadorBooking` le manda a `buscarHoteles`/
//      `buscarAlojamientosUnidadPorFechas` al pulsar "Buscar hoteles" — y
//      sigue limpiando los resultados anteriores (`onBusqueda(null)`,
//      observable de inmediato tras el cambio de destino, antes de volver a
//      buscar).
//
// Alcance deliberadamente angosto: SOLO se toca/prueba el selector Destino
// de `BuscadorBooking` — ninguna tarjeta (`Resultado`/`TarjetaUnidadBusqueda`,
// ya cubiertas por pruebas/resultadoInteraccion.test.ts) ni ningún otro
// selector del formulario.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { EstadoBusquedaPorcion } from "../app/tarifario/BuscadorBooking.tsx";

// ── Entorno DOM — igual que pruebas/resultadoInteraccion.test.ts, MÁS los
// polyfills que el Select real de Base UI necesita para abrir su popup
// flotante en jsdom: `ResizeObserver`/`Node`/`getComputedStyle` (Floating UI
// los usa para calcular la posición del menú) y un `getBoundingClientRect`
// fijo (jsdom no calcula layout real, así que sin esto Floating UI ve todo
// en 0×0 y algunas de sus cuentas internas fallan). Ninguno de estos hace
// falta en resultadoInteraccion.test.ts porque ahí no se abre ningún popup.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
// Polyfill mínimo: jsdom no implementa ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom no calcula layout real; Floating UI necesita un rect concreto (no
// ceros) para no descartar el popup como "sin espacio".
Element.prototype.getBoundingClientRect = function () {
  return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON() {} };
};
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { BuscadorBooking } = await import("../app/tarifario/BuscadorBooking.tsx");
// Mismo archivo físico que `reactLoader.mjs` redirige cuando `BuscadorBooking.tsx`
// importa "@/app/(dashboard)/dashboard/reservar/actions"/"./busquedaUnidadActions"
// — mismo módulo singleton (misma URL resuelta), así que instalar una
// implementación acá SÍ es la que `BuscadorBooking` termina llamando.
const { __setBuscarHoteles } = await import("./support/stubs/reservarActionsStub.mjs");
const { __setBuscarAlojamientosUnidadPorFechas } = await import("./support/stubs/busquedaUnidadActionsStub.mjs");
const h = React.createElement;

// Resuelve el nombre accesible desde `aria-labelledby` — para este caso
// concreto (un único <label> de texto plano referenciado) esto ES el
// algoritmo real de accname: concatena el texto de los elementos
// referenciados, ignorando el contenido propio del elemento (placeholder/
// valor mostrado). No es un polyfill general de accname (el repo no tiene
// dom-accessibility-api ni @testing-library instalados) — alcanza para
// verificar exactamente lo que pide esta prueba.
function nombreAccesiblePorAriaLabelledby(el: Element): string {
  const ids = (el.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/).filter(Boolean);
  assert.ok(ids.length > 0, "el elemento no tiene aria-labelledby");
  return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
}

function triggerDestino(container: HTMLElement): HTMLButtonElement {
  const trigger = container.querySelector('button[role="combobox"]');
  assert.ok(trigger, "no se encontró el trigger (Base UI SelectTrigger) de Destino");
  return trigger as HTMLButtonElement;
}

// Abre el desplegable real de Base UI (clic en el trigger) y hace clic en la
// opción pedida — el mismo flujo de eventos DOM que un usuario real, no una
// invocación directa de `onValueChange`.
async function elegirDestino(container: HTMLElement, texto: string) {
  const trigger = triggerDestino(container);
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
  // Acotado al popup REALMENTE abierto (`aria-controls` del trigger) — no a
  // `document.body` entero: sin animaciones CSS reales en jsdom, el popup
  // que se acaba de cerrar (de una elección anterior) puede quedar en el DOM
  // esperando un `transitionend` que nunca llega, y una búsqueda global por
  // `[role="option"]` puede encontrar ítems del popup viejo en vez del que
  // se acaba de abrir.
  const listaId = trigger.getAttribute("aria-controls");
  assert.ok(listaId, "el trigger no expone aria-controls con el popup abierto");
  const lista = document.getElementById(listaId!);
  assert.ok(lista, `no se encontró el popup abierto (id="${listaId}")`);
  const item = [...lista!.querySelectorAll('[role="option"]')].find((o) => o.textContent === texto);
  assert.ok(item, `no se encontró la opción "${texto}" en el desplegable de Destino`);
  await act(async () => {
    // `SelectItem` (Base UI) solo acepta un `click` de mouse si un
    // `pointerdown` previo armó `allowMouseSelectionRef` — sin él, un click
    // de mouse "de la nada" sobre un ítem que NO está resaltado (ej. abrir
    // de nuevo con OTRO valor ya elegido, donde el resaltado por defecto cae
    // en el valor actual, no en el que estamos por elegir) se descarta como
    // inválido. Un usuario real siempre dispara `pointerdown` antes del
    // `click` — acá hay que hacerlo explícito porque `MouseEvent` solo no
    // lo implica.
    item!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    item!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    item!.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    item!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

function inputJuntoAEtiqueta(container: HTMLElement, etiqueta: string): HTMLInputElement {
  const labels = [...container.querySelectorAll("label")];
  const label = labels.find((l) => l.textContent?.trim() === etiqueta);
  assert.ok(label, `no se encontró la etiqueta "${etiqueta}"`);
  const input = label!.parentElement?.querySelector("input");
  assert.ok(input, `no se encontró el <input> junto a "${etiqueta}"`);
  return input as HTMLInputElement;
}

function dispararCambioInput(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, valor);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

describe("BuscadorBooking.tsx — Destino: cierre de accesibilidad (nombre accesible) + selección real sigue guardando nombre/ID y limpiando resultados anteriores", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const estadosVistos: (EstadoBusquedaPorcion | null)[] = [];

  const destinos = [
    { id: 1, nombre: "Cartagena" },
    { id: 2, nombre: "San Andrés" },
  ];

  before(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        h(BuscadorBooking, {
          destinos,
          onBusqueda: (estado: EstadoBusquedaPorcion | null) => { estadosVistos.push(estado); },
        })
      );
    });
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("el trigger de Destino tiene nombre accesible EXACTAMENTE 'Destino' (aria-labelledby, no el placeholder)", () => {
    const trigger = triggerDestino(container);
    assert.equal(nombreAccesiblePorAriaLabelledby(trigger), "Destino");
    // El placeholder sigue siendo visible (no se perdió contenido) — el
    // fix es de accesibilidad, no de UI: el placeholder/valor mostrado
    // simplemente deja de ser lo que la accesibilidad reporta como "nombre".
    assert.match(trigger.textContent ?? "", /Selecciona un destino/);
  });

  test("elegir 'Cartagena' con un clic real actualiza el trigger y, al buscar, la Server Action recibe destino/destinoId correctos", async () => {
    const capturadoRef: { valor: { destino?: string; destinoId?: number | null } | null } = { valor: null };
    __setBuscarHoteles(async () => ({ ok: true as const, resultados: [], diagnostico: undefined, sugerenciasFecha: [] }));
    __setBuscarAlojamientosUnidadPorFechas(async (input: { destino?: string; destinoId?: number | null }) => {
      capturadoRef.valor = input;
      return { ok: true as const, disponibilidad: [], incompleto: false };
    });

    await elegirDestino(container, "Cartagena");
    assert.match(triggerDestino(container).textContent ?? "", /Cartagena/, "el trigger debe mostrar el destino recién elegido");

    // Fecha de ida ya trae el default de "hoy" — solo falta el regreso.
    dispararCambioInput(inputJuntoAEtiqueta(container, "Regreso"), "2030-01-05");

    const botonBuscar = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Buscar hoteles"));
    assert.ok(botonBuscar, "no se encontró el botón 'Buscar hoteles'");
    await act(async () => {
      botonBuscar!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.ok(capturadoRef.valor, "buscarAlojamientosUnidadPorFechas no fue llamado — la búsqueda no llegó a ejecutarse");
    assert.equal(capturadoRef.valor.destino, "Cartagena");
    assert.equal(capturadoRef.valor.destinoId, 1, "el ID del destino elegido debe viajar junto al nombre");

    // `onBusqueda` recibió el resultado de ESTA búsqueda (no null) — hay
    // "resultados anteriores" que la siguiente prueba debe ver limpiados.
    const ultimo = estadosVistos[estadosVistos.length - 1];
    assert.ok(ultimo !== null, "onBusqueda debía recibir el resultado de la búsqueda de Cartagena, no null");
    assert.equal(ultimo!.destino, "Cartagena");
  });

  test("cambiar a 'San Andrés' (clic real, misma tarjeta de búsqueda montada) limpia los resultados anteriores DE INMEDIATO — antes de volver a buscar", async () => {
    const llamadasAntes = estadosVistos.length;
    await elegirDestino(container, "San Andrés");
    assert.match(triggerDestino(container).textContent ?? "", /San Andrés/);

    // `limpiarResultados()` corre SINCRÓNICAMENTE dentro del propio manejador
    // de `onValueChange` — debe verse ANTES de tocar el botón "Buscar" de
    // nuevo, o el usuario vería (aunque sea un instante) resultados del
    // destino anterior mezclados con la nueva selección.
    assert.ok(estadosVistos.length > llamadasAntes, "onBusqueda debía llamarse al cambiar de destino (limpiar resultados)");
    assert.equal(estadosVistos[estadosVistos.length - 1], null, "el cambio de destino debe limpiar los resultados anteriores (onBusqueda(null))");
  });

  test("buscar de nuevo tras el cambio manda el nombre/ID de 'San Andrés' (nunca los de 'Cartagena', ya reemplazados)", async () => {
    const capturadoRef: { valor: { destino?: string; destinoId?: number | null } | null } = { valor: null };
    __setBuscarAlojamientosUnidadPorFechas(async (input: { destino?: string; destinoId?: number | null }) => {
      capturadoRef.valor = input;
      return { ok: true as const, disponibilidad: [], incompleto: false };
    });

    const botonBuscar = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Buscar hoteles"));
    assert.ok(botonBuscar, "no se encontró el botón 'Buscar hoteles'");
    await act(async () => {
      botonBuscar!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.ok(capturadoRef.valor, "buscarAlojamientosUnidadPorFechas no fue llamado en la segunda búsqueda");
    assert.equal(capturadoRef.valor.destino, "San Andrés");
    assert.equal(capturadoRef.valor.destinoId, 2, "el ID debe ser el de 'San Andrés' — no debe arrastrar el de 'Cartagena'");

    const ultimo = estadosVistos[estadosVistos.length - 1];
    assert.ok(ultimo !== null);
    assert.equal(ultimo!.destino, "San Andrés");
  });
});
