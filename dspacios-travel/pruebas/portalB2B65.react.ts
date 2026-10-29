// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #65 — Portal B2B: teclado y accesibilidad de lo que se renderiza en el cliente/servidor:
//   · subpestañas = enlaces reales (?vista=) con aria-current en la activa;
//   · tablas desplazables en móvil: región enfocable con nombre accesible;
//   · carrusel de planes: marcado como demostración, botones con nombre, sin precios.
import { test } from "node:test";
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
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { SubPestanas, TablaScroll } = await import("../components/portal/PortalShell.tsx");
const { PlanesRecomendados } = await import("../components/portal/PlanesRecomendados.tsx");

async function montar(el: React.ReactElement) {
  const cont = document.createElement("div");
  document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(el); });
  return { cont, root };
}

test("subpestañas: enlaces reales con ?vista= y aria-current solo en la activa", async () => {
  const { cont, root } = await montar(
    React.createElement(SubPestanas, {
      base: "/portal/b2b/ventas", actual: "asistidas", etiqueta: "Tipo de venta",
      items: [{ id: "directas", label: "Directas", cuenta: 2 }, { id: "asistidas", label: "Asistidas", cuenta: 0 }],
    })
  );
  const enlaces = [...cont.querySelectorAll("a")];
  assert.deepEqual(enlaces.map((a) => a.getAttribute("href")), ["/portal/b2b/ventas?vista=directas", "/portal/b2b/ventas?vista=asistidas"]);
  assert.deepEqual(enlaces.map((a) => a.getAttribute("aria-current")), [null, "page"]);
  assert.equal(cont.querySelector("nav")?.getAttribute("aria-label"), "Tipo de venta");
  assert.ok(enlaces.every((a) => a.tabIndex !== -1), "todos alcanzables con Tab");
  await act(async () => root.unmount());
});

test("tabla: región desplazable enfocable con nombre accesible (móvil sin ratón)", async () => {
  const { cont, root } = await montar(
    React.createElement(TablaScroll as never, { etiqueta: "Historial de pagos" }, React.createElement("tbody", null, React.createElement("tr", null, React.createElement("td", null, "x"))))
  );
  const region = cont.querySelector('[role="region"]') as HTMLElement;
  assert.equal(region.getAttribute("aria-label"), "Historial de pagos");
  assert.equal(region.tabIndex, 0);
  assert.match(region.className, /overflow-x-auto/);
  await act(async () => root.unmount());
});

test("carrusel: demostración visible, botones con nombre, mover no rompe y no hay precios", async () => {
  const { cont, root } = await montar(React.createElement(PlanesRecomendados));
  assert.match(cont.textContent ?? "", /Demostración/);
  assert.doesNotMatch(cont.textContent ?? "", /\$\s?\d|COP|USD/);
  const botones = [...cont.querySelectorAll("button")];
  assert.deepEqual(botones.map((b) => b.getAttribute("aria-label")), ["Planes anteriores", "Planes siguientes"]);
  const pista = cont.querySelector("ul") as HTMLElement;
  let movido = 0;
  pista.scrollBy = ((o: { left: number }) => { movido = o.left; }) as never;
  await act(async () => { botones[1].click(); });
  assert.ok(movido > 0, "siguiente avanza");
  await act(async () => { botones[0].click(); });
  assert.ok(movido < 0, "anterior retrocede");
  assert.equal(pista.tabIndex, 0, "la pista se puede desplazar con flechas del teclado");
  assert.equal(cont.querySelectorAll("li").length, 4);
  await act(async () => root.unmount());
});
