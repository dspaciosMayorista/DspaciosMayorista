// ─────────────────────────────────────────────────────────────────────────
// #63 — resolución de la OFERTA de una salida dinámica al cotizar/reservar.
//
// `computarReserva` llama esto SOLO cuando el origen es una salida. Decide, con
// lecturas del cliente de SERVICIO (la tabla `salidas_dinamicas` y los netos no
// son legibles para todos los roles que venden), si la salida es:
//   · una salida MANUAL de un paquete de siempre → `oferta: null` (nada cambia);
//   · una salida MANUAL de un paquete en modo `cop_trm_63`;
//   · una salida VINCULADA a un Empaquetado sin record (exige modo 63).
// Una salida vinculada se valida contra su fuente VIVA: activa, sin record,
// ventana de compra, viaje futuro, COP, copia coincidente y destino aéreo
// permitido (#67/220). NUNCA consulta cupos: un Empaquetado no tiene sillas.
// Cualquier fallo rechaza; un error de lectura no se interpreta como "disponible".
// ─────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { validarOrigenAereoPaquete } from "../paquetes/destinosAereos67.ts";
import {
  aCop63,
  esModo63,
  evaluarFuenteVinculada63,
  feeACop63,
  fuenteCoincideConSalida63,
  mensajeFuenteCambio63,
  validarTrm63,
  type FuenteEmpaquetado63,
  type SalidaVinculada63,
} from "./ofertaDinamica63.ts";
import { hoyBogota } from "./origen.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>;

export type Oferta63 = {
  /** TRM del paquete (COP por USD), validada > 0. */
  trm: number;
  vinculada: boolean;
  empaquetadoId: number | null;
  /** R de una vinculada (precio final del aéreo) o el tiquete de una manual, ya en COP. */
  tarifaParaEmpaquetar: number;
  /** F: fee de infante ya en COP (centavos exactos). */
  feeInfante: number;
  impuestoTipo: string | null;
  /** Impuesto fijo del paquete: en modo 63 se interpreta en COP. */
  impuestoFijo: number;
  /** Generación/revisión del tarifario PUBLICADO que respalda la cotización. */
  generacionPublicada: number | null;
  revisionPublicada: number | null;
};

export type ResultadoOferta63 = { ok: true; oferta: Oferta63 | null } | { ok: false; error: string };

const ERROR_LECTURA = "No se pudo validar la salida seleccionada. Intenta nuevamente.";

export async function resolverOfertaSalida63(lector: Cliente, paqueteId: number, salidaId: number): Promise<ResultadoOferta63> {
  const [pqRes, salRes] = await Promise.all([
    lector
      .from("armado_paquetes")
      .select("modo_oferta, trm_oferta, impuesto_tipo, impuesto_fijo, tarifario_generacion_publicada, tarifario_revision_publicada")
      .eq("id", paqueteId)
      .maybeSingle(),
    lector
      .from("salidas_dinamicas")
      .select("id, paquete_id, empaquetado_id, moneda, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante")
      .eq("id", salidaId)
      .maybeSingle(),
  ]);
  if (pqRes.error || salRes.error) return { ok: false, error: ERROR_LECTURA };
  const pq = pqRes.data as Record<string, unknown> | null;
  const sal = salRes.data as (SalidaVinculada63 & { paquete_id?: number | null; moneda?: string | null }) | null;
  if (!sal) return { ok: false, error: "La salida seleccionada ya no existe o no está disponible." };
  if (!pq) return { ok: false, error: ERROR_LECTURA };
  if (sal.paquete_id != null && Number(sal.paquete_id) !== Number(paqueteId)) {
    return { ok: false, error: "La salida seleccionada no pertenece a este paquete." };
  }

  const vinculada = sal.empaquetado_id != null;
  const modo63 = esModo63(pq.modo_oferta);
  if (!modo63) {
    if (vinculada) return { ok: false, error: "Esta salida está vinculada a un vuelo de Empaquetados pero el paquete no está en modo COP con TRM. Revisa la configuración del paquete." };
    return { ok: true, oferta: null };
  }
  const trm = validarTrm63(pq.trm_oferta);
  if (!trm.ok) return { ok: false, error: trm.error };

  const base = {
    trm: trm.trm,
    impuestoTipo: (pq.impuesto_tipo as string | null) ?? null,
    impuestoFijo: Number(pq.impuesto_fijo) || 0,
    generacionPublicada: pq.tarifario_generacion_publicada == null ? null : Number(pq.tarifario_generacion_publicada),
    revisionPublicada: pq.tarifario_revision_publicada == null ? null : Number(pq.tarifario_revision_publicada),
  };

  if (!vinculada) {
    return {
      ok: true,
      oferta: {
        ...base,
        vinculada: false,
        empaquetadoId: null,
        tarifaParaEmpaquetar: aCop63(Number(sal.valor_tiquete) || 0, sal.moneda, trm.trm),
        feeInfante: feeACop63(Number(sal.fee_infante) || 0, sal.moneda, trm.trm),
      },
    };
  }

  const empaquetadoId = Number(sal.empaquetado_id);
  const { data: f, error: eF } = await lector
    .from("empaquetados")
    .select("id, activo, record, compra_inicio, compra_fin, fecha_ida, fecha_regreso, ruta, aerolinea, moneda, tarifa_para_empaquetar, fee_infante")
    .eq("id", empaquetadoId)
    .maybeSingle();
  if (eF) return { ok: false, error: ERROR_LECTURA };
  const fuente = f as (FuenteEmpaquetado63 & { id: number }) | null;
  const elegible = evaluarFuenteVinculada63(fuente, hoyBogota(new Date()));
  if (!elegible.ok) return { ok: false, error: elegible.error };
  const coincide = fuenteCoincideConSalida63(sal, fuente as FuenteEmpaquetado63);
  if (!coincide.ok) return { ok: false, error: mensajeFuenteCambio63(coincide.campos) };
  // Destino aéreo (#67/220): misma regla que Bloqueo/Sistema, mensaje técnico distinto del de "no corresponde".
  const destino = await validarOrigenAereoPaquete(lector as never, paqueteId, { tipo: "empaquetado", id: empaquetadoId });
  if (!destino.ok) return { ok: false, error: destino.error };

  return {
    ok: true,
    oferta: {
      ...base,
      vinculada: true,
      empaquetadoId,
      tarifaParaEmpaquetar: Number((fuente as FuenteEmpaquetado63).tarifa_para_empaquetar) || 0,
      feeInfante: feeACop63(Number((fuente as FuenteEmpaquetado63).fee_infante) || 0, (fuente as FuenteEmpaquetado63).moneda, trm.trm),
    },
  };
}
