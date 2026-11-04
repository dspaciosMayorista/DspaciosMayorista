import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cargarCatalogoHotel, cargarFichasServicio, cargarOpcionesHotelFicha, cargarReglasHoteles } from "@/lib/paqueteDinamico/fichas";
import { explicarEdades } from "@/lib/paqueteDinamico/menores";
import { cobraInfante, resumenFicha } from "@/lib/paqueteDinamico/servicioFicha";
import type { FilaHotelDin } from "@/lib/paqueteDinamico/modelo";
import type { EmpaquetadoOpt } from "./PaqueteTotalForm";

/**
 * Catálogos para el montaje. Hoteles: SOLO fichas activas sin vigencias ni tarifas (función `hoteles_vinculables_din`, migración 275);
 * el resto del modo «traer hotel con ficha» no existe — para cualquier otro hotel se usa el hotel manual.
 * Un hotel vinculado trae de su ficha las categorías, los regímenes y las reglas de menores (no se piden otra vez); el manual usa el catálogo general
 * de categorías de habitación y planes de alimentación, igual que los hoteles normales.
 * Servicios: traen su moneda, el proveedor de su ficha y el resumen de su cobro (por persona / por grupo con su rango de pasajeros).
 * Destinos: traen el país (multidestino solo del mismo país). Este listado es una comodidad: la guarda real está en `guardarPaqueteTotal`
 * y en los triggers de la base (275/276/277).
 */
export async function cargarCatalogos() {
  const sb = await createClient();
  const admin = createAdminClient();
  const [d, h, s, e] = await Promise.all([
    sb.from("destinos").select("id, nombre, pais").order("nombre"),
    sb.rpc("hoteles_vinculables_din" as never) as unknown as Promise<{ data: { id: number; nombre: string; destino_id: number | null; moneda: string | null }[] | null }>,
    sb.from("servicios_adicionales").select("id, nombre, destino_id, moneda, proveedor_id").order("nombre"),
    sb.from("empaquetados").select("id, aerolinea, ruta, fecha_ida, fecha_regreso, destino_id, tarifa_proveedor, fee_infante").eq("activo", true).order("fecha_ida", { ascending: false }).limit(300),
  ]);
  const hotelesFicha = h.data ?? [];
  const sv = (s.data ?? []) as { id: number; nombre: string; destino_id: number | null; moneda: string | null; proveedor_id: number | null }[];
  const pids = [...new Set(sv.map((x) => x.proveedor_id).filter((x): x is number => x != null))];
  const pn: Record<number, string> = {};
  if (pids.length) for (const p of (await sb.from("proveedores").select("id, nombre").in("id", pids)).data ?? []) pn[p.id] = p.nombre;

  const [catalogo, opciones, reglas, fichas] = await Promise.all([
    cargarCatalogoHotel(admin),
    cargarOpcionesHotelFicha(admin, hotelesFicha.map((x) => x.id)),
    cargarReglasHoteles(admin, hotelesFicha.map((x) => ({ id: x.id, hotel_id: x.id }) as FilaHotelDin)),
    cargarFichasServicio(admin, sv.map((x) => x.id)),
  ]);
  return {
    destinos: (d.data ?? []) as { id: number; nombre: string; pais: string | null }[],
    hoteles: hotelesFicha.map((x) => ({
      ...x, moneda: x.moneda ?? "COP",
      categorias: opciones.get(x.id)?.categorias ?? [], regimenes: opciones.get(x.id)?.regimenes ?? [],
      reglasTexto: reglas.get(x.id) ? explicarEdades(reglas.get(x.id) ?? null).edades : null,
    })),
    servicios: sv.map((x) => ({
      id: x.id, nombre: x.nombre, destino_id: x.destino_id, moneda: x.moneda ?? "COP", proveedorId: x.proveedor_id, proveedor: x.proveedor_id != null ? (pn[x.proveedor_id] ?? "") : "",
      cobro: fichas.get(x.id) ? resumenFicha(fichas.get(x.id)!).texto : null, noSoportado: fichas.get(x.id)?.noSoportado ?? null,
      modo: fichas.get(x.id)?.modo ?? null, cobraInfante: fichas.get(x.id) ? cobraInfante(fichas.get(x.id)!) : false,
    })),
    empaquetados: (e.data ?? []) as EmpaquetadoOpt[],
    catalogoHotel: catalogo,
  };
}
