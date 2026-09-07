// Presentación de infantes en los manifiestos de vuelo: cada infante debe
// aparecer como renglón subordinado inmediatamente debajo de su adulto
// responsable — agrupado EXCLUSIVAMENTE por `responsable_id` (migración 167),
// nunca por nombre ni por coincidencia parcial. El emparejamiento real usa el
// documento (tipo + número) del responsable contra el documento+contrato
// EFECTIVO de las sillas del manifiesto — el único par de identificadores
// durables que ambas tablas comparten (no hay FK directa entre `sillas` y
// `contrato_pasajeros`).
//
// Este archivo prueba el módulo puro (lib/vuelos/manifiestoInfantes.ts) con
// ejecución real de las funciones exportadas.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  emparejarInfantesConSilla,
  descripcionEdadInfante,
  type SillaDocumento,
  type InfanteConResponsable,
} from "../lib/vuelos/manifiestoInfantes.ts";

function silla(over: Partial<SillaDocumento> & { id: number }): SillaDocumento {
  return { tipoDoc: "CC", numeroDoc: "1000", contratoEfectivo: "00-0001", ...over };
}

function infante(over: Partial<InfanteConResponsable> & { id: number }): InfanteConResponsable {
  return {
    nombre: "BEBE PEREZ",
    tipoId: "RC",
    identificacion: "999",
    numeroContrato: "00-0001",
    fechaNacimiento: "2024-01-01",
    responsable: null,
    ...over,
  };
}

describe("emparejarInfantesConSilla — REQUERIDO: agrupación exclusiva por responsable_id (documento durable, nunca nombre)", () => {
  test("1) REQUERIDO: un infante con responsable resuelto queda emparejado con la silla exacta de ese responsable", () => {
    const sillas = [silla({ id: 10, tipoDoc: "CC", numeroDoc: "1000", contratoEfectivo: "00-0001" })];
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.deepEqual(infantesPorSillaId.get(10), [infantes[0]]);
    assert.equal(sinResponsable.length, 0);
  });

  test("2) REQUERIDO: varios infantes del MISMO responsable quedan agrupados consecutivamente bajo la misma silla", () => {
    const sillas = [silla({ id: 10, tipoDoc: "CC", numeroDoc: "1000" })];
    const responsable = { id: 500, tipoId: "CC", identificacion: "1000" };
    const infantes = [
      infante({ id: 1, nombre: "GEMELO A", responsable }),
      infante({ id: 2, nombre: "GEMELO B", responsable }),
    ];
    const { infantesPorSillaId } = emparejarInfantesConSilla(sillas, infantes);
    assert.deepEqual(infantesPorSillaId.get(10)?.map((i) => i.nombre), ["GEMELO A", "GEMELO B"]);
  });

  test("3) REQUERIDO: responsable_id es la fuente de verdad — un nombre de responsable coincidente NUNCA sustituye al documento", () => {
    // La silla 10 tiene el nombre correcto pero OTRO documento (otro
    // pasajero real que se llama igual) — no debe emparejarse por nombre.
    const sillas = [
      silla({ id: 10, tipoDoc: "CC", numeroDoc: "2222" }), // mismo nombre, documento distinto
      silla({ id: 11, tipoDoc: "CC", numeroDoc: "1000" }), // documento correcto del responsable
    ];
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId } = emparejarInfantesConSilla(sillas, infantes);
    assert.equal(infantesPorSillaId.has(10), false, "no debe emparejar por nombre — la silla 10 no es el documento del responsable");
    assert.deepEqual(infantesPorSillaId.get(11), [infantes[0]]);
  });

  test("4) REQUERIDO: el infante no altera capacidad/numeración de sillas — nunca se le asigna una silla propia, solo se agrupa bajo la del responsable", () => {
    const sillas = [silla({ id: 10 })];
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId } = emparejarInfantesConSilla(sillas, infantes);
    // El único artefacto que produce esta función es el Map id-de-silla →
    // infantes; nunca crea, modifica ni cuenta una silla nueva.
    assert.equal(sillas.length, 1, "la lista de sillas de entrada no se muta");
    assert.equal(infantesPorSillaId.size, 1);
  });

  test("5) REQUERIDO: responsable ausente en este manifiesto (ninguna silla con su documento) → advertencia, no asociación falsa", () => {
    const sillas = [silla({ id: 10, tipoDoc: "CC", numeroDoc: "9999" })]; // otro documento, no el del responsable
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.equal(infantesPorSillaId.size, 0);
    assert.deepEqual(sinResponsable, [infantes[0]]);
  });

  test("infante sin responsable_id resuelto (responsable: null) va a sinResponsable, nunca se asocia arbitrariamente", () => {
    const sillas = [silla({ id: 10 })];
    const infantes = [infante({ id: 1, responsable: null })];
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.equal(infantesPorSillaId.size, 0);
    assert.deepEqual(sinResponsable, [infantes[0]]);
  });

  test("documento del responsable en blanco (tipoId o identificacion vacíos) nunca hace match — fail-closed, no coincide con una silla también en blanco", () => {
    const sillas = [silla({ id: 10, tipoDoc: "", numeroDoc: "" })];
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "", identificacion: "" } })];
    const { sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.deepEqual(sinResponsable, [infantes[0]]);
  });

  test("ambigüedad (documento duplicado en dos sillas del mismo contrato) no adivina — fail-closed a sinResponsable", () => {
    const sillas = [
      silla({ id: 10, tipoDoc: "CC", numeroDoc: "1000", contratoEfectivo: "00-0001" }),
      silla({ id: 11, tipoDoc: "CC", numeroDoc: "1000", contratoEfectivo: "00-0001" }),
    ];
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.equal(infantesPorSillaId.size, 0);
    assert.deepEqual(sinResponsable, [infantes[0]]);
  });

  test("el mismo documento en OTRO contrato no cuenta como match — el contrato EFECTIVO de la silla también debe coincidir", () => {
    const sillas = [silla({ id: 10, tipoDoc: "CC", numeroDoc: "1000", contratoEfectivo: "MIN-00-0541" })];
    const infantes = [infante({ id: 1, numeroContrato: "00-0001", responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.equal(infantesPorSillaId.size, 0);
    assert.deepEqual(sinResponsable, [infantes[0]]);
  });

  test("normaliza mayúsculas/espacios del documento (no es una coincidencia parcial: sigue exigiendo el string completo)", () => {
    const sillas = [silla({ id: 10, tipoDoc: " cc ", numeroDoc: " 1000 " })];
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId } = emparejarInfantesConSilla(sillas, infantes);
    assert.deepEqual(infantesPorSillaId.get(10), [infantes[0]]);
  });

  test("un documento que es SUBCADENA del otro (ej. '100' vs '1000') NUNCA hace match — no hay coincidencia parcial", () => {
    const sillas = [silla({ id: 10, tipoDoc: "CC", numeroDoc: "100" })];
    const infantes = [infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } })];
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.equal(infantesPorSillaId.size, 0);
    assert.deepEqual(sinResponsable, [infantes[0]]);
  });

  test("varios infantes independientes: uno resuelve, otro queda sin responsable — uno no bloquea al otro", () => {
    const sillas = [silla({ id: 10, tipoDoc: "CC", numeroDoc: "1000" })];
    const infantes = [
      infante({ id: 1, responsable: { id: 500, tipoId: "CC", identificacion: "1000" } }),
      infante({ id: 2, responsable: { id: 501, tipoId: "CC", identificacion: "2000" } }),
    ];
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla(sillas, infantes);
    assert.deepEqual(infantesPorSillaId.get(10), [infantes[0]]);
    assert.deepEqual(sinResponsable, [infantes[1]]);
  });

  test("sin sillas ni infantes: no revienta, devuelve estructuras vacías", () => {
    const { infantesPorSillaId, sinResponsable } = emparejarInfantesConSilla([], []);
    assert.equal(infantesPorSillaId.size, 0);
    assert.deepEqual(sinResponsable, []);
  });
});

describe("descripcionEdadInfante", () => {
  test("con fecha de referencia calcula la edad y muestra también la fecha de nacimiento", () => {
    assert.equal(descripcionEdadInfante("2024-01-15", "2026-02-01"), "2 años (nac. 15 de enero de 2024)");
  });

  test("un año exacto usa singular ('1 año', no '1 años')", () => {
    assert.equal(descripcionEdadInfante("2025-01-01", "2026-01-15"), "1 año (nac. 1 de enero de 2025)");
  });

  test("recién nacido (0 años) sigue mostrando la edad en años, no solo la fecha", () => {
    assert.equal(descripcionEdadInfante("2026-01-01", "2026-02-01"), "0 años (nac. 1 de enero de 2026)");
  });

  test("sin fecha de referencia disponible: usa 'hoy' (vía calcularEdad) — no revienta", () => {
    const resultado = descripcionEdadInfante("2024-01-01", null);
    assert.match(resultado, /años? \(nac\. 1 de enero de 2024\)/);
  });

  test("sin fecha de nacimiento: mensaje explícito, no revienta ni inventa una fecha", () => {
    assert.equal(descripcionEdadInfante(null, "2026-01-01"), "sin fecha de nacimiento");
  });
});
