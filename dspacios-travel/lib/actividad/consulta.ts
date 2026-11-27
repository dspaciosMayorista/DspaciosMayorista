// B3-01 — Consulta PAGINADA de la presencia (modal del tablero). Reglas PURAS: normalizan lo que llega del navegador antes de llamar a `fn_actividad_pagina` (344), que vuelve a limitar todo en la base.
export const TAM_PAGINA_ACTIVIDAD = 20;
export const MAX_BUSQUEDA_ACTIVIDAD = 80;
export type GrupoActividad = "interno" | "aliado";
export type ConsultaActividad = { grupo: GrupoActividad; busqueda: string; pagina: number };
/** Conteos del recuadro compacto (`fn_actividad_resumen`): un agregado, ninguna fila por persona. */
export type ResumenActividad = { personal_total: number; aliados_total: number; personal_recientes: number; aliados_recientes: number; sin_observacion: number };

export function normalizarConsultaActividad(i: { grupo?: unknown; busqueda?: unknown; pagina?: unknown }): ConsultaActividad {
  const pagina = typeof i.pagina === "number" && Number.isInteger(i.pagina) && i.pagina > 0 ? Math.min(i.pagina, 10_000) : 0;
  return {
    grupo: i.grupo === "aliado" ? "aliado" : "interno",
    busqueda: typeof i.busqueda === "string" ? i.busqueda.trim().slice(0, MAX_BUSQUEDA_ACTIVIDAD) : "",
    pagina,
  };
}

export const paramsRpcActividad = (c: ConsultaActividad) => ({ p_grupo: c.grupo, p_busqueda: c.busqueda || null, p_offset: c.pagina * TAM_PAGINA_ACTIVIDAD, p_limite: TAM_PAGINA_ACTIVIDAD, p_dias: 7 });

export const totalPaginas = (total: number) => Math.max(1, Math.ceil(Math.max(0, total) / TAM_PAGINA_ACTIVIDAD));
