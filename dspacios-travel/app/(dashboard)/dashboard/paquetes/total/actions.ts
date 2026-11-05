"use server";
// Paquete 100 % dinámico (#82) — administración del producto. Tablas propias paquete_din* (migraciones 274/275):
// NO toca armado_paquetes, generarTarifario ni tipo='dinamico'.
// Aislamiento por agencia: lo impone la RLS (275) sobre la sesión del usuario; aquí además se comprueba la agencia antes de actuar.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cargarCatalogoHotel, cargarFichasServicio, cargarInfoHotelesFicha, cargarOpcionesHotelFicha } from "@/lib/paqueteDinamico/fichas";
import { cobraInfante } from "@/lib/paqueteDinamico/servicioFicha";
import { autorizaTenant, contextoCotizacion } from "@/lib/cotizacion/acceso";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { opcionesDelPaquete, type FilaHotelDin, type FilaPaqueteDin, type FilaServicioDin, type FilaVueloDin } from "@/lib/paqueteDinamico/modelo";
import { validarPaquete } from "@/lib/paqueteDinamico/calculo";
import { ROLES_PRODUCTO, validarEntradaPaqueteTotal, type EntradaPaqueteTotal } from "@/lib/paqueteDinamico/entrada";
import { derivarRutaManual, destinoCoincide, mensajeSinProveedor, normalizarIata, serviciosSinProveedor, validarMultidestino } from "@/lib/paqueteDinamico/ruta";
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
  pvp_general: e.pvpGeneral, total_declarado: null,
});

/** Valida TODAS las opciones hotel×vuelo del paquete; mensajes sin repetir. No toca la base. */
function validarOpciones(e: EntradaPaqueteTotal, destinos: { id: number; pais: string | null }[] = []): string[] {
  const base = validarEntradaPaqueteTotal(e, destinos);
  if (base.length) return base;
  const hoteles: FilaHotelDin[] = e.hoteles.map((h, i) => ({ id: i + 1, hotel_id: h.hotelId, capacidad_ninos: h.capacidadNinos, edad_infante_max: h.edadInfanteMax, edad_nino_max: h.edadNinoMax, nombre: h.nombre, categoria: h.categoria, regimen: h.regimen, descripcion: h.descripcion, foto_url: h.fotoUrl, estrellas: h.estrellas, ubicacion: h.ubicacion, proveedor: h.proveedor, neto: h.neto, pvp: h.pvp, pvp_general: h.pvpGeneral }));
  const vuelos: FilaVueloDin[] = e.vuelos.map((v, i) => ({ id: i + 1, empaquetado_id: v.empaquetadoId, destino_id: v.destinoId, aerolinea: v.aerolinea, ruta: v.ruta, fecha_ida: v.fechaIda, fecha_regreso: v.fechaRegreso, proveedor: v.proveedor, neto: v.neto, pvp: v.pvp }));
  const servicios: FilaServicioDin[] = e.servicios.map((s, i) => ({ id: i + 1, servicio_id: s.servicioId, nombre: s.nombre, proveedor: s.proveedor, neto: s.neto, pvp: s.pvp, pvp_infante: s.pvpInfante }));
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

/**
 * Lo que NO se confía del navegador se vuelve a leer de las fichas (la base lo impone otra vez con triggers, migración 276):
 *  · país de los destinos (multidestino solo del mismo país) · ruta de cada vuelo (empaquetado vinculado, o derivada de origen/destino)
 *  · proveedor de cada servicio vinculado (servicios_adicionales.proveedor_id + su ficha) · moneda de hoteles y servicios vinculados.
 */
async function completarDesdeFichas(sb: Loose, e: EntradaPaqueteTotal): Promise<{ e: EntradaPaqueteTotal; errores: string[]; avisos: string[]; destinos: { id: number; pais: string | null }[] }> {
  const errores: string[] = [];
  const avisos: string[] = [];
  const idsDest = [...new Set([e.destinoId, ...e.destinosExtra].filter((x): x is number => !!x))];
  const destinos: { id: number; pais: string | null }[] = idsDest.length ? ((await sb.from("destinos").select("id, pais").in("id", idsDest)).data ?? []) : [];
  errores.push(...validarMultidestino({ multidestino: e.multidestino, destinoId: e.destinoId, destinosExtra: e.destinosExtra, destinos }));

  // Vuelos: la ruta nunca es texto libre.
  const idsEmp = [...new Set(e.vuelos.map((v) => v.empaquetadoId).filter((x): x is number => x != null))];
  const emp: Record<number, { ruta: string | null; origen: string | null; destino_iata: string | null; destino_id: number | null }> = {};
  if (idsEmp.length) {
    const { data: es } = await sb.from("empaquetados").select("id, ruta, origen, destino_id").in("id", idsEmp);
    const dd: Record<number, string | null> = {};
    const di = [...new Set((es ?? []).map((x: { destino_id: number | null }) => x.destino_id).filter((x: number | null): x is number => x != null))];
    if (di.length) for (const d of (await sb.from("destinos").select("id, codigo_iata").in("id", di)).data ?? []) dd[d.id] = d.codigo_iata ?? null;
    for (const x of es ?? []) emp[x.id] = { ruta: x.ruta, origen: x.origen, destino_id: x.destino_id ?? null, destino_iata: x.destino_id != null ? (dd[x.destino_id] ?? null) : null };
  }
  const vuelos = e.vuelos.map((v) => {
    if (v.empaquetadoId != null) {
      const x = emp[v.empaquetadoId];
      if (!x) { errores.push("Un vuelo vincula un empaquetado que no existe."); return v; }
      if (!destinoCoincide(x.destino_id, v.destinoId, e.destinoId)) { errores.push(`El empaquetado #${v.empaquetadoId} es de otro destino que el declarado para el vuelo.`); return v; }
      if (!x.ruta?.trim()) { errores.push(`El empaquetado #${v.empaquetadoId} no tiene ruta cargada; complétala en Empaquetados.`); return v; }
      return { ...v, ruta: x.ruta.trim(), origenIata: normalizarIata(x.origen), destinoIata: normalizarIata(x.destino_iata) };
    }
    const ruta = derivarRutaManual(v.origenIata, v.destinoIata, !!v.fechaRegreso);
    if (!ruta) { errores.push("Un vuelo manual necesita origen y destino distintos, con código IATA de 3 letras."); return v; }
    return { ...v, ruta, origenIata: normalizarIata(v.origenIata), destinoIata: normalizarIata(v.destinoIata) };
  });

  // Servicios vinculados: proveedor y moneda de la ficha.
  const idsSv = [...new Set(e.servicios.map((x) => x.servicioId).filter((x): x is number => x != null))];
  const sv: Record<number, { moneda: string; proveedor_id: number | null; proveedor: string | null; destino_id: number | null }> = {};
  if (idsSv.length) {
    const { data: ss } = await sb.from("servicios_adicionales").select("id, moneda, proveedor_id, destino_id").in("id", idsSv);
    const pids = [...new Set((ss ?? []).map((x: { proveedor_id: number | null }) => x.proveedor_id).filter((x: number | null): x is number => x != null))];
    const pn: Record<number, string> = {};
    if (pids.length) for (const p of (await sb.from("proveedores").select("id, nombre").in("id", pids)).data ?? []) pn[p.id] = p.nombre;
    for (const x of ss ?? []) sv[x.id] = { moneda: x.moneda ?? "COP", destino_id: x.destino_id ?? null, proveedor_id: x.proveedor_id, proveedor: x.proveedor_id != null ? (pn[x.proveedor_id] ?? null) : null };
  }
  const servicios = e.servicios.map((x) => {
    if (x.servicioId == null) return { ...x, proveedorId: null };
    const f = sv[x.servicioId];
    if (!f) { errores.push(`El servicio «${x.nombre}» no existe.`); return x; }
    if (!destinoCoincide(f.destino_id, x.destinoId, e.destinoId)) errores.push(`El servicio «${x.nombre}» es de otro destino que el declarado en el paquete.`);
    if (f.moneda !== e.moneda) errores.push(`El servicio «${x.nombre}» está en ${f.moneda} y el paquete en ${e.moneda}.`);
    return { ...x, proveedorId: f.proveedor_id, proveedor: f.proveedor ?? "" };
  });
  let serviciosFinal = servicios;
  const sin = serviciosSinProveedor(servicios);
  if (sin.length) avisos.push(mensajeSinProveedor(sin));

  // Servicios vinculados que este producto no sabe cobrar (traslados/combos o con suplementos por horario).
  if (idsSv.length) {
    try {
      const fichas = await cargarFichasServicio(createAdminClient(), idsSv);
      for (const x of e.servicios) { const fi = x.servicioId != null ? fichas.get(x.servicioId) : undefined; if (fi?.noSoportado) errores.push(`El servicio «${x.nombre}» ${fi.noSoportado}`); }
      // Solo PVP por componente: un servicio por persona cuya ficha cobra al infante necesita su PVP definido (0 = gratis, explícito); nunca se vuelve gratis en silencio.
      serviciosFinal = servicios.map((x) => {
        const fi = x.servicioId != null ? fichas.get(x.servicioId) : undefined;
        if (!fi || e.esquema !== "solo_pvp" || e.pvpModo !== "por_componente" || fi.modo !== "persona") return { ...x, pvpInfante: null };
        if (x.pvpInfante == null && cobraInfante(fi)) { errores.push(`El servicio «${x.nombre}» cobra al infante (menor de 2 años): define su PVP de infante (0 si es gratis).`); return x; }
        if (x.pvpInfante != null && !(Number.isFinite(x.pvpInfante) && x.pvpInfante >= 0)) { errores.push(`El PVP de infante de «${x.nombre}» no es válido.`); return x; }
        return { ...x, pvpInfante: x.pvpInfante ?? 0 };
      });
    } catch { errores.push("No se pudo leer la ficha de un servicio. Intenta de nuevo."); }
  }

  // Hoteles: categoría de habitación y plan de alimentación salen del MISMO catálogo que los hoteles normales (manual) o de lo configurado en la ficha (vinculado).
  if (e.usaHotel && e.hoteles.length) {
    const adm = createAdminClient();
    const cat = await cargarCatalogoHotel(adm);
    const fichaIds = e.hoteles.map((h) => h.hotelId).filter((x): x is number => x != null);
    const opc = await cargarOpcionesHotelFicha(adm, fichaIds);
    for (const h of e.hoteles) {
      const nom = h.nombre || "manual";
      if (h.hotelId == null) {
        if (h.categoria && !cat.categorias.includes(h.categoria)) errores.push(`Hotel «${nom}»: la categoría de habitación «${h.categoria}» no existe en el catálogo (Producto → Configuración).`);
        if (h.regimen && !cat.regimenes.includes(h.regimen)) errores.push(`Hotel «${nom}»: el plan de alimentación «${h.regimen}» no existe en el catálogo (Producto → Configuración).`);
      } else {
        const o = opc.get(h.hotelId) ?? { categorias: [], regimenes: [] };
        if (h.categoria && o.categorias.length && !o.categorias.includes(h.categoria)) errores.push(`Hotel «${nom}»: la categoría «${h.categoria}» no está configurada en la ficha del hotel.`);
        if (h.regimen && o.regimenes.length && !o.regimenes.includes(h.regimen)) errores.push(`Hotel «${nom}»: el plan de alimentación «${h.regimen}» no está configurado en la ficha del hotel.`);
      }
    }
    // Con ficha, lo que el hotel solo tiene una opción se completa solo (no se pide configurar otra vez); la capacidad y las edades NO se guardan: se leen de la ficha.
    // Información del hotel con ficha: estrellas, descripción y ubicación se COPIAN de la ficha (autoritativo, no se confía en el navegador). Si la ficha no tiene el dato, se deja
    // lo que ya traía la fila (vacío = sin dato): nunca se inventa un valor.
    // Si la lectura falla se detiene el guardado (errores no vacío ⇒ no se escribe nada): no se guarda un hotel «sin estrellas» por un fallo de lectura.
    let info = new Map<number, Awaited<ReturnType<typeof cargarInfoHotelesFicha>> extends Map<number, infer V> ? V : never>();
    try { info = await cargarInfoHotelesFicha(adm, fichaIds); }
    catch { errores.push("No se pudo leer las estrellas, la descripción y la ubicación de la ficha del hotel vinculado. No se guardó nada; intenta de nuevo en unos minutos."); }
    e = { ...e, hoteles: e.hoteles.map((h) => {
      if (h.hotelId == null) return h;
      const o = opc.get(h.hotelId) ?? { categorias: [], regimenes: [] };
      const f = info.get(h.hotelId);
      return { ...h, estrellas: f?.estrellas ?? h.estrellas, descripcion: f?.descripcion || h.descripcion, ubicacion: f?.ubicacion || h.ubicacion, categoria: h.categoria || (o.categorias.length === 1 ? o.categorias[0] : ""), regimen: h.regimen || (o.regimenes.length === 1 ? o.regimenes[0] : ""), capacidadNinos: null, edadInfanteMax: null, edadNinoMax: null };
    }) };
  }

  // Hoteles ficha: misma moneda que el paquete.
  const idsH = [...new Set(e.hoteles.map((h) => h.hotelId).filter((x): x is number => x != null))];
  if (idsH.length) {
    const mon: Record<number, string> = {};
    for (const h of (await sb.from("hoteles").select("id, moneda").in("id", idsH)).data ?? []) mon[h.id] = h.moneda ?? "COP";
    for (const h of e.hoteles) if (h.hotelId != null && (mon[h.hotelId] ?? "COP") !== e.moneda) errores.push(`El hotel «${h.nombre}» está en ${mon[h.hotelId] ?? "COP"} y el paquete en ${e.moneda}.`);
  }
  return { e: { ...e, vuelos, servicios: serviciosFinal }, errores, avisos, destinos };
}

export async function guardarPaqueteTotal(entrada: EntradaPaqueteTotal): Promise<Result> {
  const ctx = await contexto();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { sb, raw } = ctx;
  const comp = await completarDesdeFichas(sb, entrada);
  if (comp.errores.length) return { ok: false, error: comp.errores[0] };
  const e = comp.e;
  const errores = validarOpciones(e, comp.destinos);
  if (errores.length) return { ok: false, error: errores[0] };

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
    nombre: e.nombre.trim(), destino_id: e.destinoId, multidestino: e.multidestino, destinos_extra: e.multidestino ? e.destinosExtra : [], moneda: e.moneda, esquema: e.esquema, pvp_modo: e.esquema === "solo_pvp" ? e.pvpModo : null,
    pct_mk: neta ? e.pctMkPct / 100 : 0, usa_vuelo: e.usaVuelo, usa_hotel: e.usaHotel, usa_servicios: e.usaServicios, noches: e.noches,
    compra_inicio: e.compraInicio || null, compra_fin: e.compraFin || null, viaje_inicio: e.viajeInicio || null, viaje_fin: e.viajeFin || null,
    pvp_general: general ? e.pvpGeneral : null, total_declarado: null, // «Total declarado» ya no existe en el formulario: nunca se guarda, venga lo que venga
    descripcion: e.descripcion || null, incluye: e.incluye || null, no_incluye: e.noIncluye || null,
    // La agencia la fija la base con la del usuario; solo superadmin puede elegirla (la de la sesión validada).
    tenant: ctx.superadmin ? ctx.tenant : undefined,
  };
  const vuelos = e.usaVuelo ? e.vuelos.map((v) => ({ empaquetado_id: v.empaquetadoId, destino_id: v.destinoId, aerolinea: v.aerolinea || null, ruta: v.ruta || null, origen_iata: v.origenIata || null, destino_iata: v.destinoIata || null, fecha_ida: v.fechaIda || null, fecha_regreso: v.fechaRegreso || null, proveedor: v.proveedor || null, neto: neta ? v.neto : {}, pvp: porComp ? v.pvp : {} })) : [];
  const hoteles = e.usaHotel ? e.hoteles.map((h) => ({ hotel_id: h.hotelId, nombre: h.nombre.trim(), categoria: h.categoria || null, regimen: h.regimen || null, descripcion: h.descripcion || null, foto_url: h.fotoUrl || null, estrellas: h.estrellas, ubicacion: h.ubicacion.trim() || null, proveedor: h.proveedor || null, neto: neta ? h.neto : {}, pvp: porComp ? h.pvp : {}, pvp_general: general ? h.pvpGeneral : null, capacidad_ninos: h.hotelId == null ? h.capacidadNinos : null, edad_infante_max: h.hotelId == null ? h.edadInfanteMax : null, edad_nino_max: h.hotelId == null ? h.edadNinoMax : null })) : [];
  const servicios = e.usaServicios ? e.servicios.map((s) => ({ servicio_id: s.servicioId, destino_id: s.destinoId, nombre: s.nombre.trim(), proveedor: s.proveedor || null, neto: neta && s.servicioId == null ? s.neto : null, pvp: porComp ? s.pvp : null, pvp_infante: porComp && s.servicioId != null ? s.pvpInfante : null })) : [];

  // UNA sola llamada = una transacción: un error en cualquier hijo deja el paquete y sus hijos como estaban.
  const { data: id, error } = await raw.rpc("guardar_paquete_din", {
    p_id: e.id ?? null, p_cabecera: cabecera as unknown as Json, p_vuelos: vuelos as unknown as Json, p_hoteles: hoteles as unknown as Json, p_servicios: servicios as unknown as Json,
  } as never);
  if (error || id == null) return { ok: false, error: (error?.message ?? "No se pudo guardar el paquete.").replace(/^DIN_82_[A-Z_]+:\s*/, "") };
  revalidatePath("/dashboard/paquetes");
  revalidatePath("/tarifario");
  const avisos = [...(e.id ? ["El paquete quedó sin publicar tras editarlo; vuelve a publicarlo."] : []), ...comp.avisos];
  return { ok: true, id: Number(id), avisos: avisos.length ? avisos : undefined };
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
    // La ficha del servicio pudo cambiar desde que se guardó el paquete: se vuelve a leer su proveedor.
    const vinc = (s as { servicio_id: number | null; nombre: string }[]).filter((x) => x.servicio_id != null);
    if (vinc.length) {
      const { data: fichas } = await sb.from("servicios_adicionales").select("id, proveedor_id").in("id", vinc.map((x) => x.servicio_id));
      const con = new Set((fichas ?? []).filter((f: { proveedor_id: number | null }) => f.proveedor_id != null).map((f: { id: number }) => f.id));
      const faltan = vinc.filter((x) => !con.has(x.servicio_id as number)).map((x) => x.nombre);
      if (faltan.length) return { ok: false, error: `No se puede publicar: ${mensajeSinProveedor(faltan)}` };
    }
    if (msgs.size) return { ok: false, error: `No se puede publicar: ${[...msgs][0]}` };
  }
  const { error } = await sb.from("paquete_din").update({ publicado, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: String(error.message).replace(/^DIN_82_[A-Z_]+:\s*/, "") };
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
