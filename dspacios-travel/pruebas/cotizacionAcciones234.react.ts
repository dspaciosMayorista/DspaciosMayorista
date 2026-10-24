// Se ejecuta por comando directo o desde test:react:
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/cotizacionAcciones234.react.ts
//
// #63 (234) — conversión de una cotización a contrato (CotizacionAcciones, componente REAL; las Server Actions son dobles):
//   · una oferta en USD SIN TRM pide la TRM provisional del contrato; vacía = la de referencia; si se escribe, debe ser positiva;
//   · la tasa ingresada viaja a `convertirCotizacion` (5.º argumento) y una inválida NO llama al servidor;
//   · una oferta con TRM (o en COP) no muestra el campo y no manda ninguna tasa.
import * as nodeModule from "node:module";
import { botonConTexto, clic, dom, esperar, montar } from "./support/fechaNegocioArnes.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const G = "globalThis.__ca234";
const ACCIONES = `data:text/javascript,${encodeURIComponent(`
  export async function convertirCotizacion(...a) { ${G}.llamadas.push(['convertir', a]); return { ok: true, numero: 'DTM-0451' }; }
  export async function descartarCotizacion(...a) { ${G}.llamadas.push(['descartar', a]); return { ok: true }; }
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../../reservar/actions" && (context.parentURL ?? "").endsWith("/CotizacionAcciones.tsx")) return { url: ACCIONES, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const estado = { llamadas: [] as [string, unknown[]][] };
(globalThis as unknown as { __ca234: typeof estado }).__ca234 = estado;

const { CotizacionAcciones } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx");
const React = await import("react");

let montado: Awaited<ReturnType<typeof montar>> | null = null;
async function render(pideTrmProvisional: boolean) {
  montado = await montar(React.createElement(CotizacionAcciones, {
    id: 77, pax: 2, infantes: 0, tienePasajeros: true, cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1" },
    esSuperadmin: true, asesores: [], miNombre: "Asesor", miRolVenta: false, pideTrmProvisional,
  }));
  await esperar(() => true, 3);
  return montado.contenedor;
}
const texto = (el: Element) => el.textContent ?? "";
const convertir = () => estado.llamadas.filter(([n]) => n === "convertir");
const campo = (c: Element) => c.querySelector<HTMLInputElement>('input[aria-label="TRM provisional"]');
async function escribir(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

beforeEach(() => { estado.llamadas.length = 0; });
afterEach(async () => { await montado?.desmontar(); montado = null; });

test("oferta USD sin TRM: aparece el campo; la tasa ingresada viaja como 5.º argumento de convertirCotizacion", async () => {
  const c = await render(true);
  assert.ok(c.querySelector('[data-testid="trm-provisional"]'), "el campo existe");
  assert.match(texto(c), /TRM provisional del contrato/);
  assert.match(texto(c), /no cambia después/);
  await escribir(campo(c)!, "4321.5");
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(convertir()[0][1], [77, undefined, undefined, undefined, 4321.5]);
});

test("tasa inválida (0 o negativa): NO llama al servidor y explica por qué (un input numérico no admite texto; el servidor igual lo valida)", async () => {
  for (const mala of ["0", "-3", "100000000000", "1e20"]) {
    const c = await render(true);
    await escribir(campo(c)!, mala);
    await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
    await esperar(() => /TRM provisional debe ser un número positivo/.test(texto(c)));
    assert.equal(convertir().length, 0, `con "${mala}" no se llamó a convertirCotizacion`);
    await montado?.desmontar(); montado = null;
  }
});

test("oferta con TRM o en COP: sin campo y sin tasa en la conversión", async () => {
  const c = await render(false);
  assert.equal(c.querySelector('[data-testid="trm-provisional"]'), null);
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.equal(convertir()[0][1][4], null);
});

// 234 · hallazgo 1 — la TRM provisional es OBLIGATORIA: el campo vacío impide la conversión desde la interfaz.
test("oferta USD sin TRM con el campo VACÍO: no se llama al servidor y se pide la tasa (sin 'TRM de referencia')", async () => {
  const c = await render(true);
  assert.doesNotMatch(texto(c), /TRM de referencia|Vacía = /, "ya no hay respaldo automático que prometer");
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => /ingresa la TRM provisional/.test(texto(c)));
  assert.equal(convertir().length, 0, "el servidor no recibe una conversión sin tasa");
});

test("oferta USD sin TRM con el campo solo con espacios: tampoco se convierte", async () => {
  const c = await render(true);
  await escribir(campo(c)!, "   ");
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => /ingresa la TRM provisional/.test(texto(c)));
  assert.equal(convertir().length, 0);
});
