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

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { SillaContrato } = await import("../app/(dashboard)/dashboard/vuelos/[id]/SillaContrato.tsx");
const { SillaEstado } = await import("../app/(dashboard)/dashboard/vuelos/[id]/SillaEstado.tsx");
const { __setImpls } = await import("./support/stubs/vuelosActionsStub.mjs");
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const quitados: unknown[][] = [];
__setImpls({ quitarContratoManual: async (...args: unknown[]) => { quitados.push(args); return { ok: true }; } });

async function render(elemento: React.ReactElement) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(elemento));
}
async function click(el: Element) {
  await act(async () => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
}
function boton(texto: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  quitados.length = 0;
});
after(() => dom.window.close());

test("con pasajero y sin contrato ofrece asignar manual, pero no retirar el cupo", async () => {
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: null, estado: "disponible", libre: false, version: "V1",
  }));
  assert.ok(boton("+ Contrato manual"));
  assert.equal(boton("retirar cupo"), undefined);
});

test("al quitar el contrato manual con pasajero reaparece la asignacion", async () => {
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: "EXT-7", estado: "confirmada", libre: false, version: "V1",
  }));
  await click(boton("quitar")!);
  await click(boton("Quitar contrato")!);
  assert.deepEqual(quitados, [[7, 3, "V1", null]], "sin pasajero: queda disponible, sin plazo");
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: null, estado: "disponible", libre: false, version: "V1",
  }));
  assert.ok(boton("+ Contrato manual"));
});

test("un estado no vendible o con contrato no ofrece cambios impropios", async () => {
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: null, estado: "devuelta", libre: false, version: "V1",
  }));
  assert.equal(boton("+ Contrato manual"), undefined);
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: "", estado: "disponible", libre: false, version: "V1",
  }));
  assert.equal(boton("+ Contrato manual"), undefined, "una referencia manual vacia sigue ocupando la columna");
  await render(h(SillaEstado, { sillaId: 7, bloqueoId: 3, estado: "disponible", sinContrato: true }));
  const opciones = [...container.querySelectorAll("option")].map((o) => o.textContent);
  assert.ok(opciones.some((o) => o?.includes("No vendida")));
  assert.ok(opciones.some((o) => o?.includes("Devuelta")));
  assert.ok(!opciones.some((o) => o?.includes("Confirmada")));
  await render(h(SillaEstado, { sillaId: 7, bloqueoId: 3, estado: "disponible", sinContrato: false }));
  assert.equal(container.querySelector("select"), null);
});

// Migración 201: una retención en plazo SIN contrato acepta contrato manual, y
// la asignación lleva la versión de la silla que mostró la pantalla.
test("retención en plazo sin contrato: ofrece asignar y manda la versión vista; si la silla cambió muestra el rechazo", async () => {
  const asignados: unknown[][] = [];
  let respuesta: { ok: boolean; error?: string } = { ok: true };
  __setImpls({ asignarContratoManual: async (...args: unknown[]) => { asignados.push(args); return respuesta; } });
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: null, estado: "en_plazo", libre: false, version: "2026-10-03T15:00:00.5+00:00",
  }));
  assert.equal(boton("retirar cupo"), undefined, "una retención no se retira como cupo libre");
  const escribir = async (valor: string) => {
    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  await click(boton("+ Contrato manual")!);
  await escribir("EXT-9");
  await click(boton("OK")!);
  assert.deepEqual(asignados, [[7, "EXT-9", 3, "2026-10-03T15:00:00.5+00:00"]]);
  respuesta = { ok: false, error: "La silla 7 cambió desde que la viste (otro usuario la editó, asignó o liberó). Recarga la página; no se asignó nada." };
  await click(boton("+ Contrato manual")!);
  await escribir("EXT-10");
  await click(boton("OK")!);
  assert.match(container.textContent ?? "", /cambió desde que la viste/);
});

test("retención VENCIDA: no ofrece asignar contrato; pide actualizar el plazo (la liberación sigue siendo manual)", async () => {
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: null, estado: "en_plazo", libre: false, version: "V1", vencida: true,
  }));
  assert.equal(boton("+ Contrato manual"), undefined, "sin botón de asignar sobre una retención vencida");
  assert.match(container.textContent ?? "", /Plazo vencido: actualízalo para asignar contrato/);
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: null, estado: "en_plazo", libre: false, version: "V1", vencida: false,
  }));
  assert.ok(boton("+ Contrato manual"), "con plazo vigente (hoy incluido) sí se ofrece");
});

// Migración 201: quitar un contrato manual con pasajero lo deja RETENIDO en
// plazo y pide la fecha EN la misma acción (hoy o futura en Bogotá).
async function escribirEn(selector: string, valor: string) {
  const input = container.querySelector(selector) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("quitar contrato manual con pasajero: pide el plazo, no acepta vacío ni pasado, y propone el guardado si sigue vigente", async () => {
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: "EXT-7", estado: "confirmada", libre: false, version: "V1",
    pasajero: true, plazo: "2026-09-30", hoy: "2026-10-03",
  }));
  await click(boton("quitar")!);
  const fecha = container.querySelector('input[aria-label="Fecha de plazo"]') as HTMLInputElement;
  assert.ok(fecha, "pide la fecha de plazo en la misma acción (calendario compartido)");
  assert.equal(fecha.value, "", "un plazo guardado ya vencido no se propone");
  await click(boton("Quitar y retener")!);
  assert.match(container.textContent ?? "", /Indica la fecha de plazo/);
  await escribirEn('input[aria-label="Fecha de plazo"]', "02/10/2026");
  await click(boton("Quitar y retener")!);
  assert.match(container.textContent ?? "", /ya pasó; indica 2026-10-03/);
  assert.deepEqual(quitados, [], "con plazo vacío o pasado no llama a la base");
  await escribirEn('input[aria-label="Fecha de plazo"]', "03/10/2026");
  await click(boton("Quitar y retener")!);
  assert.deepEqual(quitados, [[7, 3, "V1", "2026-10-03"]], "el día de hoy es válido");

  await render(h(SillaContrato, {
    sillaId: 8, bloqueoId: 3, numeroContrato: null, contratoManual: "EXT-8", estado: "confirmada", libre: false, version: "V2",
    pasajero: true, plazo: "2026-10-20", hoy: "2026-10-03",
  }));
  await click(boton("quitar")!);
  assert.equal((container.querySelector('input[aria-label="Fecha de plazo"]') as HTMLInputElement).value, "20/10/2026", "propone el plazo guardado vigente");
});

test("editar contrato manual: reemplaza la referencia con la versión vista; vacío no llama; el rechazo se muestra", async () => {
  const editados: unknown[][] = [];
  let respuesta: { ok: boolean; error?: string } = { ok: true };
  __setImpls({ editarContratoManual: async (...args: unknown[]) => { editados.push(args); return respuesta; } });
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: null, contratoManual: "EXT-7", estado: "confirmada", libre: false, version: "V1",
    pasajero: true, plazo: null, hoy: "2026-10-03",
  }));
  await click(boton("editar")!);
  const input = container.querySelector('input[aria-label="Nuevo número de contrato manual"]') as HTMLInputElement;
  assert.equal(input.value, "EXT-7", "parte de la referencia actual");
  await escribirEn('input[aria-label="Nuevo número de contrato manual"]', "  ");
  await click(boton("Guardar")!);
  assert.deepEqual(editados, []);
  assert.match(container.textContent ?? "", /Escribe el número de contrato manual/);
  await escribirEn('input[aria-label="Nuevo número de contrato manual"]', "EXT-77");
  await click(boton("Guardar")!);
  assert.deepEqual(editados, [[7, "EXT-77", 3, "V1"]]);
  assert.equal(boton("Guardar"), undefined, "al guardar se cierra el editor");
  respuesta = { ok: false, error: "La silla 7 cambió desde que la viste (otro usuario la editó, asignó o liberó). Recarga la página; no se cambió nada." };
  await click(boton("editar")!);
  await escribirEn('input[aria-label="Nuevo número de contrato manual"]', "EXT-78");
  await click(boton("Guardar")!);
  assert.match(container.textContent ?? "", /cambió desde que la viste/);
});

test("un contrato generado por la aplicación no se edita ni se quita desde la celda", async () => {
  await render(h(SillaContrato, {
    sillaId: 7, bloqueoId: 3, numeroContrato: "00-0451", contratoManual: null, estado: "confirmada", libre: false, version: "V1",
  }));
  assert.equal(boton("editar"), undefined);
  assert.equal(boton("quitar"), undefined);
  assert.ok(container.querySelector('a[href="/dashboard/contratos/00-0451"]'));
});
