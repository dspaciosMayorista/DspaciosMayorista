// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) de
// `components/ComboNombre.tsx` — la variante de los combos que trabaja con
// NOMBRES (strings) en lugar de ids numéricos (se usa en PagosList para el
// proveedor del catálogo, cuyo contrato persistido es el nombre). Misma
// mecánica endurecida + WAI-ARIA ya probada en ComboProveedor/ComboHotel/
// ComboDestino:
//   - Escribir una búsqueda nueva INVALIDA el nombre seleccionado (nunca queda
//     elegido un texto anterior al escribir otro).
//   - Flechas recorren los resultados; Enter elige SOLO con la lista abierta.
//   - Escape cierra la lista; el botón Limpiar invalida la selección.
//   - Sin coincidencias: Enter no selecciona nada.
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
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ComboNombre } = await import("../components/ComboNombre.tsx");
const { act, createElement: h } = React;

const opciones = ["Hoteles Alpha", "Agencia Beta", "Vuelos Gamma", "Beta Turismo"];

const estado = { cambios: [] as string[] };

function Harness({ inicial = "" }: { inicial?: string }) {
  const [val, setVal] = React.useState<string>(inicial);
  const cambia = (v: string) => { estado.cambios.push(v); setVal(v); };
  return h(ComboNombre, { opciones, value: val, onChange: cambia });
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(inicial: string = "") {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  estado.cambios.length = 0;
  await act(async () => root!.render(h(Harness, { inicial })));
}

const input = () => container.querySelector<HTMLInputElement>("input")!;

async function enfocar() {
  await act(async () => input().focus());
}

async function escribir(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input(), valor);
    input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function teclas(...keys: string[]): Promise<KeyboardEvent[]> {
  const eventos: KeyboardEvent[] = [];
  for (const key of keys) {
    const ev = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => input().dispatchEvent(ev));
    eventos.push(ev);
  }
  return eventos;
}

async function elegirConRaton(nombre: string) {
  const opcion = [...container.querySelectorAll("button")].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === nombre
  );
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("seleccionar A → escribir B → Enter elige B (Enter con la lista abierta marca defaultPrevented)", async () => {
  await render("Hoteles Alpha");
  await enfocar();
  await escribir("Beta");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "empezar a escribir invalida la selección previa (A)");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "Agencia Beta", "Enter con la lista abierta elige el primer resultado activo (Agencia Beta)");
  assert.equal(ev.defaultPrevented, true, "Enter con la lista abierta y coincidencias marca defaultPrevented");
  assert.equal(input().value, "Agencia Beta", "al cerrar la lista el input muestra el elegido");
});

test("búsqueda sin coincidencias invalida el nombre y Enter no elige nada (y marca defaultPrevented)", async () => {
  await render("Hoteles Alpha");
  await enfocar();
  await escribir("Zzzzz");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "al escribir se invalida el nombre");
  assert.equal(input().getAttribute("aria-expanded"), "true", "sin coincidencias la lista sigue abierta");
  assert.ok(!input().hasAttribute("aria-activedescendant"), "sin coincidencias no hay opción activa referida");
  assert.ok(
    [...document.querySelectorAll("div, button")].some((el) => el.textContent === "Sin coincidencias"),
    "debe mostrarse 'Sin coincidencias' con la lista vacía"
  );
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "Enter sin coincidencias no debe seleccionar nada");
  assert.equal(ev.defaultPrevented, true, "Enter sin coincidencias también marca defaultPrevented");
});

test("Escape cierra la lista y Enter con la lista cerrada no elige resultados ocultos (defaultPrevented false)", async () => {
  await render("Hoteles Alpha");
  await enfocar();
  await escribir("Beta");
  await teclas("Escape");
  assert.equal(container.querySelector("[data-idx]"), null, "Escape debe cerrar la lista");
  assert.equal(input().getAttribute("aria-expanded"), "false", "Escape deja aria-expanded=false");
  assert.ok(!input().hasAttribute("aria-activedescendant"), "con la lista cerrada no hay opción activa referida");
  assert.equal(input().value, "", "con la lista cerrada y el nombre invalidado el input queda vacío");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "Enter con la lista cerrada no debe elegir el resultado filtrado oculto");
  assert.equal(ev.defaultPrevented, false, "Enter con la lista cerrada no se intercepta: deja el submit implícito nativo al navegador");
});

test("las flechas recorren los resultados y Enter elige el tercer resultado activo", async () => {
  await render();
  await enfocar();
  const actInicial = input().getAttribute("aria-activedescendant");
  await teclas("ArrowDown", "ArrowDown");
  const actFinal = input().getAttribute("aria-activedescendant");
  assert.ok(actInicial && actFinal && actInicial !== actFinal, "las flechas cambian la opción activa (aria-activedescendant)");
  assert.ok(document.getElementById(actFinal!), "aria-activedescendant apunta a un elemento existente");
  await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "Vuelos Gamma", "dos flechas abajo → activo el tercer resultado (Vuelos Gamma)");
});

test("filtrar, elegir uno que no es el primero, cerrar y reabrir con flecha: el activo queda en su posición y Enter conserva el nombre", async () => {
  await render();
  await enfocar();
  await escribir("Beta");           // filtradas [Agencia Beta, Beta Turismo]
  await teclas("ArrowDown");        // activo → el segundo resultado (Beta Turismo)
  await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "Beta Turismo", "Enter eligió el segundo resultado filtrado (Beta Turismo)");
  await teclas("ArrowDown");        // lista cerrada: abre con búsqueda limpia, activo = posición real en los 4
  const opcion = [...container.querySelectorAll("button[data-idx]")].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === "Beta Turismo"
  );
  assert.ok(opcion, "la lista limpia muestra las 4 opciones");
  assert.equal(opcion!.getAttribute("data-idx"), "3", "el activo corresponde a su posición en la lista visible de hasta 50");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "Beta Turismo", "Enter conserva el nombre de la opción activa");
  assert.equal(ev.defaultPrevented, true, "re-elegir con la lista abierta también marca defaultPrevented");
});

test("el botón Limpiar invalida la opción seleccionada", async () => {
  await render("Vuelos Gamma");
  assert.equal(input().value, "Vuelos Gamma");
  const btnLimpiar = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Limpiar");
  assert.ok(btnLimpiar, "el botón Limpiar aparece con una opción elegida y la lista cerrada");
  await act(async () => btnLimpiar!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "Limpiar invalida el nombre");
  assert.equal(input().value, "", "el input queda vacío tras limpiar");
});

test("la selección por ratón sigue funcionando", async () => {
  await render();
  await enfocar();
  await elegirConRaton("Beta Turismo");
  assert.equal(estado.cambios[estado.cambios.length - 1], "Beta Turismo", "el mousedown sobre la opción elige Beta Turismo");
  assert.equal(input().value, "Beta Turismo");
});

test("semántica WAI-ARIA: combobox vinculado al listbox, opciones role=option fuera del Tab y activo solo con lista abierta y coincidencias", async () => {
  await render();
  const inp = input();
  assert.equal(inp.getAttribute("role"), "combobox", "el input expone role=combobox");
  assert.ok(inp.getAttribute("aria-label"), "el input tiene nombre accesible");
  assert.equal(inp.getAttribute("aria-autocomplete"), "list", "aria-autocomplete=list");
  assert.equal(inp.getAttribute("aria-expanded"), "false", "en reposo la lista está cerrada");
  assert.ok(!inp.hasAttribute("aria-activedescendant"), "con la lista cerrada no hay opción activa");

  await enfocar();
  assert.equal(inp.getAttribute("aria-expanded"), "true", "enfocar abre la lista");
  const listbox = document.querySelector('[role="listbox"]')!;
  assert.equal(inp.getAttribute("aria-controls"), listbox.id, "aria-controls vincula el input con el listbox");
  const opcionesDom = [...listbox.querySelectorAll('[role="option"]')];
  assert.equal(opcionesDom.length, opciones.length, "todas las opciones exponen role=option");
  assert.ok(opcionesDom.every((o) => o.id), "las opciones tienen ids estables");
  assert.ok(opcionesDom.every((o) => o.getAttribute("tabindex") === "-1"), "las opciones no entran en el orden de Tab");
  assert.equal(inp.getAttribute("aria-activedescendant"), opcionesDom[0]!.id, "la opción activa inicial es la primera");

  await teclas("ArrowDown");
  assert.equal(inp.getAttribute("aria-activedescendant"), opcionesDom[1]!.id, "ArrowDown mueve el activo a la segunda");
  assert.ok(document.getElementById(inp.getAttribute("aria-activedescendant")!), "el activo apunta a un elemento existente");

  await teclas("Escape");
  assert.equal(inp.getAttribute("aria-expanded"), "false", "Escape cierra la lista");
  assert.ok(!inp.hasAttribute("aria-activedescendant"), "lista cerrada: sin activo");
  assert.equal(document.querySelector('[role="listbox"]'), null, "el listbox no se renderiza con la lista cerrada");
});