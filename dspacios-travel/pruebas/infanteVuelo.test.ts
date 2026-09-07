// lib/vuelos/infanteVuelo.ts — validación PURA del formulario de alta/edición
// de UN infante directamente desde el detalle de un vuelo (migración 168).
// No decide negocio (responsable/contrato/autorización): eso vive
// exclusivamente en el RPC `guardar_infante_vuelo`, único con la autoridad
// real. Aquí solo se prueba que el adelanto de mensajes en cliente/Server
// Action coincide con los límites que el RPC también aplica.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validarInfanteVueloInput, esInfantePorEdad, EDAD_INFANTE_MAX_VUELO } from "../lib/vuelos/infanteVuelo.ts";

function input(over: Partial<Parameters<typeof validarInfanteVueloInput>[0]> = {}) {
  return {
    nombreCompleto: "Bebe Perez",
    tipoDoc: "RC",
    numeroDoc: "1000000001",
    fechaNacimiento: "2025-01-01",
    ...over,
  };
}

describe("validarInfanteVueloInput", () => {
  test("datos completos y válidos: ok", () => {
    assert.deepEqual(validarInfanteVueloInput(input()), { ok: true });
  });

  test("nombre vacío (solo espacios): rechazado", () => {
    const r = validarInfanteVueloInput(input({ nombreCompleto: "   " }));
    assert.equal(r.ok, false);
  });

  test("nombre de más de 200 caracteres: rechazado", () => {
    const r = validarInfanteVueloInput(input({ nombreCompleto: "A".repeat(201) }));
    assert.equal(r.ok, false);
  });

  test("tipo de documento vacío: rechazado", () => {
    const r = validarInfanteVueloInput(input({ tipoDoc: "  " }));
    assert.equal(r.ok, false);
  });

  test("tipo de documento de más de 10 caracteres: rechazado", () => {
    const r = validarInfanteVueloInput(input({ tipoDoc: "X".repeat(11) }));
    assert.equal(r.ok, false);
  });

  test("número de documento vacío: rechazado", () => {
    const r = validarInfanteVueloInput(input({ numeroDoc: "" }));
    assert.equal(r.ok, false);
  });

  test("número de documento de más de 30 caracteres: rechazado", () => {
    const r = validarInfanteVueloInput(input({ numeroDoc: "1".repeat(31) }));
    assert.equal(r.ok, false);
  });

  test("número de documento con letras y tipo distinto de PAS: rechazado (debe ser solo números)", () => {
    const r = validarInfanteVueloInput(input({ tipoDoc: "RC", numeroDoc: "ABC123" }));
    assert.equal(r.ok, false);
  });

  test("número de documento con letras pero tipo PAS: aceptado (pasaporte puede tener letras)", () => {
    const r = validarInfanteVueloInput(input({ tipoDoc: "PAS", numeroDoc: "AB1234567" }));
    assert.equal(r.ok, true);
  });

  test("fecha de nacimiento ausente: rechazada", () => {
    const r = validarInfanteVueloInput(input({ fechaNacimiento: "" }));
    assert.equal(r.ok, false);
  });

  test("fecha de nacimiento con formato inválido (no ISO): rechazada", () => {
    const r = validarInfanteVueloInput(input({ fechaNacimiento: "01/01/2025" }));
    assert.equal(r.ok, false);
  });

  test("fecha de nacimiento futura: rechazada", () => {
    const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = validarInfanteVueloInput(input({ fechaNacimiento: manana }));
    assert.equal(r.ok, false);
  });

  test("fecha de nacimiento de hoy: aceptada (un recién nacido puede registrarse el mismo día)", () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = validarInfanteVueloInput(input({ fechaNacimiento: hoy }));
    assert.equal(r.ok, true);
  });
});

describe("re-exporta la MISMA fuente de verdad de clasificación INF que el resto del sistema (lib/reservar/pasajeros.ts)", () => {
  test("EDAD_INFANTE_MAX_VUELO = 2 (umbral estrictamente < 2)", () => {
    assert.equal(EDAD_INFANTE_MAX_VUELO, 2);
  });

  test("1 año a la fecha_ida del bloqueo: es infante", () => {
    assert.equal(esInfantePorEdad("2025-01-01", "2026-06-15"), true);
  });

  test("2 años exactos a la fecha_ida del bloqueo: YA NO es infante (umbral estricto)", () => {
    assert.equal(esInfantePorEdad("2024-06-15", "2026-06-15"), false);
  });

  test("un día antes de cumplir 2 años: todavía es infante", () => {
    assert.equal(esInfantePorEdad("2024-06-16", "2026-06-15"), true);
  });
});
