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
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { DateInput } = await import("../components/ui/DateInput.tsx");
const { act, createElement: h } = React;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render(props: React.ComponentProps<typeof DateInput>) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(h("form", {}, h(DateInput, { "aria-label": "Fecha prueba", ...props }))));
}
const input = () => container.querySelector<HTMLInputElement>('input[type="text"]')!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});
after(() => dom.window.close());

test("typed local date emits ISO and named FormData keeps ISO", async () => {
  const changes: string[] = [];
  await render({ name: "fecha", onValueChange: (value) => changes.push(value) });
  await type("24/09/2026");
  assert.deepEqual(changes, ["2026-09-24"]);
  assert.equal(new dom.window.FormData(container.querySelector("form")!).get("fecha"), "2026-09-24");
});
test("incomplete or impossible dates clear the stored value and invalidate the field", async () => {
  await render({ name: "fecha", defaultValue: "2026-09-24" });
  await type("31/02/2026");
  assert.equal(input().validity.valid, false);
  assert.equal(new dom.window.FormData(container.querySelector("form")!).get("fecha"), "");
  await type("23/09/");
  assert.equal(input().value, "23/09/");
  assert.equal(input().validity.valid, false);
});
test("bounds are inclusive and dynamic min revalidates the current date", async () => {
  await render({ value: "2026-09-23", min: "2026-09-23", max: "2026-09-23" });
  assert.equal(input().validity.valid, true);
  await render({ value: "2026-09-23", min: "2026-09-24" });
  assert.equal(input().validity.valid, false);
});
test("a passenger lookup updates the same mounted birth-date control", async () => {
  await render({ value: "1980-02-29" });
  assert.equal(input().value, "29/02/1980");
  await render({ value: "1975-06-15" });
  assert.equal(input().value, "15/06/1975");
});
test("GET form defaultValue and reset restore the original month", async () => {
  await render({ name: "mes", type: "month", defaultValue: "2026-09" });
  await type("10/2026");
  assert.equal(new dom.window.FormData(container.querySelector("form")!).get("mes"), "2026-10");
  await act(async () => container.querySelector("form")!.reset());
  assert.equal(input().value, "09/2026");
  assert.equal(new dom.window.FormData(container.querySelector("form")!).get("mes"), "2026-09");
});
test("disabled and readOnly calendars cannot be opened", async () => {
  await render({ disabled: true, value: "2026-09-23" });
  assert.equal(container.querySelector<HTMLButtonElement>("button")!.disabled, true);
  await render({ readOnly: true, value: "2026-09-23" });
  assert.equal(input().readOnly, true);
  assert.equal(container.querySelector<HTMLButtonElement>("button")!.disabled, true);
});
test("real day-grid respects disabled days and selection emits exactly one value", async () => {
  const changes: string[] = [];
  await render({ value: "2026-09-23", min: "2026-09-23", max: "2026-09-25", onValueChange: v => changes.push(v) });
  await click(container.querySelector("button")!);
  const days = [...document.querySelectorAll<HTMLButtonElement>('.rdp-day_button')];
  const day22 = days.find(el => el.getAttribute("aria-label")?.includes("22 de septiembre"));
  const day24 = days.find(el => el.getAttribute("aria-label")?.includes("24 de septiembre"));
  assert.ok(day22?.disabled);
  assert.ok(day24 && !day24.disabled);
  await click(day24);
  assert.deepEqual(changes, ["2026-09-24"]);
  assert.equal(container.querySelector("button")!.getAttribute("aria-expanded"), "false");
});
test("calendar clear preserves required validation", async () => {
  await render({ defaultValue: "2026-09-23", required: true });
  await click(container.querySelector("button")!);
  const clear = [...document.querySelectorAll("button")].find(el => el.textContent === "Limpiar");
  assert.ok(clear);
  await click(clear);
  assert.equal(input().value, "");
  assert.equal(input().validity.valueMissing, true);
});
async function blur() {
  await act(async () => { input().dispatchEvent(new dom.window.FocusEvent("blur", { bubbles: false })); input().dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true })); });
}
const formData = (k: string) => new dom.window.FormData(container.querySelector("form")!).get(k);

test("#15 escritura progresiva de 09052026: ningún valor intermedio (090520 = 2020) se emite", async () => {
  const changes: string[] = [];
  await render({ name: "fecha", onValueChange: (v) => changes.push(v) });
  for (let i = 1; i <= 8; i++) await type("09052026".slice(0, i));
  assert.deepEqual(changes.filter(Boolean), ["2026-05-09"]);
  assert.equal(formData("fecha"), "2026-05-09");
  await blur();
  assert.equal(input().value, "09/05/2026");
  assert.equal(input().validity.valid, true);
});
test("#15 DDMMAA y DD/MM/AA se confirman al salir del campo y se muestran dd/mm/aaaa", async () => {
  const changes: string[] = [];
  await render({ name: "fecha", onValueChange: (v) => changes.push(v) });
  await type("090526");
  assert.equal(formData("fecha"), "");
  await blur();
  assert.equal(formData("fecha"), "2026-05-09");
  assert.equal(input().value, "09/05/2026");
  await type("09/10/26");
  await blur();
  assert.equal(formData("fecha"), "2026-10-09");
  assert.equal(changes.at(-1), "2026-10-09");
});
test("#15 Enter confirma el año corto (envío sin salir del campo)", async () => {
  await render({ name: "fecha" });
  await type("200526");
  await act(async () => { input().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  assert.equal(formData("fecha"), "2026-05-20");
});
test("#15 pegar una fecha imposible no se normaliza a otro día y deja el campo inválido", async () => {
  await render({ name: "fecha", defaultValue: "2026-09-24" });
  await type("31042026");
  await blur();
  assert.equal(formData("fecha"), "");
  assert.equal(input().value, "31042026");
  assert.equal(input().validity.valid, false);
  await type("290225");
  await blur();
  assert.equal(formData("fecha"), "");
});
test("#15 nacimiento con año corto respeta max (no se fuerza a futuro ni a pasado)", async () => {
  await render({ name: "nac", max: "2026-11-12" });
  await type("150385");
  await blur();
  assert.equal(formData("nac"), "1985-03-15");
  assert.equal(input().validity.valid, true);
});

// #15 — envío real: el formulario debe llevar la fecha ISO, no "", tanto con Enter como con clic en Guardar.
// Entre la acción del usuario y el envío solo se deja correr una microtarea (lo que el navegador
// permite a React antes de la acción por defecto), no un `act` que lo vacíe todo.
async function montarFormulario(controlado: boolean) {
  const envios: { payload: string | null; estado?: string }[] = [];
  let estado = "";
  function Controlado() {
    const [v, setV] = React.useState("");
    estado = v;
    return h(DateInput, { "aria-label": "Fecha prueba", name: "fecha", required: true, value: v, onValueChange: setV });
  }
  const campo = controlado ? h(Controlado) : h(DateInput, { "aria-label": "Fecha prueba", name: "fecha", required: true });
  const onSubmit = (e: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    envios.push({ payload: new dom.window.FormData(e.currentTarget).get("fecha") as string | null, estado: controlado ? estado : undefined });
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h("form", { onSubmit }, campo, h("button", { type: "submit" }, "Guardar"))));
  return envios;
}
const guardar = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Guardar")!;
async function enviarConEnter() {
  await act(async () => {
    input().focus();
    input().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    container.querySelector("form")!.requestSubmit(); // envío implícito del navegador tras el keydown
  });
}
async function enviarConClic() {
  await act(async () => {
    input().focus();
    guardar().focus(); // el puntero mueve el foco al botón: el campo recibe blur antes del click
    await Promise.resolve();
    guardar().click();
  });
}
for (const controlado of [false, true]) {
  const modo = controlado ? "controlado" : "no controlado";
  for (const [texto, iso] of [["090526", "2026-05-09"], ["09/05/26", "2026-05-09"], ["09052026", "2026-05-09"], ["09/05/2026", "2026-05-09"]] as const) {
    test(`#15 envío con Enter (${modo}, ${texto}) lleva ${iso}`, async () => {
      const envios = await montarFormulario(controlado);
      await type(texto);
      await enviarConEnter();
      assert.equal(envios.length, 1);
      assert.equal(envios[0].payload, iso);
      if (controlado) assert.equal(envios[0].estado, iso);
    });
    test(`#15 envío con clic en Guardar (${modo}, ${texto}) lleva ${iso}`, async () => {
      const envios = await montarFormulario(controlado);
      await type(texto);
      await enviarConClic();
      assert.equal(envios.length, 1);
      assert.equal(envios[0].payload, iso);
      if (controlado) assert.equal(envios[0].estado, iso);
      assert.equal(input().value, "09/05/2026");
    });
  }
  test(`#15 fecha imposible (${modo}) no se envía: el campo bloquea el formulario`, async () => {
    const envios = await montarFormulario(controlado);
    await type("310426");
    await enviarConClic();
    assert.equal(envios.length, 0);
    assert.equal(input().validity.valid, false);
  });
}
test("#15 ventana aprobada: el año corto se muestra completo antes de guardar (56 → 2056, 57 → 1957)", async () => {
  const anio = new Date().getFullYear();
  const corto = (a: number) => String(a).slice(-2);
  await render({ name: "fecha" });
  await type(`0101${corto(anio + 30)}`);
  await blur();
  assert.equal(input().value, `01/01/${anio + 30}`);
  assert.equal(formData("fecha"), `${anio + 30}-01-01`);
  await type(`01/01/${corto(anio + 31)}`);
  await blur();
  assert.equal(input().value, `01/01/${anio + 31 - 100}`);
  assert.equal(formData("fecha"), `${anio + 31 - 100}-01-01`);
});
