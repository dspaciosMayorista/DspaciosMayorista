// lib/vuelos/infanteVuelo.ts — validación PURA del formulario de alta/edición
// de UN infante directamente desde el detalle de un vuelo (migración 168).
// No decide negocio (responsable/contrato/autorización): eso vive
// exclusivamente en el RPC `guardar_infante_vuelo`, único con la autoridad
// real. Aquí solo se prueba que el adelanto de mensajes en cliente/Server
// Action coincide con los límites que el RPC también aplica.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validarInfanteVueloInput, esInfantePorEdad, EDAD_INFANTE_MAX_VUELO, sillaTieneDatosDePasajero, type DatosPasajeroSilla } from "../lib/vuelos/infanteVuelo.ts";

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

// PasajeroAcciones.tsx usa este predicado (sobre `inicial`, el estado
// ORIGINAL de la silla al abrir el modal) para decidir si el alta manual
// parte de una silla VACÍA (única situación donde la conversión automática
// a infante aplica) o si ya hay un pasajero registrado (edición, donde esa
// conversión queda bloqueada). Una fila puede llegar con datos PARCIALES —
// cualquiera de los 5 campos con valor cuenta como "ya tiene pasajero".
describe("sillaTieneDatosDePasajero", () => {
  const vacia: DatosPasajeroSilla = {
    pasajero_nombres: "",
    pasajero_apellidos: "",
    tipo_doc: "",
    numero_doc: "",
    nacimiento: "",
  };

  test("REQUERIDO 1: todos los campos vacíos (o solo espacios) → silla VACÍA (false)", () => {
    assert.equal(sillaTieneDatosDePasajero(vacia), false);
    assert.equal(sillaTieneDatosDePasajero({ ...vacia, pasajero_nombres: "   ", tipo_doc: "  " }), false);
  });

  test("REQUERIDO 2: solo documento (tipo_doc + numero_doc, sin nombre) → OCUPADA (true)", () => {
    assert.equal(sillaTieneDatosDePasajero({ ...vacia, tipo_doc: "CC", numero_doc: "123456" }), true);
  });

  test("REQUERIDO 2b: solo numero_doc (sin tipo_doc) también cuenta como OCUPADA", () => {
    assert.equal(sillaTieneDatosDePasajero({ ...vacia, numero_doc: "123456" }), true);
  });

  test("REQUERIDO 3: solo fecha de nacimiento (sin nombre ni documento) → OCUPADA (true)", () => {
    assert.equal(sillaTieneDatosDePasajero({ ...vacia, nacimiento: "2020-01-01" }), true);
  });

  test("REQUERIDO 4: solo nombre (sin apellido, documento ni nacimiento) → OCUPADA (true)", () => {
    assert.equal(sillaTieneDatosDePasajero({ ...vacia, pasajero_nombres: "Ana" }), true);
  });

  test("REQUERIDO 4b: solo apellido (sin nombre) → OCUPADA (true)", () => {
    assert.equal(sillaTieneDatosDePasajero({ ...vacia, pasajero_apellidos: "Perez" }), true);
  });

  test("todos los campos con datos: OCUPADA (true)", () => {
    assert.equal(
      sillaTieneDatosDePasajero({
        pasajero_nombres: "Ana",
        pasajero_apellidos: "Perez",
        tipo_doc: "CC",
        numero_doc: "123456",
        nacimiento: "2020-01-01",
      }),
      true
    );
  });
});
