// #57 — Paridad de precio de Programas: ficha, formulario y reserva cobran lo mismo.
//
// EJECUCIÓN REAL (sin copias del motor): `getProgramaDetalle` (la ficha pública
// y la fuente de los precios del formulario) corre contra un cliente en memoria
// y su resultado se compara, acomodación por acomodación, con la regla única
// de `lib/programas/precioReserva57.ts` que usa `reservarPrograma`.
//
// Los valores esperados de los vectores salen de ejecutar el módulo real
// `lib/calc/programaPrecio.ts` (no de una fórmula reescrita aquí).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { getProgramaDetalle } from "../lib/programas.ts";
import { pvpPrograma } from "../lib/calc/programaPrecio.ts";
import {
  ACOMODACIONES_SALIDA,
  diasAsistencia,
  evaluarPrecioConfirmado,
  liquidarSeleccion,
  precioCoincide,
  precioUnitarioCategoria,
  precioUnitarioSalida,
  totalDesdePrecios,
  type ProgramaPrecioCabecera,
  type SalidaPrecio,
} from "../lib/programas/precioReserva57.ts";

type Fila = Record<string, unknown>;

/** Cliente en memoria: filtra por `eq`, soporta `maybeSingle` y el thenable de las consultas en lote. */
function clienteFalso(tablas: Record<string, Fila[]>) {
  const sb = {
    from(tabla: string) {
      const filtros: [string, unknown][] = [];
      const filas = () => (tablas[tabla] ?? []).filter((f) => filtros.every(([k, v]) => f[k] === v));
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        order: () => b,
        in: () => b,
        not: () => b,
        eq: (k: string, v: unknown) => { filtros.push([k, v]); return b; },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: filas(), error: null }).then(ok, ko),
      });
      return b;
    },
  };
  return sb as unknown as SupabaseClient<Database>;
}

const base = (over: Partial<ProgramaPrecioCabecera> & Fila = {}): ProgramaPrecioCabecera & Fila => ({
  id: 1, nombre: "Circuito", subtitulo: null, moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03,
  asistencia_medica_dia: 4, modo_precio: "salida", dias: 8, noches: 7,
  regla_comisionable: false, regla_comisionable_modalidad_mk: "historica", regla_comisionable_modo: "pct",
  regla_comisionable_valor: 0, regla_comisionable_pct_comision: 0, regla_comisionable_impuesto_por_acomodacion: false,
  proveedores: { nombre: "Operador" }, programa_destinos_fijos: null,
  ...over,
});

const salida = (id: number, over: Fila = {}): Fila => ({
  id, programa_id: 1, orden: id, etiqueta: `Salida ${id}`, fecha_desde: "2027-03-01", fecha_hasta: "2027-03-08",
  noches: 7, columna: null, bajo_solicitud: false,
  neto_sencilla: 1400, neto_doble: 1000, neto_triple: 900, neto_multiple: 850, neto_nino: 700,
  tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null,
  impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
  ...over,
});

async function ficha(prog: ProgramaPrecioCabecera & Fila, salidas: Fila[], categorias: Fila[] = [], precios: Fila[] = []) {
  const det = await getProgramaDetalle(
    clienteFalso({ programas: [prog], programa_salidas: salidas, programa_categorias: categorias, programa_precios: precios }),
    Number(prog.id),
  );
  assert.ok(det, "la ficha debe existir");
  return det;
}

/** Cada precio que muestra la ficha == el de la regla única (incluidas las acomodaciones sin precio). */
async function afirmarParidadSalidas(prog: ProgramaPrecioCabecera & Fila, salidas: Fila[]) {
  const det = await ficha(prog, salidas);
  assert.equal(det.salidas.length, salidas.length);
  for (const s of det.salidas) {
    const fila = salidas.find((x) => x.id === s.id)!;
    for (const def of ACOMODACIONES_SALIDA) {
      const enFicha = s.precios.find((p) => p.acomodacion === def.acomodacion);
      const mia = precioUnitarioSalida(prog, fila as unknown as SalidaPrecio, def.acomodacion);
      assert.equal(mia?.pvp ?? null, enFicha?.pvp ?? null, `salida ${s.id} ${def.acomodacion}: ficha ${enFicha?.pvp ?? null} vs regla única ${mia?.pvp ?? null}`);
    }
  }
}

describe("días de asistencia: noches explícitas; si son NULL, los días del programa", () => {
  test("regla de días (la de la ficha, no `dias − 1`)", () => {
    assert.equal(diasAsistencia({ dias: 8 }, 7), 7);
    assert.equal(diasAsistencia({ dias: 8 }, null), 8);
    assert.equal(diasAsistencia({ dias: 8 }, undefined), 8);
    assert.equal(diasAsistencia({ dias: null }, null), null);
    assert.equal(diasAsistencia({ dias: 8 }, 0), 0, "0 noches explícitas es un dato, no un faltante");
  });

  test("vector: neto 1.000 USD, mk 15 %, asistencia 4/día, fee 3 % → 1.252 con 8 días (NULL) y 1.247 con 7 noches", () => {
    const p = base();
    const sNull = salida(1, { noches: null }) as unknown as SalidaPrecio;
    const sSiete = salida(2, { noches: 7 }) as unknown as SalidaPrecio;
    assert.equal(precioUnitarioSalida(p, sNull, "doble")?.pvp, 1252, "noches NULL → días del programa (8)");
    assert.equal(precioUnitarioSalida(p, sSiete, "doble")?.pvp, 1247, "noches explícitas (7)");
    assert.equal(pvpPrograma(1000, { pctMk: 0.15, asistenciaDia: 4, dias: 7, pctFee: 0.03, moneda: "USD" }), 1247);
    assert.equal(pvpPrograma(1000, { pctMk: 0.15, asistenciaDia: 4, dias: 8, pctFee: 0.03, moneda: "USD" }), 1252);
  });

  test("la ficha muestra lo mismo con noches NULL y con noches explícitas", async () => {
    await afirmarParidadSalidas(base(), [salida(1, { noches: null }), salida(2, { noches: 7 }), salida(3, { noches: 5 })]);
  });
});

describe("regla 161 (modalidad nueva con tarifa de proveedor) y los tres modos", () => {
  const nuevo = (modo: string, valor: number, extra: Fila = {}) =>
    base({
      regla_comisionable: true, regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final",
      regla_comisionable_modo: modo, regla_comisionable_valor: valor, regla_comisionable_pct_comision: 10, ...extra,
    });

  test("vector: tarifa 1.000, modo pct 3 %, comisión 10 %: modalidad nueva = 1.129 (la ficha), no 1.135 (el neto histórico)", () => {
    const s = salida(1, { neto_doble: 903, tarifa_doble: 1000, noches: null }) as unknown as SalidaPrecio; // noches NULL → 8 días del programa
    const nueva = precioUnitarioSalida(nuevo("pct", 3), s, "doble");
    assert.equal(nueva?.pvp, 1129);
    assert.equal(nueva?.via, "modalidad_nueva");
    const historica = precioUnitarioSalida(base({ ...nuevo("pct", 3), regla_comisionable_modalidad_mk: "historica" }), s, "doble");
    assert.equal(historica?.pvp, 1135);
    assert.equal(historica?.via, "historica");
  });

  for (const modo of ["pct", "impuesto", "ninguno"]) {
    test(`paridad con la ficha, modo ${modo}, modalidad nueva e histórica, con y sin tarifa por acomodación`, async () => {
      const valor = modo === "impuesto" ? 120 : modo === "pct" ? 3 : 0;
      for (const modalidad of ["base_neta_impuestos_al_final", "historica"]) {
        const prog = nuevo(modo, valor, { regla_comisionable_modalidad_mk: modalidad });
        await afirmarParidadSalidas(prog, [
          salida(1, { tarifa_doble: 1000, tarifa_sencilla: 1500, neto_doble: 903, neto_sencilla: 1360 }),
          salida(2, { tarifa_triple: 950, noches: null }),
          salida(3, { bajo_solicitud: true }),
        ]);
      }
    });
  }

  test("modo impuesto por acomodación sin monto configurado: sin precio (como la ficha), nunca un PVP fabricado", async () => {
    const prog = nuevo("impuesto", 100, { regla_comisionable_impuesto_por_acomodacion: true });
    const s = salida(1, { tarifa_doble: 1000, neto_doble: 903, impuesto_doble: null, tarifa_triple: 950, neto_triple: 860, impuesto_triple: 80 });
    await afirmarParidadSalidas(prog, [s]);
    assert.equal(precioUnitarioSalida(prog, s as unknown as SalidaPrecio, "doble"), null);
    assert.ok(precioUnitarioSalida(prog, s as unknown as SalidaPrecio, "triple"));
  });
});

describe("modo categoría, fee y redondeo", () => {
  test("paridad con la ficha en modo categoría (COP y USD, con y sin fee)", async () => {
    for (const [moneda, fee, neto] of [["COP", 0.035, 2_870_000], ["COP", 0, 2_590_000], ["USD", 0.04, 1937.52], ["USD", 0, 1254.5]] as const) {
      const prog = base({ modo_precio: "categoria", moneda, pct_fee_tarjeta: fee, pct_mk: 0.3, asistencia_medica_dia: moneda === "COP" ? 4500 : 2.5, dias: 7 });
      const det = await ficha(prog, [], [{ id: 5, programa_id: 1, orden: 0, nombre: "Turista" }], [
        { categoria_id: 5, acomodacion: "doble", neto, bajo_solicitud: false },
        { categoria_id: 5, acomodacion: "cuadruple", neto: neto * 0.8, bajo_solicitud: false },
        { categoria_id: 5, acomodacion: "triple", neto: 0, bajo_solicitud: false },
        { categoria_id: 5, acomodacion: "sencilla", neto: null, bajo_solicitud: true },
      ]);
      for (const p of det.categorias[0].precios) {
        const mia = precioUnitarioCategoria(prog, { acomodacion: p.acomodacion, neto: p.neto, bajo_solicitud: p.bajo_solicitud });
        assert.equal(mia?.pvp ?? null, p.pvp, `${moneda} ${p.acomodacion}`);
      }
    }
  });

  test("vectores de borde del redondeo (valores del motor real): COP 3.701.000 y USD 1.811", () => {
    const cop = base({ moneda: "COP", pct_mk: 0.3, pct_fee_tarjeta: 0, asistencia_medica_dia: 0 });
    assert.equal(precioUnitarioCategoria(cop, { acomodacion: "doble", neto: 2_590_000, bajo_solicitud: false })?.pvp, 3_701_000);
    const usd = base({ moneda: "USD", pct_mk: 0.3, pct_fee_tarjeta: 0, asistencia_medica_dia: 2.5, dias: 5 });
    assert.equal(precioUnitarioCategoria(usd, { acomodacion: "doble", neto: 1254.5, bajo_solicitud: false })?.pvp, 1811);
  });

  test("el fee es parte del PVP (sube el precio) y NO es impuesto", () => {
    const sinFee = base({ pct_fee_tarjeta: 0, regla_comisionable: true, regla_comisionable_modo: "impuesto", regla_comisionable_valor: 50 });
    const conFee = base({ pct_fee_tarjeta: 0.03, regla_comisionable: true, regla_comisionable_modo: "impuesto", regla_comisionable_valor: 50 });
    const s = salida(1, { tarifa_doble: 1100 }) as unknown as SalidaPrecio;
    const a = precioUnitarioSalida(sinFee, s, "doble")!;
    const b = precioUnitarioSalida(conFee, s, "doble")!;
    assert.ok(b.pvp > a.pvp, "el fee se suma al PVP");
    assert.equal(a.impuestoFiscal, 50);
    assert.equal(b.impuestoFiscal, 50, "el fee no altera el importe fiscal");
  });

  test("neto 0 / a solicitud no se puede reservar (como la ficha, que no lo publica)", () => {
    assert.equal(precioUnitarioCategoria(base(), { acomodacion: "doble", neto: 0, bajo_solicitud: false }), null);
    assert.equal(precioUnitarioCategoria(base(), { acomodacion: "doble", neto: 900, bajo_solicitud: true }), null);
    assert.equal(precioUnitarioSalida(base(), salida(1, { bajo_solicitud: true }) as unknown as SalidaPrecio, "doble"), null);
  });
});

describe("liquidación de la selección: varios pasajeros, niños, infantes", () => {
  const prog = base();
  const fuente = { modo: "salida" as const, salida: salida(1) as unknown as SalidaPrecio };

  test("2 hab. dobles (4 pax) + 1 niño = 1.252×4 + 888 = 5.896 USD; el PVP se redondea por persona, no sobre el total", () => {
    const r = liquidarSeleccion({ programa: prog, fuente: { modo: "salida", salida: salida(1, { noches: null }) as unknown as SalidaPrecio }, habitaciones: { doble: 2 }, ninos: 1, infantes: 0 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.precioVenta, 1252 * 4 + 888);
    assert.equal(r.precioVenta, 5896);
    assert.equal(r.totalPax, 5);
    assert.equal(r.costoNeto, 1000 * 4 + 700, "el costo para la CxP es el neto persistido × pax (sin cambios)");
    assert.equal(r.diasAsistencia, 8);
  });

  test("COP: 3 pax con redondeo por persona = 3 × 1.615.000 = 4.845.000 (si se redondeara el total daría 4.843.000)", () => {
    const cop = base({ moneda: "COP", pct_mk: 0.2, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 3000, dias: 6, modo_precio: "categoria" });
    const r = liquidarSeleccion({ programa: cop, fuente: { modo: "categoria", precios: [{ acomodacion: "triple", neto: 1_234_567, bajo_solicitud: false }] }, habitaciones: { triple: 1 }, ninos: 0 });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.precioVenta, 4_845_000);
  });

  test("infantes suman pasajeros pero no precio; sin nadie se rechaza", () => {
    const sinInfantes = liquidarSeleccion({ programa: prog, fuente, habitaciones: { doble: 1 }, ninos: 0 });
    const conInfantes = liquidarSeleccion({ programa: prog, fuente, habitaciones: { doble: 1 }, ninos: 0, infantes: 2 });
    assert.ok(sinInfantes.ok && conInfantes.ok);
    if (sinInfantes.ok && conInfantes.ok) {
      assert.equal(conInfantes.totalPax, sinInfantes.totalPax + 2);
      assert.equal(conInfantes.precioVenta, sinInfantes.precioVenta);
    }
    const vacio = liquidarSeleccion({ programa: prog, fuente, habitaciones: {}, ninos: 0, infantes: 0 });
    assert.deepEqual(vacio, { ok: false, error: "Indica cuántas habitaciones reservas en cada acomodación." });
  });

  test("mensajes y validaciones del contrato anterior", () => {
    const sinNino = liquidarSeleccion({ programa: prog, fuente: { modo: "salida", salida: salida(1, { neto_nino: null }) as unknown as SalidaPrecio }, habitaciones: { doble: 1 }, ninos: 1 });
    assert.deepEqual(sinNino, { ok: false, error: 'Esta categoría no tiene precio de niño (o es "a solicitud").' });
    const sinPrecio = liquidarSeleccion({ programa: prog, fuente, habitaciones: { cuadruple: 1 }, ninos: 0 });
    assert.deepEqual(sinPrecio, { ok: false, error: 'La acomodación cuadruple no tiene precio (o es "a solicitud") en esta categoría.' });
    const fraccion = liquidarSeleccion({ programa: prog, fuente, habitaciones: { doble: 1.5 }, ninos: 0 });
    assert.equal(fraccion.ok, false, "habitaciones fraccionarias se rechazan");
  });

  test("el total del formulario (precios de la ficha) == el que cobra el servidor, en un barrido determinista de 4.000 programas y selecciones", async () => {
    let x = 20261020;
    const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
    const cubierto = { nueva: 0, fiscal: 0, nochesNull: 0, cop: 0, usd: 0, conNinos: 0, obsoleto: 0 };
    for (let i = 0; i < 4000; i++) {
      const moneda = pick(["COP", "USD"] as const);
      const modo = pick(["pct", "impuesto", "ninguno"] as const);
      const activa = rnd() < 0.7;
      const prog = base({
        moneda, pct_mk: pick([0.12, 0.15, 0.2, 0.25, 0.3]), pct_fee_tarjeta: pick([0, 0.03, 0.035]),
        asistencia_medica_dia: moneda === "COP" ? pick([0, 3000, 4500]) : pick([0, 2.5, 4]), dias: pick([3, 5, 7, 8, null]),
        regla_comisionable: activa, regla_comisionable_modalidad_mk: pick(["historica", "base_neta_impuestos_al_final"]),
        regla_comisionable_modo: modo, regla_comisionable_valor: modo === "pct" ? pick([0, 3, 5]) : modo === "impuesto" ? pick([0, 50, 120]) : 0,
        regla_comisionable_pct_comision: pick([0, 8, 10, 12.5]), regla_comisionable_impuesto_por_acomodacion: rnd() < 0.3,
      });
      const mont = (n: number) => Math.round(n * (moneda === "COP" ? 1_000_000 : 1000) * 100) / 100;
      const tar = (n: number) => (rnd() < 0.6 ? mont(n * 1.1) : null);
      const imp = () => (rnd() < 0.7 ? pick([0, 30, 80, 120]) : null);
      const s = salida(1, {
        noches: pick([null, 4, 5, 7]), bajo_solicitud: rnd() < 0.05,
        neto_sencilla: mont(1.4), neto_doble: mont(1), neto_triple: mont(0.9), neto_multiple: rnd() < 0.5 ? mont(0.85) : null, neto_nino: mont(0.7),
        tarifa_sencilla: tar(1.4), tarifa_doble: tar(1), tarifa_triple: tar(0.9), tarifa_multiple: tar(0.85),
        impuesto_sencilla: imp(), impuesto_doble: imp(), impuesto_triple: imp(), impuesto_multiple: imp(),
      });
      // En modalidad nueva el neto persistido debe ser el vigente; ~10 % de las salidas se dejan
      // obsoletas a propósito y la reserva debe rechazarlas.
      const dejarObsoleto = rnd() < 0.1;
      for (const def of ACOMODACIONES_SALIDA) {
        const u = precioUnitarioSalida(prog, s as unknown as SalidaPrecio, def.acomodacion);
        if (u && u.netoVigente === false && !dejarObsoleto) (s as Fila)[def.neto] = u.netoRecalculado;
      }
      const det = await ficha(prog, [s]);
      const sf = det.salidas[0];
      const adultos = sf.precios.filter((p) => p.acomodacion !== "nino" && p.pvp != null).map((p) => ({ acomodacion: p.acomodacion, pvp: p.pvp }));
      const precioNino = sf.precios.find((p) => p.acomodacion === "nino")?.pvp ?? null;
      const habitaciones: Record<string, number> = {};
      for (const a of adultos) if (rnd() < 0.6) habitaciones[a.acomodacion] = 1 + Math.floor(rnd() * 3);
      const ninos = precioNino != null ? Math.floor(rnd() * 3) : 0;
      if (!Object.keys(habitaciones).length && ninos === 0) continue;
      const liq = liquidarSeleccion({ programa: prog, fuente: { modo: "salida", salida: s as unknown as SalidaPrecio }, habitaciones, ninos });
      if (!liq.ok) {
        assert.equal(liq.codigo, "neto_obsoleto", `iteración ${i}: ${JSON.stringify(liq)}`);
        const hayObsoleta = Object.keys(habitaciones).some((a) => precioUnitarioSalida(prog, s as unknown as SalidaPrecio, a)?.netoVigente === false);
        assert.ok(hayObsoleta, `iteración ${i}: rechazó sin una acomodación obsoleta seleccionada`);
        cubierto.obsoleto++;
        continue;
      }
      if (liq.ok) {
        assert.equal(liq.precioVenta, totalDesdePrecios({ adultos, precioNino, habitaciones, ninos }), `iteración ${i}`);
        if (liq.lineas.some((l) => l.via === "modalidad_nueva")) cubierto.nueva++;
        if (liq.lineas.some((l) => l.impuestoUnit != null)) cubierto.fiscal++;
        if (s.noches == null) cubierto.nochesNull++;
        if (moneda === "COP") cubierto.cop++; else cubierto.usd++;
        if (ninos > 0) cubierto.conNinos++;
      }
    }
    // El barrido no es trivial: de verdad ejercitó cada rama.
    for (const [k, v] of Object.entries(cubierto)) assert.ok(v >= 30, `el barrido casi no cubrió '${k}' (${v})`);
    console.log("cobertura del barrido:", JSON.stringify(cubierto));
  });
});

describe("confirmación del precio", () => {
  test("coincide en centavos; sin importe, NaN o distinto, no coincide", () => {
    assert.equal(precioCoincide(5896, 5896), true);
    assert.equal(precioCoincide("5896", 5896), true);
    assert.equal(precioCoincide(5896.004, 5896), true, "sub-centavo = mismo centavo");
    assert.equal(precioCoincide(5895.99, 5896), false);
    assert.equal(precioCoincide(undefined, 5896), false);
    assert.equal(precioCoincide(null, 5896), false);
    assert.equal(precioCoincide(Number.NaN, 5896), false);
  });

  test("devuelve el nuevo importe y el anterior; sin importe válido, anterior = null", () => {
    assert.deepEqual(evaluarPrecioConfirmado(5896, 5896, "USD"), { ok: true });
    const r = evaluarPrecioConfirmado(5896, 5900, "USD");
    assert.equal(r.ok, false);
    if (!r.ok) { assert.deepEqual(r.cambioPrecio, { anterior: 5896, nuevo: 5900, moneda: "USD" }); assert.match(r.error, /no se creó ningún contrato/); }
    const s = evaluarPrecioConfirmado(undefined, 5900, "USD");
    assert.equal(s.ok, false);
    if (!s.ok) assert.equal(s.cambioPrecio.anterior, null);
  });

  test("un reintento con el importe aceptado se vuelve a evaluar: un segundo cambio exige otra confirmación", () => {
    const primero = evaluarPrecioConfirmado(5896, 5900, "USD");
    assert.equal(primero.ok, false);
    const aceptado = primero.ok ? 0 : primero.cambioPrecio.nuevo;
    assert.deepEqual(evaluarPrecioConfirmado(aceptado, 5900, "USD"), { ok: true }, "el precio se mantuvo: pasa");
    const segundo = evaluarPrecioConfirmado(aceptado, 5910, "USD");
    assert.equal(segundo.ok, false, "cambió otra vez: no pasa");
    if (!segundo.ok) assert.deepEqual(segundo.cambioPrecio, { anterior: 5900, nuevo: 5910, moneda: "USD" });
  });
});
