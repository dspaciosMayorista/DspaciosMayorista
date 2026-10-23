import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  copMaximoPagable,
  idSaldoCxp,
  ordenarPorSaldoCxp,
  mensajeGuardaSaldo,
  pagoSaldoExacto,
  saldoNominalCxp,
  toleranciaCxp,
} from "../lib/finanzas/guardaSaldoCxp.ts";

// #90 E5a: traducción de los errores de la guarda de saldo (migración 228) y cifras de S4/C2.

test("tolerancia: COP 10, USD 0,10, otra moneda 0", () => {
  assert.equal(toleranciaCxp("COP"), 10);
  assert.equal(toleranciaCxp(" usd "), 0.1);
  assert.equal(toleranciaCxp("EUR"), 0);
  assert.equal(toleranciaCxp(null), 0);
});

test("Z9601 distingue pago y retención y NUNCA trae importes", () => {
  const pago = mensajeGuardaSaldo({ code: "Z9601", message: "pago_excede_saldo" }, "pago");
  const ret = mensajeGuardaSaldo({ code: "Z9601", message: "retencion_excede_saldo" }, "retencion");
  assert.match(pago ?? "", /pago supera el saldo/);
  assert.match(ret ?? "", /retención supera el saldo/);
  for (const m of [pago, ret]) assert.doesNotMatch(m ?? "", /\d/);
});

test("Z9602..Z9607 tienen mensaje propio y sin cifras", () => {
  for (const code of ["Z9602", "Z9603", "Z9604", "Z9605", "Z9606", "Z9607"]) {
    const m = mensajeGuardaSaldo({ code, message: "x" });
    assert.ok(m, code);
    assert.doesNotMatch(m!, /\d/, code);
  }
});

test("42501 de RLS se traduce; otro 42501 o un error ajeno devuelve null", () => {
  assert.match(
    mensajeGuardaSaldo({ code: "42501", message: 'new row violates row-level security policy for table "cxp_pagos"' }) ?? "",
    /permiso/,
  );
  assert.equal(mensajeGuardaSaldo({ code: "42501", message: "permission denied for table x" }), null);
  assert.equal(mensajeGuardaSaldo({ code: "23505", message: "dup" }), null);
  assert.equal(mensajeGuardaSaldo(null), null);
});

test("saldo nominal: resta pagos y retenciones, redondea a 2 y no baja de 0", () => {
  assert.equal(saldoNominalCxp(5919, 816.03, 0), 5102.97);
  assert.equal(saldoNominalCxp(100, 80, 30), 0);
});

test("S4: COP máximo pagable = saldo × TRM redondeado hacia abajo; sin TRM o sin saldo es null", () => {
  assert.equal(copMaximoPagable(10.5, 4000.5), 42005);
  assert.equal(copMaximoPagable(10, 0), null);
  assert.equal(copMaximoPagable(0, 4000), null);
});

test("C2: saldo exacto guarda el COP real, nominal = saldo y trm = COP/nominal a 4 decimales", () => {
  const r = pagoSaldoExacto(5103.97, 17665398);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.nominal, 5103.97);
    assert.equal(r.cop, 17665398);
    assert.equal(r.trm, Math.round((17665398 / 5103.97) * 1e4) / 1e4);
    // el nominal NO se deriva de COP/TRM redondeada: no puede quedar encima del saldo
    assert.ok(r.nominal <= 5103.97);
  }
});

test("C2: rechaza saldo 0, COP vacío/negativo/no numérico", () => {
  assert.equal(pagoSaldoExacto(0, 1000).ok, false);
  assert.equal(pagoSaldoExacto(10, 0).ok, false);
  assert.equal(pagoSaldoExacto(10, -5).ok, false);
  assert.equal(pagoSaldoExacto(10, Number.NaN).ok, false);
});

test("E1: idSaldoCxp lee solo referencias saldo-cxp:N", () => {
  assert.equal(idSaldoCxp("saldo-cxp:42"), 42);
  assert.equal(idSaldoCxp("saldo-cxp:"), null);
  assert.equal(idSaldoCxp("saldo-cxp:4x"), null);
  assert.equal(idSaldoCxp("pago:42:7"), null);
});

test("E1: las cuentas saldo-cxp se procesan en orden ascendente de id; el resto va al final sin perder su orden", () => {
  const entrada = [
    { ref: "saldo-cxp:30" },
    { ref: "abono:9" },
    { ref: "saldo-cxp:5" },
    { ref: "pago:1:1" },
    { ref: "saldo-cxp:12" },
  ];
  assert.deepEqual(
    ordenarPorSaldoCxp(entrada).map((x) => x.ref),
    ["saldo-cxp:5", "saldo-cxp:12", "saldo-cxp:30", "abono:9", "pago:1:1"],
  );
  assert.equal(entrada[0].ref, "saldo-cxp:30", "no muta la entrada");
});

// Cableado: guarda estructural de que las acciones usan el mapeo y no reintroducen tolerancias propias.
const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("wiring: retenciones ya no compara el saldo en TypeScript (+1) y traduce la guarda", () => {
  const src = leer("app/(dashboard)/dashboard/contabilidad/retenciones/actions.ts");
  assert.doesNotMatch(src, /saldoActual \+ 1/);
  assert.match(src, /mensajeGuardaSaldo\(error, "retencion"\)/);
});

test("wiring: pagos traduce la guarda y 'saldo exacto' calcula el nominal en el servidor", () => {
  const src = leer("app/(dashboard)/dashboard/pagos/actions.ts");
  assert.match(src, /mensajeGuardaSaldo\(e2, "pago"\)/);
  assert.match(src, /export async function pagarSaldoExacto/);
  assert.match(src, /pagoSaldoExacto\(saldo, copPagado\)/);
  assert.match(src, /valor: esUSD \? calc\.cop : calc\.nominal/);
});

test("wiring: conciliaciones ordena por id y no crea el cruce si el pago fue rechazado", () => {
  const src = leer("app/(dashboard)/dashboard/contabilidad/conciliaciones/actions.ts");
  assert.ok(src.includes("ordenarPorSaldoCxp(input.sistema)"));
  assert.ok(!src.includes("saldo-cxp:("), "sin regex local propia: se usa idSaldoCxp");
  assert.ok(src.includes('.delete().in("id", pagosCreados).select("id")'), "comprueba el resultado del borrado");
  assert.match(src, /quedaron pagos por revisar/);
  assert.match(src, /el cruce no se creó/);
  assert.doesNotMatch(src, /sistemaFinal\.push\(s\); continue; }\s*\n\s*sistemaFinal\.push\(\{ \.\.\.s, ref/);
});
