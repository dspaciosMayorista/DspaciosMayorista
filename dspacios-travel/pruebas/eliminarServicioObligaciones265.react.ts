// Se ejecuta con npm run test:react. Producto → Servicios: al eliminar un servicio que ya tiene líneas de contrato enlazadas a su cuenta por pagar (265) el rechazo se
// PRESENTA con un mensaje claro bajo la fila (antes el resultado se descartaba y el usuario no veía nada). La protección real es de la base y se prueba en
// las pruebas de base de datos del PR de migraciones; aquí se prueba la presentación y la traducción del error.
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
let confirmaciones = 0;
(dom.window as unknown as { confirm: () => boolean }).confirm = () => { confirmaciones++; return true; };
(global as unknown as { confirm: () => boolean }).confirm = (dom.window as unknown as { confirm: () => boolean }).confirm;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;
const { ServiciosClient } = await import("../app/(dashboard)/dashboard/producto/servicios/ServiciosClient.tsx");
const { __setEliminarServicio } = await import("./support/stubs/serviciosActionsStub.mjs");
const { MENSAJE_SERVICIO_CON_OBLIGACIONES, MENSAJE_SERVICIO_PUBLICADO, esRechazoServicioPublicado, mensajeErrorEliminarServicio, esRechazoServicioConObligaciones } = await import("../lib/servicios/eliminarServicio.ts");

const vig = (id: number, servicio_id: number) => ({ id, servicio_id, nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2027-01-15", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 45000, recargo_individual: null, grupos: [], franjas: [] });
const base = { temporada: null, precio_persona: null, proveedor_id: null, alcance: "nacional", rangos_edad: null, moneda: "COP", categoria: "tour_traslado", proveedores: null, servicio_tarifa_pax: [], destino_id: 10, destinos: { nombre: "CARTAGENA" } };
const props = {
  servicios: [{ ...base, id: 1, nombre: "Traslado aeropuerto" }, { ...base, id: 2, nombre: "Tour Islas" }],
  proveedores: [], destinos: [{ id: 10, nombre: "CARTAGENA", codigo_iata: "CTG" }], rangos: [], temporadas: { 1: [vig(1, 1)], 2: [vig(2, 2)] },
};

async function montar() {
  const cont = document.createElement("div");
  document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(h(ServiciosClient as never, props as never)); });
  return { cont, root };
}
const filaDe = (cont: HTMLElement, nombre: string) => [...cont.querySelectorAll("ul.divide-y > li")].find((l) => l.textContent?.includes(nombre)) as HTMLElement;
const botonEliminar = (li: HTMLElement) => [...li.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Eliminar") as HTMLButtonElement;
const pulsar = async (b: HTMLElement) => { await act(async () => { b.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); }); };

test("la base rechaza con 42501 «cuenta por pagar enlazada»: se traduce al mensaje claro; otros errores conservan su texto", () => {
  const rechazoBD = { code: "42501", message: "contrato_servicios: el alcance, el servicio y la clave de una línea con cuenta por pagar enlazada no se editan" };
  assert.equal(esRechazoServicioConObligaciones(rechazoBD), true);
  assert.equal(mensajeErrorEliminarServicio(rechazoBD), MENSAJE_SERVICIO_CON_OBLIGACIONES);
  assert.match(MENSAJE_SERVICIO_CON_OBLIGACIONES, /ya tiene obligaciones asociadas/);
  assert.match(MENSAJE_SERVICIO_CON_OBLIGACIONES, /no puede eliminarse/);
  // un 42501 de RLS (otra causa) NO se disfraza de «obligaciones»
  const rls = { code: "42501", message: 'new row violates row-level security policy for table "servicios_adicionales"' };
  assert.equal(esRechazoServicioConObligaciones(rls), false);
  assert.equal(mensajeErrorEliminarServicio(rls), rls.message);
  assert.equal(mensajeErrorEliminarServicio({ code: "23503", message: "otra FK" }), "otra FK");
  // FK de tarifario_resultado (servicio publicado): mensaje claro; otra FK conserva su texto
  const fkPublicado = { code: "23503", message: 'update or delete on table "servicios_adicionales" violates foreign key constraint "tarifario_resultado_servicio_id_fkey" on table "tarifario_resultado"' };
  assert.equal(esRechazoServicioPublicado(fkPublicado), true);
  assert.equal(mensajeErrorEliminarServicio(fkPublicado), MENSAJE_SERVICIO_PUBLICADO);
  assert.match(MENSAJE_SERVICIO_PUBLICADO, /publicado en el tarifario/);
  assert.equal(esRechazoServicioPublicado({ code: "23503", message: "otra FK" }), false);
  assert.equal(mensajeErrorEliminarServicio({}), "No se pudo eliminar el servicio.");
});

test("Servicios: al eliminar un servicio con obligaciones asociadas se ve el mensaje bajo SU fila y la otra fila queda limpia", async () => {
  __setEliminarServicio(async () => ({ ok: false, error: MENSAJE_SERVICIO_CON_OBLIGACIONES }));
  const { cont, root } = await montar();
  assert.equal(cont.querySelector('[data-testid="error-eliminar-servicio"]'), null, "sin mensaje antes de intentar");
  await pulsar(botonEliminar(filaDe(cont, "Traslado aeropuerto")));
  assert.equal(confirmaciones >= 1, true);
  const aviso = cont.querySelector('[data-testid="error-eliminar-servicio"]');
  assert.ok(aviso, "se presenta el rechazo");
  assert.equal(aviso!.getAttribute("role"), "alert");
  assert.equal(aviso!.textContent, MENSAJE_SERVICIO_CON_OBLIGACIONES);
  assert.equal(cont.querySelectorAll('[data-testid="error-eliminar-servicio"]').length, 1, "solo bajo el servicio intentado");
  assert.ok(cont.textContent?.includes("Traslado aeropuerto"), "el servicio sigue en la lista");
  await act(async () => root.unmount());
  cont.remove();
});

test("Servicios: un intento posterior que sí se elimina limpia el aviso anterior", async () => {
  let intento = 0;
  __setEliminarServicio(async () => (++intento === 1 ? { ok: false, error: MENSAJE_SERVICIO_CON_OBLIGACIONES } : { ok: true }));
  const { cont, root } = await montar();
  await pulsar(botonEliminar(filaDe(cont, "Tour Islas")));
  assert.ok(cont.querySelector('[data-testid="error-eliminar-servicio"]'));
  await pulsar(botonEliminar(filaDe(cont, "Tour Islas")));
  assert.equal(cont.querySelector('[data-testid="error-eliminar-servicio"]'), null);
  await act(async () => root.unmount());
  cont.remove();
});
