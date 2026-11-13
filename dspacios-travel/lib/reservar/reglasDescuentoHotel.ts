// #90 — Lectura de las reglas EBB / Long Stay de un hotel (servidor). Falla CERRADO sin excepciones: si no se pueden consultar (error, tabla ausente),
// cotizar o convertir seguiría a precio base mostrando un valor y cobrando otro. La migración 278 va ANTES que el código.

import type { ReglaDescuentoHotel } from "../calc/descuentoHotel.ts";

/** #43/#60 entrega 5 (301): solo las reglas autorizadas (una fila sin la columna, anterior a la 301, cuenta como autorizada). */
export const soloAutorizadas = (filas: unknown): ReglaDescuentoHotel[] =>
  ((filas ?? []) as (ReglaDescuentoHotel & { autorizada?: boolean | null })[]).filter((r) => r.autorizada !== false);

type Cliente = { from: (t: string) => any };

export async function cargarReglasDescuentoHotel(admin: unknown, hotelId: number): Promise<{ ok: true; reglas: ReglaDescuentoHotel[] } | { ok: false; detalle: string }> {
  const { data, error } = await (admin as Cliente).from("hotel_reglas_descuento").select("tipo, umbral, pct, activa, autorizada").eq("hotel_id", hotelId).eq("activa", true);
  if (error) return { ok: false, detalle: String(error.message ?? error.code ?? "error") };
  // 301: una regla RETENIDA (autorizada = false) no se vende hasta aplicarla; un cambio retenido vive en `propuesta`, no en la fila.
  return { ok: true, reglas: soloAutorizadas(data) };
}
