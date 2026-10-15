// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// #30 (entrega B) · Presentación final del contrato manual en el formulario
// REAL (`NuevoContratoForm`), con la vista previa REAL del servidor
// (`previsualizarNetoContrato`) contra la BD en memoria del arnés:
//   · PVP: "Total del contrato" con el PVP, como siempre.
//   · NETO listo: "Total a pagar (NETO)" con el total exigible del plan.
//   · NETO calculando / con error: ni total, ni margen dado por aprobado, ni
//     se puede generar (tampoco por la aprobación excepcional).
//   · La aprobación excepcional de margen vale solo para los números que la
//     produjeron.
//
// PVP 2.000.000 (1 adulto × 2.000.000), BNC 0, aliado al 10 % → comisión
// 200.000, total NETO 1.800.000.
import { montar, escribir, clic, enviar, usarBD, dom, botonConTexto } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { NuevoContratoForm } = await import("../app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
const { formatMoneda } = await import("../lib/utils.ts");
const h = React.createElement;
const $ = (n: number) => formatMoneda(n, "COP").replace(/ /g, " ");
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

const ALIADO = { id: 7, nombre: "Agencia Prueba", nit: "900", tipo: "agencia", pct_comision: 0.1, aplica_retencion: false, pct_retencion: 0 };

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(() => dom.window.close());

async function cambiar(sel: HTMLSelectElement | undefined, valor: string) {
  if (!sel) throw new Error("no se encontró el select");
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const pausa = (ms: number) => React.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const inputDeEtiqueta = (raiz: Element, etiqueta: string) =>
  [...raiz.querySelectorAll("label")].find((l) => txt(l).startsWith(etiqueta))?.parentElement?.querySelector("input") as HTMLInputElement | null;

/** Monta el formulario con un contrato B2B listo: cliente, PVP 2.000.000, hotel con costo y agencia elegida. */
async function preparar(costoHotel: number, props: Record<string, unknown> = {}) {
  const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor", agencias: [{ id: 7, nombre: "Agencia Prueba" }], ...props }));
  desmontar = m.desmontar;
  const raiz = m.contenedor;
  await escribir(raiz.querySelector('input[required]') as HTMLInputElement, "Cliente Prueba");
  await escribir(inputDeEtiqueta(raiz, "Tarifa adulto")!, "2000000");
  await clic(botonConTexto(raiz, /Agregar hotel/), "Agregar hotel");
  await escribir(raiz.querySelector('input[title="Costo neto del hotel (interno)"]') as HTMLInputElement, String(costoHotel));
  const selects = () => [...raiz.querySelectorAll("select")];
  await cambiar(selects().find((s) => [...s.options].some((o) => o.value === "agencia")), "agencia");
  await cambiar(selects().find((s) => [...s.options].some((o) => o.textContent === "Agencia Prueba")), "7");
  return raiz;
}
const radioNeto = (raiz: Element) => [...raiz.querySelectorAll<HTMLInputElement>('input[name="modoCompra"]')][1];
const generar = (raiz: Element) => botonConTexto(raiz, "Generar contrato") as HTMLButtonElement;
const margen = (raiz: Element) => raiz.querySelector("[data-margen]");
const totalNeto = (raiz: Element) => raiz.querySelector("[data-total-neto]");

test("PVP: 'Total del contrato' con el PVP y margen 20 % aprobado (presentación de siempre)", async () => {
  usarBD({ aliados: [ALIADO] });
  const raiz = await preparar(1_500_000);
  assert.ok(txt(raiz).includes(`Total del contrato:${$(2_000_000)}`), "rótulo y PVP de siempre");
  assert.doesNotMatch(txt(raiz), /Total a pagar \(NETO\)/);
  assert.equal(totalNeto(raiz), null);
  assert.equal(margen(raiz)?.getAttribute("data-margen"), "cumple");
  assert.match(txt(margen(raiz)?.parentElement), /PVP mínimo \(margen 20%\)/);
  assert.equal(generar(raiz).disabled, false);
});

test("NETO calculando → listo: no se aprueba ni se genera hasta tener el plan; luego muestra el total NETO exigible", async () => {
  usarBD({ aliados: [ALIADO] });
  const raiz = await preparar(1_500_000);
  await clic(radioNeto(raiz), "radio NETO");
  // Recién elegido NETO, el plan todavía no llegó (la vista previa espera 400 ms).
  assert.equal(totalNeto(raiz)?.getAttribute("data-total-neto"), "calculando");
  assert.equal(txt(totalNeto(raiz)), "Calculando…");
  assert.doesNotMatch(txt(raiz), /Total del contrato:/, "no se rotula el PVP como total del contrato");
  assert.equal(margen(raiz)?.getAttribute("data-margen"), "pendiente", "el mínimo no se muestra como aprobado");
  assert.match(txt(margen(raiz)?.parentElement), /Total NETO mínimo \(margen 6%\).*pendiente del total NETO/);
  assert.equal(generar(raiz).disabled, true);

  await pausa(500);
  assert.equal(totalNeto(raiz)?.getAttribute("data-total-neto"), "listo");
  assert.equal(txt(totalNeto(raiz)), $(1_800_000));
  assert.match(txt(raiz), /Total a pagar \(NETO\):/);
  assert.equal(margen(raiz)?.getAttribute("data-margen"), "cumple");
  assert.equal(generar(raiz).disabled, false);
});

test("NETO con error del plan: 'No disponible', margen pendiente y no se puede generar", async () => {
  usarBD({ aliados: [] }); // el aliado no está en el catálogo: el servidor no puede calcular el plan
  const raiz = await preparar(1_500_000);
  await clic(radioNeto(raiz), "radio NETO");
  await pausa(500);
  assert.equal(totalNeto(raiz)?.getAttribute("data-total-neto"), "error");
  assert.equal(txt(totalNeto(raiz)), "No disponible");
  assert.match(txt(raiz), /no existe en el catálogo/);
  assert.equal(margen(raiz)?.getAttribute("data-margen"), "pendiente");
  assert.equal(generar(raiz).disabled, true);
  await enviar(raiz.querySelector("form"));
  assert.match(txt(raiz), /no existe en el catálogo/, "enviar igual no genera: muestra el error del plan");
});

test("NETO listo por debajo del 6 %: el mínimo se marca como no cumplido (no 'pendiente' ni aprobado)", async () => {
  usarBD({ aliados: [ALIADO] });
  const raiz = await preparar(1_700_000); // (1.800.000 − 1.700.000) / 1.800.000 = 5,6 %
  await clic(radioNeto(raiz), "radio NETO");
  await pausa(500);
  assert.equal(margen(raiz)?.getAttribute("data-margen"), "no_cumple");
});

test("aprobación excepcional: el aviso vale solo para esos números y se apaga si cambian o si el plan vuelve a calcularse", async () => {
  usarBD({ aliados: [ALIADO] });
  const raiz = await preparar(1_700_000, { puedeForzarMargen: true });
  await clic(radioNeto(raiz), "radio NETO");
  await pausa(500);
  await enviar(raiz.querySelector("form"));
  const aprobar = () => botonConTexto(raiz, /Continuar con la aprobación a pesar del margen/) as HTMLButtonElement | undefined;
  assert.ok(aprobar(), "aparece el aviso con la aprobación excepcional");
  assert.match(txt(raiz), /El total NETO .*1\.800\.000.* no cubre el margen mínimo del 6%/);
  assert.equal(aprobar()!.disabled, false);

  // Cambia el costo: el aviso era para otros números → desaparece.
  await escribir(raiz.querySelector('input[title="Costo neto del hotel (interno)"]') as HTMLInputElement, "1710000");
  assert.equal(aprobar(), undefined);

  // Vuelve el costo original: el aviso solo reaparece si se vuelve a enviar.
  await escribir(raiz.querySelector('input[title="Costo neto del hotel (interno)"]') as HTMLInputElement, "1700000");
  await enviar(raiz.querySelector("form"));
  assert.ok(aprobar());
  // Cambia el PVP: el plan NETO se recalcula; mientras tanto ni el aviso ni la generación.
  await escribir(inputDeEtiqueta(raiz, "Tarifa adulto")!, "2100000");
  assert.equal(totalNeto(raiz)?.getAttribute("data-total-neto"), "calculando");
  assert.equal(aprobar(), undefined);
  assert.equal(generar(raiz).disabled, true);
});
