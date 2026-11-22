// Se ejecuta con npm run test:react:resto (loader TSX/esbuild + jsdom).
// R325-3 — conversión ORDINARIA (no carrito) de una cotización cuyos pasajeros escribió el aliado: el infante exige su adulto responsable, ELEGIDO por el personal
// (`CotizacionAcciones`, componente REAL; la Server Action es un doble que registra lo que recibe). La regla de la base no se toca: aquí solo se prueba que la pantalla
//   · clasifica por fecha de nacimiento contra la fecha de salida y ofrece SOLO adultos (18+ con fecha) distintos del propio infante;
//   · nunca elige ni infiere un responsable: llega sin vincular y lo que se manda al servidor es exactamente lo elegido;
//   · un infante sin responsable NO se corrige en silencio (se manda sin vínculo y es la base la que rechaza; el rechazo se muestra);
//   · un cambio de fecha de nacimiento que saca al infante de esa categoría limpia el vínculo.
import * as nodeModule from "node:module";
import { botonConTexto, clic, dom, esperar, montar } from "./support/fechaNegocioArnes.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const G = "globalThis.__ca325";
const ACCIONES = `data:text/javascript,${encodeURIComponent(`
  export async function convertirCotizacion(...a) { ${G}.llamadas.push(['convertir', a]); return ${G}.respuesta; }
  export async function descartarCotizacion(...a) { ${G}.llamadas.push(['descartar', a]); return { ok: true }; }
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../../reservar/actions" && (context.parentURL ?? "").endsWith("/CotizacionAcciones.tsx")) return { url: ACCIONES, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const estado = { llamadas: [] as [string, unknown[]][], respuesta: { ok: true, numero: "DTM-0451" } as { ok: boolean; numero?: string; error?: string } };
(globalThis as unknown as { __ca325: typeof estado }).__ca325 = estado;

const { CotizacionAcciones } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx");
const React = await import("react");

const SALIDA = "2026-12-04";
const ana = { nombres: "Ana", apellidos: "Uno", tipoDoc: "CC", numeroDoc: "1010101010", fechaNacimiento: "1985-03-04", nacionalidad: "" };
const tomas = { nombres: "Tomas", apellidos: "Dos", tipoDoc: "TI", numeroDoc: "2020202020", fechaNacimiento: "2018-01-01", nacionalidad: "" };
const bebe = { nombres: "Bebe", apellidos: "Tres", tipoDoc: "RC", numeroDoc: "3030303030", fechaNacimiento: "2025-06-01", nacionalidad: "" };

let montado: Awaited<ReturnType<typeof montar>> | null = null;
async function render(pasajerosAliado = [ana, tomas, bebe], pax = 4) {
  montado = await montar(React.createElement(CotizacionAcciones, {
    id: 9005, pax, infantes: 0, tienePasajeros: false, cliente: { nombres: "Laura", apellidos: "Vega", tipoDoc: "CE", numeroDoc: "1234567" },
    esSuperadmin: true, asesores: [], miNombre: "Asesor", miRolVenta: false, pasajerosAliado, fechaReferencia: SALIDA,
  }));
  await esperar(() => true, 3);
  const c = montado.contenedor;
  await clic(botonConTexto(c, /Confirmar → generar contrato/), "abrir captura");
  await esperar(() => c.querySelectorAll('[data-testid="edad-pasajero"]').length > 0);
  return c;
}
const texto = (el: Element) => el.textContent ?? "";
const resumenes = (c: Element) => [...c.querySelectorAll('[data-testid="pasajero-resumen"]')];
/** Corrección 2: las filas completas llegan compactas; se reabren todas para inspeccionar sus campos (y de paso se comprueba que reabrir deja los datos intactos). */
async function reabrirTodas(c: Element) {
  await act(async () => { for (const b of [...c.querySelectorAll('[data-testid="editar-pasajero"]')]) (b as HTMLElement).click(); });
}
const convertir = () => estado.llamadas.filter(([n]) => n === "convertir");
const selectores = (c: Element) => [...c.querySelectorAll<HTMLSelectElement>('[data-testid="responsable-infante"] select')];
const opciones = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent ?? "");
async function elegir(s: HTMLSelectElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(s, valor);
    s.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const filasEnviadas = () => convertir()[0][1][1] as { nombres: string; responsableIndex?: number | null; fechaNacimiento: string }[];

beforeEach(() => { estado.llamadas.length = 0; estado.respuesta = { ok: true, numero: "DTM-0451" }; });
afterEach(async () => { await montado?.desmontar(); montado = null; });

test("el infante escrito por la aliada se clasifica por su fecha contra la salida y exige responsable; SOLO se ofrecen adultos con fecha, nunca él mismo ni un menor", async () => {
  const c = await render();
  // Corrección 2: titular, adulta y niño (completos) llegan compactos; el infante SIN responsable llega abierto y con su selector (lo incompleto no se esconde).
  assert.equal(resumenes(c).length, 3);
  assert.equal(c.querySelectorAll('[data-testid="pasajero-fila"]').length, 1);
  assert.equal(selectores(c).length, 1, "el selector del infante está visible sin tener que abrir nada");
  await reabrirTodas(c);
  const edades = [...c.querySelectorAll('[data-testid="edad-pasajero"]')].map((e) => texto(e));
  assert.deepEqual(edades, ["—", "Adulto · 41a", "Niño · 8a", "Infante · 1a"], "titular sin fecha, adulto, niño de 8 e infante de 1 (a la salida)");
  const sel = selectores(c);
  assert.equal(sel.length, 1, "solo el infante pide responsable");
  assert.match(texto(c.querySelector('[data-testid="responsable-infante"]')!), /Adulto responsable \*/);
  assert.deepEqual(opciones(sel[0]), ["Sin vincular (se rechazará al generar)", "Ana Uno"], "el titular (sin fecha), el niño de 8 y el propio infante NO son elegibles");
  assert.equal(sel[0].value, "", "nadie elige por el personal");
});

test("sin elegir responsable: se manda sin vínculo (no se adivina ni se corrige), la base lo rechaza y la pantalla muestra el rechazo sin navegar", async () => {
  estado.respuesta = { ok: false, error: "Todo infante nuevo debe tener un adulto responsable." };
  const c = await render();
  await clic(botonConTexto(c, /^Generar contrato$/), "generar sin responsable");
  await esperar(() => convertir().length > 0 && /adulto responsable/.test(texto(c)));
  assert.equal(convertir().length, 1);
  const filas = filasEnviadas();
  assert.equal(filas.length, 4);
  assert.ok(filas.every((f) => f.responsableIndex == null), "ninguna fila lleva un responsable que nadie eligió");
  assert.match(texto(c), /Todo infante nuevo debe tener un adulto responsable/);
});

test("con el adulto elegido por el personal: se manda exactamente ese vínculo (posición del adulto) y nada más cambia", async () => {
  const c = await render();
  await elegir(selectores(c)[0], "1");
  await clic(botonConTexto(c, /^Generar contrato$/), "generar con responsable");
  await esperar(() => convertir().length > 0);
  const filas = filasEnviadas();
  assert.deepEqual(filas.map((f) => [f.nombres, f.responsableIndex ?? null]), [["Laura", null], ["Ana", null], ["Tomas", null], ["Bebe", 1]]);
  assert.deepEqual(filas.map((f) => f.fechaNacimiento), ["", "1985-03-04", "2018-01-01", "2025-06-01"], "las fechas de la aliada viajan intactas");
});

test("si la fecha de nacimiento del infante cambia y deja de ser infante, el selector desaparece y el vínculo se limpia (no queda 'vivo' invisible)", async () => {
  const c = await render();
  await elegir(selectores(c)[0], "1");
  await reabrirTodas(c);
  const fechas = [...c.querySelectorAll<HTMLInputElement>('input[aria-label="Nacimiento"]')];
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(fechas[3], "01/01/1990");
    fechas[3].dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    fechas[3].dispatchEvent(new dom.window.Event("blur", { bubbles: true }));
  });
  await esperar(() => selectores(c).length === 0);
  await clic(botonConTexto(c, /^Generar contrato$/), "generar");
  await esperar(() => convertir().length > 0);
  assert.equal(filasEnviadas()[3].responsableIndex ?? null, null);
});

test("sin ningún adulto elegible (todos sin fecha) el selector solo ofrece «Sin vincular»: la regla no se relaja", async () => {
  const c = await render([{ ...ana, fechaNacimiento: "" }, bebe], 3);
  const sel = selectores(c);
  assert.equal(sel.length, 1);
  assert.deepEqual(opciones(sel[0]), ["Sin vincular (se rechazará al generar)"]);
});

test("una cotización sin infantes no muestra ningún selector de responsable (el flujo de niños y adultos queda igual)", async () => {
  const c = await render([ana, tomas], 3);
  assert.equal(selectores(c).length, 0);
  await clic(botonConTexto(c, /^Generar contrato$/), "generar");
  await esperar(() => convertir().length > 0);
  assert.ok(filasEnviadas().every((f) => f.responsableIndex == null));
});

test("2.5 elegir al responsable y pulsar «Listo»: la fila del infante se compacta mostrando SU responsable; «Editar» la reabre con la elección intacta; se envía ese mismo vínculo", async () => {
  const c = await render();
  await elegir(selectores(c)[0], "1");
  assert.equal(c.querySelectorAll('[data-testid="compactar-pasajero"]').length, 1);
  await clic(c.querySelector('[data-testid="compactar-pasajero"]') as HTMLElement, "compactar infante");
  assert.equal(resumenes(c).length, 4);
  assert.equal(selectores(c).length, 0);
  const r = texto(resumenes(c)[3]);
  assert.match(r, /Bebe Tres/); assert.match(r, /Infante · 1a/); assert.match(r, /responsable: Ana Uno/);
  await clic(resumenes(c)[3].querySelector('[data-testid="editar-pasajero"]') as HTMLElement, "reabrir infante");
  assert.equal(selectores(c)[0].value, "1", "la elección del responsable sobrevive a compactar/reabrir");
  await clic(c.querySelector('[data-testid="compactar-pasajero"]') as HTMLElement, "compactar de nuevo");
  await clic(botonConTexto(c, /^Generar contrato$/), "generar");
  await esperar(() => convertir().length > 0);
  assert.deepEqual(filasEnviadas().map((f) => f.responsableIndex ?? null), [null, null, null, 1]);
});

test("2.3 un pasajero sin documento ni nacimiento se ve compacto con «Faltan: …»; uno con documento inválido llega ABIERTO", async () => {
  const c = await render([{ ...ana, numeroDoc: "", fechaNacimiento: "" }, { ...tomas, tipoDoc: "CE", numeroDoc: "E999" }], 3);
  assert.equal(resumenes(c).length, 2, "titular (con CE válido) y la adulta sin documento/nacimiento");
  assert.match(texto(resumenes(c)[1].querySelector('[data-testid="pasajero-faltan"]')!), /Faltan: documento, nacimiento/);
  assert.equal(c.querySelectorAll('[data-testid="pasajero-fila"]').length, 1, "el de documento inválido (letras bajo CE) está abierto");
});

test("2.4 los cambios escritos en una fila abierta no se pierden al compactar y reabrir OTRA fila", async () => {
  const c = await render([ana, tomas], 3);
  await clic(resumenes(c)[1].querySelector('[data-testid="editar-pasajero"]') as HTMLElement, "abrir adulta");
  const nom = [...c.querySelectorAll("label")].find((l) => l.textContent === "Nombres")!.parentElement!.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(nom, "Ana María");
    nom.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await clic(resumenes(c)[1].querySelector('[data-testid="editar-pasajero"]') as HTMLElement, "abrir niño");
  const noms = [...c.querySelectorAll("label")].filter((l) => l.textContent === "Nombres").map((l) => (l.parentElement!.querySelector("input") as HTMLInputElement).value);
  assert.deepEqual(noms, ["Ana María", "Tomas"], "lo escrito sigue ahí con dos filas abiertas a la vez");
});

test("2.3/2.5 un cambio en OTRA fila que invalida el responsable ya elegido REABRE la fila compacta del infante (lo que bloquea no queda escondido)", async () => {
  const c = await render();
  await elegir(selectores(c)[0], "1");
  await clic(c.querySelector('[data-testid="compactar-pasajero"]') as HTMLElement, "compactar infante");
  assert.equal(selectores(c).length, 0, "con responsable elegido, el infante está compacto");
  await clic(resumenes(c)[1].querySelector('[data-testid="editar-pasajero"]') as HTMLElement, "abrir a Ana");
  const fecha = c.querySelector<HTMLInputElement>('input[aria-label="Nacimiento"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(fecha, "01/01/2018");
    fecha.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    fecha.dispatchEvent(new dom.window.Event("blur", { bubbles: true }));
  });
  await esperar(() => selectores(c).length === 1);
  assert.equal(selectores(c)[0].value, "", "el vínculo se limpió (Ana ya no es adulta) y el selector del infante volvió a la vista, sin responsable");
});
