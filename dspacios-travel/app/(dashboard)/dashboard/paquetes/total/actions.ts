"use server";
// Paquete 100 % dinámico (#82) — administración del producto. Tablas propias paquete_din* (migraciones 274/275):
// NO toca armado_paquetes, generarTarifario ni tipo='dinamico'.
// Aislamiento por agencia: lo impone la RLS (275) sobre la sesión del usuario; aquí además se comprueba la agencia antes de actuar.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { autorizaTenant, contextoCotizacion } from "@/lib/cotizacion/acceso";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { opcionesDelPaquete, type FilaHotelDin, type FilaPaqueteDin, type FilaServicioDin, type FilaVueloDin } from "@/lib/paqueteDinamico/modelo";
import { validarPaquete } from "@/lib/paqueteDinamico/calculo";
import { ROLES_PRODUCTO, validarEntradaPaqueteTotal, type EntradaPaqueteTotal } from "@/lib/paqueteDinamico/entrada";
import type { Json } from "@/types/database";

type Result = { ok: true; id: number; avisos?: string[] } | { ok: false; error: string };

// Cliente sin tipos generados para las tablas nuevas (274/275 aún no están en types/database.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { from: (t: string) => any };

async function contexto(): Promise<{ sb: Loose; raw: Awaited<ReturnType<typeof createClient>>; tenant: string; superadmin: boolean } | { error: string }> {
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { error: "No autorizado." };
  const raw = await createClient();
  const { data: { user } } = await raw.auth.getUser();
  if (!user) return { error: "No autorizado." };
  const { data: u } = await raw.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  if (!u || !(ROLES_PRODUCTO as readonly string[]).includes(String(u.rol))) return { error: "No tienes permiso para administrar paquetes." };
  return { sb: raw as unknown as Loose, raw, tenant: ctx.tenant, superadmin: ctx.superadmin };
}

const filaPaquete = (e: EntradaPaqueteTotal, id: number): FilaPaqueteDin => ({
  id, nombre: e.nombre, moneda: e.moneda, esquema: e.esquema, pvp_modo: e.pvpModo, pct_mk: e.pctMkPct / 100,
  usa_vuelo: e.usaVuelo, usa_hotel: e.usaHotel, usa_servicios: e.usaServicios, noches: e.noches,
  pvp_general: e.pvpGeneral, total_declarado: e.totalDeclarado,
});

/** Valida TODAS las opciones hotel×vuelo del paquete; mensajes sin repetir. No toca la base. */
function validarOpciones(e: EntradaPaqueteTotal): string[] {
  const base = validarEntradaPaqueteTotal(e);
  if (base.length) return base;
  const hoteles: FilaHotelDin[] = e.hoteles.map((h, i) => ({ id: i + 1, hotel_id: h.hotelId, nombre: h.nombre, categoria: h.categoria, regimen: h.regimen, descripcion: h.descripcion, foto_url: h.fotoUrl, proveedor: h.proveedor, neto: h.neto, pvp: h.pvp, pvp_general: h.pvpGeneral }));
  const vuelos: FilaVueloDin[] = e.vuelos.map((v, i) => ({ id: i + 1, empaquetado_id: v.empaquetadoId, destino_id: v.destinoId, aerolinea: v.aerolinea, ruta: v.ruta, fecha_ida: v.fechaIda, fecha_regreso: v.fechaRegreso, proveedor: v.proveedor, neto: v.neto, pvp: v.pvp }));
  const servicios: FilaServicioDin[] = e.servicios.map((s, i) => ({ id: i + 1, servicio_id: s.servicioId, nombre: s.nombre, proveedor: s.proveedor, neto: s.neto, pvp: s.pvp }));
  const msgs = new Set<string>();
  if (e.usaHotel && !hoteles.length) msgs.add("Agrega al menos un hotel (existente o manual).");
  if (e.usaVuelo && !vuelos.length) msgs.add("Agrega al menos un vuelo (de Empaquetados o manual).");
  for (const o of opcionesDelPaquete(filaPaquete(e, 0), hoteles, vuelos, servicios)) {
    const pre = o.hotel ? `${o.hotel.nombre}: ` : o.vuelo ? `Vuelo ${o.vuelo.ruta ?? ""}: ` : "";
    for (const m of validarPaquete(o.calc)) msgs.add(e.hoteles.length > 1 || e.vuelos.length > 1 ? `${pre}${m}` : m);
  }
  return [...msgs];
}

export async function validarPaqueteTotal(e: EntradaPaqueteTotal): Promise<string[]> {
  return validarOpciones(e);
}

export async function guardarPaqueteTotal(e: EntradaPaqueteTotal): Promise<Result> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const errores = validarOpciones(e);
  if (errores.length) return { ok: false, error: errores[0] };
  const { sb, raw } = ctx;

  // Editar un paquete de OTRA agencia: la RLS ya lo oculta; se rechaza explícitamente antes de cualquier escritura.
  if (e.id) {
    const { data: p } = await sb.from("paquete_din").select("tenant").eq("id", e.id).maybeSingle();
    if (!p) return { ok: false, error: "El paquete no existe o no pertenece a tu agencia." };
    if (!autorizaTenant({ ok: true, superadmin: ctx.superadmin, tenant: ctx.tenant as never }, p.tenant)) return { ok: false, error: "El paquete pertenece a otra agencia." };
  }
  // El selector del navegador no es una guarda: cada ficha vinculada se comprueba en la base (y de nuevo por trigger al escribir).
  for (const h of e.usaHotel ? e.hoteles : []) {
    if (h.hotelId == null) continue;
    const { data: ok, error } = await raw.rpc("hotel_vinculable_din", { p_hotel: h.hotelId });
    if (error || ok !== true) return { ok: false, error: `El hotel «${h.nombre || h.hotelId}» no se puede vincular como ficha: debe estar activo y no tener vigencias ni tarifas. Crea un hotel manual en su lugar.` };
  }

  const general = e.esquema === "solo_pvp" && e.pvpModo === "general";
  const porComp = e.esquema === "solo_pvp" && e.pvpModo === "por_componente";
  const neta = e.esquema === "neta_markup";
  const cabecera = {
    nombre: e.nombre.trim(), destino_id: e.destinoId, destinos_extra: e.destinosExtra, moneda: e.moneda, esquema: e.esquema, pvp_modo: e.esquema === "solo_pvp" ? e.pvpModo : null,
    pct_mk: neta ? e.pctMkPct / 100 : 0, usa_vuelo: e.usaVuelo, usa_hotel: e.usaHotel, usa_servicios: e.usaServicios, noches: e.noches,
    compra_inicio: e.compraInicio || null, compra_fin: e.compraFin || null, viaje_inicio: e.viajeInicio || null, viaje_fin: e.viajeFin || null,
    pvp_general: general ? e.pvpGeneral : null, total_declarado: porComp ? e.totalDeclarado : null,
    descripcion: e.descripcion || null, incluye: e.incluye || null, no_incluye: e.noIncluye || null,
    // La agencia la fija la base con la del usuario; solo superadmin puede elegirla (la de la sesión validada).
    tenant: ctx.superadmin ? ctx.tenant : undefined,
  };
  const vuelos = e.usaVuelo ? e.vuelos.map((v) => ({ empaquetado_id: v.empaquetadoId, destino_id: v.destinoId, aerolinea: v.aerolinea || null, ruta: v.ruta || null, fecha_ida: v.fechaIda || null, fecha_regreso: v.fechaRegreso || null, proveedor: v.proveedor || null, neto: neta ? v.neto : {}, pvp: porComp ? v.pvp : {} })) : [];
  const hoteles = e.usaHotel ? e.hoteles.map((h) => ({ hotel_id: h.hotelId, nombre: h.nombre.trim(), categoria: h.categoria || null, regimen: h.regimen || null, descripcion: h.descripcion || null, foto_url: h.fotoUrl || null, proveedor: h.proveedor || null, neto: neta ? h.neto : {}, pvp: porComp ? h.pvp : {}, pvp_general: general ? h.pvpGeneral : null })) : [];
  const servicios = e.usaServicios ? e.servicios.map((s) => ({ servicio_id: s.servicioId, destino_id: s.destinoId, nombre: s.nombre.trim(), proveedor: s.proveedor || null, neto: neta ? s.neto : null, pvp: porComp ? s.pvp : null })) : [];

  // UNA sola llamada = una transacción: un error en cualquier hijo deja el paquete y sus hijos como estaban.
  const { data: id, error } = await raw.rpc("guardar_paquete_din", {
    p_id: e.id ?? null, p_cabecera: cabecera as unknown as Json, p_vuelos: vuelos as unknown as Json, p_hoteles: hoteles as unknown as Json, p_servicios: servicios as unknown as Json,
  } as never);
  if (error || id == null) return { ok: false, error: (error?.message ?? "No se pudo guardar el paquete.").replace(/^DIN_82_[A-Z_]+:\s*/, "") };
  revalidatePath("/dashboard/paquetes");
  revalidatePath("/tarifario");
  return { ok: true, id: Number(id), avisos: e.id ? ["El paquete quedó sin publicar tras editarlo; vuelve a publicarlo."] : undefined };
}

export async function publicarPaqueteTotal(id: number, publicado: boolean): Promise<Result> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { sb } = ctx;
  const { data: p } = await sb.from("paquete_din").select("*").eq("id", id).maybeSingle();
  if (!p) return { ok: false, error: "El paquete no existe o no pertenece a tu agencia." };
  if (!autorizaTenant({ ok: true, superadmin: ctx.superadmin, tenant: ctx.tenant as never }, p.tenant)) return { ok: false, error: "El paquete pertenece a otra agencia." };
  if (publicado) {
    if (!p.activo) return { ok: false, error: "El paquete está inactivo." };
    if (p.compra_fin && p.compra_fin < hoyBogota()) return { ok: false, error: "La vigencia de compra ya terminó." };
    const [v, h, s] = await Promise.all(["paquete_din_vuelos", "paquete_din_hoteles", "paquete_din_servicios"].map(async (t) => (await sb.from(t).select("*").eq("paquete_id", id)).data ?? []));
    const msgs = new Set<string>();
    if (p.usa_hotel && !h.length) msgs.add("Agrega al menos un hotel.");
    if (p.usa_vuelo && !v.length) msgs.add("Agrega al menos un vuelo.");
    for (const o of opcionesDelPaquete(p as FilaPaqueteDin, h as FilaHotelDin[], v as FilaVueloDin[], s as FilaServicioDin[])) for (const m of validarPaquete(o.calc)) msgs.add(m);
    if (msgs.size) return { ok: false, error: `No se puede publicar: ${[...msgs][0]}` };
  }
  const { error } = await sb.from("paquete_din").update({ publicado, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/paquetes");
  revalidatePath("/tarifario");
  return { ok: true, id };
}

export async function eliminarPaqueteTotal(id: number): Promise<Result> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { sb } = ctx;
  const { data: p } = await sb.from("paquete_din").select("tenant").eq("id", id).maybeSingle();
  if (!p) return { ok: false, error: "El paquete no existe o no pertenece a tu agencia." };
  if (!autorizaTenant({ ok: true, superadmin: ctx.superadmin, tenant: ctx.tenant as never }, p.tenant)) return { ok: false, error: "El paquete pertenece a otra agencia." };
  const { count } = await sb.from("cotizaciones").select("id", { count: "exact", head: true }).eq("paquete_din_id", id);
  if ((count ?? 0) > 0) {
    // Tiene cotizaciones: no se borra (rompería su historial); se retira de venta.
    const { error } = await sb.from("paquete_din").update({ activo: false, publicado: false }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/dashboard/paquetes");
    return { ok: true, id, avisos: ["El paquete tiene cotizaciones; se desactivó en lugar de borrarse."] };
  }
  const { error } = await sb.from("paquete_din").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/paquetes");
  return { ok: true, id };
}
