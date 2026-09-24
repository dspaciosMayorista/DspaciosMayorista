// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) —
// mismo criterio que pruebas/buscadorReceptivosPendienteInteraccion.react.ts,
// para `BuscarPasajeroDocumento` (migración 187).
//
// Qué prueba, con eventos/promesas reales (nunca simulado a mano):
//   1) Al cambiar el documento MIENTRAS una búsqueda anterior sigue en
//      vuelo (nunca resuelta todavía), el panel se cierra e invalida DE
//      INMEDIATO — nunca queda "Buscando…" colgado del documento viejo.
//   2) Dos búsquedas de documentos DISTINTOS, resueltas FUERA DE ORDEN (la
//      del documento nuevo resuelve primero; la del documento viejo resuelve
//      después, tarde): el resultado tardío del documento VIEJO nunca se
//      muestra ni pisa el resultado vigente.
//   3) El único botón de "aplicar" que queda clickeable corresponde SIEMPRE
//      al documento vigente — nunca se puede aplicar un dato del documento
//      anterior.
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
const { BuscarPasajeroDocumento } = await import("../components/pasajeros/BuscarPasajeroDocumento.tsx");
const { __setBuscarPasajeroPorDocumento } = await import("./support/stubs/buscarPasajeroStub.mjs");
const h = React.createElement;

type PasajeroEncontradoFixture = {
  nombre: string;
  nombres: string | null;
  apellidos: string | null;
  fechaNacimiento: string | null;
  nacionalidad: string | null;
  vecesVisto: number;
  ultimoContrato: string | null;
  ultimaFecha: string | null;
};

function diferido<T>() {
  let resolve!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolve = r; });
  return { promesa, resolve };
}

function botonBuscar(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector('button[title="Buscar este documento en contratos anteriores"]');
  assert.ok(btn, "no se encontró el botón de búsqueda");
  return btn as HTMLButtonElement;
}

function botonesResultado(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll("ul li button")] as HTMLButtonElement[];
}

describe("BuscarPasajeroDocumento.tsx — invalidación al cambiar el documento con una búsqueda en vuelo", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let aplicados: { datos: unknown; nombre: string }[];

  function render(props: { tipoId: string; identificacion: string; onAplicar: (datos: unknown, nombre: string) => void }) {
    return act(async () => {
      root.render(h(BuscarPasajeroDocumento, props));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  before(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  after(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("cambio de documento con la búsqueda anterior pendiente + dos respuestas fuera de orden: nunca se aplica el dato del documento anterior", async () => {
    aplicados = [];
    const onAplicar = (datos: unknown, nombre: string) => aplicados.push({ datos, nombre });

    // R1 = búsqueda del documento "111" (el que se está por abandonar).
    // R2 = búsqueda del documento "222" (el vigente al final de la prueba).
    const r1 = diferido<{ ok: true; resultados: PasajeroEncontradoFixture[] }>();
    const r2 = diferido<{ ok: true; resultados: PasajeroEncontradoFixture[] }>();
    const documentosConsultados: string[] = [];
    __setBuscarPasajeroPorDocumento(async (_tipoId: string, doc: string) => {
      documentosConsultados.push(doc);
      if (doc === "111") return r1.promesa;
      if (doc === "222") return r2.promesa;
      throw new Error("documento inesperado en la prueba: " + doc);
    });

    // 1) Documento "111", clic en Buscar → dispara R1 (deliberadamente NUNCA
    //    se resuelve todavía — se resuelve tarde, más abajo, fuera de orden).
    await render({ tipoId: "CC", identificacion: "111", onAplicar });
    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.match(container.textContent ?? "", /Buscando…/, "debe mostrar 'Buscando…' mientras R1 está en vuelo");

    // 2) El usuario cambia el documento a "222" CON R1 TODAVÍA PENDIENTE
    //    (nunca se resolvió y nunca se dispara una búsqueda nueva todavía en
    //    este paso) — la invalidación debe ser inmediata e INDEPENDIENTE de
    //    que se dispare o no una búsqueda nueva después (ver el comentario
    //    de `tokenRef.current++` dentro del propio componente).
    await render({ tipoId: "CC", identificacion: "222", onAplicar });
    assert.doesNotMatch(container.textContent ?? "", /Buscando…/, "el cambio de documento debe limpiar 'pending' de inmediato, sin esperar a R1");
    assert.equal(container.querySelector("ul"), null, "no debe quedar ningún panel de resultados abierto tras cambiar el documento");

    // 3) Clic en Buscar de nuevo, ahora sobre "222" → dispara R2.
    await act(async () => {
      botonBuscar(container).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.deepEqual(documentosConsultados, ["111", "222"]);

    // 4) R2 ("222", la búsqueda VIGENTE) resuelve PRIMERO.
    await act(async () => {
      r2.resolve({
        ok: true,
        resultados: [{ nombre: "PERSONA DOS", nombres: null, apellidos: null, fechaNacimiento: "2000-02-02", nacionalidad: null, vecesVisto: 1, ultimoContrato: "00-0002", ultimaFecha: "2026-02-02" }],
      });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.match(container.textContent ?? "", /PERSONA DOS/, "debe mostrar el resultado de la búsqueda VIGENTE (documento 222)");

    // 5) R1 ("111", la búsqueda del documento YA ABANDONADO) resuelve TARDE,
    //    FUERA DE ORDEN — no debe reaparecer ni pisar el resultado vigente.
    await act(async () => {
      r1.resolve({
        ok: true,
        resultados: [{ nombre: "PERSONA UNO VIEJA", nombres: null, apellidos: null, fechaNacimiento: "1990-01-01", nacionalidad: null, vecesVisto: 1, ultimoContrato: "00-0001", ultimaFecha: "2026-01-01" }],
      });
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.doesNotMatch(container.textContent ?? "", /PERSONA UNO/, "la respuesta tardía del documento ANTERIOR nunca debe mostrarse");
    assert.match(container.textContent ?? "", /PERSONA DOS/, "el resultado vigente (222) debe seguir mostrado, sin pisarlo");

    // 6) Único botón clickeable → debe aplicar los datos de "222", NUNCA los
    //    de "111" (verificación DIRECTA de que nunca se puede aplicar el
    //    documento anterior, no solo que no se muestra en pantalla).
    const botones = botonesResultado(container);
    assert.equal(botones.length, 1, "solo debe quedar un resultado clickeable (el del documento vigente)");
    await act(async () => {
      botones[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(aplicados.length, 1, "onAplicar debe llamarse exactamente una vez");
    assert.equal(aplicados[0].nombre, "PERSONA DOS");
    assert.deepEqual((aplicados[0].datos as { fechaNacimiento: string }).fechaNacimiento, "2000-02-02");
  });
});
