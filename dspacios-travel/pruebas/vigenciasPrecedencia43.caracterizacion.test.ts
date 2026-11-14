import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  liquidarHotelNoches,
  liquidarHotelNochesConTemporadas,
  liquidarHotelMasBarato,
  resolverNetoNocheDetallado,
  toTemporadaRango,
  type TemporadaRango,
} from "../lib/calc/paquetes.ts";

// ─────────────────────────────────────────────────────────────────────────
// CARACTERIZACIÓN #43/#60 (entrega E3) — motor por noche (`lib/calc/paquetes.ts`).
//
// Estas pruebas DOCUMENTAN el comportamiento ACTUAL. No aprueban que sea el deseado: los casos marcados
// «RIESGO CONOCIDO» describen huecos que el diseño (docs/tecnico/vigencias-por-dia-43-60.md, §E.2 y §G.8) propone
// cambiar solo para vigencias con grupos de días y solo con decisión del dueño. Si una entrega futura altera alguno
// de estos resultados para un hotel SIN grupos, esta prueba debe fallar y el cambio debe ser consciente.
// Sin Supabase, sin reloj: `hoy` explícito en cada llamada; fechas fijas de 2027.
// ─────────────────────────────────────────────────────────────────────────

const HOY = "2026-11-10";

function vig(over: Partial<Parameters<typeof toTemporadaRango>[0]> & { nombre: string }): TemporadaRango {
  return toTemporadaRango({
    fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa",
    descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...over,
  });
}
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);
function desglose(temporadas: TemporadaRango[], neto: Record<string, number | null>, ida: string, n: number, regimen = "PAM") {
  const base = new Date(`${ida}T00:00:00`).getTime();
  return Array.from({ length: n }, (_, i) => {
    const t0 = base + i * 86_400_000;
    const r = resolverNetoNocheDetallado(t0, temporadas, neto, HOY, regimen);
    return `${ISO(t0)} ${r ? `${r.temporadaGanadora}=${r.neto}` : "SIN PRECIO"}`;
  });
}
const total = (temporadas: TemporadaRango[], neto: Record<string, number | null>, ida: string, n: number) =>
  liquidarHotelNochesConTemporadas({ fechaIda: ida, numNoches: n, temporadas, netoPorTemporada: neto, hoy: HOY, regimen: "PAM" })?.total ?? null;

describe("1. Otra vigencia base gana por prioridad", () => {
  const tp = [vig({ nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1 }),
              vig({ nombre: "PUENTE", fecha_inicio: "2027-01-10", fecha_fin: "2027-01-12", prioridad: 3 })];
  const neto = { ALTA: 100_000, PUENTE: 200_000 };
  test("9 → 13 ene: 100.000 + 3 × 200.000 = 700.000", () => {
    assert.deepEqual(desglose(tp, neto, "2027-01-09", 4), [
      "2027-01-09 ALTA=100000", "2027-01-10 PUENTE=200000", "2027-01-11 PUENTE=200000", "2027-01-12 PUENTE=200000",
    ]);
    assert.equal(total(tp, neto, "2027-01-09", 4), 700_000);
  });
});

describe("2. RIESGO CONOCIDO — una promoción con fila de OTRA base «rescata» las noches donde esa base perdió", () => {
  // PROMO-ALTA (prioridad 4) cubre todo enero y trae fila derivada de ALTA; PUENTE (prioridad 3) es la base que gana 10–12.
  const tp = [vig({ nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1 }),
              vig({ nombre: "PUENTE", fecha_inicio: "2027-01-10", fecha_fin: "2027-01-12", prioridad: 3 }),
              vig({ nombre: "PROMO-ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 4, tipo: "descuento_pct", descuento_valor: 10 })];
  const neto = { ALTA: 100_000, PUENTE: 200_000, "PROMO-ALTA": 90_000 };
  test("hoy el motor NO consulta temporada_base: la promo gana también 10–12 (360.000; con guard sería 90.000 + 3 × 200.000 = 690.000)", () => {
    assert.deepEqual(desglose(tp, neto, "2027-01-09", 4), [
      "2027-01-09 PROMO-ALTA=90000", "2027-01-10 PROMO-ALTA=90000", "2027-01-11 PROMO-ALTA=90000", "2027-01-12 PROMO-ALTA=90000",
    ]);
    assert.equal(total(tp, neto, "2027-01-09", 4), 360_000);
  });
  test("promo SIN fila para el combo: cae a la base de la noche (700.000)", () => {
    assert.equal(total(tp, { ...neto, "PROMO-ALTA": null }, "2027-01-09", 4), 700_000);
  });
});

describe("3. RIESGO CONOCIDO — la vigencia BASE prioritaria sin fila cae en silencio a la inferior", () => {
  const tp = [vig({ nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1 }),
              vig({ nombre: "PUENTE", fecha_inicio: "2027-01-10", fecha_fin: "2027-01-12", prioridad: 3 })];
  test("PUENTE sin precio para este combo: las 4 noches se venden a ALTA (400.000), no se bloquean", () => {
    assert.equal(total(tp, { ALTA: 100_000, PUENTE: null }, "2027-01-09", 4), 400_000);
  });
  test("ninguna vigencia con precio en alguna noche → null (esa estadía no se vende)", () => {
    assert.equal(total(tp, { ALTA: null, PUENTE: null }, "2027-01-09", 4), null);
  });
});

describe("4. RIESGO CONOCIDO — empate de prioridad: decide el ORDEN en que llegan las vigencias", () => {
  const A = vig({ nombre: "TEMP-A", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1 });
  const B = vig({ nombre: "TEMP-B", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1 });
  const neto = { "TEMP-A": 100_000, "TEMP-B": 150_000 };
  test("orden A,B → 100.000 por noche; orden B,A → 150.000 por noche", () => {
    assert.deepEqual(desglose([A, B], neto, "2027-01-05", 2), ["2027-01-05 TEMP-A=100000", "2027-01-06 TEMP-A=100000"]);
    assert.deepEqual(desglose([B, A], neto, "2027-01-05", 2), ["2027-01-05 TEMP-B=150000", "2027-01-06 TEMP-B=150000"]);
  });
});

describe("5. «N noches, 1 gratis» descuenta el PROMEDIO de las noches (no una noche concreta)", () => {
  // Dos semanas con precio distinto por vigencia: lun–jue 100.000, vie–dom 150.000.
  const tp = [
    vig({ nombre: "SEMANA-1", fecha_inicio: "2027-01-04", fecha_fin: "2027-01-07" }),
    vig({ nombre: "FINDE-1", fecha_inicio: "2027-01-08", fecha_fin: "2027-01-10" }),
    vig({ nombre: "SEMANA-2", fecha_inicio: "2027-01-11", fecha_fin: "2027-01-14" }),
    vig({ nombre: "GRATIS", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 5, tipo: "promo_noche_gratis", min_noches: 3 }),
  ];
  const neto = { "SEMANA-1": 100_000, "FINDE-1": 150_000, "SEMANA-2": 100_000 };
  test("jue 7 → dom 10 (100.000 + 150.000 + 150.000 = 400.000): paga 2/3 = 266.667", () => {
    const t = total(tp, neto, "2027-01-07", 3)!;
    assert.ok(Math.abs(t - 266_666.6667) < 0.01, `total ${t}`);
  });
  test("dom 10 → mié 13 (150.000 + 100.000 + 100.000 = 350.000): paga 2/3 = 233.333", () => {
    const t = total(tp, neto, "2027-01-10", 3)!;
    assert.ok(Math.abs(t - 233_333.3333) < 0.01, `total ${t}`);
  });
  test("estadía de 2 noches (por debajo de min_noches=3): sin descuento", () => {
    assert.equal(total(tp, neto, "2027-01-07", 2), 250_000);
  });
});

describe("6. RIESGO CONOCIDO — el «desde» de la ventana es la noche más barata × noches (puede no existir como estadía)", () => {
  const tp = [vig({ nombre: "SEMANA-1", fecha_inicio: "2027-01-04", fecha_fin: "2027-01-07" }),
              vig({ nombre: "FINDE-1", fecha_inicio: "2027-01-08", fecha_fin: "2027-01-10" })];
  const neto = { "SEMANA-1": 100_000, "FINDE-1": 150_000 };
  const real = (ida: string) => liquidarHotelNoches({ fechaIda: ida, numNoches: 5, temporadas: tp, netoPorTemporada: neto, hoy: HOY, regimen: "PAM" });
  test("ventana 4–10 ene, 5 noches: el helper anuncia 500.000", () => {
    assert.equal(liquidarHotelMasBarato({ desde: "2027-01-04", hasta: "2027-01-10", numNoches: 5, temporadas: tp, netoPorTemporada: neto, hoy: HOY, regimen: "PAM" }), 500_000);
  });
  test("las estadías reales de 5 noches con salida dentro de la ventana cuestan 550.000 (entrando el 4) o 600.000 (entrando el 5)", () => {
    assert.equal(real("2027-01-04"), 550_000);
    assert.equal(real("2027-01-05"), 600_000);
  });
});

describe("7. No existe el concepto de día de la semana: una vigencia cobra igual lunes que viernes", () => {
  const tp = [vig({ nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31" })];
  test("lun 4 ene y vie 8 ene: misma tarifa", () => {
    assert.equal(total(tp, { ALTA: 100_000 }, "2027-01-04", 1), total(tp, { ALTA: 100_000 }, "2027-01-08", 1));
  });
});

describe("8. La noche de salida no se cobra", () => {
  const tp = [vig({ nombre: "SEMANA-1", fecha_inicio: "2027-01-04", fecha_fin: "2027-01-07" }),
              vig({ nombre: "FINDE-1", fecha_inicio: "2027-01-08", fecha_fin: "2027-01-10" })];
  test("jue 7 → sáb 9 (2 noches): jueves + viernes; el sábado de salida no cuenta", () => {
    assert.equal(total(tp, { "SEMANA-1": 100_000, "FINDE-1": 150_000 }, "2027-01-07", 2), 250_000);
  });
});

describe("9. RIESGO CONOCIDO — fechas con día inexistente: el motor las DESBORDA al mes siguiente (no las ignora)", () => {
  // JavaScript lee 2027-02-30 como 2 de marzo. Un mes 13 o un día 32 sí produce fecha inválida (no cubre ni excluye).
  const conFin = (fin: string) => [vig({ nombre: "ALTA", rangos: [{ fecha_inicio: "2027-02-25", fecha_fin: fin }] })];
  const gana = (tp: TemporadaRango[], iso: string) => resolverNetoNocheDetallado(new Date(`${iso}T00:00:00`).getTime(), tp, { ALTA: 100_000 }, HOY, "PAM")?.temporadaGanadora ?? null;
  test("fin 2027-02-30 cubre hasta el 2 de marzo, no el 3", () => {
    assert.equal(gana(conFin("2027-02-30"), "2027-03-02"), "ALTA");
    assert.equal(gana(conFin("2027-02-30"), "2027-03-03"), null);
  });
  test("fin con mes 13: la fecha es inválida y el rango no cubre nada", () => {
    assert.equal(gana(conFin("2027-13-01"), "2027-02-26"), null);
  });
});
