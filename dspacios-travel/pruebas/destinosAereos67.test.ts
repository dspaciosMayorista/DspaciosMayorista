import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarPais, calcularDestinosEfectivos, validarConfigDestinosAereos, motivoRechazoFuente, filtrarCandidatos,
  mensajeErrorBase, etiquetaDestino, mensajeVinculos, MENSAJES, type DestinoCatalogo, type InfoFuente,
} from "../lib/paquetes/destinosAereos67.ts";
import { D, destinosFixture, VECTORES_PAIS } from "./destinosAereos67Soporte.ts";

// #67 — reglas PURAS de destinos aéreos alternativos (lib/paquetes/destinosAereos67.ts).
// Las mismas entradas se contrastan contra la función SQL pais_comparable_67
// en supabase/scripts/test_220_destinos_aereos.sql (paridad TS ↔ base).



describe("normalizarPais() — país comparable: sin espacios de más, mayúsculas ni tildes; sin alias", () => {
  for (const [entrada, esperado] of VECTORES_PAIS) {
    test(`${JSON.stringify(entrada)} → ${JSON.stringify(esperado)}`, () => {
      assert.equal(normalizarPais(entrada), esperado);
    });
  }
  test("'RD' y 'República Dominicana' NO se equiparan (sin heurística de alias)", () => {
    assert.notEqual(normalizarPais("RD"), normalizarPais("República Dominicana"));
  });
});

const cat = (): DestinoCatalogo[] => destinosFixture() as unknown as DestinoCatalogo[];

describe("calcularDestinosEfectivos() — modo de ejecución", () => {
  test("OFF: exactamente el destino comercial, aunque no tenga país", () => {
    const r = calcularDestinosEfectivos({ destinoComercialId: D.SIN_PAIS, alternativos: false, alternativaIds: [D.SANTO_DOMINGO] }, cat());
    assert.ok(r.ok && r.ids.length === 1 && r.ids[0] === D.SIN_PAIS);
  });
  test("ON: comercial + alternativas válidas del mismo país (SDQ y PUJ), comercial primero", () => {
    const r = calcularDestinosEfectivos({ destinoComercialId: D.JUAN_DOLIO, alternativos: true, alternativaIds: [D.PUNTA_CANA, D.SANTO_DOMINGO] }, cat());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.ids, [D.JUAN_DOLIO, D.PUNTA_CANA, D.SANTO_DOMINGO]);
  });
  test("ON: otro país, sin país, inactivo, alias RD, inexistente y el propio comercial se excluyen, con su motivo", () => {
    const r = calcularDestinosEfectivos(
      { destinoComercialId: D.JUAN_DOLIO, alternativos: true, alternativaIds: [D.CARTAGENA, D.SIN_PAIS, D.INACTIVO, D.ALIAS_RD, 999, D.JUAN_DOLIO, D.SANTO_DOMINGO] },
      cat()
    );
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.ids, [D.JUAN_DOLIO, D.SANTO_DOMINGO]);
      const motivos = Object.fromEntries(r.alternativasExcluidas.map((x) => [x.id, x.motivo]));
      assert.deepEqual(motivos, {
        [D.CARTAGENA]: "otro_pais", [D.SIN_PAIS]: "sin_pais", [D.INACTIVO]: "inactivo", [D.ALIAS_RD]: "otro_pais", 999: "no_existe", [D.JUAN_DOLIO]: "es_comercial",
      });
    }
  });
  test("ON con el comercial sin país: ninguna alternativa se autoriza", () => {
    const r = calcularDestinosEfectivos({ destinoComercialId: D.SIN_PAIS, alternativos: true, alternativaIds: [D.SANTO_DOMINGO] }, cat());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.ids, [D.SIN_PAIS]);
  });
  test("sin destino comercial: no hay destinos efectivos (nunca 'todos')", () => {
    const r = calcularDestinosEfectivos({ destinoComercialId: null, alternativos: true, alternativaIds: [D.SANTO_DOMINGO] }, cat());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "sin_destino_comercial");
  });
  test("deduplica las alternativas repetidas", () => {
    const r = calcularDestinosEfectivos({ destinoComercialId: D.JUAN_DOLIO, alternativos: true, alternativaIds: [D.SANTO_DOMINGO, D.SANTO_DOMINGO] }, cat());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.alternativasValidas, [D.SANTO_DOMINGO]);
  });
});

describe("validarConfigDestinosAereos() — validación estricta al guardar", () => {
  const base = { destinoComercialId: D.JUAN_DOLIO, alternativos: true };
  test("acepta SDQ y PUJ; ordena y deduplica; quita el comercial de la lista", () => {
    const r = validarConfigDestinosAereos({ ...base, alternativaIds: [D.PUNTA_CANA, D.SANTO_DOMINGO, D.SANTO_DOMINGO, D.JUAN_DOLIO] }, cat());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.alternativaIds, [D.SANTO_DOMINGO, D.PUNTA_CANA]);
  });
  test("encendido exige al menos una alternativa distinta del comercial", () => {
    for (const ids of [[], [D.JUAN_DOLIO]]) {
      const r = validarConfigDestinosAereos({ ...base, alternativaIds: ids }, cat());
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.codigo, "sin_alternativas");
    }
  });
  test("rechaza (y nombra) otro país, sin país, inactivo, alias RD e inexistente — todo el guardado, no solo ese ID", () => {
    for (const id of [D.CARTAGENA, D.SIN_PAIS, D.INACTIVO, D.ALIAS_RD, 999]) {
      const r = validarConfigDestinosAereos({ ...base, alternativaIds: [D.SANTO_DOMINGO, id] }, cat());
      assert.equal(r.ok, false, `id ${id}`);
      if (!r.ok) assert.equal(r.codigo, "alternativas_invalidas");
    }
  });
  test("el destino comercial sin país no permite habilitar alternativas", () => {
    const r = validarConfigDestinosAereos({ destinoComercialId: D.SIN_PAIS, alternativos: true, alternativaIds: [D.SANTO_DOMINGO] }, cat());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "comercial_sin_pais");
  });
  test("apagado sin alternativas se acepta aunque el comercial no tenga país (filtro exacto de siempre)", () => {
    const r = validarConfigDestinosAereos({ destinoComercialId: D.SIN_PAIS, alternativos: false, alternativaIds: [] }, cat());
    assert.ok(r.ok);
  });
  test("sin destino comercial no se puede elegir alternativas, pero guardar vacío es válido", () => {
    assert.equal(validarConfigDestinosAereos({ destinoComercialId: null, alternativos: true, alternativaIds: [D.SANTO_DOMINGO] }, cat()).ok, false);
    assert.equal(validarConfigDestinosAereos({ destinoComercialId: null, alternativos: false, alternativaIds: [] }, cat()).ok, true);
  });
  test("la selección se puede conservar con el check apagado, pero debe ser válida", () => {
    assert.equal(validarConfigDestinosAereos({ ...base, alternativos: false, alternativaIds: [D.SANTO_DOMINGO] }, cat()).ok, true);
    assert.equal(validarConfigDestinosAereos({ ...base, alternativos: false, alternativaIds: [D.CARTAGENA] }, cat()).ok, false);
  });
});

describe("motivoRechazoFuente() — decisión pura sobre una fuente aérea", () => {
  const info = (destino_id: number | null): InfoFuente => ({ id: 1, destino_id, ruta: "BOG-SDQ", record: "R1" });
  test("permitida, no permitida, sin destino e inexistente", () => {
    assert.equal(motivoRechazoFuente([10, 20], info(20)), null);
    assert.equal(motivoRechazoFuente([10, 20], info(40)), "destino_no_permitido");
    assert.equal(motivoRechazoFuente([10, 20], info(null)), "fuente_sin_destino");
    assert.equal(motivoRechazoFuente([10, 20], null), "fuente_inexistente");
    assert.equal(motivoRechazoFuente([], info(10)), "destino_no_permitido");
  });
});

describe("filtrarCandidatos() — selector del editor", () => {
  test("lista solo destinos ACTIVOS del MISMO país, sin el comercial, ordenados por nombre", () => {
    const r = filtrarCandidatos(D.JUAN_DOLIO, cat());
    assert.deepEqual(r.candidatos.map((d) => d.id), [D.PUNTA_CANA, D.SAMANA, D.SANTO_DOMINGO]);
    assert.equal(r.motivo, null);
  });
  test("comercial sin país: ninguno, con motivo", () => {
    const r = filtrarCandidatos(D.SIN_PAIS, cat());
    assert.equal(r.candidatos.length, 0);
    assert.match(r.motivo ?? "", /no tiene país/i);
  });
  test("único destino de su país: ninguno, con motivo", () => {
    const r = filtrarCandidatos(D.CARTAGENA, cat());
    assert.equal(r.candidatos.length, 0);
    assert.match(r.motivo ?? "", /no hay otros destinos/i);
  });
});

describe("mensajes", () => {
  test("etiquetaDestino: nombre + IATA, o solo el nombre — nunca inventa un aeropuerto", () => {
    assert.equal(etiquetaDestino({ nombre: "PUNTA CANA", codigo_iata: "PUJ" }), "PUNTA CANA (PUJ)");
    assert.equal(etiquetaDestino({ nombre: "JUAN DOLIO", codigo_iata: null }), "JUAN DOLIO");
    assert.equal(etiquetaDestino({ nombre: "X", codigo_iata: "  " }), "X");
  });
  test("mensajeErrorBase traduce los códigos de la base y nunca devuelve texto crudo desconocido", () => {
    assert.match(mensajeErrorBase("destino_aereo_vinculos: vuelo R1"), /Desvinc[uú]lalos expl[ií]citamente/i);
    assert.equal(mensajeErrorBase("destino_aereo_no_permitido: x"), MENSAJES.noPermitido);
    assert.match(mensajeErrorBase("destino_aereo_config: sin país"), /configuraci[oó]n de destinos a[eé]reos/i);
    assert.equal(mensajeErrorBase('permission denied for table "armado_vuelos"'), MENSAJES.tecnico);
    assert.equal(mensajeErrorBase(null), MENSAJES.tecnico);
  });
  test("mensajeVinculos lista hasta 8 y avisa que no se borra nada", () => {
    const afectados = Array.from({ length: 10 }, (_, i) => ({ fuente: { tipo: "bloqueo" as const, id: i + 1 }, ruta: "BOG-SDQ", record: `R${i + 1}`, destino_id: 20 }));
    const m = mensajeVinculos(afectados);
    assert.match(m, /10 vuelo\(s\)/);
    assert.match(m, /R8/);
    assert.doesNotMatch(m, /R9/);
    assert.match(m, /no se borra ning[uú]n vuelo/i);
  });
});
