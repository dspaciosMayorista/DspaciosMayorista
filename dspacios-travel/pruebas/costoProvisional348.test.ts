// NETA-05/06 — presentación de costos en USD con TRM de costos provisional (módulo puro). Importes a mano: USD 200 × 3.900 = COP 780.000; × 4.100 = 820.000.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoCosto, importeOrigen, textoEquivalente, totalesPorMoneda, trmComun, formatoTrm } from "../lib/finanzas/costoProvisional.ts";

const usd = { moneda: "USD", valor: 200, trm: 3900, valorCop: 780000 };
const usdSin = { moneda: "USD", valor: 50, trm: null, valorCop: null };
const cop = { moneda: "COP", valor: 420000 };
const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ");

test("estado: COP, USD con TRM y USD sin TRM; moneda vacía se lee como COP", () => {
  assert.equal(estadoCosto(cop), "cop");
  assert.equal(estadoCosto({ moneda: null, valor: 1 }), "cop");
  assert.equal(estadoCosto(usd), "usd_con_trm");
  assert.equal(estadoCosto(usdSin), "usd_sin_trm");
  assert.equal(estadoCosto({ moneda: "USD", valor: 1, trm: 0, valorCop: 0 }), "usd_sin_trm", "TRM 0 no cuenta como TRM");
});

test("texto: USD en dólares y equivalente provisional/congelado; sin TRM «pendiente»; COP no lleva equivalente", () => {
  assert.match(norm(importeOrigen(usd)), /^USD \$200\.00$/);
  assert.equal(norm(textoEquivalente(usd)), "≈ $ 780.000 a TRM de costos $3.900 (provisional)");
  assert.equal(norm(textoEquivalente(usd, "congelada")), "≈ $ 780.000 a TRM de costos $3.900 (congelada)");
  assert.equal(textoEquivalente(usdSin), "TRM de costos pendiente");
  assert.equal(textoEquivalente(cop), null);
  assert.equal(formatoTrm(4100.5), "$4.100,5");
});

test("totales POR MONEDA: nunca se suman USD y COP; el equivalente solo existe si TODAS las USD lo tienen", () => {
  const t = totalesPorMoneda([usd, cop, { moneda: "USD", valor: 100, trm: 3900, valorCop: 390000 }]);
  assert.deepEqual(t.map((x) => x.moneda), ["COP", "USD"]);
  assert.equal(t[0].total, 420000);
  assert.equal(t[1].total, 300);
  assert.equal(t[1].equivalenteCop, 1170000);
  const t2 = totalesPorMoneda([usd, usdSin]);
  assert.equal(t2[0].total, 250);
  assert.equal(t2[0].equivalenteCop, null, "una USD sin TRM deja el equivalente incompleto");
  assert.equal(t2[0].sinTrm, 1);
});

test("TRM común: una sola TRM (a 4 decimales) o null si hay dos distintas o ninguna", () => {
  assert.equal(trmComun([usd, { ...usd, valor: 10, valorCop: 39000 }]), 3900);
  assert.equal(trmComun([usd, { ...usd, trm: 4100, valorCop: 820000 }]), null);
  assert.equal(trmComun([cop, usdSin]), null);
});
