// Lógica del enlace "Editar en contrato" de los renglones subordinados de
// infantes en los manifiestos de vuelo (lib/vuelos/enlaceContrato.ts):
//   1) el enlace SOLO se produce con el `numero_contrato` interno REAL que el
//      usuario actual puede abrir — nunca se fabrica/antepone un prefijo, nunca
//      se enlaza un número ajeno al conjunto autorizado;
//   2) la autorización se resuelve EN LOTE (una sola consulta a `ventas` por
//      página, deduplicando infantes del mismo contrato) con la RLS del
//      cliente de sesión — jamás con un cliente admin/service-role — y la
//      consulta pide `numero_contrato, tenant`: el tenant que decide el caso
//      cross-tenant es el REAL de la columna `ventas.tenant`, no el que leería
//      el texto del número (`MIN-`);
//   3) fail-closed: error de red, RLS sin filas o lista vacía → mapa vacío →
//      ningún enlace; una fila cuyo tenant no se reconoce se descarta;
//   4) cross-tenant fail-closed en el selector puro: un contrato del OTRO
//      tenant solo enlaza si quien mira PUEDE cambiar la agencia activa (solo
//      superadmin); si no puede, no se ofrece el enlace — abrirlo lo dejaría
//      en la agencia equivocada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarNumeroContrato,
  enlaceContratoEnVuelo,
  contratosQuePuedeAbrir,
} from "../lib/vuelos/enlaceContrato.ts";
import type { Tenant } from "../lib/tenant.ts";

type SbParam = Parameters<typeof contratosQuePuedeAbrir>[0];

/** Cliente de sesión FALSO (solo lo que el helper toca) que exige la consulta
 *  correcta (`ventas`, pidiendo `numero_contrato, tenant`), recuerda los
 *  valores pedidos en cada `.in(...)` y delega la respuesta a `resolver`. */
function sbFalso(resolver: (valores: string[]) => { data: { numero_contrato: string; tenant: string | null }[] | null; error: unknown }) {
  const llamadas: string[][] = [];
  const falso = {
    from: (tabla: string) => {
      assert.equal(tabla, "ventas", "el helper debe leer exactamente la tabla ventas");
      return {
        select: (cols: string) => {
          assert.match(cols, /numero_contrato/, "debe pedir numero_contrato");
          assert.match(cols, /tenant/, "debe pedir tenant — el REAL de la fila de ventas, jamás el del prefijo");
          return {
            in: (_columna: string, valores: string[]) => {
              llamadas.push(valores);
              return Promise.resolve(resolver(valores));
            },
          };
        },
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

describe("enlaceContratoEnVuelo (selector puro del enlace)", () => {
  const autorizados = new Map<string, Tenant>([
    ["00-0451", "mayorista"],
    ["MIN-00-0541", "minorista"],
  ]);

  test("contrato del MISMO tenant activo y autorizado → enlace con el número exacto y su tenant real (navegación normal, sin cambiar agencia)", () => {
    assert.deepEqual(enlaceContratoEnVuelo("00-0451", autorizados, "mayorista", false), {
      numeroContrato: "00-0451",
      tenant: "mayorista",
    });
  });

  test("contrato cross-tenant autorizado y quien mira PUEDE cambiar la agencia → enlace con el tenant REAL del contrato", () => {
    // Usuario de mayorista viendo el contrato minorista, con permiso de
    // cambiar (superadmin). El enlace baja con tenant "minorista" para que el
    // componente cliente cambie la agencia ANTES de navegar.
    assert.deepEqual(enlaceContratoEnVuelo("MIN-00-0541", autorizados, "mayorista", true), {
      numeroContrato: "MIN-00-0541",
      tenant: "minorista",
    });
  });

  test("contrato cross-tenant autorizado pero SIN permiso de cambiar de agencia → null (fail-closed, sin enlace)", () => {
    // Un gerencia alcanza la fila por RLS pero no puede cambiar la cookie de
    // agencia: abrir el enlace lo dejaría en la agencia equivocada → no se
    // ofrece. Este es el caso del reporte original (MIN-00-0541 desde mayorista).
    assert.equal(enlaceContratoEnVuelo("MIN-00-0541", autorizados, "mayorista", false), null);
  });

  test("número con espacios se normaliza; el enlace usa el número tal cual existe en ventas", () => {
    assert.deepEqual(enlaceContratoEnVuelo("  00-0451 ", autorizados, "mayorista", false), {
      numeroContrato: "00-0451",
      tenant: "mayorista",
    });
  });

  test("contrato NO autorizado (la RLS de la sesión no lo deja abrir) → null, incluso con permiso de cambiar de agencia", () => {
    assert.equal(enlaceContratoEnVuelo("MIN-00-9999", autorizados, "mayorista", true), null);
    assert.equal(enlaceContratoEnVuelo("MIN-00-9999", autorizados, "mayorista", false), null);
    // Referencia externa/manual que no es una venta interna → nunca enlaza.
    assert.equal(enlaceContratoEnVuelo("VUELO-EXT-88", autorizados, "mayorista", true), null);
  });

  test("NUNCA infiere el tenant ni el número desde el prefijo MIN- — solo enlaza la clave exacta autorizada", () => {
    // Estar autorizado a "00-0541" (mayorista) no habilita enlazar
    // "MIN-00-0541" solo por saber que minorista antepone el prefijo.
    assert.equal(enlaceContratoEnVuelo("MIN-00-0541", new Map([["00-0541", "mayorista"]]), "mayorista", true), null);
    // Ni a la inversa: autorizado a la versión con prefijo no permite enlazar
    // la versión sin prefijo como si fueran el mismo contrato.
    assert.equal(enlaceContratoEnVuelo("00-0541", new Map([["MIN-00-0541", "minorista"]]), "mayorista", true), null);
  });

  test("el tenant que devuelve es el de ventas.tenant (mapa), jamás el que sugeriría el texto del número", () => {
    // Caso deliberadamente "raro": un número con prefijo MIN- cuya fila real
    // pertenece a mayorista. El selector respeta la columna, no el texto.
    const raro = new Map<string, Tenant>([["MIN-00-0001", "mayorista"]]);
    assert.deepEqual(enlaceContratoEnVuelo("MIN-00-0001", raro, "minorista", true), {
      numeroContrato: "MIN-00-0001",
      tenant: "mayorista",
    });
    // Y sin permiso de cambiar no enlaza, aunque el texto sugiera minorista.
    assert.equal(enlaceContratoEnVuelo("MIN-00-0001", raro, "minorista", false), null);
  });

  test("candidato vacío/nulo → null, sin enlace", () => {
    assert.equal(enlaceContratoEnVuelo("", autorizados, "mayorista", false), null);
    assert.equal(enlaceContratoEnVuelo(null, autorizados, "mayorista", false), null);
    assert.equal(enlaceContratoEnVuelo(undefined, autorizados, "mayorista", false), null);
  });
});

describe("contratosQuePuedeAbrir (IO en lote con la RLS del cliente de sesión)", () => {
  test("una SOLA consulta .in() deduplicada pidiendo numero_contrato+tenant; el mapa conserva el tenant REAL por número", async () => {
    const { sb, llamadas } = sbFalso((valores) => ({
      data: valores.map((v) => ({
        numero_contrato: v,
        tenant: v.startsWith("MIN-") ? "minorista" : "mayorista",
      })),
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
    // El orden del mapa sigue el del primer infante de cada contrato en la
    // entrada (Set preserva el primer hallazgo): MIN-00-0541 antes que 00-0451.
    assert.deepEqual([...autorizados], [
      ["MIN-00-0541", "minorista"],
      ["00-0451", "mayorista"],
    ], "cada número del mapa debe apuntar a su tenant REAL de ventas.tenant");
  });

  test("la RLS decide qué filas devuelve y el mapa alimenta el fail-closed del selector", async () => {
    const { sb } = sbFalso((valores) => ({
      data: valores.filter((v) => v === "00-0451").map((v) => ({ numero_contrato: v, tenant: "mayorista" })),
      error: null,
    }));
    const autorizados = await contratosQuePuedeAbrir(sb, ["00-0451", "MIN-00-0541"]);
    assert.deepEqual([...autorizados], [["00-0451", "mayorista"]]);
    assert.equal(
      enlaceContratoEnVuelo("MIN-00-0541", autorizados, "mayorista", true),
      null,
      "el contrato que la RLS no devuelve no genera enlace, aunque se pueda cambiar de agencia"
    );
  });

  test("una fila con tenant no reconocido o nulo se omite del mapa (fail-closed: sin tenant válido no hay enlace)", async () => {
    const { sb } = sbFalso(() => ({
      data: [
        { numero_contrato: "00-0451", tenant: "mayorista" },
        { numero_contrato: "00-9999", tenant: "otro-tenant-desconocido" },
        { numero_contrato: "00-8888", tenant: null },
      ],
      error: null,
    }));
    const autorizados = await contratosQuePuedeAbrir(sb, ["00-0451", "00-9999", "00-8888"]);
    assert.deepEqual([...autorizados], [["00-0451", "mayorista"]]);
  });

  test("fail-closed: error de la consulta → mapa vacío (ningún enlace), sin excepción", async () => {
    const { sb } = sbFalso(() => ({ data: null, error: new Error("boom") }));
    assert.deepEqual([...(await contratosQuePuedeAbrir(sb, ["MIN-00-0541"]))], []);
  });

  test("fail-closed: sin candidatos → mapa vacío y NI SIQUIERA consulta (from no se toca)", async () => {
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
