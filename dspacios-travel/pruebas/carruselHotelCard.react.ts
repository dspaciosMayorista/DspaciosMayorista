// Se ejecuta con el loader React (jsdom + esbuild):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/carruselHotelCard.react.ts
//
// Carrusel de fotos en la HotelCard del tarifario: una foto a la vez, flechas + contador, sin abrir
// «Ver opciones» al cambiar de foto, sin botones anidados.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/tarifario" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.assign(globalThis, { localStorage: dom.window.localStorage, requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { TarjetaHotelCard } = await import("../app/tarifario/VistaBooking.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(() => dom.window.close());

const galeria = (n: number, p = "a") => Array.from({ length: n }, (_, i) => `https://f/${p}${i + 1}.jpg`);
type Props = { nombre: string; fotos?: string[]; foto?: string | null; onClick: () => void };
const tarjeta = (p: Props) => h(TarjetaHotelCard, { key: p.nombre, onClick: p.onClick, foto: p.foto ?? null, fotos: p.fotos, hotelNombre: p.nombre, destino: "CARTAGENA", desde: 1_000_000, moneda: "COP" });

async function montar(tarjetas: Props[]) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  const pintar = (ts: Props[]) => React.act(async () => raiz.render(h("div", null, ts.map(tarjeta)) as never));
  await pintar(tarjetas);
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return { c, pintar };
}
const clic = (el: Element | null) => { assert.ok(el, "elemento no encontrado"); return React.act(async () => { (el as HTMLElement).click(); }); };
const siguiente = (c: Element) => c.querySelector('button[aria-label^="Foto siguiente"]');
const anterior = (c: Element) => c.querySelector('button[aria-label^="Foto anterior"]');
const contador = (c: Element) => c.querySelector('[aria-live="polite"]')?.textContent?.replace(/\s+/g, " ").trim();
const src = (c: Element) => c.querySelector("img")?.getAttribute("src");

test("18 fotos: abre en la portada con «1 / 18», avanza y retrocede en círculo sin abrir el modal", async () => {
  const fotos = galeria(18);
  let aperturas = 0;
  const { c } = await montar([{ nombre: "Hotel A", fotos, onClick: () => { aperturas++; } }]);
  assert.equal(contador(c), "1 / 18");
  assert.equal(src(c), fotos[0]);
  assert.equal(c.querySelectorAll("img").length, 1, "solo una imagen a la vez");
  await clic(siguiente(c));
  assert.equal(contador(c), "2 / 18");
  assert.equal(src(c), fotos[1]);
  await clic(anterior(c));
  await clic(anterior(c));
  assert.equal(contador(c), "18 / 18");
  assert.equal(src(c), fotos[17]);
  await clic(siguiente(c));
  assert.equal(contador(c), "1 / 18");
  assert.equal(aperturas, 0, "las flechas no abren «Ver opciones»");
});

test("la portada que estaba en medio llega primero (orden ya resuelto por el lector)", async () => {
  const fotos = ["https://f/portada.jpg", "https://f/1.jpg", "https://f/2.jpg"];
  const { c } = await montar([{ nombre: "Hotel B", fotos, onClick: () => {} }]);
  assert.equal(src(c), "https://f/portada.jpg");
});

test("pulsar la tarjeta abre las opciones; HTML válido: sin botón dentro de botón", async () => {
  let aperturas = 0;
  const { c } = await montar([{ nombre: "Hotel C", fotos: galeria(3), onClick: () => { aperturas++; } }]);
  assert.equal(c.querySelectorAll("button button").length, 0);
  await clic(c.querySelector('button[aria-label="Ver opciones de Hotel C"]'));
  assert.equal(aperturas, 1);
  await clic(siguiente(c));
  assert.equal(aperturas, 1);
});

test("flechas alcanzables por teclado: botones nativos enfocables con nombre accesible", async () => {
  const { c } = await montar([{ nombre: "Hotel D", fotos: galeria(2), onClick: () => {} }]);
  for (const b of [siguiente(c), anterior(c)] as HTMLButtonElement[]) {
    assert.equal(b.type, "button");
    assert.notEqual(b.tabIndex, -1);
    assert.ok(b.getAttribute("aria-label"));
  }
});

test("una sola foto: sin controles; ninguna: «Sin foto»; foto suelta sin galería sigue mostrándose", async () => {
  const { c } = await montar([
    { nombre: "Uno", fotos: galeria(1), onClick: () => {} },
    { nombre: "Ninguna", onClick: () => {} },
    { nombre: "Legacy", foto: "https://f/legacy.jpg", onClick: () => {} },
  ]);
  assert.equal(c.querySelectorAll('button[aria-label^="Foto "]').length, 0);
  assert.equal(c.querySelector('[aria-live="polite"]'), null);
  assert.match(c.textContent ?? "", /Sin foto/);
  assert.ok([...c.querySelectorAll("img")].some((i) => i.getAttribute("src") === "https://f/legacy.jpg"));
});

test("varias tarjetas: cada una avanza por su cuenta", async () => {
  const { c } = await montar([
    { nombre: "H1", fotos: galeria(5, "x"), onClick: () => {} },
    { nombre: "H2", fotos: galeria(5, "y"), onClick: () => {} },
  ]);
  const [s1] = c.querySelectorAll('button[aria-label^="Foto siguiente"]');
  await clic(s1); await clic(s1);
  assert.deepEqual([...c.querySelectorAll('[aria-live="polite"]')].map((e) => e.textContent?.replace(/\s+/g, " ").trim()), ["3 / 5", "1 / 5"]);
});

test("cambiar de hotel (otra galería en la misma tarjeta) vuelve a la primera foto", async () => {
  const { c, pintar } = await montar([{ nombre: "H", fotos: galeria(5, "x"), onClick: () => {} }]);
  await clic(siguiente(c)); await clic(siguiente(c));
  assert.equal(contador(c), "3 / 5");
  await pintar([{ nombre: "H", fotos: galeria(4, "z"), onClick: () => {} }]);
  assert.equal(contador(c), "1 / 4");
  assert.equal(src(c), "https://f/z1.jpg");
});

test("misma portada y misma cantidad pero otra foto en la galería: vuelve a la primera foto", async () => {
  const a = galeria(5, "x");
  const b = [...a]; b[3] = "https://f/otra.jpg";
  const { c, pintar } = await montar([{ nombre: "H", fotos: a, onClick: () => {} }]);
  await clic(siguiente(c)); await clic(siguiente(c));
  assert.equal(contador(c), "3 / 5");
  await pintar([{ nombre: "H", fotos: b, onClick: () => {} }]);
  assert.equal(contador(c), "1 / 5");
});
