// 248 · regla pura del pago adicional (lib/finanzas/excedenteAbono.ts) y cableado de la anulación (texto).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mensajeExcedente } from "../lib/finanzas/excedenteAbono.ts";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("mensajeExcedente", () => {
  test("nombra contrato, total, pagado y nuevo abono", () => {
    const m = mensajeExcedente({ contrato: "00-0451", total: 10, pagado: 10, nuevo: 5, moneda: "COP" });
    for (const t of ["00-0451", "10 COP", "5 COP"]) assert.match(m, new RegExp(t));
  });
});

describe("cableado", () => {
  const acciones = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  test("registrarAbono no decide en la Server Action: delega en la RPC atómica y manda la operación", () => {
    const cuerpo = acciones.slice(acciones.indexOf("export async function registrarAbono("), acciones.indexOf("export async function actualizarAbono("));
    assert.match(cuerpo, /rpcFinanciero<[^>]*>\("registrar_abono"/);
    assert.match(cuerpo, /p_confirmar: confirmarExcedente === true/);
    assert.match(cuerpo, /p_operacion: operacionId/);
    assert.doesNotMatch(cuerpo, /\.from\("abonos"\)\.(insert|select)/, "ni insert ni lectura de abonos fuera de la transacción de la base");
  });
  test("anular pasa por la RPC atómica y no desactiva la guarda F4415 ni borra el asiento por su cuenta", () => {
    const cuerpo = acciones.slice(acciones.indexOf("export async function anularAbono("), acciones.indexOf("// ── Editar servicios adicionales"));
    assert.match(cuerpo, /rpcFinanciero<[^>]*>\("anular_abono"/);
    assert.doesNotMatch(cuerpo, /\.delete\(\)|reemplazarAsiento|session_replication_role|disable trigger/i);
  });
  test("las pantallas ya no ofrecen borrar un abono a secas", () => {
    for (const rel of ["app/(dashboard)/dashboard/cartera/CarteraList.tsx", "app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx", "app/(dashboard)/dashboard/cartera/actions.ts"]) {
      assert.doesNotMatch(leer(rel), /eliminarAbono/, rel);
    }
  });
  test("la migración 248 no desactiva ni borra las guardas de la 208", () => {
    const sql = leer("supabase/migrations/20260601000248_anular_abono_contabilizado.sql").replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /drop trigger|disable trigger|alter table public\.abonos\s|drop function f208|create or replace function f208/i);
  });
});
