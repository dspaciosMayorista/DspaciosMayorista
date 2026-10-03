// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// Prueba de INTERACCIÓN REACT de `PasajeroAcciones.tsx` (detalle de un record):
//   - En una silla LIBRE (`libre`) no se ofrece "Mover" (no hay a quién mover).
//     La protección real está en la base: mover_pasajero (migración 194)
//     rechaza una silla libre aunque se llame la acción directamente.
//   - En una silla ocupada, el diálogo exige elegir EXPLÍCITAMENTE el modo
//     ("Solo sus datos" / "Con su cupo"), sin valor por defecto, y envía un
//     identificador de operación que se conserva en los reintentos.
//   - Tarifa distinta: exige confirmación antes de enviar.
//   - Editar y Borrar no cambian; Borrar sigue llamando a borrarPasajeroSilla.
//   - `libre` es OBLIGATORIA: todos los usos del componente en el repo la pasan.
//   - La página calcula `libre` con `esSillaLibre` y el contrato manual REAL de
//     la silla (no se deduce solo de los datos de pasajero).
// La Server Action real ("../actions") se sustituye por un configurable
// (vuelosActionsStub.mjs vía reactLoader).
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { PasajeroAcciones } = await import("../app/(dashboard)/dashboard/vuelos/[id]/PasajeroAcciones.tsx");
const { __setImpls } = await import("./support/stubs/vuelosActionsStub.mjs");
const { act, createElement: h } = React;

const borrados: Array<[number, number]> = [];
type MoverOpc = { modo: string; aceptaTarifaDistinta?: boolean; motivo?: string; operacionId: string };
const movidos: Array<[number, number, number, MoverOpc]> = [];
let respuestasMover: unknown[] = [];
__setImpls({
  borrarPasajeroSilla: async (sillaId: number, bloqueoId: number) => { borrados.push([sillaId, bloqueoId]); return { ok: true }; },
  moverPasajeroSilla: async (sillaId: number, origen: number, destino: number, opc: MoverOpc) => {
    movidos.push([sillaId, origen, destino, opc]);
    return respuestasMover.shift() ?? { ok: true, repetida: false, movidas: 1, contrato: null, avisoTarifaDistinta: false, avisoRecordContrato: false };
  },
});

const VACIO = { pasajero_nombres: "", pasajero_apellidos: "", tipo_doc: "", numero_doc: "", nacimiento: "", asesor: "", hotel: "", acomodacion: "", plazo: "" };
const OCUPADO = { ...VACIO, pasajero_nombres: "ANA", pasajero_apellidos: "PEREZ", tipo_doc: "CC", numero_doc: "123", nacimiento: "1990-01-01" };

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function render(props: { libre: boolean; inicial?: typeof VACIO; contratoOrganico?: boolean }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(h(PasajeroAcciones, {
      sillaId: 7, bloqueoId: 3, inicial: props.inicial ?? VACIO,
      otros: [
        { id: 4, record: "OTRO01", fecha_ida: "2026-12-01", libres: 2, tarifaDistinta: false, mismasFechas: true },
        { id: 5, record: "CARO01", fecha_ida: "2026-12-01", libres: 0, tarifaDistinta: true, mismasFechas: true },
        { id: 6, record: "FECH01", fecha_ida: "2026-12-08", libres: 3, tarifaDistinta: false, mismasFechas: false },
      ],
      bloqueada: false, fechaIdaBloqueo: "2026-12-01", candidatosResponsable: [],
      libre: props.libre,
      contratoOrganico: props.contratoOrganico ?? false,
    }))
  );
}
const botones = () => [...container.querySelectorAll("button")].map((b) => b.textContent?.trim());
const boton = (t: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}
async function elegirDestino(id: number) {
  const sel = container.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    sel.value = String(id);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const radios = () => [...container.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
const btnMover = () => boton("Mover pasajero") as HTMLButtonElement | undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  borrados.length = 0;
  movidos.length = 0;
  respuestasMover = [];
});
after(() => dom.window.close());

test("silla libre: no se ofrece Mover; Editar y Borrar siguen", async () => {
  await render({ libre: true });
  assert.deepEqual(botones(), ["Editar", "Borrar"]);
});

test("silla ocupada: Mover abre el diálogo con los dos modos y NINGUNO elegido", async () => {
  await render({ libre: false, inicial: OCUPADO });
  assert.deepEqual(botones(), ["Editar", "Mover", "Borrar"]);
  await click(boton("Mover")!);
  assert.ok(container.textContent?.includes("Mover pasajero a otro record"), "abre el diálogo de mover");
  assert.deepEqual(radios().map((r) => r.value), ["solo_datos", "con_cupo"]);
  assert.ok(radios().every((r) => !r.checked), "sin modo por defecto");
  assert.ok(container.textContent?.includes("¿Cómo lo recibe el record destino?"));
  assert.equal(btnMover()!.disabled, true, "sin destino ni modo no se puede enviar");
  await elegirDestino(4);
  assert.equal(btnMover()!.disabled, true, "con destino pero sin modo, tampoco");
});

for (const [i, modo] of [[0, "solo_datos"], [1, "con_cupo"]] as const) {
  test(`elegir ${modo} envía ese modo explícito y un identificador de operación`, async () => {
    await render({ libre: false, inicial: OCUPADO });
    await click(boton("Mover")!);
    await elegirDestino(4);
    await click(radios()[i]!);
    assert.equal(btnMover()!.disabled, false);
    await click(btnMover()!);
    assert.equal(movidos.length, 1);
    const [silla, origen, destino, opc] = movidos[0]!;
    assert.deepEqual([silla, origen, destino, opc.modo, opc.aceptaTarifaDistinta], [7, 3, 4, modo, false]);
    assert.match(opc.operacionId, UUID);
    assert.ok(container.textContent?.includes("Listo: 1 silla(s) movida(s)"));
  });
}

test("reintento tras un error reutiliza el MISMO identificador de operación", async () => {
  respuestasMover = [{ ok: false, error: "Otra persona está modificando este record en este momento." }];
  await render({ libre: false, inicial: OCUPADO });
  await click(boton("Mover")!);
  await elegirDestino(4);
  await click(radios()[1]!);
  await click(btnMover()!);
  assert.ok(container.textContent?.includes("Otra persona está modificando"));
  await click(btnMover()!);
  assert.equal(movidos.length, 2);
  assert.equal(movidos[0]![3].operacionId, movidos[1]![3].operacionId);
});

test("reabrir el diálogo genera una operación NUEVA", async () => {
  await render({ libre: false, inicial: OCUPADO });
  for (let k = 0; k < 2; k++) {
    await click(boton("Mover")!);
    await elegirDestino(4);
    await click(radios()[0]!);
    await click(btnMover()!);
    await click(boton("Cerrar")!);
  }
  assert.equal(movidos.length, 2);
  assert.notEqual(movidos[0]![3].operacionId, movidos[1]![3].operacionId);
});

test("tarifa distinta: exige confirmar antes de enviar y manda la aceptación", async () => {
  await render({ libre: false, inicial: OCUPADO });
  await click(boton("Mover")!);
  await elegirDestino(5);
  await click(radios()[1]!);
  assert.ok(container.textContent?.includes("La tarifa neta del record destino es distinta"));
  assert.equal(btnMover()!.disabled, true, "sin confirmar la tarifa no se envía");
  await click(container.querySelector("input[type=checkbox]")!);
  await click(btnMover()!);
  assert.equal(movidos[0]![3].aceptaTarifaDistinta, true);
});

test("si la base detecta tarifa distinta, aparece la confirmación", async () => {
  respuestasMover = [{ ok: false, error: "La tarifa neta del record destino es distinta.", requiereConfirmarTarifa: true }];
  await render({ libre: false, inicial: OCUPADO });
  await click(boton("Mover")!);
  await elegirDestino(4);
  await click(radios()[0]!);
  await click(btnMover()!);
  assert.ok(container.querySelector("input[type=checkbox]"), "muestra la casilla de confirmación");
  assert.equal(btnMover()!.disabled, true);
});

const opcion = (id: number) => container.querySelector(`option[value="${id}"]`) as HTMLOptionElement;

test("D3-c contrato del sistema: records con otras fechas aparecen deshabilitados y se explica la regla", async () => {
  await render({ libre: false, inicial: OCUPADO, contratoOrganico: true });
  await click(boton("Mover")!);
  assert.equal(opcion(6).disabled, true, "otras fechas: no se puede elegir");
  assert.match(opcion(6).textContent ?? "", /otras fechas \(no permitido para este contrato\)/);
  assert.equal(opcion(4).disabled, false, "mismas fechas: sí");
  assert.ok(container.textContent?.includes("solo a un record con las mismas fechas de ida y regreso"));
});

for (const [i, modo] of [[0, "solo_datos"], [1, "con_cupo"]] as const) {
  test(`D3-c contrato manual (${modo}): también se ofrecen records con otras fechas y se pueden elegir`, async () => {
    respuestasMover = [{ ok: true, repetida: false, movidas: 1, contrato: null, avisoTarifaDistinta: false, avisoRecordContrato: false, tramosActualizados: 0, contratoManual: true }];
    await render({ libre: false, inicial: OCUPADO, contratoOrganico: false });
    await click(boton("Mover")!);
    assert.equal(opcion(6).disabled, false);
    assert.ok(!container.textContent?.includes("solo a un record con las mismas fechas"));
    await elegirDestino(6);
    await click(radios()[i]!);
    await click(btnMover()!);
    assert.deepEqual([movidos[0]![2], movidos[0]![3].modo], [6, modo]);
    assert.ok(!container.textContent?.includes("Se actualizó el vuelo del contrato"), "con manual no se reescribe el vuelo");
  });
}

test("tras mover un contrato del sistema, informa los tramos del vuelo actualizados", async () => {
  respuestasMover = [{ ok: true, repetida: false, movidas: 2, contrato: "DTM-0451", avisoTarifaDistinta: false, avisoRecordContrato: false, tramosActualizados: 2, contratoManual: false }];
  await render({ libre: false, inicial: OCUPADO, contratoOrganico: true });
  await click(boton("Mover")!);
  await elegirDestino(4);
  await click(radios()[1]!);
  await click(btnMover()!);
  assert.ok(container.textContent?.includes("2 silla(s) movida(s) del contrato DTM-0451"));
  assert.ok(container.textContent?.includes("Se actualizó el vuelo del contrato (2 tramo(s))"));
  assert.ok(!container.textContent?.includes("todavía muestra el PNR"));
});

test("contrato manual que resuelve a una venta: solo se avisa del PNR anterior", async () => {
  respuestasMover = [{ ok: true, repetida: false, movidas: 1, contrato: "MIN-00-0900", avisoTarifaDistinta: false, avisoRecordContrato: true, tramosActualizados: 0, contratoManual: true }];
  await render({ libre: false, inicial: OCUPADO, contratoOrganico: false });
  await click(boton("Mover")!);
  await elegirDestino(4);
  await click(radios()[0]!);
  await click(btnMover()!);
  assert.ok(container.textContent?.includes("todavía muestra el PNR del record anterior"));
});

test("Borrar pide confirmación, avisa que quita la referencia de contrato y llama a borrarPasajeroSilla", async () => {
  const mensajes: string[] = [];
  (globalThis as unknown as { confirm: (m: string) => boolean }).confirm = (m: string) => { mensajes.push(m); return true; };
  await render({ libre: false, inicial: OCUPADO });
  await click(boton("Borrar")!);
  assert.deepEqual(borrados, [[7, 3]]);
  assert.match(mensajes[0] ?? "", /quita de la silla la referencia de contrato \(también la manual\)/);
});

test("Borrar cancelado no llama a la acción", async () => {
  (globalThis as unknown as { confirm: () => boolean }).confirm = () => false;
  await render({ libre: false, inicial: OCUPADO });
  await click(boton("Borrar")!);
  assert.deepEqual(borrados, []);
});

// Todos los .ts/.tsx de app/, components/ y lib/ (sin node_modules/.next).
const RAIZ = join(fileURLToPath(new URL(".", import.meta.url)), "..");
function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : fuentes(ruta);
    return /\.(tsx?)$/.test(nombre) ? [ruta] : [];
  });
}

test("libre es obligatoria en el componente (sin ? ni valor por defecto)", () => {
  const comp = readFileSync(new URL("../app/(dashboard)/dashboard/vuelos/[id]/PasajeroAcciones.tsx", import.meta.url), "utf8");
  assert.match(comp, /^\s*libre: boolean;$/m, "el tipo debe declarar libre: boolean (sin ?)");
  assert.doesNotMatch(comp, /libre\s*=\s*(false|true)\s*,/, "sin valor por defecto en la desestructuración");
  assert.match(comp, /useState<ModoMover \| null>\(null\)/, "el modo arranca sin elegir");
});

test("todos los usos de <PasajeroAcciones en el repo pasan libre", () => {
  const usos: string[] = [];
  for (const ruta of ["app", "components", "lib"].flatMap((d) => fuentes(join(RAIZ, d)))) {
    const src = readFileSync(ruta, "utf8");
    let i = src.indexOf("<PasajeroAcciones");
    while (i !== -1) {
      const elemento = src.slice(i, src.indexOf("/>", i));
      usos.push(relative(RAIZ, ruta));
      assert.match(elemento, /\blibre=\{/, `${relative(RAIZ, ruta)} usa <PasajeroAcciones sin libre`);
      i = src.indexOf("<PasajeroAcciones", i + 1);
    }
  }
  assert.ok(usos.length >= 1, "debe existir al menos un uso");
});

test("la página calcula libre con esSillaLibre y el contrato manual real, y ofrece solo records compatibles", () => {
  const page = readFileSync(new URL("../app/(dashboard)/dashboard/vuelos/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /import \{ esSillaLibre \} from "@\/lib\/vuelos\/sillaLibre";/);
  assert.match(page, /const libreSilla = \(s: \(typeof activas\)\[number\]\) => esSillaLibre\(\{ \.\.\.s, contrato_manual: contratoManualPorSilla\.get\(s\.id\) \?\? null \}\);/);
  const inicio = page.indexOf("<PasajeroAcciones");
  const bloque = page.slice(inicio, page.indexOf("/>", inicio));
  assert.match(bloque, /libre=\{libreSilla\(s\)\}/);
  assert.match(bloque, /otros=\{destinosCompatibles\}/, "solo records compatibles");
  assert.match(bloque, /contratoOrganico=\{!!s\.numero_contrato\}/, "D3-c: la página indica si la silla tiene contrato del sistema");
  // D3-c: "mismas fechas" se calcula en el filtro puro (lib/vuelos/compatibles.ts).
  assert.match(page, /const destinosCompatibles = describirDestinos\(b, compatibles, libresPorRecord\);/);
  const compat = readFileSync(new URL("../lib/vuelos/compatibles.ts", import.meta.url), "utf8");
  assert.match(compat, /mismasFechas: \(o\.fecha_ida \?\? null\) === \(origen\.fecha_ida \?\? null\) && \(o\.fecha_regreso \?\? null\) === \(origen\.fecha_regreso \?\? null\)/);
  assert.match(page, /\{activas\.map\(\(s\) => \(/, "la tabla lista solo sillas activas (sin cambio ni retirada)");
});
