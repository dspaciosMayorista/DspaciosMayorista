import { calcularEdad, formatFechaLarga } from "../utils.ts";

/**
 * Presentación de infantes en los manifiestos de vuelo (detalle de bloqueo y
 * listado global de pasajeros): cada infante debe aparecer como renglón
 * subordinado INMEDIATAMENTE debajo de su adulto responsable — nunca en una
 * tabla o sección aparte. La agrupación es exclusivamente por
 * `responsable_id` (migración 167, FK durable a `contrato_pasajeros.id`),
 * nunca por nombre ni por coincidencia parcial.
 *
 * El obstáculo: `sillas` (de donde sale el manifiesto: silla, estado, vuelo)
 * y `contrato_pasajeros` (de donde sale `responsable_id`) NO tienen un FK
 * entre sí — no existe columna `contrato_pasajero_id` en `sillas` ni
 * `silla_id` en `contrato_pasajeros`. El único par de identificadores
 * DURABLES que ambas tablas comparten para la MISMA persona es su documento
 * (tipo + número) dentro del MISMO contrato — nunca el nombre (que puede
 * escribirse distinto en cada tabla) ni una coincidencia parcial.
 *
 * Por eso resolver "¿cuál silla es la de este responsable?" es un emparejamiento
 * en dos pasos, no una FK directa:
 *   1) `responsable_id` → fila del adulto en `contrato_pasajeros` (id, tipo_id,
 *      identificacion) — HECHO en `lib/vuelos/contratoManual.ts`, con el
 *      mismo cliente admin ya autorizado (cross-tenant intacto, ver PR #289).
 *   2) Esa fila del adulto → la silla de ESTE manifiesto cuyo documento
 *      coincide EXACTO (tipo + número, normalizado solo por mayúsculas/
 *      espacios — nunca parcial) dentro del MISMO contrato efectivo del
 *      infante. Si no hay exactamente una silla candidata (ninguna, o más de
 *      una por datos duplicados), el infante NO se asocia — fail-closed,
 *      pasa a la lista `sinResponsable` para la advertencia compacta.
 */

/** Documento de una silla del manifiesto, tal como lo necesita el emparejamiento. */
export type SillaDocumento = {
  /** Identificador de la fila a la que se subordina el infante (silla.id, o la clave sintética de la fila en listados que no exponen sillaId numérico). */
  id: number;
  tipoDoc: string | null;
  numeroDoc: string | null;
  /** Contrato EFECTIVO de la silla: orgánico (`numero_contrato`) o el resuelto desde `contrato_manual` (ver lib/vuelos/contratoManual.ts). */
  contratoEfectivo: string | null;
};

/** Infante con su responsable ya resuelto (ver `resolverManifiestoAutorizado`). */
export type InfanteConResponsable = {
  id: number;
  nombre: string;
  tipoId: string | null;
  identificacion: string | null;
  numeroContrato: string;
  fechaNacimiento: string | null;
  responsable: { id: number; tipoId: string | null; identificacion: string | null } | null;
};

export type ManifiestoInfantesAgrupado = {
  /** Infantes agrupados por el `id` de la silla de su responsable, en el orden recibido (varios infantes del mismo responsable quedan consecutivos). */
  infantesPorSillaId: Map<number, InfanteConResponsable[]>;
  /** Infantes cuyo responsable no se pudo ubicar en ESTE manifiesto — nunca se asocian arbitrariamente. */
  sinResponsable: InfanteConResponsable[];
};

/** Recorta y pasa a mayúsculas; cadena vacía (o solo espacios) se trata como ausente — nunca se usa para "hacer match" de un documento en blanco. */
function normalizarDocumento(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

/**
 * Emparejamiento puro y determinista, exclusivamente por `responsable_id` →
 * documento del responsable → documento+contrato de la silla. Nunca por
 * nombre. Fail-closed: sin responsable resuelto, documento en blanco, o más
 * de una silla candidata (ambigüedad) → el infante va a `sinResponsable`, no
 * se adivina ni se asocia al primero que aparezca.
 */
export function emparejarInfantesConSilla(
  sillas: readonly SillaDocumento[],
  infantes: readonly InfanteConResponsable[]
): ManifiestoInfantesAgrupado {
  const infantesPorSillaId = new Map<number, InfanteConResponsable[]>();
  const sinResponsable: InfanteConResponsable[] = [];

  for (const inf of infantes) {
    const tipoResp = normalizarDocumento(inf.responsable?.tipoId);
    const idResp = normalizarDocumento(inf.responsable?.identificacion);
    if (!inf.responsable || !tipoResp || !idResp) {
      sinResponsable.push(inf);
      continue;
    }

    const candidatas = sillas.filter(
      (s) =>
        s.contratoEfectivo === inf.numeroContrato &&
        normalizarDocumento(s.tipoDoc) === tipoResp &&
        normalizarDocumento(s.numeroDoc) === idResp
    );

    if (candidatas.length !== 1) {
      // 0 candidatas: el responsable no viaja en este manifiesto (otro
      // bloqueo, sin silla, etc.). ≥2: documento duplicado — ambigüedad
      // real, no se adivina cuál es la silla correcta.
      sinResponsable.push(inf);
      continue;
    }

    const sillaId = candidatas[0].id;
    const arr = infantesPorSillaId.get(sillaId);
    if (arr) arr.push(inf);
    else infantesPorSillaId.set(sillaId, [inf]);
  }

  return { infantesPorSillaId, sinResponsable };
}

/**
 * "2 años (nac. 12 de marzo de 2024)" o, sin fecha de referencia calculable,
 * solo la fecha de nacimiento. Pura — reutiliza `calcularEdad`/
 * `formatFechaLarga` (lib/utils.ts), mismas reglas que el resto del sistema.
 */
export function descripcionEdadInfante(
  fechaNacimiento: string | null,
  fechaReferencia: string | null
): string {
  if (!fechaNacimiento) return "sin fecha de nacimiento";
  const fecha = formatFechaLarga(fechaNacimiento);
  const edad = calcularEdad(fechaNacimiento, fechaReferencia);
  if (edad == null) return `nac. ${fecha}`;
  return `${edad} ${edad === 1 ? "año" : "años"} (nac. ${fecha})`;
}
