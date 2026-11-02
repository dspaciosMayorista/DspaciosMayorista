import { test, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// #120 (PR #432) — formulario «Solicitar cotización»: «¿Viajan menores?» primero (las edades solo si responde Sí y nunca viajan ocultas) y selectores de
// tipo de habitación / plan de alimentación alimentados SOLO con lo configurado para ese hotel. Monta el componente de producción.

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- React necesita los globales del DOM en esta prueba.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.HTMLSelectElement = dom.window.HTMLSelectElement;
global.localStorage = dom.window.localStorage;
global.FormData = dom.window.FormData;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enviados: Record<string, unknown>[] = [];
const ocupaciones: Record<string, unknown>[] = [];
mock.module(new URL("./support/stubs/solicitudHotelActionsStub.mjs", import.meta.url).href, {
  namedExports: {
    crearSolicitudHotel: async (raw: Record<string, unknown>) => { enviados.push(raw); return { ok: true, codigo: "SOL-1", url: "", waUrl: null, mailtoUrl: null, repetida: false, texto: "" }; },
    validarOcupacionSolicitud: async (raw: Record<string, unknown>) => { ocupaciones.push(raw); return { ok: true, adultos: 2, ninos: 0, infantes: 0 }; },
  },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { SolicitudHotelCard } = await import("../app/tarifario/SolicitudHotelCard.tsx");
const h = React.createElement;

const HOTEL = {
  hotelId: 7, hotelNombre: "Hotel Caribe", paqueteId: 5, paqueteNombre: "Cartagena marzo", tipo: "bloqueo" as const, destinoNombre: "CARTAGENA", moneda: "COP" as const,
  adultsOnly: false, petFriendly: false, estrellas: 4, zona: null,
  categorias: ["Estándar", "Suite Mar"], regimenes: [{ codigo: "PAM", nombre: "Media pensión" }, { codigo: "PC", nombre: "PC" }],
  foto: "/f1.jpg" as string | null, fotos: ["/f1.jpg", "/f2.jpg", "/f3.jpg"] as string[], salidas: [{ bloqueoId: 10, empaquetadoId: null, ruta: "BOG-CTG", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13" }], viaje: null,
};

let contenedor: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
before(() => { contenedor = document.createElement("div"); document.body.appendChild(contenedor); });
beforeEach(() => { enviados.length = 0; ocupaciones.length = 0; root = createRoot(contenedor); });
afterEach(() => { act(() => root.unmount()); });
after(() => contenedor.remove());

const montar = (hotel: typeof HOTEL) => act(() => root.render(h(SolicitudHotelCard, { hotel })));
const q = <T extends Element>(sel: string) => document.querySelector(sel) as T | null;
const clic = (el: Element) => act(() => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
function escribir(el: HTMLInputElement | HTMLSelectElement, valor: string) {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => { set.call(el, valor); el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
const abrir = () => clic([...document.querySelectorAll("button")].find((b) => b.textContent === "Solicitar cotización")!);
const radio = (v: "si" | "no") => q<HTMLInputElement>(`input[name="viajan-menores"][value="${v}"]`)!;
const edades = () => q<HTMLInputElement>('[data-testid="solicitud-edades"]');
async function enviar() {
  const form = q<HTMLFormElement>("form")!;
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
}

test("la tarjeta sigue siendo «bajo solicitud»: sin precio y con «Solicitar cotización»", () => {
  montar(HOTEL);
  const t = document.body.textContent ?? "";
  assert.match(t, /Tarifa y disponibilidad bajo solicitud/);
  assert.match(t, /Solicitar cotización/);
  assert.doesNotMatch(t, /\$\s?\d|desde/i);
  assert.equal(q('[data-testid="solicitud-hotel-7"] [title="4 estrellas"]')?.querySelectorAll("svg").length, 4);
});

test("la imagen usa el carrusel del hotel normal: todas las fotos cargadas, flechas y contador", () => {
  montar(HOTEL);
  const card = q("[data-testid=solicitud-hotel-7]")!;
  const img = () => card.querySelector("img")!.getAttribute("src");
  assert.equal(img(), "/f1.jpg");
  assert.match(card.textContent ?? "", /1 \/ 3/);
  clic(card.querySelector('button[aria-label^="Foto siguiente"]')!);
  assert.equal(img(), "/f2.jpg");
  clic(card.querySelector('button[aria-label^="Foto siguiente"]')!);
  clic(card.querySelector('button[aria-label^="Foto siguiente"]')!);
  assert.equal(img(), "/f1.jpg", "vuelve a la primera");
  clic(card.querySelector('button[aria-label^="Foto anterior"]')!);
  assert.equal(img(), "/f3.jpg");
  assert.ok(card.querySelector(".aspect-\\[16\\/10\\]"), "misma proporción 16:10 que la tarjeta de un hotel con tarifa");
});

test("con una sola foto no hay controles y sin fotos dice «Sin foto»", () => {
  montar({ ...HOTEL, foto: "/f1.jpg", fotos: ["/f1.jpg"] });
  assert.equal(document.querySelector('button[aria-label^="Foto siguiente"]'), null);
  montar({ ...HOTEL, foto: null, fotos: [] });
  assert.match(document.body.textContent ?? "", /Sin foto/);
});

test("pregunta primero «¿Viajan menores?» y NO muestra el campo de edades hasta responder Sí", () => {
  montar(HOTEL); abrir();
  assert.match(q("[data-testid=solicitud-menores]")!.textContent ?? "", /¿Viajan menores\?/);
  assert.equal(edades(), null);
  assert.equal(radio("si").checked, false);
  assert.equal(radio("no").checked, false);
  clic(radio("si"));
  assert.ok(edades(), "con Sí aparece el campo de edades");
  assert.equal(edades()!.required, true);
});

test("responder No oculta el campo y NO envía edades antiguas ocultas", async () => {
  montar(HOTEL); abrir();
  clic(radio("si"));
  escribir(edades()!, "3, 7");
  escribir(q<HTMLInputElement>('[data-testid="solicitud-adultos"]')!, "1");
  clic(radio("no"));
  assert.equal(edades(), null, "el campo desaparece");
  assert.equal(q('[data-testid="solicitud-adultos"]'), null);
  await enviar();
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].edadesMenores, []);
  assert.equal(enviados[0].viajanMenores, false);
  assert.equal(enviados[0].adultos, null);
});

test("volver a Sí después de No no resucita las edades ni los adultos anteriores", () => {
  montar(HOTEL); abrir();
  clic(radio("si"));
  escribir(edades()!, "3, 7");
  escribir(q<HTMLInputElement>('[data-testid="solicitud-adultos"]')!, "1");
  clic(radio("no"));
  clic(radio("si"));
  assert.equal(edades()!.value, "");
  assert.equal(q('[data-testid="solicitud-adultos"]'), null, "sin edades no se pregunta por adultos");
});

test("responder Sí envía las edades escritas", async () => {
  montar(HOTEL); abrir();
  clic(radio("si"));
  escribir(edades()!, "3, 7");
  await enviar();
  assert.deepEqual(enviados[0].edadesMenores, [3, 7]);
  assert.equal(enviados[0].viajanMenores, true);
});

test("sin responder la pregunta no se envía", async () => {
  montar(HOTEL); abrir();
  await enviar();
  assert.equal(enviados.length, 0);
  assert.match(q("[role=alert]")?.textContent ?? "", /Indica si viajan menores/);
});

test("un hotel Adults Only no pregunta por menores y envía una lista vacía", async () => {
  montar({ ...HOTEL, adultsOnly: true }); abrir();
  assert.equal(q("[data-testid=solicitud-menores]"), null);
  assert.equal(edades(), null);
  await enviar();
  assert.deepEqual(enviados[0].edadesMenores, []);
  assert.equal(enviados[0].viajanMenores, false);
});

test("tipo de habitación y plan de alimentación son selectores con SOLO lo configurado para el hotel", async () => {
  montar(HOTEL); abrir();
  const cat = q<HTMLSelectElement>("[data-testid=solicitud-categoria]")!;
  const reg = q<HTMLSelectElement>("[data-testid=solicitud-regimen]")!;
  assert.equal(cat.tagName, "SELECT");
  assert.equal(reg.tagName, "SELECT");
  assert.deepEqual([...cat.options].map((o) => o.textContent), ["A confirmar", "Estándar", "Suite Mar"]);
  assert.deepEqual([...reg.options].map((o) => o.textContent), ["A confirmar", "PAM · Media pensión", "PC"]);
  assert.deepEqual([...reg.options].map((o) => o.value), ["", "PAM", "PC"]);
  escribir(cat, "Suite Mar"); escribir(reg, "PAM");
  clic(radio("no"));
  await enviar();
  assert.equal(enviados[0].categoria, "Suite Mar");
  assert.equal(enviados[0].regimen, "PAM");
});

test("sin selección se envía vacío (el servidor lo deja «A confirmar»)", async () => {
  montar(HOTEL); abrir(); clic(radio("no"));
  await enviar();
  assert.equal(enviados[0].categoria, "");
  assert.equal(enviados[0].regimen, "");
});

test("un hotel sin catálogo configurado no ofrece selector ni texto libre: lo dice", () => {
  montar({ ...HOTEL, categorias: [], regimenes: [] }); abrir();
  assert.equal(q("[data-testid=solicitud-categoria]"), null);
  assert.equal(q("[data-testid=solicitud-regimen]"), null);
  assert.ok(q("[data-testid=solicitud-sin-categorias]"));
  assert.ok(q("[data-testid=solicitud-sin-regimenes]"));
  // Ningún campo de texto libre para estos datos.
  const etiquetas = [...document.querySelectorAll("label")].filter((l) => /Tipo de habitación|Plan de alimentación/.test(l.textContent ?? ""));
  for (const l of etiquetas) assert.equal(l.querySelector("input"), null);
});

test("las opciones de un hotel no se mezclan con las de otro", () => {
  montar({ ...HOTEL, categorias: ["Junior Suite"], regimenes: [{ codigo: "FULL", nombre: "FULL" }] }); abrir();
  const cat = q<HTMLSelectElement>("[data-testid=solicitud-categoria]")!;
  assert.deepEqual([...cat.options].map((o) => o.textContent), ["A confirmar", "Junior Suite"]);
  assert.ok(![...q<HTMLSelectElement>("[data-testid=solicitud-regimen]")!.options].some((o) => o.value === "PAM"));
});
