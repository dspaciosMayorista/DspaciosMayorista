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

test("carrusel: demostración visible, sin precios y botones con nombre", async () => {
  const { cont, root } = await montar(React.createElement(PlanesRecomendados));
  assert.match(cont.textContent ?? "", /Demostración/);
  assert.doesNotMatch(cont.textContent ?? "", /$s?d|COP|USD/);
  assert.deepEqual([...cont.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")), ["Planes anteriores", "Planes siguientes"]);
  const pista = cont.querySelector("ul") as HTMLElement;
  assert.equal(pista.tabIndex, 0, "la pista se puede desplazar con el teclado");
  assert.equal(cont.querySelectorAll("li").length, 4);
  await act(async () => root.unmount());
});

test("carrusel: cada pulsación mueve UNA tarjeta entera, las flechas se deshabilitan en los extremos y varios clics seguidos suman", async () => {
  const { cont, root } = await montar(React.createElement(PlanesRecomendados));
  const pista = cont.querySelector("ul") as HTMLElement;
  const [ant, sig] = [...cont.querySelectorAll("button")] as HTMLButtonElement[];
  // Geometría de 4 tarjetas de 220 px con 10 px de separación; la ventana muestra una.
  [...pista.children].forEach((li, i) => Object.defineProperty(li, "offsetLeft", { value: i * 230, configurable: true }));
  let x = 0;
  Object.defineProperty(pista, "scrollLeft", { get: () => x, configurable: true });
  Object.defineProperty(pista, "clientWidth", { value: 220, configurable: true });
  Object.defineProperty(pista, "scrollWidth", { value: 910, configurable: true });
  const destinos: number[] = [];
  (pista as unknown as { scrollTo: (o: { left: number }) => void }).scrollTo = (o) => { destinos.push(o.left); };
  const desplazar = async (n: number) => { x = n; await act(async () => { pista.dispatchEvent(new dom.window.Event("scroll")); }); };

  await desplazar(0);
  assert.equal(ant.disabled, true, "al inicio no se retrocede");
  assert.equal(sig.disabled, false);
  await act(async () => { sig.click(); });
  assert.deepEqual(destinos, [230], "una tarjeta completa");
  await act(async () => { sig.click(); });
  assert.deepEqual(destinos, [230, 460], "un segundo clic sin terminar la animación suma otra tarjeta");
  await desplazar(460);
  await act(async () => { sig.click(); });
  assert.equal(destinos.at(-1), 690, "la última tarjeta queda entera y pegada al borde");
  await desplazar(690);
  assert.equal(sig.disabled, true, "al final no se avanza");
  assert.equal(ant.disabled, false);
  await act(async () => { ant.click(); });
  assert.equal(destinos.at(-1), 460);
  assert.ok(destinos.every((d) => d % 230 === 0), "siempre alineado a una tarjeta, nunca cortada");
  await desplazar(460); // la animación termina en la tarjeta pedida
  // Teclado: la flecha derecha de la pista mueve igual que el botón.
  await desplazar(0);
  await act(async () => { pista.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  assert.equal(destinos.at(-1), 230);
  await act(async () => root.unmount());
});
