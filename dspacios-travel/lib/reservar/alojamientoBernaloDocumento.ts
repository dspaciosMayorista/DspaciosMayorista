// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-4B — frontera server-side que la migración 176 dejó pendiente:
// `contrato_alojamiento_bernalo` nace con RLS activa y CERO policies (ni
// para roles internos) porque `snapshot` es un dato comercial PRIVADO
// (neto/bruto/comisión/fuente). El documento SÍ necesita mostrar, por
// habitación, datos NO sensibles (hotel, categoría, alimentación, adultos,
// edades de los menores) — esta función es la ÚNICA que lee esa tabla para
// ese propósito, con `createAdminClient()` (bypassa RLS) y un SELECT que
// EXCLUYE explícitamente `snapshot`/`hotel_id`: nunca hay manera de que un
// caller de esta función reciba el snapshot completo.
//
// Regla 19 del encargo ("frontera service-role DESPUÉS de autorizar la
// cotización/contrato"): esta función NO decide si el caller puede ver el
// contrato — eso ya lo resolvió la página que la invoca (RLS de `ventas`/
// `soy_asesor_del_contrato`, o el `share_token` secreto de `/c/[token]`).
// Llamarla fuera de ese contexto expondría los datos de habitación de
// cualquier contrato a cualquiera — nunca se expone como Server Action
// pública ni se importa desde un componente cliente.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";

export type HabitacionBernaloDocumento = {
  habitacionId: string;
  orden: number;
  hotelNombre: string;
  categoria: string | null;
  alimentacion: string | null;
  adultos: number;
  edadesMenores: number[];
};

export type ComposicionBernaloDocumento = {
  habitacionId: string;
  orden: number;
  hotelNombre: string;
  concepto: string;
  cantidad: number;
  valorUnitario: number;
  valorTotal: number;
  periodicidad: "por_noche" | "por_estadia";
};

/**
 * Habitaciones Bernalo de un contrato, SANITIZADAS para mostrar en el
 * documento — nunca `snapshot` (neto/bruto/comisión/fuente) ni `hotel_id`
 * (identidad de catálogo, irrelevante para el cliente). Arreglo vacío para
 * cualquier contrato persona (nunca tuvo filas en esta tabla) — nunca lanza.
 */
export async function habitacionesBernaloDeContrato(numeroContrato: string): Promise<HabitacionBernaloDocumento[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("contrato_alojamiento_bernalo")
    .select("habitacion_id, orden, hotel_nombre, categoria, alimentacion, adultos, edades_menores")
    .eq("numero_contrato", numeroContrato)
    .order("orden");
  return (data ?? []).map((h) => ({
    habitacionId: h.habitacion_id,
    orden: h.orden,
    hotelNombre: h.hotel_nombre,
    categoria: h.categoria,
    alimentacion: h.alimentacion,
    adultos: h.adultos,
    edadesMenores: Array.isArray(h.edades_menores) ? (h.edades_menores as unknown[]).map((e) => Number(e) || 0) : [],
  }));
}
