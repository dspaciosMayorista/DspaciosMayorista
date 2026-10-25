// Se ejecuta por comando directo o desde test:react:
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/cotizacionCobro235.react.ts
//
// #90 F (235) — moneda de COBRO al convertir una cotización a contrato (CotizacionAcciones, componente REAL; las Server Actions son dobles):
//   · solo una oferta con conversión por TRM (y personal interno) muestra el selector; el valor por defecto es la moneda de la oferta;
//   · elegir la OTRA moneda pide la TRM de cobro (obligatoria, positiva) y muestra una vista previa del total, sin llamar al servidor si falta;
//   · la elección viaja como 6.º y 7.º argumento de convertirCotizacion; sin elección viajan null;
//   · la TRM provisional (234) y la de cobro (235) son dos campos distintos.
import * as nodeModule from "node:module";
import { botonConTexto, clic, dom, esperar, montar } from "./support/fechaNegocioArnes.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const G = "globalThis.__cc235";
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
(globalThis as unknown as { __cc235: typeof estado }).__cc235 = estado;

const { CotizacionAcciones } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx");
const React = await import("react");

let montado: Awaited<ReturnType<typeof montar>> | null = null;
async function render(o: { permiteMonedaCobro?: boolean; monedaOferta?: string; totalOferta?: number; pideTrmProvisional?: boolean }) {
  montado = await montar(React.createElement(CotizacionAcciones, {
    id: 77, pax: 2, infantes: 0, tienePasajeros: true, cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1" },
    esSuperadmin: true, asesores: [], miNombre: "Asesor", miRolVenta: false,
    pideTrmProvisional: o.pideTrmProvisional ?? false, permiteMonedaCobro: o.permiteMonedaCobro ?? false, monedaOferta: o.monedaOferta ?? "COP", totalOferta: o.totalOferta ?? 0,
  }));
  await esperar(() => true, 3);
  return montado.contenedor;
}
const texto = (el: Element) => el.textContent ?? "";
const convertir = () => estado.llamadas.filter(([n]) => n === "convertir");
const selector = (c: Element) => c.querySelector<HTMLSelectElement>('select[aria-label="Moneda de cobro"]');
const trmCobro = (c: Element) => c.querySelector<HTMLInputElement>('input[aria-label="TRM de cobro"]');
const trmProv = (c: Element) => c.querySelector<HTMLInputElement>('input[aria-label="TRM provisional"]');
async function escribir(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function elegir(el: HTMLSelectElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

beforeEach(() => { estado.llamadas.length = 0; });
afterEach(async () => { await montado?.desmontar(); montado = null; });

test("sin conversión por TRM (o sin permiso) no hay selector y no se manda cobro", async () => {
  const c = await render({ permiteMonedaCobro: false, monedaOferta: "USD", totalOferta: 1200 });
  assert.equal(selector(c), null);
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(convertir()[0][1], [77, undefined, undefined, undefined, null, null, null]);
});

test("con selector y sin elegir: NO hay valor por defecto; confirmar no llama al servidor y pide la moneda", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "USD", totalOferta: 1200 });
  const s = selector(c)!;
  assert.equal(s.value, "", "ninguna moneda preseleccionada");
  assert.match(texto(c), /Elige la moneda de cobro/);
  assert.match(texto(c), /USD \(la de la oferta, sin conversión\)/);
  assert.match(texto(c), /COP \(convertir al contratar\)/);
  assert.equal(trmCobro(c), null, "sin otra moneda no hay TRM de cobro");
  const antes = convertir().length;
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => true, 3);
  assert.equal(convertir().length, antes, "sin elección el servidor no se llama");
  assert.match(texto(c), /Elige la moneda de cobro \(COP o USD\) antes de generar el contrato/);
});

test("elegir EXPRESAMENTE la moneda de la oferta viaja registrada (USD, null): sin TRM de cobro", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "USD", totalOferta: 1200 });
  await elegir(selector(c)!, "USD");
  assert.equal(trmCobro(c), null);
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(convertir()[0][1].slice(5), ["USD", null]);
});

test("elegir la otra moneda pide la TRM de cobro; vacía o inválida NO llama al servidor", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "USD", totalOferta: 1200 });
  await elegir(selector(c)!, "COP");
  assert.ok(trmCobro(c), "aparece el campo");
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => /TRM de cobro/.test(texto(c)) && /exige/.test(texto(c)));
  assert.equal(convertir().length, 0, "sin TRM de cobro no se convierte");
  for (const mala of ["0", "-4", "100000000000"]) {
    await escribir(trmCobro(c)!, mala);
    await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
    await esperar(() => /TRM de cobro debe ser un número positivo/.test(texto(c)));
    assert.equal(convertir().length, 0, `con "${mala}" no se llamó a convertirCotizacion`);
  }
});

test("USD→COP con TRM 4100: vista previa 1.200 × 4.100 = $4.920.000 y la elección viaja como 6.º y 7.º argumento", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "USD", totalOferta: 1200 });
  await elegir(selector(c)!, "COP");
  await escribir(trmCobro(c)!, "4100");
  await esperar(() => c.querySelector('[data-testid="vista-previa-cobro"]') != null);
  const previa = texto(c.querySelector('[data-testid="vista-previa-cobro"]')!);
  assert.match(previa, /4\.920\.000/);
  assert.match(previa, /el sistema calcula y congela el total al contratar/);
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(convertir()[0][1], [77, undefined, undefined, undefined, null, "COP", 4100]);
});

test("COP→USD con TRM 4000: vista previa $4.800.000 → USD 1.200", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "COP", totalOferta: 4_800_000 });
  await elegir(selector(c)!, "USD");
  await escribir(trmCobro(c)!, "4000");
  await esperar(() => c.querySelector('[data-testid="vista-previa-cobro"]') != null);
  assert.match(texto(c.querySelector('[data-testid="vista-previa-cobro"]')!), /USD \$1,200/);
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(convertir()[0][1], [77, undefined, undefined, undefined, null, "USD", 4000]);
});

test("volver a la moneda de la oferta descarta la TRM de cobro escrita (no viaja una tasa que no se usa)", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "USD", totalOferta: 1200 });
  await elegir(selector(c)!, "COP");
  await escribir(trmCobro(c)!, "4100");
  await elegir(selector(c)!, "USD");
  assert.equal(trmCobro(c), null);
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(convertir()[0][1].slice(5), ["USD", null]);
});

test("oferta USD sin TRM: la TRM provisional y la TRM de cobro son campos distintos y viajan en su sitio", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "USD", totalOferta: 1200, pideTrmProvisional: true });
  await elegir(selector(c)!, "COP");
  await escribir(trmProv(c)!, "4000");
  await escribir(trmCobro(c)!, "4100");
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "confirmar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(convertir()[0][1], [77, undefined, undefined, undefined, 4000, "COP", 4100]);
});

test("el texto aclara que la oferta conserva su moneda e importes y que abonos y saldo van en la moneda de cobro", async () => {
  const c = await render({ permiteMonedaCobro: true, monedaOferta: "USD", totalOferta: 1200 });
  assert.match(texto(c), /La oferta conserva su moneda e importes/);
  assert.match(texto(c), /Abonos y saldo se llevan en la moneda de cobro/);
});
