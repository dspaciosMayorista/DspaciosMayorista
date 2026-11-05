import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cargarCatalogoHotel, cargarFichasServicio, cargarInfoHotelesFicha, cargarOpcionesHotelFicha, cargarReglasHoteles } from "@/lib/paqueteDinamico/fichas";
import { explicarEdades } from "@/lib/paqueteDinamico/menores";
import { cobraInfante, resumenFicha } from "@/lib/paqueteDinamico/servicioFicha";
import type { FilaHotelDin } from "@/lib/paqueteDinamico/modelo";
import type { EmpaquetadoOpt } from "./PaqueteTotalForm";

/**
 * Catálogos para el montaje. Hoteles: TODAS las fichas activas del catálogo (función `hoteles_vinculables_din`; desde la 280 tener tarifario, vigencias o calculadora no las excluye ni cuenta la moneda);
 * la ficha aporta solo información general (nombre, estrellas, descripción, ubicación, reglas de menores): las tarifas son SIEMPRE las del paquete.
 * Un hotel vinculado trae de su ficha las categorías, los regímenes y las reglas de menores (no se piden otra vez); el manual usa el catálogo general
 * de categorías de habitación y planes de alimentación, igual que los hoteles normales.
 * Servicios: traen su moneda, el proveedor de su ficha y el resumen de su cobro (por persona / por grupo con su rango de pasajeros).
 * Destinos: traen el país (multidestino solo del mismo país). Este listado es una comodidad: la guarda real está en `guardarPaqueteTotal`
 * y en los triggers de la base (275/276/277).
 */
/** PostgREST corta cada respuesta en «max rows» SIN error: se lee por páginas hasta recibir una incompleta. */
async function leerPaginado<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>, tam = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await pagina(desde, desde + tam - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < tam) return out;
  }
}
/** Las lecturas `.in("id", …)` sobre todo el catálogo van en lotes: una lista enorme revienta la URL y las filas hijas (acomodaciones, categorías) pasan el tope de filas. */
async function enLotes<V>(ids: number[], fn: (lote: number[]) => Promise<Map<number, V>>, tam = 40): Promise<Map<number, V>> {
  const out = new Map<number, V>();
  for (let i = 0; i < ids.length; i += tam) for (const [k, v] of await fn(ids.slice(i, i + tam))) out.set(k, v);
  return out;
}

export async function cargarCatalogos() {
  const sb = await createClient();
  const admin = createAdminClient();
  const [d, h, s, e, activas] = await Promise.all([
    sb.from("destinos").select("id, nombre, pais").order("nombre"),
    // Todas las fichas activas (migración 280), por páginas: el tope de filas de PostgREST no puede recortar el selector en silencio.
    leerPaginado<{ id: number; nombre: string; destino_id: number | null; moneda: string | null }>((a, b) => (sb.rpc("hoteles_vinculables_din" as never) as unknown as { range: (a: number, b: number) => PromiseLike<{ data: never; error: { message: string } | null }> }).range(a, b) as never),
    sb.from("servicios_adicionales").select("id, nombre, destino_id, moneda, proveedor_id").order("nombre"),
    sb.from("empaquetados").select("id, aerolinea, ruta, fecha_ida, fecha_regreso, destino_id, tarifa_proveedor, fee_infante").eq("activo", true).order("fecha_ida", { ascending: false }).limit(300),
    // Total de fichas activas, para detectar una base que aún ofrece menos (función de la 275 sin actualizar por la 280).
    sb.from("hoteles").select("id", { count: "exact", head: true }).eq("activo", true),
  ]);
  const hotelesFicha = h;
  const sv = (s.data ?? []) as { id: number; nombre: string; destino_id: number | null; moneda: string | null; proveedor_id: number | null }[];
  const pids = [...new Set(sv.map((x) => x.proveedor_id).filter((x): x is number => x != null))];
  const pn: Record<number, string> = {};
  if (pids.length) for (const p of (await sb.from("proveedores").select("id, nombre").in("id", pids)).data ?? []) pn[p.id] = p.nombre;

  const [catalogo, opciones, reglas, fichas, infoFicha] = await Promise.all([
    cargarCatalogoHotel(admin),
    enLotes(hotelesFicha.map((x) => x.id), (l) => cargarOpcionesHotelFicha(admin, l)),
    enLotes(hotelesFicha.map((x) => x.id), (l) => cargarReglasHoteles(admin, l.map((id) => ({ id, hotel_id: id }) as FilaHotelDin))),
    cargarFichasServicio(admin, sv.map((x) => x.id)),
    // Estrellas, descripción y ubicación de cada ficha vinculable: el montaje las copia al elegir la ficha (nada se inventa si faltan).
    // Solo precarga: si falla, queda vacío y el GUARDADO (que relee la ficha) se detiene con un error claro.
    enLotes(hotelesFicha.map((x) => x.id), (l) => cargarInfoHotelesFicha(admin, l)).catch(() => new Map()),
  ]);
  return {
    destinos: (d.data ?? []) as { id: number; nombre: string; pais: string | null }[],
    hoteles: hotelesFicha.map((x) => ({
      ...x, moneda: x.moneda ?? "COP",
      estrellas: infoFicha.get(x.id)?.estrellas ?? null, descripcionFicha: infoFicha.get(x.id)?.descripcion ?? "", ubicacionFicha: infoFicha.get(x.id)?.ubicacion ?? "",
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
    fichasActivas: activas.count ?? undefined,
  };
}
