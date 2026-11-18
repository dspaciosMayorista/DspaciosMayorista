// Se ejecuta con npm run test:react (loader del arnés).
// Owner correction 2026-11-18, round 2 — la forma REAL persistida por las acciones reales (crearCotizacion → cotización B2B asistida NETO → convertirCotizacion; copia desechable, VERIF-GAPS):
// la forma de C-0005 (2 adultos × 732.000, Niño 1 gratis de 366.000, Niño 2 que paga 293.000). PVP 1.757.000 · comisión 175.700 (10 %) · exigible NETO 1.581.300.
// Se renderiza el ContratoDocumento REAL con ese contrato y se comprueba lo que el cliente ve (filas, cantidades, importes NETO, ausencia de PVP/comisión/negativos/promoción).
// Defecto que esta prueba detectó: la línea firmada guardada lleva el hotel delante («Hotel PRE BF 125 ACTIVO · Niño gratis por habitación …») y las filas de niño NO; el plegado no encontraba la fila
// del niño, la línea negativa sobrevivía en el PVP y el NETO perdía los importes por fila. Con la búsqueda sin prefijo (única fila de la clase) el contrato real da dos filas en PVP y en NETO.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { formatMoneda } = await import("../lib/utils.ts");

const F = JSON.parse(readFileSync(new URL("./support/fixtures/netoNinoGratisPersistido2611.json", import.meta.url), "utf8"));
const NBSP = new RegExp(String.fromCharCode(160), "g");
const limpiar = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(NBSP, " ").replace(/\s+/g, " ");
const cop = (n: number) => formatMoneda(n, "COP").replace(NBSP, " ");
const numES = (s: string) => Number(s.replace(/[^0-9,]/g, "").replace(",", "."));
const celdas = (m: string) => [...m.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => limpiar(c[1]).trim());
/** Filas de valor de la tabla «Ítem · Adultos · Niños · Tarifa Adulto · Tarifa Niño · Valor total» (también la del resumen sellado). */
const filasValor = (html: string) => {
  const tabla = html.split("<table").find((x) => x.includes("Tarifa Adulto")) ?? "";
  return [...tabla.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => celdas(m[0])).filter((f) => f.length === 6 && !f.includes("Ítem"));
};
const ventaBase = {
  numero_contrato: F.numero, cliente: "Cliente Prueba", cliente_documento: "1", cliente_direccion: null, cliente_telefono: null, asesor: "Asesor", asesor_firma_nombre: "Asesor", asesor_firma_cargo: "Asesor/a",
  asesor_firma_cc: null, asesor_firma_tel: null, fecha_emision: "2026-11-18", fecha_salida: "2027-06-10", pax: 4, plan_nombre: null, tours_traslados: null, asistencia_medica: null, tenant: "mayorista",
  tipo_asesor: "agencia", agencia_nombre: null, freelance_nombre: null,
};
const items = F.items.map((i: Record<string, unknown>) => ({ ...i, numero_contrato: F.numero }));
const doc = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(ContratoDocumento, { agencia: AGENCIA_PRUEBA, pasajeros: [], hoteles: [], vuelos: [], totalPagado: 0, venta: { ...ventaBase, ...F.venta }, items, ...extra } as never));
const NETO = { netoTotalExigible: F.venta.precio_venta };
// «PRE BF» es parte del NOMBRE REAL del paquete (Paquete PRE BF 125 ACTIVO) y sale en su título; lo que no debe verse es la promoción como beneficio, el cálculo, el PVP, la comisión ni importes negativos.
const NO_VER = /1\.757\.000|175\.700|PRE BF ·|PROMO|por habitación|Niño gratis de «|\(hab\.|-\s?\$/;

test("la fixture es la forma real: PVP 1.757.000, comisión 175.700, exigible 1.581.300, modo neta/descontada y la línea firmada con el hotel delante", () => {
  assert.equal(F.pvp_cotizacion.total, 1_757_000);
  assert.equal(F.plan.comision, 175_700);
  assert.equal(F.plan.total_exigible, 1_581_300);
  assert.deepEqual([F.venta.precio_venta, F.venta.comision_b2b, F.venta.comision_estado, F.venta.modo_compra], [1_581_300, 175_700, "descontada", "neta"]);
  assert.equal(F.items.reduce((s: number, i: { adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number }) => s + i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino, 0), 1_757_000, "Σ ítems guardados = PVP");
  assert.match(F.items[3].descripcion, /^Hotel PRE BF 125 ACTIVO · Niño gratis por habitación/);
  assert.doesNotMatch(F.items[1].descripcion, /^Hotel /, "las filas de niño no llevan el hotel");
});

test("NETO con el resumen SELLADO (como lo sirve la página del contrato): DOS filas — 2 adultos + el niño gratis (1.317.600) y el niño que paga (263.700); Σ = exigible 1.581.300; sin PVP, comisión, negativos ni promoción", () => {
  const html = doc({ ...NETO, resumenPrecios: JSON.parse(F.resumen_precios) });
  const filas = [...html.matchAll(/data-testid="resumen-grupo"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => celdas(m[1]));
  assert.equal(filas.length, 2, JSON.stringify(filas));
  assert.deepEqual(filas[0].slice(1), ["2", "1", cop(658_800), "Niño gratis", cop(1_317_600)], "a mano: 1.464.000 × 0,9 = 1.317.600; 658.800 por adulto");
  assert.deepEqual(filas[1].slice(1), ["0", "1", cop(0), cop(263_700), cop(263_700)], "a mano: 293.000 × 0,9 = 263.700");
  assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_581_300);
  const t = limpiar(html);
  assert.ok(t.includes(`Total del contrato ${cop(1_581_300)}`));
  assert.doesNotMatch(t, NO_VER);
  assert.doesNotMatch(html, /-\s?\$/);
});

test("NETO SIN resumen sellado (contrato sin su snapshot): mismas DOS filas por el reparto proporcional existente; Σ = 1.581.300 (exacto aquí porque la comisión es uniforme del 10 %)", () => {
  const html = doc(NETO);
  const filas = filasValor(html);
  assert.equal(filas.length, 2, JSON.stringify(filas));
  assert.equal(filas[0][0], "1 hab Doble (2 pax) · Estandar / PAM");
  assert.deepEqual([filas[0][1], filas[0][2], filas[0][4]], ["2", "1", "Niño gratis"]);
  assert.deepEqual([filas[1][0], filas[1][1], filas[1][2], filas[1][4]], ["Niño 2 · Estandar / PAM", "0", "1", cop(263_700)]);
  assert.equal(numES(filas[0][5]), 1_317_600);
  assert.equal(numES(filas[1][5]), 263_700);
  assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_581_300);
  assert.ok(limpiar(html).includes(`Total del contrato ${cop(1_581_300)}`));
  assert.doesNotMatch(limpiar(html), NO_VER);
  assert.doesNotMatch(html, /-\s?\$/);
});

test("PVP (cotización/contrato con el mismo contenido): DOS filas — 2 adultos + el niño gratis (1.464.000) y el niño que paga 293.000; Σ = 1.757.000; sin fila negativa ni promoción", () => {
  const pvp = { venta: { ...ventaBase, ...F.venta, precio_venta: F.pvp_cotizacion.total, modo_compra: null, comision_b2b: null, comision_estado: null } };
  for (const extra of [{}, { esCotizacion: true, codigo: "C-0005", vigenciaHasta: "2027-06-01" }]) {
    const html = doc({ ...pvp, ...extra });
    const filas = filasValor(html);
    assert.equal(filas.length, 2, JSON.stringify(filas));
    assert.deepEqual(filas[0].slice(1), ["2", "1", cop(732_000), "Niño gratis", cop(1_464_000)]);
    assert.deepEqual([filas[1][1], filas[1][2], filas[1][4], filas[1][5]], ["0", "1", cop(293_000), cop(293_000)]);
    assert.equal(filas.reduce((s, f) => s + numES(f[5]), 0), 1_757_000);
    assert.ok(limpiar(html).includes(`Total del contrato ${cop(1_757_000)}`));
    assert.doesNotMatch(limpiar(html), /175\.700|\(hab\.|-\s?\$/);
    if (!extra.esCotizacion) assert.doesNotMatch(limpiar(html), /PRE BF|por habitación/);
  }
});
