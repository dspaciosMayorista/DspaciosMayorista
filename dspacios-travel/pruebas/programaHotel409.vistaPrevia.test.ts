// PR #409 — vista previa de solo lectura, fórmula visible y paridad editor ↔ ficha ↔ reserva ↔ contrato.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  itemsContratoNoches, pvpNocheUnidad, vacioPorAcom,
  type BaseHotelFila, type HotelEstancia, type NocheTarifaFila, type PorAcom,
} from "../lib/programas/estanciaHotel88.ts";
import {
  construirTablaHotelPvp, cotizarEstanciaDesdePvp, liquidarSeleccion, opcionesPvp, precioUnitarioSalida, resolverBaseHotel, salidaPrecioDesdeBase, tarifasNocheConPvp,
  type ProgramaPrecioCabecera,
} from "../lib/programas/precioReserva57.ts";
import { calcularVistaPrevia } from "../lib/programas/vistaPrevia409.ts";
import { pvpPrograma, pvpProgramaDesglose, pvpProgramaFormula } from "../lib/calc/programaPrecio.ts";

// USD, mk 15 %, fee 3 %, asistencia 4/día, 4 días / 3 noches (mismo escenario que programaEstanciaHotel88.test.ts).
const PROGRAMA: ProgramaPrecioCabecera = { moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4 };
const por = (o: Partial<PorAcom>): PorAcom => ({ ...vacioPorAcom(), ...o });
const HOTEL: HotelEstancia = { id: 1, nombre: "Hotel Centro", zona: "Centro", tipoHabitacion: "Estándar", maxPaxHabitacion: 4, maxMenoresHabitacion: 2, proveedorId: null };
const HOTEL_HAB: HotelEstancia = { ...HOTEL, id: 2, nombre: "Hotel Playa" };
const BASE: BaseHotelFila[] = [
  { id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: por({ sencilla: 800, doble: 600, triple: 520, nino: 400 }) },
  { id: 2, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "regular", bajoSolicitud: false, neto: por({ sencilla: 700, doble: 450, triple: 400, nino: 300 }) },
  { id: 3, hotelId: 2, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: por({ sencilla: 1000, doble: 800, triple: 700, nino: 500 }) },
];
const NOCHES: NocheTarifaFila[] = [
  { id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-04", unidad: "persona", neto: por({ sencilla: 130, doble: 100, triple: 90, nino: 60 }) },
  { id: 2, hotelId: 1, desde: "2027-03-05", hasta: "2027-03-31", unidad: "persona", neto: por({ sencilla: 150, doble: 120, triple: 100, nino: 70 }) },
  { id: 3, hotelId: 2, desde: "2027-03-01", hasta: "2027-03-31", unidad: "habitacion", neto: por({ sencilla: 110, doble: 180, triple: 250 }) },
];
const DIAS = [1, 2, 3, 4].map((dia) => ({ dia, titulo: dia === 4 ? "Salida" : `Día ${dia}`, desayuno: true, almuerzo: false, cena: false, descripcion: null }));
const SEL = { modalidad: "privado" as const, fechaEntrada: "2027-03-01", nochesAdicionales: 2, habitaciones: { doble: 1 } as Record<string, number>, ninos: 1 };
const prev = (over: Record<string, unknown> = {}, hotel = HOTEL, verNetos = true) =>
  calcularVistaPrevia({ programa: PROGRAMA, nochesIncluidas: 3, hotel, base: BASE, noches: NOCHES, seleccion: { ...SEL, ...over }, itinerario: DIAS, verNetos });

// ── Fórmula visible ──────────────────────────────────────────────────────────
test("fórmula paso a paso: neto + asistencia×días → ÷(1−MK) → ÷(1−fee) → techo; el desglose y el PVP cobrado son la MISMA cuenta", () => {
  const d = pvpProgramaDesglose(600, opcionesPvp(PROGRAMA, 4));
  assert.deepEqual(d.pasos.map((p) => p.clave), ["neto", "asistencia", "costo", "markup", "fee", "redondeo"]);
  const v = Object.fromEntries(d.pasos.map((p) => [p.clave, p.valor]));
  assert.equal(v.neto, 600);
  assert.equal(v.asistencia, 16); // 4 × 4 días
  assert.equal(v.costo, 616);
  assert.ok(Math.abs(v.markup - 616 / 0.85) < 1e-9); // 724,70…
  assert.ok(Math.abs(v.fee - 616 / 0.85 / 0.97) < 1e-9); // 747,11…
  assert.equal(v.redondeo, 748); // USD: techo al dólar
  assert.equal(d.pvp, 748);
  assert.equal(d.pvp, pvpPrograma(600, opcionesPvp(PROGRAMA, 4)));
  assert.equal(d.pvp, pvpProgramaFormula(600, opcionesPvp(PROGRAMA, 4)));
});

test("fórmula: el monto sin markup entra DESPUÉS del markup y ANTES del fee; COP redondea al millar", () => {
  const d = pvpProgramaDesglose(1_000_000, { pctMk: 0.2, pctFee: 0.03, asistenciaDia: 0, dias: 1, moneda: "COP" }, 50_000);
  assert.deepEqual(d.pasos.map((p) => p.clave), ["neto", "asistencia", "costo", "markup", "sin_markup", "fee", "redondeo"]);
  assert.equal(d.pasos.find((p) => p.clave === "sin_markup")!.valor, 1_000_000 / 0.8 + 50_000);
  assert.equal(d.pvp % 1000, 0);
});

// ── Paridad ──────────────────────────────────────────────────────────────────
test("paridad: el PVP del editor, la ficha, la vista previa, la reserva y el contrato coincide al centavo", () => {
  const casos: [HotelEstancia, Record<string, number>, number, number][] = [
    [HOTEL, { doble: 1 }, 1, 2],
    [HOTEL, { sencilla: 1, doble: 1 }, 0, 1],
    [HOTEL_HAB, { doble: 2, triple: 1 }, 1, 3],
  ];
  for (const [hotel, hab, ninos, k] of casos) {
    const p = prev({ habitaciones: hab, ninos, nochesAdicionales: k }, hotel);
    assert.ok(p.ok, p.ok ? "" : p.causa);
    if (!p.ok) return;
    const fila = resolverBaseHotel(BASE.filter((b) => b.hotelId === hotel.id), "privado", SEL.fechaEntrada, hotel.nombre);
    assert.ok(fila.ok);
    if (!fila.ok) return;
    // Editor: PVP junto a cada neto (precioUnitarioSalida).
    for (const l of p.base.lineas) assert.equal(l.pvpUnit, precioUnitarioSalida(PROGRAMA, salidaPrecioDesdeBase(fila.fila), l.acomodacion)!.pvp, `editor base ${l.acomodacion}`);
    // Ficha: la tabla pública de PVP.
    const tabla = construirTablaHotelPvp(PROGRAMA, hotel, BASE, NOCHES);
    for (const l of p.base.lineas) assert.equal(l.pvpUnit, tabla.base.find((b) => b.id === fila.fila.id)!.pvp[l.acomodacion as "doble"], `ficha base ${l.acomodacion}`);
    for (const n of p.noches) {
      const t = tabla.noches.find((x) => x.desde === n.vigenciaDesde)!;
      for (const l of n.lineas) assert.equal(l.pvpUnit, t.pvp[l.acomodacion as "doble"], `ficha noche ${n.fecha} ${l.acomodacion}`);
    }
    // Reserva (servidor): liquidarSeleccion.
    const liq = liquidarSeleccion({
      programa: PROGRAMA, fuente: { modo: "salida", salida: salidaPrecioDesdeBase(fila.fila) }, habitaciones: hab, ninos,
      estancia: { hotel, tarifasNoche: tarifasNocheConPvp(PROGRAMA, NOCHES.filter((n) => n.hotelId === hotel.id)), fechaEntrada: SEL.fechaEntrada, nochesIncluidas: 3, nochesAdicionales: k },
    });
    assert.ok(liq.ok);
    if (!liq.ok) return;
    assert.equal(p.total, liq.precioVenta);
    // Navegador (solo PVP): cotizarEstanciaDesdePvp.
    const nav = cotizarEstanciaDesdePvp(tabla, 3, { ...SEL, habitaciones: hab, ninos, nochesAdicionales: k });
    assert.ok(nav.ok);
    if (nav.ok) assert.equal(nav.total, p.total);
    // Contrato: las líneas de noches suman EXACTAMENTE el PVP de las noches.
    const items = itemsContratoNoches(liq.estancia!.noches, hotel.nombre);
    assert.equal(Math.round(items.reduce((s, i) => s + i.valorTotal, 0) * 100), Math.round(p.totalNoches * 100));
    // Cada noche se redondea por separado y luego se suma.
    assert.equal(Math.round(p.noches.reduce((s, n) => s + n.pvp, 0) * 100), Math.round(p.totalNoches * 100));
    assert.equal(Math.round((p.base.total + p.totalNoches) * 100), Math.round(p.total * 100));
  }
});

test("cada línea de la vista previa trae un desglose cuyo PVP es el PVP unitario (mismo motor que el editor)", () => {
  const p = prev();
  assert.ok(p.ok);
  if (!p.ok) return;
  for (const l of [...p.base.lineas, ...(p.base.ninos ? [p.base.ninos] : [])]) assert.equal(l.desglose!.pvp, l.pvpUnit);
  for (const n of p.noches) for (const l of n.lineas) assert.equal(l.desglose!.pvp, l.pvpUnit, `${n.fecha} ${l.acomodacion}`);
  const hab = prev({ habitaciones: { doble: 1 }, ninos: 1 }, HOTEL_HAB);
  assert.ok(hab.ok);
  if (hab.ok) {
    for (const n of hab.noches) for (const l of n.lineas) {
      assert.equal(l.desglose!.pvp, pvpNocheUnidad(l.desglose!.pasos[0].valor, l.incluidoEnHabitacion ? "persona" : n.unidad, l.acomodacion as "doble", opcionesPvp(PROGRAMA, 1)), `${n.fecha} ${l.acomodacion}`);
    }
  }
});

// ── Vista previa ──────────────────────────────────────────────────────────────
test("vista previa: indica la vigencia aplicada, la tarifa de CADA noche extra (por su fecha), asistencia, MK, fee y redondeo", () => {
  const p = prev({ nochesAdicionales: 2 });
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.vigenciaBase, { desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado" });
  assert.deepEqual(p.noches.map((n) => [n.fecha, n.vigenciaDesde]), [["2027-03-04", "2027-03-01"], ["2027-03-05", "2027-03-05"]]);
  assert.deepEqual(p.parametros, { mk: 15, fee: 3, asistenciaDia: 4, redondeo: "hacia arriba al dólar entero" });
  assert.ok(p.asistencia.total > 0 && p.asistencia.dias === 4);
});

test("vista previa: sin tarifa para una fecha, ocupación imposible o precio a solicitud → la causa, nunca un importe inventado", () => {
  const sinTarifa = prev({ fechaEntrada: "2027-06-01" });
  assert.equal(sinTarifa.ok, false);
  assert.match(sinTarifa.ok ? "" : sinTarifa.causa, /No hay precio base/);
  const fueraNoches = prev({ fechaEntrada: "2027-03-30", nochesAdicionales: 3 });
  assert.equal(fueraNoches.ok, false);
  const ocup = prev({ habitaciones: { triple: 1 }, ninos: 3 });
  assert.equal(ocup.ok, false);
  const solicitud = calcularVistaPrevia({ programa: PROGRAMA, nochesIncluidas: 3, hotel: HOTEL, base: [{ ...BASE[0], bajoSolicitud: true }], noches: NOCHES, seleccion: SEL, verNetos: true });
  assert.match(solicitud.ok ? "" : solicitud.causa, /a solicitud/);
});

test("vista previa: con noches extra suma días libres antes del último día y desplaza la recogida", () => {
  const p = prev({ nochesAdicionales: 2 });
  assert.ok(p.ok);
  if (!p.ok || !p.itinerario) return assert.fail("sin itinerario");
  const d = p.itinerario.dias;
  assert.equal(d.length, 6);
  assert.deepEqual(d.map((x) => x.libre), [false, false, false, true, true, false]);
  assert.equal(d[d.length - 1].titulo, "Salida");
  assert.equal(d[d.length - 1].dia, 6);
  assert.equal(p.itinerario.recogida, "2027-03-06"); // entrada 1/mar + 5 días
  const sin = prev({ nochesAdicionales: 0 });
  if (sin.ok) assert.equal(sin.itinerario!.dias.length, 4);
});

test("protección de netos: sin permiso la salida NO lleva desglose ni netos (solo PVP)", () => {
  const p = prev({}, HOTEL, false);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.equal("netos" in p, false);
  assert.doesNotMatch(JSON.stringify(p), /desglose|netos|netoUnit/);
  const conPermiso = prev({}, HOTEL, true);
  assert.ok(conPermiso.ok && conPermiso.netos && conPermiso.netos.costoNeto > 0);
});

test("solo lectura: el módulo de la vista previa no importa Supabase ni escribe nada", () => {
  const src = readFileSync(new URL("../lib/programas/vistaPrevia409.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["'][^"']*supabase|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|fetch\(/i);
});
