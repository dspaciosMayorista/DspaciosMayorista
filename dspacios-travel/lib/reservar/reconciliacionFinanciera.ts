// ─────────────────────────────────────────────────────────────────────────
// RECONCILIACIÓN FINANCIERA — recupera lo que la garantía durable de
// `financieroContrato.ts` (migración 172) marcó como pendiente/incompleto,
// desde un proceso COMPLETAMENTE DISTINTO al que originó el contrato.
//
// Por qué existe: `registrarFinancieroContrato` ya no depende SOLO de que el
// mismo proceso, en la misma request, alcance a llamar a `revertir_contrato_
// incompleto` cuando algo sale mal — eso seguía siendo compensatorio, no
// durable (una caída del proceso justo ahí dejaba el contrato exactamente
// igual de incompleto, sin que nada lo supiera). La garantía real es
// `ventas.financiero_estado='pendiente'` + `contrato_financiero_pendiente`
// (su payload, si se alcanzó a persistir): ambos sobreviven a cualquier
// caída porque se escriben en su PROPIO commit, antes del intento. Este
// módulo es lo que CIERRA ese estado, corriendo en un momento y un proceso
// distintos —un cron, una acción manual de un superadmin— sin importar qué
// le pasó al proceso original.
//
// Dos resoluciones posibles por contrato pendiente, NUNCA una tercera:
//   · hay payload persistido → REINTENTAR exactamente ese payload (idempotente,
//     `registrar_financiero_contrato` ya lo garantiza) — nunca se recalcula
//     nada, nunca se inventa un costo distinto al que se decidió escribir;
//   · no hay payload (la caída fue ANTES de persistirlo) → REVERTIR. Nunca se
//     inventa un payload que nadie decidió — inventar un costo es peor que no
//     tener el contrato.
// Un umbral de antigüedad (`umbralMinutos`) evita tocar un contrato cuya
// request original puede seguir en curso EN ESTE MISMO INSTANTE.
//
// Además, de forma independiente, reintenta el asiento contable de
// cualquier CxP que no tenga uno — el espejo contable sigue siendo una
// proyección best-effort (convención de todo el proyecto, ver
// lib/contabilidad/asientos.ts), pero su ausencia es SIEMPRE detectable por
// una comparación en vivo (nunca una bandera redundante que pueda
// desincronizarse) y el reintento es idempotente (`postearAsientoCxP` ya
// reemplaza en vez de duplicar).
// ─────────────────────────────────────────────────────────────────────────

import { registrarFinancieroContrato, revertirContratoIncompleto, type DepsFinanciero, type CxPCreada } from "./financieroContrato.ts";

export type PendienteAntiguo = { numeroContrato: string; tenant: string };

export type DepsReconciliacion = Pick<DepsFinanciero, "rpc" | "postearAsiento" | "eliminarAsiento" | "guardarPendiente"> & {
  /** `ventas` con `financiero_estado='pendiente'` y `financiero_actualizado_en` más antigua que el umbral. */
  listarPendientesAntiguos: (umbralMinutos: number) => Promise<PendienteAntiguo[]>;
  /** Payload persistido para un contrato, o `null` si nunca se alcanzó a escribir. */
  leerPendiente: (numeroContrato: string) => Promise<{ costos: Record<string, number>; cxp: unknown[] } | null>;
  /** Deja rastro durable del intento fallido (columnas de `contrato_financiero_pendiente`) — nunca solo un mensaje que se pierde. */
  marcarIntentoFallido: (numeroContrato: string, error: string) => Promise<void>;
  /** CxP sin asiento contable (comparación en vivo contra `asientos_contables`, nunca una bandera). */
  listarCxpSinAsiento: () => Promise<CxPCreada[]>;
};

export type ResultadoPendiente = { numeroContrato: string; accion: "reintentado" | "revertido"; ok: boolean; error?: string };
export type ResultadoAsiento = { cuentaId: number; ok: boolean; error?: string };
export type ResultadoReconciliacion = { pendientes: ResultadoPendiente[]; asientos: ResultadoAsiento[] };

export async function reconciliarFinancieroPendiente(
  deps: DepsReconciliacion,
  opts?: { umbralMinutos?: number }
): Promise<ResultadoReconciliacion> {
  const umbral = opts?.umbralMinutos ?? 5;
  const pendientes = await deps.listarPendientesAntiguos(umbral);

  const resultadosPendientes: ResultadoPendiente[] = [];
  for (const p of pendientes) {
    const payload = await deps.leerPendiente(p.numeroContrato);
    if (payload) {
      // Reintento EXACTO — nunca se recalcula, se repite la misma escritura
      // que ya se había decidido hacer antes de la caída.
      const r = await registrarFinancieroContrato(deps, {
        numeroContrato: p.numeroContrato,
        tenant: p.tenant,
        costos: payload.costos,
        cxp: payload.cxp as never,
        fecha: new Date().toISOString().slice(0, 10),
      });
      if (r.ok) {
        resultadosPendientes.push({ numeroContrato: p.numeroContrato, accion: "reintentado", ok: true });
      } else {
        await deps.marcarIntentoFallido(p.numeroContrato, r.error);
        resultadosPendientes.push({ numeroContrato: p.numeroContrato, accion: "reintentado", ok: false, error: r.error });
      }
      continue;
    }
    // Sin payload conocido: la caída fue ANTES de persistirlo. Nunca se
    // inventa un costo — la única resolución honesta es revertir.
    const rev = await revertirContratoIncompleto(deps, p.numeroContrato, p.tenant);
    resultadosPendientes.push({ numeroContrato: p.numeroContrato, accion: "revertido", ok: rev.ok, error: rev.error });
  }

  const resultadosAsientos: ResultadoAsiento[] = [];
  const sinAsiento = await deps.listarCxpSinAsiento();
  for (const c of sinAsiento) {
    const r = await deps.postearAsiento(c);
    resultadosAsientos.push({ cuentaId: c.id, ok: r.ok, error: r.error });
  }

  return { pendientes: resultadosPendientes, asientos: resultadosAsientos };
}
