// Se ejecuta con npm run test:react. Interfaz de servicios/traslados (#421): control de hora de 24 h, pestañas, filtro por destino, listado y aviso de servicios sin vigencia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
for (const k of ["HTMLElement", "Element", "Node", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent", "KeyboardEvent"] as const) (global as never as Record<string, unknown>)[k] = (dom.window as never as Record<string, unknown>)[k];
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;
const { HoraInput24 } = await import("../components/ui/HoraInput24.tsx");
const { ServiciosClient } = await import("../app/(dashboard)/dashboard/producto/servicios/ServiciosClient.tsx");

async function montar(el: React.ReactElement) {
  const cont = document.createElement("div");
  document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(el); });
  return { cont, root };
}
const cambiar = async (sel: HTMLSelectElement, v: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
    set.call(sel, v);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
};

test("HoraInput24: hora de 24 h en dos listas, sin AM/PM, con 24:00 solo si se permite", async () => {
  let valor = "";
  const { cont, root } = await montar(h(HoraInput24, { etiqueta: "Hora de llegada", value: valor, onChange: (v: string) => { valor = v; } }));
  const [hh, mm] = [...cont.querySelectorAll("select")] as HTMLSelectElement[];
  assert.equal(mm.disabled, true, "los minutos esperan la hora");
  assert.equal([...hh.options].some((o) => o.value === "24"), false);
  assert.equal([...hh.options].filter((o) => o.value).length, 24);
  await cambiar(hh, "19");
  assert.equal(valor, "19:00");
  await act(async () => { root.render(h(HoraInput24, { etiqueta: "Hora de llegada", value: valor, onChange: (v: string) => { valor = v; } })); });
  await cambiar(([...cont.querySelectorAll("select")] as HTMLSelectElement[])[1], "45");
  assert.equal(valor, "19:45");
  assert.ok(cont.querySelector('[role="group"][aria-label="Hora de llegada"]'));
  await act(async () => root.unmount());
});

test("HoraInput24 permite24: «24:00» como fin de franja", async () => {
  let valor = "";
  const { cont, root } = await montar(h(HoraInput24, { etiqueta: "Hasta", permite24: true, value: valor, onChange: (v: string) => { valor = v; } }));
  await cambiar(cont.querySelector("select") as HTMLSelectElement, "24");
  assert.equal(valor, "24:00");
  await act(async () => root.unmount());
});

const vig = (id: number, servicio_id: number, nombre: string, ini: string | null, fin: string | null, extra = {}) =>
  ({ id, servicio_id, nombre, fecha_inicio: ini, fecha_fin: fin, compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 45000, recargo_individual: null, grupos: [], franjas: [], ...extra });
const base = { temporada: null, precio_persona: 99999, proveedor_id: null, alcance: "nacional", rangos_edad: null, moneda: "COP", categoria: "tour_traslado", proveedores: null, servicio_tarifa_pax: [] };
const servicios = [
  { ...base, id: 1, nombre: "Traslado aeropuerto", destino_id: 10, destinos: { nombre: "CARTAGENA" } },
  { ...base, id: 2, nombre: "Tour Islas", destino_id: 11, destinos: { nombre: "SANTA MARTA" } },
  { ...base, id: 3, nombre: "Tour sin fechas", destino_id: 10, destinos: { nombre: "CARTAGENA" } },
];
const temporadas = {
  1: [vig(1, 1, "ALTA", "2026-12-01", "2027-01-15", { franjas: [{ id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 30000, cobro: "grupo" }] })],
  2: [vig(2, 2, "BAJA", "2026-03-01", "2026-04-01")],
  3: [vig(3, 3, "SIN FECHAS", null, null)],
};
const props = { servicios, proveedores: [], destinos: [{ id: 10, nombre: "CARTAGENA", codigo_iata: "CTG" }, { id: 11, nombre: "SANTA MARTA", codigo_iata: "SMR" }], rangos: [], temporadas };

test("Servicios: lista los servicios sin rango de fechas, pestañas, filtro por destino y nota de suplemento", async () => {
  const { cont, root } = await montar(h(ServiciosClient as never, props as never));
  const tabs = [...cont.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim());
  assert.deepEqual(tabs, ["Listado", "Configuración"]);
  const texto = () => document.body.textContent ?? "";
  assert.match(texto(), /Servicios sin rango de fechas/);
  const dialogo = document.querySelector('[role="dialog"]');
  assert.ok(dialogo?.textContent?.includes("Tour sin fechas"));
  assert.equal(dialogo?.textContent?.includes("Traslado aeropuerto"), false);
  // listado: la nota de suplemento solo en el servicio con franjas; el precio base histórico (99.999) no se muestra
  assert.equal((texto().match(/Tiene suplemento por horario/g) ?? []).length, 1);
  assert.equal(/99\.999/.test(texto()), false);
  // filtro por destino
  const filtro = cont.querySelector('select[aria-label="Filtrar por destino"]') as HTMLSelectElement;
  await cambiar(filtro, "11");
  const items = [...cont.querySelectorAll("ul.divide-y > li")].map((l) => l.textContent ?? "");
  assert.equal(items.length, 1);
  assert.match(items[0], /Tour Islas/);
  await act(async () => root.unmount());
});

test("Servicios: la pestaña Configuración muestra el formulario y ya no dice «vacío usa la base»", async () => {
  const { cont, root } = await montar(h(ServiciosClient as never, props as never));
  const tab = [...cont.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes("Configuración")) as HTMLElement;
  await act(async () => { tab.click(); });
  assert.match(cont.textContent ?? "", /Nuevo servicio adicional/);
  assert.equal(/usa la base|usa el base/i.test(cont.textContent ?? ""), false);
  await act(async () => root.unmount());
});
