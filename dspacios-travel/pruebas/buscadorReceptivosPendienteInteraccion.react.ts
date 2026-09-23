// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) —
// mismo criterio que pruebas/buscadorBookingPendienteInteraccion.react.ts,
// para `BuscadorReceptivos` (self-contained: pinta su propio isotipo, no
// necesita `onPendingChange` hacia un padre). Se controla el momento exacto
// en que la Server Action resuelve (promesas "diferidas" propias) para
// probar, con eventos reales:
//   1) Al pulsar "Buscar receptivos", aparece el isotipo (`role="status"`)
//      sobre el área de resultados MIENTRAS la Server Action no ha resuelto.
//   2) Al resolver (éxito o error), el isotipo se retira — un solo punto de
//      código para ambos casos (ver el comentario junto a `buscando` en el
//      propio archivo).
//   3) "Limpiar resultados" con la búsqueda todavía en vuelo retira el
//      isotipo DE INMEDIATO, sin esperar esa respuesta — y la respuesta
//      tardía (ya invalidada) no lo revive ni publica nada.
//
// Verificado además en navegador real (Playwright, con throttling de red
// real) contra este mismo componente — evidencia entregada aparte.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

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
const { BuscadorReceptivos } = await import("../app/tarifario/BuscadorReceptivos.tsx");
const { __setBuscarReceptivos } = await import("./support/stubs/reservarActionsStub.mjs");
const h = React.createElement;

function diferido<T>() {
  let resolve!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolve = r; });
  return { promesa, resolve };
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
  const btn = [...container.querySelectorAll("button")].find((b) => /Buscar receptivos|Buscando/.test(b.textContent ?? ""));
  assert.ok(btn, "no se encontró el botón 'Buscar receptivos'/'Buscando…'");
  return btn as HTMLButtonElement;
}

function botonLimpiar(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Limpiar resultados")) as HTMLButtonElement | undefined;
}

function isotipoVisible(container: HTMLElement): boolean {
  return container.querySelector('[role="status"]') != null;
}

describe("BuscadorReceptivos.tsx — isotipo durante la búsqueda, retiro en éxito/error/limpieza", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  before(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        h(BuscadorReceptivos, {
          onVerDetalle: () => {},
          // `paqueteAcotado` (vía `initial`) mantiene "Limpiar resultados"
          // visible desde el arranque, INDEPENDIENTE de `resultados` — sin
          // esto el botón solo aparece tras una búsqueda ya resuelta (ver
          // su condición `resultados != null || paqueteAcotado != null`),
          // así que la prueba de "limpiar a mitad de vuelo" (más abajo) no
          // tendría ningún botón que pulsar en la primera búsqueda.
          // `fechaIda`/`fechaRegreso` null: no dispara una búsqueda sola al
          // montar (`aplicarPrefill` solo busca si ambas fechas vienen).
          initial: { paqueteId: 5, destino: null, fechaIda: null, fechaRegreso: null, pax: 2, nonce: 1 },
        })
      );
    });
    dispararCambioInput(inputJuntoAEtiqueta(container, "Ida"), "2030-01-01");
    dispararCambioInput(inputJuntoAEtiqueta(container, "Regreso"), "2030-01-05");
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("clic en 'Buscar receptivos' muestra el isotipo mientras la Server Action no resuelve, y lo retira al resolver con ÉXITO", async () => {
    const d = diferido<{ ok: true; resultados: [] }>();
    __setBuscarReceptivos(async () => d.promesa);

    assert.equal(isotipoVisible(container), false, "no debe haber isotipo antes de buscar");
    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(isotipoVisible(container), true, "debe mostrar el isotipo mientras la búsqueda está en vuelo");
    assert.match(botonBuscar(container).textContent ?? "", /Buscando/);

    await act(async () => {
      d.resolve({ ok: true, resultados: [] });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(isotipoVisible(container), false, "debe retirar el isotipo al resolver con éxito");
    assert.match(container.textContent ?? "", /0 receptivo\(s\) disponibles/);
  });

  test("clic en 'Buscar receptivos' con error también retira el isotipo — el retiro no depende de éxito/error", async () => {
    const d = diferido<{ ok: false; error: string }>();
    __setBuscarReceptivos(async () => d.promesa);

    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(isotipoVisible(container), true);

    await act(async () => {
      d.resolve({ ok: false, error: "Búsqueda no disponible en este momento. Intenta nuevamente." });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(isotipoVisible(container), false, "debe retirar el isotipo aunque la búsqueda haya terminado en error");
    assert.match(container.textContent ?? "", /Búsqueda no disponible en este momento/);
  });

  test("'Limpiar resultados' CON la búsqueda todavía en vuelo retira el isotipo DE INMEDIATO, y la respuesta tardía no lo revive ni publica nada", async () => {
    const d = diferido<{ ok: true; resultados: [] }>();
    __setBuscarReceptivos(async () => d.promesa);

    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(isotipoVisible(container), true, "la búsqueda debe quedar pendiente (la Server Action deliberadamente no resolvió)");

    const limpiar = botonLimpiar(container);
    assert.ok(limpiar, "no se encontró 'Limpiar resultados' con una búsqueda vigente");
    await act(async () => {
      limpiar!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(isotipoVisible(container), false, "'Limpiar resultados' debe retirar el isotipo de inmediato");

    await act(async () => {
      d.resolve({ ok: true, resultados: [] });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(isotipoVisible(container), false, "la respuesta tardía no debe reactivar el isotipo");
    assert.doesNotMatch(container.textContent ?? "", /receptivo\(s\) disponibles/, "la respuesta tardía no debe publicar un resultado tras 'Limpiar'");
  });
});
