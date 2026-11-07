// Stub de "@/lib/avisos/actions" para las pruebas que montan la campana (PortalShell, layout del dashboard, pruebas/campanaAvisos86.react.ts):
// la acción real arrastra next/headers (no resoluble aquí). Por defecto no devuelve nada; una prueba puede enchufar un «servidor» con __setServidor.
let servidor = null;
export function __setServidor(impl) { servidor = impl; }
export async function sondearAvisos(reclamar) { return servidor ? servidor.sondear(reclamar) : { nuevos: [], noLeidos: 0, recientes: [] }; }
export async function marcarAvisosLeidos(ids) { return servidor ? servidor.marcar(ids) : { ok: true }; }
