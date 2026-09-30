// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de Producto → Destinos (`DestinosLista.tsx`):
//   - Las tarjetas ya NO listan hoteles adentro (compactas aunque un vecino
//     tenga 100 hoteles).
//   - "N hoteles" y "N receptivos" son botones que abren un diálogo
//     (components/ui/dialog.tsx) de ESE destino: título claro, búsqueda por
//     nombre (sin tildes), scroll interno, cierre con Escape y con "Cerrar",
//     y el foco vuelve a la insignia.
//   - Con 0 elementos la insignia es texto fijo, no botón.
//   - Hoteles: enlace real a /dashboard/producto/hoteles/[id].
//   - Receptivos: nombres pedidos SOLO al abrir (stub de la Server Action),
//     sin enlace (no hay ruta de detalle), y "sin permiso"/"error" nunca se
//     muestran como una lista vacía.
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent,
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
const { DestinosLista } = await import("../app/(dashboard)/dashboard/producto/destinos/DestinosLista.tsx");
const { __setImpls } = await import("./support/stubs/destinosActionsStub.mjs");
await import("./support/stubs/eliminarDestinoActionsStub.mjs");
const { act, createElement: h } = React;

type Resultado =
  | { estado: "ok"; receptivos: { id: number; nombre: string }[] }
  | { estado: "sin_permiso" }
  | { estado: "error" };

const llamadas: number[] = [];
let impl: (id: number) => Promise<Resultado> = async () => ({ estado: "ok", receptivos: [] });
__setImpls({ listarReceptivosDestino: (id: number) => { llamadas.push(id); return impl(id); } });

const NOMBRE_LARGO = "Hotel Boutique " + "Muy Largo ".repeat(20) + "Final";
const cienHoteles = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, nombre: `Hotel ${String(i + 1).padStart(3, "0")}` }));
const DESTINOS = [
  { id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", hoteles: [{ id: 10, nombre: "Hotel Río Único" }] },
  { id: 2, nombre: "BOGOTÁ", codigo_iata: "BOG", pais: "Colombia", hoteles: cienHoteles },
  { id: 3, nombre: "MONTERÍA", codigo_iata: "MTR", pais: "Colombia", hoteles: [] },
  { id: 4, nombre: "SANTA MARTA", codigo_iata: "SMR", pais: "Colombia", hoteles: [{ id: 20, nombre: NOMBRE_LARGO }, { id: 21, nombre: "Arena" }] },
];
const RECEPTIVOS_MONTERIA = ["City tour Montería", "Traslado aeropuerto", "Río Sinú en lancha", "Tour gastronómico", "Visita a Lorica"]
  .map((nombre, i) => ({ id: 500 + i, nombre }));

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(receptivosPorDestino: Record<number, number> | null = { 1: 0, 2: 12, 3: 5, 4: 0 }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  llamadas.length = 0;
  await act(async () => root!.render(h(DestinosLista, { destinos: DESTINOS, receptivosPorDestino })));
}

const esperar = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const tarjeta = (id: number) => container.querySelector<HTMLElement>(`[data-destino-tarjeta="${id}"]`)!;
const insignia = (id: number, texto: string) =>
  [...tarjeta(id).querySelectorAll<HTMLElement>("[data-insignia]")].find((e) => e.textContent?.trim() === texto);
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const botonEn = (el: ParentNode, texto: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;

async function abrir(id: number, texto: string) {
  const b = insignia(id, texto);
  assert.ok(b, `no está la insignia "${texto}"`);
  assert.equal(b!.tagName, "BUTTON", `"${texto}" debe ser un botón`);
  await act(async () => { b!.focus(); b!.click(); });
  await esperar();
  assert.ok(dialogo(), "el diálogo se abrió");
  return b!;
}

async function escribirBusqueda(valor: string) {
  const inp = dialogo()!.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(inp, valor);
    inp.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function escape() {
  const destino = (document.activeElement as HTMLElement | null) ?? document.body;
  await act(async () => {
    destino.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await esperar();
}

const itemsLista = () => [...dialogo()!.querySelectorAll("[data-lista] li")].map((li) => li.textContent?.trim());

afterEach(async () => {
  impl = async () => ({ estado: "ok", receptivos: [] });
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  await esperar();
});
after(() => dom.window.close());

// ── Tarjetas compactas ────────────────────────────────────────────────────

test("las tarjetas no listan hoteles adentro: 1 hotel junto a 100 hoteles quedan igual de compactas", async () => {
  await render();
  for (const id of [1, 2, 3, 4]) {
    assert.equal(tarjeta(id).querySelectorAll("a").length, 0, `la tarjeta ${id} no tiene enlaces a hoteles`);
    assert.equal(tarjeta(id).querySelectorAll("li").length, 0, `la tarjeta ${id} no tiene lista`);
  }
  assert.ok(insignia(1, "1 hotel") && insignia(2, "100 hoteles"));
  assert.ok(!tarjeta(2).textContent!.includes("Hotel 001"), "ningún nombre de hotel dentro de la tarjeta");
  assert.match(container.querySelector("[data-destino-tarjeta]")!.parentElement!.className, /\bitems-start\b/, "la grilla no estira tarjetas a la altura de su vecina");
  assert.match(tarjeta(4).querySelector("h3")!.className, /\bbreak-words\b/);
});

test("con 0 la insignia es texto fijo, no botón (Montería: 0 hoteles)", async () => {
  await render();
  const cero = insignia(3, "0 hoteles");
  assert.ok(cero);
  assert.equal(cero!.tagName, "SPAN");
  assert.equal(insignia(1, "0 receptivos")!.tagName, "SPAN");
  await act(async () => cero!.click());
  assert.equal(dialogo(), null);
});

// ── Diálogo de hoteles ────────────────────────────────────────────────────

test("100 hoteles: diálogo con título, los 100 enlaces reales ordenados y scroll interno", async () => {
  await render();
  await abrir(2, "100 hoteles");
  const d = dialogo()!;
  assert.match(d.textContent!, /Hoteles en BOGOTÁ/);
  const enlaces = [...d.querySelectorAll<HTMLAnchorElement>("[data-lista] a")];
  assert.equal(enlaces.length, 100);
  assert.equal(enlaces[0].getAttribute("href"), "/dashboard/producto/hoteles/1000");
  assert.equal(enlaces[0].textContent, "Hotel 001");
  assert.equal(enlaces[99].getAttribute("href"), "/dashboard/producto/hoteles/1099");
  const lista = d.querySelector<HTMLElement>("[data-lista]")!;
  assert.match(lista.className, /\bmax-h-\[50vh\]/, "alto acotado");
  assert.match(lista.className, /\boverflow-y-auto\b/, "scroll propio");
  assert.ok(!tarjeta(2).contains(d), "el diálogo va en un portal, fuera de la tarjeta");
});

test("el diálogo muestra solo los hoteles de ESE destino, y la búsqueda filtra por nombre sin tildes", async () => {
  await render();
  await abrir(1, "1 hotel");
  assert.match(dialogo()!.textContent!, /Hoteles en CARTAGENA/);
  assert.deepEqual(itemsLista(), ["Hotel Río Único"]);
  await escribirBusqueda("rio unico");
  assert.deepEqual(itemsLista(), ["Hotel Río Único"], "sin tildes y en minúsculas encuentra");
  await escribirBusqueda("zzz");
  assert.equal(dialogo()!.querySelector("[data-lista]"), null);
  assert.match(dialogo()!.textContent!, /Sin resultados para “zzz”/);
});

test("búsqueda en 100 hoteles: '05' deja solo los que coinciden y muestra 'x de 100'", async () => {
  await render();
  await abrir(2, "100 hoteles");
  await escribirBusqueda("05");
  assert.deepEqual(itemsLista(), ["Hotel 005", "Hotel 050", "Hotel 051", "Hotel 052", "Hotel 053", "Hotel 054", "Hotel 055", "Hotel 056", "Hotel 057", "Hotel 058", "Hotel 059"].filter((n) => n.includes("05")));
  assert.match(dialogo()!.querySelector("[data-lista-resumen]")!.textContent!, /^\d+ de 100$/);
});

test("nombre largo: se muestra completo y parte línea (break-words), sin desbordar", async () => {
  await render();
  await abrir(4, "2 hoteles");
  const enlace = [...dialogo()!.querySelectorAll<HTMLAnchorElement>("[data-lista] a")].find((a) => a.textContent === NOMBRE_LARGO);
  assert.ok(enlace, "el nombre largo está completo");
  assert.match(enlace!.className, /\bbreak-words\b/);
  assert.deepEqual(itemsLista(), ["Arena", NOMBRE_LARGO], "ordenados por nombre");
});

test("Escape cierra y el foco vuelve a la insignia", async () => {
  await render();
  const b = await abrir(2, "100 hoteles");
  assert.ok(dialogo()!.contains(document.activeElement), "el foco entra al diálogo");
  await escape();
  assert.equal(dialogo(), null);
  assert.equal(document.activeElement, b, "foco devuelto a '100 hoteles'");
});

test("'Cerrar' cierra y el foco vuelve a la insignia", async () => {
  await render();
  const b = await abrir(1, "1 hotel");
  await act(async () => botonEn(dialogo()!, "Cerrar")!.click());
  await esperar();
  assert.equal(dialogo(), null);
  assert.equal(document.activeElement, b);
});

// ── Diálogo de receptivos ─────────────────────────────────────────────────

test("no se piden nombres de receptivos al renderizar: solo al abrir, y para ESE destino", async () => {
  impl = async () => ({ estado: "ok", receptivos: RECEPTIVOS_MONTERIA });
  await render();
  await esperar();
  assert.deepEqual(llamadas, [], "ninguna carga de entrada");
  await abrir(3, "5 receptivos");
  assert.deepEqual(llamadas, [3]);
});

test("Montería (0 hoteles, 5 receptivos): 'cargando' y luego los 5 nombres reales, sin enlaces", async () => {
  let soltar: (r: Resultado) => void = () => {};
  impl = () => new Promise<Resultado>((res) => { soltar = res; });
  await render();
  assert.equal(insignia(3, "0 hoteles")!.tagName, "SPAN");
  await abrir(3, "5 receptivos");
  assert.match(dialogo()!.textContent!, /Receptivos en MONTERÍA/);
  assert.equal(dialogo()!.querySelector("[data-receptivos-estado]")!.getAttribute("data-receptivos-estado"), "cargando");
  assert.match(dialogo()!.textContent!, /Cargando receptivos…/);
  assert.equal(dialogo()!.querySelector("[data-lista-vacia]"), null, "mientras carga no se afirma lista vacía");
  await act(async () => soltar({ estado: "ok", receptivos: RECEPTIVOS_MONTERIA }));
  await esperar();
  assert.deepEqual(itemsLista(), RECEPTIVOS_MONTERIA.map((r) => r.nombre));
  assert.equal(dialogo()!.querySelectorAll("[data-lista] a").length, 0, "sin enlace: no hay ruta de detalle de servicio");
  assert.doesNotMatch(dialogo()!.textContent!, /Los datos cambiaron/, "lista y conteo coinciden");
  await escribirBusqueda("rio sinu");
  assert.deepEqual(itemsLista(), ["Río Sinú en lancha"]);
});

test("sin permiso: lo dice, y NO muestra una lista vacía", async () => {
  impl = async () => ({ estado: "sin_permiso" });
  await render();
  await abrir(3, "5 receptivos");
  assert.match(dialogo()!.textContent!, /Tu rol no tiene acceso a la lista de receptivos\./);
  assert.equal(dialogo()!.querySelector("[data-lista]"), null);
  assert.equal(dialogo()!.querySelector("[data-lista-vacia]"), null);
  assert.doesNotMatch(dialogo()!.textContent!, /no tiene receptivos/);
});

test("error (resultado o excepción): lo dice, no afirma lista vacía, y 'Reintentar' vuelve a pedir", async () => {
  for (const fallo of [async (): Promise<Resultado> => ({ estado: "error" }), async (): Promise<Resultado> => { throw new Error("red"); }]) {
    impl = fallo;
    await render();
    await abrir(3, "5 receptivos");
    assert.match(dialogo()!.textContent!, /No se pudo cargar la lista de receptivos\./);
    assert.equal(dialogo()!.querySelector("[data-lista-vacia]"), null);
    assert.doesNotMatch(dialogo()!.textContent!, /no tiene receptivos/);
    impl = async () => ({ estado: "ok", receptivos: RECEPTIVOS_MONTERIA });
    await act(async () => botonEn(dialogo()!, "Reintentar")!.click());
    await esperar();
    assert.equal(itemsLista().length, 5);
    assert.deepEqual(llamadas, [3, 3]);
    await act(async () => root?.unmount());
    root = undefined;
    container.remove();
    await esperar();
  }
});

test("lista confirmada por el servidor distinta del conteo: la muestra y avisa del cambio", async () => {
  impl = async () => ({ estado: "ok", receptivos: RECEPTIVOS_MONTERIA.slice(0, 4) });
  await render();
  await abrir(3, "5 receptivos");
  assert.equal(itemsLista().length, 4);
  assert.match(dialogo()!.textContent!, /La lista trae 4 receptivos; el conteo de la tarjeta decía 5\./);
});

test("sin conteo verificado (mapa null) no hay insignia de receptivos que abrir", async () => {
  await render(null);
  assert.equal([...tarjeta(3).querySelectorAll("[data-insignia]")].map((e) => e.textContent?.trim()).join("|"), "0 hoteles");
});

test("una respuesta tardía de una apertura anterior no pisa la vigente", async () => {
  const pendientes: Array<(r: Resultado) => void> = [];
  impl = () => new Promise<Resultado>((res) => { pendientes.push(res); });
  await render();
  await abrir(3, "5 receptivos");
  await escape();
  await abrir(3, "5 receptivos");
  await act(async () => pendientes[1]({ estado: "ok", receptivos: RECEPTIVOS_MONTERIA }));
  await esperar();
  await act(async () => pendientes[0]({ estado: "sin_permiso" }));
  await esperar();
  assert.equal(itemsLista().length, 5, "la respuesta vieja se descarta");
  assert.doesNotMatch(dialogo()!.textContent!, /Tu rol no tiene acceso/);
});

test("Escape en el diálogo de receptivos devuelve el foco a su insignia", async () => {
  impl = async () => ({ estado: "ok", receptivos: RECEPTIVOS_MONTERIA });
  await render();
  const b = await abrir(3, "5 receptivos");
  await escape();
  assert.equal(dialogo(), null);
  assert.equal(document.activeElement, b);
});
