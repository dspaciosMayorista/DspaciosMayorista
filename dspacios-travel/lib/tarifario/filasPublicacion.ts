// Payload de las RPC de publicación del tarifario (`publicar_tarifario_resultado` / `_63`): menos bytes por fila, MISMO resultado.
//
// Cada fila viaja como objeto con ~37 claves y varias en null (bloqueo_id, servicio_id, pax_desde, …). El servidor lee cada columna con
// `f.v->>'clave'`, que da NULL tanto para una clave ausente como para un null (y `procedencia_temporadas` ausente o null se trata igual, ver
// la 229/234/254), así que enviar las claves null no aporta nada y sí cuesta: bytes por la red, validación del JSON en PostgREST y el
// texto→jsonb del cuerpo (medido: −22 % de bytes y ≈ −30 % del parseo con 12.669 filas).
//
// Solo quita `null`/`undefined`: conserva 0, false y "" (valores con significado). No muta la entrada. Sin dependencias: se prueba con `node --test`.

export type FilaPublicacion = Record<string, unknown>;

export function compactarFilasPublicacion(filas: readonly object[]): FilaPublicacion[] {
  return filas.map((fila) => {
    const salida: FilaPublicacion = {};
    for (const [clave, valor] of Object.entries(fila)) {
      if (valor !== null && valor !== undefined) salida[clave] = valor;
    }
    return salida;
  });
}
