import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #56 · Migración 269 (canal WhatsApp de SalesBot): estructura de la migración y de sus scripts de preflight/postcheck/rollback.
// La ejecución REAL contra Postgres (preflight → migración → postcheck → negativos → concurrencia SQL → rollback) la hace
// supabase/scripts/test_269_salesbot_whatsapp.sh en un contenedor local desechable.

describe("migración 269 y scripts SQL", () => {
  const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const mig = leer("supabase/migrations/20260601000269_salesbot_whatsapp.sql");
  test("tres tablas con RLS, sin policies y sin acceso para anon/authenticated", () => {
    assert.equal((mig.match(/enable row level security/g) ?? []).length, 3);
    assert.match(mig, /revoke all on table[^;]*salesbot_wa_mensajes[^;]*salesbot_wa_sesiones[^;]*salesbot_wa_traspasos[^;]*from anon, authenticated/);
    assert.ok(!/create policy/i.test(mig));
  });
  test("bandeja, turno por cliente, avance de sesión y cola de avisos tienen sus columnas", () => {
    for (const c of ["estado", "intentos", "lease_hasta", "primer_recibo", "resultado", "enviados", "ts", "lock_por", "lock_hasta", "ultimo_ts", "ultimo_mensaje", "aviso_intentos", "aviso_proximo"]) assert.match(mig, new RegExp(`\\b${c}\\b`), c);
    assert.match(mig, /mensaje_id\s+text not null unique/);
    assert.match(mig, /avisado_en\s+timestamptz/);
  });
  for (const [nombre, ok] of [["preflight_269_salesbot_whatsapp.sql", "PREFLIGHT_OK"], ["postcheck_269_salesbot_whatsapp.sql", "VERIFICACION_OK"]] as const) {
    test(`${nombre}: UNA sola consulta, solo lectura, con columna de estado y fila RESUMEN`, () => {
      const s = leer(`supabase/scripts/${nombre}`);
      const sinComentarios = s.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''"); // sin comentarios ni literales de texto
      assert.equal(sinComentarios.split(";").filter((x) => x.trim()).length, 1, "una sola sentencia");
      assert.ok(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(sinComentarios));
      assert.match(sinComentarios, /\bestado\b/);
      assert.ok(s.includes(ok));
    });
  }
  test("el postcheck comprueba los permisos de las TRES tablas para anon, authenticated y service_role y las columnas nuevas", () => {
    const s = leer("supabase/scripts/postcheck_269_salesbot_whatsapp.sql");
    for (const t of ["salesbot_wa_mensajes", "salesbot_wa_sesiones", "salesbot_wa_traspasos"]) assert.match(s, new RegExp(t), t);
    assert.match(s, /has_table_privilege\(r\.rol/);
    assert.match(s, /values \('anon'\), \('authenticated'\)/);
    assert.match(s, /has_table_privilege\('service_role'/);
    assert.match(s, /relrowsecurity/);
    assert.match(s, /pg_policies/);
    for (const c of ["lock_por", "ultimo_ts", "aviso_proximo", "aviso_intentos", "'ts'"]) assert.ok(s.includes(c), c);
  });
});
