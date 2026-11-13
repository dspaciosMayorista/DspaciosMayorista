// Stub de ".../hoteles/[id]/grupos-actions" para las pruebas React (el archivo real es "use server" y termina en
// next/headers). Las pruebas que montan la ficha sin abrir el panel no invocan ninguna acción; si alguna se
// llamara, falla claro. pruebas/gruposDias295.react.ts sustituye estas acciones por dobles propios.
const noImpl = (n) => async () => { throw new Error(`${n}: no implementado en el stub de pruebas`); };
export const leerConfigGrupos = noImpl("leerConfigGrupos");
export const guardarGruposVigencia = noImpl("guardarGruposVigencia");
export const guardarPropuestaGrupos = noImpl("guardarPropuestaGrupos");
export const borrarGrupoDias = noImpl("borrarGrupoDias");
export const guardarCalculoGrupo = noImpl("guardarCalculoGrupo");
// 299 (entrega 3c): venta por grupos.
export const leerAlcanceGrupos = noImpl("leerAlcanceGrupos");
export const aplicarGruposVenta = noImpl("aplicarGruposVenta");
export const descartarBorradorGrupos = noImpl("descartarBorradorGrupos");
export const volverATodosLosDias = noImpl("volverATodosLosDias");
