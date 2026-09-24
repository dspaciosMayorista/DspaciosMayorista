// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) para
// `PasajerosContratoClient` (CRM — migración 188).
//
// Qué prueba, con promesas reales (nunca simulado a mano):
//   1) Búsqueda: escribir rápido (dos términos distintos, sin esperar la
//      primera respuesta) y resolver las dos peticiones FUERA DE ORDEN (la
//      del término nuevo primero, la del término viejo después, tarde) —
//      la respuesta tardía del término ABANDONADO nunca debe pisar
//      filas/total/error de la búsqueda vigente.
//   2) Cambio de página: mismo patrón — pedir "Siguiente" y volver a
//      "Anterior" antes de que la primera resuelva, resolver fuera de
//      orden, confirmar que la página vigente nunca se pisa con datos de
//      la página abandonada.
import { test, describe, beforeEach, afterEach } from "node:test";
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
const { PasajerosContratoClient } = await import("../app/(crm)/crm/pasajeros/PasajerosContratoClient.tsx");
const { __setBuscarPasajerosContrato } = await import("./support/stubs/pasajerosContratoActionsStub.mjs");
const h = React.createElement;

type Fila = { pasajeroId: number; numeroContrato: string; tenant: string; nombre: string; tipoId: string | null; identificacion: string | null; fechaNacimiento: string | null };

function diferido<T>() {
  let resolve!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolve = r; });
  return { promesa, resolve };
}

function fila(nombre: string): Fila {
  return { pasajeroId: Math.random(), numeroContrato: "DTM-0001", tenant: "mayorista", nombre, tipoId: "CC", identificacion: "1", fechaNacimiento: null };
}

function inputBusqueda(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector("input");
  assert.ok(input, "no se encontró el input de búsqueda");
  return input as HTMLInputElement;
}

function dispararCambioInput(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, valor);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function botonPorTexto(container: HTMLElement, texto: RegExp): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? ""));
  assert.ok(btn, `no se encontró el botón que matchee ${texto}`);
  return btn as HTMLButtonElement;
}

describe("PasajerosContratoClient.tsx — invalidación de respuestas fuera de orden", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  // `beforeEach`/`afterEach` (no `before`/`after`, que solo corren una vez
  // por describe): cada test necesita un componente RECIÉN montado — si los
  // dos tests compartieran la misma instancia, el estado (busqueda/pagina)
  // del primero seguiría vivo al empezar el segundo.
  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("búsqueda: dos respuestas resueltas en orden inverso — la del término abandonado nunca pisa la vigente", async () => {
    const rViejo = diferido<{ ok: true; filas: Fila[]; totalFilas: number }>();
    const rNuevo = diferido<{ ok: true; filas: Fila[]; totalFilas: number }>();
    const consultados: string[] = [];
    __setBuscarPasajerosContrato(async (busqueda: string) => {
      consultados.push(busqueda);
      if (busqueda === "viejo") return rViejo.promesa;
      if (busqueda === "nuevo") return rNuevo.promesa;
      return { ok: true, filas: [], totalFilas: 0 }; // búsqueda inicial vacía, al montar
    });

    await act(async () => {
      root.render(h(PasajerosContratoClient));
      await new Promise((r) => setTimeout(r, 10));
    });

    // 1) Escribe "viejo" → dispara R(viejo), deliberadamente NUNCA resuelta todavía.
    await act(async () => {
      dispararCambioInput(inputBusqueda(container), "viejo");
      await new Promise((r) => setTimeout(r, 10));
    });

    // 2) Sin esperar, escribe "nuevo" → dispara R(nuevo) (invalida R(viejo) por token).
    await act(async () => {
      dispararCambioInput(inputBusqueda(container), "nuevo");
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.deepEqual(consultados.slice(-2), ["viejo", "nuevo"]);

    // 3) R(nuevo) resuelve PRIMERO.
    await act(async () => {
      rNuevo.resolve({ ok: true, filas: [fila("PERSONA NUEVA")], totalFilas: 1 });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.match(container.textContent ?? "", /PERSONA NUEVA/, "debe mostrar el resultado de la búsqueda VIGENTE (nuevo)");

    // 4) R(viejo) resuelve TARDE, fuera de orden — nunca debe reaparecer.
    await act(async () => {
      rViejo.resolve({ ok: true, filas: [fila("PERSONA VIEJA ABANDONADA")], totalFilas: 1 });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.doesNotMatch(container.textContent ?? "", /PERSONA VIEJA/, "la respuesta tardía del término abandonado nunca debe mostrarse");
    assert.match(container.textContent ?? "", /PERSONA NUEVA/, "el resultado vigente debe seguir mostrado, sin pisarlo");
    assert.match(container.textContent ?? "", /1 pasajero/, "el total mostrado debe seguir siendo el de la búsqueda vigente (1), no el de la abandonada");
  });

  test("paginación: Siguiente y Anterior disparados antes de resolver — la página abandonada nunca pisa la vigente", async () => {
    const rPag1 = diferido<{ ok: true; filas: Fila[]; totalFilas: number }>();
    const rPag2 = diferido<{ ok: true; filas: Fila[]; totalFilas: number }>();
    let llamados = 0;
    __setBuscarPasajerosContrato(async (_busqueda: string, pagina: number) => {
      llamados++;
      if (llamados === 1) return { ok: true, filas: [fila("PERSONA PAGINA 1 INICIAL")], totalFilas: 60 }; // montaje inicial, 60 → 3 páginas de 25
      if (pagina === 2) return rPag2.promesa;
      if (pagina === 1) return rPag1.promesa;
      return { ok: true, filas: [], totalFilas: 0 };
    });

    await act(async () => {
      root.render(h(PasajerosContratoClient));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.match(container.textContent ?? "", /Página 1 de 3/);

    // 1) Clic en "Siguiente" (pagina=2) → dispara R(pag2), NUNCA resuelta todavía.
    await act(async () => {
      botonPorTexto(container, /Siguiente/).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

    // 2) Sin esperar, clic en "Anterior" (vuelve a pagina=1) → dispara R(pag1),
    //    que invalida por token la petición de la página 2 todavía en vuelo.
    await act(async () => {
      botonPorTexto(container, /Anterior/).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });

    // 3) R(pag1) (la página VIGENTE) resuelve PRIMERO.
    await act(async () => {
      rPag1.resolve({ ok: true, filas: [fila("PERSONA PAGINA 1 VIGENTE")], totalFilas: 60 });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.match(container.textContent ?? "", /PERSONA PAGINA 1 VIGENTE/);

    // 4) R(pag2) (la página ABANDONADA) resuelve TARDE, fuera de orden.
    await act(async () => {
      rPag2.resolve({ ok: true, filas: [fila("PERSONA PAGINA 2 ABANDONADA")], totalFilas: 60 });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.doesNotMatch(container.textContent ?? "", /PAGINA 2 ABANDONADA/, "la respuesta tardía de la página abandonada nunca debe mostrarse");
    assert.match(container.textContent ?? "", /PERSONA PAGINA 1 VIGENTE/, "la página vigente (1) debe seguir mostrada, sin pisarla");
    assert.match(container.textContent ?? "", /Página 1 de 3/, "el indicador de página debe seguir reflejando la página vigente");
  });
});
