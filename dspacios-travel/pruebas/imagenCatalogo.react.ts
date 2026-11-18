// Catalog photo (Programas cover / Receptivo photo): loading priority, single failure = single placeholder (no retry),
// recovery when the source changes, and the pre-hydration failure case. jsdom + the real component.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { ImagenCatalogo } = await import("../components/ImagenCatalogo.tsx");
after(() => dom.window.close());

async function montar(props: Record<string, unknown>) {
  const c = document.createElement("div"); document.body.append(c);
  const root = createRoot(c);
  await act(async () => root.render(h(ImagenCatalogo, props as never)));
  return { c, root, render: (p: Record<string, unknown>) => act(async () => root.render(h(ImagenCatalogo, p as never))), fin: () => act(async () => root.unmount()) };
}

test("below the fold: lazy, async decoding, no priority hint; the first image is eager + high priority", async () => {
  const a = await montar({ src: "https://img.test/a.jpg", alt: "A" });
  const ia = a.c.querySelector("img")!;
  assert.equal(ia.getAttribute("loading"), "lazy");
  assert.equal(ia.getAttribute("decoding"), "async");
  assert.equal(ia.getAttribute("fetchpriority"), "auto");
  const b = await montar({ src: "https://img.test/b.jpg", alt: "B", prioridad: true });
  const ib = b.c.querySelector("img")!;
  assert.equal(ib.getAttribute("loading"), "eager");
  assert.equal(ib.getAttribute("fetchpriority"), "high");
  await a.fin(); await b.fin();
});

test("no src → «Sin foto», no <img>", async () => {
  const m = await montar({ src: null, alt: "x" });
  assert.equal(m.c.querySelectorAll("img").length, 0);
  assert.ok(m.c.textContent?.includes("Sin foto"));
  await m.fin();
});

test("a failed image is replaced by «Sin foto» once; a repeated error event cannot re-create it (no retry)", async () => {
  const m = await montar({ src: "https://img.test/roto.jpg", alt: "R" });
  const img = m.c.querySelector("img")!;
  await act(async () => { img.dispatchEvent(new dom.window.Event("error")); });
  assert.equal(m.c.querySelectorAll("img").length, 0, "the broken <img> is gone");
  assert.ok(m.c.textContent?.includes("Sin foto"));
  await m.render({ src: "https://img.test/roto.jpg", alt: "R" });                 // parent re-render with the same src
  assert.equal(m.c.querySelectorAll("img").length, 0, "same failing src is not requested again");
  await m.render({ src: "https://img.test/otra.jpg", alt: "R" });                  // a different src gets a fresh chance
  assert.equal(m.c.querySelector("img")?.getAttribute("src"), "https://img.test/otra.jpg");
  await m.fin();
});

test("an <img> that already failed before hydration (complete && naturalWidth 0) is detected on mount", async () => {
  Object.defineProperty(dom.window.HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
  Object.defineProperty(dom.window.HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 0 });
  const m = await montar({ src: "https://img.test/antes.jpg", alt: "P" });
  assert.equal(m.c.querySelectorAll("img").length, 0);
  assert.ok(m.c.textContent?.includes("Sin foto"));
  await m.fin();
  delete (dom.window.HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
  delete (dom.window.HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
});
