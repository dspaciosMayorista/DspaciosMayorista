import "server-only";
// Lectura SERVIDOR (cliente admin) de las fichas que el paquete dinámico reutiliza: hotel (edades, capacidad por acomodación, categorías y regímenes),
// servicio (vigencias, rangos por grupo, liquidación) y vuelo de Empaquetados (horarios). Nada de costos sale de aquí hacia el navegador.
import type { createAdminClient } from "@/lib/supabase/admin";
import { leerTemporadasServicio } from "@/lib/reservar/temporadasServicio";
import { separarFranjas, type FilaTemporadaConFranjas } from "@/lib/reservar/liquidacionServicio";
import { reglasHotelFicha, reglasHotelManual, type ReglasHotelDin } from "@/lib/paqueteDinamico/menores";
import type { FichaServicioDin } from "@/lib/paqueteDinamico/servicioFicha";
import type { VueloDetalle } from "@/lib/paqueteDinamico/publico";
import type { FilaHotelDin, FilaVueloDin } from "@/lib/paqueteDinamico/modelo";

type Admin = ReturnType<typeof createAdminClient>;
// Tablas nuevas (274-277) sin tipos generados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Suelto = { from: (t: string) => any };

/** Reglas de cada hotel del paquete: manual → de su capacidad/edades guardadas; con ficha → de la ficha. Sin configuración (paquete anterior) → null. */
export async function cargarReglasHoteles(admin: Admin, hoteles: FilaHotelDin[]): Promise<Map<number, ReglasHotelDin | null>> {
  const out = new Map<number, ReglasHotelDin | null>();
  const sb = admin as unknown as Suelto;
  const fichas = [...new Set(hoteles.map((h) => h.hotel_id).filter((x): x is number => x != null))];
  const hRows = new Map<number, Record<string, unknown>>();
  const acom = new Map<number, Record<string, unknown>[]>();
  if (fichas.length) {
    const [h, a] = await Promise.all([
      sb.from("hoteles").select("id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, adults_only").in("id", fichas),
      sb.from("hotel_acomodaciones").select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").in("hotel_id", fichas),
    ]);
    for (const r of h.data ?? []) hRows.set(r.id, r);
    for (const r of a.data ?? []) acom.set(r.hotel_id, [...(acom.get(r.hotel_id) ?? []), r]);
  }
  for (const h of hoteles) {
    if (h.hotel_id != null) {
      const f = hRows.get(h.hotel_id);
      out.set(h.id, f ? reglasHotelFicha(f, (acom.get(h.hotel_id) ?? []) as never) : null);
    } else if (h.capacidad_ninos != null && h.edad_infante_max != null && h.edad_nino_max != null) {
      out.set(h.id, reglasHotelManual({ capacidadNinos: h.capacidad_ninos, edadInfanteMax: h.edad_infante_max, edadNinoMax: h.edad_nino_max }));
    } else out.set(h.id, null);
  }
  return out;
}

/** Categorías de habitación y regímenes que el hotel con ficha tiene configurados (para mostrarlos y validar la elección). */
export async function cargarOpcionesHotelFicha(admin: Admin, hotelIds: number[]): Promise<Map<number, { categorias: string[]; regimenes: string[] }>> {
  const out = new Map<number, { categorias: string[]; regimenes: string[] }>();
  const ids = [...new Set(hotelIds)];
  if (!ids.length) return out;
  const sb = admin as unknown as Suelto;
  const [c, r] = await Promise.all([
    sb.from("hotel_categorias").select("hotel_id, categorias_habitacion(nombre)").in("hotel_id", ids),
    sb.from("hotel_regimenes").select("hotel_id, planes_alimentacion(codigo)").in("hotel_id", ids),
  ]);
  for (const id of ids) out.set(id, { categorias: [], regimenes: [] });
  for (const x of c.data ?? []) { const n = x.categorias_habitacion?.nombre; if (n) out.get(x.hotel_id)!.categorias.push(String(n)); }
  for (const x of r.data ?? []) { const n = x.planes_alimentacion?.codigo; if (n) out.get(x.hotel_id)!.regimenes.push(String(n)); }
  for (const v of out.values()) { v.categorias.sort(); v.regimenes.sort(); }
  return out;
}

/** Catálogo general (para el hotel MANUAL: misma lista y misma validación que los hoteles normales). */
export async function cargarCatalogoHotel(admin: Admin): Promise<{ categorias: string[]; regimenes: string[] }> {
  const sb = admin as unknown as Suelto;
  const [c, r] = await Promise.all([
    sb.from("categorias_habitacion").select("nombre").eq("activo", true).order("nombre"),
    sb.from("planes_alimentacion").select("codigo").eq("activo", true).order("codigo"),
  ]);
  return { categorias: (c.data ?? []).map((x: { nombre: string }) => x.nombre), regimenes: (r.data ?? []).map((x: { codigo: string }) => x.codigo) };
}

/** Fichas de servicio: vigencias, rangos por grupo y liquidación. Los traslados/combos y los suplementos por horario se marcan como no soportados. */
export async function cargarFichasServicio(admin: Admin, ids: number[]): Promise<Map<number, FichaServicioDin>> {
  const out = new Map<number, FichaServicioDin>();
  const unicos = [...new Set(ids)];
  if (!unicos.length) return out;
  const sb = admin as unknown as Suelto;
  const [s, g, t] = await Promise.all([
    sb.from("servicios_adicionales").select("id, nombre, moneda, liquidacion, tipo_tarifa, tipo_receptivo").in("id", unicos),
    sb.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", unicos),
    leerTemporadasServicio(admin, unicos),
  ]);
  if (t.error) throw new Error("No se pudo leer las vigencias del servicio.");
  const temps = t.data as FilaTemporadaConFranjas[];
  for (const f of s.data ?? []) {
    const propias = temps.filter((x) => x.servicio_id === f.id);
    const { temporadas, franjas } = separarFranjas(propias);
    const noSoportado = f.tipo_receptivo === "traslado" || f.tipo_receptivo === "combo" || franjas.length
      ? "es un traslado/combo o tiene suplementos por horario; aún no se puede usar en un paquete dinámico." : null;
    out.set(f.id, {
      id: f.id, nombre: f.nombre, moneda: f.moneda ?? "COP", liquidacion: f.liquidacion ?? null, modo: f.tipo_tarifa === "grupo" ? "grupo" : "persona",
      temporadas: temporadas.map((x) => ({ nombre: x.nombre, fecha_inicio: x.fecha_inicio, fecha_fin: x.fecha_fin, compra_inicio: x.compra_inicio ?? null, compra_fin: x.compra_fin ?? null, prioridad: x.prioridad ?? null, precio_persona: x.precio_persona, precio_infante: x.precio_infante ?? null, recargo_individual: x.recargo_individual ?? null })),
      grupos: (g.data ?? []).filter((x: { servicio_id: number }) => x.servicio_id === f.id).map((x: { pax_desde: number; pax_hasta: number; precio: number; temporada: string | null }) => ({ pax_desde: x.pax_desde, pax_hasta: x.pax_hasta, precio: Number(x.precio), temporada: x.temporada })),
      noSoportado,
    });
  }
  return out;
}

/** Datos del vuelo vinculado (aerolínea, ruta, números y horarios de Empaquetados) para mostrarlo como en el checkout normal. */
export async function cargarVuelosDetalle(admin: Admin, vuelos: FilaVueloDin[]): Promise<Map<number, VueloDetalle>> {
  const out = new Map<number, VueloDetalle>();
  const ids = [...new Set(vuelos.map((v) => v.empaquetado_id).filter((x): x is number => x != null))];
  const emp = new Map<number, Record<string, string | null>>();
  if (ids.length) {
    const { data } = await (admin as unknown as Suelto).from("empaquetados").select("id, aerolinea, ruta, vuelo_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, hora_salida_reg, hora_llegada_reg").in("id", ids);
    for (const e of data ?? []) emp.set(e.id, e);
  }
  for (const v of vuelos) {
    const e = v.empaquetado_id != null ? emp.get(v.empaquetado_id) : undefined;
    out.set(v.id, {
      aerolinea: v.aerolinea ?? e?.aerolinea ?? null, ruta: v.ruta ?? e?.ruta ?? null, vueloIda: e?.vuelo_ida ?? null, horaSalidaIda: e?.hora_salida_ida ?? null,
      horaLlegadaIda: e?.hora_llegada_ida ?? null, vueloRegreso: e?.vuelo_regreso ?? null, horaSalidaReg: e?.hora_salida_reg ?? null, horaLlegadaReg: e?.hora_llegada_reg ?? null,
    });
  }
  return out;
}
