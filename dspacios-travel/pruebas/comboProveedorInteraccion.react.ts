// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) del
// endurecimiento de `components/ComboProveedor.tsx` (misma mecánica ya probada
// y corregida en `ComboHotel`):
//   - Escribir una búsqueda nueva INVALIDA el proveedor seleccionado.
//   - Flechas recorren los resultados; Enter elige SOLO con la lista abierta;
//     con la lista cerrada no elige resultados ocultos.
//   - Escape cierra la lista.
//   - Al abrir con búsqueda limpia, el activo corresponde a la lista visible
//     (hasta 50 opciones).
//   - Conserva búsqueda sin tildes, selección por ratón, Limpiar y
//     "Sin coincidencias".
// teclas() devuelve los KeyboardEvent disparados para inspeccionar
// `defaultPrevented`: Enter con la lista abierta (con o sin coincidencias)
// lo marca en true; Enter con la lista cerrada no se intercepta (false),
// dejando el submit implícito nativo a cargo del navegador (jsdom no lo
// ejecuta; no se afirma aquí).
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
const { ComboProveedor } = await import("../components/ComboProveedor.tsx");
const { act, createElement: h } = React;

const proveedores = [
  { id: 1, nombre: "Hoteles Alpha" },
  { id: 2, nombre: "Agencia Beta" },
  { id: 3, nombre: "Vuelos Gamma" },
  { id: 4, nombre: "Beta Turismo" },
];

const estado = { cambios: [] as (number | "")[] };

function Harness({ inicial = "" }: { inicial?: number | "" }) {
  const [val, setVal] = React.useState<number | "">(inicial);
  const cambia = (v: number | "") => { estado.cambios.push(v); setVal(v); };
  return h(ComboProveedor, { proveedores, value: val, onChange: cambia });
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(inicial: number | "" = "") {
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
  const opcion = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === nombre);
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
  await render(1);
  await enfocar();
  await escribir("Beta");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "empezar a escribir invalida la selección previa (A)");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], 2, "Enter con la lista abierta elige el primer resultado activo (Agencia Beta, id 2)");
  assert.equal(ev.defaultPrevented, true, "Enter con la lista abierta y coincidencias marca defaultPrevented (sin submit implícito)");
  assert.equal(input().value, "Agencia Beta", "al cerrar la lista el input muestra el elegido");
});

test("búsqueda sin coincidencias invalida el id y Enter no elige nada (y marca defaultPrevented)", async () => {
  await render(1);
  await enfocar();
  await escribir("Zzzzz");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "al escribir se invalida el id");
  assert.equal(input().getAttribute("aria-expanded"), "true", "sin coincidencias la lista sigue abierta");
  assert.ok(!input().hasAttribute("aria-activedescendant"), "sin coincidencias no hay opción activa referida");
  assert.ok(
    [...document.querySelectorAll("div, button")].some((el) => el.textContent === "Sin coincidencias"),
    "debe mostrarse 'Sin coincidencias' con la lista vacía"
  );
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "Enter sin coincidencias no debe seleccionar nada");
  assert.equal(ev.defaultPrevented, true, "Enter sin coincidencias también marca defaultPrevented (sin submit implícito)");
});

test("Escape cierra la lista y Enter con la lista cerrada no elige resultados ocultos (defaultPrevented false)", async () => {
  await render(1);
  await enfocar();
  await escribir("Beta");
  await teclas("Escape");
  assert.equal(container.querySelector("[data-idx]"), null, "Escape debe cerrar la lista");
  assert.equal(input().getAttribute("aria-expanded"), "false", "Escape deja aria-expanded=false");
  assert.ok(!input().hasAttribute("aria-activedescendant"), "con la lista cerrada no hay opción activa referida");
  assert.equal(input().value, "", "con la lista cerrada y el id invalidado el input queda vacío");
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
  assert.equal(estado.cambios[estado.cambios.length - 1], 3, "dos flechas abajo → activo el tercer resultado (Vuelos Gamma, id 3)");
});

test("filtrar, elegir un proveedor que no es el primero, cerrar y reabrir con flecha: el activo queda en su posición de la lista limpia y Enter conserva el id", async () => {
  await render();
  await enfocar();
  await escribir("Beta");           // filtradas [Agencia Beta, Beta Turismo]
  await teclas("ArrowDown");        // activo → el segundo resultado (Beta Turismo, id 4)
  await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], 4, "Enter eligió el segundo resultado filtrado (Beta Turismo)");
  await teclas("ArrowDown");        // lista cerrada: abre con búsqueda limpia, activo = posición real en los 4
  const opcion = [...container.querySelectorAll("button[data-idx]")].find((b) => b.textContent?.trim() === "Beta Turismo");
  assert.ok(opcion, "la lista limpia muestra los 4 proveedores");
  assert.equal(opcion!.getAttribute("data-idx"), "3", "el activo corresponde a su posición en la lista visible de hasta 50");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], 4, "Enter conserva el id del proveedor activo");
  assert.equal(ev.defaultPrevented, true, "re-elegir con la lista abierta también marca defaultPrevented");
});

test("el botón Limpiar invalida el proveedor seleccionado", async () => {
  await render(2);
  assert.equal(input().value, "Agencia Beta");
  const btnLimpiar = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Limpiar");
  assert.ok(btnLimpiar, "el botón Limpiar aparece con un proveedor elegido y la lista cerrada");
  await act(async () => btnLimpiar!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "Limpiar invalida el id");
  assert.equal(input().value, "", "el input queda vacío tras limpiar");
});

test("la selección por ratón sigue funcionando", async () => {
  await render();
  await enfocar();
  await elegirConRaton("Beta Turismo");
  assert.equal(estado.cambios[estado.cambios.length - 1], 4, "el mousedown sobre la opción elige Beta Turismo (id 4)");
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
  const opciones = [...listbox.querySelectorAll('[role="option"]')];
  assert.equal(opciones.length, proveedores.length, "todas las opciones exponen role=option");
  assert.ok(opciones.every((o) => o.id), "las opciones tienen ids estables");
  assert.ok(opciones.every((o) => o.getAttribute("tabindex") === "-1"), "las opciones no entran en el orden de Tab");
  assert.equal(inp.getAttribute("aria-activedescendant"), opciones[0]!.id, "la opción activa inicial es la primera");

  await teclas("ArrowDown");
  assert.equal(inp.getAttribute("aria-activedescendant"), opciones[1]!.id, "ArrowDown mueve el activo a la segunda");
  await teclas("ArrowDown");
  assert.equal(inp.getAttribute("aria-activedescendant"), opciones[2]!.id, "dos flechas mueven el activo a la tercera");
  assert.ok(document.getElementById(inp.getAttribute("aria-activedescendant")!), "el activo apunta a un elemento existente");

  await teclas("Escape");
  assert.equal(inp.getAttribute("aria-expanded"), "false", "Escape cierra la lista");
  assert.ok(!inp.hasAttribute("aria-activedescendant"), "lista cerrada: sin activo");
  assert.equal(document.querySelector('[role="listbox"]'), null, "el listbox no se renderiza con la lista cerrada");

  await escribir("zzzz");
  assert.equal(inp.getAttribute("aria-expanded"), "true", "la lista se reabre al escribir");
  assert.ok(!inp.hasAttribute("aria-activedescendant"), "sin coincidencias no hay opción activa");
});