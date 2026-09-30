// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `EliminarDestinoBtn.tsx`.
// Lo que decide el modal es el contenido VERIFICADO (`usoDestino` +
// `modoEliminacion`), nunca la cantidad de hoteles:
//   - con contenido (p. ej. 0 hoteles y 5 receptivos): exige elegir otro
//     destino y ejecuta la FUSIÓN (eliminarDestino(id, destinoElegido));
//   - verificado sin contenido: borrado directo (eliminarDestino(id, undefined));
//   - no verificado (revisión fallida, tabla sin contar o rol no resuelto):
//     nunca se presenta como vacío ni se borra directo sobre un 0 supuesto;
//     solo la fusión, y "Reintentar verificación";
//   - rol sin permiso: ninguna acción;
//   - el ComboDestino ofrece solo los OTROS destinos, y escribir después de
//     elegir invalida la selección (nunca se usa el id anterior);
//   - un rechazo del servidor (p. ej. borrado de cero filas) se muestra tal
//     cual, el modal sigue abierto y se vuelve a verificar.
// La Server Action real ("./actions") se sustituye por un configurable
// (eliminarDestinoActionsStub.mjs vía reactLoader) que registra las llamadas.
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
const { EliminarDestinoBtn } = await import("../app/(dashboard)/dashboard/tarifario/EliminarDestinoBtn.tsx");
const { __setImpls } = await import("./support/stubs/eliminarDestinoActionsStub.mjs");
const { act, createElement: h } = React;

const DESTINOS = [
  { id: 1, nombre: "CARTAGENA" },
  { id: 2, nombre: "SAN ANDRES" },
  { id: 3, nombre: "MEDELLIN" },
];

const llamadas: Array<[number, number | undefined]> = [];
let verificaciones = 0;
const SIN_USO = {
  hoteles: 0, servicios_adicionales: 0, armado_paquetes: 0, tarifario_resultado: 0, bloqueos_vuelo: 0,
  empaquetados: 0, paquetes: 0, temporadas: 0, itinerarios: 0, inclusiones: 0,
};
type Conteos = Record<keyof typeof SIN_USO, number | null>;
type Permiso = "si" | "no" | "desconocido";
type Uso = { conteos: Conteos; alcanceCompleto: boolean; permiso: Permiso };
// permiso "si" = rol autorizado a borrar destinos (y a leer todas las filas).
const uso = (conteos: Partial<Conteos> = {}, permiso: Permiso = "si"): Uso =>
  ({ conteos: { ...SIN_USO, ...conteos }, alcanceCompleto: permiso === "si", permiso });
let usoImpl: (id: number) => Promise<Uso> = async () => uso();
let eliminarImpl: (id: number, reasignarA?: number) => Promise<{ ok: true } | { ok: false; error: string }> =
  async () => ({ ok: true });
__setImpls({
  eliminarDestino: async (id: number, reasignarA?: number) => {
    llamadas.push([id, reasignarA]);
    return eliminarImpl(id, reasignarA);
  },
  usoDestino: (id: number) => { verificaciones += 1; return usoImpl(id); },
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  llamadas.length = 0;
  verificaciones = 0;
  await act(async () => root!.render(h(EliminarDestinoBtn, { id: 1, nombre: "CARTAGENA", destinos: DESTINOS })));
}

const porTexto = (texto: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
const comboInput = () => container.querySelector<HTMLInputElement>('input[role="combobox"]');
const textoModal = () => container.textContent ?? "";
const modo = () => container.querySelector("[data-modo-eliminacion]")?.getAttribute("data-modo-eliminacion");

async function esperarFlush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function abrirModal() {
  const abrir = container.querySelector<HTMLButtonElement>('button[title="Eliminar destino"]');
  assert.ok(abrir, "no se encontró el botón de eliminar destino");
  await act(async () => abrir!.click());
  await esperarFlush();
}

async function clic(btn: HTMLElement | undefined, fallo = "botón no encontrado") {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
  await esperarFlush();
}

async function enfocar() {
  const inp = comboInput();
  assert.ok(inp, "no hay combo de destino de llegada");
  await act(async () => inp!.focus());
}

async function escribir(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(comboInput(), valor);
    comboInput()!.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function elegirConRaton(nombre: string) {
  await enfocar();
  const opcion = [...container.querySelectorAll('[role="option"]')].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === nombre
  );
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

afterEach(async () => {
  usoImpl = async () => uso();
  eliminarImpl = async () => ({ ok: true });
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

// ── Con contenido: fusión obligatoria ─────────────────────────────────────

test("0 hoteles y 5 receptivos: lista el contenido, exige otro destino y ejecuta la FUSIÓN (nunca borrado directo)", async () => {
  usoImpl = async () => uso({ servicios_adicionales: 5 });
  await render();
  await abrirModal();
  assert.equal(modo(), "fusion");
  assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent?.trim()), ["5 servicios adicionales"]);
  assert.ok(comboInput(), "aparece el combo de destino de llegada aunque no haya hoteles");
  assert.ok(!textoModal().includes("se eliminará directamente"));
  assert.equal(porTexto("Eliminar"), undefined, "no se ofrece el borrado directo");
  await clic(porTexto("Mover y eliminar"));
  assert.deepEqual(llamadas, [], "sin destino elegido no se ejecuta nada");
  assert.ok(textoModal().includes("Tiene contenido asociado: elige a qué destino moverlo."));
  await elegirConRaton("SAN ANDRES");
  await clic(porTexto("Mover y eliminar"));
  assert.deepEqual(llamadas, [[1, 2]], "fusión con el destino elegido");
  assert.equal(container.querySelector('[role="combobox"]'), null, "el modal se cierra tras la fusión exitosa");
});

test("el combo de llegada ofrece solo los OTROS destinos (nunca el que se elimina)", async () => {
  usoImpl = async () => uso({ hoteles: 2 });
  await render();
  await abrirModal();
  await enfocar();
  const textos = [...container.querySelectorAll('[role="option"]')].map(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim()
  );
  assert.deepEqual(textos, ["SAN ANDRES", "MEDELLIN"]);
});

test("con hoteles y paquetes: aclara que contratos/ventas/cotizaciones no se modifican y fusiona con el id elegido", async () => {
  usoImpl = async () => uso({ hoteles: 1, armado_paquetes: 3, tarifario_resultado: 1 });
  await render();
  await abrirModal();
  assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent?.trim()), ["1 hotel", "3 paquetes", "1 fila del tarifario generado"]);
  assert.ok(textoModal().includes("Los contratos, ventas y cotizaciones ya creados no se modifican."));
  await elegirConRaton("MEDELLIN");
  await clic(porTexto("Mover y eliminar"));
  assert.deepEqual(llamadas, [[1, 3]]);
});

test("escribir DESPUÉS de seleccionar invalida el destino: no se elimina con el id anterior", async () => {
  usoImpl = async () => uso({ hoteles: 2 });
  await render();
  await abrirModal();
  await elegirConRaton("SAN ANDRES");
  await escribir("med");
  const evEscape = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => comboInput()!.dispatchEvent(evEscape));
  assert.equal(comboInput()!.value, "");
  await clic(porTexto("Mover y eliminar"));
  assert.ok(textoModal().includes("elige a qué destino moverlo"));
  assert.deepEqual(llamadas, [], "NUNCA se elimina usando el id anterior");
});

// ── Verificado sin contenido: borrado directo ─────────────────────────────

test("verificado sin contenido (rol autorizado, todo en 0): borrado directo sin pedir destino", async () => {
  await render();
  await abrirModal();
  assert.equal(modo(), "borrado_directo");
  assert.equal(comboInput(), null, "sin contenido no hay combo de llegada");
  assert.ok(textoModal().includes("No tiene contenido asociado; se eliminará directamente."));
  await clic(porTexto("Eliminar"));
  assert.deepEqual(llamadas, [[1, undefined]]);
});

// ── No verificado: nunca un borrado sobre un 0 supuesto ───────────────────

test("conteo desconocido (la revisión falla): no afirma vacío ni borra directo; ofrece fusión y reintentar", async () => {
  usoImpl = async () => { throw new Error("red caída"); };
  await render();
  await abrirModal();
  assert.equal(modo(), "no_verificado");
  assert.ok(textoModal().includes("No se pudo revisar el contenido asociado"));
  assert.ok(!textoModal().includes("se eliminará directamente"));
  assert.ok(!textoModal().includes("No tiene contenido"));
  assert.equal(porTexto("Eliminar"), undefined, "no se ofrece el borrado directo");
  await clic(porTexto("Mover y eliminar"));
  assert.deepEqual(llamadas, [], "sin destino elegido no se ejecuta nada");
  assert.ok(textoModal().includes("No se pudo confirmar si tiene contenido: elige a qué destino moverlo o reintenta la verificación."));
  // Reintentar vuelve a pedir la verificación; ahora resulta vacío verificado.
  usoImpl = async () => uso();
  await clic(porTexto("Reintentar verificación"));
  assert.equal(verificaciones, 2);
  assert.equal(modo(), "borrado_directo");
});

test("no verificado + destino elegido: ejecuta la FUSIÓN, nunca eliminarDestino(id, undefined)", async () => {
  usoImpl = async () => { throw new Error("red caída"); };
  await render();
  await abrirModal();
  await elegirConRaton("SAN ANDRES");
  await clic(porTexto("Mover y eliminar"));
  assert.deepEqual(llamadas, [[1, 2]]);
});

test("una tabla que no se pudo contar: no verificado (nunca se toma como 0)", async () => {
  usoImpl = async () => uso({ empaquetados: null });
  await render();
  await abrirModal();
  assert.equal(modo(), "no_verificado");
  assert.ok(textoModal().includes("No se pudo verificar: empaquetados."));
  assert.ok(!textoModal().includes("se eliminará directamente"));
  assert.equal(porTexto("Eliminar"), undefined);
});

test("rol no resuelto (permiso desconocido) con todo en 0: no verificado, sin borrado directo", async () => {
  usoImpl = async () => uso({}, "desconocido");
  await render();
  await abrirModal();
  assert.equal(modo(), "no_verificado");
  assert.ok(!textoModal().includes("se eliminará directamente"));
  assert.equal(porTexto("Eliminar"), undefined);
});

test("mientras se verifica: la acción está deshabilitada y no ejecuta nada", async () => {
  let soltar: (u: Uso) => void = () => {};
  usoImpl = () => new Promise<Uso>((res) => { soltar = res; });
  await render();
  await abrirModal();
  assert.equal(modo(), "cargando");
  const b = porTexto("Eliminar");
  assert.ok(b && b.disabled, "botón deshabilitado mientras carga");
  await clic(b);
  assert.deepEqual(llamadas, []);
  await act(async () => soltar(uso()));
  await esperarFlush();
  assert.equal(modo(), "borrado_directo");
});

// ── Rol sin permiso ───────────────────────────────────────────────────────

test("rol sin permiso (todo en 0): lo dice y no ofrece ninguna acción", async () => {
  usoImpl = async () => uso({}, "no");
  await render();
  await abrirModal();
  assert.equal(modo(), "sin_permiso");
  assert.ok(textoModal().includes("Tu rol no tiene permiso para eliminar destinos."));
  assert.ok(!textoModal().includes("se eliminará directamente"));
  assert.equal(porTexto("Eliminar"), undefined);
  assert.equal(porTexto("Mover y eliminar"), undefined);
  assert.equal(comboInput(), null);
  assert.ok(porTexto("Cerrar"));
  assert.deepEqual(llamadas, []);
});

test("rol sin permiso con contenido visible: lo lista, avisa que puede haber más y no ofrece acciones", async () => {
  usoImpl = async () => uso({ bloqueos_vuelo: 2 }, "no");
  await render();
  await abrirModal();
  assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent?.trim()), ["2 bloqueos de vuelo"]);
  assert.ok(textoModal().includes("Solo se muestra lo que tu rol puede ver; puede haber más."));
  assert.equal(porTexto("Mover y eliminar"), undefined);
});

test("rol autorizado: la lista no lleva la advertencia de alcance parcial", async () => {
  usoImpl = async () => uso({ bloqueos_vuelo: 2 });
  await render();
  await abrirModal();
  assert.ok(!textoModal().includes("Solo se muestra lo que tu rol puede ver"));
});

// ── Rechazos del servidor ─────────────────────────────────────────────────

test("borrado de cero filas: el error del servidor se muestra, el modal sigue abierto y se re-verifica", async () => {
  eliminarImpl = async () => ({ ok: false, error: "No se eliminó el destino: no tienes permiso para borrarlo o ya no existe." });
  await render();
  await abrirModal();
  await clic(porTexto("Eliminar"));
  assert.deepEqual(llamadas, [[1, undefined]]);
  assert.ok(textoModal().includes("No se eliminó el destino: no tienes permiso para borrarlo o ya no existe."));
  assert.equal(verificaciones, 2, "tras el rechazo se vuelve a verificar");
  assert.ok(container.querySelector("[data-modo-eliminacion]"), "el modal sigue abierto");
});

test("si el contenido apareció entre la verificación y el borrado (23503): muestra el error y pasa a pedir destino", async () => {
  eliminarImpl = async () => ({ ok: false, error: "No se puede eliminar: el destino está en uso. Elige a qué destino mover su contenido y vuelve a intentar." });
  await render();
  await abrirModal();
  usoImpl = async () => uso({ servicios_adicionales: 1 });
  await clic(porTexto("Eliminar"));
  assert.ok(textoModal().includes("No se puede eliminar: el destino está en uso."));
  assert.equal(modo(), "fusion", "la re-verificación muestra el contenido nuevo");
  assert.ok(comboInput());
});

test("una respuesta tardía de una apertura anterior no pisa la revisión actual", async () => {
  let soltarVieja: (u: Uso) => void = () => {};
  let n = 0;
  usoImpl = () => {
    n += 1;
    if (n === 1) return new Promise<Uso>((res) => { soltarVieja = res; });
    return Promise.resolve(uso());
  };
  await render();
  await abrirModal();
  await clic(porTexto("Cancelar"));
  await abrirModal();
  assert.equal(modo(), "borrado_directo");
  await act(async () => soltarVieja(uso({ hoteles: 5 })));
  await esperarFlush();
  assert.equal(modo(), "borrado_directo", "la respuesta vieja se descarta");
  assert.ok(!textoModal().includes("5 hoteles"));
});
