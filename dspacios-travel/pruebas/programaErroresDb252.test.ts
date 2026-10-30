import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { mensajeErrorPrograma, MENSAJE_HOTEL_DUPLICADO } from "@/lib/programas/erroresDb";

const TECNICO = /violat|constraint|duplicate key|uq_|programa_hoteles|foreign key|SQLSTATE|PGRST|relation |column |public\./i;
function msg(e: { code?: string; message?: string }) {
  const log = mock.method(console, "error", () => {});
  try { return { texto: mensajeErrorPrograma(e, "prueba"), log: log.mock.calls.map((c) => c.arguments.join(" ")).join(" | ") }; } finally { log.mock.restore(); }
}

describe("mensajeErrorPrograma", () => {
  test("23505 de uq_programa_hoteles_nombre → mensaje exacto del hotel repetido", () => {
    const r = msg({ code: "23505", message: 'duplicate key value violates unique constraint "uq_programa_hoteles_nombre"' });
    assert.equal(r.texto, "Ya existe un hotel con ese nombre en este programa. Usa otro nombre");
    assert.equal(r.texto, MENSAJE_HOTEL_DUPLICADO);
  });
  test("otro 23505 → mensaje claro genérico sin restricción", () => {
    const r = msg({ code: "23505", message: 'duplicate key value violates unique constraint "programas_nombre_key"' });
    assert.doesNotMatch(r.texto, TECNICO);
    assert.match(r.texto, /Ya existe/);
  });
  for (const [code, message] of [
    ["23503", 'insert or update on table "programa_hoteles" violates foreign key constraint "programa_hoteles_proveedor_id_fkey"'],
    ["23502", 'null value in column "nombre" of relation "programa_hoteles" violates not-null constraint'],
    ["23514", 'new row for relation "programa_hoteles" violates check constraint "programa_hoteles_nombre_check"'],
    ["22P02", 'invalid input syntax for type date: "2027-13-01"'],
    ["42501", 'new row violates row-level security policy for table "programa_hoteles"'],
    ["PGRST301", "JWT expired"],
    ["XX000", "algo interno de Postgres en public.programas"],
    ["", ""],
  ] as const) {
    test(`${code || "sin código"} → mensaje claro que dice qué hacer, sin texto de la base`, () => {
      const r = msg({ code, message });
      assert.doesNotMatch(r.texto, TECNICO);
      assert.ok(r.texto.length > 20);
      assert.match(r.log, /\[programas\] accion=prueba/);
      assert.doesNotMatch(r.log, /null value|invalid input|"2027-13-01"/, "el registro no repite el texto crudo ni valores");
    });
  }
  test("P0001 (mensaje de negocio de la base) se conserva; si trae texto técnico, se reemplaza", () => {
    assert.equal(msg({ code: "P0001", message: "Hay vigencias de precio base solapadas para un mismo hotel y modalidad de servicios." }).texto, "Hay vigencias de precio base solapadas para un mismo hotel y modalidad de servicios.");
    assert.doesNotMatch(msg({ code: "P0001", message: 'relation "x" does not exist' }).texto, TECNICO);
  });
});
