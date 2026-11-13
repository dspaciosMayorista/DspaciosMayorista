// Stub de ".../hoteles/[id]/reglas-descuento-actions" para las pruebas React (el archivo real es "use server" y termina en next/headers).
// La prueba de render no invoca ninguna acción; si alguna se llamara, falla claro.
const noImpl = (n) => async () => { throw new Error(`${n}: no implementado en el stub de pruebas`); };
export const guardarReglaDescuento = noImpl("guardarReglaDescuento");
export const alternarReglaDescuento = noImpl("alternarReglaDescuento");
export const eliminarReglaDescuento = noImpl("eliminarReglaDescuento");
// #43/#60 entrega 5 (301): reglas retenidas.
export const aplicarReglaRetenida = noImpl("aplicarReglaRetenida");
export const descartarReglaRetenida = noImpl("descartarReglaRetenida");
