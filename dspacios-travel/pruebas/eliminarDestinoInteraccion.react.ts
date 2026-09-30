// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `EliminarDestinoBtn.tsx` tras reemplazar el
// <select> de "destino de llegada" por `ComboDestino`:
//   - El combo ofrece SOLO los otros destinos (nunca el que se elimina).
//   - Con hoteles, elegir un destino mueve y elimina (llama a eliminarDestino
//     con el id elegido, no con texto).
//   - Escribir DESPUÉS de seleccionar invalida el destino: el botón queda
//     bloqueado con el aviso y NUNCA se elimina usando el id anterior.
//   - Sin hoteles se elimina directo sin pedir destino (id + undefined).
//   - (Ronda 1) El modal explica QUÉ contenido real bloquea el borrado
//     (`usoDestino`, stub configurable) sin cambiar el flujo: el combo sigue
//     dependiendo de `hoteles`, las llamadas a eliminarDestino son las mismas
//     y el error del servidor se muestra tal cual.
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
const SIN_USO = {
  hoteles: 0, servicios_adicionales: 0, armado_paquetes: 0, tarifario_resultado: 0, bloqueos_vuelo: 0,
  empaquetados: 0, paquetes: 0, temporadas: 0, itinerarios: 0, inclusiones: 0,
};
type Conteos = Record<keyof typeof SIN_USO, number | null>;
type Uso = { conteos: Conteos; alcanceCompleto: boolean };
// `alcanceCompleto` true = rol autorizado a borrar destinos (lee todas las filas).
const uso = (conteos: Partial<Conteos> = {}, alcanceCompleto = true): Uso => ({ conteos: { ...SIN_USO, ...conteos }, alcanceCompleto });
let usoImpl: (id: number) => Promise<Uso> = async () => uso();
let eliminarImpl: (id: number, reasignarA?: number) => Promise<{ ok: true } | { ok: false; error: string }> =
  async () => ({ ok: true });
__setImpls({
  eliminarDestino: async (id: number, reasignarA?: number) => {
    llamadas.push([id, reasignarA]);
    return eliminarImpl(id, reasignarA);
  },
  usoDestino: (id: number) => usoImpl(id),
});

function Harness({ hoteles = 2 }: { hoteles?: number }) {
  return h(EliminarDestinoBtn, { id: 1, nombre: "CARTAGENA", hoteles, destinos: DESTINOS });
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(hoteles = 2) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  llamadas.length = 0;
  await act(async () => root!.render(h(Harness, { hoteles })));
}

const porTexto = (texto: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

const comboInput = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;

async function abrirModal() {
  const abrir = container.querySelector<HTMLButtonElement>('button[title="Eliminar destino"]');
  assert.ok(abrir, "no se encontró el botón de eliminar destino");
  await act(async () => abrir!.click());
}

async function esperarFlush() {
  await act(async () => { await Promise.resolve(); });
}

async function clic(btn: HTMLElement | undefined, fallo = "botón no encontrado") {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
  await esperarFlush();
}

async function enfocar() {
  const inp = comboInput();
  await act(async () => inp.focus());
}

async function escribir(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(comboInput(), valor);
    comboInput().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function elegirConRaton(nombre: string) {
  const opcion = [...container.querySelectorAll('[role="option"]')].find(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim() === nombre
  );
  assert.ok(opcion, `no se encontró la opción "${nombre}"`);
  await act(async () => opcion!.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })));
}

const textoModal = () => container.textContent ?? "";

afterEach(async () => {
  usoImpl = async () => uso();
  eliminarImpl = async () => ({ ok: true });
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("el combo de llegada ofrece solo los OTROS destinos (nunca el que se elimina)", async () => {
  await render(2);
  await abrirModal();
  await enfocar();
  const textos = [...container.querySelectorAll('[role="option"]')].map(
    (b) => (b.querySelector("span")?.textContent ?? b.textContent)?.trim()
  );
  assert.deepEqual(textos, ["SAN ANDRES", "MEDELLIN"], "solo los destinos distintos al que se elimina");
});

test("con hoteles, elegir un destino mueve y elimina con ese id (funciona el mousedown)", async () => {
  await render(2);
  await abrirModal();
  await enfocar();
  await elegirConRaton("MEDELLIN");
  assert.equal(comboInput().value, "MEDELLIN", "el combo muestra el destino elegido");
  await clic(porTexto("Mover y eliminar"), "faltó el botón Mover y eliminar");
  assert.deepEqual(llamadas, [[1, 3]], "eliminarDestino se llama con (id=1, reasignarA=3)");
  assert.equal(container.querySelector('[role="listbox"]'), null, "el modal se cierra tras eliminar ok");
});

test("escribir DESPUÉS de seleccionar invalida el destino: no se elimina con el id anterior", async () => {
  await render(2);
  await abrirModal();
  await enfocar();
  await elegirConRaton("SAN ANDRES");      // elige id 2…
  await escribir("med");                   // …pero escribe otra búsqueda: invalida
  const evEscape = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => comboInput().dispatchEvent(evEscape));
  assert.equal(comboInput().value, "", "con la selección invalidada el combo queda vacío");
  await clic(porTexto("Mover y eliminar"), "faltó el botón Mover y eliminar");
  assert.ok(
    [...container.querySelectorAll("p")].some((el) => el.textContent?.includes("elige a qué destino moverlos")),
    "se bloquea con el aviso de elegir a qué destino moverlos"
  );
  assert.deepEqual(llamadas, [], "NUNCA se elimina usando el id anterior tras escribir otro texto");
});

test("sin hoteles se elimina directo, sin pedir destino (undefined)", async () => {
  await render(0);
  await abrirModal();
  await esperarFlush();
  assert.equal(container.querySelector('[role="combobox"]'), null, "sin hoteles no hay combo de llegada");
  assert.ok(
    [...container.querySelectorAll("p")].some((el) => el.textContent?.includes("se eliminará directamente")),
    "sin hoteles se avisa de borrado directo"
  );
  await clic(porTexto("Eliminar"), "faltó el botón Eliminar");
  assert.deepEqual(llamadas, [[1, undefined]], "eliminarDestino se llama con (id=1, sin reasignar)");
});
// ── Ronda 1: explicación del contenido asociado ─────────────────────────

test("sin hoteles pero con otro contenido: lo lista con singular/plural, NO promete borrado directo y conserva el flujo (id + undefined, error del servidor tal cual)", async () => {
  usoImpl = async () => uso({ servicios_adicionales: 2, bloqueos_vuelo: 1 });
  eliminarImpl = async () => ({ ok: false, error: "No se puede eliminar: el destino está en uso. Elige a qué destino mover su contenido y vuelve a intentar." });
  await render(0);
  await abrirModal();
  await esperarFlush();
  const items = [...container.querySelectorAll("li")].map((li) => li.textContent?.trim());
  assert.deepEqual(items, ["2 servicios adicionales", "1 bloqueo de vuelo"], "lista solo lo que tiene filas, en orden y con singular/plural");
  assert.ok(!textoModal().includes("se eliminará directamente"), "nunca promete borrado directo si hay contenido asociado");
  assert.ok(textoModal().includes("la base de datos rechazará la eliminación"), "explica que el borrado directo será rechazado");
  assert.ok(
    textoModal().includes("Este cuadro solo ofrece mover el contenido a otro destino cuando el destino tiene hoteles."),
    "dice honestamente lo que el cuadro permite"
  );
  assert.ok(!/desde su módulo|reasígnalo/i.test(textoModal()), "no promete que todo se pueda reasignar desde un módulo");
  assert.equal(container.querySelector('[role="combobox"]'), null, "sin hoteles el flujo NO cambia: no aparece el combo de llegada");
  await clic(porTexto("Eliminar"), "faltó el botón Eliminar");
  assert.deepEqual(llamadas, [[1, undefined]], "misma llamada que antes (sin reasignar)");
  assert.ok(textoModal().includes("No se puede eliminar: el destino está en uso."), "el error del servidor se muestra sin reescribir");
});

test("con hoteles: lista el contenido real, aclara que los contratos no se modifican y la fusión sigue igual (id elegido)", async () => {
  usoImpl = async () => uso({ hoteles: 1, armado_paquetes: 3, tarifario_resultado: 1 });
  await render(1);
  await abrirModal();
  await esperarFlush();
  const items = [...container.querySelectorAll("li")].map((li) => li.textContent?.trim());
  assert.deepEqual(items, ["1 hotel", "3 paquetes", "1 fila del tarifario generado"]);
  assert.ok(textoModal().includes("Los contratos, ventas y cotizaciones ya creados no se modifican."));
  await enfocar();
  await elegirConRaton("SAN ANDRES");
  await clic(porTexto("Mover y eliminar"), "faltó el botón Mover y eliminar");
  assert.deepEqual(llamadas, [[1, 2]], "fusión con el id elegido, igual que antes");
});

test("si la revisión falla, no afirma nada (ni 'sin contenido' ni borrado directo) y eliminar sigue disponible", async () => {
  usoImpl = async () => { throw new Error("red caída"); };
  await render(0);
  await abrirModal();
  await esperarFlush();
  assert.ok(textoModal().includes("No se pudo revisar el contenido asociado: no es posible confirmar si el destino está en uso."));
  assert.ok(!textoModal().includes("se eliminará directamente"));
  await clic(porTexto("Eliminar"), "faltó el botón Eliminar");
  assert.deepEqual(llamadas, [[1, undefined]]);
});

test("una tabla que no se pudo contar se declara como no verificada — nunca se toma como 0", async () => {
  usoImpl = async () => uso({ empaquetados: null });
  await render(0);
  await abrirModal();
  await esperarFlush();
  assert.ok(textoModal().includes("No se pudo verificar: empaquetados."));
  assert.ok(!textoModal().includes("se eliminará directamente"), "sin verificar todo no se promete borrado directo");
});

test("una respuesta tardía de una apertura anterior no pisa la revisión actual", async () => {
  let soltarVieja: (u: Uso) => void = () => {};
  let llamada = 0;
  usoImpl = () => {
    llamada += 1;
    if (llamada === 1) return new Promise<Uso>((res) => { soltarVieja = res; });
    return Promise.resolve(uso());
  };
  await render(0);
  await abrirModal();
  await clic(porTexto("Cancelar"), "faltó Cancelar");
  await abrirModal();
  await esperarFlush();
  assert.ok(textoModal().includes("se eliminará directamente"), "la revisión vigente (sin uso) se muestra");
  await act(async () => soltarVieja(uso({ hoteles: 5 })));
  await esperarFlush();
  assert.ok(!textoModal().includes("5 hoteles"), "la respuesta vieja se descarta");
  assert.ok(textoModal().includes("se eliminará directamente"));
});

// ── Ronda 2: «sin contenido» solo con alcance completo ──────────────────

test("rol sin lectura completa (ej. control_vuelo) y todo en 0: NO afirma 'sin contenido' ni borrado directo; el flujo no cambia", async () => {
  usoImpl = async () => uso({}, false);
  await render(0);
  await abrirModal();
  await esperarFlush();
  assert.ok(!textoModal().includes("se eliminará directamente"), "un 0 bajo RLS no es ausencia");
  assert.ok(!textoModal().includes("No tiene contenido asociado"));
  assert.ok(textoModal().includes("No se encontró contenido asociado entre lo que tu rol puede ver; con tu rol no es posible confirmar que no haya más."));
  assert.equal(container.querySelector('[role="combobox"]'), null, "sin hoteles no aparece el combo (igual que antes)");
  await clic(porTexto("Eliminar"), "faltó el botón Eliminar");
  assert.deepEqual(llamadas, [[1, undefined]], "misma llamada que antes");
});

test("rol sin lectura completa con contenido visible: lo lista y aclara que puede haber más", async () => {
  usoImpl = async () => uso({ bloqueos_vuelo: 2 }, false);
  await render(0);
  await abrirModal();
  await esperarFlush();
  assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent?.trim()), ["2 bloqueos de vuelo"]);
  assert.ok(textoModal().includes("Solo se muestra lo que tu rol puede ver; puede haber más."));
});

test("rol autorizado: la lista no lleva la advertencia de alcance parcial", async () => {
  usoImpl = async () => uso({ bloqueos_vuelo: 2 }, true);
  await render(0);
  await abrirModal();
  await esperarFlush();
  assert.ok(!textoModal().includes("Solo se muestra lo que tu rol puede ver"));
});
