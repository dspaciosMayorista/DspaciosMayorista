// ─────────────────────────────────────────────────────────────────────────
// lib/reservar/pasajerosEdicion.ts — puente puro entre `contrato_pasajeros`
// persistido (responsable_id = id real de otra fila) y el estado editable
// del formulario (responsableIndex = posición dentro del arreglo visible).
//
// Corrige el bug de hidratación (B2, revisión de alto riesgo): el estado
// inicial del formulario nunca leía `responsable_id`, así que CUALQUIER
// guardado — incluso uno que no tocara pasajeros — borraba en silencio el
// vínculo ya persistido. Estas pruebas demuestran, con datos reales (no
// mocks), que guardar → "recargar" (releer lo persistido) → volver a
// guardar conserva EXACTAMENTE el vínculo.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { filasIniciales, payloadGuardarPasajeros, type PasajeroRowConResponsable } from "../lib/reservar/pasajerosEdicion.ts";

describe("filasIniciales — responsable_id (id real) -> responsableIndex (posición visible)", () => {
  test("infante vinculado a un adulto en otra posición: responsableIndex apunta a la posición correcta", () => {
    const filas: PasajeroRowConResponsable[] = [
      { id: 10, nombre: "Adulto Uno", tipo_id: "CC", identificacion: "1", fecha_nacimiento: "1990-01-01", es_infante: false },
      { id: 11, nombre: "Infante Uno", tipo_id: "RC", identificacion: "2", fecha_nacimiento: "2026-01-01", es_infante: true, responsable_id: 10 },
    ];
    const editables = filasIniciales(filas);
    assert.equal(editables[1].responsableIndex, 0);
    assert.equal(editables[0].responsableIndex, null);
  });

  test("infante sin vincular (responsable_id null) -> responsableIndex null, nunca inventado", () => {
    const filas: PasajeroRowConResponsable[] = [
      { id: 20, nombre: "Adulto", tipo_id: "CC", identificacion: "1", fecha_nacimiento: "1990-01-01", es_infante: false },
      { id: 21, nombre: "Infante", tipo_id: "RC", identificacion: "2", fecha_nacimiento: "2026-01-01", es_infante: true, responsable_id: null },
    ];
    const editables = filasIniciales(filas);
    assert.equal(editables[1].responsableIndex, null);
  });

  test("responsable_id apuntando a un id que no está en la lista (dato corrupto/ajeno) -> null, nunca lanza", () => {
    const filas: PasajeroRowConResponsable[] = [
      { id: 30, nombre: "Infante", tipo_id: "RC", identificacion: "1", fecha_nacimiento: "2026-01-01", es_infante: true, responsable_id: 999 },
    ];
    const editables = filasIniciales(filas);
    assert.equal(editables[0].responsableIndex, null);
  });

  test("conserva id, nombre, tipoId, identificacion y fechaNacimiento tal cual", () => {
    const filas: PasajeroRowConResponsable[] = [
      { id: 40, nombre: "Juan Perez", tipo_id: "CC", identificacion: "123", fecha_nacimiento: "1980-05-05", es_infante: false },
    ];
    const [e] = filasIniciales(filas);
    assert.equal(e.id, 40);
    assert.equal(e.nombre, "Juan Perez");
    assert.equal(e.tipoId, "CC");
    assert.equal(e.identificacion, "123");
    assert.equal(e.fechaNacimiento, "1980-05-05");
  });

  test("tipo_id/identificacion/fecha_nacimiento null -> valores por defecto seguros para inputs controlados", () => {
    const filas: PasajeroRowConResponsable[] = [
      { id: 50, nombre: "Sin datos", tipo_id: null, identificacion: null, fecha_nacimiento: null, es_infante: false },
    ];
    const [e] = filasIniciales(filas);
    assert.equal(e.tipoId, "CC");
    assert.equal(e.identificacion, "");
    assert.equal(e.fechaNacimiento, "");
  });
});

describe("payloadGuardarPasajeros — responsableIndex (0-based) -> responsableOrden (1-based)", () => {
  test("fila con id existente y responsableIndex -> incluye id y responsableOrden = index+1", () => {
    const payload = payloadGuardarPasajeros([
      { id: 10, nombre: "Adulto", tipoId: "CC", identificacion: "1", fechaNacimiento: "1990-01-01", esInfante: false },
      { id: 11, nombre: "Infante", tipoId: "RC", identificacion: "2", fechaNacimiento: "2026-01-01", esInfante: true, responsableIndex: 0 },
    ]);
    assert.deepEqual(payload[1], { id: 11, nombre: "Infante", tipoId: "RC", identificacion: "2", fechaNacimiento: "2026-01-01", responsableOrden: 1 });
  });

  test("fila NUEVA (sin id) -> el payload no incluye la clave id en absoluto", () => {
    const payload = payloadGuardarPasajeros([
      { nombre: "Nuevo", tipoId: "CC", identificacion: "9", fechaNacimiento: "1990-01-01", esInfante: false },
    ]);
    assert.equal("id" in payload[0], false);
  });

  test("responsableIndex ausente/null -> el payload no incluye responsableOrden (nunca se inventa un 0)", () => {
    const payload = payloadGuardarPasajeros([
      { nombre: "Adulto", tipoId: "CC", identificacion: "1", fechaNacimiento: "1990-01-01", esInfante: false, responsableIndex: null },
    ]);
    assert.equal("responsableOrden" in payload[0], false);
  });

  test("recorta espacios en nombre/identificación", () => {
    const payload = payloadGuardarPasajeros([
      { nombre: "  Juan Perez  ", tipoId: "CC", identificacion: " 123 ", fechaNacimiento: "1990-01-01", esInfante: false },
    ]);
    assert.equal(payload[0].nombre, "Juan Perez");
    assert.equal(payload[0].identificacion, "123");
  });
});

describe("Round-trip completo — guardar, releer (filasIniciales), volver a construir el payload conserva el vínculo", () => {
  test("infante vinculado sobrevive un ciclo completo de recarga", () => {
    // 1) Estado "ya persistido" en la base (como llegaría de contrato_pasajeros).
    const persistido: PasajeroRowConResponsable[] = [
      { id: 100, nombre: "Adulto Responsable", tipo_id: "CC", identificacion: "1001", fecha_nacimiento: "1985-03-10", es_infante: false },
      { id: 101, nombre: "Infante Vinculado", tipo_id: "RC", identificacion: "1002", fecha_nacimiento: "2025-08-01", es_infante: true, responsable_id: 100 },
    ];
    // 2) "Recarga" de la página: el formulario hidrata su estado inicial.
    const editable = filasIniciales(persistido);
    assert.equal(editable[1].responsableIndex, 0, "la recarga debe reconstruir el vínculo, no perderlo");
    // 3) El usuario guarda SIN tocar nada — el payload debe seguir apuntando al mismo adulto.
    const payload = payloadGuardarPasajeros(editable);
    assert.equal(payload[1].id, 101);
    assert.equal(payload[1].responsableOrden, 1, "responsableOrden debe seguir apuntando a la posición 1 (el adulto)");
    assert.equal(payload[0].id, 100);
  });
});
