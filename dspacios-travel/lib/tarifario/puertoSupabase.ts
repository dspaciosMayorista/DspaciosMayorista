// ─────────────────────────────────────────────────────────────────────────────
// Puerto de la publicación por lotes sobre el cliente de Supabase (RPC). Los errores REALES de la base (p. ej. una llave foránea inválida en los datos, código 23503) se
// propagan como `ErrorRpc` con su código: NO se convierten en «obsoleta» (eso solo lo decide la función de la base, que distingue la FK del control de lotes de las de los datos).
// ─────────────────────────────────────────────────────────────────────────────

import type { ArgsManifiesto, EstadoPublicacionServidor, PuertoPublicacion } from "./controladorPublicacion.ts";

export type RpcCliente = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export class ErrorRpc extends Error {
  readonly funcion: string;
  readonly codigo: string | undefined;
  constructor(funcion: string, mensaje: string, codigo?: string) {
    super(`${funcion}: ${mensaje}`);
    this.name = "ErrorRpc";
    this.funcion = funcion;
    this.codigo = codigo;
  }
}

export function puertoSupabase(sb: RpcCliente): PuertoPublicacion {
  const llamar = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new ErrorRpc(fn, error.message, error.code);
    return data;
  };
  const texto = (v: unknown, fn: string): string => { if (typeof v !== "string") throw new ErrorRpc(fn, "respuesta inesperada (se esperaba texto)"); return v; };
  return {
    async manifiesto(a: ArgsManifiesto) {
      return texto(await llamar("tarifario_manifiesto_crear", {
        p_paquete_id: a.paqueteId, p_generacion: a.generacion, p_revision_capturada: a.revision, p_moneda: a.moneda, p_lotes: a.lotes,
        p_composicion: a.composicion, p_regla: a.regla, p_modo: a.modo, p_trm: a.trm, p_diagnostico: a.diagnostico,
      }), "tarifario_manifiesto_crear");
    },
    async estado(paqueteId, generacion): Promise<EstadoPublicacionServidor> {
      const j = (await llamar("tarifario_publicacion_estado", { p_paquete_id: paqueteId, p_generacion: generacion })) as Record<string, unknown> | null;
      if (!j || typeof j !== "object") throw new ErrorRpc("tarifario_publicacion_estado", "respuesta inesperada");
      return {
        existe: j.existe === true, vigente: j.vigente === true, publicada: j.publicada === true,
        pendientes: Array.isArray(j.pendientes) ? (j.pendientes as unknown[]).map(Number) : undefined,
        enEspera: Array.isArray(j.en_espera) ? (j.en_espera as unknown[]).map(Number) : undefined,
        enCola: j.en_cola === true, colaEstado: typeof j.cola_estado === "string" ? j.cola_estado : null,
        colaIntentos: typeof j.cola_intentos === "number" ? j.cola_intentos : undefined, colaError: typeof j.cola_error === "string" ? j.cola_error : null,
        totalLotes: typeof j.total_lotes === "number" ? j.total_lotes : undefined,
        revisionCapturada: typeof j.revision_capturada === "number" ? j.revision_capturada : undefined,
      };
    },
    async espera(paqueteId, generacion, lote, textoLote) {
      return texto(await llamar("tarifario_lote_espera_guardar", { p_paquete_id: paqueteId, p_generacion: generacion, p_lote: lote, p_filas_txt: textoLote }), "tarifario_lote_espera_guardar");
    },
    async encolar(paqueteId, generacion) {
      return texto(await llamar("tarifario_publicacion_encolar", { p_paquete_id: paqueteId, p_generacion: generacion }), "tarifario_publicacion_encolar");
    },
    async avanzar(paqueteId, generacion) {
      return texto(await llamar("tarifario_publicacion_avanzar", { p_paquete_id: paqueteId, p_generacion: generacion }), "tarifario_publicacion_avanzar");
    },
  };
}

/** Publicación pendiente del paquete (generación vigente con manifiesto y sin publicar), o null. Lo usa la pantalla al abrirse para ofrecer «Continuar». */
export async function leerPublicacionPendiente(sb: RpcCliente, paqueteId: number): Promise<{ generacion: number; revisionCapturada: number; faltan: number; total: number; enCola: boolean; colaEstado: string | null } | null> {
  const { data, error } = await sb.rpc("tarifario_publicacion_pendiente", { p_paquete_id: paqueteId });
  if (error || !data || typeof data !== "object") return null;
  const j = data as Record<string, unknown>;
  if (j.pendiente !== true) return null;
  const faltan = Array.isArray(j.pendientes) ? (j.pendientes as unknown[]).length : 0;
  return { generacion: Number(j.generacion), revisionCapturada: Number(j.revision_capturada), faltan, total: Number(j.total_lotes), enCola: j.en_cola === true, colaEstado: typeof j.cola_estado === "string" ? j.cola_estado : null };
}

/** La publicación por lotes está APAGADA por defecto: el código puede desplegarse antes que la migración. Se enciende con TARIFARIO_PUBLICACION_POR_LOTES=1 cuando la migración ya corrió. */
export function publicacionPorLotesActiva(env: Record<string, string | undefined> = process.env): boolean {
  return env.TARIFARIO_PUBLICACION_POR_LOTES === "1";
}
