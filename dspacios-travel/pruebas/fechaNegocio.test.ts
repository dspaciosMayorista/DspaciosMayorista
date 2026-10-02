// Regla única de fecha de negocio (lib/fechaNegocio.ts): día civil en
// America/Bogota, independiente de la zona del proceso. Bogotá es UTC−5 sin
// horario de verano: el día cambia a las 05:00Z, no a las 00:00Z.
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fechaNegocio, fechaElegidaONegocio, ZONA_NEGOCIO } from "../lib/fechaNegocio.ts";
import { hoyISO } from "../lib/calc/paquetes.ts";
import { hoyBogota as hoyBogotaVigencia } from "../lib/cotizacion/vigencia.ts";
import { hoyBogota as hoyBogotaOrigen } from "../lib/reservar/origen.ts";
import { hoy as hoyCondicionPago } from "../lib/cotizacion/condicionPago.ts";
import { condicionHotelEstadia, type VigenciaHotelCondicion } from "../lib/cotizacion/snapshotCondiciones.ts";

const TZ_ORIGINAL = process.env.TZ;
afterEach(() => { process.env.TZ = TZ_ORIGINAL; mock.timers.reset(); });

const CASOS: Array<[string, string, string]> = [
  // [instante UTC, hora en Bogotá, día de negocio esperado]
  ["2026-09-30T23:30:00.000Z", "18:30 del 30-sep", "2026-09-30"],
  ["2026-09-30T23:59:59.999Z", "18:59:59 del 30-sep", "2026-09-30"],
  ["2026-10-01T00:00:00.000Z", "19:00 del 30-sep", "2026-09-30"],
  ["2026-10-01T00:30:00.000Z", "19:30 del 30-sep", "2026-09-30"],
  ["2026-10-01T04:59:59.999Z", "23:59:59 del 30-sep", "2026-09-30"],
  ["2026-10-01T05:00:00.000Z", "00:00 del 1-oct", "2026-10-01"],
  ["2027-01-01T03:00:00.000Z", "22:00 del 31-dic (cambio de año)", "2026-12-31"],
  ["2028-03-01T02:00:00.000Z", "21:00 del 29-feb (bisiesto)", "2028-02-29"],
];

test("la regla es explícita: America/Bogota", () => {
  assert.equal(ZONA_NEGOCIO, "America/Bogota");
});

for (const [instante, hora, esperado] of CASOS) {
  test(`${hora} Bogotá → ${esperado}, con el proceso en cualquier zona`, () => {
    for (const tz of ["UTC", "America/Bogota", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      process.env.TZ = tz;
      assert.equal(fechaNegocio(new Date(instante)), esperado, `TZ=${tz}`);
    }
  });
}

test("reproducción del defecto: toISOString() salta de día desde las 19:00 Bogotá; la regla no", () => {
  const a1930 = new Date("2026-10-01T00:30:00.000Z");
  assert.equal(a1930.toISOString().slice(0, 10), "2026-10-01", "el cálculo viejo da el día siguiente");
  assert.equal(fechaNegocio(a1930), "2026-09-30");
  const a1830 = new Date("2026-09-30T23:30:00.000Z");
  assert.equal(a1830.toISOString().slice(0, 10), fechaNegocio(a1830), "antes de las 19:00 coincidían");
});

test("fecha elegida por el usuario: se devuelve tal cual, incluso a las 19:30 Bogotá", () => {
  const a1930 = new Date("2026-10-01T00:30:00.000Z");
  assert.equal(fechaElegidaONegocio("2026-09-15", a1930), "2026-09-15");
  assert.equal(fechaElegidaONegocio("2026-10-01", a1930), "2026-10-01", "aunque coincida con el día UTC, es elección del usuario");
  assert.equal(fechaElegidaONegocio(" 2026-09-15 ", a1930), "2026-09-15");
});

test("sin fecha elegida (vacía, espacios, null, undefined) → día de negocio", () => {
  const a1930 = new Date("2026-10-01T00:30:00.000Z");
  for (const v of ["", "   ", null, undefined]) {
    assert.equal(fechaElegidaONegocio(v, a1930), "2026-09-30", JSON.stringify(v));
  }
});

test("los helpers previos (hoyISO, hoyBogota ×2) delegan en la misma regla", () => {
  for (const [instante] of CASOS) {
    const d = new Date(instante);
    assert.equal(hoyBogotaVigencia(d), fechaNegocio(d));
    assert.equal(hoyBogotaOrigen(d), fechaNegocio(d));
  }
  assert.equal(hoyISO(), fechaNegocio());
});

test("condicionPago.hoy() (respaldo sin fechaPago) es el día de Bogotá, también desde las 19:00", () => {
  for (const [instante, , esperado] of CASOS) {
    mock.timers.enable({ apis: ["Date"], now: new Date(instante) });
    assert.equal(hoyCondicionPago(), esperado, instante);
    mock.timers.reset();
  }
});

test("condición de hotel sin fechaPago (cotizar/tarifario): el día límite a las 19:30 sigue en anticipo; el día siguiente exige el 100%", () => {
  // Anticipo 30% con saldo a 30 días; checkin 30-oct → límite del saldo 30-sep.
  const vigencias: VigenciaHotelCondicion[] = [{
    tipo: "anticipo_saldo", pctInicial: 0.3, diasSaldo: 30,
    hotelTemporadaId: 1, nombre: "Temporada", fechaInicio: "2026-10-01", fechaFin: "2026-12-31",
  }];
  const estadia = { fechaIda: "2026-10-30", fechaRegreso: "2026-11-02" };
  for (const [instante, pct] of [
    ["2026-09-30T23:30:00.000Z", 0.3], // 18:30 del 30-sep
    ["2026-10-01T00:30:00.000Z", 0.3], // 19:30 del 30-sep: antes daba 1 (el "hoy" UTC ya era 1-oct)
    ["2026-10-01T05:00:00.000Z", 1],   // 00:00 del 1-oct: ya pasó el límite
  ] as const) {
    mock.timers.enable({ apis: ["Date"], now: new Date(instante) });
    assert.equal(condicionHotelEstadia(estadia, vigencias, {}).pct, pct, instante);
    mock.timers.reset();
  }
});

test("wiring: reservar/actions.ts, contratos/actions.ts y condicionPago.ts ya no calculan 'hoy' con new Date().toISOString()", () => {
  // La aritmética de fechas (sumarDias) y los timestamps (updated_at) siguen permitidos.
  for (const f of [
    "app/(dashboard)/dashboard/reservar/actions.ts",
    "app/(dashboard)/dashboard/contratos/actions.ts",
    "lib/cotizacion/condicionPago.ts",
  ]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /new Date\(\)\.toISOString\(\)\.(slice|substring)\(0,\s*10\)/, f);
    assert.match(src, /fechaNegocio\(\)/, `${f} usa la regla única`);
  }
});

test("wiring: los flujos de abono, pago previo y asientos no calculan 'hoy' con toISOString()", () => {
  // [archivo, fragmento a revisar (null = archivo completo)]. En contratos/
  // actions.ts solo se revisan las acciones de abono: las fechas de CxP del
  // mismo archivo están inventariadas aparte, pendientes de decisión.
  const objetivos: Array<[string, [string, string] | null]> = [
    ["app/(dashboard)/dashboard/contratos/[numero]/AbonoForm.tsx", null],
    ["app/(dashboard)/dashboard/cartera/CarteraList.tsx", null],
    ["app/(dashboard)/dashboard/contratos/actions.ts", ["export async function registrarAbono(", "// ── Editar servicios adicionales"]],
    ["app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts", ["async function postearAsientoFacturacion(", "export async function guardarFacturacion("]],
    ["app/(dashboard)/dashboard/contabilidad/libro-diario/LibroDiarioClient.tsx", null],
    ["app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts", null],
    ["components/cotizacion/PagosPreviosPanel.tsx", null],
    ["lib/contabilidad/asientos.ts", null],
    // Ronda 2 — riesgo alto fuera de archivos compartidos.
    ["app/(dashboard)/dashboard/pagos/PagosList.tsx", null],
    ["app/(dashboard)/dashboard/pagos/actions.ts", null],
    ["app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx", null],
    ["app/(dashboard)/dashboard/contabilidad/retenciones/RetencionesClient.tsx", null],
    ["app/(dashboard)/dashboard/comisiones/ComisionesList.tsx", null],
    ["app/(dashboard)/dashboard/comisiones/actions.ts", null],
    ["app/(dashboard)/dashboard/contabilidad/movimientos/MovimientosClient.tsx", null],
    ["app/(dashboard)/dashboard/contabilidad/movimientos/actions.ts", null],
    ["app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts", ["export async function marcarDian(", "export async function quitarFacturacion("]],
    ["app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts", null],
    ["lib/reservar/asegurarCuentasPorPagar.ts", null],
    ["lib/reservar/reconciliacionFinanciera.ts", null],
    ["app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts", null],
    ["app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx", null],
    ["app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts", null],
  ];
  for (const [f, rango] of objetivos) {
    let src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    if (rango) {
      const i = src.indexOf(rango[0]);
      const j = src.indexOf(rango[1], i);
      assert.ok(i >= 0 && j > i, `${f}: no se encontró el fragmento ${rango[0]}`);
      src = src.slice(i, j);
    }
    // Solo se prohíbe el "hoy" calendario; los timestamps completos (toISOString()) siguen permitidos.
    assert.doesNotMatch(src, /toISOString\(\)\.(slice|substring)\(0,\s*10\)|toISOString\(\)\.split\("T"\)/, f);
    assert.match(src, /fechaNegocio|fechaElegidaONegocio/, `${f} usa la regla única`);
  }
});
