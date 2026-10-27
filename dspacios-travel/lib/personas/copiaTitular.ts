// PR #409 — «Copiar datos del cliente/titular» a un pasajero: SOLO UNO por reserva.
// Dos pasajeros con el documento del titular por copia serían la misma persona dos veces. Funciones puras, compartidas por
// todas las superficies que muestran el botón (ReservaForm, ProgramaReservaForm).
import { documentoPasajeroDesdeCliente } from "./tiposDocumento.ts";

export type DatosIdentidad = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string };

/** Qué pasajero recibió la copia y qué tenía antes (para poder deshacer). null = nadie. */
export type CopiaTitular = { indice: number; previo: DatosIdentidad } | null;

/** La marca solo vale mientras el pasajero marcado siga existiendo: si la lista se acorta, deja de bloquear a los demás. */
export function copiaVigente(copia: CopiaTitular, totalPasajeros: number): CopiaTitular {
  return copia && copia.indice < totalPasajeros ? copia : null;
}

/** ¿Está habilitado el botón del pasajero `i`? Sí si nadie tiene la copia, o si la tiene él (para deshacerla). */
export function puedeCopiarTitular(copia: CopiaTitular, i: number): boolean {
  return copia == null || copia.indice === i;
}

/**
 * Copia el cliente al pasajero `i`. Devuelve null (sin cambios) si la copia ya está en OTRO pasajero. Si el tipo de documento del
 * cliente no es admitido como pasajero, se copian los nombres y el documento queda por capturar (no se inventa uno).
 */
export function aplicarCopiaTitular<T extends DatosIdentidad>(
  pax: readonly T[],
  i: number,
  cliente: DatosIdentidad,
  copia: CopiaTitular,
): { pax: T[]; copia: CopiaTitular } | null {
  if (!puedeCopiarTitular(copia, i) || i < 0 || i >= pax.length) return null;
  const actual = pax[i];
  const previo = copia?.indice === i ? copia.previo : { nombres: actual.nombres, apellidos: actual.apellidos, tipoDoc: actual.tipoDoc, numeroDoc: actual.numeroDoc };
  const doc = documentoPasajeroDesdeCliente(cliente.tipoDoc, cliente.numeroDoc);
  return {
    pax: pax.map((p, j) => (j === i ? { ...p, nombres: cliente.nombres, apellidos: cliente.apellidos, ...doc } : p)),
    copia: { indice: i, previo },
  };
}

/** Restaura los datos que tenía el pasajero antes de la copia y libera el botón de los demás. */
export function deshacerCopiaTitular<T extends DatosIdentidad>(pax: readonly T[], copia: CopiaTitular): { pax: T[]; copia: null } {
  if (!copia) return { pax: [...pax], copia: null };
  return { pax: pax.map((p, j) => (j === copia.indice ? { ...p, ...copia.previo } : p)), copia: null };
}
