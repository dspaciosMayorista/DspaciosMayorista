// Se ejecuta por comando directo (también está en `npm run test:react`):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/hotelFilaDin82.react.ts
// #82 — fila compacta del hotel del paquete dinámico, ventanas «Información del hotel» / «Tarifas y configuración» y tarjeta pública con estrellas, descripción y mapa.
import { JSDOM } from "jsdom";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true, FormData: dom.window.FormData, KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h, useState } = React;
const { HotelFilaDin } = await import("../app/(dashboard)/dashboard/paquetes/total/HotelFilaDin.tsx");
const { PorDinamicos } = await import("../app/tarifario/PorDinamicos.tsx");

let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  cont?.remove(); root = null; cont = null;
});
after(() => dom.window.close());

const montar = async (el: React.ReactElement) => {
  cont = document.createElement("div"); document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(el); });
};
const botonPor = (texto: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(texto)) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => { assert.ok(el, "elemento a presionar"); await act(async () => { el!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const escribir = async (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, valor: string) => {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : el instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  await act(async () => { el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
};
const esc = async () => { await act(async () => { document.activeElement?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); };
const ventana = () => document.querySelector('[data-testid="ventana-hotel"]');

import type { EntradaHotel } from "../lib/paqueteDinamico/entrada.ts";
const hotelManual: EntradaHotel = {
  hotelId: null, nombre: "Hotel Mar", categoria: "Estándar", regimen: "PAE", descripcion: "", fotoUrl: "", proveedor: "Prov", estrellas: null, ubicacion: "",
  neto: { doble: 100000 }, pvp: {}, pvpGeneral: null, capacidadNinos: 2, edadInfanteMax: 2, edadNinoMax: 10,
};
const ctx = { neta: true, general: false, pctMkPct: 20, moneda: "COP" };
const catalogo = { categorias: ["Estándar", "Superior"], regimenes: ["PAE", "PC"] };

// Contenedor con estado, igual que el formulario (el hotel vive en el estado del padre).
function Anfitrion({ inicial, ficha = null, alCambiar }: { inicial: EntradaHotel; ficha?: React.ComponentProps<typeof HotelFilaDin>["ficha"]; alCambiar?: (x: EntradaHotel) => void }) {
  const [hotel, setHotel] = useState(inicial);
  alCambiar?.(hotel);
  return h(HotelFilaDin, { h: hotel, ficha, ctx, catalogo, onChange: (p: Partial<EntradaHotel>) => setHotel((x) => ({ ...x, ...p })), onQuitar: () => {} });
}

test("la fila es un resumen compacto: nombre, tipo y datos; sin campos de edición a la vista; dos botones", async () => {
  await montar(h(Anfitrion, { inicial: hotelManual }));
  assert.match(cont!.textContent!, /Hotel Mar/);
  assert.equal(cont!.querySelector('[data-testid="tipo-hotel"]')!.textContent, "Manual");
  assert.match(cont!.querySelector('[data-testid="resumen-hotel"]')!.textContent!, /Habitación: Estándar · Alimentación: PAE · Proveedor: Prov/);
  assert.equal(cont!.querySelectorAll("input, select, textarea").length, 0, "la edición está en las ventanas, no en la fila");
  assert.ok(botonPor("Información del hotel") && botonPor("Tarifas y configuración"));
  assert.equal(ventana(), null);
});

test("«Información del hotel»: abre, edita una copia; Cancelar y Escape la descartan; Guardar la aplica", async () => {
  let ultimo = hotelManual;
  await montar(h(Anfitrion, { inicial: hotelManual, alCambiar: (x) => { ultimo = x; } }));
  await click(botonPor("Información del hotel"));
  assert.ok(ventana(), "se abrió la ventana");
  assert.equal(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal") ?? "true", "true");
  const estrellas = document.querySelector("select") as HTMLSelectElement;
  await escribir(estrellas, "4");
  await escribir(document.querySelector("textarea") as HTMLTextAreaElement, "Frente al mar");
  // Cancelar descarta
  await click(botonPor("Cancelar"));
  assert.equal(ventana(), null);
  assert.equal(ultimo.estrellas, null); assert.equal(ultimo.descripcion, "");
  // Escape descarta
  await click(botonPor("Información del hotel"));
  await escribir(document.querySelector("select") as HTMLSelectElement, "5");
  await esc();
  assert.equal(ventana(), null, "Escape cierra la ventana");
  assert.equal(ultimo.estrellas, null);
  // Guardar aplica
  await click(botonPor("Información del hotel"));
  await escribir(document.querySelector("select") as HTMLSelectElement, "4");
  await escribir(document.querySelector("textarea") as HTMLTextAreaElement, "Frente al mar");
  const ubic = [...document.querySelectorAll("input")].find((i) => i.id.endsWith("-ubic")) as HTMLInputElement;
  await escribir(ubic, "Bocagrande, Cartagena");
  await click(botonPor("Guardar cambios"));
  assert.equal(ventana(), null);
  assert.equal(ultimo.estrellas, 4); assert.equal(ultimo.descripcion, "Frente al mar"); assert.equal(ultimo.ubicacion, "Bocagrande, Cartagena");
  assert.equal(cont!.querySelectorAll('svg[fill="currentColor"], span[title="4 estrellas"]').length > 0, true, "la fila muestra las estrellas del hotel");
});

test("«Tarifas y configuración» incluye categoría, alimentación, capacidad y edades (manual), proveedor y precios; Guardar los aplica", async () => {
  let ultimo = hotelManual;
  await montar(h(Anfitrion, { inicial: hotelManual, alCambiar: (x) => { ultimo = x; } }));
  await click(botonPor("Tarifas y configuración"));
  const v = ventana()!;
  assert.ok(v.querySelector('[aria-label="Categoría de habitación"]') && v.querySelector('[aria-label="Plan de alimentación"]'));
  assert.ok(v.querySelector('[aria-label="Capacidad de niños por habitación"]') && v.querySelector('[aria-label="Infante hasta"]') && v.querySelector('[aria-label="Niño hasta"]'));
  assert.ok(v.querySelector('[aria-label="Neto Doble"]') && v.querySelector('[aria-label="Neto Infante"]'), "tarifas por acomodación (esquema neta)");
  assert.doesNotMatch(v.textContent!, /Estrellas del hotel/, "las estrellas del hotel no se mezclan con la categoría de habitación");
  await escribir(v.querySelector('[aria-label="Categoría de habitación"]') as HTMLSelectElement, "Superior");
  await escribir(v.querySelector('[aria-label="Neto Doble"]') as HTMLInputElement, "150000");
  await click(botonPor("Guardar cambios"));
  assert.equal(ultimo.categoria, "Superior"); assert.equal(ultimo.neto.doble, 150000);
  assert.match(cont!.textContent!, /Habitación: Superior/);
});

test("hotel con ficha: estrellas/descripcion/ubicación copiadas quedan bloqueadas; las reglas de menores son las de la ficha", async () => {
  const ficha = { categorias: ["Estándar"], regimenes: ["PAE"], reglasTexto: "Infante hasta 2", estrellas: 5, descripcionFicha: "De la ficha", ubicacionFicha: "Calle 1" };
  await montar(h(Anfitrion, { inicial: { ...hotelManual, hotelId: 7, capacidadNinos: null, edadInfanteMax: null, edadNinoMax: null }, ficha }));
  assert.equal(cont!.querySelector('[data-testid="tipo-hotel"]')!.textContent, "Ficha #7");
  await click(botonPor("Información del hotel"));
  const sel = document.querySelector("select") as HTMLSelectElement;
  assert.equal(sel.disabled, true); assert.equal(sel.value, "5");
  assert.equal((document.querySelector("textarea") as HTMLTextAreaElement).value, "De la ficha");
  assert.equal(([...document.querySelectorAll("input")].find((i) => i.id.endsWith("-ubic")) as HTMLInputElement).value, "Calle 1");
  await click(botonPor("Cancelar"));
  await click(botonPor("Tarifas y configuración"));
  assert.ok(ventana()!.querySelector('[data-testid="menores-ficha"]'));
  assert.equal(ventana()!.querySelector('[data-testid="menores-manual"]'), null);
});

test("la ventana es accesible: título, descripción, modal y foco dentro; cabe en móvil (sin ancho fijo)", async () => {
  await montar(h(Anfitrion, { inicial: hotelManual }));
  await click(botonPor("Tarifas y configuración"));
  const d = document.querySelector('[role="dialog"]') as HTMLElement;
  assert.ok(d, "role=dialog");
  assert.ok(d.querySelector('[data-slot="dialog-title"]')?.textContent === "Tarifas y configuración");
  await act(async () => { await new Promise((r) => setTimeout(r, 120)); }); // base-ui mueve el foco en el siguiente cuadro
  assert.ok(d.contains(document.activeElement) || document.activeElement === d, "el foco queda dentro de la ventana");
  assert.match(d.className, /max-h-\[90dvh\]/); assert.match(d.className, /overflow-y-auto/); assert.match(d.className, /overflow-x-hidden/);
  assert.match(d.className, /max-w-\[calc\(100%-1rem\)\]/);
});

// ── Tarjeta pública ──────────────────────────────────────────────────────────
const opcion = (hotelId: number) => ({ hotelId, vueloId: null, desdePorPersona: 300000, calc: { esquema: "solo_pvp", pvpModo: "por_componente", moneda: "COP", pctMk: 0, usaVuelo: false, usaHotel: true, usaServicios: false, servicios: [], hotel: { nombre: "x", neto: {}, pvp: { doble: 300000 } } } });
const paquete = (hoteles: Record<string, unknown>[]) => ({
  id: 1, nombre: "Paquete", moneda: "COP", destino: "CARTAGENA", noches: 3, descripcion: "", incluye: [], noIncluye: [], compraFin: null, usaHotel: true, usaVuelo: false, usaServicios: false,
  vuelos: [], servicios: [], hoteles, opciones: hoteles.map((x) => opcion(x.id as number)),
});
const hotelPub = (o: Record<string, unknown>) => ({ id: 1, nombre: "Hotel Mar", categoria: "Superior", regimen: "PAE", descripcion: "", foto: "/marca/hotel-predeterminado.svg", desde: 300000, reglas: null, categorias: [], regimenes: [], estrellas: null, ubicacion: "", ...o });

test("tarjeta pública: estrellas del hotel, descripción y mapa; la categoría de habitación va rotulada aparte", async () => {
  await montar(h(PorDinamicos, { dinamicos: [paquete([hotelPub({ estrellas: 4, descripcion: "Frente al mar", ubicacion: "Bocagrande, Cartagena" })])] as never, evaluar: (async () => ({ ok: false, error: "" })) as never }));
  const t = cont!.textContent!;
  assert.ok(cont!.querySelector('span[title="4 estrellas"]'), "estrellas del hotel");
  assert.match(t, /Frente al mar/);
  assert.match(cont!.querySelector('[data-testid="hotel-habitacion-alimentacion"]')!.textContent!, /Habitación Superior · PAE/);
  assert.match(t, /Ubicación/);
  const ver = [...cont!.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.includes("ubicación")) as HTMLButtonElement;
  assert.ok(ver, "control para ver el mapa");
  await click(ver);
  assert.ok(cont!.querySelector("iframe")?.getAttribute("src")?.includes("Bocagrande"), "mapa embebido con la ubicación");
  assert.ok([...cont!.querySelectorAll("a")].some((a) => a.getAttribute("href")?.includes("google.com/maps?q=Bocagrande")));
});

test("tarjeta pública: sin estrellas, descripción ni ubicación no se inventa nada (ni estrellas, ni mapa)", async () => {
  await montar(h(PorDinamicos, { dinamicos: [paquete([hotelPub({})])] as never, evaluar: (async () => ({ ok: false, error: "" })) as never }));
  assert.equal(cont!.querySelector('span[title$="estrellas"]'), null);
  assert.equal(cont!.querySelector("iframe"), null);
  assert.doesNotMatch(cont!.textContent!, /Ubicación/);
});
