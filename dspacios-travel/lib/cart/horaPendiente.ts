// Un traslado cuyo precio depende de una hora aún desconocida (suplemento por franja) NO se puede vender: ni entrar al carrito, ni pasar a checkout,
// ni cotizarse. `referencial` lo marcaba el carrito antiguo; hoy ya no se agrega, pero un carrito guardado en el navegador puede traerlo.
export const MENSAJE_HORA_PENDIENTE =
  "Un traslado depende de la hora de llegada o salida, que aún no se conoce. Indica la hora en «Receptivos» o quítalo para continuar.";

export const tieneHoraPendiente = (i: { tipo: string; referencial?: boolean }): boolean => i.tipo === "tour" && i.referencial === true;
export const hayHoraPendiente = (items: readonly { tipo: string; referencial?: boolean }[]): boolean => items.some(tieneHoraPendiente);
