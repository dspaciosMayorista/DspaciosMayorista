// Cliente tipado de la consulta exacta del registro central de personas (#32, migración 214).
//
// Solo envuelve la RPC `buscar_personas_documento`: nunca lee `personas`, `persona_capturas`
// ni `persona_observaciones` (no tienen GRANT para la app). El actor, su rol y su agencia los
// decide la función en la base a partir de la sesión; `tenant` es solo una solicitud que la
// función valida. Sin loaders ni UI: #40 lo consumirá.
//
// #42 (migración 219) agrega aquí los clientes tipados de sus RPC: las fachadas de alta
// (`registrar_personas_cotizacion`, `sellar_creador_cotizacion`, solo con el cliente service-role de
// una Server Action) y la lista del CRM (`crm_personas_cotizacion_buscar`, con el cliente de SESIÓN).
// La corrección del titular (`actualizar_titular_cotizacion`) la llama solo el editor de
// manual-actions.ts, como el resto de RPC de ese archivo. Nadie más llama a estas RPC.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { CampoObservacion, FuentePersona219, RolParticipante } from "./fuentes";
import type { TipoDocPersona } from "./identidad";
import {
  codigoErrorPersonas, participantesDesdeCotizacion,
  type FilaCotizacionPersonas, type ParticipanteEntrada,
} from "@/lib/personas/cotizacion";

/** Máximo de observaciones por página; la RPC rechaza valores mayores (no recorta). */
export const LIMITE_MAX_OBSERVACIONES = 50;
export const LIMITE_POR_DEFECTO = 20;
/** Máximo de valores detallados por campo en `variantes`; el resto se cuenta en `valores_omitidos`. */
export const VALORES_POR_CAMPO_MAX = 10;

export type ObservacionPersona = {
  campo: CampoObservacion;
  valor: string;
  captura_id: string;
  fuente: FuentePersona219;
  capturado_en: string;
  contrato_numero: string | null;
  /** Solo desde administración en adelante; para `venta` llega null. */
  actor_rol: string | null;
  /** 219: cotización de origen; para `venta`, solo si la cotización es suya. */
  cotizacion_id?: number | null;
  /** 219: puesto dentro de la cotización (titular/pasajero); null en otras fuentes. */
  rol?: RolParticipante | null;
  /** 219: si el puesto sigue activo; null en otras fuentes. */
  activo?: boolean | null;
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

// ── #42 · Personas de cotizaciones (migración 219) ────────────────────────────

/** Resultado de una fachada: o sus datos, o el CÓDIGO propio del error (nunca el texto crudo). */
export type ResultadoFachada<T> = { ok: true; data: T } | { ok: false; codigo: string | null };

type ClienteServicio = SupabaseClient<Database>;

function fallo(error: { message?: string } | null): { ok: false; codigo: string | null } {
  return { ok: false, codigo: codigoErrorPersonas(error?.message) };
}

/** Sello NUEVO de autor (Reservar/checkout con sesión). Solo service-role. */
export async function sellarCreadorCotizacion(
  admin: ClienteServicio,
  cotizacionId: number,
  usuarioId: string
): Promise<ResultadoFachada<"sellada" | "ya_sellada">> {
  const { data, error } = await admin.rpc("sellar_creador_cotizacion", { p_cotizacion_id: cotizacionId, p_usuario_id: usuarioId });
  if (error || (data !== "sellada" && data !== "ya_sellada")) return fallo(error);
  return { ok: true, data };
}

export type ConteoRegistro = { nuevos: number; reintentos: number; omitidos: number };

/** Alta / reintento de los puestos de una cotización abierta. Solo service-role. */
export async function registrarPersonasCotizacion(
  admin: ClienteServicio,
  cotizacionId: number,
  usuarioId: string | null,
  participantes: ParticipanteEntrada[]
): Promise<ResultadoFachada<ConteoRegistro>> {
  const { data, error } = await admin.rpc("registrar_personas_cotizacion", {
    p_cotizacion_id: cotizacionId,
    p_usuario_id: usuarioId,
    p_participantes: participantes as unknown as Json,
  });
  const d = data as { nuevos?: unknown; reintentos?: unknown; omitidos?: unknown } | null;
  if (error || !d || typeof d !== "object" || typeof d.nuevos !== "number") return fallo(error);
  return { ok: true, data: { nuevos: d.nuevos, reintentos: Number(d.reintentos) || 0, omitidos: Number(d.omitidos) || 0 } };
}

/**
 * Alta tras crear una cotización: sello opcional (Reservar/checkout con sesión) y registro de sus
 * puestos reconstruidos desde lo que se persistió. Nunca lanza: devuelve en qué etapa falló y el
 * código, para que la acción deje el aviso y un log sin datos personales.
 */
export async function altaPersonasCotizacion(
  admin: ClienteServicio,
  p: { fila: FilaCotizacionPersonas; usuarioId: string | null; sellar: boolean }
): Promise<{ ok: true } | { ok: false; etapa: "sello" | "registro"; codigo: string | null }> {
  let fila = p.fila;
  let fallaSello: { ok: false; etapa: "sello"; codigo: string | null } | null = null;
  try {
    if (p.sellar && p.usuarioId) {
      const s = await sellarCreadorCotizacion(admin, fila.id, p.usuarioId);
      if (s.ok) fila = { ...fila, creado_por_id: p.usuarioId };
      else fallaSello = { ok: false, etapa: "sello", codigo: s.codigo };
    }
    const participantes = participantesDesdeCotizacion(fila);
    if (participantes.length) {
      const r = await registrarPersonasCotizacion(admin, fila.id, p.usuarioId, participantes);
      if (!r.ok) return { ok: false, etapa: "registro", codigo: r.codigo };
    }
  } catch {
    return { ok: false, etapa: fallaSello ? "sello" : "registro", codigo: null };
  }
  return fallaSello ?? { ok: true };
}

/** Línea de log SIN datos personales (solo etapa, id y código). */
export function logPersonasCotizacion(origen: string, cotizacionId: number, r: { etapa: string; codigo: string | null }): string {
  return `[personas42] origen=${origen} etapa=${r.etapa} cotizacion=${cotizacionId} codigo=${r.codigo ?? "desconocido"}`;
}

// Lista del CRM de personas de cotizaciones.
export const LIMITE_MAX_LISTA_PERSONAS = 50;

export type PuestoCotizacionCrm = {
  participante_ref: string;
  rol: RolParticipante;
  orden: number | null;
  activo: boolean;
  estado_ficha: "documentada" | "provisional" | "revision";
  /** null para agencia/freelance. */
  persona_id: string | null;
  tipo_doc: string | null;
  numero_doc: string | null;
  capturado_en: string;
  datos: { campo: CampoObservacion; valor: string }[];
  cotizacion: { id: number; codigo: string; estado: string; fecha: string; tenant: "mayorista" | "minorista" };
};

export type RespuestaListaPersonas = { items: PuestoCotizacionCrm[]; total: number; has_more: boolean };

export async function buscarPersonasCotizacionCrm(
  sb: SupabaseClient<Database>,
  p: { tenant: "mayorista" | "minorista" | null; texto: string; limite: number; offset: number }
): Promise<{ ok: true; data: RespuestaListaPersonas } | { ok: false; error: string }> {
  if (!Number.isInteger(p.limite) || p.limite < 1 || p.limite > LIMITE_MAX_LISTA_PERSONAS) {
    return { ok: false, error: `El límite debe ser un entero entre 1 y ${LIMITE_MAX_LISTA_PERSONAS}.` };
  }
  if (!Number.isInteger(p.offset) || p.offset < 0) return { ok: false, error: "Página inválida." };
  const texto = p.texto.length > 100 ? p.texto.slice(0, 100) : p.texto;
  const { data, error } = await sb.rpc("crm_personas_cotizacion_buscar", {
    p_tenant: p.tenant,
    p_texto: texto || null,
    p_limite: p.limite,
    p_offset: p.offset,
  });
  if (error) return { ok: false, error: "No se pudo consultar las personas de cotizaciones. Intenta de nuevo." };
  return { ok: true, data: data as unknown as RespuestaListaPersonas };
}
