// Reglas PURAS de la pantalla de armado de paquetes (#101): qué pestañas ve cada tipo de paquete, cuál queda activa,
// cómo se rotula el estado del tarifario y cómo se agrupan las tarifas por hotel. Sin React ni servidor: todo se prueba
// con datos. No calcula precios: solo LEE lo que `generarTarifario` ya publicó.
import { hoyISO } from "../calc/paquetes.ts";
import { esAsistenciaMedica } from "../calc/tarifaBasePermanente.ts";

export type TipoPaquete = "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
export type PestanaId = "config" | "vuelos" | "hoteles" | "servicios" | "tarifario";

export const ETIQUETA_PESTANA: Record<PestanaId, string> = {
  config: "Configuración inicial",
  vuelos: "Vuelos",
  hoteles: "Hoteles",
  servicios: "Servicios",
  tarifario: "Tarifario resultado",
};

const ORDEN: PestanaId[] = ["config", "vuelos", "hoteles", "servicios", "tarifario"];

/** Pestañas visibles según el tipo: Vuelos solo donde hay vuelos (Bloqueo: bloqueos negociados; Dinámico: salidas
 *  dinámicas); Hoteles no existe en un paquete de solo Servicios. */
export function pestanasVisibles(tipo: TipoPaquete): PestanaId[] {
  return ORDEN.filter((p) => {
    if (p === "vuelos") return tipo === "bloqueo" || tipo === "dinamico";
    if (p === "hoteles") return tipo !== "servicios";
    return true;
  });
}

/** Valor de `?tab=` → pestaña válida para el tipo; cualquier otra cosa cae en la primera (Configuración). */
export function normalizarPestana(valor: unknown, tipo: TipoPaquete): PestanaId {
  const visibles = pestanasVisibles(tipo);
  return typeof valor === "string" && (visibles as string[]).includes(valor) ? (valor as PestanaId) : "config";
}

export type ClaveEstadoTarifario = "publicado" | "desactualizado" | "fallido";
export type EstadoTarifarioVista = { clave: ClaveEstadoTarifario; etiqueta: string; detalle: string | null; /** Aviso crudo (diagnóstico) para el panel «Ver avisos»; nunca va en el encabezado. */ avisos?: string | null };

/** `armado_paquetes.tarifario_estado` (migración 181) → etiqueta de la pantalla. 'listo' = publicado; 'pendiente' y
 *  'recalculando' = desactualizado (hay que esperar o regenerar); 'fallido' muestra `tarifario_error` si existe. Un
 *  estado desconocido se trata como desactualizado: nunca se afirma "publicado" sin que la base lo diga. */
export function estadoTarifarioVista(estado: string | null | undefined, error: string | null | undefined, publicable?: boolean | null, diagnostico?: string | null): EstadoTarifarioVista {
  const e = (estado ?? "").trim();
  const diag = (diagnostico ?? "").trim() || null;
  const err = (error ?? "").trim() || null;
  if (e === "fallido") return { clave: "fallido", etiqueta: "Fallido", detalle: err ?? "No se pudo generar el tarifario." };
  if (e === "listo") {
    // Migración 256: publicado pero con salidas u opcionales que NO se ofrecen por falta de vigencia confirmada; el diagnóstico dice cuáles.
    if (diag) {
      const sinOferta = /^Sin oferta vendible/.test(diag);
      return { clave: "publicado", etiqueta: sinOferta ? "Publicado sin oferta vendible" : "Publicado con avisos", detalle: publicable === false ? "No visible para los lectores mientras el paquete esté inactivo." : null, avisos: diag };
    }
    return {
      clave: "publicado",
      etiqueta: "Publicado",
      detalle: publicable === false ? "No visible para los lectores mientras el paquete esté inactivo." : null,
    };
  }
  if (e === "recalculando") return { clave: "desactualizado", etiqueta: "Desactualizado", detalle: "Hay una generación en curso." };
  return { clave: "desactualizado", etiqueta: "Desactualizado", detalle: "Cambiaron las fuentes: genera el tarifario de nuevo." };
}

export type FilaTarifa = {
  id: number;
  modulo: string;
  hotel_nombre: string | null;
  acomodacion: string | null;
  precio_pvp: number;
};

/** Precio DOBLE de referencia de un conjunto de filas: el menor PVP > 0 de acomodación `doble` (nunca niño ni infante).
 *  `null` si no hay ninguna fila doble publicada. */
export function precioDobleReferencia(filas: readonly Pick<FilaTarifa, "acomodacion" | "precio_pvp">[]): number | null {
  let min: number | null = null;
  for (const f of filas) {
    if (f.acomodacion !== "doble") continue;
    const p = Number(f.precio_pvp);
    if (!Number.isFinite(p) || p <= 0) continue;
    if (min == null || p < min) min = p;
  }
  return min;
}

export type GrupoHotel<T extends FilaTarifa> = { hotel: string; filas: T[]; dobleDesde: number | null };

/** Agrupa las filas de HOTEL (no las de servicios) por hotel, en orden alfabético estable. */
export function agruparPorHotel<T extends FilaTarifa>(filas: readonly T[]): GrupoHotel<T>[] {
  const mapa = new Map<string, T[]>();
  for (const f of filas) {
    if (f.modulo === "servicios") continue;
    const h = f.hotel_nombre ?? "—";
    const lista = mapa.get(h);
    if (lista) lista.push(f);
    else mapa.set(h, [f]);
  }
  return [...mapa.entries()]
    // Alfabético; el grupo sin nombre de hotel ("—") siempre al final.
    .sort(([a], [b]) => (a === "—" ? 1 : 0) - (b === "—" ? 1 : 0) || a.localeCompare(b, "es"))
    .map(([hotel, lista]) => ({ hotel, filas: lista, dobleDesde: precioDobleReferencia(lista) }));
}

export type VigenciaArmado = { nombre: string; fecha_inicio: string | null; fecha_fin: string | null; precio_persona: number | null };
export type ServicioConVigencias = {
  categoria?: string | null;
  precio_persona?: number | null;
  servicio_temporadas?: readonly VigenciaArmado[] | null;
  servicio_tarifa_pax?: readonly { temporada?: string | null }[] | null;
};

/** Asistencia médica SIN ninguna vigencia y con tarifa base válida (precio por persona o rango GENERAL): se vende en cualquier fecha (ver tarifaBasePermanente.ts). */
export function tarifaBasePermanenteVendible(s: ServicioConVigencias): boolean {
  if (!esAsistenciaMedica(s.categoria) || (s.servicio_temporadas ?? []).length) return false;
  return (s.precio_persona != null && Number(s.precio_persona) >= 0) || (s.servicio_tarifa_pax ?? []).some((g) => (g.temporada ?? "GENERAL") === "GENERAL");
}

/** Vigencias aún no vencidas con fechas completas: las únicas que pueden vender. La tarifa «GENERAL» del servicio NO cuenta. */
export function vigenciasVendibles(s: ServicioConVigencias, hoy: string = hoyISO()): VigenciaArmado[] {
  return (s.servicio_temporadas ?? []).filter((v) => v.fecha_inicio && v.fecha_fin && v.fecha_fin >= hoy);
}

/** Un servicio se puede agregar en bloque solo si tiene una vigencia vendible con precio por persona o con rangos de grupo propios (no GENERAL). */
export function servicioSeleccionable(s: ServicioConVigencias, hoy?: string): boolean {
  if (tarifaBasePermanenteVendible(s)) return true;
  return vigenciasVendibles(s, hoy).some((v) => v.precio_persona != null || (s.servicio_tarifa_pax ?? []).some((g) => g.temporada === v.nombre));
}
