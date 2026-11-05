// Se ejecuta por comando directo (también está en `npm run test:react`):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/selectoresDin82.react.ts
// #82 — selectores del montaje (formulario REAL con la acción de guardado sustituida por un registrador): fichas de hotel con búsqueda por nombre (Montego Bay, 40 fichas,
// con y sin tarifario/otra moneda), códigos IATA del vuelo manual y destino del vuelo según Multidestino.
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
const { act, createElement: h } = React;
const { PaqueteTotalForm, ENTRADA_VACIA } = await import("../app/(dashboard)/dashboard/paquetes/total/PaqueteTotalForm.tsx");
const { llamadas } = await import("./support/stubs/paqueteTotalActionsStub.mjs");

let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); cont?.remove(); root = null; cont = null; llamadas.length = 0; });
after(() => dom.window.close());

const destinos = [{ id: 1, nombre: "MONTEGO BAY", pais: "Jamaica" }, { id: 2, nombre: "NEGRIL", pais: "Jamaica" }, { id: 3, nombre: "KINGSTON", pais: "Jamaica" }, { id: 4, nombre: "CARTAGENA", pais: "Colombia" }];
// 40 fichas en Montego Bay: la primera sin tarifario (COP), el resto «con tarifario», varias en USD; 3 fichas de otros destinos.
const nombres = ["BEACHES RESORT", ...Array.from({ length: 39 }, (_, i) => `Hotel Montego ${String(i + 1).padStart(2, "0")}`)];
const ficha = (id: number, nombre: string, destino_id: number, moneda: string) => ({ id, nombre, destino_id, moneda, categorias: [], regimenes: [], reglasTexto: null, estrellas: 4, descripcionFicha: "Descripción", ubicacionFicha: "Ubicación" });
const hoteles = [
  ...nombres.map((n, i) => ficha(100 + i, n, 1, i % 3 === 0 ? "COP" : "USD")),
  ficha(200, "Hotel Negril Sol", 2, "USD"), ficha(201, "Hotel Kingston Plaza", 3, "COP"), ficha(202, "Hotel Cartagena Mar", 4, "COP"),
];
const empaquetados = [
  { id: 1, aerolinea: "Avianca", ruta: "BOG - MBJ - BOG", fecha_ida: "2030-01-10", fecha_regreso: "2030-01-13", destino_id: 1, tarifa_proveedor: 100, fee_infante: 10 },
  { id: 2, aerolinea: "Copa", ruta: "PTY - KIN - PTY", fecha_ida: "2030-02-10", fecha_regreso: "2030-02-13", destino_id: 3, tarifa_proveedor: 100, fee_infante: 10 },
];
const catalogoHotel = { categorias: ["Estándar"], regimenes: ["PC"] };
const inicial = { ...ENTRADA_VACIA, nombre: "Jamaica 3N", destinoId: 1, usaVuelo: true, usaHotel: true };

const montar = async (props: Record<string, unknown> = {}, ini = inicial) => {
  cont = document.createElement("div"); document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(h(PaqueteTotalForm, { inicial: ini, destinos, hoteles, servicios: [], empaquetados, catalogoHotel, ...props } as never)); });
};
const click = async (el: Element | null | undefined) => { assert.ok(el, "elemento a presionar"); await act(async () => { el!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })); }); };
const boton = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t));
const pestana = (t: string) => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === t);
const escribir = async (el: Element, valor: string) => {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  await act(async () => { el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
};
const tecla = async (el: Element, key: string) => { await act(async () => { el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); }); };
const combo = (aria: string) => document.querySelector(`input[aria-label="${aria}"]`) as HTMLInputElement;
const opciones = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent!);
const selectorFichas = () => document.querySelector('[data-testid="selector-fichas"] input') as HTMLInputElement;
// ComboHotel (compartido) abre la lista al recibir el foco.
const abrirFichas = async () => { await act(async () => { selectorFichas().dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })); }); };
const checkMulti = () => [...document.querySelectorAll("label")].find((l) => l.textContent?.includes("Multidestino"))!.querySelector("input") as HTMLInputElement;
const vueloManual = async () => { await click(pestana("Vuelo")); await click(boton("Vuelo manual")); };
const guardar = async () => { await click(boton("Guardar paquete")); await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

test("HOTEL: «Hotel manual» sigue aparte y el selector busca fichas por nombre (ya no hay «Usar ficha de hotel existente»)", async () => {
  await montar();
  await click(pestana("Hotel"));
  assert.ok(boton("Hotel manual"), "Hotel manual separado");
  assert.doesNotMatch(cont!.textContent!, /Usar ficha de hotel existente/);
  assert.match(selectorFichas().placeholder, /Buscar ficha de hotel por nombre/);
  assert.equal(document.querySelector('select[aria-label]') == null, true);
});

test("HOTEL — Montego Bay: ofrece las 40 fichas activas del destino, con y sin tarifario o en otra moneda, y ninguna de otro destino", async () => {
  await montar();
  await click(pestana("Hotel"));
  assert.match(document.querySelector('[data-testid="conteo-fichas"]')!.textContent!, /^40 fichas activas en MONTEGO BAY\./);
  await abrirFichas();
  const todas = opciones();
  assert.equal(todas.length, 40, "las 40, no solo BEACHES RESORT");
  assert.ok(todas.includes("BEACHES RESORT") && todas.includes("Hotel Montego 39"));
  assert.ok(!todas.some((o) => /Negril|Kingston|Cartagena/.test(o)), "solo el destino principal");
  assert.equal(document.querySelector('[data-testid="aviso-fichas-faltantes"]'), null, "sin aviso si la base ofrece todas");
});

test("HOTEL: la búsqueda filtra por nombre (sin tildes ni mayúsculas) y elegir agrega la ficha con su información general, sin tarifas", async () => {
  await montar();
  await click(pestana("Hotel"));
  await abrirFichas();
  await escribir(selectorFichas(), "montego 07");
  assert.deepEqual(opciones(), ["Hotel Montego 07"]);
  await escribir(selectorFichas(), "BEACH");
  assert.deepEqual(opciones(), ["BEACHES RESORT"]);
  await tecla(selectorFichas(), "ArrowDown"); await tecla(selectorFichas(), "Enter");
  const fila = document.querySelector('[data-testid="fila-hotel"]')!;
  assert.match(fila.textContent!, /BEACHES RESORT/); assert.match(fila.textContent!, /Ficha #100/);
  assert.match(fila.querySelector('[data-testid="resumen-hotel"]')!.textContent!, /0 de 7 precios/, "las tarifas se cargan en el paquete");
  assert.equal(selectorFichas().value, "", "el buscador queda listo para otra ficha");
  await escribir(selectorFichas(), "zzzz");
  assert.equal(opciones().length, 0);
});

test("HOTEL: sin destino principal no se ofrece ninguna ficha", async () => {
  await montar({ fichasActivas: 43 }, { ...inicial, destinoId: null as unknown as number });
  await click(pestana("Hotel"));
  assert.match(selectorFichas().placeholder, /Elige primero el destino principal/);
  assert.match(document.querySelector('[data-testid="conteo-fichas"]')!.textContent!, /Elige el destino principal/);
  assert.equal(document.querySelector('[data-testid="aviso-fichas-faltantes"]'), null, "la base ofrece las 43: sin aviso");
});

test("HOTEL: base con la función vieja (solo fichas sin tarifario) → aviso con las cifras reales", async () => {
  await montar({ hoteles: hoteles.filter((x) => x.id === 100), fichasActivas: 43 });
  await click(pestana("Hotel"));
  await abrirFichas();
  assert.deepEqual(opciones(), ["BEACHES RESORT"]);
  assert.match(document.querySelector('[data-testid="aviso-fichas-faltantes"]')!.textContent!, /solo ofrece 1 de 43 fichas activas: falta aplicar la migración 280/);
});

test("VUELO manual: Origen y Destino son selectores con búsqueda por ciudad o código; la ruta se calcula y sale en el guardado", async () => {
  await montar();
  await vueloManual();
  assert.equal(combo("Origen IATA").getAttribute("role"), "combobox"); assert.equal(combo("Destino IATA").getAttribute("role"), "combobox");
  await click(combo("Origen IATA"));
  assert.ok(opciones().includes("Bogotá (BOG)") && opciones().length > 20, "catálogo completo al abrir");
  await escribir(combo("Origen IATA"), "bogo");
  assert.deepEqual(opciones(), ["Bogotá (BOG)"]);
  await tecla(combo("Origen IATA"), "ArrowDown"); await tecla(combo("Origen IATA"), "Enter");
  assert.equal(combo("Origen IATA").value, "Bogotá (BOG)");
  await click(combo("Destino IATA"));
  await escribir(combo("Destino IATA"), "montego");
  assert.deepEqual(opciones(), ["Montego Bay (MBJ)"]);
  await tecla(combo("Destino IATA"), "ArrowDown"); await tecla(combo("Destino IATA"), "Enter");
  assert.equal((document.querySelector('input[aria-label="Ruta"]') as HTMLInputElement).value, "BOG - MBJ");
  await guardar();
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].vuelos[0].origenIata, "BOG"); assert.equal(llamadas[0].vuelos[0].destinoIata, "MBJ");
});

test("VUELO manual: se puede ESCRIBIR un código válido que no está en el catálogo; uno inválido se señala y no se guarda como código", async () => {
  await montar();
  await vueloManual();
  await click(combo("Origen IATA"));
  await escribir(combo("Origen IATA"), "xyz");
  assert.ok(opciones().some((o) => o === "Usar el código «XYZ»"), "ofrece usar el código escrito");
  await tecla(combo("Origen IATA"), "Enter");
  assert.equal(combo("Origen IATA").value, "XYZ");
  await click(combo("Destino IATA"));
  await escribir(combo("Destino IATA"), "ab");
  await tecla(combo("Destino IATA"), "Escape");
  assert.equal(combo("Destino IATA").getAttribute("aria-invalid"), "true");
  assert.match(cont!.textContent!, /Elige una ciudad de la lista o escribe un código IATA de 3 letras/);
  assert.equal((document.querySelector('input[aria-label="Ruta"]') as HTMLInputElement).value, "");
  await guardar();
  assert.equal(llamadas[0].vuelos[0].destinoIata, "", "un texto inválido no viaja como código");
});

test("VUELO manual: Escape cierra solo la lista; clic/toque en una fila elige; el texto escrito de una ciudad exacta se resuelve al salir", async () => {
  await montar();
  await vueloManual();
  await click(combo("Origen IATA"));
  assert.ok(opciones().length > 0);
  await tecla(combo("Origen IATA"), "Escape");
  assert.equal(opciones().length, 0);
  await click(combo("Origen IATA"));
  const fila = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === "Medellín (MDE)")!;
  assert.match(fila.className, /min-h-11/);
  await act(async () => { fila.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
  assert.equal(combo("Origen IATA").value, "Medellín (MDE)");
  await click(combo("Destino IATA")); await escribir(combo("Destino IATA"), "Cartagena");
  await act(async () => { combo("Destino IATA").dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true, relatedTarget: null })); });
  assert.equal(combo("Destino IATA").value, "Cartagena (CTG)");
});

test("DESTINO DEL VUELO: con Multidestino desactivado el campo no existe y el vuelo viaja con el destino principal", async () => {
  await montar();
  await vueloManual();
  assert.equal(document.querySelector('select[aria-label="Destino del vuelo"]'), null);
  assert.doesNotMatch(cont!.textContent!, /Destino del vuelo/);
  await click(combo("Origen IATA")); await escribir(combo("Origen IATA"), "bog"); await tecla(combo("Origen IATA"), "Enter");
  await click(combo("Destino IATA")); await escribir(combo("Destino IATA"), "mbj"); await tecla(combo("Destino IATA"), "Enter");
  await guardar();
  assert.equal(llamadas[0].vuelos[0].destinoId, 1);
  assert.equal(llamadas[0].multidestino, false);
});

test("DESTINO DEL VUELO: vincular un vuelo de Empaquetados asigna el destino principal automáticamente", async () => {
  await montar();
  await click(pestana("Vuelo"));
  const sel = [...document.querySelectorAll("select")].find((s) => s.options[0]?.textContent?.startsWith("Vincular vuelo"))!;
  const opts = [...sel.options].map((o) => o.textContent);
  assert.ok(opts.some((o) => o?.includes("Avianca")) && !opts.some((o) => o?.includes("Copa")), "con Multidestino apagado solo los del principal");
  await escribir(sel, "1");
  assert.equal(document.querySelectorAll('input[aria-label="Ruta"]').length, 1);
  await guardar();
  assert.equal(llamadas[0].vuelos[0].destinoId, 1);
});

test("DESTINO DEL VUELO: con Multidestino activo ofrece solo el principal y los adicionales elegidos (sin opción vacía)", async () => {
  await montar({}, { ...inicial, multidestino: true, destinosExtra: [2] });
  await vueloManual();
  const sel = document.querySelector('select[aria-label="Destino del vuelo"]') as HTMLSelectElement;
  assert.deepEqual([...sel.options].map((o) => o.textContent), ["MONTEGO BAY (principal)", "NEGRIL"]);
  assert.equal(sel.value, "1", "el principal queda elegido de forma explícita");
  await escribir(sel, "2");
  assert.equal(sel.value, "2");
  await click(combo("Origen IATA")); await escribir(combo("Origen IATA"), "bog"); await tecla(combo("Origen IATA"), "Enter");
  await click(combo("Destino IATA")); await escribir(combo("Destino IATA"), "mbj"); await tecla(combo("Destino IATA"), "Enter");
  await guardar();
  assert.equal(llamadas[0].vuelos[0].destinoId, 2);
});

test("MULTIDESTINO: no se desactiva si hay vuelos o servicios de destinos adicionales (no se reasignan); con el vuelo devuelto al principal, sí", async () => {
  await montar({}, { ...inicial, multidestino: true, destinosExtra: [2] });
  await vueloManual();
  await escribir(document.querySelector('select[aria-label="Destino del vuelo"]')!, "2");
  await click(pestana("Configuración"));
  await click(checkMulti());
  assert.equal(checkMulti().checked, true, "sigue activo");
  assert.match(document.querySelector('[data-testid="aviso-multidestino"]')!.textContent!, /No se puede desactivar Multidestino: 1 vuelo o servicio usa un destino adicional \(1 vuelo, 0 servicios\)/);
  await click(pestana("Vuelo"));
  await escribir(document.querySelector('select[aria-label="Destino del vuelo"]')!, "1");
  await click(pestana("Configuración"));
  await click(checkMulti());
  assert.equal(checkMulti().checked, false);
  assert.equal(document.querySelector('[data-testid="aviso-multidestino"]'), null);
  await click(pestana("Vuelo"));
  assert.equal(document.querySelector('select[aria-label="Destino del vuelo"]'), null, "ya no hay campo");
});

test("DESTINO PRINCIPAL: los vuelos manuales que lo seguían lo siguen al cambiarlo; uno de otro destino se señala y no se toca", async () => {
  await montar({}, { ...inicial, multidestino: true, destinosExtra: [2] });
  await vueloManual();
  await click(boton("Vuelo manual"));
  const selects = () => [...document.querySelectorAll('select[aria-label="Destino del vuelo"]')] as HTMLSelectElement[];
  await escribir(selects()[1], "2");
  await click(pestana("Configuración"));
  const principal = [...document.querySelectorAll("select")].find((s) => s.options[0]?.textContent === "Elige…")!;
  await escribir(principal, "3");
  await click(pestana("Vuelo"));
  assert.equal(document.querySelectorAll('[data-testid="vuelo-destino-incompatible"]').length, 1, "el vuelo dirigido a Negril ya no pertenece al paquete y se señala");
  assert.match(document.querySelector('[data-testid="vuelo-destino-incompatible"]')!.textContent!, /NEGRIL/);
  assert.match(document.querySelector('[data-testid="vuelo-destino-incompatible"]')!.textContent!, /no se reasigna solo/);
  await click(pestana("Configuración"));
  await guardar();
  assert.equal(llamadas[0].vuelos[0].destinoId, 3, "el que seguía al principal pasó a KINGSTON");
  assert.equal(llamadas[0].vuelos[1].destinoId, 2, "el dirigido a otro destino NO se cambió en silencio");
});

test("HOTEL: nombre inexistente → «Hotel manual» conserva exactamente lo escrito y NO vincula ninguna ficha", async () => {
  await montar();
  await click(pestana("Hotel"));
  await abrirFichas();
  const nombre = "Hotel Boutique Sin Ficha 2030";
  await escribir(selectorFichas(), nombre);
  assert.equal(opciones().length, 0, "no existe ninguna ficha con ese nombre");
  assert.match(document.querySelector('[data-testid="pasar-a-manual"]')!.textContent!, /¿No está «Hotel Boutique Sin Ficha 2030»\?/);
  await click(boton("Hotel manual"));
  const filas = document.querySelectorAll('[data-testid="fila-hotel"]');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].querySelector('[data-testid="tipo-hotel"]')!.textContent, "Manual", "no es una ficha");
  assert.match(filas[0].textContent!, /Hotel Boutique Sin Ficha 2030/);
  assert.equal(document.querySelector('[data-testid="pasar-a-manual"]'), null, "el traspaso consume lo escrito");
  // El nombre llega tal cual al guardado: hotel manual (sin hotelId), sin ficha vinculada.
  await click(filas[0].querySelectorAll("button")[0]); // «Información del hotel»
  const campoNombre = document.querySelector('[data-testid="ventana-hotel"] input[id$="nombre"]') as HTMLInputElement;
  assert.equal(campoNombre.value, nombre);
  await click(boton("Cancelar"));
  await guardar();
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].hoteles.length, 1);
  assert.equal(llamadas[0].hoteles[0].nombre, nombre);
  assert.equal(llamadas[0].hoteles[0].hotelId, null);
});

test("HOTEL: «Hotel manual» sin escribir nada sigue creando una entrada vacía; elegir una ficha o Escape descartan lo escrito", async () => {
  await montar();
  await click(pestana("Hotel"));
  await click(boton("Hotel manual"));
  assert.equal(document.querySelectorAll('[data-testid="fila-hotel"]').length, 1);
  assert.match(document.querySelector('[data-testid="fila-hotel"]')!.textContent!, /Hotel sin nombre/);
  await abrirFichas(); await escribir(selectorFichas(), "algo que no existe"); await tecla(selectorFichas(), "Escape");
  assert.equal(document.querySelector('[data-testid="pasar-a-manual"]'), null, "Escape cancela la búsqueda");
  await abrirFichas(); await escribir(selectorFichas(), "beach"); await tecla(selectorFichas(), "ArrowDown"); await tecla(selectorFichas(), "Enter");
  assert.equal(document.querySelector('[data-testid="pasar-a-manual"]'), null, "elegir una ficha consume lo escrito");
  await click(boton("Hotel manual"));
  const filas = [...document.querySelectorAll('[data-testid="fila-hotel"]')];
  assert.deepEqual(filas.map((f) => f.querySelector('[data-testid="tipo-hotel"]')!.textContent), ["Manual", "Ficha #100", "Manual"]);
  assert.match(filas[2].textContent!, /Hotel sin nombre/, "el manual posterior no hereda «beach»");
});
