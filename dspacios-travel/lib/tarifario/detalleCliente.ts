// Caché + dedup, en memoria del navegador, para el detalle bajo demanda del
// tarifario (Tier 2 de la carga en dos niveles — ver app/tarifario/
// detalle-actions.ts). Vive a nivel de MÓDULO (no de componente): sobrevive
// mientras la pestaña siga abierta y se reinicia solo con una recarga
// completa de página — exactamente "durante esa visita", ni más ni menos.
//
// Dos garantías, ambas pedidas explícitamente:
//   · "Impedir solicitudes duplicadas mientras una misma combinación está
//     cargando" — si el usuario abre el mismo hotel dos veces seguidas (o
//     dos pestañas del tarifario piden el mismo detalle casi a la vez), la
//     SEGUNDA llamada reutiliza la promesa en vuelo de la primera en vez de
//     disparar una consulta nueva.
//   · "Poder reutilizar en memoria un detalle ya solicitado" — un detalle
//     que ya resolvió con éxito se sirve instantáneo la próxima vez, sin
//     volver a pedirlo al servidor.
//
// Un resultado con ERROR (`ok:false`) o una promesa que se RECHAZA nunca se
// cachea — un fallo transitorio no debe "pegarse" para el resto de la
// visita; cerrar y volver a abrir el mismo hotel reintenta la consulta.
export type EstadoDetalle<T> =
  | { estado: "cargando" }
  | { estado: "ok"; filas: T[] }
  | { estado: "error"; mensaje: string };

type ResultadoAccion<T> = { ok: true; filas: T[] } | { ok: false; error: string };

const enVuelo = new Map<string, Promise<ResultadoAccion<unknown>>>();

export function conCacheDetalle<T>(clave: string, cargar: () => Promise<ResultadoAccion<T>>): Promise<ResultadoAccion<T>> {
  const existente = enVuelo.get(clave);
  if (existente) return existente as Promise<ResultadoAccion<T>>;
  const p = cargar()
    .then((r) => {
      if (!r.ok) enVuelo.delete(clave);
      return r as ResultadoAccion<unknown>;
    })
    .catch((e) => {
      enVuelo.delete(clave);
      throw e;
    });
  enVuelo.set(clave, p);
  return p as Promise<ResultadoAccion<T>>;
}
