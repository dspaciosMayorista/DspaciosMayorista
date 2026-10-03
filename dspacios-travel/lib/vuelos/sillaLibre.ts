// ¿Una silla de un record está LIBRE de verdad? Función pura.
//
// Libre = estado vendible (`disponible` o `cambio_entrante`), sin contrato
// orgánico (`numero_contrato`), sin contrato manual (`contrato_manual`) y sin
// ningún dato de pasajero. Es el mismo criterio de "silla libre real" del
// diseño de traslado (docs/futuro/traslado-cupos-y-mover-pasajero.md §4.2),
// salvo que aquí "dato de pasajero" usa el predicado que ya usa
// PasajeroAcciones (`sillaTieneDatosDePasajero`: nombres, apellidos, tipo y
// número de documento o nacimiento), que es igual o más estricto.
//
// Criterio conservador: ante la duda, NO es libre. Un `contrato_manual` con
// solo espacios cuenta como presente (la silla no se da por libre hasta
// limpiarlo), igual que en el diseño.
import { sillaTieneDatosDePasajero } from "./infanteVuelo.ts";

export const ESTADOS_SILLA_VENDIBLE: readonly string[] = ["disponible", "cambio_entrante"];

export type SillaParaLibre = {
  estado: string | null;
  numero_contrato: string | null;
  contrato_manual: string | null;
  pasajero_nombres: string | null;
  pasajero_apellidos: string | null;
  tipo_doc: string | null;
  numero_doc: string | null;
  nacimiento: string | null;
  // Resto del grupo D (opcionales para no romper a quien no las lee; la base
  // usa SIEMPRE las 16 columnas, `_silla_con_datos`, migración 194).
  asesor?: string | null;
  hotel?: string | null;
  acomodacion?: string | null;
  plazo?: string | null;
  agencia?: string | null;
  inf_nombres?: string | null;
  inf_apellidos?: string | null;
  inf_tipo_doc?: string | null;
  inf_numero?: string | null;
  inf_nacimiento?: string | null;
  responsable_menor?: string | null;
};

const OTROS_DATOS: readonly (keyof SillaParaLibre)[] = [
  "asesor", "hotel", "acomodacion", "plazo", "agencia",
  "inf_nombres", "inf_apellidos", "inf_tipo_doc", "inf_numero", "inf_nacimiento", "responsable_menor",
];

export function esSillaLibre(s: SillaParaLibre): boolean {
  if (s.estado === null || !ESTADOS_SILLA_VENDIBLE.includes(s.estado)) return false;
  if (s.numero_contrato !== null || s.contrato_manual !== null) return false;
  if (OTROS_DATOS.some((k) => String(s[k] ?? "").trim() !== "")) return false;
  return !sillaTieneDatosDePasajero({
    pasajero_nombres: s.pasajero_nombres ?? "",
    pasajero_apellidos: s.pasajero_apellidos ?? "",
    tipo_doc: s.tipo_doc ?? "",
    numero_doc: s.numero_doc ?? "",
    nacimiento: s.nacimiento ?? "",
  });
}
