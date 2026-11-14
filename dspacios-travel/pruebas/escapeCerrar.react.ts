// Se ejecuta con npm run test:react (loader del arnés). Escape en las ventanas propias (`useEscapeCerrar`): hace lo mismo que la X o
// «Cancelar», cierra solo la capa superior, respeta «guardando» y cede a un popup de base-ui abierto encima o a un control que ya usó Escape.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- globals de jsdom para React/ReactDOM
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { useEscapeCerrar } = await import("../components/ui/useEscapeCerrar.ts");
const h = React.createElement;

const contenedor = document.createElement("div"); document.body.appendChild(contenedor);
let root: ReturnType<typeof createRoot> | null = null;
after(() => { if (root) act(() => root!.unmount()); dom.window.close(); });

// Una capa con su X; `bloqueado` simula «guardando» (Cancelar deshabilitado).
function Capa({ nombre, onCerrar, bloqueado = false, children }: { nombre: string; onCerrar: () => void; bloqueado?: boolean; children?: unknown }) {
  useEscapeCerrar(true, onCerrar, bloqueado);
  return h("div", { "data-capa": nombre }, h("button", { onClick: onCerrar }, "X"), children as never);
}
const escape = (destino: EventTarget = document.body) => act(() => { destino.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
const capas = () => [...contenedor.querySelectorAll("[data-capa]")].map((e) => e.getAttribute("data-capa")).join(",");

// Como en la app: la capa superior se abre DESPUÉS (desde la de abajo), no en el mismo render.
function Escenario({ bloquearSuperior = false }: { bloquearSuperior?: boolean }) {
  const [abiertas, setAbiertas] = React.useState(["fondo"]);
  React.useEffect(() => { setAbiertas((a) => [...a, "superior"]); }, []);
  const cerrar = (n: string) => setAbiertas((a) => a.filter((x) => x !== n));
  const sup = abiertas.includes("superior") ? h(Capa, { nombre: "superior", onCerrar: () => cerrar("superior"), bloqueado: bloquearSuperior }) : null;
  return abiertas.includes("fondo") ? h(Capa, { nombre: "fondo", onCerrar: () => cerrar("fondo") }, sup) : null;
}
const montar = (props: Record<string, unknown> = {}) => { if (root) act(() => root!.unmount()); root = createRoot(contenedor); act(() => root!.render(h(Escenario, props))); };

test("Escape cierra solo la capa superior; un segundo Escape cierra la de abajo", () => {
  montar();
  assert.equal(capas(), "fondo,superior");
  escape(); assert.equal(capas(), "fondo");
  escape(); assert.equal(capas(), "");
});

test("mientras la capa superior guarda (Cancelar deshabilitado), Escape no cierra nada", () => {
  montar({ bloquearSuperior: true });
  escape(); assert.equal(capas(), "fondo,superior", "ni la superior ni la de abajo");
});

test("un popup de base-ui abierto encima (diálogo de confirmación) se queda con el Escape", () => {
  montar();
  const popup = document.createElement("div"); popup.setAttribute("role", "dialog"); popup.setAttribute("data-open", ""); document.body.appendChild(popup);
  escape(); assert.equal(capas(), "fondo,superior");
  popup.remove();
  escape(); assert.equal(capas(), "fondo", "cerrado el popup, Escape vuelve a la capa superior");
});

test("un control que ya usó Escape (lista desplegable) no cierra la ventana", () => {
  montar();
  const input = document.createElement("input"); contenedor.querySelector("[data-capa=superior]")!.appendChild(input);
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") e.preventDefault(); });
  escape(input); assert.equal(capas(), "fondo,superior");
});
