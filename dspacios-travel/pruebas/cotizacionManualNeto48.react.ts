// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// #48 — Interfaz REAL del formulario de cotización dinámica con la modalidad NETO (`CotizacionManualForm`):
//   · la opción NETO solo existe para B2B y solo para los roles que pueden fijarla (venta, B2C y comparativa no la ven);
//   · con NETO la vista previa muestra los valores calculados a mano (PVP 5.000.000, comisión 480.000, NETO 4.520.000, margen) y reemplaza la BNC;
//   · lo que se envía al servidor es exactamente la modalidad elegida (y NADA de BNC); en PVP sigue exigiendo BNC;
//   · un NETO que la base rechazaría (margen bajo sin rol que autorice, comisión 0) bloquea el guardado en pantalla y no llama a la acción.
import { montar, clic, escribir, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import * as nodeModule from "node:module";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../manual-actions" && /CotizacionManualForm/.test(context.parentURL ?? "")) {
      return { url: datos(`
        export async function crearCotizacionManual(x) { globalThis.__n48.llamadas.push(x); return { ok: false, error: 'detenido en la prueba' }; }
        export async function crearComparativaManual(x) { globalThis.__n48.llamadas.push(x); return { ok: false, error: 'detenido en la prueba' }; }
      `), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const n48 = { llamadas: [] as Record<string, unknown>[] };
(globalThis as unknown as { __n48: typeof n48 }).__n48 = n48;

const React = await import("react");
const { CotizacionManualForm } = await import("../app/(dashboard)/dashboard/cotizaciones/nueva/CotizacionManualForm.tsx");
const h = React.createElement;

const ALIADOS = [
  { id: 7, nombre: "Viajes Sol SAS", tipo: "agencia", pct_comision: 0.12 },
  { id: 8, nombre: "Laura Gómez", tipo: "freelance", pct_comision: null },
  { id: 9, nombre: "Comision Cero SAS", tipo: "agencia", pct_comision: 0 },
];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const neto = (rol: string | null) => ({ rol, pctAgencia: 0.12, pctFreelance: 0.11, reglaParticipacion: false });

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; n48.llamadas.length = 0; });
after(() => dom.window.close());

const boton = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll("button")].find((b) => texto.test(txt(b))) as HTMLButtonElement | undefined;
const campoDe = (raiz: Element, etiqueta: string | RegExp, desde = 0) =>
  ([...raiz.querySelectorAll("label")].filter((l) => (typeof etiqueta === "string" ? txt(l).startsWith(etiqueta) : etiqueta.test(txt(l))))[desde]?.parentElement?.querySelector("input") ?? null) as HTMLInputElement | null;
const radio = (raiz: Element, texto: RegExp) => [...raiz.querySelectorAll('input[type="radio"][name="modalidad"]')].find((r) => texto.test(txt(r.closest("label")))) as HTMLInputElement | undefined;

// F6 (B95-13/15/20): el destino ahora se ELIGE del catálogo y cada hotel declara cómo se compra y sus habitaciones; este archivo prueba la modalidad NETO, así que solo cumple esos requisitos.
const DESTINOS_F6 = [{ id: 1, nombre: "San Andrés", codigo_iata: "ADZ" }];
async function elegirDestinoF6(raiz: Element) {
  const combo = raiz.querySelector('[data-testid="campo-destino"] input[role="combobox"]') as HTMLInputElement;
  await React.act(async () => combo.focus());
  await escribir(combo, "San Andrés");
  const op = [...document.querySelectorAll('[role="option"]')].find((b) => /San Andrés/.test(txt(b)))!;
  await React.act(async () => { op.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
}
async function montarForm(rol: string | null, aliado: string, tipo: "agencia" | "freelance" | "interno" = "agencia") {
  usarBD({});
  const m = await montar(h(CotizacionManualForm, { asesores: [], aliados: ALIADOS, miNombre: "Asesor", miRolVenta: rol === "venta", pctAliadoB2B: 0.5, neto: neto(rol), destinos: DESTINOS_F6 }));
  desmontar = m.desmontar;
  const raiz = m.contenedor;
  await elegirDestinoF6(raiz);
  await escribir(campoDe(raiz, "Nombres")!, "Ana");
  if (tipo !== "interno") {
    await clic(boton(raiz, new RegExp(`^${tipo}$`, "i")), tipo);
    if (aliado) await escribir(raiz.querySelector('input[list="aliados-list"]') as HTMLInputElement, aliado);
  }
  return raiz;
}
/** Aéreo costo 800.000 y hotel costo 3.200.000, con markup de 20 % → valores 1.000.000 y 4.000.000 (otros costos: markups 10 % y 15 % mantienen los mismos valores). */
async function agregarServicios(raiz: Element, costoAereo = 800000, costoHotel = 3200000, markups: [number, number] = [20, 20]) {
  await clic(boton(raiz, /^Aéreo$/), "Aéreo");
  await clic(boton(raiz, /^Hotel$/), "Hotel");
  const origen = raiz.querySelector('select[aria-label="Origen de la compra"]') as HTMLSelectElement;
  await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(origen, "plataforma"); origen.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await escribir(campoDe(raiz, "Plataforma (proveedor a pagar)")!, "Despegar");
  await escribir(raiz.querySelector('input[aria-label="Habitaciones Sencilla"]') as HTMLInputElement, "1");
  const costos = [...raiz.querySelectorAll("label")].filter((l) => txt(l) === "Costo neto").map((l) => l.parentElement!.querySelector("input") as HTMLInputElement);
  await escribir(costos[0], String(costoAereo));
  await escribir(costos[1], String(costoHotel));
  const mk = [...raiz.querySelectorAll("label")].filter((l) => txt(l) === "Markup %").map((l) => l.parentElement!.querySelector("input") as HTMLInputElement);
  await escribir(mk[0], String(markups[0]));
  await escribir(mk[1], String(markups[1]));
}
const guardar = (raiz: Element) => boton(raiz, /^Generar cotización$/)!;
const seccionNeto = (raiz: Element) => raiz.querySelector('[data-testid="neto-manual"]');

test("B2B + rol que fija NETO: ofrece PVP/NETO; PVP por defecto con BNC; NETO muestra los valores a mano y quita la BNC", async () => {
  const raiz = await montarForm("administracion", "Viajes Sol SAS");
  await agregarServicios(raiz);
  assert.ok(radio(raiz, /PVP/) && radio(raiz, /NETO/), "las dos modalidades");
  assert.equal(radio(raiz, /PVP/)!.checked, true, "PVP por defecto");
  assert.ok(campoDe(raiz, /^Base no comisionable/), "en PVP está la BNC");
  assert.equal(seccionNeto(raiz), null);

  await clic(radio(raiz, /NETO/), "NETO");
  const s = seccionNeto(raiz);
  assert.ok(s, "aparece la vista previa del NETO");
  const t = txt(s);
  assert.match(t, /Total \(PVP\)\s*\$\s?5\.000\.000/);
  assert.match(t, /Tiquetes aéreos \(no comisionan\)\s*\$\s?1\.000\.000/);
  assert.match(t, /Base comisionable\s*\$\s?4\.000\.000/);
  assert.match(t, /Comisión ordinaria \(12 %\)\s*\$\s?480\.000/);
  assert.match(t, /Descuento total al aliado\s*\$\s?480\.000/);
  assert.match(t, /Costo total de los servicios\s*\$\s?4\.000\.000/);
  assert.match(t, /Margen sobre el NETO \(mínimo 6 %\)\s*11,5\d %/);
  assert.match(t, /NETO que paga el aliado\s*\$\s?4\.520\.000/);
  assert.match(t, /Cumple las reglas de margen/);
  assert.equal(campoDe(raiz, /^Base no comisionable/), null, "en NETO no hay BNC");
  assert.equal(s!.querySelector('[role="alert"]'), null, "sin bloqueo");
});

test("guardar en NETO envía la modalidad (sin BNC); en PVP exige la BNC y no envía modalidad", async () => {
  const raiz = await montarForm("administracion", "Viajes Sol SAS");
  await agregarServicios(raiz);
  await clic(radio(raiz, /NETO/), "NETO");
  await clic(guardar(raiz), "guardar");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.equal(n48.llamadas.length, 1);
  const a = n48.llamadas[0] as { aliadoId: number; bnc: unknown; modalidad: unknown; tipoAsesor: string };
  assert.equal(a.aliadoId, 7);
  assert.equal(a.bnc, null, "NETO no envía BNC");
  assert.deepEqual(a.modalidad, { modalidad: "neto", reconoceRecobro: false, autorizarMargen: false });
  assert.equal(a.tipoAsesor, "agencia");

  n48.llamadas.length = 0;
  await clic(radio(raiz, /PVP/), "PVP");
  assert.equal(seccionNeto(raiz), null);
  await clic(guardar(raiz), "guardar");
  assert.equal(n48.llamadas.length, 0, "PVP sin BNC no llama a la acción");
  assert.match(txt(raiz), /Indica la base no comisionable/);
  await escribir(campoDe(raiz, /^Base no comisionable/)!, "0");
  await clic(guardar(raiz), "guardar");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const p = n48.llamadas[0] as { bnc: unknown; modalidad: unknown };
  assert.equal(p.bnc, 0);
  assert.equal(p.modalidad, undefined, "PVP: la entrada no trae modalidad (camino de siempre)");
});

test("reconocer la participación del recobro: solo aparece con participación > 0 y viaja tal cual", async () => {
  const raiz = await montarForm("administracion", "Viajes Sol SAS");
  await agregarServicios(raiz);
  await clic(radio(raiz, /NETO/), "NETO");
  assert.doesNotMatch(txt(seccionNeto(raiz)), /Reconocer la participación/, "sin recobro no hay casilla");
  await escribir(campoDe(raiz, "Valor del recobro")!, "300000");
  await escribir(raiz.querySelector('input[type="number"][max="300000"]') as HTMLInputElement, "100000");
  assert.match(txt(seccionNeto(raiz)), /Reconocer la participación del aliado en el recobro/);
  // total 5.300.000; base 4.000.000 → 480.000 + 100.000 = 580.000 → NETO 4.720.000 (a mano)
  assert.match(txt(seccionNeto(raiz)), /Participación en el recobro\s*\$\s?100\.000/);
  assert.match(txt(seccionNeto(raiz)), /NETO que paga el aliado\s*\$\s?4\.720\.000/);
  await clic(guardar(raiz), "guardar");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.deepEqual((n48.llamadas[0] as { modalidad: unknown }).modalidad, { modalidad: "neto", reconoceRecobro: true, autorizarMargen: false });
});

test("rol venta, B2C y comparativa: no hay NETO", async () => {
  let raiz = await montarForm("venta", "Viajes Sol SAS");
  assert.equal(radio(raiz, /NETO/), undefined, "venta no fija NETO");
  assert.ok(campoDe(raiz, /^Base no comisionable/), "venta conserva el flujo PVP con BNC");
  await desmontar!(); desmontar = undefined;

  raiz = await montarForm("administracion", "", "interno");
  assert.equal(radio(raiz, /NETO/), undefined, "B2C no tiene NETO");
  await desmontar!(); desmontar = undefined;

  raiz = await montarForm("administracion", "Viajes Sol SAS");
  assert.ok(radio(raiz, /NETO/));
  await clic(boton(raiz, /Cotización comparativa/), "comparativa");
  assert.equal(radio(raiz, /NETO/), undefined, "la comparativa elige su modalidad al elegir la opción (#50), no aquí");
});

test("NETO que la base rechazaría: comisión 0 % y margen bajo sin rol que autorice bloquean en pantalla y no llaman a la acción", async () => {
  // Aliado con comisión 0: descuento 0 → no hay NETO.
  let raiz = await montarForm("administracion", "Comision Cero SAS");
  await agregarServicios(raiz);
  await clic(radio(raiz, /NETO/), "NETO");
  assert.match(txt(seccionNeto(raiz)), /Con descuento 0 no hay precio NETO/);
  await clic(guardar(raiz), "guardar");
  assert.equal(n48.llamadas.length, 0);
  assert.match(txt(raiz), /Con descuento 0 no hay precio NETO/);
  await desmontar!(); desmontar = undefined;

  // Margen 4,87 % (costos 4.300.000 = aéreo 900.000 + hotel 3.400.000): gerencia no autoriza aunque marque la casilla; administración sí.
  raiz = await montarForm("gerencia", "Viajes Sol SAS");
  await agregarServicios(raiz, 900000, 3400000, [10, 15]);
  await clic(radio(raiz, /NETO/), "NETO");
  assert.match(txt(seccionNeto(raiz)), /no cubre el mínimo del 6 %.*superadmin o administración/);
  const casilla = [...seccionNeto(raiz)!.querySelectorAll('input[type="checkbox"]')].find((c) => /Autorizo/.test(txt(c.closest("label")))) as HTMLInputElement;
  assert.ok(casilla, "se ofrece la casilla de autorización");
  await clic(casilla, "autorizar");
  assert.match(txt(seccionNeto(raiz)), /lo autoriza superadmin o administración/, "gerencia marcando sigue bloqueada");
  await clic(guardar(raiz), "guardar");
  assert.equal(n48.llamadas.length, 0);
  await desmontar!(); desmontar = undefined;

  raiz = await montarForm("administracion", "Viajes Sol SAS");
  await agregarServicios(raiz, 900000, 3400000, [10, 15]);
  await clic(radio(raiz, /NETO/), "NETO");
  assert.match(txt(seccionNeto(raiz)), /marca la autorización para continuar/);
  const casilla2 = [...seccionNeto(raiz)!.querySelectorAll('input[type="checkbox"]')].find((c) => /Autorizo/.test(txt(c.closest("label")))) as HTMLInputElement;
  await clic(casilla2, "autorizar");
  assert.equal(seccionNeto(raiz)!.querySelector('[role="alert"]'), null, "administración con la casilla desbloquea");
  await clic(guardar(raiz), "guardar");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.deepEqual((n48.llamadas[0] as { modalidad: unknown }).modalidad, { modalidad: "neto", reconoceRecobro: false, autorizarMargen: true });
});

test("sin aliado elegido la vista previa pide elegirlo y no inventa un NETO", async () => {
  const raiz = await montarForm("administracion", "");
  await agregarServicios(raiz);
  await clic(radio(raiz, /NETO/), "NETO");
  assert.match(txt(seccionNeto(raiz)), /Elige el aliado del catálogo para calcular el NETO/);
  assert.doesNotMatch(txt(seccionNeto(raiz)), /NETO que paga el aliado/);
  await clic(guardar(raiz), "guardar");
  assert.equal(n48.llamadas.length, 0);
});
