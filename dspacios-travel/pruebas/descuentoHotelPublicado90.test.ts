import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverDescuentoHotel, pvpPublicadoConDescuento, type ReglaDescuentoHotel } from "../lib/calc/descuentoHotel.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";

// #90 — Lo PUBLICADO (bloqueo / empaquetado / salida) guarda la tarifa BASE; al cotizar y al convertir se recompone el PVP con el descuento de HOY.
// Contrato probado: el repreciado desde la composición publicada == lo que da el motor vivo con las mismas reglas (mismo redondeo, mismas netas).
const REGLAS: ReglaDescuentoHotel[] = [
  { tipo: "ebb", umbral: 30, pct: 18 }, { tipo: "ebb", umbral: 60, pct: 23 }, { tipo: "ebb", umbral: 90, pct: 28 }, { tipo: "long_stay", umbral: 4, pct: 25 },
];
const RESERVA = "2026-03-01";
const ida = (dias: number) => new Date(Date.parse(`${RESERVA}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const temp = (): FilaTemporadaHotelRaw => ({ nombre: "ANUAL", fecha_inicio: "2026-01-01", fecha_fin: "2027-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null });
const tar = (o: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw => ({ tipo_habitacion: "Estandar", alimentacion: "FULL", temporada: "ANUAL", neto_sencilla: 150_000, neto_doble: 100_001, neto_triple: 90_000, neto_multiple: null, neto_nino: 50_000, neto_nino2: 30_000, neto_infante: 20_000, ...o });
const datos = (o: Partial<DatosHotelPaquete> = {}): DatosHotelPaquete => ({
  paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "San Andres", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2027-12-31" },
  armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel X", hotel_moneda: "COP" },
  temporadas: [temp()], tarifas: [tar()], serviciosIncluidos: [], blackouts: [], vuelo: { aporte: 400_000, feeInfante: 60_000 },
  reglasDescuento: [], fechaReserva: RESERVA, ...o,
});
const sinDescuento = (dias: number, noches: number) => evaluarHotelPorFechas(datos(), ida(dias), noches)!;
const conDescuento = (dias: number, noches: number) => evaluarHotelPorFechas(datos({ reglasDescuento: REGLAS }), ida(dias), noches)!;

function repreciar(dias: number, noches: number, moneda = "COP") {
  const pub = sinDescuento(dias, noches); const c = pub.combos[0]; const b = pub.composicionBase!;
  const descuento = resolverDescuentoHotel(REGLAS, { fechaReserva: RESERVA, fechaIda: ida(dias), numNoches: noches });
  const base = { pctMk: b.pctMk, vuelo: b.vuelo, feeInfante: b.feeInfante, fijo: b.fijo, servicios: b.servicios, netos: c.netos!,
    pvps: Object.fromEntries(Object.entries(c.precios).map(([k, v]) => [k, { pvp: v, pvpMenor2: c.preciosMenor2?.[k] ?? null }])) };
  const out: Record<string, { pvp: number | null; neto: number | null }> = {};
  for (const k of Object.keys(c.precios)) {
    const r = pvpPublicadoConDescuento(base, { clave: k, pvpPublicado: c.precios[k], menorDeDos: false, descuento, moneda });
    out[k] = { pvp: r?.pvp ?? null, neto: r?.neto ?? null };
  }
  const menor2: Record<string, number | null> = {};
  for (const k of Object.keys(c.preciosMenor2 ?? {})) menor2[k] = pvpPublicadoConDescuento(base, { clave: k, pvpPublicado: c.preciosMenor2![k], menorDeDos: true, descuento, moneda })?.pvp ?? null;
  return { out, menor2, descuento };
}

describe("repreciado de lo publicado == motor vivo (mismo redondeo y netas)", () => {
  // 29/30, 59/60, 89/90 días con 3 noches y la frontera de Long Stay 3/4 noches.
  const casos: [number, number][] = [[29, 3], [30, 3], [59, 3], [60, 3], [89, 3], [90, 3], [10, 3], [10, 4], [45, 4], [120, 4]];
  for (const [dias, noches] of casos) {
    test(`${dias} días, ${noches} noches`, () => {
      const vivo = conDescuento(dias, noches); const c = vivo.combos[0];
      const { out, menor2 } = repreciar(dias, noches);
      for (const k of Object.keys(c.precios)) {
        assert.equal(out[k].pvp, c.precios[k], `PVP ${k}`);
        assert.equal(out[k].neto, c.netos![k], `neta ${k}`);
      }
      for (const k of Object.keys(c.preciosMenor2 ?? {})) assert.equal(menor2[k], c.preciosMenor2![k], `PVP menor de 2 ${k}`);
    });
  }
  test("sin descuento el precio publicado queda tal cual y las netas no cambian (netas y temporadas base intactas)", () => {
    const { out, descuento } = repreciar(29, 3);
    const c = sinDescuento(29, 3).combos[0];
    assert.equal(descuento, null);
    for (const k of Object.keys(c.precios)) { assert.equal(out[k].pvp, c.precios[k]); assert.equal(out[k].neto, c.netos![k]); }
  });
  test("el descuento mayor gana y nunca se acumula (90 días y 4 noches: 28 %, no 25 % ni 53 %)", () => {
    assert.equal(repreciar(90, 4).descuento?.pct, 28);
    assert.equal(repreciar(45, 4).descuento?.pct, 25);
  });
  test("USD: centavos en la neta, dólar entero hacia arriba en el PVP", () => {
    const d = datos({ armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "H", hotel_moneda: "USD" }, tarifas: [tar({ neto_doble: 100.55 })] });
    const pub = evaluarHotelPorFechas(d, ida(30), 3)!; const viv = evaluarHotelPorFechas({ ...d, reglasDescuento: REGLAS }, ida(30), 3)!;
    const b = pub.composicionBase!; const c = pub.combos[0];
    const base = { pctMk: b.pctMk, vuelo: b.vuelo, feeInfante: b.feeInfante, fijo: b.fijo, servicios: b.servicios, netos: c.netos!, pvps: Object.fromEntries(Object.entries(c.precios).map(([k, v]) => [k, { pvp: v, pvpMenor2: null }])) };
    const r = pvpPublicadoConDescuento(base, { clave: "doble", pvpPublicado: c.precios.doble, menorDeDos: false, descuento: { tipo: "ebb", umbral: 30, pct: 18 }, moneda: "USD" })!;
    assert.equal(r.pvp, viv.combos[0].precios.doble);
    assert.equal(r.neto, viv.combos[0].netos!.doble);
  });
});

describe("el precio publicado se acredita antes de descontarlo", () => {
  const base = { pctMk: 0.2, vuelo: 0, feeInfante: 0, servicios: [], netos: { doble: 300_000 }, pvps: { doble: { pvp: 375_000, pvpMenor2: null } } };
  const d18 = { tipo: "ebb" as const, umbral: 30, pct: 18 };
  test("PVP distinto al de la composición: null (falla cerrado, no se inventa un precio)", () =>
    assert.equal(pvpPublicadoConDescuento(base, { clave: "doble", pvpPublicado: 380_000, menorDeDos: false, descuento: d18, moneda: "COP" }), null));
  test("acomodación sin neta en la composición: null", () =>
    assert.equal(pvpPublicadoConDescuento(base, { clave: "triple", pvpPublicado: 1, menorDeDos: false, descuento: d18, moneda: "COP" }), null));
  test("servicios incluidos NO se descuentan: solo el aporte del hotel baja", () => {
    const b = { ...base, servicios: [{ nombre: "Tour", neto: 80_000, netoMenor: 40_000 }], pvps: { doble: { pvp: 475_000, pvpMenor2: null } } }; // 375.000 + 80.000/0,8
    const r = pvpPublicadoConDescuento(b, { clave: "doble", pvpPublicado: 475_000, menorDeDos: false, descuento: d18, moneda: "COP" })!;
    assert.equal(r.pvp, 408_000); // 246.000/0,8 = 307.500 + 100.000 = 407.500, redondeo de venta al mil
  });
  test("PVP fijo del infante queda como está", () => {
    const b = { ...base, fijo: { mayor2: true, menor2: false }, netos: { infante: 0 }, pvps: { infante: { pvp: 90_000, pvpMenor2: null } } };
    assert.equal(pvpPublicadoConDescuento(b, { clave: "infante", pvpPublicado: 90_000, menorDeDos: false, descuento: d18, moneda: "COP" })!.pvp, 90_000);
  });
});

describe("fecha de compra: servidor, no cliente; publicación sin porcentaje congelado", () => {
  const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("el checkout de lo publicado usa fechaNegocio() del servidor y recompone desde la composición", () => {
    const c = leer("lib/reservar/computo.ts");
    assert.match(c, /fechaReserva: fechaNegocio\(\)/);
    assert.match(c, /pvpPublicadoConDescuento\(/);
    assert.doesNotMatch(c, /input\.fechaReserva|input\.fechaCompra/);
  });
  test("el publicador NO aplica descuentos: la fila publicada es siempre la tarifa base", () => {
    for (const f of ["app/(dashboard)/dashboard/paquetes/actions.ts", "lib/tarifario/vigencia.ts", "lib/tarifario/composicionTarifario.ts"]) assert.doesNotMatch(leer(f), /descuentoHotel|hotel_reglas_descuento/, f);
  });
  test("cotizar un día y convertir otro: más cerca del check-in, menos descuento, el precio sube", () => {
    const viaje = ida(90);
    const pct = (hoy: string) => resolverDescuentoHotel(REGLAS, { fechaReserva: hoy, fechaIda: viaje, numNoches: 3 })?.pct ?? 0;
    assert.equal(pct(RESERVA), 28);
    assert.equal(pct(ida(1)), 23);
    assert.equal(pct(ida(31)), 18);
    assert.equal(pct(ida(61)), 0);
  });
});
