// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) para el
// fix de Preview "el botón dice BUSCANDO… pero la grilla anterior sigue
// visible": `BuscadorBooking` ahora expone `onPendingChange` (`buscando`,
// deliberadamente NO el `pending` crudo de `useTransition` — ver el
// comentario junto a `buscando` en el propio archivo), que `VistaBooking`
// usa para mostrar el isotipo en vez de caer al catálogo de exploración
// mientras la búsqueda está en vuelo.
//
// Se controla el momento exacto en que las Server Actions resuelven
// (promesas "diferidas" propias, nunca temporizadores fijos) para probar,
// con eventos reales:
//   1) Al pulsar "Buscar hoteles", `onPendingChange(true)` llega ANTES de
//      que la Server Action resuelva.
//   2) Al resolver (éxito), llega `onPendingChange(false)` — una sola vez,
//      sin quedar "pegado" en true.
//   3) Si la Server Action resuelve con error, TAMBIÉN llega
//      `onPendingChange(false)` — el retiro no depende de si el resultado
//      fue éxito o error (mismo punto de código para ambos, ver
//      `buscar()`).
//   4) Pulsar "Limpiar resultados" CON una búsqueda todavía en vuelo (la
//      Server Action deliberadamente sin resolver todavía) retira
//      `onPendingChange` a `false` DE INMEDIATO — sin esperar a que esa
//      promesa se asiente — y cuando esa respuesta tardía finalmente
//      resuelve, no vuelve a publicarse (protección real:
//      `generacionBusquedaRef`, ya cubierta por otras pruebas — acá solo se
//      confirma que tampoco revive el isotipo).
//
// Verificado además en navegador real (Playwright, con throttling de red
// real) contra este mismo componente montado en una página pública —
// evidencia entregada aparte, no en este archivo.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { EstadoBusquedaPorcion } from "../app/tarifario/BuscadorBooking.tsx";

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
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.getBoundingClientRect = function () {
  return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON() {} };
};
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { BuscadorBooking } = await import("../app/tarifario/BuscadorBooking.tsx");
const { __setBuscarHoteles } = await import("./support/stubs/reservarActionsStub.mjs");
const { __setBuscarAlojamientosUnidadPorFechas } = await import("./support/stubs/busquedaUnidadActionsStub.mjs");
const h = React.createElement;

function diferido<T>() {
  let resolve!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolve = r; });
  return { promesa, resolve };
}

function triggerDestino(container: HTMLElement): HTMLButtonElement {
  const trigger = container.querySelector('button[role="combobox"]');
  assert.ok(trigger, "no se encontró el trigger de Destino");
  return trigger as HTMLButtonElement;
}

async function elegirDestino(container: HTMLElement, texto: string) {
  const trigger = triggerDestino(container);
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
  const listaId = trigger.getAttribute("aria-controls");
  assert.ok(listaId, "el trigger no expone aria-controls con el popup abierto");
  const lista = document.getElementById(listaId!);
  assert.ok(lista, `no se encontró el popup abierto (id="${listaId}")`);
  const item = [...lista!.querySelectorAll('[role="option"]')].find((o) => o.textContent === texto);
  assert.ok(item, `no se encontró la opción "${texto}"`);
  await act(async () => {
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

function botonBuscar(container: HTMLElement): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) => /Buscar hoteles|Buscando/.test(b.textContent ?? ""));
  assert.ok(btn, "no se encontró el botón 'Buscar hoteles'/'Buscando…'");
  return btn as HTMLButtonElement;
}

function botonLimpiar(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Limpiar resultados")) as HTMLButtonElement | undefined;
}

const destinos = [{ id: 1, nombre: "Cartagena" }];

describe("BuscadorBooking.tsx — onPendingChange: isotipo durante la búsqueda, retiro en éxito/error/limpieza", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let pendientesVistos: boolean[];
  let estadosVistos: (EstadoBusquedaPorcion | null)[];

  before(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    pendientesVistos = [];
    estadosVistos = [];
    await act(async () => {
      root.render(
        h(BuscadorBooking, {
          destinos,
          onBusqueda: (estado: EstadoBusquedaPorcion | null) => { estadosVistos.push(estado); },
          onPendingChange: (p: boolean) => { pendientesVistos.push(p); },
        })
      );
    });
    await elegirDestino(container, "Cartagena");
    dispararCambioInput(inputJuntoAEtiqueta(container, "Regreso"), "2030-01-05");
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("clic en 'Buscar hoteles' dispara onPendingChange(true) ANTES de que la Server Action resuelva, y onPendingChange(false) al resolver con ÉXITO", async () => {
    const dHoteles = diferido<{ ok: true; resultados: []; diagnostico: undefined; sugerenciasFecha: [] }>();
    const dUnidad = diferido<{ ok: true; disponibilidad: []; incompleto: false }>();
    __setBuscarHoteles(async () => dHoteles.promesa);
    __setBuscarAlojamientosUnidadPorFechas(async () => dUnidad.promesa);

    pendientesVistos.length = 0;
    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.deepEqual(pendientesVistos, [true], "debe anunciar 'pendiente' de inmediato, antes de que la Server Action resuelva");
    assert.match(botonBuscar(container).textContent ?? "", /Buscando/);

    await act(async () => {
      dHoteles.resolve({ ok: true, resultados: [], diagnostico: undefined, sugerenciasFecha: [] });
      dUnidad.resolve({ ok: true, disponibilidad: [], incompleto: false });
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.deepEqual(pendientesVistos, [true, false], "debe retirar el isotipo exactamente una vez al resolver con éxito");
    assert.match(botonBuscar(container).textContent ?? "", /Buscar hoteles/);
  });

  test("clic en 'Buscar hoteles' con la Server Action resolviendo en ERROR también retira onPendingChange (false) — el retiro no depende de éxito/error", async () => {
    const dHoteles = diferido<{ ok: false; error: string }>();
    const dUnidad = diferido<{ ok: true; disponibilidad: []; incompleto: false }>();
    __setBuscarHoteles(async () => dHoteles.promesa);
    __setBuscarAlojamientosUnidadPorFechas(async () => dUnidad.promesa);

    pendientesVistos.length = 0;
    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.deepEqual(pendientesVistos, [true]);

    await act(async () => {
      dHoteles.resolve({ ok: false, error: "Búsqueda no disponible en este momento. Intenta nuevamente." });
      dUnidad.resolve({ ok: true, disponibilidad: [], incompleto: false });
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.deepEqual(pendientesVistos, [true, false], "debe retirar el isotipo igual aunque la búsqueda haya terminado en error");
    assert.match(container.textContent ?? "", /Búsqueda no disponible en este momento/);
  });

  test("'Limpiar resultados' CON la búsqueda todavía en vuelo retira onPendingChange(false) DE INMEDIATO — no espera a que esa promesa se asiente, y la respuesta tardía no revive nada", async () => {
    const dHoteles = diferido<{ ok: true; resultados: []; diagnostico: undefined; sugerenciasFecha: [] }>();
    const dUnidad = diferido<{ ok: true; disponibilidad: []; incompleto: false }>();
    __setBuscarHoteles(async () => dHoteles.promesa);
    __setBuscarAlojamientosUnidadPorFechas(async () => dUnidad.promesa);

    pendientesVistos.length = 0;
    estadosVistos.length = 0;
    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.deepEqual(pendientesVistos, [true], "la búsqueda debe quedar pendiente (la Server Action deliberadamente no resolvió todavía)");

    const limpiar = botonLimpiar(container);
    assert.ok(limpiar, "el botón 'Limpiar resultados' debe estar visible con una búsqueda vigente");
    await act(async () => {
      limpiar!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    assert.deepEqual(pendientesVistos, [true, false], "'Limpiar resultados' debe retirar el isotipo de inmediato, sin esperar la respuesta en vuelo");

    // La respuesta "tardía" (invalidada por 'Limpiar') resuelve DESPUÉS —
    // no debe volver a publicar ni a reactivar el isotipo.
    await act(async () => {
      dHoteles.resolve({ ok: true, resultados: [], diagnostico: undefined, sugerenciasFecha: [] });
      dUnidad.resolve({ ok: true, disponibilidad: [], incompleto: false });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.deepEqual(pendientesVistos, [true, false], "la respuesta tardía no debe volver a tocar onPendingChange");
    assert.equal(estadosVistos[estadosVistos.length - 1], null, "la respuesta tardía no debe publicar un resultado tras 'Limpiar'");
  });
});
