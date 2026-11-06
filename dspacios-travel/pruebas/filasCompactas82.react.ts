// Se ejecuta por comando directo (también está en `npm run test:react`):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/filasCompactas82.react.ts
// #82 — (1) Adults Only en el editor del hotel y en el precio general del formulario; (2) vuelos y servicios como filas compactas con ventana de edición
// (Guardar aplica; Cancelar, Escape y la X descartan; manual vs vinculado; datos conservados); (3) unidades junto a los importes. Formulario REAL (jsdom).
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

const destinos = [{ id: 1, nombre: "MONTEGO BAY", pais: "Jamaica", codigo_iata: "MBJ" }];
const ficha = (id: number, nombre: string, adultsOnly: boolean) => ({ id, nombre, destino_id: 1, moneda: "COP", categorias: [], regimenes: [], reglasTexto: null, estrellas: 4, descripcionFicha: "", ubicacionFicha: "", adultsOnly });
const hoteles = [ficha(10, "Solo Adultos Uno", true), ficha(11, "Solo Adultos Dos", true), ficha(12, "Familiar Tres", false)];
const servicios = [
  { id: 50, nombre: "Tour por persona", destino_id: 1, moneda: "COP", proveedorId: 7, proveedor: "Operador SAS", cobro: "por persona", noSoportado: null, modo: "persona" as const, cobraInfante: true },
  { id: 51, nombre: "Traslado grupal", destino_id: 1, moneda: "COP", proveedorId: 7, proveedor: "Operador SAS", cobro: "1 grupo (hasta 6 pasajeros)", noSoportado: null, modo: "grupo" as const, cobraInfante: false },
  { id: 52, nombre: "Cena sin proveedor", destino_id: 1, moneda: "COP", proveedorId: null, proveedor: "", cobro: "por persona", noSoportado: null, modo: "persona" as const, cobraInfante: false },
];
const empaquetados = [
  { id: 1, aerolinea: "Avianca", ruta: "BOG - MBJ - BOG", fecha_ida: "2030-01-10", fecha_regreso: "2030-01-13", destino_id: 1, tarifa_proveedor: 100, fee_infante: 10 },
  { id: 2, aerolinea: "Copa", ruta: "PTY - MBJ", fecha_ida: "2030-02-10", fecha_regreso: null, destino_id: 1, tarifa_proveedor: 100, fee_infante: 10 },
];
const catalogoHotel = { categorias: ["Estándar"], regimenes: ["PC"] };
const base = { ...ENTRADA_VACIA, nombre: "Jamaica 3N", destinoId: 1, usaVuelo: true, usaHotel: true, usaServicios: true };
const hotelEntrada = (o: Record<string, unknown> = {}) => ({ hotelId: null, nombre: "Hotel X", categoria: "Estándar", regimen: "PC", descripcion: "", fotoUrl: "", proveedor: "P", estrellas: null, ubicacion: "", neto: {}, pvp: {}, pvpGeneral: null, capacidadNinos: 2, edadInfanteMax: 2, edadNinoMax: 10, ...o });

const montar = async (ini: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => {
  cont = document.createElement("div"); document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(h(PaqueteTotalForm, { inicial: { ...base, ...ini }, destinos, hoteles, servicios, empaquetados, catalogoHotel, ...props } as never)); });
};
const click = async (el: Element | null | undefined) => { assert.ok(el, "elemento a presionar"); await act(async () => { el!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })); }); };
const boton = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(t));
const pestana = (t: string) => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === t);
const escribir = async (el: Element, valor: string) => {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  await act(async () => { el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
};
const aria = (a: string) => document.querySelector(`input[aria-label="${a}"]`) as HTMLInputElement | null;
const ventana = (t: string) => document.querySelector(`[data-testid="${t}"]`);
const esc = async () => { await act(async () => { document.activeElement?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); };
const cerrarX = () => document.querySelector('[data-slot="dialog-close"]') as HTMLElement | null;
const guardar = async () => { await click(boton("Guardar paquete")); await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
const sinMenores = ["Neto Niño 1", "Neto Niño 2", "Neto Infante", "PVP Niño 1", "PVP Niño 2", "PVP Infante"];

// ───────────────────────── 1. ADULTS ONLY ─────────────────────────
test("ADULTS ONLY (netas): la ventana del hotel no pide ni muestra niño, niño 2 ni infante; sí sencilla a múltiple; aviso y marca en la fila", async () => {
  await montar({ usaVuelo: false, usaServicios: false, hoteles: [hotelEntrada({ hotelId: 10, nombre: "Solo Adultos Uno", adultsOnly: true })] });
  await click(pestana("Hotel"));
  const fila = document.querySelector('[data-testid="fila-hotel"]')!;
  assert.ok(fila.querySelector('[data-testid="badge-solo-adultos"]'), "marca visible en la fila");
  assert.match(fila.querySelector('[data-testid="resumen-hotel"]')!.textContent!, /0 de 4 precios/, "solo cuenta los importes que sí aplican");
  await click(boton("Tarifas y configuración"));
  for (const a of ["Neto Sencilla", "Neto Doble", "Neto Triple", "Neto Múltiple"]) assert.ok(aria(a), a);
  for (const a of sinMenores) assert.equal(aria(a), null, `${a} no debe pedirse`);
  assert.match(ventana("solo-adultos")!.textContent!, /solo para adultos/);
  assert.doesNotMatch(document.querySelector('[data-testid="ventana-hotel"]')!.textContent!, /Niño 1|Niño 2|Infante \d|Infante —/, "tampoco en la vista previa del PVP");
});

test("ADULTS ONLY (solo PVP por componente): tampoco se piden PVP de menores", async () => {
  await montar({ usaVuelo: false, usaServicios: false, esquema: "solo_pvp", pvpModo: "por_componente", hoteles: [hotelEntrada({ hotelId: 10, nombre: "Solo Adultos Uno", adultsOnly: true })] });
  await click(pestana("Hotel")); await click(boton("Tarifas y configuración"));
  assert.ok(aria("PVP Doble"));
  for (const a of sinMenores) assert.equal(aria(a), null, a);
});

test("HOTEL QUE ADMITE MENORES: conserva los siete importes y no muestra el aviso", async () => {
  await montar({ usaVuelo: false, usaServicios: false, hoteles: [hotelEntrada({ hotelId: 12, nombre: "Familiar Tres" })] });
  await click(pestana("Hotel"));
  assert.equal(document.querySelector('[data-testid="badge-solo-adultos"]'), null);
  assert.match(document.querySelector('[data-testid="resumen-hotel"]')!.textContent!, /0 de 7 precios/);
  await click(boton("Tarifas y configuración"));
  for (const a of ["Neto Doble", "Neto Niño 1", "Neto Niño 2", "Neto Infante"]) assert.ok(aria(a), a);
  assert.equal(ventana("solo-adultos"), null);
});

test("ADULTS ONLY: los importes de menores que ya existían NO se borran al guardar (histórico), aunque no se muestren", async () => {
  await montar({ usaVuelo: false, usaServicios: false, hoteles: [hotelEntrada({ hotelId: 10, nombre: "Solo Adultos Uno", adultsOnly: true, neto: { sencilla: 1, doble: 2, triple: 3, multiple: 4, nino: 99, nino2: 98, infante: 97 } })] });
  await click(pestana("Hotel")); await click(boton("Tarifas y configuración"));
  await escribir(aria("Neto Doble")!, "250000");
  await click(boton("Guardar cambios"));
  await guardar();
  const hotel = llamadas[0].hoteles[0];
  assert.equal(hotel.neto.doble, 250000);
  assert.deepEqual([hotel.neto.nino, hotel.neto.nino2, hotel.neto.infante], [99, 98, 97], "histórico conservado");
});

test("PVP GENERAL: con hoteles y TODOS solo adultos se ocultan los campos de menores; con alguno que admita menores se conservan; sin hoteles también", async () => {
  const general = { esquema: "solo_pvp", pvpModo: "general", usaVuelo: false, usaServicios: false };
  const camposGenerales = () => [...document.querySelectorAll('input[aria-label^="PVP "]')].map((i) => i.getAttribute("aria-label"));
  // todos solo adultos
  await montar({ ...general, hoteles: [hotelEntrada({ hotelId: 10, adultsOnly: true }), hotelEntrada({ hotelId: 11, adultsOnly: true })] });
  assert.deepEqual(camposGenerales(), ["PVP Sencilla", "PVP Doble", "PVP Triple", "PVP Múltiple"]);
  assert.ok(document.querySelector('[data-testid="general-solo-adultos"]'));
  await act(async () => { root!.unmount(); }); cont!.remove();
  // mixto
  await montar({ ...general, hoteles: [hotelEntrada({ hotelId: 10, adultsOnly: true }), hotelEntrada({ hotelId: 12 })] });
  assert.equal(camposGenerales().length, 7, "con un hotel que admite menores se conservan los siete");
  assert.equal(document.querySelector('[data-testid="general-solo-adultos"]'), null);
  await act(async () => { root!.unmount(); }); cont!.remove();
  // sin hoteles (aunque el componente hotel esté activo) y con hotel manual
  await montar({ ...general, usaHotel: true, hoteles: [] });
  assert.equal(camposGenerales().length, 7, "un paquete sin hoteles no aplica la condición");
  await act(async () => { root!.unmount(); }); cont!.remove();
  await montar({ ...general, hoteles: [hotelEntrada({ hotelId: null, adultsOnly: true })] });
  assert.equal(camposGenerales().length, 7, "un hotel manual nunca es solo adultos");
});

test("ADULTS ONLY: al vincular una ficha el formulario trae su condición (la configuración de la ficha se conserva)", async () => {
  await montar({ usaVuelo: false, usaServicios: false, hoteles: [] });
  await click(pestana("Hotel"));
  const input = document.querySelector('[data-testid="selector-fichas"] input') as HTMLInputElement;
  await act(async () => { input.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })); });
  await escribir(input, "Solo Adultos Dos");
  await act(async () => { document.querySelector('[role="option"]')!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
  assert.ok(document.querySelector('[data-testid="badge-solo-adultos"]'));
  await click(boton("Tarifas y configuración"));
  assert.equal(aria("Neto Infante"), null);
});

// ───────────────────────── 2. FILAS COMPACTAS: VUELOS ─────────────────────────
test("VUELOS: filas compactas con resumen que identifica cada vuelo; la edición está en la ventana", async () => {
  await montar({ usaHotel: false, usaServicios: false });
  await click(pestana("Vuelo"));
  await click(boton("Vuelo manual"));
  const sel = [...document.querySelectorAll("select")].find((s) => s.options[0]?.textContent?.startsWith("Vincular vuelo"))!;
  await escribir(sel, "1");
  const filas = [...document.querySelectorAll('[data-testid="fila-vuelo"]')];
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((f) => f.querySelector('[data-testid="tipo-vuelo"]')!.textContent), ["Manual", "Vinculado #1"]);
  assert.match(filas[1].querySelector('[data-testid="vuelo-titulo"]')!.textContent!, /Avianca/);
  assert.match(filas[1].querySelector('[data-testid="resumen-vuelo"]')!.textContent!, /BOG - MBJ - BOG · 10\/01\/2030 → 13\/01\/2030/);
  assert.equal(filas[1].querySelectorAll("input, select, textarea").length, 0, "la fila no tiene campos: están en la ventana");
  assert.equal(ventana("ventana-vuelo"), null);
});

test("VUELOS: clic abre la ventana editable; Guardar aplica; Cancelar, Escape y la X descartan; los datos se conservan", async () => {
  await montar({ usaHotel: false, usaServicios: false });
  await click(pestana("Vuelo")); await click(boton("Vuelo manual"));
  const abrir = () => click(document.querySelector('button[aria-label^="Editar vuelo"]'));
  await abrir();
  assert.ok(ventana("ventana-vuelo"));
  const dlg = document.querySelector('[role="dialog"]')!;
  assert.ok(dlg.getAttribute("aria-labelledby") || dlg.getAttribute("aria-label") || dlg.querySelector('[data-slot="dialog-title"]'), "ventana con título accesible");
  await escribir(aria("Aerolínea")!, "LATAM"); await escribir(aria("Proveedor del vuelo")!, "Prov Aéreo");
  await click(boton("Cancelar"));
  assert.equal(ventana("ventana-vuelo"), null, "Cancelar cierra");
  assert.match(document.querySelector('[data-testid="vuelo-titulo"]')!.textContent!, /Vuelo sin aerolínea/, "Cancelar descartó lo escrito");
  await abrir();
  assert.equal(aria("Aerolínea")!.value, "", "la ventana vuelve a abrir con los datos aplicados (nada se coló)");
  await escribir(aria("Aerolínea")!, "LATAM"); await esc();
  assert.equal(ventana("ventana-vuelo"), null, "Escape cierra");
  assert.match(document.querySelector('[data-testid="vuelo-titulo"]')!.textContent!, /Vuelo sin aerolínea/, "Escape descartó");
  await abrir();
  await escribir(aria("Aerolínea")!, "LATAM"); await click(cerrarX());
  assert.equal(ventana("ventana-vuelo"), null, "la X cierra");
  assert.match(document.querySelector('[data-testid="vuelo-titulo"]')!.textContent!, /Vuelo sin aerolínea/, "la X descartó");
  await abrir();
  await escribir(aria("Aerolínea")!, "LATAM"); await escribir(aria("Proveedor del vuelo")!, "Prov Aéreo");
  await click(boton("Guardar cambios"));
  assert.match(document.querySelector('[data-testid="vuelo-titulo"]')!.textContent!, /LATAM/);
  assert.match(document.querySelector('[data-testid="resumen-vuelo"]')!.textContent!, /Prov Aéreo/);
  await abrir();
  assert.equal(aria("Aerolínea")!.value, "LATAM", "se conserva al reabrir");
  await click(boton("Cancelar"));
  await guardar();
  assert.equal(llamadas[0].vuelos[0].aerolinea, "LATAM"); assert.equal(llamadas[0].vuelos[0].proveedor, "Prov Aéreo");
});

test("VUELOS: quitar elimina la fila; la distinción manual/vinculado se mantiene dentro de la ventana", async () => {
  await montar({ usaHotel: false, usaServicios: false });
  await click(pestana("Vuelo")); await click(boton("Vuelo manual"));
  const sel = [...document.querySelectorAll("select")].find((s) => s.options[0]?.textContent?.startsWith("Vincular vuelo"))!;
  await escribir(sel, "1");
  const editar = [...document.querySelectorAll('button[aria-label^="Editar vuelo"]')];
  await click(editar[1]);
  assert.match(document.querySelector('[data-testid="ventana-vuelo"]')!.textContent!, /Vuelo vinculado a Empaquetados #1/);
  assert.equal(aria("Origen IATA"), null, "el vinculado no pide origen: su ruta es la del empaquetado");
  await click(boton("Cancelar"));
  await click(editar[0]);
  assert.match(document.querySelector('[data-testid="ventana-vuelo"]')!.textContent!, /Vuelo manual/);
  assert.ok(aria("Origen IATA"));
  await click(boton("Cancelar"));
  await click(document.querySelector('button[aria-label="Quitar vuelo"]'));
  assert.equal(document.querySelectorAll('[data-testid="fila-vuelo"]').length, 1);
  assert.equal(document.querySelector('[data-testid="tipo-vuelo"]')!.textContent, "Vinculado #1");
});

// ───────────────────────── 3. UNIDADES ─────────────────────────
test("UNIDADES — vuelo: «importe completo por pasajero» y «solo ida» o «ida y regreso» según el vuelo (manual y vinculado)", async () => {
  await montar({ usaHotel: false, usaServicios: false });
  await click(pestana("Vuelo")); await click(boton("Vuelo manual"));
  await click(document.querySelector('button[aria-label^="Editar vuelo"]'));
  assert.match(document.querySelector('[data-testid="unidad-vuelo"]')!.textContent!, /Importe completo por pasajero \(ida\)\./, "manual sin regreso");
  assert.match(document.querySelector('[data-testid="precios-vuelo"]')!.textContent!, /Por pasajero, ida\./);
  await escribir(document.querySelector('input[aria-label="Regreso"]') as HTMLInputElement, "2030-01-13");
  assert.match(document.querySelector('[data-testid="unidad-vuelo"]')!.textContent!, /Importe completo por pasajero \(ida y regreso\)\./, "manual con regreso");
  await click(boton("Cancelar"));
  // vinculados: uno con regreso y uno solo ida (por su ruta real)
  const sel = () => [...document.querySelectorAll("select")].find((s) => s.options[0]?.textContent?.startsWith("Vincular vuelo"))!;
  await escribir(sel(), "1"); await escribir(sel(), "2");
  const editar = [...document.querySelectorAll('button[aria-label^="Editar vuelo"]')];
  await click(editar[1]); assert.match(document.querySelector('[data-testid="unidad-vuelo"]')!.textContent!, /\(ida y regreso\)/); await click(boton("Cancelar"));
  await click(editar[2]); assert.match(document.querySelector('[data-testid="unidad-vuelo"]')!.textContent!, /\(ida\)\./); assert.doesNotMatch(document.querySelector('[data-testid="unidad-vuelo"]')!.textContent!, /regreso/);
});

test("UNIDADES — hotel: por persona según la acomodación, por el total de la estadía de N noches (no por noche)", async () => {
  await montar({ usaVuelo: false, usaServicios: false, noches: 4, hoteles: [hotelEntrada()] });
  await click(pestana("Hotel")); await click(boton("Tarifas y configuración"));
  const t = document.querySelector('[data-testid="unidad-hotel"]')!.textContent!;
  assert.match(t, /por persona según la acomodación/); assert.match(t, /total de la estadía de 4 noches/); assert.match(t, /no por noche/);
});

// ───────────────────────── 2b. FILAS COMPACTAS: SERVICIOS ─────────────────────────
test("SERVICIOS: filas compactas con proveedor, unidad real de cobro e importe; manual y de ficha se distinguen; el aviso de proveedor queda en la fila", async () => {
  await montar({ usaHotel: false, usaVuelo: false });
  await click(pestana("Servicios"));
  const sel = () => [...document.querySelectorAll("select")].find((s) => s.options[0]?.textContent?.startsWith("Vincular servicio"))!;
  await escribir(sel(), "50"); await escribir(sel(), "51"); await escribir(sel(), "52");
  await click(boton("Servicio manual"));
  const filas = [...document.querySelectorAll('[data-testid="ficha-servicio"]')];
  assert.equal(filas.length, 4);
  assert.deepEqual(filas.map((f) => f.querySelector('[data-testid="tipo-servicio"]')!.textContent), ["Ficha #50", "Ficha #51", "Ficha #52", "Manual"]);
  const r = filas.map((f) => f.querySelector('[data-testid="resumen-servicio"]')!.textContent!);
  assert.match(r[0], /Proveedor: Operador SAS · Cobro por persona/);
  assert.match(r[1], /Cobro por grupo \(una sola vez\)/, "unidad real de la ficha por grupo (el rango completo está en la ventana)");
  assert.match(r[3], /Cobro por persona \(el infante no paga\)/, "manual: por persona");
  assert.match(r[0], /se calcula con la ficha al cotizar/);
  assert.ok(filas[2].querySelector('[data-testid="servicio-sin-proveedor"]'), "ficha sin proveedor: aviso visible sin abrir la ventana");
  assert.equal(filas[0].querySelectorAll("input, select").length, 0);
});

test("SERVICIOS: ventana editable; Guardar aplica; Cancelar/Escape/X descartan; quitar elimina; la unidad se ve junto al importe", async () => {
  await montar({ usaHotel: false, usaVuelo: false });
  await click(pestana("Servicios")); await click(boton("Servicio manual"));
  const abrir = () => click(document.querySelector('button[aria-label^="Editar servicio"]'));
  await abrir();
  assert.ok(ventana("ventana-servicio"));
  assert.match(ventana("unidad-servicio")!.textContent!, /Unidad de cobro: por persona \(adultos y niños; el infante no paga\)\./);
  await escribir(aria("Nombre del servicio")!, "Tour Islas"); await escribir(aria("Neto del servicio")!, "120000");
  await click(boton("Cancelar"));
  assert.match(document.querySelector('[data-testid="servicio-titulo"]')!.textContent!, /Servicio sin nombre/, "Cancelar descartó");
  await abrir(); await escribir(aria("Nombre del servicio")!, "Tour Islas"); await esc();
  assert.match(document.querySelector('[data-testid="servicio-titulo"]')!.textContent!, /Servicio sin nombre/, "Escape descartó");
  await abrir(); await escribir(aria("Nombre del servicio")!, "Tour Islas"); await click(cerrarX());
  assert.match(document.querySelector('[data-testid="servicio-titulo"]')!.textContent!, /Servicio sin nombre/, "la X descartó");
  await abrir(); await escribir(aria("Nombre del servicio")!, "Tour Islas"); await escribir(aria("Proveedor del servicio")!, "Operador"); await escribir(aria("Neto del servicio")!, "120000");
  await click(boton("Guardar cambios"));
  assert.match(document.querySelector('[data-testid="servicio-titulo"]')!.textContent!, /Tour Islas/);
  assert.match(document.querySelector('[data-testid="resumen-servicio"]')!.textContent!, /Proveedor: Operador · Cobro por persona.*Neto 120000/);
  await abrir(); assert.equal(aria("Nombre del servicio")!.value, "Tour Islas", "se conserva al reabrir"); await click(boton("Cancelar"));
  await guardar();
  assert.equal(llamadas[0].servicios[0].nombre, "Tour Islas"); assert.equal(llamadas[0].servicios[0].neto, 120000);
  await click(document.querySelector('button[aria-label="Quitar servicio"]'));
  assert.equal(document.querySelectorAll('[data-testid="ficha-servicio"]').length, 0);
});

test("SERVICIOS: un servicio de ficha por grupo muestra su unidad en la ventana y el infante solo aplica a los de persona", async () => {
  await montar({ usaHotel: false, usaVuelo: false, esquema: "solo_pvp", pvpModo: "por_componente" });
  await click(pestana("Servicios"));
  const sel = () => [...document.querySelectorAll("select")].find((s) => s.options[0]?.textContent?.startsWith("Vincular servicio"))!;
  await escribir(sel(), "51"); await escribir(sel(), "50");
  const editar = [...document.querySelectorAll('button[aria-label^="Editar servicio"]')];
  await click(editar[0]);
  assert.match(ventana("unidad-servicio")!.textContent!, /1 grupo \(hasta 6 pasajeros\)/);
  assert.equal(aria("PVP infante"), null, "un servicio por grupo no cobra infante");
  await click(boton("Cancelar"));
  await click(editar[1]);
  assert.match(ventana("unidad-servicio")!.textContent!, /por persona/);
  assert.ok(aria("PVP infante"));
});

test("MÓVIL: la ventana usa el ancho disponible (sin ancho fijo) y las filas parten el texto largo", async () => {
  await montar({ usaHotel: false, usaServicios: false });
  await click(pestana("Vuelo")); await click(boton("Vuelo manual"));
  const fila = document.querySelector('[data-testid="fila-vuelo"]')!;
  assert.match(fila.querySelector('[data-testid="resumen-vuelo"]')!.className, /\[overflow-wrap:anywhere\]/);
  await click(fila.querySelector('button[aria-label^="Editar vuelo"]'));
  assert.match(document.querySelector('[data-testid="ventana-vuelo"]')!.className, /w-\[calc\(100%-1rem\)\]/);
  assert.match(document.querySelector('[data-testid="ventana-vuelo"]')!.className, /max-h-\[90dvh\]/);
});
