// Se ejecuta con npm run test:react (loader del arnés).
//
// #30 · Incidencia vigente desde #38: el documento del contrato sumaba los
// ítems (a PVP) como "Total del contrato" y calculaba el saldo contra esa suma,
// así que un contrato NETO le mostraba —y le cobraba— el PVP completo al
// comprador B2B. Aquí se renderiza el componente REAL a HTML y se comprueba que
// un NETO muestra el total exigible y su saldo, sin el PVP ni la comisión del
// aliado en ninguna parte, y que un contrato que no es NETO queda idéntico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { formatMoneda } = await import("../lib/utils.ts");

// PVP 2.000.000 = 2 adultos × 950.000 (alojamiento) + 100.000 (servicio).
// Aliado al 10 % sobre PVP − BNC (400.000) → comisión 160.000 → NETO 1.840.000.
const PVP = 2_000_000;
const NETO = 1_840_000;
const COMISION = 160_000;
const PAGADO = 500_000;

const venta = {
  numero_contrato: "DTM-0900", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null,
  cliente_telefono: null, asesor: "Asesora Interna", asesor_firma_nombre: "Asesora Interna", asesor_firma_cargo: "Asesor/a",
  asesor_firma_cc: null, asesor_firma_tel: null, estado: "activo", fecha_emision: "2026-10-10", fecha_salida: "2026-12-01",
  pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null,
  moneda: "COP", tenant: "mayorista", tipo_asesor: "agencia", agencia_nombre: "Agencia Aliada", freelance_nombre: null,
};
const items = [
  { id: 1, numero_contrato: "DTM-0900", descripcion: "Doble · Estándar/PAM", adultos: 2, ninos: 0, tarifa_adulto: 950_000, tarifa_nino: 0, orden: 0, modo_precio: "por_persona", valor_total: null },
  { id: 2, numero_contrato: "DTM-0900", descripcion: "Servicio · Traslado aeropuerto", adultos: 1, ninos: 0, tarifa_adulto: 100_000, tarifa_nino: 0, orden: 1, modo_precio: "por_persona", valor_total: null },
];

function render(netoTotalExigible: number | null) {
  const props = {
    venta, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: PAGADO, agencia: null, condiciones: null,
    habitacionesBernalo: [], netoTotalExigible,
  } as unknown as Parameters<typeof ContratoDocumento>[0];
  const html = renderToStaticMarkup(createElement(ContratoDocumento, props));
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
}
const $ = (n: number) => formatMoneda(n, "COP").replace(/ /g, " ");

test("NETO: el documento muestra el total exigible y su saldo, nunca el PVP", () => {
  const texto = render(NETO);
  assert.ok(texto.includes(`Total del contrato ${$(NETO)}`), "total = total exigible");
  assert.ok(texto.includes(`Saldo pendiente ${$(NETO - PAGADO)}`), "saldo contra el total exigible");
  assert.ok(!texto.includes($(PVP)), "no aparece el PVP completo");
  assert.ok(!texto.includes($(PVP - PAGADO)), "no aparece el saldo calculado a PVP");
});

test("NETO: muestra tarifas prorrateadas por persona sin revelar PVP ni comisión", () => {
  const texto = render(NETO);
  for (const v of [COMISION, 950_000, 1_900_000, 100_000]) {
    assert.ok(!texto.includes($(v)), `no aparece ${$(v)}`);
  }
  assert.doesNotMatch(texto, /comisi[oó]n/i);
  assert.match(texto, /Tarifa Adulto NETO/);
  assert.match(texto, /Valor total NETO/);
  assert.ok(texto.includes($(874_000)), "tarifa neta por adulto");
  assert.ok(texto.includes($(1_748_000)), "subtotal neto de dos adultos");
  assert.ok(texto.includes($(92_000)), "servicio prorrateado a NETO");
  assert.match(texto, /Doble · Estándar\/PAM/);
  assert.match(texto, /Traslado aeropuerto/);
  assert.doesNotMatch(texto, /Valor total acordado para el paquete/);
});

test("NETO manual de dos adultos: cada persona ve la mitad neta exigible", () => {
  const plan = [{ ...items[0], tarifa_adulto: 1_000_000 }];
  const html = renderToStaticMarkup(createElement(ContratoDocumento, {
    venta, pasajeros: [], hoteles: [], vuelos: [], items: plan, totalPagado: 0, netoTotalExigible: 1_897_200,
  } as never)).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
  assert.match(html, /Tarifa Adulto NETO/);
  assert.ok(html.includes($(948_600)));
  assert.ok(html.includes($(1_897_200)));
  assert.ok(!html.includes($(1_000_000)) && !html.includes($(2_000_000)));
  assert.doesNotMatch(html, /Valor total acordado para el paquete/);
});

test("NETO sin desglose conciliable muestra solo el total y nunca una tarifa PVP", () => {
  const html = renderToStaticMarkup(createElement(ContratoDocumento, {
    venta, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: 0, netoTotalExigible: PVP + 1,
  } as never)).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
  assert.ok(html.includes($(PVP + 1)));
  assert.doesNotMatch(html, /Tarifa Adulto/);
  assert.ok(!html.includes($(950_000)) && !html.includes($(100_000)));
});

test("no NETO: el documento queda exactamente como antes (suma de ítems y valores por ítem)", () => {
  const texto = render(null);
  assert.ok(texto.includes(`Total del contrato ${$(PVP)}`));
  assert.ok(texto.includes(`Saldo pendiente ${$(PVP - PAGADO)}`));
  assert.ok(texto.includes($(950_000)) && texto.includes($(1_900_000)) && texto.includes($(100_000)));
  assert.doesNotMatch(texto, /Valor total acordado para el paquete/);
});

test("Minorista PVP conserva las tarifas originales por persona", () => {
  const html = renderToStaticMarkup(createElement(ContratoDocumento, {
    venta: { ...venta, tenant: "minorista" }, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: PAGADO,
  } as never)).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
  assert.ok(html.includes($(950_000)) && html.includes($(1_900_000)));
  assert.doesNotMatch(html, /Tarifa Adulto NETO/);
});

test("render sin la prop (páginas que no la pasan) = comportamiento de siempre", () => {
  const props = {
    venta, pasajeros: [], hoteles: [], vuelos: [], items, totalPagado: PAGADO,
  } as unknown as Parameters<typeof ContratoDocumento>[0];
  const texto = renderToStaticMarkup(createElement(ContratoDocumento, props)).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
  assert.ok(texto.includes(`Total del contrato ${$(PVP)}`));
});
