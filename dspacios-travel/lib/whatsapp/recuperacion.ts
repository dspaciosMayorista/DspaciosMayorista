// Recuperación de avisos de traspaso (#56). Un traspaso cuyo correo agotó los reintentos del webhook queda guardado con `avisado_en` NULL.
// Este módulo lo vuelve a avisar SIN depender de otro mensaje del cliente: lo invoca un cron (/api/cron/avisos-whatsapp).
//   · Solo toca traspasos sin avisar, con una gracia de GRACIA_MIN para no competir con los reintentos de Meta sobre el mismo traspaso.
//   · Cada fila se reclama con un compare-and-set (lease): dos corridas simultáneas no mandan el mismo aviso dos veces.
//   · Un fallo reprograma con retroceso exponencial (5 min → tope 6 h) y NUNCA se rinde: una solicitud sin avisar es peor que un correo repetido
//     cada 6 h. El correo lleva la misma clave de idempotencia que el del webhook (Resend la recuerda 24 h).
import type { Almacen, AvisoPendiente } from "@/lib/whatsapp/turno";

export const GRACIA_MIN = 10;
export const LEASE_AVISO_MS = 5 * 60_000;
export const LIMITE_POR_CORRIDA = 20;
const BASE_MS = 5 * 60_000;
const TOPE_MS = 6 * 3_600_000;

/** Cuándo volver a intentar tras el fallo número `intentos` (1 = primer fallo). */
export function proximoAviso(intentos: number, ahora: Date): Date {
  return new Date(ahora.getTime() + Math.min(BASE_MS * 2 ** Math.max(intentos - 1, 0), TOPE_MS));
}

export type ResultadoRecuperacion = { reclamados: number; avisados: number; fallidos: number };

export async function recuperarAvisos(d: {
  almacen: Pick<Almacen, "reclamarAvisosPendientes" | "marcarAvisado" | "registrarFalloAviso">;
  avisar: (t: AvisoPendiente) => Promise<void>;
  ahora: Date;
  limite?: number;
  registrar?: (etapa: string, error: unknown) => void;
}): Promise<ResultadoRecuperacion> {
  const gracias = new Date(d.ahora.getTime() - GRACIA_MIN * 60_000);
  const pendientes = await d.almacen.reclamarAvisosPendientes(d.ahora, d.limite ?? LIMITE_POR_CORRIDA, LEASE_AVISO_MS, gracias);
  const r: ResultadoRecuperacion = { reclamados: pendientes.length, avisados: 0, fallidos: 0 };
  for (const t of pendientes) {
    try {
      await d.avisar(t);
      await d.almacen.marcarAvisado(t.id, d.ahora);
      r.avisados++;
    } catch (e) {
      r.fallidos++;
      d.registrar?.("recuperar_aviso", e);
      try {
        await d.almacen.registrarFalloAviso(t.id, proximoAviso(t.intentos, d.ahora));
      } catch (e2) {
        d.registrar?.("registrar_fallo_aviso", e2); // queda el lease del reclamo: se reintenta cuando venza
      }
    }
  }
  return r;
}
