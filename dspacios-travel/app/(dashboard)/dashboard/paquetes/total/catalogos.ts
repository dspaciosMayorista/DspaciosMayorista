import { createClient } from "@/lib/supabase/server";
import type { EmpaquetadoOpt } from "./PaqueteTotalForm";

/**
 * Catálogos para el montaje. Hoteles: SOLO fichas activas sin vigencias ni tarifas (función `hoteles_vinculables_din`, migración 275);
 * el resto del modo «traer hotel con ficha» no existe — para cualquier otro hotel se usa el hotel manual.
 * Servicios: traen su moneda y el proveedor de su ficha (servicios_adicionales.proveedor_id → proveedores), que NO se vuelve a escribir.
 * Destinos: traen el país (multidestino solo del mismo país). Este listado es una comodidad: la guarda real está en `guardarPaqueteTotal`
 * y en los triggers de la base (275/276).
 */
export async function cargarCatalogos() {
  const sb = await createClient();
  const [d, h, s, e] = await Promise.all([
    sb.from("destinos").select("id, nombre, pais").order("nombre"),
    sb.rpc("hoteles_vinculables_din" as never) as unknown as Promise<{ data: { id: number; nombre: string; destino_id: number | null; moneda: string | null }[] | null }>,
    sb.from("servicios_adicionales").select("id, nombre, destino_id, moneda, proveedor_id").order("nombre"),
    sb.from("empaquetados").select("id, aerolinea, ruta, fecha_ida, fecha_regreso, destino_id, tarifa_proveedor, fee_infante").eq("activo", true).order("fecha_ida", { ascending: false }).limit(300),
  ]);
  const sv = (s.data ?? []) as { id: number; nombre: string; destino_id: number | null; moneda: string | null; proveedor_id: number | null }[];
  const pids = [...new Set(sv.map((x) => x.proveedor_id).filter((x): x is number => x != null))];
  const pn: Record<number, string> = {};
  if (pids.length) for (const p of (await sb.from("proveedores").select("id, nombre").in("id", pids)).data ?? []) pn[p.id] = p.nombre;
  return {
    destinos: (d.data ?? []) as { id: number; nombre: string; pais: string | null }[],
    hoteles: (h.data ?? []).map((x) => ({ ...x, moneda: x.moneda ?? "COP" })),
    servicios: sv.map((x) => ({ id: x.id, nombre: x.nombre, destino_id: x.destino_id, moneda: x.moneda ?? "COP", proveedorId: x.proveedor_id, proveedor: x.proveedor_id != null ? (pn[x.proveedor_id] ?? "") : "" })),
    empaquetados: (e.data ?? []) as EmpaquetadoOpt[],
  };
}
