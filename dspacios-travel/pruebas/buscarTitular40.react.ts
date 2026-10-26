// Se ejecuta con npm run test:react. #40 E2: interacción real de BuscarTitular (número compartido entre tipos, sin coincidencias,
// datos previos no pisados, descarte de respuestas tardías al cambiar número o contexto).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { BuscarTitular } = await import("../components/personas/BuscarTitular.tsx");
const { __setBuscarTitularPorNumero } = await import("./support/stubs/buscarTitularStub.mjs");
const h = React.createElement;

const cand = (tipoDoc: string, nombres: string) => ({ tipoDoc, numero: "123456", divergencia: false, datos: { nombres, apellidos: "Pérez", telefono: "300" } });
function diferido() {
  let resolve!: (v: unknown) => void;
  const promesa = new Promise<unknown>((r) => { resolve = r; });
  return { promesa, resolve };
}
const espera = () => new Promise((r) => setTimeout(r, 5));

describe("BuscarTitular", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  before(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  after(() => { act(() => root.unmount()); container.remove(); });

  const render = (props: Record<string, unknown>) => act(async () => { root.render(h(BuscarTitular, props as never)); await espera(); });
  const click = (el: Element) => act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await espera(); });
  const boton = () => container.querySelector('button[title^="Buscar este documento"]') as HTMLButtonElement;

  test("sin número el botón está deshabilitado", async () => {
    await render({ numero: " ", actual: {}, onAplicar: () => {} });
    assert.equal(boton().disabled, true);
  });

  test("sin coincidencias: mensaje de captura manual y nada que aplicar", async () => {
    __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [] }));
    await render({ numero: "999", actual: {}, onAplicar: () => assert.fail("no debe aplicar") });
    await click(boton());
    assert.match(container.textContent ?? "", /Sin coincidencias/);
  });

  test("mismo número en dos tipos: exige elegir; lo escrito no se pisa", async () => {
    __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [cand("CC", "Ana"), cand("CE", "Beto")] }));
    const aplicados: Record<string, unknown>[] = [];
    await render({ numero: "123456", actual: { nombres: "Escrito", telefono: "" }, onAplicar: (p: Record<string, unknown>) => aplicados.push(p) });
    await click(boton());
    assert.match(container.textContent ?? "", /más de un tipo/);
    assert.equal([...container.querySelectorAll("button")].some((b) => b.textContent === "Aplicar datos"), false, "no aplica sin elegir");
    await click([...container.querySelectorAll("ul li button")].find((b) => /CE 123456/.test(b.textContent ?? ""))!);
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Aplicar datos")!);
    assert.deepEqual(aplicados[0], { tipoDoc: "CE", apellidos: "Pérez", telefono: "300" });
  });

  test("respuesta tardía de un número anterior se descarta", async () => {
    const r1 = diferido();
    __setBuscarTitularPorNumero(async () => r1.promesa);
    await render({ numero: "111", actual: {}, onAplicar: () => {} });
    await click(boton());
    await render({ numero: "222", actual: {}, onAplicar: () => {} });
    await act(async () => { r1.resolve({ ok: true, candidatos: [cand("CC", "Viejo")] }); await espera(); });
    assert.doesNotMatch(container.textContent ?? "", /Viejo/);
  });

  test("cambio de contexto invalida lo mostrado", async () => {
    __setBuscarTitularPorNumero(async () => ({ ok: true, candidatos: [cand("CC", "Ana")] }));
    await render({ numero: "123456", contexto: "a", actual: {}, onAplicar: () => {} });
    await click(boton());
    assert.match(container.textContent ?? "", /Aplicar datos/);
    await render({ numero: "123456", contexto: "b", actual: {}, onAplicar: () => {} });
    assert.doesNotMatch(container.textContent ?? "", /Aplicar datos/);
  });
});
