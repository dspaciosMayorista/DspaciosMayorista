// Registrada en `npm run test:react`. Comando equivalente para correrla sola:
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs
//     --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/programaDestinoFijo.interaccion.react.ts
// #23 / migración 213 — INTERACCIÓN (jsdom): aviso de programas sin destino, administración
// de la lista fija y filtro público por destino fijo.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
  // React construye FormData(form) al enviar un <form>: debe ser el de jsdom.
  FormData: dom.window.FormData,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ProgramasLista } = await import("../app/(dashboard)/dashboard/producto/programas/ProgramasLista.tsx");
const { ListaDestinoProgramas } = await import("../app/(dashboard)/dashboard/producto/destinos/listas-fijas/ListaDestinoProgramas.tsx");
const { __setImpls, __reset, __llamadas } = await import("./support/stubs/listasActionsStub.mjs");
const nav = await import("./support/stubs/programasRutaStub.mjs");
const { __resetRefreshes } = nav;
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | null = null;
let cont: HTMLElement | null = null;
async function montar(el: React.ReactElement) {
  cont = document.createElement("div");
  document.body.appendChild(cont);
  root = createRoot(cont);
  await act(async () => { root!.render(el); });
}
async function desmontar() {
  if (root) await act(async () => { root!.unmount(); });
  cont?.remove(); root = null; cont = null;
}
afterEach(async () => { await desmontar(); __reset(); __resetRefreshes(); });
after(() => dom.window.close());

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const textoDe = () => document.body.textContent ?? "";
const boton = (txt: string) => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(txt)) as HTMLButtonElement | undefined;
async function clic(el: Element | null | undefined) { assert.ok(el, "elemento a pulsar no encontrado"); await act(async () => { el!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); }
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    set.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

const PROG = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, subtitulo: null, dias: 5, noches: 4, publicado: true, activo: true,
  destino_fijo_id: null as number | null, destino: null as string | null, destino_es_provisional: false, proveedor: null, desde: null, ...extra,
});

// ── Aviso de programas sin destino ──────────────────────────────────────────
test("aviso: con N>0 aparece como ventana accesible con el mensaje y el acceso a los pendientes", async () => {
  await montar(h(ProgramasLista, { programas: [PROG(1, "Uno"), PROG(2, "Dos"), PROG(3, "Tres", { destino_fijo_id: 1, destino: "Brasil" })] }));
  const d = q('[role="dialog"]')!;
  assert.ok(d, "debe haber un dialog");
  assert.equal(d.getAttribute("aria-modal"), "false");
  assert.ok(d.getAttribute("aria-labelledby") && d.getAttribute("aria-describedby"));
  assert.match(d.textContent!, /Faltan 2 programas por asignar destino\. No serán visibles en el tarifario hasta hacerlo\./);
  assert.ok(boton("Ver sin destino"));
  assert.equal(document.activeElement, d, "el foco pasa a la ventana para que sea accesible con teclado");
});

test("aviso: N=0 no aparece", async () => {
  await montar(h(ProgramasLista, { programas: [PROG(1, "Con", { destino_fijo_id: 1, destino: "Brasil" }), PROG(2, "Inactivo", { activo: false })] }));
  assert.equal(q('[role="dialog"]'), null);
});

test("aviso: se puede descartar con la X y con Escape", async () => {
  await montar(h(ProgramasLista, { programas: [PROG(1, "Uno")] }));
  await clic(q('[aria-label="Cerrar aviso"]'));
  assert.equal(q('[role="dialog"]'), null);
  await desmontar();

  await montar(h(ProgramasLista, { programas: [PROG(1, "Uno")] }));
  await act(async () => { q('[role="dialog"]')!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(q('[role="dialog"]'), null);
});

test("aviso: descartarlo NO lo oculta por sesión — al volver a entrar a la página vuelve a salir", async () => {
  const programas = [PROG(1, "Uno")];
  await montar(h(ProgramasLista, { programas }));
  await clic(q('[aria-label="Cerrar aviso"]'));
  assert.equal(q('[role="dialog"]'), null);
  await desmontar();
  await montar(h(ProgramasLista, { programas }));
  assert.ok(q('[role="dialog"]'), "nueva entrada = nuevo aviso (sin sessionStorage/localStorage)");
  assert.equal(dom.window.sessionStorage.length + dom.window.localStorage.length, 0);
});

test("aviso: 'Ver pendientes' cierra la ventana y deja solo los activos sin destino, con salida 'Ver todos'", async () => {
  await montar(h(ProgramasLista, {
    programas: [PROG(1, "Pendiente activo"), PROG(2, "Con destino", { destino_fijo_id: 1, destino: "Brasil" }), PROG(3, "Pendiente inactivo", { activo: false })],
  }));
  await clic(boton("Ver sin destino"));
  assert.equal(q('[role="dialog"]'), null);
  const t = textoDe();
  assert.match(t, /Pendiente activo/);
  assert.doesNotMatch(t, /Con destino/);
  assert.doesNotMatch(t, /Pendiente inactivo/, "el aviso solo cuenta activos");
  await clic(boton("Ver todos"));
  assert.match(textoDe(), /Con destino/);
});

test("lista interna: programas publicados sin destino siguen visibles con 'No visible: falta destino'", async () => {
  await montar(h(ProgramasLista, { programas: [PROG(1, "Publicado sin destino"), PROG(2, "Con", { destino_fijo_id: 1, destino: "Brasil" })] }));
  const enlaces = [...document.querySelectorAll("a")];
  const sin = enlaces.find((a) => a.textContent!.includes("Publicado sin destino"))!;
  assert.match(sin.textContent!, /No visible: falta destino/);
  assert.equal(sin.getAttribute("href"), "/dashboard/producto/programas/1");
  const con = enlaces.find((a) => a.textContent!.includes("Con"))!;
  assert.doesNotMatch(con.textContent!, /falta destino/);
  assert.match(con.textContent!, /Destino: Brasil/);
});

// ── Aviso con DOS conteos: sin destino (ocultos) y por clasificar (visibles) ────────────────
const PROV = { destino_fijo_id: 9, destino: "Por clasificar", destino_es_provisional: true };

test("aviso: muestra los dos conteos por separado, cada uno con su mensaje y su botón", async () => {
  await montar(h(ProgramasLista, {
    programas: [PROG(1, "Sin A"), PROG(2, "Sin B"), PROG(3, "Prov A", PROV), PROG(4, "Prov B", PROV), PROG(5, "Prov C", PROV), PROG(6, "Real", { destino_fijo_id: 1, destino: "Brasil" })],
  }));
  const sin = q('[data-aviso="sin-destino"]')!;
  const por = q('[data-aviso="por-clasificar"]')!;
  assert.match(sin.textContent!, /Faltan 2 programas por asignar destino\. No serán visibles en el tarifario hasta hacerlo\./);
  assert.match(por.textContent!, /3 programas están en «Por clasificar»: son visibles en el tarifario, pero falta asignarles su destino real\./);
  assert.doesNotMatch(sin.textContent!, /Por clasificar/);
  assert.doesNotMatch(por.textContent!, /Faltan/);
  assert.ok(boton("Ver sin destino") && boton("Ver por clasificar"));
});

test("aviso: 'Ver por clasificar' filtra SOLO los activos del provisional; 'Ver todos' restablece", async () => {
  await montar(h(ProgramasLista, {
    programas: [PROG(1, "Sin A"), PROG(3, "Prov A", PROV), PROG(4, "Prov inactivo", { ...PROV, activo: false }), PROG(6, "Real", { destino_fijo_id: 1, destino: "Brasil" })],
  }));
  await clic(boton("Ver por clasificar"));
  assert.equal(q('[role="dialog"]'), null);
  const t = textoDe();
  assert.match(t, /Prov A/);
  assert.doesNotMatch(t, /Sin A|Prov inactivo|Real/);
  assert.match(t, /en «Por clasificar» \(visibles, falta su destino real\)/);
  await clic(boton("Ver todos"));
  assert.match(textoDe(), /Sin A/);
  assert.match(textoDe(), /Real/);
});

test("aviso: solo por clasificar -> solo ese mensaje; solo sin destino -> solo ese", async () => {
  await montar(h(ProgramasLista, { programas: [PROG(3, "Prov A", PROV)] }));
  assert.equal(q('[data-aviso="sin-destino"]'), null);
  assert.ok(q('[data-aviso="por-clasificar"]'));
  assert.match(q('[role="dialog"]')!.textContent!, /1 programa está en «Por clasificar»/);
  await desmontar();
  await montar(h(ProgramasLista, { programas: [PROG(1, "Sin A")] }));
  assert.ok(q('[data-aviso="sin-destino"]'));
  assert.equal(q('[data-aviso="por-clasificar"]'), null);
});

test("aviso: ambos en cero -> no aparece; el provisional se reconoce por la marca, no por el nombre", async () => {
  await montar(h(ProgramasLista, { programas: [PROG(1, "Real llamado igual", { destino_fijo_id: 2, destino: "Por clasificar", destino_es_provisional: false })] }));
  assert.equal(q('[role="dialog"]'), null, "un destino REAL llamado «Por clasificar» no activa el aviso");
});

test("lista interna: distintivo azul 'Por clasificar' para el provisional y ámbar 'No visible' para sin destino", async () => {
  await montar(h(ProgramasLista, { programas: [PROG(1, "Sin A"), PROG(3, "Prov A", PROV), PROG(6, "Real", { destino_fijo_id: 1, destino: "Brasil" })] }));
  const enlaces = [...document.querySelectorAll("a")];
  const txt = (n: string) => enlaces.find((a) => a.textContent!.includes(n))!.textContent!;
  assert.match(txt("Sin A"), /No visible: falta destino/);
  assert.match(txt("Prov A"), /Por clasificar: visible, falta su destino real/);
  assert.doesNotMatch(txt("Prov A"), /No visible/);
  assert.doesNotMatch(txt("Real"), /No visible|Por clasificar: visible/);
});

// ── Administración de la lista ──────────────────────────────────────────────
const ITEMS = [{ id: 1, nombre: "Brasil", programas: 2 }, { id: 2, nombre: "Europa", programas: 0 }];

test("lista: agregar llama a crear con el nombre y refresca; el campo se limpia", async () => {
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  await escribir(q<HTMLInputElement>("#nuevo-destino-fijo")!, "  Caribe ");
  await clic(boton("Agregar"));
  assert.deepEqual(__llamadas, [["crear", "Caribe"]]);
  assert.equal(q<HTMLInputElement>("#nuevo-destino-fijo")!.value, "");
  assert.equal(nav.__refreshes, 1);
});

test("lista: un duplicado se avisa en pantalla sin llamar al servidor", async () => {
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  await escribir(q<HTMLInputElement>("#nuevo-destino-fijo")!, "brasil");
  await clic(boton("Agregar"));
  assert.deepEqual(__llamadas, []);
  assert.match(q('[role="alert"]')!.textContent!, /ya está en la lista/);
});

test("lista: el error del servidor (p. ej. duplicado concurrente) se muestra y no refresca", async () => {
  __setImpls({ crear: async () => ({ ok: false, error: "Ya existe un destino con ese nombre" }) });
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  await escribir(q<HTMLInputElement>("#nuevo-destino-fijo")!, "Asia");
  await clic(boton("Agregar"));
  assert.match(q('[role="alert"]')!.textContent!, /Ya existe/);
  assert.equal(nav.__refreshes, 0);
});

test("lista: renombrar usa el mismo id y valida duplicados contra OTROS", async () => {
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  await clic(q('[aria-label="Renombrar Brasil"]'));
  const campo = q<HTMLInputElement>('[aria-label="Nombre del destino Brasil"]')!;
  await escribir(campo, "Europa");
  await clic(q('[aria-label="Guardar nombre"]'));
  assert.deepEqual(__llamadas, []);
  assert.match(q('[role="alert"]')!.textContent!, /ya está en la lista/);
  await escribir(q<HTMLInputElement>('[aria-label="Nombre del destino Brasil"]')!, "Brasil y Argentina");
  await clic(q('[aria-label="Guardar nombre"]'));
  assert.deepEqual(__llamadas, [["renombrar", 1, "Brasil y Argentina"]]);
});

test("lista: eliminar pide confirmación y, si el servidor lo rechaza por tener programas, lo muestra", async () => {
  __setImpls({ eliminar: async () => ({ ok: false, error: "No se puede eliminar: 2 programas lo tienen asignado." }) });
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  await clic(q('[aria-label="Eliminar Brasil"]'));
  assert.deepEqual(__llamadas, [], "el primer clic solo pide confirmar");
  assert.match(textoDe(), /¿Eliminar “Brasil”\?/);
  await clic([...document.querySelectorAll("button")].find((b) => b.textContent === "Eliminar"));
  assert.deepEqual(__llamadas, [["eliminar", 1]]);
  assert.match(q('[role="alert"]')!.textContent!, /2 programas lo tienen asignado/);
});

test("lista: muestra cuántos programas tiene cada destino", async () => {
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  assert.match(textoDe(), /Brasil\s*2 programas/);
  assert.match(textoDe(), /Sin programas asignados/);
});

test("lista: sin permiso de edición no hay alta ni botones de renombrar/eliminar", async () => {
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: false }));
  assert.equal(q("#nuevo-destino-fijo"), null);
  assert.equal(q('[aria-label^="Renombrar"]'), null);
  assert.equal(q('[aria-label^="Eliminar"]'), null);
  assert.match(textoDe(), /Solo lectura/);
});

test("lista vacía: explica cómo empezar", async () => {
  await montar(h(ListaDestinoProgramas, { items: [], puedeEditar: true }));
  assert.match(textoDe(), /La lista está vacía/);
});

test("lista: ofrece crear el provisional (solo si no existe y con permiso) y lo crea", async () => {
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  await clic(boton("Crear destino provisional"));
  assert.deepEqual(__llamadas, [["crearProvisional"]]);
  assert.equal(nav.__refreshes, 1);
});

test("lista: con un provisional existente no ofrece crear otro y lo marca; sin permiso tampoco", async () => {
  const items = [...ITEMS, { id: 9, nombre: "Por clasificar", programas: 5, es_provisional: true }];
  await montar(h(ListaDestinoProgramas, { items, puedeEditar: true }));
  assert.ok(!boton("Crear destino provisional"));
  assert.match(textoDe(), /Provisional: sus programas son visibles pero falta su destino real/);
  assert.match(textoDe(), /Por clasificar\s*Provisional/);
  await desmontar();
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: false }));
  assert.ok(!boton("Crear destino provisional"));
});

test("lista: si crear el provisional falla, el mensaje del servidor se muestra y no se refresca", async () => {
  __setImpls({ crearProvisional: async () => ({ ok: false, error: "Ya existe un destino provisional." }) });
  await montar(h(ListaDestinoProgramas, { items: ITEMS, puedeEditar: true }));
  await clic(boton("Crear destino provisional"));
  assert.match(q('[role="alert"]')!.textContent!, /Ya existe un destino provisional/);
  assert.equal(nav.__refreshes, 0);
});
