// #25 (bloque Portal B2B) — historial de cambios de una ficha de aliado: lectura legible de las filas de auditoría.
// Las filas de abajo reproducen las que escriben el disparador (087) y la edición del portal (283, `_via`): mismo instante, mismos cambios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lineasHistorialAliado, type FilaAuditoria } from "../lib/aliados/historial.ts";

const fila = (o: Partial<FilaAuditoria> & { id: number; creado_en: string }): FilaAuditoria => ({
  actor_email: null, actor_nombre: null, actor_rol: null, accion: "UPDATE", despues: null, cambios: null, ...o,
});
const cambio = (campo: string, antes: unknown, despues: unknown) => ({ [campo]: { antes, despues } });

describe("#25 historial de una ficha de aliado", () => {
  test("un cambio interno: quién, cuándo, campo y valores (porcentajes en %, sí/no)", () => {
    const l = lineasHistorialAliado([
      fila({ id: 2, creado_en: "2026-11-02T15:00:00Z", actor_nombre: "Ana Gerente", actor_rol: "gerencia", cambios: { ...cambio("pct_comision", 0.12, 0.1), ...cambio("aplica_retencion", true, false) } }),
    ]);
    assert.equal(l.length, 1);
    assert.equal(l[0].accion, "Cambio");
    assert.equal(l[0].origen, "interno");
    assert.equal(l[0].actor, "Ana Gerente");
    assert.deepEqual(l[0].cambios, [
      { campo: "% de comisión", antes: "12 %", despues: "10 %" },
      { campo: "Aplica retención", antes: "Sí", despues: "No" },
    ]);
  });
  test("la edición del portal deja dos filas gemelas (disparador + explícita con _via): se muestra UNA, la del portal", () => {
    const c = cambio("telefono", "3001112222", "3009998888");
    const l = lineasHistorialAliado([
      fila({ id: 10, creado_en: "2026-11-05T10:00:00Z", cambios: c }), // disparador: sin actor de sesión
      fila({ id: 11, creado_en: "2026-11-05T10:00:00Z", actor_nombre: "Laura", actor_rol: "freelance", despues: { telefono: "3009998888", _via: "portal_b2b_perfil" }, cambios: c }),
    ]);
    assert.equal(l.length, 1);
    assert.equal(l[0].origen, "portal");
    assert.equal(l[0].actor, "Laura");
    assert.equal(l[0].cambios[0].despues, "3009998888");
  });
  test("dos cambios distintos a la misma hora NO se fusionan; sin actor aparece «Sistema»", () => {
    const l = lineasHistorialAliado([
      fila({ id: 1, creado_en: "2026-11-05T10:00:00Z", cambios: cambio("banco", "A", "B") }),
      fila({ id: 2, creado_en: "2026-11-05T10:00:00Z", cambios: cambio("direccion", "x", "y"), despues: { _via: "portal_b2b_perfil" } }),
    ]);
    assert.equal(l.length, 2);
    assert.equal(l.find((x) => x.cambios[0].campo === "Banco")!.actor, "Sistema");
  });
  test("el número de cuenta se enmascara y las marcas de tiempo no cuentan como cambio", () => {
    const l = lineasHistorialAliado([
      fila({ id: 1, creado_en: "2026-11-05T10:00:00Z", cambios: cambio("numero_cuenta", "123456789012", "999900001234") }),
      fila({ id: 2, creado_en: "2026-11-06T10:00:00Z", cambios: cambio("updated_at", "a", "b") }),
    ]);
    assert.equal(l.length, 1, "la fila que solo cambió updated_at no es un cambio de la ficha");
    assert.deepEqual(l[0].cambios, [{ campo: "Número de cuenta", antes: "****9012", despues: "****1234" }]);
    assert.doesNotMatch(JSON.stringify(l), /123456789012|999900001234/);
  });
  test("alta y baja se listan sin detalle de campos; orden: lo más reciente primero", () => {
    const l = lineasHistorialAliado([
      fila({ id: 1, creado_en: "2026-01-01T00:00:00Z", accion: "INSERT" }),
      fila({ id: 3, creado_en: "2026-03-01T00:00:00Z", accion: "DELETE" }),
      fila({ id: 2, creado_en: "2026-02-01T00:00:00Z", cambios: cambio("nombre", "A", "B") }),
    ]);
    assert.deepEqual(l.map((x) => x.accion), ["Baja", "Cambio", "Alta"]);
    assert.deepEqual(l[0].cambios, []);
  });
});
