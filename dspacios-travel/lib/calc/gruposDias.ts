// #43/#60 incremento 2 — Grupos de días de una vigencia (puro, sin lecturas).
//
// Un grupo cubre días de la semana ISO (1 = lunes … 7 = domingo) de UNA vigencia. Solo
// cuentan los grupos ACTIVOS: hoy la base (migración 293) los obliga a estar inactivos,
// así que en producción ninguna vigencia trae grupos y el motor se comporta igual que
// antes. Ver docs/tecnico/vigencias-por-dia-43-60-especificacion.md §3 y el historial AB.

export interface GrupoDias {
  id: string;
  dias: number[];
}

const MS_HORA = 3_600_000;

/** Día de la semana ISO (1 = lunes … 7 = domingo) de la NOCHE cuyo instante es `t0`.
 * `t0` es la medianoche LOCAL de la fecha de la noche (`new Date("yyyy-mm-ddT00:00:00")`
 * más n días de 24 h). Se lee la fecha local de `t0 + 12 h` para que un cambio de hora
 * (±1 h) no mueva la noche al día anterior o siguiente, sea cual sea la zona del servidor. */
export function diaSemanaNoche(t0: number): number {
  const d = new Date(t0 + 12 * MS_HORA).getDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}

/** Fragmento de `select` para recibir los grupos DENTRO de la lectura de `hotel_temporadas`
 * que cada cargador ya hace (relación por la FK de la migración 293): cero solicitudes nuevas.
 * Exige la 293 aplicada antes de desplegar este código (si no, PostgREST rechaza la relación). */
export const SELECT_GRUPOS_VIGENCIA = "hotel_temporada_grupos(id, dias, activo)";

/** Normaliza los grupos incrustados de `hotel_temporadas` (`hotel_temporada_grupos`):
 * solo los ACTIVOS, con días 1–7 enteros. Cualquier forma inesperada se descarta. */
export function gruposActivos(v: unknown): GrupoDias[] {
  if (!Array.isArray(v)) return [];
  const out: GrupoDias[] = [];
  for (const g of v) {
    if (!g || typeof g !== "object") continue;
    const { id, dias, activo } = g as { id?: unknown; dias?: unknown; activo?: unknown };
    if (activo !== true || typeof id !== "string" || !Array.isArray(dias)) continue;
    const ds = dias.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7);
    if (ds.length) out.push({ id, dias: ds });
  }
  return out;
}

/** Grupo que cubre el día de la semana de la noche, o `null` si ninguno la cubre. */
export function grupoQueCubre(grupos: readonly GrupoDias[], t0: number): GrupoDias | null {
  const dia = diaSemanaNoche(t0);
  return grupos.find((g) => g.dias.includes(dia)) ?? null;
}

// Separador de la clave de una tarifa por grupo: carácter de control (US, 0x1F) que no
// aparece en nombres de vigencia; mismo separador que usa `_tarifa_clave` en la base.
const SEP = "\u001f";

/** Clave de `netoPorTemporada` para una fila de `tarifa_hotel`: el nombre de la vigencia
 * (todos los días, todo el dato actual) o nombre + grupo (tarifa de un grupo de días). */
export function claveNeto(temporada: string, grupoId?: string | null): string {
  return grupoId ? `${temporada}${SEP}${grupoId}` : temporada;
}
