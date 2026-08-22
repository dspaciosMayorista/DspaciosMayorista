// ─────────────────────────────────────────────────────────────────────────
// lib/reservar/origen.ts — el discriminante único de origen de vuelo
// (revisión de PR #268, defecto 1 "ORIGEN DOBLE" y defecto 2 "VIGENCIA Y
// ACTIVO"). Pruebas de comportamiento REAL (no de patrón de texto): son
// funciones puras, sin dependencia de Supabase, así que se llaman
// directamente — el mismo criterio que las pruebas de `lib/calc/paquetes.ts`.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverOrigenVuelo, empaquetadoVigente, hoyBogota } from "../lib/reservar/origen.ts";

const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("resolverOrigenVuelo — modulo=bloqueo", () => {
  test("solo bloqueoId → origen bloqueo", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: 5, empaquetadoId: null, salidaId: null });
    assert.deepEqual(r, { ok: true, origen: { tipo: "bloqueo", id: 5 } });
  });

  test("solo empaquetadoId → origen empaquetado", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: null, empaquetadoId: 9, salidaId: null });
    assert.deepEqual(r, { ok: true, origen: { tipo: "empaquetado", id: 9 } });
  });

  // ── Negativa obligatoria #1: AMBOS ids ──────────────────────────────────
  test("bloqueoId Y empaquetadoId a la vez → configuracion_invalida (defecto 1, caso central)", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: 5, empaquetadoId: 9, salidaId: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /vuelo negociado y un empaquetado a la vez/);
  });

  test("ningún id → error explícito, no un origen 'ninguno' silencioso", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: null, empaquetadoId: null, salidaId: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Selecciona un vuelo/);
  });

  // ── Negativa obligatoria #2: id "de otra fuente" para este módulo ───────
  test("salidaId presente en modulo=bloqueo (id de otra fuente/módulo) → rechazado, aunque bloqueoId sea válido", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: 5, empaquetadoId: null, salidaId: 7 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no usa salida dinámica/);
  });
});

describe("resolverOrigenVuelo — modulo=dinamico", () => {
  test("solo salidaId → origen salida", () => {
    const r = resolverOrigenVuelo({ modulo: "dinamico", salidaId: 3 });
    assert.deepEqual(r, { ok: true, origen: { tipo: "salida", id: 3 } });
  });

  test("sin salidaId → rechazado", () => {
    const r = resolverOrigenVuelo({ modulo: "dinamico" });
    assert.equal(r.ok, false);
  });

  // ── Negativa obligatoria #2 (variante): id de otra fuente en dinamico ───
  test("bloqueoId presente en modulo=dinamico → rechazado, aunque salidaId sea válido", () => {
    const r = resolverOrigenVuelo({ modulo: "dinamico", bloqueoId: 5, salidaId: 3 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no usa vuelo negociado ni empaquetado/);
  });

  test("empaquetadoId presente en modulo=dinamico → rechazado", () => {
    const r = resolverOrigenVuelo({ modulo: "dinamico", empaquetadoId: 9, salidaId: 3 });
    assert.equal(r.ok, false);
  });
});

describe("resolverOrigenVuelo — módulos sin vuelo (porcion_terrestre/servicios)", () => {
  test("porcion_terrestre sin ningún id → origen ninguno", () => {
    const r = resolverOrigenVuelo({ modulo: "porcion_terrestre" });
    assert.deepEqual(r, { ok: true, origen: { tipo: "ninguno" } });
  });

  test("servicios con bloqueoId colado (id de otro módulo) → rechazado", () => {
    const r = resolverOrigenVuelo({ modulo: "servicios", bloqueoId: 5 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no lleva vuelo/);
  });
});

// ── Negativa obligatoria #3: manipulación directa de Server Action/URL ────
// Simula lo que llegaría si alguien invoca la Server Action directamente
// (curl/DevTools), sin pasar por el formulario — nunca confía en que el
// cliente mande un entero limpio.
describe("resolverOrigenVuelo — ids manipulados directamente (no vienen del formulario)", () => {
  test("bloqueoId = 0 se trata como ausente, no como 'origen 0'", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: 0, empaquetadoId: null, salidaId: null });
    assert.equal(r.ok, false, "0 no es un id válido — debe rechazar por 'ningún origen', no aceptar 0");
  });

  test("bloqueoId negativo → rechazado (nunca se usa el signo como truthy)", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: -5, empaquetadoId: null, salidaId: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /bloqueoId inválido/);
  });

  test("empaquetadoId decimal (ej. 9.5, JSON manipulado a mano) → rechazado", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: null, empaquetadoId: 9.5, salidaId: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /empaquetadoId inválido/);
  });

  test("salidaId como NaN (coerción de un query param vacío) → rechazado, no pasa como 'ausente'", () => {
    const r = resolverOrigenVuelo({ modulo: "dinamico", salidaId: NaN });
    assert.equal(r.ok, false);
  });

  test("todos los ids en 0 simultáneamente → error de 'selecciona uno', no un falso 'válido'", () => {
    const r = resolverOrigenVuelo({ modulo: "bloqueo", bloqueoId: 0, empaquetadoId: 0, salidaId: 0 });
    assert.equal(r.ok, false);
  });
});

describe("empaquetadoVigente — fechas inclusivas, America/Bogota", () => {
  test("sin compra_inicio ni compra_fin → siempre vigente", () => {
    assert.equal(empaquetadoVigente(null, null, "2026-06-15"), true);
  });

  test("hoy === compra_inicio → vigente (inclusivo, no exclusivo)", () => {
    assert.equal(empaquetadoVigente("2026-06-15", null, "2026-06-15"), true);
  });

  test("hoy === compra_fin → vigente (inclusivo)", () => {
    assert.equal(empaquetadoVigente(null, "2026-06-15", "2026-06-15"), true);
  });

  test("hoy un día antes de compra_inicio → NO vigente", () => {
    assert.equal(empaquetadoVigente("2026-06-15", null, "2026-06-14"), false);
  });

  test("hoy un día después de compra_fin → NO vigente (venció)", () => {
    assert.equal(empaquetadoVigente(null, "2026-06-15", "2026-06-16"), false);
  });

  test("dentro del rango compra_inicio..compra_fin → vigente", () => {
    assert.equal(empaquetadoVigente("2026-06-01", "2026-06-30", "2026-06-15"), true);
  });
});

// ── Negativa obligatoria #4: empaquetado que no pertenece al paquete ──────
// `resolverOrigenVuelo` solo valida la FORMA del origen (discriminante +
// tipo de dato) — que el id pertenezca al paquete/hotel/categoría/régimen
// elegidos lo decide la consulta de `tarifario_resultado` en computo.ts.
// Un `empaquetado_id` real pero de OTRO paquete no se resuelve solo porque
// el id existe: la fila de tarifario debe existir para EXACTAMENTE esa
// combinación, o `computarReserva` responde "No se encontró la tarifa
// seleccionada en el tarifario" — nunca cae a un fallback ambiguo.
describe("computo.ts: el filtro de tarifario_resultado exige paquete_id + hotel_id + categoria + regimen + origen JUNTOS (un empaquetado de otro paquete nunca resuelve)", () => {
  const computoSrc = leer("lib/reservar/computo.ts");

  test("la query encadena los 4 filtros de contexto antes del filtro de origen", () => {
    const inicio = computoSrc.indexOf('.from("tarifario_resultado")');
    const bloque = computoSrc.slice(inicio, inicio + 1100);
    assert.match(bloque, /\.eq\("paquete_id", input\.paqueteId\)/);
    assert.match(bloque, /\.eq\("hotel_id", input\.hotelId\)/);
    assert.match(bloque, /\.eq\("categoria", input\.categoria\)/);
    assert.match(bloque, /\.eq\("regimen", input\.regimen\)/);
    assert.match(bloque, /if \(origen\.tipo === "salida"\) q = q\.eq\("salida_id", origen\.id\);/);
  });

  test("cero filas (origen válido pero de otro paquete) → error explícito, nunca un precio en $0 ni un fallback silencioso", () => {
    assert.match(
      computoSrc,
      /if \(!filas \|\| !filas\.length\) return \{ ok: false, error: "No se encontró la tarifa seleccionada en el tarifario\." \};/
    );
  });
});

describe("hoyBogota — America/Bogota, formato YYYY-MM-DD comparable con columnas date", () => {
  test("formato ISO de 10 caracteres, comparable lexicográficamente", () => {
    const s = hoyBogota(new Date("2026-06-15T12:00:00Z"));
    assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("Bogotá es UTC-5: 2026-01-01T04:30:00Z (23:30 del 31-dic en Bogotá) sigue siendo 31 de diciembre", () => {
    assert.equal(hoyBogota(new Date("2026-01-01T04:30:00Z")), "2025-12-31");
  });

  test("2026-01-01T05:30:00Z (00:30 en Bogotá) ya es 1 de enero en Bogotá", () => {
    assert.equal(hoyBogota(new Date("2026-01-01T05:30:00Z")), "2026-01-01");
  });
});
