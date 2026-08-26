import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { siguienteNumeroContrato } from "../lib/contrato/numeracion.ts";

// Helper único (migración 159) — envuelve el RPC centralizado
// siguiente_numero_contrato_para_tenant. Estas pruebas no tocan Postgres
// (eso lo cubre supabase/scripts/test_consecutivo_dtm_mayorista.sh): solo
// verifican que el wrapper de TypeScript pasa el tenant tal cual y traduce
// la respuesta/errores del RPC sin inventar ni perder nada.
function fakeSb(resultado: { data: string | null; error: { message: string } | null }) {
  const llamadas: Array<{ nombre: string; args: unknown }> = [];
  const sb = {
    rpc: (nombre: string, args: unknown) => {
      llamadas.push({ nombre, args });
      return Promise.resolve(resultado);
    },
  };
  return { sb, llamadas };
}

describe("siguienteNumeroContrato", () => {
  test("llama al RPC correcto con el tenant recibido, sin transformarlo", async () => {
    const { sb, llamadas } = fakeSb({ data: "DTM-0001", error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await siguienteNumeroContrato(sb as any, "mayorista");
    assert.deepEqual(res, { ok: true, numero: "DTM-0001" });
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].nombre, "siguiente_numero_contrato_para_tenant");
    assert.deepEqual(llamadas[0].args, { p_tenant: "mayorista" });
  });

  test("minorista pasa igual, sin agregarle ningún prefijo por su cuenta", async () => {
    const { sb, llamadas } = fakeSb({ data: "MIN-00-0533", error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await siguienteNumeroContrato(sb as any, "minorista");
    assert.deepEqual(res, { ok: true, numero: "MIN-00-0533" });
    assert.deepEqual(llamadas[0].args, { p_tenant: "minorista" });
  });

  test("propaga el mensaje de error del RPC (p.ej. tenant rechazado por la función)", async () => {
    const { sb } = fakeSb({ data: null, error: { message: "tenant inválido: francia" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await siguienteNumeroContrato(sb as any, "mayorista");
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, "tenant inválido: francia");
  });

  test("sin data y sin error explícito, igual falla cerrado con un mensaje por defecto", async () => {
    const { sb } = fakeSb({ data: null, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await siguienteNumeroContrato(sb as any, "mayorista");
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, "No se pudo generar el número de contrato.");
  });
});
