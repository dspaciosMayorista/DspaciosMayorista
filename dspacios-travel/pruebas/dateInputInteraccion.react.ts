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
