// ─────────────────────────────────────────────────────────────────────────
// Lectura SERVIDOR de la clasificación del receptivo y de los precios propios por alcance (migración 262, provisional) para el contexto de liquidación.
// Toca la base (cliente admin del llamador); las reglas viven en lib/calc/servicioAlcance.ts y la fórmula en lib/reservar/liquidacionServicio.ts.
// TOLERANTE: si la 262 no está aplicada (columna/tabla inexistente) responde `disponible: false` y todo se comporta como antes; cualquier OTRO error de lectura
// se devuelve como fallo (nunca se sigue con datos parciales: un traslado sin sus precios no puede venderse con otra tarifa).
// ─────────────────────────────────────────────────────────────────────────
import type { FilaClasificacionServicio, FilaPrecioAlcanceBD } from "@/lib/reservar/liquidacionServicio";
import type { AlcanceCombo, TipoReceptivo } from "@/lib/calc/servicioAlcance";

type Err = { code?: string; message?: string } | null;
type Cliente = { from: (tabla: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const faltaEsquema = (e: Err) => e?.code === "42P01" || e?.code === "42703" || e?.code === "PGRST204" || e?.code === "PGRST205";

export const MENSAJE_TRASLADO_POR_ALCANCE_SOLO_CARRITO =
  "Los traslados que se venden por trayecto (llegada, salida o ida y regreso) no se reservan por esta ruta: cotízalos desde el carrito eligiendo el alcance.";

/** Un traslado por alcance no puede ir INCLUIDO en el hotel (su precio depende del trayecto vendido): se dice al marcarlo, al generar el tarifario y al reservar. */
export const mensajeTrasladoIncluido = (nombre: string): string =>
  `El servicio «${nombre}» es un traslado que se vende por trayecto (llegada, salida o ida y regreso) y no puede ir incluido en el hotel. Márcalo como opcional: el cliente elige el alcance al agregarlo al carrito.`;
export const MENSAJE_TRASLADOS_SOLO_CARRITO_PANTALLA =
  "Los traslados que se venden por trayecto (llegada, salida o ida y regreso) no se agregan aquí: se eligen desde el carrito, con el alcance que corresponda.";

/**
 * Ids, entre `servicioIds`, de los servicios CLASIFICADOS como traslado (262). Las rutas que cotizan o cobran un servicio SIN alcance (la reserva interna y la oferta #63, que
 * leen precio_persona / rangos de la tarifa clásica) deben rechazarlos: venderían un traslado por alcance con una tarifa que no le corresponde. Sin la 262 aplicada: ninguno.
 */
export async function trasladosPorAlcance(admin: Cliente, servicioIds: readonly number[]): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  const lec = await leerAlcanceDeServicios(admin, [...new Set(servicioIds)], []);
  if (!lec.ok) return { ok: false, error: lec.error };
  if (!lec.disponible) return { ok: true, ids: [] };
  return { ok: true, ids: lec.clasificaciones.filter((c) => c.tipo_receptivo === "traslado").map((c) => c.servicio_id) };
}

export type LecturaAlcance =
  | { ok: true; disponible: false }
  | { ok: true; disponible: true; clasificaciones: FilaClasificacionServicio[]; preciosAlcance: FilaPrecioAlcanceBD[] }
  | { ok: false; error: string };

/** `temporadaIds`: vigencias ya consultadas de esos servicios (los precios por alcance solo cuentan para ellas). */
export async function leerAlcanceDeServicios(admin: Cliente, servicioIds: readonly number[], temporadaIds: readonly number[]): Promise<LecturaAlcance> {
  if (!servicioIds.length) return { ok: true, disponible: true, clasificaciones: [], preciosAlcance: [] };
  const c = await admin.from("servicios_adicionales").select("id, tipo_receptivo, combo_incluye_traslado, combo_traslado_alcance").in("id", [...servicioIds]);
  if (c.error) return faltaEsquema(c.error) ? { ok: true, disponible: false } : { ok: false, error: `servicios_adicionales(262): ${c.error.message ?? c.error.code}` };
  const clasificaciones = ((c.data ?? []) as Array<Record<string, unknown>>).map((r): FilaClasificacionServicio => ({
    servicio_id: Number(r.id),
    tipo_receptivo: (r.tipo_receptivo ?? null) as TipoReceptivo | null,
    combo_incluye_traslado: (r.combo_incluye_traslado ?? null) as boolean | null,
    combo_traslado_alcance: (r.combo_traslado_alcance ?? null) as AlcanceCombo | null,
  }));
  let preciosAlcance: FilaPrecioAlcanceBD[] = [];
  // Los precios por alcance solo los usa un traslado clasificado: sin ninguno no se consulta la tabla (menos lecturas y los servicios ya vendidos no dependen de ella).
  if (temporadaIds.length && clasificaciones.some((c) => c.tipo_receptivo === "traslado")) {
    const p = await admin.from("servicio_precio_alcance").select("servicio_temporada_id, alcance, pax_desde, pax_hasta, precio").in("servicio_temporada_id", [...temporadaIds]);
    if (p.error) return faltaEsquema(p.error) ? { ok: true, disponible: false } : { ok: false, error: `servicio_precio_alcance: ${p.error.message ?? p.error.code}` };
    preciosAlcance = ((p.data ?? []) as Array<Record<string, unknown>>).map((r): FilaPrecioAlcanceBD => ({
      servicio_temporada_id: Number(r.servicio_temporada_id), alcance: r.alcance as FilaPrecioAlcanceBD["alcance"],
      pax_desde: r.pax_desde == null ? null : Number(r.pax_desde), pax_hasta: r.pax_hasta == null ? null : Number(r.pax_hasta), precio: Number(r.precio),
    }));
  }
  return { ok: true, disponible: true, clasificaciones, preciosAlcance };
}
