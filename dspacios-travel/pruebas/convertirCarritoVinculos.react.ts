// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// Vista previa de la conversión de un carrito (`ConvertirCarritoBtn`) con un
// servicio vinculado a su hotel: interacción React real (jsdom), con la
// Server Action `convertirCotizacionCarrito` reemplazada por un stub
// configurable. Comprueba:
//   · vínculo inválido → aviso visible y botón bloqueado (no se puede convertir);
//   · un pasajero del servicio que no viaja en su hotel → error ANTES de enviar
//     (misma regla que el servidor), aunque la cantidad coincida;
//   · caso válido con "1 contrato por destino" → envía asignaciones al servidor.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
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
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { ConvertirCarritoBtn } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/ConvertirCarritoBtn.tsx");
const { __setConvertirCotizacionCarrito } = await import("./support/stubs/reservarActionsStub.mjs");
const h = React.createElement;
const espera = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
function escribir(input: HTMLInputElement, valor: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

// Dos hoteles del mismo paquete en destinos distintos + un servicio vinculado
// al primero cuyo destino viene escrito distinto ("Cartagena ").
const props = {
  id: 1, pax: 3,
  items: [
    { hotelNombre: "Hotel Almirante", destino: "CARTAGENA", pax: 2, fechaIda: "2030-03-01" },
    { hotelNombre: "Hotel Rodadero", destino: "SANTA MARTA", pax: 1, fechaIda: "2030-03-04" },
  ],
  tours: [{ nombre: "Islas del Rosario", destino: "Cartagena ", pax: 2, fechaIda: "2030-03-01", hotelIndice: 0 }],
  destinos: ["CARTAGENA", "SANTA MARTA"],
  cliente: { nombres: "Ana", apellidos: "Pérez", numeroDoc: "1" },
  esSuperadmin: true, asesores: [], miNombre: "", miRolVenta: false,
};

async function montar(extra: Record<string, unknown> = {}) {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  await act(async () => { r.render(h(ConvertirCarritoBtn, { ...props, ...extra } as never)); await espera(); });
  return { c, r };
}
// Fila de checkboxes de una unidad ("Hotel Almirante", "Tour: Islas…").
function checks(c: HTMLElement, rotulo: string): HTMLInputElement[] {
  const bloque = [...c.querySelectorAll("div.rounded-lg.bg-white")].find((d) => d.querySelector("p")?.textContent?.startsWith(rotulo))!;
  return [...bloque.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
}
async function prepararPasajeros(c: HTMLElement) {
  await act(async () => { click(boton(/Confirmar → generar contrato/, c)!); await espera(); });
  // Nombres/apellidos de los 3 pasajeros (el 1 viene del cliente).
  const nombres = [...c.querySelectorAll("label")].filter((l) => l.textContent === "Nombres").map((l) => l.parentElement!.querySelector("input")!) as HTMLInputElement[];
  const apellidos = [...c.querySelectorAll("label")].filter((l) => l.textContent === "Apellidos").map((l) => l.parentElement!.querySelector("input")!) as HTMLInputElement[];
  await act(async () => {
    nombres.forEach((n, i) => { if (!n.value) escribir(n, `P${i + 1}`); });
    apellidos.forEach((a, i) => { if (!a.value) escribir(a, `X${i + 1}`); });
    await espera();
  });
  // Rodadero (1 pax) lo usa el pasajero 3: desmarca el 1 (default) y marca el 3.
  await act(async () => { click(checks(c, "Hotel Rodadero")[0]); click(checks(c, "Hotel Rodadero")[2]); await espera(); });
}

describe("ConvertirCarritoBtn — servicios vinculados a su hotel", () => {
  const llamadas: { id: number; opts: { agrupar: string; asignaciones: number[][]; asignacionesTours: number[][] } }[] = [];
  before(() => { __setConvertirCotizacionCarrito(async (id: number, opts: never) => { llamadas.push({ id, opts }); return { ok: true, numeros: ["DTM-1"] }; }); });
  after(() => { __setConvertirCotizacionCarrito(null); });

  test("vínculo inválido: aviso visible y no se puede iniciar la conversión", async () => {
    const { c, r } = await montar({ vinculoError: "«Islas del Rosario» está vinculado a un hotel que no se encuentra en esta cotización." });
    assert.match(c.querySelector('[role="alert"]')?.textContent ?? "", /vinculado a un hotel que no se encuentra/);
    assert.equal(boton(/Confirmar → generar contrato/, c)!.disabled, true);
    act(() => r.unmount()); c.remove();
  });

  test("pasajero del servicio que NO viaja en su hotel (misma cantidad): error antes de enviar", async () => {
    const { c, r } = await montar();
    await prepararPasajeros(c);
    // Islas (2 pax): desmarca el pasajero 2 y marca el 3 (que no viaja en Almirante).
    await act(async () => { click(checks(c, "Tour: Islas")[1]); click(checks(c, "Tour: Islas")[2]); await espera(); });
    await act(async () => { click(boton(/^Generar contrato/, c)!); await espera(); });
    assert.match(c.textContent ?? "", /Islas del Rosario: el pasajero 3 no viaja en «Hotel Almirante»/);
    assert.equal(llamadas.length, 0, "no se envía nada al servidor");
    act(() => r.unmount()); c.remove();
  });

  test("válido con '1 contrato por destino': envía agrupar y asignaciones (servicio ⊆ hotel)", async () => {
    const { c, r } = await montar();
    await prepararPasajeros(c);
    await act(async () => { click(boton(/1 contrato por destino/, c)!); await espera(); });
    await act(async () => { click(boton(/^Generar contrato/, c)!); await espera(50); });
    assert.equal(llamadas.length, 1, c.textContent ?? "");
    assert.equal(llamadas[0].opts.agrupar, "por_destino");
    assert.deepEqual(llamadas[0].opts.asignaciones, [[1, 2], [3]]);
    assert.deepEqual(llamadas[0].opts.asignacionesTours, [[1, 2]]);
    act(() => r.unmount()); c.remove();
  });
});
