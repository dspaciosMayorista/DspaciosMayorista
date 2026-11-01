// Stub de "producto/servicios/actions" para pruebas React (el real es "use server" y termina en next/headers).
const ok = async () => ({ ok: true });
export const crearServicio = ok, actualizarServicio = ok;
// Configurable: una prueba puede simular el rechazo al eliminar (pruebas/eliminarServicioObligaciones265.react.ts).
let implEliminar = ok;
export function __setEliminarServicio(fn) { implEliminar = fn ?? ok; }
export const eliminarServicio = (...a) => implEliminar(...a);
export const crearTemporadaServicio = ok, actualizarTemporadaServicio = ok, eliminarTemporadaServicio = ok;
export const guardarFranjaServicio = ok, eliminarFranjaServicio = ok, actualizarFotoServicio = ok;

export async function guardarClasificacionServicio() { return { ok: true }; }
export async function guardarPreciosAlcanceVigencia() { return { ok: true }; }
