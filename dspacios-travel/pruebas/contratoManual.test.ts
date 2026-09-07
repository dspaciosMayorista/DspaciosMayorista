// Bug post-merge PR #288: un infante vinculado a una venta interna
// (contrato_pasajeros.numero_contrato = 'MIN-00-0541') no aparecía en los
// listados de vuelo cuando la silla del adulto de ese mismo contrato estaba
// enlazada por `sillas.contrato_manual = '00-0541'` (texto libre, migración
// 085) en vez de `sillas.numero_contrato` (FK orgánica). Causa raíz: ambas
// páginas de vuelos construían la lista de contratos a buscar SOLO desde
// `sillas.numero_contrato`, ignorando `contrato_manual` por completo.
//
// Este archivo prueba el módulo puro que resuelve esa asociación de forma
// segura (lib/vuelos/contratoManual.ts) — ejecución real de las funciones
// exportadas, nunca una reimplementación.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarReferenciaManual,
  candidatosNumeroContrato,
  resolverReferenciasManuales,
  buscarNumerosContratoExistentes,
  resolverReferenciasManualesDesdeDB,
} from "../lib/vuelos/contratoManual.ts";

describe("normalizarReferenciaManual", () => {
  test("recorta espacios", () => {
    assert.equal(normalizarReferenciaManual("  00-0541  "), "00-0541");
  });
  test("cadena vacía o solo espacios -> null", () => {
    assert.equal(normalizarReferenciaManual(""), null);
    assert.equal(normalizarReferenciaManual("   "), null);
  });
  test("null/undefined -> null", () => {
    assert.equal(normalizarReferenciaManual(null), null);
    assert.equal(normalizarReferenciaManual(undefined), null);
  });
});

describe("candidatosNumeroContrato", () => {
  test("un número crudo genera el candidato tal cual y con prefijo MIN-", () => {
    assert.deepEqual(candidatosNumeroContrato("00-0541"), ["00-0541", "MIN-00-0541"]);
  });
  test("una referencia que YA trae MIN- no se duplica el prefijo (idempotente)", () => {
    assert.deepEqual(candidatosNumeroContrato("MIN-00-0541"), ["MIN-00-0541"]);
  });
  test("una referencia claramente no numérica también recibe ambos candidatos (la decisión de validez la toma la existencia en ventas, no la forma del texto)", () => {
    assert.deepEqual(candidatosNumeroContrato("Viajes ABC 123"), ["Viajes ABC 123", "MIN-Viajes ABC 123"]);
  });
});

describe("resolverReferenciasManuales — el corazón de la corrección, fail-closed", () => {
  test("REQUERIDO: contrato_manual '00-0541' resuelve a MIN-00-0541 cuando es la única venta interna existente", () => {
    const resultado = resolverReferenciasManuales(["00-0541"], new Set(["MIN-00-0541"]));
    assert.equal(resultado.get("00-0541"), "MIN-00-0541");
    assert.equal(resultado.size, 1);
  });

  test("REQUERIDO: referencia manual externa sin venta interna no inventa nada (0 candidatos existentes)", () => {
    const resultado = resolverReferenciasManuales(["Viajes ABC 123"], new Set());
    assert.equal(resultado.size, 0);
    assert.equal(resultado.has("Viajes ABC 123"), false);
  });

  test("REQUERIDO: coincidencia AMBIGUA (existen los dos candidatos) no vincula ningún contrato — fail-closed, no se adivina", () => {
    // Caso real que motiva la advertencia de la tarea: un '00-0541' crudo
    // podría, en teoría, coincidir con un contrato mayorista/legado
    // registrado tal cual Y con uno minorista bajo MIN- — dos ventas reales
    // y distintas. Nunca se elige una al azar.
    const resultado = resolverReferenciasManuales(["00-0541"], new Set(["00-0541", "MIN-00-0541"]));
    assert.equal(resultado.size, 0);
    assert.equal(resultado.has("00-0541"), false);
  });

  test("una referencia que YA trae MIN- y existe tal cual resuelve a sí misma (no busca añadir un prefijo doble)", () => {
    const resultado = resolverReferenciasManuales(["MIN-00-0541"], new Set(["MIN-00-0541"]));
    assert.equal(resultado.get("MIN-00-0541"), "MIN-00-0541");
  });

  test("referencia sin ninguna venta interna asociada bajo NINGÚN candidato no resuelve", () => {
    const resultado = resolverReferenciasManuales(["00-9999"], new Set(["MIN-00-0541"]));
    assert.equal(resultado.size, 0);
  });

  test("null/undefined/cadena vacía se ignoran silenciosamente (no revientan ni generan entradas falsas)", () => {
    const resultado = resolverReferenciasManuales([null, undefined, "", "   "], new Set(["MIN-00-0541"]));
    assert.equal(resultado.size, 0);
  });

  test("referencias repetidas (misma clave normalizada) se deduplican a una sola entrada", () => {
    const resultado = resolverReferenciasManuales(["00-0541", " 00-0541 ", "00-0541"], new Set(["MIN-00-0541"]));
    assert.equal(resultado.size, 1);
    assert.equal(resultado.get("00-0541"), "MIN-00-0541");
  });

  test("dos referencias manuales distintas se resuelven de forma independiente (una ambigua no bloquea a la otra)", () => {
    const resultado = resolverReferenciasManuales(
      ["00-0541", "00-0999"],
      new Set(["MIN-00-0541", "00-0999", "MIN-00-0999"]) // 0541: solo MIN- existe -> resuelve. 0999: ambos -> ambigua.
    );
    assert.equal(resultado.get("00-0541"), "MIN-00-0541");
    assert.equal(resultado.has("00-0999"), false);
    assert.equal(resultado.size, 1);
  });
});

describe("buscarNumerosContratoExistentes — IO real (stub del cliente Supabase, no una reimplementación)", () => {
  function fakeSb(numerosEnVentas: string[]) {
    const llamadas: { candidatos: unknown }[] = [];
    const fake = {
      from(tabla: string) {
        assert.equal(tabla, "ventas", "debe consultar la tabla ventas");
        return {
          select(cols: string) {
            assert.equal(cols, "numero_contrato");
            return {
              in(col: string, candidatos: string[]) {
                assert.equal(col, "numero_contrato");
                llamadas.push({ candidatos });
                const data = candidatos
                  .filter((c) => numerosEnVentas.includes(c))
                  .map((c) => ({ numero_contrato: c }));
                return Promise.resolve({ data });
              },
            };
          },
        };
      },
    };
    return { fake, llamadas };
  }

  test("candidatos vacíos: no consulta la base y devuelve un Set vacío", async () => {
    const { fake, llamadas } = fakeSb([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultado = await buscarNumerosContratoExistentes(fake as any, []);
    assert.equal(resultado.size, 0);
    assert.equal(llamadas.length, 0, "no debió llamar a from(ventas) sin candidatos");
  });

  test("devuelve exactamente los numero_contrato que SÍ existen entre los candidatos", async () => {
    const { fake } = fakeSb(["MIN-00-0541"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultado = await buscarNumerosContratoExistentes(fake as any, ["00-0541", "MIN-00-0541"]);
    assert.deepEqual([...resultado], ["MIN-00-0541"]);
  });

  test("resolverReferenciasManualesDesdeDB (ejecución real end-to-end): '00-0541' -> 'MIN-00-0541' con una sola consulta agrupada", async () => {
    const { fake, llamadas } = fakeSb(["MIN-00-0541"]);
    const resultado = await resolverReferenciasManualesDesdeDB(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fake as any,
      ["00-0541", "00-0541", null, "", "  "]
    );
    assert.equal(resultado.get("00-0541"), "MIN-00-0541");
    assert.equal(resultado.size, 1);
    assert.equal(llamadas.length, 1, "debe hacer UNA sola consulta agrupada, no una por referencia");
  });

  test("resolverReferenciasManualesDesdeDB con referencias vacías no consulta la base", async () => {
    const { fake, llamadas } = fakeSb(["MIN-00-0541"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultado = await resolverReferenciasManualesDesdeDB(fake as any, [null, "", "   "]);
    assert.equal(resultado.size, 0);
    assert.equal(llamadas.length, 0);
  });
});
