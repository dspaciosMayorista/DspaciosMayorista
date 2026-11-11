// #43/#60 incremento 2 — Decisión de UN nivel de prioridad para una noche (puro, determinista).
//
// El motor recorre las vigencias aplicables a la noche agrupadas por prioridad (de mayor a
// menor; dentro de una misma prioridad, en el orden de lectura). Para cada nivel decide:
//  - SIN grupos en las candidatas con precio (todo el dato actual): gana la PRIMERA con precio,
//    exactamente como antes (incluido el desempate por orden de lectura, legado conocido).
//  - Dos o más con precio y al menos una con grupos: EMPATE (N4, §3.7) — no se elige ninguna,
//    sin mirar precio, orden, creación ni edición.
//  - Una sola con precio: gana (una con grupos que cubre la noche sin precio no compite, W.3.5).
//  - Ninguna con precio pero un grupo CUBRE la noche sin tarifa para la acomodación: la
//    acomodación no se vende esa noche y NO se baja a otra vigencia (§3.2).
//  - Nada aplicable en el nivel (sin grupos sin precio, o grupos que no cubren el día): se baja.

export type EstadoCandidato = "precio" | "sin_precio" | "no_cubre";

export type CandidatoNivel<T> = {
  valor: T;
  conGrupos: boolean;
  estado: EstadoCandidato;
};

export type DecisionNivel<T> =
  | { tipo: "gana"; candidato: CandidatoNivel<T> }
  | { tipo: "empate"; empatadas: CandidatoNivel<T>[] }
  | { tipo: "no_vende"; candidato: CandidatoNivel<T> }
  | { tipo: "sigue" };

export function decidirNivel<T>(candidatos: readonly CandidatoNivel<T>[]): DecisionNivel<T> {
  const conPrecio = candidatos.filter((c) => c.estado === "precio");
  if (conPrecio.length >= 2 && conPrecio.some((c) => c.conGrupos)) return { tipo: "empate", empatadas: conPrecio };
  if (conPrecio.length >= 1) return { tipo: "gana", candidato: conPrecio[0] };
  const bloquea = candidatos.find((c) => c.conGrupos && c.estado === "sin_precio");
  return bloquea ? { tipo: "no_vende", candidato: bloquea } : { tipo: "sigue" };
}
