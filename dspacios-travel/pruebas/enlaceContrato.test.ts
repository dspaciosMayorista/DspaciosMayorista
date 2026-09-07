// Lógica del enlace "Editar en contrato" de los renglones subordinados de
// infantes en los manifiestos de vuelo (lib/vuelos/enlaceContrato.ts):
//   1) el enlace SOLO se produce con el `numero_contrato` interno REAL que el
//      usuario actual puede abrir (nunca se fabrica un prefijo, nunca se
//      enlaza un número ajeno al conjunto autorizado);
//   2) la autorización se resuelve EN LOTE (una sola consulta a `ventas` por
//      página, deduplicando infantes del mismo contrato) con la RLS del
//      cliente de sesión — jamás con un cliente admin/service-role;
//   3) fail-closed: error de red, RLS sin filas o lista vacía → conjunto
//      vacío → ningún enlace.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarNumeroContrato,
  numeroContratoEnlazable,
  contratosQuePuedeAbrir,
} from "../lib/vuelos/enlaceContrato.ts";

type SbParam = Parameters<typeof contratosQuePuedeAbrir>[0];

/** Cliente de sesión FALSO (solo lo que el helper toca) que recuerda los
 *  valores pedidos en cada `.in(...)` y delega la respuesta a `resolver`. */
function sbFalso(resolver: (valores: string[]) => { data: { numero_contrato: string }[] | null; error: unknown }) {
  const llamadas: string[][] = [];
  const falso = {
    from: (tabla: string) => {
      assert.equal(tabla, "ventas", "el helper debe leer exactamente la tabla ventas");
      return {
        select: () => ({
          in: (_columna: string, valores: string[]) => {
            llamadas.push(valores);
            return Promise.resolve(resolver(valores));
          },
        }),
      };
    },
  };
  return { sb: falso as unknown as SbParam, llamadas };
}

describe("normalizarNumeroContrato", () => {
  test("recorta espacios y trata vacío/solo-espacios como ausente (null)", () => {
    assert.equal(normalizarNumeroContrato("  MIN-00-0541  "), "MIN-00-0541");
    assert.equal(normalizarNumeroContrato(""), null);
    assert.equal(normalizarNumeroContrato("   "), null);
    assert.equal(normalizarNumeroContrato(null), null);
    assert.equal(normalizarNumeroContrato(undefined), null);
  });
});

describe("numeroContratoEnlazable (selector puro del enlace)", () => {
  const autorizados = new Set(["00-0451", "MIN-00-0541"]);

  test("contrato autorizado → devuelve el número exacto (con su prefijo de tenant tal como existe en ventas)", () => {
    assert.equal(numeroContratoEnlazable("MIN-00-0541", autorizados), "MIN-00-0541");
    assert.equal(numeroContratoEnlazable(" 00-0451 ", autorizados), "00-0451");
  });

  test("contrato NO autorizado (lo que la RLS del usuario no deja abrir) → null, sin enlace", () => {
    assert.equal(numeroContratoEnlazable("MIN-00-9999", autorizados), null);
  });

  test("referencia EXTERNA/manual que no es una venta interna → null (no hay contrato real que abrir)", () => {
    // Un texto suelto de `contrato_manual` (venta externa) que el infante no
    // comparte jamás llega como numeroContrato real; pero si llegara un
    // candidato que no está en el conjunto, nunca genera enlace.
    assert.equal(numeroContratoEnlazable("VUELO-EXT-88", autorizados), null);
  });

  test("NUNCA antepone el prefijo MIN- por su cuenta — solo enlaza el número tal cual está autorizado", () => {
    // El usuario autorizado a "00-0541" (mayorista) no debe poder enlazar
    // "MIN-00-0541" por el hecho de tener la versión sin prefijo.
    assert.equal(numeroContratoEnlazable("00-0541", new Set(["00-0541"])), "00-0541");
    assert.equal(numeroContratoEnlazable("00-0541", new Set(["MIN-00-0541"])), null);
  });

  test("candidato vacío/nulo → null, sin enlace", () => {
    assert.equal(numeroContratoEnlazable("", autorizados), null);
    assert.equal(numeroContratoEnlazable(null, autorizados), null);
    assert.equal(numeroContratoEnlazable(undefined, autorizados), null);
  });
});

describe("contratosQuePuedeAbrir (IO en lote con la RLS del cliente de sesión)", () => {
  test("una SOLA consulta .in() con la lista deduplicada — varios infantes del mismo contrato reutilizan la autorización", async () => {
    const { sb, llamadas } = sbFalso((valores) => ({
      data: valores.map((v) => ({ numero_contrato: v })),
      error: null,
    }));
    const autorizados = await contratosQuePuedeAbrir(sb, [
      "MIN-00-0541",
      "00-0451",
      "MIN-00-0541", // segundo infante del mismo contrato
      "  00-0451  ", // mismo contrato, con espacios
      "MIN-00-0541", // tercer infante del mismo contrato
    ]);
    assert.equal(llamadas.length, 1, "debe resolver todos los infantes en UNA consulta, nunca una por infante");
    assert.deepEqual(llamadas[0].slice().sort(), ["00-0451", "MIN-00-0541"], "la lista enviada al .in() debe estar deduplicada y normalizada");
    assert.deepEqual([...autorizados].sort(), ["00-0451", "MIN-00-0541"]);
  });

  test("la RLS decide: solo devuelve los contratos que la sesión SÍ puede ver (los que no, no aparecen → sin enlace)", async () => {
    // Simula un rol/tenant que solo alcanza "00-0451" (p. ej. un usuario de
    // mayorista consultando un bloqueo compartido con una silla minorista).
    const { sb } = sbFalso((valores) => ({
      data: valores.filter((v) => v === "00-0451").map((v) => ({ numero_contrato: v })),
      error: null,
    }));
    const autorizados = await contratosQuePuedeAbrir(sb, ["00-0451", "MIN-00-0541"]);
    assert.deepEqual([...autorizados], ["00-0451"]);
    assert.equal(numeroContratoEnlazable("MIN-00-0541", autorizados), null, "el contrato del otro tenant no debe enlazarse");
  });

  test("fail-closed: error de la consulta → conjunto vacío (ningún enlace), sin excepción", async () => {
    const { sb } = sbFalso(() => ({ data: null, error: new Error("boom") }));
    assert.deepEqual([...(await contratosQuePuedeAbrir(sb, ["MIN-00-0541"]))], []);
  });

  test("fail-closed: sin candidatos → conjunto vacío y NI SIQUIERA consulta (from no se toca)", async () => {
    let fromTocado = false;
    const sb = {
      from: () => {
        fromTocado = true;
        throw new Error("no debería consultarse");
      },
    } as unknown as SbParam;
    assert.deepEqual([...(await contratosQuePuedeAbrir(sb, [null, "", "   "]))], []);
    assert.equal(fromTocado, false);
  });
});
