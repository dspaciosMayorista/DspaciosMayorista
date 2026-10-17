// Stub de ../listas-actions para la prueba de interacción de ListaDestinoProgramas
// (pruebas/programaDestinoFijo.interaccion.react.ts). Registra las llamadas y deja
// que cada prueba decida la respuesta.
export const __llamadas = [];
let impls = {};
export function __setImpls(i) { impls = i; }
export function __reset() { __llamadas.length = 0; impls = {}; }
const resp = async (nombre, args) => {
  __llamadas.push([nombre, ...args]);
  return impls[nombre] ? impls[nombre](...args) : { ok: true };
};
export const crearDestinoFijo = (n) => resp("crear", [n]);
export const crearDestinoProvisional = () => resp("crearProvisional", []);
export const renombrarDestinoFijo = (id, n) => resp("renombrar", [id, n]);
export const eliminarDestinoFijo = (id) => resp("eliminar", [id]);
