// Se ejecuta con npm run test:react:rev2 (loader del arnés + jsdom). Interfaz REAL del contrato manual (NuevoContratoForm) — revisión del dueño 2026-11-26, F6:
//   B95-13  destino del catálogo (id) y hoteles SOLO del destino; ciudad del hotel precargada del catálogo; cambiar el destino quita un hotel incompatible y lo avisa.
//   B95-14  regreso anterior a la salida: mensaje en línea y «Generar contrato» desactivado.
//   B95-15  compra directa vs plataforma (quién es el proveedor a pagar).
//   B95-20  habitaciones por tipo frente a los pasajeros reales (edad por fecha de nacimiento); lo que viaja al servidor es la estructura.
import { montar, clic, escribir, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./actions" && /NuevoContratoForm/.test(context.parentURL ?? "")) {
      return { url: `data:text/javascript,${encodeURIComponent(`
        export async function crearContrato(x) { globalThis.__f6c.llamadas.push(x); return { ok: false, error: 'detenido en la prueba' }; }
        export async function previsualizarNetoContrato() { return { ok: false, error: 'no se usa' }; }
      `)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const f6c = { llamadas: [] as Record<string, unknown>[] };
(globalThis as unknown as { __f6c: typeof f6c }).__f6c = f6c;

const React = await import("react");
const { NuevoContratoForm } = await import("../app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
const h = React.createElement;

const DESTINOS = [{ id: 1, nombre: "San Andrés", codigo_iata: "ADZ" }, { id: 2, nombre: "Cartagena", codigo_iata: "CTG" }];
const hotel = (id: number, nombre: string, destinoId: number, proveedor: string | null) => ({
  id, nombre, destino: destinoId === 1 ? "San Andrés" : "Cartagena", destinoId, proveedor, adultsOnly: false, petFriendly: false, categorias: [], regimenes: [], acomodaciones: [], reglasAcom: [], paxMin: null, paxMax: null, edadInfanteMax: 2, edadNinoMax: 10,
});
const HOTELES = [hotel(11, "Hotel Marina SAI", 1, "Hoteles Isla SAS"), hotel(12, "Hotel Capilla del Mar", 2, null)];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; f6c.llamadas.length = 0; });
after(() => dom.window.close());

const boton = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button")].find((b) => texto.test(txt(b))) as HTMLButtonElement | undefined;
const porAria = (raiz: Element, aria: string) => raiz.querySelector(`input[aria-label="${aria}"]`) as HTMLInputElement;
const porPlaceholder = (raiz: Element, p: string, desde = 0) => raiz.querySelectorAll(`input[placeholder="${p}"]`)[desde] as HTMLInputElement;
const generar = (raiz: Element) => boton(raiz, /^Generar contrato$/)!;
const opcionesHoteles = (raiz: Element) => [...raiz.querySelectorAll("datalist#hoteles-catalogo option")].map((o) => (o as HTMLOptionElement).value);
const setSelect = async (el: HTMLSelectElement, valor: string) => {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
};
async function elegirDestino(raiz: Element, nombre: string) {
  const combo = raiz.querySelector('[data-testid="campo-destino"] input[role="combobox"]') as HTMLInputElement;
  await React.act(async () => combo.focus());
  await escribir(combo, nombre);
  const op = [...document.querySelectorAll('[role="option"]')].find((b) => txt(b).includes(nombre));
  assert.ok(op, `opción de destino «${nombre}»`);
  await React.act(async () => { op.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
}
async function base() {
  usarBD({});
  const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor", destinos: DESTINOS, hotelesCatalogo: HOTELES, proveedoresCatalogo: ["Hoteles Isla SAS"] }));
  desmontar = m.desmontar;
  const raiz = m.contenedor;
  await clic(boton(raiz, /\+ Agregar hotel/), "Agregar hotel");
  return raiz;
}

test("B95-13: sin destino no hay hoteles del catálogo; con «San Andrés» solo los suyos; elegir uno precarga ciudad y proveedor (copias editables)", async () => {
  const raiz = await base();
  assert.deepEqual(opcionesHoteles(raiz), []);
  await elegirDestino(raiz, "San Andrés");
  assert.deepEqual(opcionesHoteles(raiz), ["Hotel Marina SAI"], "nunca «Hotel Capilla del Mar» (Cartagena)");
  await escribir(porPlaceholder(raiz, "Hotel"), "Hotel Marina SAI");
  assert.equal(porPlaceholder(raiz, "Proveedor del hotel (compra directa)").value, "Hoteles Isla SAS");
  assert.equal((raiz.querySelector('input[placeholder="Ciudad"]') as HTMLInputElement).value, "San Andrés", "ciudad precargada del destino guardado del hotel");
});

test("B95-13: cambiar el destino quita el hotel del catálogo incompatible (vínculo y copia) y lo avisa", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await escribir(porPlaceholder(raiz, "Hotel"), "Hotel Marina SAI");
  await elegirDestino(raiz, "Cartagena");
  assert.equal(porPlaceholder(raiz, "Hotel").value, "");
  assert.match(txt(raiz.querySelector('[data-testid="aviso-destino"]')), /Se quitó el hotel «Hotel Marina SAI»: no pertenece al destino elegido/);
  assert.equal(porPlaceholder(raiz, "Proveedor del hotel (compra directa)").value, "", "la copia del proveedor se quitó con el hotel");
  assert.equal((raiz.querySelector('input[placeholder="Ciudad"]') as HTMLInputElement).value, "", "la ciudad precargada del hotel quitado también se quitó (si no, el próximo hotel del destino nuevo heredaba la ciudad vieja)");
});

test("B95-14: regreso anterior a la salida → error en línea y botón desactivado (también si la salida se mueve después)", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await escribir(porAria(raiz, "Fecha de salida (viaje)"), "2030-03-01");
  await escribir(porAria(raiz, "Fecha de regreso"), "2030-03-04");
  assert.equal(raiz.querySelector('[data-testid="error-fechas"]'), null);
  await escribir(porAria(raiz, "Fecha de salida (viaje)"), "2030-03-10");
  assert.match(txt(raiz.querySelector('[data-testid="error-fechas"]')), /fecha de regreso no puede ser anterior/);
  assert.equal(generar(raiz).disabled, true);
});

test("B95-15: sin origen de compra no hay valor por defecto; plataforma exige su nombre y ES el proveedor a pagar; directa usa el proveedor del hotel en el catálogo", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await escribir(porPlaceholder(raiz, "Hotel"), "Hotel Marina SAI");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /Indica cómo se compra/);
  const origen = raiz.querySelector('select[aria-label="Origen de la compra"]') as HTMLSelectElement;
  await setSelect(origen, "plataforma");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /escribe el nombre de la plataforma/);
  assert.equal(raiz.querySelector('input[placeholder="Proveedor del hotel (compra directa)"]'), null, "con plataforma no se pide el proveedor del hotel");
  await escribir(porAria(raiz, "Plataforma (proveedor a pagar)"), "Despegar");
  assert.doesNotMatch(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /plataforma/);
  await setSelect(origen, "directa");
  assert.equal(porPlaceholder(raiz, "Proveedor del hotel (compra directa)").value, "Hoteles Isla SAS");
});

test("B95-20: con un pasajero adulto (por fecha de nacimiento) «1 Doble» no cuadra (aloja 2) y «1 Sencilla» sí; sin habitaciones se pide la estructura", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await escribir(porAria(raiz, "Fecha de salida (viaje)"), "2030-03-01");
  await escribir(porAria(raiz, "Fecha de regreso"), "2030-03-04");
  await escribir(porPlaceholder(raiz, "Hotel"), "Hotel Marina SAI");
  await setSelect(raiz.querySelector('select[aria-label="Origen de la compra"]') as HTMLSelectElement, "directa");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /Indica las habitaciones/);
  await escribir(porPlaceholder(raiz, "Nombres", 1) ?? porPlaceholder(raiz, "Nombres"), "Ana");
  await escribir(porAria(raiz, "Fecha de nacimiento"), "1990-01-01");
  await escribir(porAria(raiz, "Habitaciones Doble"), "1");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /necesitan 2 adulto\(s\); el viaje tiene 1/);
  assert.equal(generar(raiz).disabled, true);
  await escribir(porAria(raiz, "Habitaciones Doble"), "0");
  await escribir(porAria(raiz, "Habitaciones Sencilla"), "1");
  assert.equal(raiz.querySelector('[data-testid="errores-hotel"]'), null, txt(raiz.querySelector('[data-testid="errores-hotel"]')));
});

test("B95-13/20: un hotel del catálogo con acomodaciones configuradas ofrece SOLO esos contadores (Doble y Triple); sin hotel del catálogo, los cuatro", async () => {
  usarBD({});
  const conAcom = { ...hotel(21, "Hotel Doble Triple", 1, "Hoteles Isla SAS"), acomodaciones: ["Doble", "Triple"] };
  const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor", destinos: DESTINOS, hotelesCatalogo: [conAcom], proveedoresCatalogo: ["Hoteles Isla SAS"] }));
  desmontar = m.desmontar;
  const raiz = m.contenedor;
  await clic(boton(raiz, /\+ Agregar hotel/), "Agregar hotel");
  const contadores = () => [...raiz.querySelectorAll('[data-testid="habitaciones-hotel"] input[aria-label^="Habitaciones "]')].map((i) => (i as HTMLInputElement).getAttribute("aria-label"));
  assert.deepEqual(contadores(), ["Habitaciones Sencilla", "Habitaciones Doble", "Habitaciones Triple", "Habitaciones Múltiple"], "sin hotel del catálogo elegido: los cuatro");
  await elegirDestino(raiz, "San Andrés");
  await escribir(porPlaceholder(raiz, "Hotel"), "Hotel Doble Triple");
  assert.deepEqual(contadores(), ["Habitaciones Doble", "Habitaciones Triple"], "con el hotel elegido: solo lo que ese hotel ofrece");
});
