import { createClient } from "@/lib/supabase/server";
import type { EmpaquetadoOpt } from "./PaqueteTotalForm";

/**
 * Catálogos para el montaje. Hoteles: SOLO fichas activas sin vigencias ni tarifas (función `hoteles_vinculables_din`, migración 275);
 * el resto del modo «traer hotel con ficha» no existe — para cualquier otro hotel se usa el hotel manual.
 * Este listado es una comodidad: la guarda real está en `guardarPaqueteTotal` y en un trigger de la base.
 */
export async function cargarCatalogos() {
  const sb = await createClient();
  const [d, h, s, e] = await Promise.all([
    sb.from("destinos").select("id, nombre").order("nombre"),
    sb.rpc("hoteles_vinculables_din" as never) as unknown as Promise<{ data: { id: number; nombre: string; destino_id: number | null }[] | null }>,
    sb.from("servicios_adicionales").select("id, nombre, destino_id").order("nombre"),
    sb.from("empaquetados").select("id, aerolinea, ruta, fecha_ida, fecha_regreso, destino_id, tarifa_proveedor, fee_infante").eq("activo", true).order("fecha_ida", { ascending: false }).limit(300),
  ]);
  return {
    destinos: (d.data ?? []) as { id: number; nombre: string }[],
    hoteles: (h.data ?? []) as { id: number; nombre: string; destino_id: number | null }[],
    servicios: (s.data ?? []) as { id: number; nombre: string; destino_id: number | null }[],
    empaquetados: (e.data ?? []) as EmpaquetadoOpt[],
  };
}
