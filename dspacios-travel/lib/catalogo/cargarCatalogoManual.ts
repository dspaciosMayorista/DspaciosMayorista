import "server-only";
// #95 — catálogo para la PRECARGA editable de los formularios manuales (contrato y cotización).
// Lee con la sesión de quien consulta (cliente RLS, no service-role): si un rol no puede ver una tabla, simplemente no recibe esas sugerencias.
// Solo columnas de presentación general: NUNCA tarifas, precios, vigencias, notas ni costos (servicios_adicionales y hoteles guardan precios en la misma fila).
// Cada lectura se pagina (el límite de filas de PostgREST trunca en silencio) y un fallo deja esa parte vacía en vez de romper el formulario.
import { fetchAllPaginado } from "@/lib/supabase/fetchAllPaginado";
import { ACOM_ROOM_LABEL, type AcomConfig, type AcomRoom } from "@/lib/acomodaciones";
import type { HotelCatalogoManual, ServicioCatalogoManual } from "@/lib/catalogo/prefillManual";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Suelto = { from: (t: string) => any };

type Pagina = { data: Record<string, unknown>[] | null; error: { message: string } | null };
// `orden` = columnas del ORDEN TOTAL de la tabla (la paginación exige un orden determinista; hotel_categorias/hotel_regimenes no tienen `id`: su clave es compuesta).
const leer = (sb: Suelto, tabla: string, columnas: string, orden: string[], filtro?: (q: unknown) => unknown) =>
  fetchAllPaginado<Record<string, unknown>>((d, h) => {
    let q = sb.from(tabla).select(columnas);
    if (filtro) q = filtro(q);
    for (const o of orden) q = q.order(o);
    return q.range(d, h) as PromiseLike<Pagina>;
  });

export type CatalogoManual = { hoteles: HotelCatalogoManual[]; servicios: ServicioCatalogoManual[]; aerolineas: string[]; proveedores: string[]; /** Aerolíneas con su id (para resolver sus tipos de tarifa sin volver a leer el catálogo). */ aerolineasConId: { id: number; nombre: string }[] };

export async function cargarCatalogoManual(cliente: unknown, opciones: { servicios?: boolean } = {}): Promise<CatalogoManual> {
  const sb = cliente as Suelto;
  const [hoteles, provs, cats, regs, acoms, aeros, servicios] = await Promise.all([
    leer(sb, "hoteles", "id, nombre, proveedor_id, adults_only, pet_friendly, destino_id, pax_min, pax_max, edad_infante_max, edad_nino_max, destinos(nombre)", ["id"], (q) => (q as { eq: (c: string, v: boolean) => unknown }).eq("activo", true)),
    leer(sb, "proveedores", "id, nombre", ["id"]),
    leer(sb, "hotel_categorias", "hotel_id, categoria_id, categorias_habitacion(nombre)", ["hotel_id", "categoria_id"]),
    leer(sb, "hotel_regimenes", "hotel_id, plan_id, planes_alimentacion(codigo)", ["hotel_id", "plan_id"]),
    leer(sb, "hotel_acomodaciones", "id, hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max", ["id"]),
    leer(sb, "aerolineas", "id, nombre", ["id"], (q) => (q as { eq: (c: string, v: boolean) => unknown }).eq("activo", true)),
    opciones.servicios === false ? Promise.resolve([] as Record<string, unknown>[]) : leer(sb, "servicios_adicionales", "id, nombre, categoria, proveedor_id", ["id"], (q) => (q as { eq: (c: string, v: boolean) => unknown }).eq("activo", true)),
  ]);
  const nombreProv = new Map(provs.map((p) => [p.id as number, String(p.nombre ?? "")]));
  const porHotel = <T,>(rows: Record<string, unknown>[], valor: (r: Record<string, unknown>) => T | null) => {
    const m = new Map<number, T[]>();
    for (const r of rows) { const v = valor(r); if (v != null) m.set(r.hotel_id as number, [...(m.get(r.hotel_id as number) ?? []), v]); }
    return m;
  };
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const categorias = porHotel(cats, (r) => String((r.categorias_habitacion as { nombre?: string } | null)?.nombre ?? "") || null);
  const regimenes = porHotel(regs, (r) => String((r.planes_alimentacion as { codigo?: string } | null)?.codigo ?? "") || null);
  const acomodaciones = porHotel(acoms, (r) => ACOM_ROOM_LABEL[r.acomodacion as AcomRoom] ?? null);
  const reglasPorHotel = new Map<number, AcomConfig[]>();
  for (const r of acoms) {
    const n = (k: string) => Number(r[k]) || 0;
    reglasPorHotel.set(r.hotel_id as number, [...(reglasPorHotel.get(r.hotel_id as number) ?? []), {
      acomodacion: r.acomodacion as AcomRoom, pax_tarifa: n("pax_tarifa"), pax_max: n("pax_max"), adt_min: n("adt_min"), adt_max: n("adt_max"), chd_min: n("chd_min"), chd_max: n("chd_max"), inf_min: n("inf_min"), inf_max: n("inf_max"),
    }]);
  }
  const orden = (xs: string[]) => { const base = Object.values(ACOM_ROOM_LABEL); return [...new Set(xs)].sort((a, b) => base.indexOf(a) - base.indexOf(b)); };
  return {
    aerolineas: [...new Set(aeros.map((a) => String(a.nombre ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    proveedores: uniq(provs.map((p) => String(p.nombre ?? ""))),
    aerolineasConId: aeros.map((a) => ({ id: a.id as number, nombre: String(a.nombre ?? "") })).filter((a) => a.nombre.trim()),
    hoteles: hoteles.map((h) => ({
      id: h.id as number,
      nombre: String(h.nombre ?? ""),
      destino: String((h.destinos as { nombre?: string } | null)?.nombre ?? "").trim() || null,
      proveedor: h.proveedor_id != null ? nombreProv.get(h.proveedor_id as number) ?? null : null,
      destinoId: h.destino_id != null ? Number(h.destino_id) : null,
      reglasAcom: reglasPorHotel.get(h.id as number) ?? [],
      paxMin: h.pax_min != null ? Number(h.pax_min) : null,
      paxMax: h.pax_max != null ? Number(h.pax_max) : null,
      edadInfanteMax: h.edad_infante_max != null ? Number(h.edad_infante_max) : null,
      edadNinoMax: h.edad_nino_max != null ? Number(h.edad_nino_max) : null,
      adultsOnly: h.adults_only === true,
      petFriendly: h.pet_friendly === true,
      categorias: uniq(categorias.get(h.id as number) ?? []),
      regimenes: uniq(regimenes.get(h.id as number) ?? []),
      acomodaciones: orden(acomodaciones.get(h.id as number) ?? []),
    })).filter((h) => h.nombre.trim()),
    servicios: servicios.map((s) => ({
      id: s.id as number,
      nombre: String(s.nombre ?? ""),
      categoria: String(s.categoria ?? "otro"),
      proveedor: s.proveedor_id != null ? nombreProv.get(s.proveedor_id as number) ?? null : null,
    })).filter((s) => s.nombre.trim()),
  };
}
