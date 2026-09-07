// Bug post-merge PR #288: un infante vinculado a una venta interna
// (contrato_pasajeros.numero_contrato = 'MIN-00-0541') no aparecía en los
// listados de vuelo cuando la silla del adulto de ese mismo contrato estaba
// enlazada por `sillas.contrato_manual = '00-0541'` (texto libre, migración
// 085) en vez de `sillas.numero_contrato` (FK orgánica). Causa raíz: ambas
// páginas de vuelos construían la lista de contratos a buscar SOLO desde
// `sillas.numero_contrato`, ignorando `contrato_manual` por completo.
//
// Corrección post-revisión (blocker de PR #289): la primera versión resolvía
// la ambigüedad y buscaba los infantes con el CLIENTE DE SESIÓN (sometido a
// RLS por tenant vía `puede_ver_tenant()`/`puede_ver_contrato()`), lo que
// ocultaba ambigüedades reales entre '00-0541' y 'MIN-00-0541' para roles
// `administracion`/`operaciones`, o impedía resolver el contrato legítimo del
// otro tenant. `resolverManifiestoAutorizado` corrige esto: autoriza con el
// cliente de sesión (mi_rol() en el módulo Vuelos) y solo entonces usa un
// cliente ADMIN inyectado (nunca el real en pruebas) para las lecturas
// cross-tenant de `ventas` y `contrato_pasajeros`.
//
// Este archivo prueba el módulo (lib/vuelos/contratoManual.ts) con ejecución
// real de las funciones exportadas, nunca una reimplementación.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import {
  normalizarReferenciaManual,
  candidatosNumeroContrato,
  resolverReferenciasManuales,
  buscarNumerosContratoExistentes,
  usuarioAutorizadoParaVuelos,
  resolverManifiestoAutorizado,
} from "../lib/vuelos/contratoManual.ts";

type SB = SupabaseClient<Database>;
/** Cast único para los stubs de prueba — nunca son un cliente Supabase real. */
function comoSB(fake: object): SB {
  return fake as unknown as SB;
}

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
    const resultado = await buscarNumerosContratoExistentes(comoSB(fake), []);
    assert.equal(resultado.size, 0);
    assert.equal(llamadas.length, 0, "no debió llamar a from(ventas) sin candidatos");
  });

  test("devuelve exactamente los numero_contrato que SÍ existen entre los candidatos", async () => {
    const { fake } = fakeSb(["MIN-00-0541"]);
    const resultado = await buscarNumerosContratoExistentes(comoSB(fake), ["00-0541", "MIN-00-0541"]);
    assert.deepEqual([...resultado], ["MIN-00-0541"]);
  });
});

describe("usuarioAutorizadoParaVuelos — única fuente: mi_rol(), fail-closed", () => {
  function fakeSesion(rol: string | null, { fallar = false }: { fallar?: boolean } = {}) {
    return {
      rpc(fn: string) {
        assert.equal(fn, "mi_rol", "debe llamar exactamente al RPC mi_rol");
        if (fallar) return Promise.resolve({ data: null, error: new Error("boom") });
        return Promise.resolve({ data: rol, error: null });
      },
      // No debe usarse from() en ningún punto de esta función.
      from() {
        throw new Error("usuarioAutorizadoParaVuelos no debe consultar tablas, solo mi_rol()");
      },
    };
  }

  for (const rol of ["superadmin", "administracion", "gerencia", "operaciones", "control_vuelo"]) {
    test(`rol '${rol}' (miembro de LECTURA_MODULO.vuelos) autoriza`, async () => {
      assert.equal(await usuarioAutorizadoParaVuelos(comoSB(fakeSesion(rol))), true);
    });
  }

  for (const rol of ["venta", "agencia", "freelance", "cliente_final"]) {
    test(`rol '${rol}' (fuera de LECTURA_MODULO.vuelos) NO autoriza`, async () => {
      assert.equal(await usuarioAutorizadoParaVuelos(comoSB(fakeSesion(rol))), false);
    });
  }

  test("rol null (usuario inactivo, migración 140) NO autoriza", async () => {
    assert.equal(await usuarioAutorizadoParaVuelos(comoSB(fakeSesion(null))), false);
  });

  test("error del RPC NO autoriza (fail-closed, no revienta)", async () => {
    assert.equal(await usuarioAutorizadoParaVuelos(comoSB(fakeSesion("superadmin", { fallar: true }))), false);
  });

  test("rpc() que lanza una excepción NO autoriza (fail-closed)", async () => {
    const sesion = {
      rpc() {
        throw new Error("red caída");
      },
    };
    assert.equal(await usuarioAutorizadoParaVuelos(comoSB(sesion)), false);
  });
});

describe("resolverManifiestoAutorizado — REQUERIDO: autoriza con sesión, resuelve/lee con admin", () => {
  // Cliente de sesión falso: autoriza (o no) vía mi_rol(), y si alguna vez
  // recibe una llamada a from(), es la señal de que el "camino RLS" viejo
  // seguiría en uso — eso es justamente lo que esta corrección elimina.
  function fakeSesionAutoriza(rol: string | null) {
    return {
      rpc(fn: string) {
        assert.equal(fn, "mi_rol");
        return Promise.resolve({ data: rol, error: null });
      },
      from() {
        throw new Error("el cliente de SESIÓN no debe usarse para leer ventas/contrato_pasajeros — esa es exactamente la vulnerabilidad corregida");
      },
    };
  }

  // Cliente "admin" falso con visibilidad TOTAL (simula service_role, sin
  // RLS): ve ventas/pasajeros de CUALQUIER tenant, a diferencia de un cliente
  // de sesión de administracion/operaciones (limitado a su propio tenant).
  function fakeAdmin({
    ventas = [] as string[],
    pasajeros = [] as { id: number; nombre: string; tipo_id: string | null; identificacion: string | null; numero_contrato: string }[],
  }) {
    const llamadasVentas: string[][] = [];
    const llamadasPasajeros: string[][] = [];
    const fake = {
      from(tabla: string) {
        if (tabla === "ventas") {
          return {
            select() {
              return {
                in(_col: string, candidatos: string[]) {
                  llamadasVentas.push(candidatos);
                  return Promise.resolve({
                    data: candidatos.filter((c) => ventas.includes(c)).map((c) => ({ numero_contrato: c })),
                  });
                },
              };
            },
          };
        }
        if (tabla === "contrato_pasajeros") {
          return {
            select() {
              return {
                eq(col: string, val: boolean) {
                  assert.equal(col, "es_infante");
                  assert.equal(val, true);
                  return {
                    in(_col2: string, contratos: string[]) {
                      llamadasPasajeros.push(contratos);
                      return Promise.resolve({ data: pasajeros.filter((p) => contratos.includes(p.numero_contrato)) });
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`tabla inesperada: ${tabla}`);
      },
    };
    return { fake, llamadasVentas, llamadasPasajeros };
  }

  test("1) REQUERIDO: ambigüedad oculta por RLS al cliente de sesión SÍ se detecta con el cliente admin (visión completa)", async () => {
    // El cliente de sesión ni siquiera se usa para esto (solo autoriza) — la
    // prueba real es que el admin, viendo AMBOS candidatos, falla cerrado.
    const { fake: admin } = fakeAdmin({ ventas: ["00-0541", "MIN-00-0541"] });
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("administracion")),
      [],
      ["00-0541"],
      () => comoSB(admin)
    );
    assert.equal(resultado.referenciaManualPorContrato.size, 0, "ambigüedad real -> fail-closed, no se vincula ninguno");
  });

  test("2) REQUERIDO: usuario de tenant mayorista resuelve MIN-00-0541 desde un bloqueo autorizado con contrato_manual '00-0541'", async () => {
    const { fake: admin } = fakeAdmin({
      ventas: ["MIN-00-0541"],
      pasajeros: [{ id: 1, nombre: "BEBE PEREZ", tipo_id: "RC", identificacion: "999", numero_contrato: "MIN-00-0541" }],
    });
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("administracion")),
      [],
      ["00-0541"],
      () => comoSB(admin)
    );
    assert.equal(resultado.referenciaManualPorContrato.get("00-0541"), "MIN-00-0541");
  });

  test("3) REQUERIDO: contrato_pasajeros también devuelve el infante cross-tenant una vez resuelta la ambigüedad", async () => {
    const { fake: admin } = fakeAdmin({
      ventas: ["MIN-00-0541"],
      pasajeros: [{ id: 7, nombre: "BEBE MIN", tipo_id: "RC", identificacion: "111", numero_contrato: "MIN-00-0541" }],
    });
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("operaciones")),
      [],
      ["00-0541"],
      () => comoSB(admin)
    );
    assert.equal(resultado.infantes.length, 1);
    assert.equal(resultado.infantes[0].numero_contrato, "MIN-00-0541");
  });

  test("4) REQUERIDO: usuario SIN autorización al módulo Vuelos nunca construye ni toca el cliente admin", async () => {
    let adminConstruido = false;
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("venta")),
      ["00-0100"],
      ["00-0541"],
      () => {
        adminConstruido = true;
        throw new Error("no debería llegar a construirse");
      }
    );
    assert.equal(adminConstruido, false, "el factory del cliente admin no debe invocarse sin autorización");
    assert.equal(resultado.infantes.length, 0);
    assert.equal(resultado.referenciaManualPorContrato.size, 0);
  });

  test("5) REQUERIDO: referencia externa sin venta interna real no inventa pasajeros", async () => {
    const { fake: admin } = fakeAdmin({ ventas: [] });
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("superadmin")),
      [],
      ["Viajes ABC 123"],
      () => comoSB(admin)
    );
    assert.equal(resultado.referenciaManualPorContrato.size, 0);
    assert.equal(resultado.infantes.length, 0);
  });

  test("6) REQUERIDO: el numero_contrato orgánico se mantiene intacto (siempre entra a la búsqueda de infantes, con o sin referencias manuales)", async () => {
    const { fake: admin, llamadasPasajeros } = fakeAdmin({
      pasajeros: [{ id: 3, nombre: "BEBE ORGANICO", tipo_id: "TI", identificacion: "222", numero_contrato: "00-0700" }],
    });
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("gerencia")),
      ["00-0700"],
      [],
      () => comoSB(admin)
    );
    assert.deepEqual(llamadasPasajeros[0], ["00-0700"]);
    assert.equal(resultado.infantes[0]?.numero_contrato, "00-0700");
  });

  test("7) REQUERIDO: el infante aparece con sillaId inexistente en su tipo (InfantePasajero no modela silla) — una sola vez por numero_contrato consultado", async () => {
    const { fake: admin } = fakeAdmin({
      ventas: ["MIN-00-0541"],
      pasajeros: [{ id: 9, nombre: "UNICO", tipo_id: "RC", identificacion: "333", numero_contrato: "MIN-00-0541" }],
    });
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("administracion")),
      [],
      ["00-0541", "00-0541"], // repetido a propósito: no debe duplicar la fila
      () => comoSB(admin)
    );
    assert.equal(resultado.infantes.length, 1);
    assert.ok(!("sillaId" in resultado.infantes[0]), "InfantePasajero no debe tener sillaId — un infante nunca ocupa silla");
  });

  test("8) REQUERIDO: ningún secreto administrativo se expone — el factory es el ÚNICO punto de construcción, nunca se usa un client-side/anon key aquí", async () => {
    // La prueba estructural (nada de service_role en código de cliente) vive
    // en las pruebas de cableado (wiring); aquí se verifica el contrato de
    // la función: si crearClienteAdmin lanza (p. ej. sin
    // SUPABASE_SERVICE_ROLE_KEY), nunca cae de vuelta al cliente de sesión.
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("superadmin")),
      ["00-0700"],
      [],
      () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada");
      }
    );
    assert.deepEqual(resultado, { infantes: [], referenciaManualPorContrato: new Map() });
  });

  test("sin contratos orgánicos ni referencias manuales resueltas: no consulta contrato_pasajeros", async () => {
    const { fake: admin, llamadasPasajeros } = fakeAdmin({});
    const resultado = await resolverManifiestoAutorizado(
      comoSB(fakeSesionAutoriza("superadmin")),
      [],
      [],
      () => comoSB(admin)
    );
    assert.equal(llamadasPasajeros.length, 0);
    assert.equal(resultado.infantes.length, 0);
  });
});
