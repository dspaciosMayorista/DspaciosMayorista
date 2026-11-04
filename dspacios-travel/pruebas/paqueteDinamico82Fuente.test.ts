// #82 (276) — guarda de ficha fuente: el destino de un empaquetado/servicio vinculado debe ser el declarado en el paquete.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("destinoCoincide", async () => {
  const { destinoCoincide } = await import("../lib/paqueteDinamico/ruta.ts");
  test("ficha de otro destino presentada como el principal (declarado vacío o igual al principal) se rechaza", () => {
    assert.equal(destinoCoincide(2, null, 1), false);
    assert.equal(destinoCoincide(2, 1, 1), false);
  });
  test("multidestino: la ficha declarando su destino real se admite", () => {
    assert.equal(destinoCoincide(2, 2, 1), true);
    assert.equal(destinoCoincide(1, null, 1), true);
  });
  test("ficha sin destino (servicio nacional) no se compara; el manual ni siquiera llega aquí", () => {
    assert.equal(destinoCoincide(null, 2, 1), true);
    assert.equal(destinoCoincide(undefined, null, 1), true);
  });
});

describe("cableado de la guarda", () => {
  const a = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
  test("la acción compara vuelos y servicios vinculados con el destino de su ficha", () => {
    assert.match(a, /destinoCoincide\(x\.destino_id, v\.destinoId, e\.destinoId\)/);
    assert.match(a, /destinoCoincide\(f\.destino_id, x\.destinoId, e\.destinoId\)/);
    assert.match(a, /select\("id, moneda, proveedor_id, destino_id"\)/);
  });
  test("los triggers de la base hacen la misma comparación (y al cambiar el principal)", () => {
    const m = leer("supabase/migrations/20260601000276_paquete_dinamico_multidestino_ruta_proveedor.sql");
    assert.match(m, /e\.destino_src is distinct from coalesce\(new\.destino_id, p\.destino_id\)/);
    assert.match(m, /sv\.destino_src is distinct from coalesce\(new\.destino_id, p\.destino_id\)/);
    assert.match(m, /e\.destino_id is not null and e\.destino_id is distinct from new\.destino_id/);
  });
  test("test_276 trae los dos negativos pedidos (empaquetado y servicio de otro destino como principal)", () => {
    const t = leer("supabase/scripts/test_276_paquete_dinamico_multidestino_ruta_proveedor.sql");
    assert.match(t, /NEGATIVO vuelo vinculado a un empaquetado de OTRO destino presentado como destino principal/);
    assert.match(t, /NEGATIVO servicio vinculado de OTRO destino presentado como destino principal/);
  });
});

describe("ficha que cambia de destino después de vincularse", () => {
  const m = leer("supabase/migrations/20260601000276_paquete_dinamico_multidestino_ruta_proveedor.sql");
  test("publicar y cotizar revisan los vínculos desalineados (helper de solo lectura, solo service_role)", () => {
    assert.match(m, /create or replace function p82_priv\.vinculos_desalineados\(p_paquete bigint, p_vuelo bigint, p_todos boolean\)/);
    assert.match(m, /p82_priv\.vinculos_desalineados\(new\.id, null, true\)/);
    assert.match(m, /p82_priv\.vinculos_desalineados\(p\.id, case when p\.usa_vuelo then v_v else null end, false\)/);
    assert.match(m, /grant execute on function p82_priv\.vinculos_desalineados\(bigint, bigint, boolean\) to service_role/);
  });
  test("el preflight cuenta y detalla las discrepancias con veredicto REVISAR y no modifica nada", () => {
    const p = leer("supabase/scripts/preflight_276_paquete_dinamico_multidestino_ruta_proveedor.sql");
    assert.match(p, /'REVISAR'/);
    assert.doesNotMatch(p.replace(/--.*$/gm, ""), /\b(update|delete|insert)\b/i);
  });
  test("publicar muestra el motivo sin el prefijo técnico", () => {
    assert.match(sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts")), /replace\(\/\^DIN_82_\[A-Z_\]\+:\\s\*\/, ""\)/);
  });
});
