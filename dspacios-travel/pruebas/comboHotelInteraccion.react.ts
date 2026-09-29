// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT (renderizado real, eventos DOM reales) de
// `components/ComboHotel.tsx`:
//   - Búsqueda POR NOMBRE y POR ZONA, sin tildes (norm).
//   - Escribir una búsqueda nueva INVALIDA el hotel seleccionado.
//   - Enter con la lista abierta elige y marca `defaultPrevented` (sin submit
//     implícito); Enter con la lista cerrada no elige resultados ocultos y
//     `defaultPrevented` queda en false.
//   - Flechas recorren los resultados; Escape cierra.
//   - Conserva Limpiar y la selección por ratón. Sin texto libre ni creación.
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
const { ComboHotel } = await import("../components/ComboHotel.tsx");
const { act, createElement: h } = React;

const hoteles = [
  { id: 1, nombre: "Gran Hotel Andalucía", zona: "Costa del Sol" },
  { id: 2, nombre: "Aguas Claras", zona: "Cartagena" },
  { id: 3, nombre: "Riviera Maya Palace", zona: "Cancún" },
  { id: 4, nombre: "Refugio Andino", zona: "Salta" },
  { id: 5, nombre: "Casa Blanca Boutique", zona: null },
];

const estado = { cambios: [] as (number | "")[] };

function Harness({ inicial = "" }: { inicial?: number | "" }) {
  const [val, setVal] = React.useState<number | "">(inicial);
  const cambia = (v: number | "") => { estado.cambios.push(v); setVal(v); };
  return h(ComboHotel, { hoteles, value: val, onChange: cambia });
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
  const opcion = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(nombre));
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("búsqueda sin tildes por nombre (Andalucía) y por zona (Salta) filtra la lista y Enter elige", async () => {
  await render();
  await enfocar();
  await escribir("andalu");
  let opciones = [...container.querySelectorAll("[data-idx]")].map((b) => b.textContent ?? "");
  assert.equal(opciones.length, 1, "toda la lista del 1-resultado");
  assert.ok(opciones[0]!.includes("Gran Hotel Andalucía") && opciones[0]!.includes("Costa del Sol"), "la opción muestra nombre y zona");
  const [ev1] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], 1, "elección por nombre sin tilde");
  assert.equal(ev1.defaultPrevented, true);
  await escribir("salta");
  opciones = [...container.querySelectorAll("[data-idx]")].map((b) => b.textContent ?? "");
  assert.equal(opciones.length, 1, "solo un resultado al filtrar por zona");
  assert.ok(opciones[0]!.includes("Refugio Andino") && opciones[0]!.includes("Salta"), "la zona 'Salta' se encuentra escribiendo 'salta'");
  const [ev2] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], 4, "elección por zona sin tilde");
  assert.equal(ev2.defaultPrevented, true);
});

test("escribir invalida el id previo y Enter con la lista abierta elige (defaultPrevented true)", async () => {
  await render(2);                    // Aguas Claras
  await enfocar();
  await escribir("cancun");           // zona 'Cancún' sin tilde
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "empezar a escribir invalida la selección previa");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], 3, "Enter elige Riviera Maya Palace (zona Cancún)");
  assert.equal(ev.defaultPrevented, true, "Enter con la lista abierta marca defaultPrevented");
  assert.equal(input().value, "Riviera Maya Palace (Cancún)", "el input muestra el hotel elegido con su zona");
});

test("búsqueda sin coincidencias deja el id vacío y Enter marca defaultPrevented sin seleccionar", async () => {
  await render(1);
  await enfocar();
  await escribir("Tokio");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "al escribir se invalida el id");
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
  await render(1);
  await enfocar();
  await escribir("andino");           // filtradas [Refugio Andino]
  await teclas("Escape");
  assert.equal(container.querySelector("[data-idx]"), null, "Escape debe cerrar la lista");
  assert.equal(input().getAttribute("aria-expanded"), "false", "Escape deja aria-expanded=false");
  assert.ok(!input().hasAttribute("aria-activedescendant"), "con la lista cerrada no hay opción activa referida");
  assert.equal(input().value, "", "con la lista cerrada y el id invalidado el input queda vacío");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "Enter con la lista cerrada no debe elegir el resultado filtrado oculto");
  assert.equal(ev.defaultPrevented, false, "Enter con la lista cerrada no se intercepta");
});

test("las flechas recorren los resultados y Enter elige el resultado activo", async () => {
  await render();
  await enfocar();
  const actInicial = input().getAttribute("aria-activedescendant");
  await teclas("ArrowDown", "ArrowDown", "ArrowDown");
  const actFinal = input().getAttribute("aria-activedescendant");
  assert.ok(actInicial && actFinal && actInicial !== actFinal, "las flechas cambian la opción activa (aria-activedescendant)");
  assert.ok(document.getElementById(actFinal!), "aria-activedescendant apunta a un elemento existente");
  const [ev] = await teclas("Enter");
  assert.equal(estado.cambios[estado.cambios.length - 1], 4, "tres flechas abajo → Refugio Andino (id 4)");
  assert.equal(ev.defaultPrevented, true);
});

test("el botón Limpiar invalida el hotel seleccionado", async () => {
  await render(3);
  assert.equal(input().value, "Riviera Maya Palace (Cancún)");
  const btnLimpiar = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Limpiar");
  assert.ok(btnLimpiar, "el botón Limpiar aparece con un hotel elegido y la lista cerrada");
  await act(async () => btnLimpiar!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
  assert.equal(estado.cambios[estado.cambios.length - 1], "", "Limpiar invalida el id");
  assert.equal(input().value, "", "el input queda vacío tras limpiar");
});

test("la selección por ratón sigue funcionando", async () => {
  await render();
  await enfocar();
  await elegirConRaton("Aguas Claras");
  assert.equal(estado.cambios[estado.cambios.length - 1], 2, "el mousedown sobre la opción elige Aguas Claras (id 2)");
  assert.equal(input().value, "Aguas Claras (Cartagena)");
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
  assert.equal(opciones.length, hoteles.length, "todas las opciones exponen role=option");
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

  await escribir("inexistente");
  assert.equal(inp.getAttribute("aria-expanded"), "true", "la lista se reabre al escribir");
  assert.ok(!inp.hasAttribute("aria-activedescendant"), "sin coincidencias no hay opción activa");
});