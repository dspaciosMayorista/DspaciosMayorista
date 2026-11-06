// Stub de "app/(dashboard)/dashboard/usuarios/actions" para las pruebas de interacción
// de UsuariosClient / AliadoB2BForm (la real es "use server"). Configurable con __setImpls.
let impls = {};
export function __setImpls(next) { impls = { ...impls, ...next }; }
const faltante = (n) => { throw new Error(`${n}: no implementado en el stub — usa __setImpls`); };
export const crearUsuario = (...a) => (impls.crearUsuario ?? (() => faltante("crearUsuario")))(...a);
export const buscarFichasAliado = (...a) => (impls.buscarFichasAliado ?? (() => faltante("buscarFichasAliado")))(...a);
export const crearAliadoB2B = (...a) => (impls.crearAliadoB2B ?? (() => faltante("crearAliadoB2B")))(...a);
export const actualizarUsuario = (...a) => (impls.actualizarUsuario ?? (() => faltante("actualizarUsuario")))(...a);
