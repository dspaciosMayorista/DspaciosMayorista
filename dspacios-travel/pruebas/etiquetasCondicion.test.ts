// ─────────────────────────────────────────────────────────────────────────
// Pruebas PURAS de las etiquetas legibles (lib/cotizacion/etiquetasCondicion.ts)
// y del barrido de restricción por fechas
// (lib/cotizacion/snapshotCondiciones.ts → barridoRestriccionEstadia).
// Sin Supabase, sin SQL. Se corren con `npm run test:unit`.
//
// Cubre (Commit 3):
//   · fraseCondicion: pago_total / anticipo_saldo (+detalle de días) / neutra
//     con y sin pctBase;
//   · restricción: los 3 niveles (normal / promocional_no_reembolsable_no_endosable /
//     no_reembolsable_no_endosable) → títulos/parrafos; esNoReembolsable;
//   · nombreTipoComponente;
//   · barrido de "restricciones en algunas fechas": estadía que toca y que no
//     toca una temporada restringida, sin N+1 (una pasada), sin duplicar.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  fraseCondicion,
  nombreTipoComponente,
  tituloRestriccion,
  textoRestriccion,
  esNoReembolsable,
  etiquetasRestriccion,
} from "../lib/cotizacion/etiquetasCondicion.ts";
import {
  barridoRestriccionEstadia,
  nochesEntre,
  type VigenciaHotelCondicion,
} from "../lib/cotizacion/snapshotCondiciones.ts";

// ── fraseCondicion ─────────────────────────────────────────────────────────
describe("fraseCondicion — frases legibles por tipo", () => {
  test("pago_total → pago completo al reservar, pct 100 %", () => {
    const r = fraseCondicion("pago_total");
    assert.equal(r.texto, "Pago total al reservar");
    assert.equal(r.pct, 1);
    assert.equal(r.detalle, null);
  });

  test("anticipo_saldo 60 % + saldo 30 días → anticipo con detalle de días", () => {
    const r = fraseCondicion("anticipo_saldo", { pctInicial: 0.6, diasSaldo: 30 });
    assert.equal(r.texto, "Anticipo del 60 %");
    assert.equal(r.detalle, "Saldo 30 días antes del viaje");
    assert.equal(r.pct, 0.6);
  });

  test("anticipo_saldo sin días → detalle genérico", () => {
    const r = fraseCondicion("anticipo_saldo", { pctInicial: 0.5, diasSaldo: 0 });
    assert.equal(r.texto, "Anticipo del 50 %");
    assert.equal(r.detalle, "Saldo antes del viaje");
  });

  test("neutra con pctBase (abono mínimo) → muestra el % normal", () => {
    const r = fraseCondicion("sin_condicion", { pctBase: 0.3 });
    assert.equal(r.texto, "Abono mínimo del 30 %");
    assert.equal(r.pct, 0.3);
    // 'normal' (producto) se comporta igual que 'sin_condicion'
    const rp = fraseCondicion("normal", { pctBase: 0.3 });
    assert.equal(rp.texto, "Abono mínimo del 30 %");
  });

  test("neutra sin pctBase → genérica, sin pct", () => {
    const r = fraseCondicion("sin_condicion");
    assert.equal(r.texto, "Condición estándar");
    assert.equal(r.pct, null);
  });

  test("porcentaje redondea y usa espacio (0.3 → '30 %', 1 → '100 %')", () => {
    assert.equal(fraseCondicion("anticipo_saldo", { pctInicial: 1 }).texto, "Anticipo del 100 %");
    assert.equal(fraseCondicion("anticipo_saldo", { pctInicial: 0.3333 }).texto, "Anticipo del 33 %");
  });
});

// ── Restricción comercial ──────────────────────────────────────────────────
describe("restricción comercial — los 3 niveles", () => {
  test("normal no es no reembolsable y tiene título propio", () => {
    assert.equal(esNoReembolsable("normal"), false);
    assert.equal(tituloRestriccion("normal"), "Sin restricción");
  });

  test("promocional_no_reembolsable_no_endosable → no reembolsable, menciona tarifa promocional", () => {
    assert.equal(esNoReembolsable("promocional_no_reembolsable_no_endosable"), true);
    assert.match(tituloRestriccion("promocional_no_reembolsable_no_endosable"), /promocional/i);
    assert.match(textoRestriccion("promocional_no_reembolsable_no_endosable"), /no es reembolsable/i);
  });

  test("no_reembolsable_no_endosable → no reembolsable y no endosable", () => {
    assert.equal(esNoReembolsable("no_reembolsable_no_endosable"), true);
    assert.match(tituloRestriccion("no_reembolsable_no_endosable"), /no endosable/i);
    assert.match(textoRestriccion("no_reembolsable_no_endosable"), /no es reembolsable/i);
    assert.match(textoRestriccion("no_reembolsable_no_endosable"), /no es endosable/i);
  });
});

// ── Etiquetas individuales (decisión del dueño: SIEMPRE ambas restricciones
//    a la vez, nunca una sola — "promocional" solo identifica el origen). ──
describe("etiquetasRestriccion — SIEMPRE ambas etiquetas juntas, nunca una sola", () => {
  test("normal → ninguna etiqueta", () => {
    assert.deepEqual(etiquetasRestriccion("normal"), []);
  });

  test("promoción restringida (promocional_no_reembolsable_no_endosable) → ambas etiquetas", () => {
    const et = etiquetasRestriccion("promocional_no_reembolsable_no_endosable");
    assert.equal(et.length, 2);
    assert.ok(et.includes("No reembolsable"));
    assert.ok(et.includes("No endosable"));
  });

  test("tarifa normal restringida (no_reembolsable_no_endosable) → ambas etiquetas", () => {
    const et = etiquetasRestriccion("no_reembolsable_no_endosable");
    assert.equal(et.length, 2);
    assert.ok(et.includes("No reembolsable"));
    assert.ok(et.includes("No endosable"));
  });

  test("las dos restricciones producen EXACTAMENTE las mismas etiquetas (mismo efecto, distinto origen)", () => {
    assert.deepEqual(
      etiquetasRestriccion("promocional_no_reembolsable_no_endosable"),
      etiquetasRestriccion("no_reembolsable_no_endosable"),
    );
  });
});

describe("nombreTipoComponente", () => {
  test("mapea cada tipo a un nombre legible", () => {
    assert.equal(nombreTipoComponente("hotel"), "Hotel");
    assert.equal(nombreTipoComponente("aereo_empaquetado"), "Tiquete aéreo");
    assert.equal(nombreTipoComponente("vuelo_bloqueo"), "Vuelo de bloqueo");
  });
});

// ── barrido de restricción por fechas (hotel) ──────────────────────────────
function vgR(cond: VigenciaHotelCondicion, inicio: string, fin: string, restriccion: "normal" | "no_reembolsable_no_endosable", nombre = "T"): VigenciaHotelCondicion {
  return { ...cond, nombre, fechaInicio: inicio, fechaFin: fin, restriccionComercial: restriccion };
}
const neutra: VigenciaHotelCondicion = { tipo: "sin_condicion", pctInicial: null, diasSaldo: null, hotelTemporadaId: null, nombre: "GENERAL", fechaInicio: "2026-01-01", fechaFin: "2027-01-01", restriccionComercial: "normal" };

describe("barridoRestriccionEstadia — 'restricciones en algunas fechas' (sin N+1)", () => {
  test("estadía que NO toca una temporada restringida → sin restricción", () => {
    const r = barridoRestriccionEstadia(
      { fechaIda: "2026-03-01", fechaRegreso: "2026-03-04" },
      [vgR(neutra, "2026-01-01", "2026-06-01", "normal", "BAJA"), vgR(neutra, "2026-12-20", "2027-01-10", "no_reembolsable_no_endosable", "ALTA")],
    );
    assert.equal(r.tocaRestriccion, false);
    assert.deepEqual(r.fechasRestringidas, []);
    assert.deepEqual(r.temporadasRestringidas, []);
  });

  test("estadía que cae en una temporada restringida → lo reporta (una pasada, sin duplicar)", () => {
    const r = barridoRestriccionEstadia(
      { fechaIda: "2026-12-25", fechaRegreso: "2026-12-28" },
      [
        vgR(neutra, "2026-01-01", "2026-06-01", "normal", "BAJA"),
        vgR(neutra, "2026-12-20", "2027-01-10", "no_reembolsable_no_endosable", "ALTA"),
      ],
    );
    assert.equal(r.tocaRestriccion, true);
    assert.deepEqual(r.temporadasRestringidas, ["ALTA"]);
    // todas las noches [25,26,27] están en ALTA → 3 fechas
    assert.equal(r.fechasRestringidas.length, nochesEntre("2026-12-25", "2026-12-28").length);
    // sin duplicar la temporada aunque haya varias noches en ella
    assert.equal(r.temporadasRestringidas.filter((t) => t === "ALTA").length, 1);
  });

  test("sin vigencias o sin rango → nunca toca", () => {
    assert.equal(barridoRestriccionEstadia({ fechaIda: "", fechaRegreso: "" }, []).tocaRestriccion, false);
    assert.equal(barridoRestriccionEstadia({ fechaIda: "2026-03-01", fechaRegreso: "2026-03-04" }, []).tocaRestriccion, false);
  });
});
