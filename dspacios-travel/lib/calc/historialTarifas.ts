// Historial interno de tarifas (pendiente #26, migración 203). Funciones PURAS
// para presentar una versión histórica con los datos de SU vigencia en el
// momento del cambio (`tarifa_hotel_historial.vigencia`, foto tomada por el
// trigger) — nunca con los metadatos actuales de `hotel_temporadas`.
// Nada de este módulo lo usa el motor de cotización, reserva o tarifario.

import { fechaNegocio } from "../fechaNegocio.ts";

export type FuenteVigencia = "actual" | "historial" | "no_encontrada" | "auditoria" | "auditoria_previa";

/** Fila tal como la devuelve `consultar_historial_tarifas`. */
export type VersionTarifa = {
  id: number;
  tarifa_id: number;
  operacion: "UPDATE" | "DELETE";
  motivo: string;
  registrado_en: string;
  autor_email: string | null;
  datos: Record<string, unknown>;
  vigencia: Record<string, unknown>[];
  vigencia_fuente: FuenteVigencia;
  auditoria_id: number | null;
};

export const POR_PAGINA_HISTORIAL = 50;

export type CursorHistorial = { registrado_en: string; id: number };
export type PaginaHistorial = { total: number; filas: VersionTarifa[]; siguiente: CursorHistorial | null };

export type EstadoVersion = "vigente" | "compra_cerrada" | "compra_futura" | "sin_vigencia";

export type ResumenVigencia = {
  estado: EstadoVersion;
  tipo: string | null;
  descuento: string | null;
  prioridad: number | null;
  regimen: string | null;
  viaje: string[];
  compra: string[];
  /** Explica de dónde salió la foto de la vigencia. */
  nota: string | null;
};

export const MOTIVO_HISTORIAL: Record<string, string> = {
  calculadora_generar: "Calculadora · generar",
  calculadora_reemplazar_todo: "Calculadora · reemplazar todas",
  calculadora_sustituir_manual: "Calculadora · sustituir promo manual",
  edicion: "Edición",
  eliminacion: "Eliminación",
  auditoria_previa_203: "Auditoría · antes del historial",
};

export const OPERACION_HISTORIAL: Record<string, string> = { UPDATE: "Modificada", DELETE: "Eliminada" };

const NOTA_FUENTE: Record<FuenteVigencia, string | null> = {
  actual: null,
  historial: "La vigencia ya había sido renombrada o eliminada: se muestra su última versión con ese nombre.",
  no_encontrada: "No hay registro de la vigencia en ese momento.",
  auditoria: "Reconstruida desde la auditoría.",
  auditoria_previa: "Reconstruida desde la auditoría: la vigencia ya había sido renombrada o eliminada.",
};

/** Día de negocio (yyyy-mm-dd, Bogotá) de un instante ISO — regla común
 * `fechaNegocio` (migración 198), la misma que usa la RPC en SQL. */
export function diaBogota(iso: string): string {
  return fechaNegocio(new Date(iso));
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function rangos(v: Record<string, unknown>): string[] {
  const lista = Array.isArray(v.rangos) ? (v.rangos as { fecha_inicio?: unknown; fecha_fin?: unknown }[]) : [];
  const desdeLista = lista
    .filter((r) => texto(r?.fecha_inicio) && texto(r?.fecha_fin))
    .map((r) => `${r.fecha_inicio} → ${r.fecha_fin}`);
  if (desdeLista.length > 0) return desdeLista;
  const ini = texto(v.fecha_inicio);
  const fin = texto(v.fecha_fin);
  return ini || fin ? [`${ini ?? "…"} → ${fin ?? "…"}`] : [];
}

/** Resumen de la vigencia de una versión, con su estado EN LA FECHA DEL
 * CAMBIO (Bogotá): vigente, compra cerrada, compra futura o sin vigencia. Con
 * varias filas de vigencia del mismo nombre, la compra está cerrada solo si
 * todas cerraron (misma regla que `nombreVigenciaVencida`). */
export function resumenVigenciaHistorica(vigencia: Record<string, unknown>[], fuente: FuenteVigencia, registradoEn: string): ResumenVigencia {
  const filas = Array.isArray(vigencia) ? vigencia.filter((v) => v && typeof v === "object") : [];
  const nota = NOTA_FUENTE[fuente] ?? null;
  if (filas.length === 0) {
    return { estado: "sin_vigencia", tipo: null, descuento: null, prioridad: null, regimen: null, viaje: [], compra: [], nota };
  }
  const dia = diaBogota(registradoEn);
  const cerrada = filas.every((v) => !!texto(v.compra_fin) && (v.compra_fin as string) < dia);
  const futura = !cerrada && filas.every((v) => !!texto(v.compra_inicio) && (v.compra_inicio as string) > dia);
  const primera = filas[0];
  const tipo = texto(primera.tipo) ?? "tarifa";
  const valor = primera.descuento_valor;
  const descuento = valor == null || valor === ""
    ? null
    : tipo === "descuento_pct" ? `−${Number(valor)}%` : tipo === "descuento_monto" ? `−${Number(valor)} por pax` : null;
  const compra = [...new Set(filas.map((v) => `${texto(v.compra_inicio) ?? "…"} → ${texto(v.compra_fin) ?? "…"}`))];
  return {
    estado: cerrada ? "compra_cerrada" : futura ? "compra_futura" : "vigente",
    tipo,
    descuento,
    prioridad: primera.prioridad == null ? null : Number(primera.prioridad),
    regimen: texto(primera.regimen_restringido),
    viaje: [...new Set(filas.flatMap(rangos))],
    compra: compra.length === 1 && compra[0] === "… → …" ? [] : compra,
    nota,
  };
}

export const ESTADO_VERSION: Record<EstadoVersion, string> = {
  vigente: "Vigente al cambio",
  compra_cerrada: "Compra cerrada al cambio",
  compra_futura: "Compra aún no abierta",
  sin_vigencia: "Sin vigencia",
};

/** Normaliza la búsqueda antes de enviarla (el servidor escapa % y _). */
export function normalizarBusqueda(q: string): string {
  return q.replace(/\s+/g, " ").trim().slice(0, 80);
}
