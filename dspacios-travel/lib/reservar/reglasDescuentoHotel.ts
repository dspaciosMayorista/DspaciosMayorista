// #90 — Lectura de las reglas EBB / Long Stay de un hotel (servidor). Falla CERRADO sin excepciones: si no se pueden consultar (error, tabla ausente),
// cotizar o convertir seguiría a precio base mostrando un valor y cobrando otro. La migración 278 va ANTES que el código.

import type { ReglaDescuentoHotel } from "../calc/descuentoHotel.ts";

type Cliente = { from: (t: string) => any };

export async function cargarReglasDescuentoHotel(admin: unknown, hotelId: number): Promise<{ ok: true; reglas: ReglaDescuentoHotel[] } | { ok: false; detalle: string }> {
  const { data, error } = await (admin as Cliente).from("hotel_reglas_descuento").select("tipo, umbral, pct, activa").eq("hotel_id", hotelId).eq("activa", true);
  if (error) return { ok: false, detalle: String(error.message ?? error.code ?? "error") };
  return { ok: true, reglas: (data ?? []) as ReglaDescuentoHotel[] };
}
