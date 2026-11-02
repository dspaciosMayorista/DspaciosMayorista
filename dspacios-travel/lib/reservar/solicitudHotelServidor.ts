// #120 · Lecturas de servidor de una solicitud a pedido (service-role). La neta y el aporte del vuelo SIEMPRE se leen de la base: nunca del navegador.
import { createAdminClient } from "@/lib/supabase/admin";
import { aporteVuelo } from "@/lib/calc/paquetes";
import type { OrigenVuelo } from "@/lib/reservar/origen";
import { ITEM_REF_HOTEL, type ConteosViajeros, type ModoReparto, type NetaSolicitud, type VueloSolicitud } from "@/lib/reservar/solicitudHotel";
import { evaluarOcupacionSolicitud, type ResultadoOcupacion } from "@/lib/reservar/solicitudOcupacion";
import { normalizarReglaEdadGeneral } from "@/lib/calc/reglaEdadTarifa";
import type { AcomConfig } from "@/lib/acomodaciones";

type Admin = ReturnType<typeof createAdminClient>;

/** ¿El vínculo hotel↔paquete es «bajo solicitud»? Falla cerrado: un error de lectura no se interpreta como tarifado ni como a solicitud. */
export async function modalidadDelVinculo(admin: Admin, paqueteId: number, hotelId: number): Promise<{ ok: true; modalidad: "tarifada" | "bajo_solicitud" | null } | { ok: false }> {
  // La modalidad se DERIVA de la marca del hotel (única fuente de verdad); `null` = el hotel no está seleccionado en ese paquete.
  const { data, error } = await admin.from("armado_hoteles").select("hoteles(tarifa_bajo_solicitud)").eq("paquete_id", paqueteId).eq("hotel_id", hotelId).maybeSingle();
  if (error) return { ok: false };
  if (!data) return { ok: true, modalidad: null };
  const marca = (data.hoteles as unknown as { tarifa_bajo_solicitud?: boolean | null } | null)?.tarifa_bajo_solicitud === true;
  return { ok: true, modalidad: marca ? "bajo_solicitud" : "tarifada" };
}

/** Categorías y regímenes configurados para UN hotel (hotel_categorias / hotel_regimenes). Falla cerrado: un error de lectura no se interpreta como «catálogo vacío». */
export async function catalogoDelHotel(admin: Admin, hotelId: number): Promise<{ ok: true; categorias: string[]; regimenes: { codigo: string; nombre: string }[] } | { ok: false }> {
  const [c, r] = await Promise.all([
    admin.from("hotel_categorias").select("categorias_habitacion(nombre, activo)").eq("hotel_id", hotelId),
    admin.from("hotel_regimenes").select("planes_alimentacion(codigo, nombre)").eq("hotel_id", hotelId),
  ]);
  if (c.error || r.error) return { ok: false };
  const categorias = (c.data ?? []).flatMap((x) => { const k = x.categorias_habitacion as unknown as { nombre: string; activo: boolean | null } | null; return k?.nombre && k.activo !== false ? [k.nombre] : []; });
  const regimenes = (r.data ?? []).flatMap((x) => { const p = x.planes_alimentacion as unknown as { codigo: string; nombre: string | null } | null; return p?.codigo ? [{ codigo: p.codigo, nombre: p.nombre ?? p.codigo }] : []; });
  return { ok: true, categorias, regimenes };
}

/** Neta ya cargada de una cotización (null = aún pendiente). */
export async function netaCargada(admin: Admin, cotizacionId: number): Promise<{ ok: true; neta: NetaSolicitud | null; precioVenta: number } | { ok: false; error: string }> {
  const { data, error } = await admin.from("cotizacion_tarifa_solicitud").select("neta, moneda, precio_venta, modo, adultos, ninos, infantes, neta_adulto, neta_nino").eq("cotizacion_id", cotizacionId).eq("item_ref", ITEM_REF_HOTEL).maybeSingle();
  if (error) return { ok: false, error: "No se pudo leer la neta de la solicitud." };
  if (!data) return { ok: true, neta: null, precioVenta: 0 };
  const reparto = {
    modo: (data.modo === "distribuir" ? "distribuir" : "adultos") as ModoReparto, adultos: Number(data.adultos), ninos: Number(data.ninos), infantes: Number(data.infantes),
    netaAdulto: Number(data.neta_adulto), netaNino: Number(data.neta_nino), netaInfante: 0 as const,
  };
  return { ok: true, neta: { netaTotal: Number(data.neta), moneda: data.moneda === "USD" ? "USD" : "COP", reparto }, precioVenta: Number(data.precio_venta) };
}

/**
 * Ocupación de una solicitud con la regla EXACTA del motor: umbrales de edad del hotel y `hotel_acomodaciones` (sin configurar rigen los defaults del motor).
 * Devuelve los conteos (adultos/niños/infantes) o el mismo motivo de rechazo que daría al valorar o reservar.
 */
export async function evaluarOcupacionHotel(admin: Admin, hotelId: number, habitaciones: Record<string, number>, edadesMenores: readonly number[], adultosReales?: number | null): Promise<ResultadoOcupacion> {
  const [h, a] = await Promise.all([
    admin.from("hoteles").select("edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, adults_only").eq("id", hotelId).maybeSingle(),
    admin.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").eq("hotel_id", hotelId),
  ]);
  if (h.error || a.error || !h.data) return { ok: false, error: "No se pudo leer la configuración del hotel." };
  if (h.data.adults_only && edadesMenores.length) return { ok: false, error: "Este hotel es Adults Only: no acepta niños ni infantes." };
  const regla = normalizarReglaEdadGeneral({ infanteMin: h.data.edad_infante_min ?? null, infanteMax: h.data.edad_infante_max ?? null, ninoMin: h.data.edad_nino_min ?? null, ninoMax: h.data.edad_nino_max ?? null });
  return evaluarOcupacionSolicitud({ habitaciones, edadesMenores, reglas: (a.data ?? []) as unknown as AcomConfig[], reglaEdad: { infanteMax: regla.infanteMax, ninoMax: regla.ninoMax }, adultosReales });
}
export type { ConteosViajeros };

/**
 * Aporte del vuelo del paquete por persona, con la MISMA fórmula del generador (`aporteVuelo` + impuesto del paquete): bloqueo y empaquetado.
 * Porción terrestre (`ninguno`) = sin vuelo. Una salida dinámica no admite hotel a solicitud todavía.
 */
export async function resolverVueloSolicitud(admin: Admin, paqueteId: number, origen: OrigenVuelo): Promise<{ ok: true; vuelo: VueloSolicitud | null } | { ok: false; error: string }> {
  if (origen.tipo === "ninguno") return { ok: true, vuelo: null };
  if (origen.tipo === "salida") return { ok: false, error: "Un hotel a solicitud todavía no se ofrece en salidas dinámicas." };
  const { data: pq, error: pqErr } = await admin.from("armado_paquetes").select("pct_mk, impuesto_tipo, impuesto_fijo").eq("id", paqueteId).maybeSingle();
  if (pqErr || !pq) return { ok: false, error: "No se pudo leer la configuración del paquete." };
  const pctMk = Number(pq.pct_mk) || 0;
  const enlace = origen.tipo === "bloqueo"
    ? await admin.from("armado_vuelos").select("aplica_mk, ta").eq("paquete_id", paqueteId).eq("bloqueo_id", origen.id).maybeSingle()
    : await admin.from("armado_empaquetados").select("aplica_mk, ta").eq("paquete_id", paqueteId).eq("empaquetado_id", origen.id).maybeSingle();
  if (enlace.error || !enlace.data) return { ok: false, error: "El vuelo ya no está vinculado a este paquete." };
  const fuente = origen.tipo === "bloqueo"
    ? await admin.from("bloqueos_vuelo").select("tarifa_para_empaquetar, fee_infante").eq("id", origen.id).maybeSingle()
    : await admin.from("empaquetados").select("tarifa_para_empaquetar, fee_infante").eq("id", origen.id).maybeSingle();
  if (fuente.error || !fuente.data) return { ok: false, error: "No se pudo leer la tarifa del vuelo." };
  const costoTiquete = Number(fuente.data.tarifa_para_empaquetar) || 0;
  return {
    ok: true,
    vuelo: {
      aporte: aporteVuelo(costoTiquete, !!enlace.data.aplica_mk, pctMk, Number(enlace.data.ta) || 0),
      feeInfante: Number(fuente.data.fee_infante) || 0,
      impuesto: pq.impuesto_tipo === "tiquete" ? costoTiquete : Number(pq.impuesto_fijo) || 0,
    },
  };
}
