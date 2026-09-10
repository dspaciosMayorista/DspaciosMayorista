import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptarTarifaAlojamientoPersistida,
  type CodigoRechazo,
  type ResultadoAdaptacionTarifaUnidad,
  type TarifaUnidadAdaptada,
  type TarifaUnidadRechazada,
} from "../lib/calc/tarifaAlojamientoPersistida.ts";
import { cotizarUnidadAlojamiento } from "../lib/calc/unidadAlojamiento.ts";

// ─────────────────────────────────────────────────────────────────────────
// Adaptador `hotel_tarifas_unidad` (migración 173) → `TarifaAlojamiento`.
//
// TODOS los datos de este archivo son FIXTURES SINTÉTICOS: ids, importes y
// páginas inventados para las pruebas. No hay ni un dato real de Bernalo
// cargado acá ni en la migración — la versión "bernalo-2026" se usa como
// ETIQUETA de prueba (igual que en `unidadAlojamiento.test.ts`), no como un
// tarifario existente.
//
// El eje de las pruebas es el contrato fail-closed del adaptador: cada caso
// afirma el CÓDIGO de rechazo, no solo que "algo falló".
// ─────────────────────────────────────────────────────────────────────────

function esperarOk(r: ResultadoAdaptacionTarifaUnidad): asserts r is TarifaUnidadAdaptada {
  assert.equal(r.ok, true, `se esperaba una adaptación válida, se obtuvo: ${!r.ok ? `${r.codigo} — ${r.mensaje}` : ""}`);
}

function esperarRechazo(r: ResultadoAdaptacionTarifaUnidad, codigo: CodigoRechazo): asserts r is TarifaUnidadRechazada {
  assert.equal(r.ok, false, `se esperaba un rechazo "${codigo}", se obtuvo una adaptación válida`);
  if (!r.ok) assert.equal(r.codigo, codigo, `código inesperado: ${r.codigo} — ${r.mensaje}`);
}

const VERSION = "bernalo-2026";

// Tipos de los fixtures. Las columnas y los campos NULLABLES se declaran
// nullables —igual que en la tabla y en el tipo del motor— porque hay casos
// que necesitan escribir `null` explícito para probar la coherencia
// columna↔payload; con el tipo inferido del literal esos casos no compilarían
// (y el error de tipos taparía justo lo que la prueba quiere verificar).
type PayloadFixture = {
  id: string;
  versionTarifario: string;
  unidadCobro: string;
  valores: { adulto: number; nino?: number; infante?: number; periodicidadInfante?: string };
  capacidad: { minPax: number; maxPax: number | null; paxIncluidos: number };
  suplementos: unknown[];
  reglaMenores: { reglas: unknown[] };
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
  fuente: { documento: string; pagina: number | null } | null;
};

type FilaFixture = {
  id: number;
  hotel_id: number;
  tarifa_id: string;
  version_tarifario: string;
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
  estado: string;
  fuente_documento: string | null;
  fuente_pagina: number | null;
  payload: PayloadFixture;
};

// Tarifa de PAREJA (cobro por unidad, sin política de menores — el caso real
// de los "hoteles de pareja"). Cada llamada devuelve objetos NUEVOS, para
// que un test no pueda contaminar a otro mutando el fixture.
function payloadPareja(): PayloadFixture {
  return {
    id: "t-fixture-pareja",
    versionTarifario: VERSION,
    unidadCobro: "pareja",
    valores: { adulto: 550_000 },
    capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
    suplementos: [],
    reglaMenores: { reglas: [] },
    temporada: "ALTA",
    categoria: "Estándar",
    alimentacion: "PAM",
    fuente: { documento: "Documento de prueba", pagina: 13 },
  };
}

// Fila persistida coherente con `payloadPareja()` — la referencia "todo bien".
function filaPareja(): FilaFixture {
  return {
    id: 7,
    hotel_id: 42,
    tarifa_id: "t-fixture-pareja",
    version_tarifario: VERSION,
    temporada: "ALTA",
    categoria: "Estándar",
    alimentacion: "PAM",
    estado: "publicada",
    fuente_documento: "Documento de prueba",
    fuente_pagina: 13,
    payload: payloadPareja(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — fila válida", () => {
  test("adapta una fila de pareja y devuelve la tarifa que el motor consume", () => {
    const r = adaptarTarifaAlojamientoPersistida(filaPareja());
    esperarOk(r);
    assert.equal(r.id, 7);
    assert.equal(r.hotelId, 42);
    assert.equal(r.estado, "publicada");
    assert.deepEqual(r.tarifa, {
      id: "t-fixture-pareja",
      unidadCobro: "pareja",
      valores: { adulto: 550_000 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
      temporada: "ALTA",
      categoria: "Estándar",
      alimentacion: "PAM",
      fuente: { documento: "Documento de prueba", pagina: 13 },
      versionTarifario: VERSION,
    });
  });

  test("la tarifa adaptada la acepta el motor tal cual (es la que se cotizaría)", () => {
    const r = adaptarTarifaAlojamientoPersistida(filaPareja());
    esperarOk(r);
    const cotizacion = cotizarUnidadAlojamiento({
      tarifa: r.tarifa,
      distribucion: { unidades: [{ adultos: 2, menores: [] }] },
      noches: 2,
    });
    assert.equal(cotizacion.ok, true);
  });

  test("no queda aliada a la fila de entrada: mutar el payload después no cambia lo devuelto", () => {
    const fila = filaPareja();
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);

    fila.payload.valores.adulto = 1;
    fila.payload.fuente = { documento: "Documento de prueba", pagina: 999 };
    fila.payload.capacidad.maxPax = 99;

    assert.equal(r.tarifa.valores.adulto, 550_000);
    assert.deepEqual(r.tarifa.fuente, { documento: "Documento de prueba", pagina: 13 });
    assert.equal(r.tarifa.capacidad.maxPax, 2);
  });

  test("campos opcionales ausentes del payload NO se rellenan con un default", () => {
    const payload: Record<string, unknown> = payloadPareja();
    delete payload.temporada;
    delete payload.categoria;
    delete payload.alimentacion;
    delete payload.fuente;

    const r = adaptarTarifaAlojamientoPersistida({
      id: 1,
      hotel_id: 42,
      tarifa_id: "t-fixture-pareja",
      version_tarifario: VERSION,
      temporada: null,
      categoria: null,
      alimentacion: null,
      estado: "borrador",
      fuente_documento: null,
      fuente_pagina: null,
      payload,
    });
    esperarOk(r);
    // Ni siquiera como `null` explícito: la clave no existe, igual que en el
    // payload de origen. Un `null` inventado sería un dato que no vino de
    // ninguna parte.
    assert.equal("temporada" in r.tarifa, false);
    assert.equal("categoria" in r.tarifa, false);
    assert.equal("alimentacion" in r.tarifa, false);
    assert.equal("fuente" in r.tarifa, false);
  });

  test("`fuente: null` en el payload y columnas vacías es coherente", () => {
    const fila = filaPareja();
    fila.payload.fuente = null;
    fila.fuente_documento = null;
    fila.fuente_pagina = null;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
    assert.equal(r.tarifa.fuente, null);
  });

  test("sin PK en la fila (select parcial): `id` queda null, la adaptación sigue siendo válida", () => {
    const fila: Record<string, unknown> = filaPareja();
    delete fila.id;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
    assert.equal(r.id, null);
  });

  test("NO filtra por `estado`: una tarifa en borrador o inactiva se adapta igual", () => {
    for (const estado of ["borrador", "inactiva"]) {
      const fila = filaPareja();
      fila.estado = estado;
      const r = adaptarTarifaAlojamientoPersistida(fila);
      esperarOk(r);
      assert.equal(r.estado, estado);
    }
  });

  test("no lanza nunca: entradas absurdas producen un rechazo, jamás un TypeError", () => {
    const entradas: unknown[] = [null, undefined, 42, "texto", [], () => {}, Symbol("x"), BigInt(0)];
    for (const entrada of entradas) {
      const r = adaptarTarifaAlojamientoPersistida(entrada);
      esperarRechazo(r, "fila_no_es_objeto");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — columnas espejo incoherentes con el payload", () => {
  test("tarifa_id ≠ payload.id", () => {
    const fila = filaPareja();
    fila.tarifa_id = "t-otra";
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "payload_incoherente_con_columnas");
    assert.equal(r.contexto.columnaTarifaId, "t-otra");
    assert.equal(r.contexto.payloadId, "t-fixture-pareja");
    assert.equal(r.contexto.hotelId, 42);
  });

  test("version_tarifario ≠ payload.versionTarifario", () => {
    const fila = filaPareja();
    fila.version_tarifario = "bernalo-2025";
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "payload_incoherente_con_columnas");
    assert.equal(r.contexto.columnaVersion, "bernalo-2025");
    assert.equal(r.contexto.payloadVersion, VERSION);
  });

  test("temporada: columna con valor, payload con otro", () => {
    const fila = filaPareja();
    fila.temporada = "BAJA";
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("temporada: columna con valor, payload en null", () => {
    const fila = filaPareja();
    fila.payload.temporada = null;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "payload_incoherente_con_columnas");
    assert.equal(r.contexto.valorColumna, "ALTA");
    assert.equal(r.contexto.valorPayload, null);
  });

  test("temporada: columna en null, payload con valor", () => {
    const fila = filaPareja();
    fila.temporada = null;
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("temporada: `undefined` en la columna SÍ equivale a null (normalización explícita)", () => {
    const fila: Record<string, unknown> = filaPareja();
    delete fila.temporada;
    // `fila.payload` es `unknown` en un `Record<string, unknown>`: hay que
    // abrirlo explícitamente para escribir el campo que la prueba necesita.
    (fila.payload as Record<string, unknown>).temporada = null;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
    assert.equal(r.tarifa.temporada, null);
  });

  test("categoria incoherente", () => {
    const fila = filaPareja();
    fila.categoria = "Superior";
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("alimentacion incoherente", () => {
    const fila = filaPareja();
    fila.alimentacion = "PC";
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("fuente_documento distinto del payload", () => {
    const fila = filaPareja();
    fila.fuente_documento = "Otro documento";
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "payload_incoherente_con_columnas");
    assert.equal(r.contexto.columnaDocumento, "Otro documento");
    assert.equal(r.contexto.payloadDocumento, "Documento de prueba");
  });

  test("fuente_documento con cadena vacía NO se confunde con null (comparación literal)", () => {
    const fila = filaPareja();
    fila.fuente_documento = "";
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("fuente_pagina distinta del payload", () => {
    const fila = filaPareja();
    fila.fuente_pagina = 14;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "payload_incoherente_con_columnas");
    assert.equal(r.contexto.columnaPagina, 14);
    assert.equal(r.contexto.payloadPagina, 13);
  });

  test("fuente_pagina en null cuando el payload declara una página", () => {
    const fila = filaPareja();
    fila.fuente_pagina = null;
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("fuente_pagina con número cuando el payload no tiene fuente", () => {
    const fila = filaPareja();
    fila.payload.fuente = null;
    fila.fuente_documento = null;
    fila.fuente_pagina = 13;
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("payload sin fuente pero columna de documento puesta", () => {
    const fila = filaPareja();
    fila.payload.fuente = null;
    fila.fuente_documento = "Documento de prueba";
    fila.fuente_pagina = null;
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_incoherente_con_columnas");
  });

  test("fuente presente en el payload con página null y columna null: coherente", () => {
    const fila = filaPareja();
    fila.payload.fuente = { documento: "Documento de prueba", pagina: null };
    fila.fuente_pagina = null;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
    assert.deepEqual(r.tarifa.fuente, { documento: "Documento de prueba", pagina: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — payload malformado", () => {
  test("payload null / arreglo / escalar → payload_no_es_objeto", () => {
    for (const payload of [null, undefined, [], "texto", 42, true]) {
      const fila = filaPareja();
      (fila as Record<string, unknown>).payload = payload;
      esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "payload_no_es_objeto");
    }
  });

  test("payload objeto pero sin `id` → tarifa_invalida (el motor manda)", () => {
    const fila = filaPareja();
    delete (fila.payload as Record<string, unknown>).id;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "tarifa_invalida");
    assert.equal(r.codigoMotor, "configuracion_invalida");
    assert.match(r.mensaje, /tarifa\.id/);
  });

  test("payload sin `suplementos` → tarifa_invalida", () => {
    const fila = filaPareja();
    delete (fila.payload as Record<string, unknown>).suplementos;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "tarifa_invalida");
    assert.equal(r.codigoMotor, "configuracion_invalida");
  });

  test("payload con `valores` vacío → tarifa_invalida", () => {
    const fila = filaPareja();
    fila.payload.valores = {} as typeof fila.payload.valores;
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "tarifa_invalida");
    assert.equal(r.codigoMotor, "configuracion_invalida");
  });

  test("payload con una clave desconocida en `valores` → tarifa_invalida", () => {
    const fila = filaPareja();
    (fila.payload.valores as Record<string, unknown>).extra = 1;
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "tarifa_invalida");
  });

  test("payload sin `reglaMenores` → tarifa_invalida", () => {
    const fila = filaPareja();
    delete (fila.payload as Record<string, unknown>).reglaMenores;
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "tarifa_invalida");
  });

  test("un payload inválido se reporta ANTES que una columna incoherente (el payload es la fuente)", () => {
    const fila = filaPareja();
    (fila.payload as Record<string, unknown>).unidadCobro = "suite";
    fila.tarifa_id = "t-otra"; // también incoherente
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "tarifa_invalida");
    assert.equal(r.contexto.idFila, 7); // contexto de rastreo de la fila, sin validar
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — unidad de cobro desconocida", () => {
  test("unidadCobro fuera del enum → tarifa_invalida con el valor en el contexto", () => {
    const fila = filaPareja();
    (fila.payload as Record<string, unknown>).unidadCobro = "suite";
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "tarifa_invalida");
    assert.equal(r.codigoMotor, "configuracion_invalida");
    assert.equal(r.contexto.unidadCobro, "suite");
  });

  test("unidadCobro ausente → tarifa_invalida", () => {
    const fila = filaPareja();
    delete (fila.payload as Record<string, unknown>).unidadCobro;
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "tarifa_invalida");
  });

  test("las cuatro unidades válidas adaptan sin ruido", () => {
    const unidades: { unidad: string; payload: Record<string, unknown> }[] = [
      { unidad: "persona", payload: { valores: { adulto: 100_000 }, capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 }, suplementos: [], reglaMenores: { reglas: [] } } },
      { unidad: "pareja", payload: { valores: { adulto: 550_000 }, capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 }, suplementos: [], reglaMenores: { reglas: [] } } },
      { unidad: "habitacion", payload: { valores: { adulto: 500_000 }, capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 }, suplementos: [{ tipo: "adulto_adicional", valor: 10_000 }], reglaMenores: { reglas: [] } } },
      { unidad: "apartamento", payload: { valores: { adulto: 800_000 }, capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 6 }, suplementos: [], reglaMenores: { reglas: [] } } },
    ];
    for (const { unidad, payload } of unidades) {
      const fila = {
        id: 1,
        hotel_id: 42,
        tarifa_id: `t-fixture-${unidad}`,
        version_tarifario: VERSION,
        temporada: null,
        categoria: null,
        alimentacion: null,
        estado: "publicada",
        fuente_documento: null,
        fuente_pagina: null,
        payload: { ...payload, id: `t-fixture-${unidad}`, versionTarifario: VERSION, unidadCobro: unidad },
      };
      const r = adaptarTarifaAlojamientoPersistida(fila);
      esperarOk(r);
      assert.equal(r.tarifa.unidadCobro, unidad);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — importes y números inválidos", () => {
  const casos: { nombre: string; mutar: (payload: Record<string, unknown>) => void }[] = [
    { nombre: "adulto negativo", mutar: (p) => ((p.valores as Record<string, unknown>).adulto = -1) },
    { nombre: "adulto decimal", mutar: (p) => ((p.valores as Record<string, unknown>).adulto = 1000.5) },
    { nombre: "adulto NaN", mutar: (p) => ((p.valores as Record<string, unknown>).adulto = NaN) },
    { nombre: "adulto Infinity", mutar: (p) => ((p.valores as Record<string, unknown>).adulto = Infinity) },
    { nombre: "adulto texto", mutar: (p) => ((p.valores as Record<string, unknown>).adulto = "550000") },
    { nombre: "minPax 0", mutar: (p) => ((p.capacidad as Record<string, unknown>).minPax = 0) },
    { nombre: "maxPax menor que minPax", mutar: (p) => ((p.capacidad as Record<string, unknown>).paxIncluidos = 5) },
    { nombre: "paxIncluidos negativo", mutar: (p) => ((p.capacidad as Record<string, unknown>).paxIncluidos = -1) },
    {
      nombre: "suplemento con valor negativo",
      mutar: (p) => {
        (p as Record<string, unknown>).unidadCobro = "habitacion";
        (p.capacidad as Record<string, unknown>).maxPax = 4;
        (p.capacidad as Record<string, unknown>).paxIncluidos = 2;
        p.suplementos = [{ tipo: "adulto_adicional", valor: -10 }];
      },
    },
    {
      nombre: "regla de edad invertida",
      mutar: (p) => (p.reglaMenores = { reglas: [{ categoria: "nino", edadMinAnios: 10, edadMaxAnios: 4 }] }),
    },
    {
      nombre: "regla de edad no entera",
      mutar: (p) => (p.reglaMenores = { reglas: [{ categoria: "nino", edadMinAnios: 0.5, edadMaxAnios: 4 }] }),
    },
  ];

  for (const caso of casos) {
    test(`${caso.nombre} → tarifa_invalida`, () => {
      const fila = filaPareja();
      caso.mutar(fila.payload as unknown as Record<string, unknown>);
      const r = adaptarTarifaAlojamientoPersistida(fila);
      esperarRechazo(r, "tarifa_invalida");
      assert.equal(r.codigoMotor, "configuracion_invalida");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — periodicidad de infante", () => {
  test("infante configurado SIN periodicidad → tarifa_invalida (no se asume una interpretación)", () => {
    const fila = filaPareja();
    fila.payload.unidadCobro = "persona";
    (fila.payload as Record<string, unknown>).valores = { adulto: 100_000, infante: 30_000 };
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: null, paxIncluidos: 0 };
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "tarifa_invalida");
    assert.equal(r.codigoMotor, "configuracion_invalida");
    assert.match(r.mensaje, /periodicidadInfante/);
  });

  test("periodicidad sin infante configurado → tarifa_invalida", () => {
    const fila = filaPareja();
    fila.payload.unidadCobro = "persona";
    (fila.payload as Record<string, unknown>).valores = { adulto: 100_000, periodicidadInfante: "por_noche" };
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: null, paxIncluidos: 0 };
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "tarifa_invalida");
    assert.match(r.mensaje, /periodicidadInfante/);
  });

  test("periodicidad con valor fuera del enum → tarifa_invalida", () => {
    const fila = filaPareja();
    fila.payload.unidadCobro = "persona";
    (fila.payload as Record<string, unknown>).valores = {
      adulto: 100_000,
      infante: 30_000,
      periodicidadInfante: "por_dia",
    };
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: null, paxIncluidos: 0 };
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "tarifa_invalida");
  });

  test("control positivo: infante CON periodicidad explícita adapta y la conserva", () => {
    const fila = filaPareja();
    fila.payload.unidadCobro = "persona";
    (fila.payload as Record<string, unknown>).valores = {
      adulto: 100_000,
      nino: 70_000,
      infante: 30_000,
      periodicidadInfante: "por_noche",
    };
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: null, paxIncluidos: 0 };
    (fila.payload as Record<string, unknown>).reglaMenores = {
      reglas: [
        { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
        { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 },
        { categoria: "adulto", edadMinAnios: 11, edadMaxAnios: 17 },
      ],
    };
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
    assert.deepEqual(r.tarifa.valores, {
      adulto: 100_000,
      nino: 70_000,
      infante: 30_000,
      periodicidadInfante: "por_noche",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — suplementos incompatibles", () => {
  const casos: { nombre: string; mutar: (payload: Record<string, unknown>) => void }[] = [
    {
      nombre: "persona con suplementos",
      mutar: (p) => {
        p.unidadCobro = "persona";
        (p as Record<string, unknown>).valores = { adulto: 100_000, nino: 70_000 };
        (p.capacidad as Record<string, unknown>).minPax = 1;
        (p.capacidad as Record<string, unknown>).maxPax = null;
        (p.capacidad as Record<string, unknown>).paxIncluidos = 0;
        p.suplementos = [{ tipo: "adulto_adicional", valor: 10_000 }];
      },
    },
    {
      nombre: "habitacion con persona_sola",
      mutar: (p) => {
        p.unidadCobro = "habitacion";
        (p.capacidad as Record<string, unknown>).maxPax = 4;
        (p.capacidad as Record<string, unknown>).paxIncluidos = 2;
        p.suplementos = [{ tipo: "persona_sola", valor: 10_000 }];
      },
    },
    {
      nombre: "pareja con valores.nino (el cálculo los ignoraría)",
      mutar: (p) => ((p.valores as Record<string, unknown>).nino = 70_000),
    },
    {
      nombre: "habitacion con valores.infante",
      mutar: (p) => {
        p.unidadCobro = "habitacion";
        (p.valores as Record<string, unknown>).infante = 30_000;
        (p.valores as Record<string, unknown>).periodicidadInfante = "por_noche";
      },
    },
    {
      nombre: "suplemento duplicado",
      mutar: (p) => {
        p.unidadCobro = "habitacion";
        (p.capacidad as Record<string, unknown>).minPax = 1;
        (p.capacidad as Record<string, unknown>).maxPax = 4;
        (p.capacidad as Record<string, unknown>).paxIncluidos = 2;
        p.suplementos = [
          { tipo: "adulto_adicional", valor: 10_000 },
          { tipo: "adulto_adicional", valor: 20_000 },
        ];
      },
    },
    {
      nombre: "menor_adicional sin categoriaMenor",
      mutar: (p) => {
        p.unidadCobro = "habitacion";
        (p.capacidad as Record<string, unknown>).minPax = 1;
        (p.capacidad as Record<string, unknown>).maxPax = 4;
        (p.capacidad as Record<string, unknown>).paxIncluidos = 2;
        p.suplementos = [{ tipo: "menor_adicional", valor: 10_000 }];
      },
    },
    {
      nombre: "adulto_adicional con categoriaMenor puesta",
      mutar: (p) => {
        p.unidadCobro = "habitacion";
        (p.capacidad as Record<string, unknown>).minPax = 1;
        (p.capacidad as Record<string, unknown>).maxPax = 4;
        (p.capacidad as Record<string, unknown>).paxIncluidos = 2;
        p.suplementos = [{ tipo: "adulto_adicional", categoriaMenor: "nino", valor: 10_000 }];
      },
    },
    {
      nombre: "suplemento con tipo desconocido",
      mutar: (p) => {
        p.unidadCobro = "habitacion";
        (p.capacidad as Record<string, unknown>).maxPax = 4;
        (p.capacidad as Record<string, unknown>).paxIncluidos = 2;
        p.suplementos = [{ tipo: "nino_gratis", valor: 0 }];
      },
    },
  ];

  for (const caso of casos) {
    test(`${caso.nombre} → tarifa_invalida`, () => {
      const fila = filaPareja();
      caso.mutar(fila.payload as unknown as Record<string, unknown>);
      esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "tarifa_invalida");
    });
  }

  test("control positivo: habitación con adulto_adicional y menor_adicional compatibles adapta", () => {
    const fila = filaPareja();
    (fila.payload as Record<string, unknown>).unidadCobro = "habitacion";
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: 4, paxIncluidos: 2 };
    (fila.payload as Record<string, unknown>).suplementos = [
      { tipo: "adulto_adicional", valor: 10_000 },
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 5_000 },
    ];
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
    assert.deepEqual(r.tarifa.suplementos, [
      { tipo: "adulto_adicional", valor: 10_000 },
      { tipo: "menor_adicional", categoriaMenor: "nino", valor: 5_000 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — reglas de edad ambiguas", () => {
  test("dos rangos superpuestos → reglas_edad_ambiguas, con las dos reglas en el contexto", () => {
    const fila = filaPareja();
    fila.payload.unidadCobro = "persona";
    (fila.payload as Record<string, unknown>).valores = { adulto: 100_000, nino: 70_000 };
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: null, paxIncluidos: 0 };
    (fila.payload as Record<string, unknown>).reglaMenores = {
      reglas: [
        { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
        { categoria: "nino", edadMinAnios: 3, edadMaxAnios: 10 },
      ],
    };
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(r, "reglas_edad_ambiguas");
    assert.deepEqual(r.contexto.reglaA, { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 });
    assert.deepEqual(r.contexto.reglaB, { categoria: "nino", edadMinAnios: 3, edadMaxAnios: 10 });
    assert.match(r.mensaje, /se superponen/);
  });

  test("reglas idénticas duplicadas también son ambiguas", () => {
    const fila = filaPareja();
    (fila.payload as Record<string, unknown>).reglaMenores = {
      reglas: [
        { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 },
        { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 },
      ],
    };
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "reglas_edad_ambiguas");
  });

  test("rango contenido dentro de otro → ambiguo", () => {
    const fila = filaPareja();
    (fila.payload as Record<string, unknown>).reglaMenores = {
      reglas: [
        { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 },
        { categoria: "infante", edadMinAnios: 5, edadMaxAnios: 6 },
      ],
    };
    esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "reglas_edad_ambiguas");
  });

  test("control positivo: rangos contiguos sin solape (0-3 / 4-10 / 11-17) adaptan", () => {
    const fila = filaPareja();
    fila.payload.unidadCobro = "persona";
    (fila.payload as Record<string, unknown>).valores = { adulto: 100_000, nino: 70_000, infante: 30_000, periodicidadInfante: "por_noche" };
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: null, paxIncluidos: 0 };
    (fila.payload as Record<string, unknown>).reglaMenores = {
      reglas: [
        { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
        { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 },
        { categoria: "adulto", edadMinAnios: 11, edadMaxAnios: 17 },
      ],
    };
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
    assert.equal(r.tarifa.reglaMenores.reglas.length, 3);
  });

  test("sin reglas (hotel de pareja) adapta", () => {
    const r = adaptarTarifaAlojamientoPersistida(filaPareja());
    esperarOk(r);
    assert.deepEqual(r.tarifa.reglaMenores.reglas, []);
  });

  test("un HUECO entre rangos NO se rechaza (deliberado: es un caso del pasajero, no de la tarifa)", () => {
    const fila = filaPareja();
    (fila.payload as Record<string, unknown>).reglaMenores = {
      reglas: [
        { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
        { categoria: "nino", edadMinAnios: 6, edadMaxAnios: 10 },
      ],
    };
    const r = adaptarTarifaAlojamientoPersistida(fila);
    esperarOk(r);
  });

  test("es estrictamente más restrictivo que el motor: el solape se detecta sin necesitar una edad", () => {
    const fila = filaPareja();
    fila.payload.unidadCobro = "persona";
    (fila.payload as Record<string, unknown>).valores = { adulto: 100_000, nino: 70_000, infante: 30_000, periodicidadInfante: "por_noche" };
    (fila.payload as Record<string, unknown>).capacidad = { minPax: 1, maxPax: null, paxIncluidos: 0 };
    (fila.payload as Record<string, unknown>).reglaMenores = {
      reglas: [
        { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
        { categoria: "nino", edadMinAnios: 2, edadMaxAnios: 10 }, // solapa 2-3
      ],
    };
    const adaptada = adaptarTarifaAlojamientoPersistida(fila);
    esperarRechazo(adaptada, "reglas_edad_ambiguas");

    // El motor, cotizando con una edad FUERA del solape, no se queja — la
    // ambigüedad real solo aparece con una edad de 2-3 años. El adaptador la
    // rechaza antes de que exista un pasajero, que es el punto.
    const sinAmbiguedad = cotizarUnidadAlojamiento({
      tarifa: {
        id: "t-fixture-ambig",
        versionTarifario: VERSION,
        unidadCobro: "persona",
        valores: { adulto: 100_000, nino: 70_000, infante: 30_000, periodicidadInfante: "por_noche" },
        capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
        suplementos: [],
        reglaMenores: {
          reglas: [
            { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
            { categoria: "nino", edadMinAnios: 2, edadMaxAnios: 10 },
          ],
        },
      },
      distribucion: { unidades: [{ adultos: 2, menores: [{ edadAnios: 7 }] }] },
      noches: 1,
    });
    assert.equal(sinAmbiguedad.ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — columnas mal formadas", () => {
  const casos: { nombre: string; mutar: (fila: Record<string, unknown>) => void; contexto?: string }[] = [
    { nombre: "hotel_id ausente", mutar: (f) => delete f.hotel_id },
    { nombre: "hotel_id 0", mutar: (f) => (f.hotel_id = 0) },
    { nombre: "hotel_id negativo", mutar: (f) => (f.hotel_id = -42) },
    { nombre: "hotel_id decimal", mutar: (f) => (f.hotel_id = 42.5) },
    { nombre: "hotel_id como texto", mutar: (f) => (f.hotel_id = "42") },
    { nombre: "tarifa_id vacío", mutar: (f) => (f.tarifa_id = "") },
    { nombre: "tarifa_id solo espacios", mutar: (f) => (f.tarifa_id = "   ") },
    { nombre: "tarifa_id no texto", mutar: (f) => (f.tarifa_id = 12) },
    { nombre: "version_tarifario vacío", mutar: (f) => (f.version_tarifario = "") },
    { nombre: "estado fuera del enum", mutar: (f) => (f.estado = "publicado") },
    { nombre: "estado ausente", mutar: (f) => delete f.estado },
    { nombre: "fuente_pagina 0", mutar: (f) => (f.fuente_pagina = 0) },
    { nombre: "fuente_pagina decimal", mutar: (f) => (f.fuente_pagina = 13.5) },
    { nombre: "temporada no texto", mutar: (f) => (f.temporada = 2026) },
    { nombre: "fuente_documento no texto", mutar: (f) => (f.fuente_documento = { doc: "x" }) },
    { nombre: "id de fila inválido", mutar: (f) => (f.id = "7") },
  ];

  for (const caso of casos) {
    test(`${caso.nombre} → columna_invalida`, () => {
      const fila = filaPareja() as unknown as Record<string, unknown>;
      caso.mutar(fila);
      esperarRechazo(adaptarTarifaAlojamientoPersistida(fila), "columna_invalida");
    });
  }

});

// ─────────────────────────────────────────────────────────────────────────
describe("adaptador — varias modalidades y versiones del MISMO hotel", () => {
  function fila(
    tarifaId: string,
    version: string,
    unidadCobro: string,
    valores: Record<string, unknown>,
    capacidad: Record<string, unknown>,
    suplementos: Record<string, unknown>[] = []
  ) {
    return {
      id: 1,
      hotel_id: 42,
      tarifa_id: tarifaId,
      version_tarifario: version,
      temporada: null,
      categoria: null,
      alimentacion: null,
      estado: "publicada",
      fuente_documento: null,
      fuente_pagina: null,
      payload: {
        id: tarifaId,
        versionTarifario: version,
        unidadCobro,
        valores,
        capacidad,
        suplementos,
        reglaMenores: { reglas: [] },
      },
    };
  }

  test("tres modalidades simultáneas del mismo hotel adaptan las tres, cada una con su unidad", () => {
    const filas = [
      fila("t-modal-pareja", VERSION, "pareja", { adulto: 550_000 }, { minPax: 2, maxPax: 2, paxIncluidos: 2 }),
      fila("t-modal-hab", VERSION, "habitacion", { adulto: 500_000 }, { minPax: 1, maxPax: 4, paxIncluidos: 2 }, [
        { tipo: "adulto_adicional", valor: 10_000 },
      ]),
      fila("t-modal-apto", VERSION, "apartamento", { adulto: 800_000 }, { minPax: 1, maxPax: 6, paxIncluidos: 6 }),
    ];

    const adaptadas = filas.map((f) => adaptarTarifaAlojamientoPersistida(f));
    for (const r of adaptadas) esperarOk(r);
    const ok = adaptadas as TarifaUnidadAdaptada[];

    assert.deepEqual(
      ok.map((r) => [r.hotelId, r.tarifa.id, r.tarifa.unidadCobro]),
      [
        [42, "t-modal-pareja", "pareja"],
        [42, "t-modal-hab", "habitacion"],
        [42, "t-modal-apto", "apartamento"],
      ]
    );
    // Ninguna fue descartada ni reordenada: el adaptador no selecciona.
    assert.equal(ok.length, filas.length);
  });

  test("dos VERSIONES de la misma tarifa conviven y adaptan las dos", () => {
    const v1 = fila("t-revisada", "v1", "pareja", { adulto: 500_000 }, { minPax: 2, maxPax: 2, paxIncluidos: 2 });
    const v2 = fila("t-revisada", "v2", "pareja", { adulto: 600_000 }, { minPax: 2, maxPax: 2, paxIncluidos: 2 });

    const a1 = adaptarTarifaAlojamientoPersistida(v1);
    const a2 = adaptarTarifaAlojamientoPersistida(v2);
    esperarOk(a1);
    esperarOk(a2);

    assert.equal(a1.tarifa.id, a2.tarifa.id);
    assert.equal(a1.tarifa.versionTarifario, "v1");
    assert.equal(a2.tarifa.versionTarifario, "v2");
    assert.equal(a1.tarifa.valores.adulto, 500_000);
    assert.equal(a2.tarifa.valores.adulto, 600_000);
  });

  test("la misma tarifa con OTRO id de hotel también adapta: el adaptador no decide pertenencia", () => {
    const otra = fila("t-modal-pareja", VERSION, "pareja", { adulto: 550_000 }, { minPax: 2, maxPax: 2, paxIncluidos: 2 });
    otra.hotel_id = 99;
    const r = adaptarTarifaAlojamientoPersistida(otra);
    esperarOk(r);
    assert.equal(r.hotelId, 99);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Guardia de cableado: esta fase NO integra nada con los flujos comerciales
// ni toca tablas existentes. Se verifica leyendo el CÓDIGO FUENTE, igual que
// `pruebas/documentosContrato.wiring.test.ts` — es la única forma de que un
// "no se integró nada" quede afirmado por una prueba y no por una promesa.
// ─────────────────────────────────────────────────────────────────────────
describe("cableado — sin integración con flujos comerciales", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

  // Los dos archivos EXPLICAN en su cabecera lo que *no* hacen ("no consulta
  // Supabase", "no crea SECURITY DEFINER"…). Buscar sobre el texto crudo daría
  // falsos positivos justo por eso: las guardias de abajo tienen que mirar el
  // CÓDIGO, no la prosa que lo documenta.
  //
  // El recorte de comentarios es conservador a propósito: solo se quitan los
  // bloques `/* … */` y las líneas que ARRANCAN con `//` o `--`. Un `//` a
  // mitad de línea no se toca (podría ser un `https://` dentro de un string),
  // y por eso las comprobaciones de una sola línea de acá abajo están escritas
  // como las encuentra el escáner.
  const sinComentarios = (fuente: string) =>
    fuente
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((linea) => !/^\s*(\/\/|--)/.test(linea))
      .join("\n");

  // En SQL hay una segunda forma de prosa: `comment on ... is '…';`. Es
  // documentación que se guarda en el catálogo, no código que se ejecute —
  // se recorta igual que un comentario. (El `comment on table` de la 173 dice
  // literalmente "sin RPC, sin SECURITY DEFINER…", que es justo la frase que
  // la guardia de abajo tiene que NO confundir con una definición real.)
  // El recorte va hasta el `';` de fin de línea: un `;` suelto dentro del
  // texto (hay uno: "... por hotel; no es la PK.") no cierra el statement.
  const sinProsaSql = (fuente: string) => sinComentarios(fuente).replace(/^\s*comment\s+on[\s\S]*?';\s*$/gim, "");

  const fuenteAdaptador = leer("lib/calc/tarifaAlojamientoPersistida.ts");
  const fuenteMotor = leer("lib/calc/unidadAlojamiento.ts");
  const fuenteMigracion = leer("supabase/migrations/20260601000173_tarifas_alojamiento_unidad.sql");

  const codigoAdaptador = sinComentarios(fuenteAdaptador);
  const codigoMigracion = sinProsaSql(fuenteMigracion);

  test("el adaptador importa ÚNICAMENTE del motor puro", () => {
    const especificadores = [...fuenteAdaptador.matchAll(/^import\s+\{[^}]*\}\s+from\s+"([^"]+)";/gm)].map((m) => m[1]);
    assert.ok(especificadores.length > 0, "no se encontró ningún import en el adaptador");
    for (const especificador of especificadores) {
      // Con extensión `.ts` explícita, igual que las pruebas: es la forma en
      // que el archivo lo resuelve tanto `node --test` (sin alias) como
      // Turbopack (`allowImportingTsExtensions`).
      assert.equal(especificador, "./unidadAlojamiento.ts");
    }
  });

  test("el adaptador no consulta Supabase ni hace I/O", () => {
    assert.doesNotMatch(codigoAdaptador, /supabase/i);
    assert.doesNotMatch(codigoAdaptador, /createClient|service_role/i);
    assert.doesNotMatch(codigoAdaptador, /\bfetch\s*\(/);
    assert.doesNotMatch(codigoAdaptador, /\bawait\b/);
    assert.doesNotMatch(codigoAdaptador, /from "@\//);
  });

  test("el adaptador no inventa conceptos comerciales", () => {
    for (const termino of [/\bmarkup\b/i, /\bcomisi[oó]n\b/i, /\bimpuesto\b/i, /\bmoneda\b/i, /\bIVA\b/, /\btrm\b/i]) {
      assert.doesNotMatch(codigoAdaptador, termino);
    }
  });

  test("el adaptador no importa reservar, computo, paquetes, cotizaciones ni contratos", () => {
    for (const modulo of ["reservar", "computo", "paquetes", "cotizacion", "contrato", "tarifa_hotel", "calculadoras"]) {
      assert.doesNotMatch(codigoAdaptador, new RegExp(`from "[^"]*${modulo}`, "i"));
    }
  });

  test("el motor exporta el validador aislado de tarifa que el adaptador usa", () => {
    assert.match(fuenteMotor, /export function validarTarifaAlojamiento\(/);
    assert.match(fuenteMotor, /export function validarFormaTarifa\(/);
    assert.match(fuenteMotor, /export function validarTarifaNumerica\(/);
    assert.match(fuenteAdaptador, /validarTarifaAlojamiento/);
  });

  test("la migración 173 solo crea la tabla nueva: ninguna tabla existente recibe DDL", () => {
    const objetivosDDL = [...codigoMigracion.matchAll(/^\s*(?:create table if not exists|alter table|drop table if exists|drop table)\s+(public\.[a-z_]+)/gim)].map(
      (m) => m[1]
    );
    assert.ok(objetivosDDL.length >= 2, "no se detectó el DDL esperado en la migración");
    for (const tabla of objetivosDDL) assert.equal(tabla, "public.hotel_tarifas_unidad");
  });

  test("la migración 173 no tiene DML: ni seed, ni backfill, ni update de nada", () => {
    assert.doesNotMatch(codigoMigracion, /^\s*insert\s+into/im);
    assert.doesNotMatch(codigoMigracion, /^\s*update\s+/im);
    assert.doesNotMatch(codigoMigracion, /^\s*delete\s+from/im);
  });

  test("la migración 173 no expone RPC, ni SECURITY DEFINER, ni acceso anónimo", () => {
    assert.doesNotMatch(codigoMigracion, /security\s+definer/i);
    assert.doesNotMatch(codigoMigracion, /create\s+(or\s+replace\s+)?function/i);
    assert.doesNotMatch(codigoMigracion, /\banon\b/);
  });

  test("la migración 173 activa RLS con los cuatro roles de producto y sin service-role", () => {
    assert.match(codigoMigracion, /alter table public\.hotel_tarifas_unidad enable row level security;/);
    for (const operacion of ["select", "insert", "update", "delete"]) {
      assert.match(
        codigoMigracion,
        new RegExp(`for ${operacion}\\b[\\s\\S]{0,200}?public\\.mi_rol\\(\\) in \\('superadmin', 'gerencia', 'administracion', 'operaciones'\\)`)
      );
    }
    // `venta` no administra tarifas; si aparece, es un error de copia.
    assert.doesNotMatch(codigoMigracion, /'venta'/);
  });

  test("la migración 173 conserva las restricciones pedidas (identidad global, estado, página y payload)", () => {
    assert.match(codigoMigracion, /unique \(tarifa_id, version_tarifario\)/);
    assert.doesNotMatch(codigoMigracion, /unique \(hotel_id, tarifa_id, version_tarifario\)/);
    assert.match(codigoMigracion, /check \(estado in \('borrador', 'publicada', 'inactiva'\)\)/);
    assert.match(codigoMigracion, /jsonb_typeof\(payload\) = 'object'/);
    assert.match(codigoMigracion, /payload \? 'id' and tarifa_id = payload ->> 'id'/);
    assert.match(codigoMigracion, /payload \? 'versionTarifario' and version_tarifario = payload ->> 'versionTarifario'/);
    assert.match(codigoMigracion, /fuente_pagina is null or fuente_pagina > 0/);
  });

  test("la migración 173 no duplica el calendario que ya administra hotel_temporadas", () => {
    assert.doesNotMatch(codigoMigracion, /\bfecha_desde\b|\bfecha_hasta\b/);
    assert.match(fuenteMigracion, /hotel_temporadas/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FRONTERA DE PRODUCTO (fase 1 Bernalo)
//
// Esta entrega cubre ÚNICAMENTE tarifas REGULARES de alojamiento por noche:
// las cuatro unidades de cobro que `TarifaAlojamiento` puede expresar
// (persona / pareja / habitación / apartamento). Día de sol, Navidad y Año
// Nuevo, la tarifa especial de una noche, los paquetes de 2 noches / 3 días,
// las reglas de comisión y las condiciones generales NO son un caso
// particular de la tarifa nocturna: la REEMPLAZAN, y necesitan un modelo
// posterior.
//
// Estas pruebas fijan esa frontera en las tres superficies donde alguien
// podría leer lo contrario: la MIGRACIÓN (lo que se corre), el `comment on
// table` (lo que ve quien mira la base) y el COMPORTAMIENTO del adaptador.
// Una frontera solo documentada se erosiona; una frontera con prueba, no.
// ─────────────────────────────────────────────────────────────────────────
describe("frontera de producto — solo tarifas regulares por noche", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
  const fuenteMigracion = leer("supabase/migrations/20260601000173_tarifas_alojamiento_unidad.sql");
  const fuenteAdaptador = leer("lib/calc/tarifaAlojamientoPersistida.ts");
  const fuenteMotor = leer("lib/calc/unidadAlojamiento.ts");

  // Une el archivo en un solo texto quitando los marcadores de comentario, para
  // poder buscar una frase que en el origen está partida en varias líneas.
  const aTextoPlano = (fuente: string) =>
    fuente
      .split("\n")
      .map((linea) => linea.replace(/^\s*(?:\/\/|--)\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");

  // Cada producto excluido tiene que estar NOMBRADO. No alcanza con "no cubre
  // todo lo demás": quien lea el archivo tiene que poder confirmar que su
  // producto está afuera sin deducirlo.
  const PRODUCTOS_EXCLUIDOS = [
    "día de sol",
    "Navidad",
    "Año Nuevo",
    "tarifa especial de una noche",
    "paquetes de 2 noches / 3 días",
    "reglas de comisión",
    "condiciones generales",
  ];

  test("la migración nombra producto por producto lo que NO cubre", () => {
    for (const producto of PRODUCTOS_EXCLUIDOS) {
      assert.ok(
        fuenteMigracion.includes(producto),
        `la migración 173 no nombra el producto excluido "${producto}": la frontera tiene que quedar escrita, no sobreentendida`
      );
    }
  });

  test("la migración dice explícitamente que NO es el tarifario Bernalo completo", () => {
    assert.match(aTextoPlano(fuenteMigracion), /NO es el tarifario Bernalo completo/);
  });

  test("el `comment on table` deja la frontera en el catálogo (lo que ve quien mira la base)", () => {
    // Es la superficie que se lee sin abrir el repositorio: si el comentario
    // solo hablara de lo que la tabla guarda, un DBA podría leerla como si
    // fuera todo el tarifario.
    const comentarioTabla = fuenteMigracion.match(/comment on table public\.hotel_tarifas_unidad is([\s\S]*?);\r?\n/);
    assert.ok(comentarioTabla, "no se encontró el comment on table de hotel_tarifas_unidad");
    assert.match(comentarioTabla[1], /ALCANCE:/);
    assert.match(comentarioTabla[1], /NO es el tarifario Bernalo completo/);
    assert.match(comentarioTabla[1], /día de sol/);
  });

  test("el `comment on column payload` exige las claves exactas del tipo del motor", () => {
    const comentarioPayload = fuenteMigracion.match(/comment on column public\.hotel_tarifas_unidad\.payload is([\s\S]*?);\r?\n/);
    assert.ok(comentarioPayload, "no se encontró el comment on column payload");
    assert.match(comentarioPayload[1], /EXACTAMENTE esas claves/);
    assert.match(comentarioPayload[1], /no se cuele/);
  });

  test("el adaptador nombra la misma frontera (no solo la migración)", () => {
    for (const producto of PRODUCTOS_EXCLUIDOS) {
      assert.ok(
        fuenteAdaptador.includes(producto),
        `el adaptador no nombra el producto excluido "${producto}": quien lo reutilice no vería la frontera`
      );
    }
    assert.match(aTextoPlano(fuenteAdaptador), /NO es cobertura completa del tarifario Bernalo/);
  });

  // ── La frontera en el COMPORTAMIENTO ───────────────────────────────────
  // El adaptador no puede adivinar que una tarifa nocturna "en realidad" era
  // otro producto: una tarifa de un día de sol disfrazada con un valor por
  // noche fabricado no es detectable acá (eso es responsabilidad de quien
  // carga los datos). Lo que SÍ hace es negarse a adaptar un payload que se
  // ANUNCIA como otro producto: cualquier clave de primer nivel fuera de
  // `TarifaAlojamiento` es un marcador de que la fila no es una tarifa
  // regular por noche, y se rechaza en vez de ignorarse.
  const MARCADORES_DE_OTRO_PRODUCTO: Record<string, unknown>[] = [
    { tipoProducto: "dia_de_sol" },
    { diaDeSol: { incluyeAlmuerzo: true } },
    { paquete2Noches: { noches: 2, dias: 3 } },
    { temporadaNavidad: "2026-12-24" },
    { tarifaUnaNoche: 900_000 },
    { reglaComision: { pct: 0.1 } },
    { condicionesGenerales: ["no reembolsable"] },
  ];

  for (const marcador of MARCADORES_DE_OTRO_PRODUCTO) {
    const etiqueta = Object.keys(marcador)[0];
    test(`un payload con \`${etiqueta}\` se rechaza: no es una tarifa nocturna regular`, () => {
      const fila = filaPareja();
      Object.assign(fila.payload, marcador);

      const r = adaptarTarifaAlojamientoPersistida(fila);
      esperarRechazo(r, "payload_con_campos_desconocidos");
      // El contexto nombra EXACTAMENTE la clave ofensora: sin eso, quien lee
      // el rechazo no sabe qué sacar del payload.
      assert.deepEqual(r.contexto.camposDesconocidos, [etiqueta]);
    });
  }

  test("control positivo: la MISMA fila, sin ningún marcador, adapta", () => {
    // Prueba de que los rechazos de arriba los produce el marcador y no el
    // fixture: la frontera no endurece el caso regular.
    const r = adaptarTarifaAlojamientoPersistida(filaPareja());
    esperarOk(r);
    assert.equal(r.tarifa.unidadCobro, "pareja");
  });

  test("la lista de campos aceptados es EXACTAMENTE la de `TarifaAlojamiento` del motor", () => {
    // Si el motor agrega un campo, esta prueba falla y obliga a decidir si el
    // campo nuevo sigue siendo una tarifa nocturna regular o ya es otro
    // producto. Sin esto, la lista literal del adaptador envejecería en
    // silencio y empezaría a rechazar tarifas legítimas.
    const cuerpoTipo = fuenteMotor.match(/export type TarifaAlojamiento = \{([\s\S]*?)\n\};/);
    assert.ok(cuerpoTipo, "no se pudo leer el tipo TarifaAlojamiento del motor");
    const camposMotor = [...cuerpoTipo[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]).sort();

    const bloqueAdaptador = fuenteAdaptador.match(
      /const CAMPOS_TARIFA_ALOJAMIENTO: readonly string\[\] = \[([\s\S]*?)\];/
    );
    assert.ok(bloqueAdaptador, "no se pudo leer CAMPOS_TARIFA_ALOJAMIENTO del adaptador");
    const camposAdaptador = [...bloqueAdaptador[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]).sort();

    assert.equal(camposMotor.length, 11, "el tipo del motor cambió de tamaño: revisar la frontera de producto");
    assert.deepEqual(camposAdaptador, camposMotor);
  });
});
