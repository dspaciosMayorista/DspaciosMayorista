// Se ejecuta con npm run test:react (loader del arnés + jsdom).
// #25 — Interfaz REAL de Aliados: «Ver historial» carga UNA vez al pulsar (nada al abrir la fila), muestra quién/cuándo/origen/campos,
// el estado vacío, y el mensaje de rol sin acceso. Las acciones de servidor se sustituyen por un doble que cuenta las llamadas.
import { montar, clic, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions" && /AliadosClient/.test(context.parentURL ?? "")) {
      return { url: `data:text/javascript,${encodeURIComponent(`
        export async function crearAliado() { return { ok: true }; }
        export async function actualizarAliado() { return { ok: true }; }
        export async function eliminarAliado() { return { ok: true }; }
        export async function historialCambiosAliado(id) { globalThis.__h25.llamadas.push(id); return globalThis.__h25.resp(id); }
      `)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const h25 = { llamadas: [] as number[], resp: (_id: number): unknown => ({ ok: true, lineas: [] }) };
(globalThis as unknown as { __h25: typeof h25 }).__h25 = h25;

const React = await import("react");
const { AliadosClient } = await import("../app/(dashboard)/dashboard/aliados/AliadosClient.tsx");
const h = React.createElement;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; h25.llamadas.length = 0; h25.resp = () => ({ ok: true, lineas: [] }); });
after(() => dom.window.close());

const ALIADO = { id: 7, nombre: "Laura Gómez", tipo: "freelance", nit: "123", tipo_documento: "CC", direccion: null, contacto: null, email: null, telefono: null,
  pct_comision: null, aplica_retencion: false, pct_retencion: 0, banco: null, tipo_cuenta: null, numero_cuenta: null, activo: true };
async function abrir() {
  usarBD({});
  const m = await montar(h(AliadosClient, { aliados: [ALIADO], defAgencia: 0.12, defFreelance: 0.11 } as never));
  desmontar = m.desmontar;
  const flecha = [...m.contenedor.querySelectorAll("tbody button")].find((b) => b.querySelector("svg"));
  await clic(flecha, "abrir la fila");
  return m.contenedor;
}
const verHistorial = (raiz: Element) => [...raiz.querySelectorAll("button")].find((b) => /Ver historial/.test(txt(b)));

test("abrir la fila NO pide el historial; pulsar «Ver historial» lo pide una sola vez y lo muestra", async () => {
  h25.resp = () => ({ ok: true, lineas: [
    { id: 11, fecha: "2026-11-05T10:00:00Z", actor: "Laura", rol: "freelance", origen: "portal", accion: "Cambio", cambios: [{ campo: "Teléfono", antes: "3001112222", despues: "3009998888" }] },
    { id: 9, fecha: "2026-11-02T15:00:00Z", actor: "Ana Gerente", rol: "gerencia", origen: "interno", accion: "Cambio", cambios: [{ campo: "% de comisión", antes: "12 %", despues: "10 %" }] },
  ] });
  const raiz = await abrir();
  assert.equal(h25.llamadas.length, 0, "abrir la fila no lee la auditoría");
  await clic(verHistorial(raiz), "Ver historial");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.deepEqual(h25.llamadas, [7], "una sola lectura, de ESTA ficha");
  const lista = raiz.querySelector('ol[aria-label="Historial de cambios"]')!;
  assert.equal(lista.children.length, 2, "dos hechos (los cambios de campos van dentro de cada uno)");
  assert.match(txt(lista), /Laura \(freelance\)/);
  assert.match(txt(lista), /Desde el portal del aliado/);
  assert.match(txt(lista), /Teléfono: 3001112222 → 3009998888/);
  assert.match(txt(lista), /Ana Gerente \(gerencia\)/);
  assert.match(txt(lista), /% de comisión: 12 % → 10 %/);
  assert.equal(verHistorial(raiz), undefined, "ya cargado: no se ofrece volver a pedir (sin sondeo)");
});

test("estado vacío y mensaje de rol sin acceso", async () => {
  let raiz = await abrir();
  await clic(verHistorial(raiz), "Ver historial");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.match(txt(raiz), /Sin cambios registrados para esta ficha/);
  await desmontar!(); desmontar = undefined;

  h25.resp = () => ({ ok: false, error: "Solo superadmin y gerencia consultan el historial de cambios." });
  raiz = await abrir();
  await clic(verHistorial(raiz), "Ver historial");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.match(txt(raiz.querySelector('[role="alert"]')), /Solo superadmin y gerencia/);
  assert.ok(verHistorial(raiz), "tras un error se puede reintentar manualmente");
});
