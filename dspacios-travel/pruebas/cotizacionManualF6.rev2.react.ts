// Se ejecuta con npm run test:react:rev2 (loader del arnés + jsdom). Interfaz REAL de la cotización dinámica (CotizacionManualForm) — revisión del dueño 2026-11-26, F6:
//   B95-13  el destino se elige del catálogo y SOLO se ofrecen los hoteles de ese destino (por destino guardado); cambiar el destino quita un hotel incompatible y lo avisa.
//   B95-14  regreso anterior a la salida: mensaje en línea y «Generar» desactivado — también cuando la salida se mueve DESPUÉS de haber puesto el regreso (el hueco real).
//   B95-15  infantes explícitos; compra directa vs plataforma (quién es el proveedor a pagar); hotel manual flagueado.
//   B95-20  habitaciones por tipo en vez de texto libre («1 doble» con 3 adultos se rechaza en pantalla); lo que viaja al servidor es la estructura, no un texto.
import { montar, clic, escribir, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../manual-actions" && /CotizacionManualForm/.test(context.parentURL ?? "")) {
      return { url: `data:text/javascript,${encodeURIComponent(`
        export async function crearCotizacionManual(x) { globalThis.__f6.llamadas.push(x); return { ok: false, error: 'detenido en la prueba' }; }
        export async function crearComparativaManual(x) { globalThis.__f6.llamadas.push(x); return { ok: false, error: 'detenido en la prueba' }; }
      `)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const f6 = { llamadas: [] as Record<string, unknown>[] };
(globalThis as unknown as { __f6: typeof f6 }).__f6 = f6;

const React = await import("react");
const { CotizacionManualForm } = await import("../app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx");
const h = React.createElement;

const DESTINOS = [{ id: 1, nombre: "San Andrés", codigo_iata: "ADZ" }, { id: 2, nombre: "Cartagena", codigo_iata: "CTG" }];
const hotel = (id: number, nombre: string, destinoId: number, proveedor: string | null, extra: Record<string, unknown> = {}) => ({
  id, nombre, destino: destinoId === 1 ? "San Andrés" : "Cartagena", destinoId, proveedor, adultsOnly: false, petFriendly: false, categorias: [], regimenes: [], acomodaciones: [], reglasAcom: [], paxMin: null, paxMax: null, ...extra,
});
const CATALOGO = {
  hoteles: [hotel(11, "Hotel Marina SAI", 1, "Hoteles Isla SAS"), hotel(12, "Hotel Capilla del Mar", 2, null), hotel(13, "Hotel Solo Adultos", 1, "Hoteles Isla SAS", { adultsOnly: true })],
  servicios: [], aerolineas: [], proveedores: ["Hoteles Isla SAS"],
};
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; f6.llamadas.length = 0; });
after(() => dom.window.close());

const boton = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button")].find((b) => texto.test(txt(b))) as HTMLButtonElement | undefined;
const porEtiqueta = (raiz: Element, etiqueta: string | RegExp, desde = 0) =>
  ([...raiz.querySelectorAll("label")].filter((l) => (typeof etiqueta === "string" ? txt(l).startsWith(etiqueta) : etiqueta.test(txt(l))))[desde]?.parentElement?.querySelector("input") ?? null) as HTMLInputElement | null;
const porAria = (raiz: Element, aria: string) => raiz.querySelector(`input[aria-label="${aria}"]`) as HTMLInputElement;
const generar = (raiz: Element) => boton(raiz, /^Generar cotización$/)!;

async function elegirDestino(raiz: Element, nombre: string) {
  const combo = raiz.querySelector('[data-testid="campo-destino"] input[role="combobox"]') as HTMLInputElement;
  await React.act(async () => combo.focus());
  await escribir(combo, nombre);
  const op = [...document.querySelectorAll('[role="option"]')].find((b) => txt(b).includes(nombre));
  assert.ok(op, `opción de destino «${nombre}»`);
  await React.act(async () => { op.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
}
async function elegirHotelDeLista(raiz: Element, nombre: string) {
  const input = raiz.querySelector('input[list^="nombres-cot-"]') as HTMLInputElement;
  await escribir(input, nombre);
}
const opcionesNombre = (raiz: Element) => [...raiz.querySelectorAll('datalist[id^="nombres-cot-"] option')].map((o) => (o as HTMLOptionElement).value);
const setSelect = async (el: HTMLSelectElement, valor: string) => {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
};

async function base() {
  usarBD({});
  const m = await montar(h(CotizacionManualForm, { asesores: [], aliados: [], miNombre: "Asesor", miRolVenta: false, pctAliadoB2B: 0.5, catalogo: CATALOGO, destinos: DESTINOS }));
  desmontar = m.desmontar;
  const raiz = m.contenedor;
  await escribir(porEtiqueta(raiz, "Nombres")!, "Ana");
  await clic(boton(raiz, /^Hotel$/), "Hotel");
  return raiz;
}

test("B95-13: sin destino no se ofrece ningún hotel del catálogo; con «San Andrés» solo los de San Andrés (nunca «Capilla del Mar» de Cartagena)", async () => {
  const raiz = await base();
  assert.deepEqual(opcionesNombre(raiz), [], "sin destino elegido no hay hoteles del catálogo");
  assert.match(txt(raiz), /Elige primero el destino para ver los hoteles del catálogo/);
  await elegirDestino(raiz, "San Andrés");
  assert.deepEqual(opcionesNombre(raiz).sort(), ["Hotel Marina SAI", "Hotel Solo Adultos"]);
  assert.ok(!opcionesNombre(raiz).includes("Hotel Capilla del Mar"));
  await elegirDestino(raiz, "Cartagena");
  assert.deepEqual(opcionesNombre(raiz), ["Hotel Capilla del Mar"]);
});

test("B95-13: cambiar el destino con un hotel del catálogo ya elegido lo QUITA (vínculo y copia) y lo avisa; el servidor no recibe un hotel incompatible", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await elegirHotelDeLista(raiz, "Hotel Marina SAI");
  assert.equal((raiz.querySelector('input[list^="nombres-cot-"]') as HTMLInputElement).value, "Hotel Marina SAI");
  assert.equal((raiz.querySelector('input[list="proveedores-cot"]') as HTMLInputElement).value, "Hoteles Isla SAS", "el proveedor del catálogo se precarga (copia editable)");
  await elegirDestino(raiz, "Cartagena");
  assert.equal((raiz.querySelector('input[list^="nombres-cot-"]') as HTMLInputElement).value, "", "el hotel incompatible no queda seleccionado");
  assert.match(txt(raiz.querySelector('[data-testid="aviso-destino"]')), /Se quitó el hotel «Hotel Marina SAI»: no pertenece al destino elegido/);
  assert.equal((raiz.querySelector('input[list="proveedores-cot"]') as HTMLInputElement).value, "", "la copia del proveedor también se quita");
});

test("B95-13: un hotel que no está en el catálogo se escribe como «Hotel manual» (sin vínculo ni proveedor adivinado)", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await elegirHotelDeLista(raiz, "Posada Nativa del Sur");
  assert.match(txt(raiz.querySelector('[data-testid="vinculo-cotizacion"]')), /Hotel manual \(no está en el catálogo\)/);
  assert.equal((raiz.querySelector('input[list="proveedores-cot"]') as HTMLInputElement).value, "");
});

test("B95-14: regreso anterior a la salida → mensaje en línea y «Generar» desactivado; también si la SALIDA se mueve después del regreso", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await escribir(porAria(raiz, "Fecha ida"), "2027-03-10");
  await escribir(porAria(raiz, "Fecha regreso"), "2027-03-13");
  assert.equal(raiz.querySelector('[data-testid="error-fechas"]'), null);
  await escribir(porAria(raiz, "Fecha ida"), "2027-03-20");          // el hueco real: regreso (13) queda antes de la nueva salida (20)
  assert.match(txt(raiz.querySelector('[data-testid="error-fechas"]')), /La fecha de regreso no puede ser anterior a la fecha de salida/);
  assert.equal(generar(raiz).disabled, true);
  await escribir(porAria(raiz, "Fecha regreso"), "2027-03-23");
  assert.equal(raiz.querySelector('[data-testid="error-fechas"]'), null);
});

test("B95-15: hay un campo «Infantes» explícito; un infante sin adultos y una cantidad decimal se rechazan en pantalla", async () => {
  const raiz = await base();
  const inf = porAria(raiz, "Infantes");
  assert.ok(inf, "campo Infantes");
  await escribir(inf, "1.5");
  assert.match(txt(raiz.querySelector('[data-testid="bloqueo-formulario"]')), /números enteros/);
  await escribir(inf, "1");
  await escribir(porEtiqueta(raiz, "Adultos")!, "0");
  assert.match(txt(raiz.querySelector('[data-testid="bloqueo-formulario"]')), /Un infante necesita al menos un adulto/);
});

test("B95-15: compra por plataforma → la plataforma ES el proveedor a pagar; compra directa sin proveedor configurado se rechaza; sin elegir origen no hay valor por defecto", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "Cartagena");
  await elegirHotelDeLista(raiz, "Hotel Capilla del Mar");               // catálogo SIN proveedor configurado
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /Indica cómo se compra «Hotel Capilla del Mar»/);
  const origen = raiz.querySelector('select[aria-label="Origen de la compra"]') as HTMLSelectElement;
  await setSelect(origen, "directa");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /Compra directa de «Hotel Capilla del Mar»: no hay proveedor/);
  await setSelect(origen, "plataforma");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /escribe el nombre de la plataforma/);
  await escribir(porEtiqueta(raiz, "Plataforma")!, "Despegar");
  assert.equal(txt(raiz.querySelector('[data-testid="proveedor-plataforma"]')), "Despegar", "proveedor a pagar = plataforma; el hotel conserva su nombre");
  assert.equal((raiz.querySelector('input[list^="nombres-cot-"]') as HTMLInputElement).value, "Hotel Capilla del Mar");
});

test("B95-20: «1 doble» con 3 adultos se rechaza en pantalla; con 2 adultos se habilita y el servidor recibe la ESTRUCTURA (habitaciones, compra, destinoId, infantes), no texto libre", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await elegirHotelDeLista(raiz, "Hotel Marina SAI");
  await setSelect(raiz.querySelector('select[aria-label="Origen de la compra"]') as HTMLSelectElement, "directa");
  await escribir(porEtiqueta(raiz, "Adultos")!, "3");
  await escribir(porAria(raiz, "Habitaciones Doble"), "1");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /alojan 2 adulto\(s\); el viaje tiene 3/);
  assert.equal(generar(raiz).disabled, true);
  await escribir(porEtiqueta(raiz, "Adultos")!, "2");
  assert.equal(raiz.querySelector('[data-testid="errores-hotel"]'), null);
  await escribir(porEtiqueta(raiz, "Costo neto")!, "1000000");
  await escribir(porAria(raiz, "Fecha ida"), "2027-03-10");
  await escribir(porAria(raiz, "Fecha regreso"), "2027-03-13");
  await escribir(porAria(raiz, "Infantes"), "1");
  assert.equal(generar(raiz).disabled, false);
  await clic(generar(raiz), "Generar");
  assert.equal(f6.llamadas.length, 1);
  const p = f6.llamadas[0] as { destinoId: number; destino: string; infantes: number; servicios: Record<string, unknown>[] };
  assert.equal(p.destinoId, 1);
  assert.equal(p.destino, "San Andrés");
  assert.equal(p.infantes, 1);
  assert.deepEqual(p.servicios[0].habitaciones, { sencilla: 0, doble: 1, triple: 0, multiple: 0 });
  assert.equal(p.servicios[0].acomodacion, "1 hab Doble", "el texto de la acomodación se DERIVA de la estructura");
  assert.equal(p.servicios[0].compra, "directa");
  assert.equal(p.servicios[0].catalogoId, 11);
});

test("B95-20 + Adults Only: un hotel solo para adultos con infantes en el viaje se rechaza en pantalla", async () => {
  const raiz = await base();
  await elegirDestino(raiz, "San Andrés");
  await elegirHotelDeLista(raiz, "Hotel Solo Adultos");
  await setSelect(raiz.querySelector('select[aria-label="Origen de la compra"]') as HTMLSelectElement, "directa");
  await escribir(porAria(raiz, "Infantes"), "1");
  assert.match(txt(raiz.querySelector('[data-testid="errores-hotel"]')), /solo para adultos/);
});
