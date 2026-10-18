// Cliente tipado de la consulta exacta del registro central de personas (#32, migración 214).
//
// Solo envuelve la RPC `buscar_personas_documento`: nunca lee `personas`, `persona_capturas`
// ni `persona_observaciones` (no tienen GRANT para la app). El actor, su rol y su agencia los
// decide la función en la base a partir de la sesión; `tenant` es solo una solicitud que la
// función valida. Sin loaders ni UI: #40 lo consumirá.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CampoObservacion, FuentePersona } from "./fuentes";
import type { TipoDocPersona } from "./identidad";

/** Máximo de observaciones por página; la RPC rechaza valores mayores (no recorta). */
export const LIMITE_MAX_OBSERVACIONES = 50;
export const LIMITE_POR_DEFECTO = 20;
/** Máximo de valores detallados por campo en `variantes`; el resto se cuenta en `valores_omitidos`. */
export const VALORES_POR_CAMPO_MAX = 10;

export type ObservacionPersona = {
  campo: CampoObservacion;
  valor: string;
  captura_id: string;
  fuente: FuentePersona;
  capturado_en: string;
  contrato_numero: string | null;
  /** Solo desde administración en adelante; para `venta` llega null. */
  actor_rol: string | null;
};

export type VarianteCampo = {
  campo: CampoObservacion;
  /** Valores distintos de este campo entre TODAS las observaciones autorizadas. */
  n_valores: number;
  divergencia: boolean;
  /** Como máximo VALORES_POR_CAMPO_MAX, los de más capturas primero. */
  valores: { valor: string; n_capturas: number }[];
  valores_omitidos: number;
};

export type RespuestaBusquedaPersonas = {
  /** null cuando no existe o cuando el actor no tiene ninguna observación autorizada (indistinguible). */
  persona: { id: string; tenant: "mayorista" | "minorista"; tipo_doc: TipoDocPersona; numero_norm: string } | null;
  observaciones: ObservacionPersona[];
  total: number;
  has_more: boolean;
  divergencia: boolean;
  variantes: VarianteCampo[];
  /** Solo a actores autorizados: el tipo o el número no forman una clave consultable. */
  error?: "formato_no_admitido";
};

export type ParametrosBusqueda = {
  tenant: "mayorista" | "minorista" | null;
  tipoDoc: string;
  numero: string;
  limite?: number;
  offset?: number;
};

export type ResultadoBusqueda = { ok: true; data: RespuestaBusquedaPersonas } | { ok: false; error: string };

/** Misma regla que la RPC; se comprueba antes de llamar para dar un mensaje claro. */
export function validarPaginacion(limite: number, offset: number): string | null {
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAX_OBSERVACIONES) {
    return `El límite debe ser un entero entre 1 y ${LIMITE_MAX_OBSERVACIONES}.`;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return "El desplazamiento debe ser un entero mayor o igual a 0.";
  }
  return null;
}

export async function buscarPersonasDocumento(
  sb: SupabaseClient<Database>,
  p: ParametrosBusqueda
): Promise<ResultadoBusqueda> {
  const limite = p.limite ?? LIMITE_POR_DEFECTO;
  const offset = p.offset ?? 0;
  const errorPaginacion = validarPaginacion(limite, offset);
  if (errorPaginacion) return { ok: false, error: errorPaginacion };

  const { data, error } = await sb.rpc("buscar_personas_documento", {
    p_tenant: p.tenant,
    p_tipo_doc: p.tipoDoc,
    p_numero: p.numero,
    p_limite: limite,
    p_offset: offset,
  });
  // El detalle técnico no viaja al navegador: podría exponer nombres de objetos de la base.
  if (error) return { ok: false, error: "No se pudo consultar el documento. Intenta de nuevo." };
  return { ok: true, data: data as unknown as RespuestaBusquedaPersonas };
}
