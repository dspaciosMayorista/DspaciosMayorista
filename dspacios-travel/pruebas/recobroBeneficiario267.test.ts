// Prueba estática de la migración 267 (recobro con beneficiario explícito). Se ejecuta con npm run test:unit.
import { test } from "node:test";
import assert from "node:assert/strict";

test("el origen del error (migración 267): el recobro toma el aliado de la cotización o falla; no reemplaza funciones auditadas ni usa ventas.asesor", async () => {
  const { readFileSync, existsSync, readdirSync } = await import("node:fs");
  const raiz = new URL("../supabase/migrations/", import.meta.url);
  const sql = readFileSync(new URL("20260601000267_recobro_beneficiario_explicito.sql", raiz), "utf8");
  const ejecutable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(ejecutable, /RECOBRO_SIN_BENEFICIARIO/);
  assert.match(ejecutable, /v.cotizacion_id/, "la cotización de origen sale de la venta (ventas.cotizacion_id), no del número");
  assert.match(ejecutable, /RECOBRO_ALIADO_DISCREPANTE/, "ante discrepancia falla con mensaje claro");
  assert.doesNotMatch(ejecutable, /order by c.id desc|limit 1/i, "nunca elige «la última cotización con ese número»");
  assert.match(ejecutable, /c.aliado_id/, "usa el aliado explícito de la cotización");
  assert.match(ejecutable, /deferrable initially deferred/i, "se evalúa cuando la conversión ya enlazó la cotización");
  assert.doesNotMatch(ejecutable, /create or replace function public\.convertir_cotizacion_a_contrato/i, "no reescribe la RPC que 222 verifica por md5");
  assert.doesNotMatch(ejecutable, /v\.asesor\b/, "el asesor interno nunca acredita un beneficiario");
  // La prohibición global de varios beneficiarios fue retirada: no queda ninguna 255 ni un trigger de «un beneficiario por contrato».
  const todas = readdirSync(raiz).filter((f) => /_25[56]_/.test(f) && /aliados_b2b/.test(f));
  assert.deepEqual(todas, []);
  assert.ok(!existsSync(new URL("../supabase/scripts/rollback_255_aliados_b2b_un_beneficiario.sql", import.meta.url)));
});
