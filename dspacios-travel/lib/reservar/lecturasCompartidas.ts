// #439 — Lecturas COMPARTIDAS entre las combinaciones de UNA misma cotización de tarjeta.
//
// `cotizarTarjetaHotel` ejecuta `computarReserva` completo por cada combinación categoría×régimen de la salida. Casi todo lo que cada ejecución lee es idéntico para todas
// (paquete, hotel, origen aéreo, temporadas, servicios incluidos, evidencia…): solo la fila publicada y la tarifa del combo cambian. Este memo deja que esas lecturas idénticas
// se hagan UNA vez por llamada. Reglas (cada una tiene su prueba):
//   · Exclusivo de la llamada: `crearLecturasCompartidas()` devuelve un memo nuevo; no hay estado de módulo, así que nunca se comparte entre llamadas, usuarios ni peticiones.
//   · Solo consultas realmente idénticas: la CLAVE la arma quien llama con TODO lo que distingue la lectura (propósito, cliente sb/admin, ids, fechas, categoría, régimen…). Una lectura que
//     depende del combo (fila publicada, tarifa del combo, composición) no se memoiza.
//   · Ningún objeto compartido: cada uso recibe una COPIA PROFUNDA (`structuredClone`) del valor guardado; el original no se entrega nunca. Procesar un combo no puede alterar a otro.
//   · Los errores se conservan: un resultado `{ data, error }` se guarda tal cual (todos los combos ven el mismo error, como sin memo). Una lectura que LANZA no se guarda: se reintenta y relanza.
// Sin memo (undefined), `computarReserva` ejecuta cada lectura como siempre: Reservar y el checkout no cambian.

export type LecturasCompartidas = {
  /** Ejecuta `leer` la primera vez que se pide `clave` y devuelve una copia profunda del resultado a cada solicitante. */
  memo<T>(clave: string, leer: () => PromiseLike<T>): Promise<T>;
  /** Contadores de la llamada (diagnóstico y pruebas): lecturas realmente ejecutadas y reutilizadas. */
  estadisticas(): { ejecutadas: number; reutilizadas: number };
};

export function crearLecturasCompartidas(): LecturasCompartidas {
  const guardadas = new Map<string, Promise<unknown>>();
  let ejecutadas = 0;
  let reutilizadas = 0;
  return {
    async memo<T>(clave: string, leer: () => PromiseLike<T>): Promise<T> {
      if (typeof clave !== "string" || clave === "") throw new Error("LecturasCompartidas.memo: la clave es obligatoria.");
      let p = guardadas.get(clave) as Promise<T> | undefined;
      if (p) reutilizadas++;
      else {
        ejecutadas++;
        p = Promise.resolve(leer()).catch((e) => { guardadas.delete(clave); throw e; }) as Promise<T>;
        guardadas.set(clave, p);
      }
      return structuredClone(await p);
    },
    estadisticas: () => ({ ejecutadas, reutilizadas }),
  };
}

/** Lee con memo si hay, y sin memo ejecuta la lectura tal cual (comportamiento original). */
export async function leerCompartida<T>(lecturas: LecturasCompartidas | undefined, clave: string, leer: () => PromiseLike<T>): Promise<T> {
  return lecturas ? lecturas.memo(clave, leer) : await leer();
}
