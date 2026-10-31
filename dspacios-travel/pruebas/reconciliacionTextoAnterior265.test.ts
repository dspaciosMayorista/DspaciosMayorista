// El reintento del cron se NIEGA (sin llamar a la RPC ni escribir) cuando el contrato ya tiene CxP con el texto ANTERIOR del carrito, que la RPC no reconoce y duplicaría.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconciliarFinancieroPendiente, mensajeReintentoCxpTextoAnterior, TEXTO_OBS_CARRITO_ANTERIOR, type DepsReconciliacion } from "../lib/reservar/reconciliacionFinanciera.ts";

function deps(anteriores: number | undefined) {
  const llamadas = { rpc: 0, fallos: [] as Array<[string, string]> };
  const d = {
    rpc: async () => { llamadas.rpc++; return { data: { creadas: [], eliminadas: [] }, error: null }; },
    postearAsiento: async () => ({ ok: true }), eliminarAsiento: async () => ({ ok: true }), guardarPendiente: async () => ({ ok: true }),
    listarPendientesAntiguos: async () => [{ numeroContrato: "DTM-0001", tenant: "mayorista" }],
    leerPendiente: async () => ({ costos: {}, cxp: [] }),
    marcarIntentoFallido: async (n: string, e: string) => { llamadas.fallos.push([n, e]); },
    listarCxpSinAsiento: async () => [],
    ...(anteriores === undefined ? {} : { contarCxpTextoAnterior: async () => anteriores }),
  } as unknown as DepsReconciliacion;
  return { d, llamadas };
}

describe("reintento financiero con CxP del texto anterior del carrito", () => {
  test("con CxP de texto anterior: no llama a la RPC, deja el error claro y el resultado ok=false", async () => {
    const { d, llamadas } = deps(2);
    const r = await reconciliarFinancieroPendiente(d, { umbralMinutos: 0 });
    assert.equal(llamadas.rpc, 0);
    assert.deepEqual(r.pendientes, [{ numeroContrato: "DTM-0001", accion: "reintentado", ok: false, error: mensajeReintentoCxpTextoAnterior("DTM-0001", 2) }]);
    assert.equal(llamadas.fallos.length, 1);
    assert.match(llamadas.fallos[0][1], new RegExp(TEXTO_OBS_CARRITO_ANTERIOR.replace(/[()]/g, "\\$&")));
    assert.match(llamadas.fallos[0][1], /No se escribió nada/);
  });
  test("sin CxP de texto anterior (o sin la dependencia) el reintento es el de siempre", async () => {
    for (const a of [0, undefined]) {
      const { d, llamadas } = deps(a);
      const r = await reconciliarFinancieroPendiente(d, { umbralMinutos: 0 });
      assert.equal(llamadas.rpc, 1); assert.equal(r.pendientes[0].ok, true);
    }
  });
  test("el texto es exactamente el que ponía el carrito antes del cambio", () => {
    assert.equal(TEXTO_OBS_CARRITO_ANTERIOR, "Generado automáticamente desde el carrito (tarifario)");
  });
});
