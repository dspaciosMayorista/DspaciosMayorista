// #120 · Hoteles «bajo solicitud» visibles en Vista Booking. Fuente PARALELA a `tarifario_resultado` (patrón de datosBernalo.ts): un hotel sin tarifa no tiene filas
// de precio, y aun así debe aparecer —también cuando es el ÚNICO hotel del paquete— como «Tarifa y disponibilidad bajo solicitud». Service-role; nunca expone costos
// ni importes: solo identidad, fechas de salida y banderas del hotel.
import { createAdminClient } from "@/lib/supabase/admin";
import { hoyBogota } from "@/lib/cotizacion/vigencia";

export type SalidaSolicitud = { bloqueoId: number | null; empaquetadoId: number | null; ruta: string | null; fechaIda: string; fechaRegreso: string };

export type HotelBajoSolicitud = {
  hotelId: number;
  hotelNombre: string;
  paqueteId: number;
  paqueteNombre: string;
  tipo: "bloqueo" | "porcion_terrestre";
  destinoNombre: string | null;
  moneda: "COP" | "USD" | null;
  adultsOnly: boolean;
  petFriendly: boolean;
  foto: string | null;
  /** Bloqueo/empaquetado: salidas con fechas fijas. Porción terrestre: vacío (las fechas las elige el cliente dentro de `viaje`). */
  salidas: SalidaSolicitud[];
  viaje: { inicio: string | null; fin: string | null } | null;
};

export type ResultadoHotelesBajoSolicitud = { ok: true; hoteles: HotelBajoSolicitud[] } | { ok: false; error: string };

type Pq = { id: number; nombre: string; tipo: string; fecha_compra_inicio: string | null; fecha_compra_fin: string | null; fecha_viaje_inicio: string | null; fecha_viaje_fin: string | null; destinos: { nombre: string } | null };

/** ¿El paquete se puede vender HOY? Compra abierta y, para porción terrestre, viaje no vencido. Pura. */
export function paqueteVendibleHoy(p: Pick<Pq, "tipo" | "fecha_compra_inicio" | "fecha_compra_fin" | "fecha_viaje_fin">, hoy: string): boolean {
  if (p.fecha_compra_inicio && p.fecha_compra_inicio > hoy) return false;
  if (p.fecha_compra_fin && p.fecha_compra_fin < hoy) return false;
  if (p.tipo === "porcion_terrestre" && p.fecha_viaje_fin && p.fecha_viaje_fin < hoy) return false;
  return true;
}

export async function cargarHotelesBajoSolicitud(): Promise<ResultadoHotelesBajoSolicitud> {
  const admin = createAdminClient();
  const hoy = hoyBogota();
  const { data: filas, error } = await admin
    .from("armado_hoteles")
    .select("paquete_id, hotel_id, hoteles!inner(nombre, moneda, adults_only, pet_friendly, tarifa_bajo_solicitud)")
    .eq("hoteles.tarifa_bajo_solicitud", true); // solo hoteles MARCADOS; aparecen únicamente en los paquetes donde fueron seleccionados
  if (error) return { ok: false, error: error.message };
  if (!filas?.length) return { ok: true, hoteles: [] };
  const ids = [...new Set(filas.map((f) => f.paquete_id))];
  const [{ data: pqs, error: ePq }, { data: vuelos, error: eV }, { data: emps, error: eE }] = await Promise.all([
    admin.from("armado_paquetes").select("id, nombre, tipo, fecha_compra_inicio, fecha_compra_fin, fecha_viaje_inicio, fecha_viaje_fin, destinos(nombre)").in("id", ids).eq("activo", true).in("tipo", ["bloqueo", "porcion_terrestre"]),
    admin.from("armado_vuelos").select("paquete_id, bloqueo_id, bloqueos_vuelo(id, ruta, fecha_ida, fecha_regreso)").in("paquete_id", ids),
    admin.from("armado_empaquetados").select("paquete_id, empaquetado_id, empaquetados(id, ruta, fecha_ida, fecha_regreso, activo, compra_inicio, compra_fin)").in("paquete_id", ids),
  ]);
  if (ePq) return { ok: false, error: ePq.message };
  if (eV) return { ok: false, error: eV.message };
  if (eE) return { ok: false, error: eE.message };

  const salidasPorPaquete = new Map<number, SalidaSolicitud[]>();
  const add = (pid: number, s: SalidaSolicitud) => { const a = salidasPorPaquete.get(pid) ?? []; a.push(s); salidasPorPaquete.set(pid, a); };
  for (const v of vuelos ?? []) {
    const b = v.bloqueos_vuelo as unknown as { id: number; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null } | null;
    if (b?.fecha_ida && b.fecha_regreso && b.fecha_ida >= hoy) add(v.paquete_id, { bloqueoId: b.id, empaquetadoId: null, ruta: b.ruta, fechaIda: b.fecha_ida, fechaRegreso: b.fecha_regreso });
  }
  for (const v of emps ?? []) {
    const e = v.empaquetados as unknown as { id: number; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null; activo: boolean; compra_inicio: string | null; compra_fin: string | null } | null;
    if (!e?.activo || !e.fecha_ida || !e.fecha_regreso || e.fecha_ida < hoy) continue;
    if ((e.compra_inicio && e.compra_inicio > hoy) || (e.compra_fin && e.compra_fin < hoy)) continue;
    add(v.paquete_id, { bloqueoId: null, empaquetadoId: e.id, ruta: e.ruta, fechaIda: e.fecha_ida, fechaRegreso: e.fecha_regreso });
  }

  const pqPorId = new Map((pqs ?? []).map((p) => [p.id, p as unknown as Pq]));
  const hoteles: HotelBajoSolicitud[] = [];
  for (const f of filas) {
    const p = pqPorId.get(f.paquete_id);
    if (!p || !paqueteVendibleHoy(p, hoy)) continue;
    const h = f.hoteles as unknown as { nombre: string; moneda: string | null; adults_only: boolean | null; pet_friendly: boolean | null } | null;
    if (!h) continue;
    const tipo = p.tipo as "bloqueo" | "porcion_terrestre";
    const salidas = (salidasPorPaquete.get(p.id) ?? []).sort((a, b) => a.fechaIda.localeCompare(b.fechaIda));
    if (tipo === "bloqueo" && !salidas.length) continue; // sin salida vigente no hay a qué solicitarle fechas
    hoteles.push({
      hotelId: f.hotel_id, hotelNombre: h.nombre, paqueteId: p.id, paqueteNombre: p.nombre, tipo, destinoNombre: p.destinos?.nombre ?? null,
      moneda: h.moneda === "USD" ? "USD" : h.moneda === "COP" ? "COP" : null, adultsOnly: h.adults_only === true, petFriendly: h.pet_friendly === true, foto: null,
      salidas: tipo === "bloqueo" ? salidas : [], viaje: tipo === "porcion_terrestre" ? { inicio: p.fecha_viaje_inicio, fin: p.fecha_viaje_fin } : null,
    });
  }
  // Portada del hotel (hotel_fotos es de lectura pública). Un fallo aquí no oculta la oferta: queda sin foto.
  if (hoteles.length) {
    const { data: fotos } = await admin.from("hotel_fotos").select("hotel_id, url, es_portada, orden").in("hotel_id", [...new Set(hoteles.map((x) => x.hotelId))]).order("orden");
    const portada = new Map<number, string>();
    for (const f of fotos ?? []) if (f.es_portada || !portada.has(f.hotel_id)) portada.set(f.hotel_id, f.url);
    for (const x of hoteles) x.foto = portada.get(x.hotelId) ?? null;
  }
  return { ok: true, hoteles };
}
