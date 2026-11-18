import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { liquidarHotelNochesConTemporadas, toTemporadaRango } from "../lib/calc/paquetes.ts";
import { basesPromoDeFilas, filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";
import { promocionesSigueBase, promocionesDinamicasHotel, MAX_LINEAS_MATRIZ, type FilaTarifaFicha } from "../lib/hoteles/promocionesDinamicas.ts";
import { agruparPromoPorCategoria, textoCuentaPromo } from "../lib/hoteles/tarifasVista.ts";
import { generarTarifasDubai, type DubaiParams } from "../lib/calc/calculadoras.ts";
import type { FilaTarifaHotelRaw, FilaTemporadaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";

// #125 — matriz DERIVADA de una promoción que sigue la base ganadora (Tarifas generadas y vista previa de la calculadora).
// Estandar/PAM, BASE A 1–5 dic (doble 100.000), BASE B 6–12 dic (doble 150.000), «PRE BF» 4–8 dic −10 % (prioridad 5).
// Valores del dueño: 4–5 dic BASE A → 108.000 / 90.000 / 85.500 / 81.000 / 45.000 / 36.000 / infante 20.000;
//                    6–8 dic BASE B → 162.000 / 135.000 / 126.000 / 121.500 / 67.500 / 54.000 / infante 30.000.
const HOY = "2026-11-17";
const raw = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const tar = (temporada: string, o: Partial<FilaTarifaHotelRaw>): FilaTarifaHotelRaw =>
  ({ tipo_habitacion: "Estandar", alimentacion: "PAM", temporada, neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...o });
const COL: Record<string, string> = { sencilla: "neto_sencilla", doble: "neto_doble", triple: "neto_triple", multiple: "neto_multiple", nino: "neto_nino", nino2: "neto_nino2", infante: "neto_infante" };
const ETIQ: Record<string, string> = { Sencilla: "sencilla", Doble: "doble", Triple: "triple", "Múltiple": "multiple", "Niño 1": "nino", "Niño 2": "nino2", Infante: "infante" };
const RA = raw({ id: 1, nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
const RB = raw({ id: 2, nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
const PRE = (o: Partial<FilaTemporadaHotelRaw> = {}) => raw({
  id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
  promo_sigue_base: true, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }], ...o,
} as Partial<FilaTemporadaHotelRaw> & { nombre: string });
const TAR = [
  tar("BASE A", { neto_sencilla: 120_000, neto_doble: 100_000, neto_triple: 95_000, neto_multiple: 90_000, neto_nino: 50_000, neto_nino2: 40_000, neto_infante: 20_000 }),
  tar("BASE B", { neto_sencilla: 180_000, neto_doble: 150_000, neto_triple: 140_000, neto_multiple: 135_000, neto_nino: 75_000, neto_nino2: 60_000, neto_infante: 30_000 }),
];
const filas = (t: FilaTarifaHotelRaw[]) => t as unknown as FilaTarifaFicha[];
const valores = (p: ReturnType<typeof promocionesSigueBase>[number], base: string) =>
  Object.fromEntries(p.lineas.filter((l) => l.base === base).map((l) => [l.acomodacion, l.netoResultante]));

describe("matriz derivada — números del dueño (Mixta/común)", () => {
  const [p] = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), filas(TAR));
  test("una promoción, dos tramos con SU base, siete acomodaciones cada uno", () => {
    assert.equal(p.nombre, "PRE BF");
    assert.equal(p.sigueBase, true);
    const tramos = [...new Set(p.lineas.map((l) => `${l.base}|${l.tramo!.desde}|${l.tramo!.hasta}`))];
    assert.deepEqual(tramos, ["BASE A|2026-12-04|2026-12-05", "BASE B|2026-12-06|2026-12-08"]);
    assert.equal(p.lineas.length, 14);
  });
  test("4–5 dic BASE A y 6–8 dic BASE B (nunca un promedio ni una sola base)", () => {
    assert.deepEqual(valores(p, "BASE A"), { Sencilla: 108_000, Doble: 90_000, Triple: 85_500, "Múltiple": 81_000, "Niño 1": 45_000, "Niño 2": 36_000, Infante: 20_000 });
    assert.deepEqual(valores(p, "BASE B"), { Sencilla: 162_000, Doble: 135_000, Triple: 126_000, "Múltiple": 121_500, "Niño 1": 67_500, "Niño 2": 54_000, Infante: 30_000 });
  });
  test("el infante conserva su tarifa base y se marca; ninguna tarifa de niño es cero por la promoción", () => {
    assert.ok(p.lineas.filter((l) => l.acomodacion === "Infante").every((l) => l.conservaBase === true && l.netoResultante === l.netoBase));
    assert.ok(p.lineas.filter((l) => l.acomodacion.startsWith("Niño")).every((l) => (l.netoResultante ?? 0) > 0));
  });
  test("cada importe coincide con el motor compartido, noche por noche, para las siete acomodaciones", () => {
    const vigs = [RA, RB, PRE()].map(toTemporadaRango);
    const porClave = filasPorClave(TAR);
    for (const l of p.lineas) {
      const col = COL[ETIQ[l.acomodacion]];
      const d = liquidarHotelNochesConTemporadas({
        fechaIda: l.tramo!.desde, numNoches: 1, temporadas: vigs, netoPorTemporada: netosDeColumna(porClave, col),
        hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: ETIQ[l.acomodacion],
        ocupantes: ["sencilla", "doble", "triple", "multiple"].includes(ETIQ[l.acomodacion]) ? 2 : undefined,
      });
      assert.ok(d, `${l.acomodacion} ${l.tramo!.desde}`);
      assert.ok(Math.abs(d.total - (l.netoResultante as number)) < 0.5, `${l.base} ${l.acomodacion}: motor ${d.total} vs matriz ${l.netoResultante}`);
    }
  });
  test("agrupa como las promociones por grupo: un bloque por base/tramo, categoría y régimen dentro", () => {
    const bloques = agruparPromoPorCategoria(p.lineas);
    assert.equal(bloques.length, 2);
    assert.deepEqual(bloques.map((b) => b.base), ["BASE A", "BASE B"]);
    assert.ok(bloques.every((b) => b.categorias.length === 1 && b.categorias[0].regimenes[0].regimen === "PAM" && b.categorias[0].tarifas === 7));
    assert.notEqual(bloques[0].clave, bloques[1].clave);
  });
  test("texto del infante y de la tarifa sin base: honesto, sin resta engañosa", () => {
    const fmt = (n: number) => `$${n}`;
    const inf = p.lineas.find((l) => l.acomodacion === "Infante")!;
    assert.match(textoCuentaPromo(inf as never, "descuento_pct", null, fmt), /conserva su tarifa base/);
    const sin = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), filas([tar("BASE A", { neto_doble: 100_000 }), tar("BASE B", { neto_doble: 150_000 })]))[0];
    const sencilla = sin.lineas.find((l) => l.acomodacion === "Sencilla")!;
    assert.equal(sencilla.netoResultante, null);
    assert.match(textoCuentaPromo(sencilla as never, "descuento_pct", null, fmt), /sin tarifa/i);
  });
});

describe("matriz derivada — límites honestos", () => {
  test("empate, sin base o prioridad insuficiente: esas noches NO se muestran como vendibles y quedan en notas", () => {
    const base2 = raw({ id: 3, nombre: "BASE B2", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
    const [p] = promocionesSigueBase([RA, RB, base2, PRE()].map(toTemporadaRango), filas([...TAR, tar("BASE B2", { neto_doble: 150_000 })]));
    assert.deepEqual([...new Set(p.lineas.map((l) => l.base))], ["BASE A"]);
    assert.ok(p.notas?.some((n) => /empate de prioridad/.test(n)));
  });
  test("promoción de prioridad igual a la base: no se vende y no hay filas inventadas", () => {
    const [p] = promocionesSigueBase([RA, RB, PRE({ prioridad: 1 })].map(toTemporadaRango), filas(TAR));
    assert.equal(p.lineas.length, 0);
    assert.equal(p.estado, "no_vende");
  });
  test("regla con días: solo las noches de esos días; las demás conservan la base", () => {
    // 4 dic 2026 = viernes (5), 5 = sábado (6), 6 = domingo (7), 7 = lunes (1), 8 = martes (2)
    const [p] = promocionesSigueBase([RA, RB, PRE({ hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: [5, 6] }] })].map(toTemporadaRango), filas(TAR));
    assert.deepEqual([...new Set(p.lineas.map((l) => `${l.base}|${l.tramo!.desde}|${l.tramo!.hasta}`))], ["BASE A|2026-12-04|2026-12-05"]);
    assert.ok(p.lineas.every((l) => l.dias != null));
  });
  test("adults only: sin niños ni infante", () => {
    const [p] = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), filas(TAR), { adultsOnly: true });
    assert.equal(p.lineas.length, 8);
    assert.ok(p.lineas.every((l) => !l.acomodacion.startsWith("Niño") && l.acomodacion !== "Infante"));
  });
  test("niño gratis: se informa como bandera, la tarifa genérica de niño NO se vuelve cero", () => {
    const [p] = promocionesSigueBase([RA, RB, PRE({ nino_gratis: true })].map(toTemporadaRango), filas(TAR));
    assert.equal(p.ninoGratis, true);
    assert.equal(valores(p, "BASE A")["Niño 1"], 45_000);
  });
  test("acotada: nunca más de MAX_LINEAS_MATRIZ líneas, con aviso", () => {
    const muchas = Array.from({ length: 400 }, (_, i) => tar("BASE A", { tipo_habitacion: `Cat ${i}`, neto_doble: 100_000, neto_nino: 50_000 }));
    const [p] = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), filas(muchas));
    assert.ok(p.lineas.length <= MAX_LINEAS_MATRIZ);
    assert.ok(p.notas?.some((n) => /limitó/.test(n)));
  });
  test("promocionesDinamicasHotel (Tarifas generadas) la incluye desde las filas crudas de la ficha, sin tocar las promociones vinculadas", () => {
    const ficha = [RA, RB, PRE()].map((v) => ({ ...v, id: v.id as number, tipo: v.tipo ?? null, prioridad: v.prioridad ?? null, descuento_valor: v.descuento_valor ?? null, regimen_restringido: null }));
    const out = promocionesDinamicasHotel(ficha as never, filas(TAR), [], "COP");
    assert.equal(out.length, 1);
    assert.equal(out[0].sigueBase, true);
    assert.equal(valores(out[0], "BASE B").Doble, 135_000);
  });
});


describe("matriz derivada — fronteras (fechas, días, cierres, tarifas faltantes), con el motor compartido como contraste", () => {
  const motor = (vigs: ReturnType<typeof toTemporadaRango>[], ida: string, acom = "doble", tarifas = TAR) => {
    const porClave = filasPorClave(tarifas);
    return liquidarHotelNochesConTemporadas({
      fechaIda: ida, numNoches: 1, temporadas: vigs, netoPorTemporada: netosDeColumna(porClave, COL[acom]),
      hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: acom, ocupantes: acom === "doble" ? 2 : undefined,
    });
  };
  const rangos = (p: ReturnType<typeof promocionesSigueBase>[number]) => [...new Set(p.lineas.map((l) => `${l.base}|${l.tramo!.desde}|${l.tramo!.hasta}`))];

  test("bordes de la promoción: 3 dic (antes) y 9 dic (después) no están en la matriz y el motor las vende a la base; 4 y 8 dic sí", () => {
    const vigs = [RA, RB, PRE()].map(toTemporadaRango);
    const [p] = promocionesSigueBase(vigs, filas(TAR));
    const noches = new Set(p.lineas.flatMap((l) => { const o: string[] = []; for (let d = Date.parse(`${l.tramo!.desde}T00:00:00Z`); d <= Date.parse(`${l.tramo!.hasta}T00:00:00Z`); d += 86_400_000) o.push(new Date(d).toISOString().slice(0, 10)); return o; }));
    assert.deepEqual([...noches].sort(), ["2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08"]);
    assert.equal(motor(vigs, "2026-12-03")!.total, 100_000, "3 dic: base A sin promoción");
    assert.equal(motor(vigs, "2026-12-09")!.total, 150_000, "9 dic: base B sin promoción");
    assert.equal(motor(vigs, "2026-12-04")!.total, 90_000);
    assert.equal(motor(vigs, "2026-12-08")!.total, 135_000);
  });
  test("borde entre bases: 5 dic cierra BASE A y 6 dic abre BASE B (dos tramos, nunca uno promediado)", () => {
    const [p] = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), filas(TAR));
    assert.deepEqual(rangos(p), ["BASE A|2026-12-04|2026-12-05", "BASE B|2026-12-06|2026-12-08"]);
  });
  test("grupo de días (domingo = 7): solo el 6 dic; el motor concuerda noche por noche (6 dic con regla, 7 dic sin regla)", () => {
    const vigs = [RA, RB, PRE({ hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: [7] }] })].map(toTemporadaRango);
    const [p] = promocionesSigueBase(vigs, filas(TAR));
    assert.deepEqual(rangos(p), ["BASE B|2026-12-06|2026-12-06"]);
    assert.ok(p.lineas.every((l) => l.dias != null), "la línea dice qué días rigen");
    assert.equal(motor(vigs, "2026-12-06")!.total, 135_000, "domingo: con promoción");
    assert.equal(motor(vigs, "2026-12-07")!.total, 150_000, "lunes: conserva la base");
  });
  test("cierre (blackout) de BASE B el 7 dic: esa noche no se vende (motor = null) y la matriz parte BASE B en dos tramos con la nota", () => {
    const cerrada = raw({ id: 2, nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12", blackouts: [{ fecha_inicio: "2026-12-07", fecha_fin: "2026-12-07" }] });
    const vigs = [RA, cerrada, PRE()].map(toTemporadaRango);
    const [p] = promocionesSigueBase(vigs, filas(TAR));
    assert.deepEqual(rangos(p), ["BASE A|2026-12-04|2026-12-05", "BASE B|2026-12-06|2026-12-06", "BASE B|2026-12-08|2026-12-08"]);
    assert.ok(p.notas?.some((n) => /07\/12\/2026/.test(n) && /ninguna temporada base cubre/.test(n)));
    assert.equal(motor(vigs, "2026-12-07"), null);
    assert.equal(motor(vigs, "2026-12-08")!.total, 135_000);
  });
  test("cierre de la propia promoción el 5 dic: el 5 dic ya no figura y el motor lo vende a la tarifa de BASE A (100.000)", () => {
    const vigs = [RA, RB, PRE({ blackouts: [{ fecha_inicio: "2026-12-05", fecha_fin: "2026-12-05" }] })].map(toTemporadaRango);
    const [p] = promocionesSigueBase(vigs, filas(TAR));
    assert.deepEqual(rangos(p), ["BASE A|2026-12-04|2026-12-04", "BASE B|2026-12-06|2026-12-08"]);
    assert.equal(motor(vigs, "2026-12-05")!.total, 100_000);
  });
  test("tarifa faltante: una acomodación sin tarifa en la base se muestra «sin tarifa» (null), nunca como 0 ni como gratis", () => {
    const sinNino = [tar("BASE A", { neto_doble: 100_000 }), tar("BASE B", { neto_doble: 150_000, neto_nino: 75_000 })];
    const [p] = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), filas(sinNino));
    const a = p.lineas.find((l) => l.base === "BASE A" && l.acomodacion === "Niño 1")!;
    assert.equal(a.netoBase, null); assert.equal(a.netoResultante, null);
    assert.equal(p.lineas.find((l) => l.base === "BASE B" && l.acomodacion === "Niño 1")!.netoResultante, 67_500);
    assert.equal(p.lineas.filter((l) => l.base === "BASE A").length, 7, "las siete se muestran, también las que no tienen tarifa");
  });
  test("niño con tarifa base 0 (gratis publicada): sigue siendo 0 y no se confunde con «sin tarifa»", () => {
    const gratis = [tar("BASE A", { neto_doble: 100_000, neto_nino: 0 }), tar("BASE B", { neto_doble: 150_000, neto_nino: 0 })];
    const [p] = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), filas(gratis));
    const l = p.lineas.find((x) => x.base === "BASE A" && x.acomodacion === "Niño 1")!;
    assert.equal(l.netoBase, 0); assert.equal(l.netoResultante, 0);
  });
  test("infante: el motor lo vende a la base (20.000) aunque la promoción cubra la noche", () => {
    assert.equal(motor([RA, RB, PRE()].map(toTemporadaRango), "2026-12-04", "infante")!.total, 20_000);
  });
  test("régimen restringido a PAM: la matriz de FULL no existe para esa promoción", () => {
    const dosRegimenes = [...TAR, tar("BASE A", { alimentacion: "FULL", neto_doble: 130_000 }), tar("BASE B", { alimentacion: "FULL", neto_doble: 180_000 })];
    const [p] = promocionesSigueBase([RA, RB, PRE({ regimen_restringido: "PAM" })].map(toTemporadaRango), filas(dosRegimenes));
    assert.deepEqual([...new Set(p.lineas.map((l) => l.regimen))], ["PAM"]);
  });
});

describe("matriz derivada — Dubai verificado por sí mismo (dos bases sucesivas, una sola promoción, dos regímenes)", () => {
  // Dubai: régimen base PAM (sin suplemento) + FULL con +30.000 por persona. Modificadores: sencilla +20 %, 3er pax −15 %, 4º pax −25 %, niño −50 %, niño 2 −60 %, infante −80 %.
  // Cálculo a mano (base = doble por persona); el % de una promoción Dubai se aplica a la tarifa COMPLETA del régimen (base + suplemento).
  const params: DubaiParams = {
    regimen_base: "PAM",
    modificadores: { sencilla_pct: 20, pax3_pct: -15, pax4_pct: -25, nino_pct: -50, nino2_pct: -60, infante_pct: -80 },
    suplementos: [{ regimen: "FULL", monto: 30_000 }],
    bases: [
      { categoria: "Estandar", temporada: "BASE A", precio: 100_000 },
      { categoria: "Estandar", temporada: "BASE B", precio: 150_000 },
    ],
  };
  const generadas = generarTarifasDubai(params);
  const guardada = (t: string, r: string) => generadas.find((f) => f.temporada === t && f.alimentacion === r)!;
  const COLS = ["neto_sencilla", "neto_doble", "neto_triple", "neto_multiple", "neto_nino", "neto_nino2", "neto_infante"] as const;
  const fila = (f: ReturnType<typeof guardada>) => COLS.map((c) => f[c]);
  const [p] = promocionesSigueBase([RA, RB, PRE()].map(toTemporadaRango), generadas as unknown as FilaTarifaFicha[]);
  const matriz = (b: string, r: string) => p.lineas.filter((l) => l.base === b && l.regimen === r).map((l) => l.netoResultante);

  test("las filas guardadas que genera Dubai (tabla de BASE) coinciden con el cálculo a mano", () => {
    //                          sencilla   doble     triple    múltiple  niño 1    niño 2   infante
    assert.deepEqual(fila(guardada("BASE A", "PAM")), [120_000, 100_000, 95_000, 90_000, 50_000, 40_000, 20_000]);
    assert.deepEqual(fila(guardada("BASE A", "FULL")), [150_000, 130_000, 125_000, 120_000, 80_000, 70_000, 50_000]);
    assert.deepEqual(fila(guardada("BASE B", "PAM")), [180_000, 150_000, 142_500, 135_000, 75_000, 60_000, 30_000]);
    assert.deepEqual(fila(guardada("BASE B", "FULL")), [210_000, 180_000, 172_500, 165_000, 105_000, 90_000, 60_000]);
  });
  test("matriz completa a mano — BASE A, 4–5 dic (−10 % sobre la tarifa completa del régimen; infante conserva la base)", () => {
    assert.deepEqual(matriz("BASE A", "PAM"), [108_000, 90_000, 85_500, 81_000, 45_000, 36_000, 20_000]);
    assert.deepEqual(matriz("BASE A", "FULL"), [135_000, 117_000, 112_500, 108_000, 72_000, 63_000, 50_000]);
  });
  test("matriz completa a mano — BASE B, 6–8 dic", () => {
    assert.deepEqual(matriz("BASE B", "PAM"), [162_000, 135_000, 128_250, 121_500, 67_500, 54_000, 30_000]);
    assert.deepEqual(matriz("BASE B", "FULL"), [189_000, 162_000, 155_250, 148_500, 94_500, 81_000, 60_000]);
  });
  test("el orden de las acomodaciones es siempre Sencilla → Infante y cada tramo lleva sus 14 tarifas (2 regímenes × 7)", () => {
    assert.deepEqual(p.lineas.slice(0, 7).map((l) => l.acomodacion), ["Sencilla", "Doble", "Triple", "Múltiple", "Niño 1", "Niño 2", "Infante"]);
    assert.equal(p.lineas.filter((l) => l.base === "BASE A").length, 14);
    assert.equal(p.lineas.filter((l) => l.base === "BASE B").length, 14);
  });
  test("coincide con la promoción Dubai por pares en adultos y niños (mismo −10 % sobre la tarifa completa); solo el infante difiere por regla del motor compartido", () => {
    const pares = generarTarifasDubai({ ...params, promos: [{ temporadaBase: "BASE A", temporadaPromo: "PRE A", regimen: "FULL", descuentoPct: 10 }] }).find((f) => f.temporada === "PRE A" && f.alimentacion === "FULL")!;
    assert.deepEqual(fila(pares).slice(0, 6), [135_000, 117_000, 112_500, 108_000, 72_000, 63_000]);
    assert.equal(pares.neto_infante, 45_000, "por pares el infante también se descuenta (50.000 × 0,9)");
    assert.equal(matriz("BASE A", "FULL")[6], 50_000, "por noche sobre la base ganadora el infante conserva su tarifa base");
  });
  test("solo lectura: la promoción por noche no agrega filas guardadas ni toca las de las bases", () => {
    assert.equal(generadas.filter((f) => f.temporada === "PRE BF").length, 0);
    assert.equal(generadas.length, 4);
  });
  test("contraste con el motor compartido: las 14 cifras de FULL salen igual noche por noche", () => {
    const vigs = [RA, RB, PRE()].map(toTemporadaRango);
    const porClave = filasPorClave(generadas as unknown as FilaTarifaHotelRaw[]);
    for (const l of p.lineas.filter((x) => x.regimen === "FULL")) {
      const col = COL[ETIQ[l.acomodacion]];
      const d = liquidarHotelNochesConTemporadas({
        fechaIda: l.tramo!.desde, numNoches: 1, temporadas: vigs, netoPorTemporada: netosDeColumna(porClave, col),
        hoy: HOY, regimen: "FULL", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: ETIQ[l.acomodacion],
        ocupantes: ["sencilla", "doble", "triple", "multiple"].includes(ETIQ[l.acomodacion]) ? 2 : undefined,
      });
      assert.ok(d && Math.abs(d.total - (l.netoResultante as number)) < 0.5, `${l.base} FULL ${l.acomodacion}`);
    }
  });
});
