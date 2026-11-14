// #49 — Identidad fiscal por agencia: solo de la fila `agencias` de su tenant; sin respaldo en la constante EMPRESA (que es la identidad de MINORISTA).
// Datos SINTÉTICOS (no se usan los RNT reales). Ambas agencias; fila ausente, RNT nulo, vacío y solo espacios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { identidadAgencia, camposFaltantesIdentidad } from "../lib/agencia/identidadAgencia.ts";
import { EMPRESA } from "../lib/contrato/plantilla.ts";

const fila = (t: string, extra: Record<string, unknown> = {}) => ({ tenant: t, razon_social: `Razón ${t}`, nit: `NIT-${t}`, rnt: `RNT-${t}`, correo: `${t}@x.test`, banco: `Banco ${t}`, tipo_cuenta: "Ahorros", numero_cuenta: `CTA-${t}`, ...extra });

describe("identidadAgencia (#49)", () => {
  test("cada agencia devuelve SOLO sus datos; ninguno coincide con la constante EMPRESA", () => {
    for (const t of ["mayorista", "minorista"]) {
      const id = identidadAgencia(fila(t), t);
      assert.equal(id.rnt, `RNT-${t}`); assert.equal(id.nit, `NIT-${t}`); assert.equal(id.razonSocial, `Razón ${t}`);
      assert.equal(id.numeroCuenta, `CTA-${t}`);
      assert.notEqual(id.rnt, EMPRESA.rnt); assert.notEqual(id.nit, EMPRESA.nit);
    }
  });

  test("fila ausente (null/undefined): error en ambas agencias, nombrándola", () => {
    for (const [t, n] of [["mayorista", /Mayorista/], ["minorista", /Minorista/]] as const) {
      for (const ausente of [null, undefined]) assert.throws(() => identidadAgencia(ausente, t), n);
    }
  });

  test("RNT nulo, vacío o solo espacios: error (no se sustituye por otro)", () => {
    for (const t of ["mayorista", "minorista"]) {
      for (const rnt of [null, undefined, "", "   ", "\t"]) {
        assert.throws(() => identidadAgencia(fila(t, { rnt }), t), /RNT/, `${t} ${JSON.stringify(rnt)}`);
        assert.deepEqual(camposFaltantesIdentidad(fila(t, { rnt })), ["RNT"]);
      }
    }
  });

  test("razón social o NIT faltantes: error y se dice cuáles", () => {
    assert.deepEqual(camposFaltantesIdentidad(fila("mayorista", { razon_social: "", nit: null })), ["razón social", "NIT"]);
    assert.throws(() => identidadAgencia(fila("mayorista", { nit: " " }), "mayorista"), /NIT/);
  });

  test("correo y cuenta son opcionales: faltantes → vacíos (jamás los de EMPRESA)", () => {
    const id = identidadAgencia(fila("mayorista", { correo: null, banco: null, tipo_cuenta: null, numero_cuenta: "  " }), "mayorista");
    assert.deepEqual([id.correo, id.banco, id.tipoCuenta, id.numeroCuenta], ["", "", "", ""]);
  });
});

describe("cableado (#49): ningún documento toma identidad de EMPRESA", () => {
  const ARCHIVOS = ["components/contrato/ContratoDocumento.tsx", "components/contrato/CotizacionManualDocumento.tsx", "components/contrato/DocHeader.tsx", "components/cotizacion/ComparativaHoja.tsx"];
  const raiz = new URL("../", import.meta.url);
  test("sin EMPRESA.rnt/nit/razonSocial/correo/cuentaBancaria en los documentos", () => {
    for (const a of ARCHIVOS) {
      const src = fs.readFileSync(new URL(a, raiz), "utf8");
      assert.doesNotMatch(src, /EMPRESA\.(rnt|nit|razonSocial|correo|cuentaBancaria)/, a);
      assert.match(src, /identidadAgencia\(/, `${a} usa el resolutor único`);
    }
  });
});
