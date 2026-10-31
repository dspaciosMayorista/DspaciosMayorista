// ─────────────────────────────────────────────────────────────────────────
// Lectura y escritura de la clasificación del receptivo y de los precios por trayecto (migración 262, PROVISIONAL, no aplicada). Recibe el cliente de
// Supabase por parámetro (sin importar el servidor) para probarse con un doble. TOLERANTE: si la 262 no está aplicada (tabla 42P01 o columna 42703) lee
// como «no disponible» y escribe con un mensaje claro; nunca inventa datos ni falla en silencio. Las reglas viven en lib/calc/servicioAlcance.ts.
// Import relativo con extensión (se importa directo desde `node --test`).
// ─────────────────────────────────────────────────────────────────────────
import { validarClasificacion, validarPreciosAlcance, type AlcanceCombo, type ClasificacionServicio, type FilaPrecioAlcance, type TipoReceptivo } from "../calc/servicioAlcance.ts";

export const MENSAJE_262_NO_APLICADA = "El tipo de receptivo y los precios por trayecto todavía no están habilitados en la base de datos (falta aplicar la migración 262).";

type Err = { code?: string; message?: string } | null;
type Cliente = { from: (tabla: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const faltaEsquema = (e: Err) => e?.code === "42P01" || e?.code === "42703" || e?.code === "PGRST204" || e?.code === "PGRST205";

export type ResultadoLectura<T> = { ok: true; disponible: true; datos: T } | { ok: true; disponible: false } | { ok: false; error: string };
export type Resultado = { ok: true } | { ok: false; error: string };

export async function leerClasificacion(sb: Cliente, servicioId: number): Promise<ResultadoLectura<ClasificacionServicio>> {
  const { data, error } = await sb.from("servicios_adicionales").select("tipo_receptivo, combo_incluye_traslado, combo_traslado_alcance").eq("id", servicioId).maybeSingle();
  if (error) return faltaEsquema(error) ? { ok: true, disponible: false } : { ok: false, error: "No se pudo leer el tipo de receptivo." };
  if (!data) return { ok: false, error: "Servicio no encontrado." };
  return { ok: true, disponible: true, datos: {
    tipo_receptivo: (data.tipo_receptivo ?? null) as TipoReceptivo | null,
    combo_incluye_traslado: data.combo_incluye_traslado ?? null,
    combo_traslado_alcance: (data.combo_traslado_alcance ?? null) as AlcanceCombo | null,
  } };
}

/** Guarda tipo y combo. Un tipo distinto de combo limpia los campos del combo (el CHECK de la base los exige nulos). */
export async function guardarClasificacion(sb: Cliente, servicioId: number, c: ClasificacionServicio): Promise<Resultado> {
  const errores = validarClasificacion(c);
  if (errores.length) return { ok: false, error: errores[0] };
  const esCombo = c.tipo_receptivo === "combo";
  const fila = {
    tipo_receptivo: c.tipo_receptivo ?? null,
    combo_incluye_traslado: esCombo ? (c.combo_incluye_traslado ?? null) : null,
    combo_traslado_alcance: esCombo && c.combo_incluye_traslado ? (c.combo_traslado_alcance ?? null) : null,
  };
  const { error } = await sb.from("servicios_adicionales").update(fila).eq("id", servicioId);
  if (error) return { ok: false, error: faltaEsquema(error) ? MENSAJE_262_NO_APLICADA : error.code === "23514" ? "La clasificación no cumple las reglas del combo." : "No se pudo guardar el tipo de receptivo." };
  return { ok: true };
}

export type PrecioAlcanceFila = FilaPrecioAlcance & { id?: number };

export async function leerPreciosAlcance(sb: Cliente, temporadaId: number): Promise<ResultadoLectura<PrecioAlcanceFila[]>> {
  const { data, error } = await sb.from("servicio_precio_alcance").select("id, alcance, pax_desde, pax_hasta, precio").eq("servicio_temporada_id", temporadaId).order("alcance").order("pax_desde", { nullsFirst: true });
  if (error) return faltaEsquema(error) ? { ok: true, disponible: false } : { ok: false, error: "No se pudieron leer los precios por trayecto." };
  return { ok: true, disponible: true, datos: ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: Number(f.id), alcance: f.alcance as FilaPrecioAlcance["alcance"],
    pax_desde: f.pax_desde == null ? null : Number(f.pax_desde), pax_hasta: f.pax_hasta == null ? null : Number(f.pax_hasta), precio: Number(f.precio),
  })) };
}

/**
 * Reemplaza TODOS los precios por trayecto de una vigencia por `filas` en UNA transacción (RPC `reemplazar_precios_alcance`, migración 263 provisional):
 * si cualquier fila falla, la configuración anterior queda íntegra. Cada alcance lleva SU precio; nada se deriva de otro. Valida antes con las mismas reglas
 * puras (mensajes claros) y la base repite las comprobaciones. Sin la RPC (263 no aplicada) no escribe nada.
 */
export async function reemplazarPreciosAlcance(sb: Cliente & { rpc: (fn: string, args: unknown) => any }, temporadaId: number, filas: readonly FilaPrecioAlcance[]): Promise<Resultado> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errores = validarPreciosAlcance(filas);
  if (errores.length) return { ok: false, error: errores[0] };
  const payload = filas.map((f) => ({ alcance: f.alcance, pax_desde: f.pax_desde ?? null, pax_hasta: f.pax_hasta ?? null, precio: f.precio }));
  const { error } = await sb.rpc("reemplazar_precios_alcance", { p_temporada_id: temporadaId, p_filas: payload });
  if (!error) return { ok: true };
  if (error.code === "42883" || error.code === "PGRST202" || faltaEsquema(error)) return { ok: false, error: MENSAJE_262_NO_APLICADA };
  if (error.code === "23P01") return { ok: false, error: error.message ?? "Dos rangos de pasajeros se cruzan." };
  if (error.code === "22023" || error.code === "P0002") return { ok: false, error: error.message ?? "Los precios no son válidos." };
  return { ok: false, error: "No se pudieron guardar los precios por trayecto; se conservaron los anteriores." };
}
