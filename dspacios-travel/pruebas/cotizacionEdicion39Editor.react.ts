// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #39 fase 1 — editores REALES de la ficha de cotización:
//   · ServiciosCotizacionEditor: total en vivo (servicios + niños/recobro que se
//     conservan), no guarda sin servicios, sin cambios ni sin motivo; guarda con
//     la revisión que leyó la ficha y el motivo recortado; muestra el rechazo.
//   · RecobroNinosEditor: exige motivo y manda la revisión.
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "../manual-actions": datos(`
    export async function editarServiciosCotizacionManual(...a) { globalThis.__ed.llamadas.push(['servicios', a]); return globalThis.__ed.resp(a); }
    export async function actualizarRecobroNinosCotizacionManual(...a) { globalThis.__ed.llamadas.push(['recobro', a]); return globalThis.__ed.resp(a); }
  `),
  "next/navigation": datos("export function useRouter() { return { refresh() { globalThis.__ed.refrescos++; }, push() {}, replace() {} }; }"),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FRONTERAS[specifier]) return { url: FRONTERAS[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/dashboard/cotizaciones/77" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const ed = {
  llamadas: [] as [string, unknown[]][], refrescos: 0,
  resp: (a: unknown[]): unknown => { void a; return { ok: true, rev: 9 }; },
};
(globalThis as unknown as { __ed: typeof ed }).__ed = ed;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ServiciosCotizacionEditor } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/ServiciosCotizacionEditor.tsx");
const { RecobroNinosEditor } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/RecobroNinosEditor.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.(); desmontar = undefined;
  ed.llamadas.length = 0; ed.refrescos = 0;
  ed.resp = () => ({ ok: true, rev: 9 });
});
after(() => dom.window.close());

async function montar(elemento: unknown) {
  const c = document.createElement("div");
  document.body.append(c);
  const raiz = createRoot(c);
  await React.act(async () => raiz.render(elemento as never));
  desmontar = async () => { await React.act(async () => raiz.unmount()); c.remove(); };
  return c;
}
const pulsar = async (el: Element) => { await React.act(async () => { (el as HTMLElement).click(); await new Promise((r) => setImmediate(r)); }); };
async function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  await React.act(async () => { el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
}
const boton = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "") || texto.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement | undefined;
const numero = (n: number) => new Intl.NumberFormat("es-CO").format(n);

const INICIAL = [
  { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo", proveedor: "Avianca", costoNeto: 800000, modo: "mk" as const, pctMarkup: 20, ta: 0 },
  { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "HA", costoNeto: 400000, modo: "mk" as const, pctMarkup: 20, ta: 0 },
];
const props = { id: 77, moneda: "COP", revEsperada: 5, extrasTotal: 150_000, inicial: INICIAL };

test("servicios: el total en vivo conserva niños y recobro; guarda con revisión y motivo recortado", async () => {
  const raiz = await montar(h(ServiciosCotizacionEditor, props));
  await pulsar(boton(raiz, /Editar/)!);
  const total = () => raiz.querySelector("[data-total-nuevo]")?.textContent ?? "";
  assert.ok(total().includes(numero(1_500_000 + 150_000)), `total inicial: ${total()}`);
  const costo = raiz.querySelectorAll<HTMLInputElement>('input[type="number"]')[2]; // costo del hotel (segunda fila)
  await escribir(costo, "560000");
  assert.ok(total().includes(numero(1_000_000 + 700_000 + 150_000)), `total tras cambiar el hotel: ${total()}`);

  await pulsar(boton(raiz, /Guardar servicios/)!);
  assert.equal(ed.llamadas.length, 0, "sin motivo no guarda");
  assert.match(raiz.textContent ?? "", /motivo del cambio/i);

  await escribir(raiz.querySelector("textarea")!, "  el cliente cambió de hotel ");
  await pulsar(boton(raiz, /Guardar servicios/)!);
  assert.equal(ed.llamadas.length, 1);
  const [tipo, args] = ed.llamadas[0];
  assert.equal(tipo, "servicios");
  assert.equal(args[0], 77);
  const entrada = args[1] as { revEsperada: number; motivo: string; servicios: Record<string, unknown>[] };
  assert.equal(entrada.revEsperada, 5);
  assert.equal(entrada.motivo, "el cliente cambió de hotel");
  assert.equal(entrada.servicios.length, 2);
  assert.equal(entrada.servicios[1].costoNeto, 560000);
  assert.equal("_id" in entrada.servicios[0], false, "no viaja el id interno del formulario");
  assert.equal(ed.refrescos, 1);
});

test("servicios: sin cambios o sin servicios no llama a la acción", async () => {
  const raiz = await montar(h(ServiciosCotizacionEditor, props));
  await pulsar(boton(raiz, /Editar/)!);
  await escribir(raiz.querySelector("textarea")!, "motivo");
  await pulsar(boton(raiz, /Guardar servicios/)!);
  assert.match(raiz.textContent ?? "", /No hay cambios/);
  for (const b of [...raiz.querySelectorAll('button[aria-label="Quitar servicio"]')]) await pulsar(b);
  await pulsar(boton(raiz, /Guardar servicios/)!);
  assert.match(raiz.textContent ?? "", /al menos un servicio/);
  assert.equal(ed.llamadas.length, 0);
});

test("servicios: agregar uno y mostrar el rechazo de la base", async () => {
  ed.resp = () => ({ ok: false, error: "La cotización cambió mientras la editabas: recarga la página y vuelve a intentarlo." });
  const raiz = await montar(h(ServiciosCotizacionEditor, props));
  await pulsar(boton(raiz, /Editar/)!);
  await pulsar(boton(raiz, /^\s*Traslado\s*$/)!);
  const filas = raiz.querySelectorAll("[data-servicio]");
  assert.equal(filas.length, 3);
  // Una fila nueva vacía no es un cambio (mismo criterio que la creación): se completa.
  const [, nombre] = filas[2].querySelectorAll<HTMLInputElement>("input");
  await escribir(nombre, "Traslado aeropuerto");
  await escribir(filas[2].querySelectorAll<HTMLInputElement>('input[type="number"]')[0], "80000");
  await escribir(raiz.querySelector("textarea")!, "agrego traslado");
  await pulsar(boton(raiz, /Guardar servicios/)!);
  assert.equal(ed.llamadas.length, 1);
  assert.match(raiz.querySelector('[role="alert"]')?.textContent ?? "", /recarga/);
  assert.equal(ed.refrescos, 0);
});

test("niños y recobro: exige motivo y manda la revisión", async () => {
  ed.resp = () => ({ ok: true });
  const raiz = await montar(h(RecobroNinosEditor, {
    id: 77, moneda: "COP", esB2B: false, pctAliadoB2B: 0.5, revEsperada: 4,
    inicial: { ninos: 0, tarifaNino: 0, recobro: 0, recobroAliado: 0 },
  }));
  await pulsar(boton(raiz, /Editar/)!);
  const [ninos] = raiz.querySelectorAll<HTMLInputElement>('input[type="number"]');
  await escribir(ninos, "2");
  await pulsar(boton(raiz, /^Guardar$/)!);
  assert.equal(ed.llamadas.length, 0, "sin motivo no guarda");
  await escribir(raiz.querySelector("textarea")!, " niño adicional ");
  await pulsar(boton(raiz, /^Guardar$/)!);
  assert.equal(ed.llamadas.length, 1);
  const [, args] = ed.llamadas[0];
  assert.equal(args[0], 77);
  assert.deepEqual(args[2], { revEsperada: 4, motivo: "niño adicional" });
  assert.equal((args[1] as { ninos: number }).ninos, 2);
});
