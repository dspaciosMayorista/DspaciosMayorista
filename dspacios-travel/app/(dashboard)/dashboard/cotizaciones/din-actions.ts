"use server";
// Cotización de un paquete 100 % dinámico (#82): crear (por canal), editar valores con versión, registrar costos reales
// y marcar la versión mostrada al cliente. Envuelve la cotización manual por RPC propias (migraciones 274/275);
// la conversión a contrato la sigue haciendo `convertirCotizacionManualAContrato` (que enruta por
// `convertir_cotizacion_din` cuando la cotización pertenece a un paquete dinámico).
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contextoCotizacion, autorizaTenant } from "@/lib/cotizacion/acceso";
import { resolverVigenciaCotizacion, hoyBogota } from "@/lib/cotizacion/vigencia";
import { validarMotivo, validarRevision, mensajeEdicion39 } from "@/lib/cotizacion/edicionServiciosManual";
import { altaPersonasCotizacion, logPersonasCotizacion } from "@/lib/personas/consulta";
import { AVISO_PERSONAS_PENDIENTES } from "@/lib/personas/cotizacion";
import { codigoErrorContacto, datosContactoTarifario, logContactoTarifario, origenContactoTarifario } from "@/lib/crm/contactoTarifario";
import { armarPaqueteCalc, type FilaHotelDin, type FilaPaqueteDin, type FilaServicioDin, type FilaVueloDin } from "@/lib/paqueteDinamico/modelo";
import { construirCotizacionDin, reliquidarComponentes, type ClienteDin } from "@/lib/paqueteDinamico/cotizacion";
import { composicionValida, type Composicion } from "@/lib/paqueteDinamico/calculo";
import { ROLES_PRODUCTO } from "@/lib/paqueteDinamico/entrada";
import { contactoVisitanteValido, resolverCanalDin, validarSolicitudDin, type CanalDin } from "@/lib/paqueteDinamico/solicitud";
import type { Json } from "@/types/database";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Quita el código técnico del mensaje de las RPC (`DIN_82_X: texto`). */
function mensajeDin(msg: string | undefined | null, porDefecto = "No se pudo completar la operación."): string {
  const m = String(msg ?? "").trim();
  if (!m) return porDefecto;
  if (/^DIN_82_/.test(m)) return m.replace(/^DIN_82_[A-Z_]+:\s*/, "");
  if (/^EDICION_39_/.test(m)) return mensajeEdicion39(m, porDefecto);
  if (/(duplicate key|violates|constraint "|relation "|pg_|sqlstate)/i.test(m)) return porDefecto;
  return m;
}

type Perfil = { id: string; rol: string; nombre: string; tenant: string; email: string | null; agenciaNombre: string; freelanceNombre: string };

/** Sesión + perfil, o null si no hay sesión (visitante). Un perfil inactivo devuelve `{ inactivo: true }`. */
async function sesionPerfil(): Promise<Perfil | null | "inactivo"> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: u } = await sb.from("usuarios").select("rol, activo, nombre, tenant, email, aliado_id").eq("id", user.id).maybeSingle();
  if (!u || u.activo !== true) return "inactivo";
  // Nombre comercial del aliado (para el documento): el de su ficha del catálogo; si no tiene, el del usuario.
  let aliado: string | null = null;
  if (u.aliado_id != null) {
    const { data: a } = await createAdminClient().from("aliados").select("nombre").eq("id", u.aliado_id).maybeSingle();
    aliado = a?.nombre ?? null;
  }
  return {
    id: user.id, rol: String(u.rol), nombre: String(u.nombre ?? ""), tenant: String(u.tenant ?? "mayorista"), email: u.email ?? null,
    agenciaNombre: String(aliado ?? u.nombre ?? ""), freelanceNombre: String(aliado ?? u.nombre ?? ""),
  };
}

async function usuarioSesion(): Promise<{ id: string; rol: string; nombre: string } | null> {
  const p = await sesionPerfil();
  return p && p !== "inactivo" ? { id: p.id, rol: p.rol, nombre: p.nombre } : null;
}

async function urlPublica(token: string | null | undefined): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host && token ? `${proto}://${host}/cot/${token}` : "";
}

export type CrearCotizacionDinInput = {
  paqueteId: number; hotelId: number | null; vueloId: number | null; composicion: Composicion;
  cliente: ClienteDin; fechaIda: string; fechaRegreso: string; vigenciaHasta?: string;
  plazo?: string; observaciones?: string;
};

/**
 * Crea la cotización por el canal que resuelve el SERVIDOR (visitante, aliado B2B o personal interno). Los precios y las reglas
 * (paquete activo y publicado, vigencias, noches, vuelo/hotel) salen siempre de la base, nunca del navegador, y la base los valida
 * otra vez con la fila viva: una página o petición vieja no se salta nada.
 */
export async function crearCotizacionDin(input: CrearCotizacionDinInput): Promise<R<{ id: number; destino: "dashboard" | "portal" | "publico"; enlace: string; avisoPersonas?: string }>> {
  if (!composicionValida(input.composicion)) return { ok: false, error: "La composición de habitaciones y menores no es válida." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "No se pudo crear la cotización por un problema de configuración del servidor." };

  const sesion = await sesionPerfil();
  if (sesion === "inactivo") return { ok: false, error: "Tu usuario no está activo." };
  const resuelto = resolverCanalDin(sesion ? { rol: sesion.rol, activo: true } : "anonimo");
  if (!resuelto.ok) return { ok: false, error: resuelto.error };
  const canal: CanalDin = resuelto.canal;
  const ctx = canal === "interno" ? await contextoCotizacion() : null;
  if (canal === "interno" && !ctx?.ok) return { ok: false, error: "No autorizado." };
  // La vigencia de la cotización la elige solo el personal interno (#40 E3).
  if (canal !== "interno" && input.vigenciaHasta?.trim()) return { ok: false, error: "No tienes permiso para elegir la vigencia." };
  if (canal === "publico" && !contactoVisitanteValido(input.cliente)) return { ok: false, error: "Indica tu nombre y un correo o teléfono de contacto válidos." };

  // Los PRECIOS y las reglas salen siempre de la base (nunca del navegador).
  const admin = createAdminClient();
  const { data: p } = await admin.from("paquete_din" as never).select("*").eq("id", input.paqueteId).maybeSingle() as { data: (FilaPaqueteDin & { activo: boolean; publicado: boolean; tenant: string; destino_id: number | null; compra_inicio: string | null; compra_fin: string | null; viaje_inicio: string | null; viaje_fin: string | null }) | null };
  if (!p) return { ok: false, error: "El paquete no existe." };
  // Agencia: el visitante solo ve paquetes de mayorista; el aliado B2B, los de su agencia; el personal, los de la suya.
  const agenciaOk = canal === "publico" ? p.tenant === "mayorista"
    : canal === "b2b" ? sesion !== null && sesion.tenant === p.tenant
      : !!ctx && autorizaTenant(ctx, p.tenant);
  if (!agenciaOk) return { ok: false, error: "Este paquete no está disponible para tu usuario." };

  const [hs, vs, ss, dest] = await Promise.all([
    admin.from("paquete_din_hoteles" as never).select("*").eq("paquete_id", p.id).order("orden"),
    admin.from("paquete_din_vuelos" as never).select("*").eq("paquete_id", p.id).order("orden"),
    admin.from("paquete_din_servicios" as never).select("*").eq("paquete_id", p.id).order("orden"),
    p.destino_id ? admin.from("destinos").select("nombre").eq("id", p.destino_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const hotel = ((hs.data ?? []) as unknown as FilaHotelDin[]).find((h) => h.id === input.hotelId) ?? null;
  const vuelo = ((vs.data ?? []) as unknown as (FilaVueloDin)[]).find((v) => v.id === input.vueloId) ?? null;

  const regla = validarSolicitudDin({
    paquete: p, hoy: hoyBogota(), ida: input.fechaIda, regreso: input.fechaRegreso,
    hotelPerteneceAlPaquete: !!hotel, vueloEncontrado: vuelo, hotelElegido: input.hotelId != null, vueloElegido: input.vueloId != null,
  });
  if (!regla.ok) return { ok: false, error: regla.error };

  const calc = armarPaqueteCalc(p, hotel, vuelo, (ss.data ?? []) as unknown as FilaServicioDin[]);
  if (input.composicion.servicios && p.usa_servicios) {
    const ids = new Set(((ss.data ?? []) as unknown as FilaServicioDin[]).map((s) => String(s.id)));
    if (input.composicion.servicios.some((s) => !ids.has(String(s)))) return { ok: false, error: "Un servicio elegido no pertenece al paquete." };
  }

  const vig = resolverVigenciaCotizacion({ hoy: hoyBogota(), fechaSalida: input.fechaIda || null, vigenciaSolicitada: input.vigenciaHasta, diasPorDefecto: 3 });
  if (!vig.ok) return { ok: false, error: vig.error };
  const perfil = sesion ?? null;
  const tipoAsesor = canal === "b2b" ? (perfil?.rol === "agencia" ? "agencia" : "freelance") : "interno";
  const armado = construirCotizacionDin({
    paqueteId: p.id, paqueteNombre: p.nombre, destino: ((dest.data as { nombre?: string } | null)?.nombre ?? "").toUpperCase(),
    hotelId: hotel?.id ?? null, vueloId: vuelo?.id ?? null, calc, composicion: input.composicion, cliente: input.cliente,
    fechaIda: input.fechaIda, fechaRegreso: input.fechaRegreso, vigenciaHasta: vig.vigencia, tipoAsesor,
    asesorInterno: canal === "interno" ? (perfil?.nombre ?? "") : "Tarifario web",
    agenciaNombre: canal === "b2b" ? (perfil?.agenciaNombre ?? "") : "", freelanceNombre: canal === "b2b" ? (perfil?.freelanceNombre ?? "") : "",
    plazo: input.plazo, observaciones: input.observaciones, fechaEmision: hoyBogota(),
  });
  if (!armado.ok) return armado;

  const { data: id, error } = canal === "interno"
    ? await admin.rpc("crear_cotizacion_din", {
      p_usuario_id: perfil!.id, p_tenant: ctx && ctx.ok ? ctx.tenant : p.tenant, p_paquete_id: p.id,
      p_cabecera: armado.cabecera as unknown as Json, p_servicios: armado.servicios as unknown as Json,
    })
    : await admin.rpc("crear_cotizacion_din_externa", {
      p_canal: canal, p_actor: canal === "b2b" ? (perfil?.id ?? null) : null, p_paquete_id: p.id,
      p_cabecera: armado.cabecera as unknown as Json, p_servicios: armado.servicios as unknown as Json,
    } as never);
  if (error || id == null) return { ok: false, error: mensajeDin(error?.message, "No se pudo crear la cotización.") };

  // CRM (#42): el titular de la cotización debe quedar consultable. Con sesión (aliado B2B o personal) entra al registro de personas
  // (el autor ya lo estampó la base). El visitante sin sesión NO puede: ese registro solo admite anónimos de tipo `carrito` (migración 219,
  // `p214_priv.cotizacion_anonima`) y esta cotización es de tipo `manual` para poder convertirse; se verificó en local (`no_autorizado`).
  // Para él se usa el mismo contacto auxiliar de CRM que el checkout público (`crm_contactos`, Mayorista, cliente final).
  let alta: { ok: true } | { ok: false; etapa: "sello" | "registro"; codigo: string | null } = { ok: true };
  if (canal === "publico") {
    try {
      const datos = datosContactoTarifario(input.cliente, input.cliente.numeroDoc.trim() ? input.cliente.tipoDoc : null);
      if (datos) {
        const { error: eCrm } = await admin.from("crm_contactos").insert({ categoria: "cliente_final", ...datos, origen: origenContactoTarifario({ asistida: false, aliadoAutenticado: false }), tenant: "mayorista" });
        const codigo = codigoErrorContacto(eCrm);
        if (codigo) console.error(logContactoTarifario(codigo));
      }
    } catch {
      console.error(logContactoTarifario("excepcion"));
    }
  } else {
    alta = await altaPersonasCotizacion(admin, {
      fila: { id: Number(id), tenant: p.tenant, tipo: "manual", payload: armado.cabecera.payload as Json, creado_por_id: perfil?.id ?? null },
      usuarioId: perfil?.id ?? null, sellar: false,
    });
    if (!alta.ok) console.error(logPersonasCotizacion("manual", Number(id), alta));
  }

  revalidatePath("/dashboard/cotizaciones");
  let destino: "dashboard" | "portal" | "publico" = "dashboard";
  let enlace = `/dashboard/cotizaciones/${Number(id)}`;
  if (canal === "b2b") { destino = "portal"; enlace = "/portal/b2b/cotizaciones"; }
  if (canal === "publico") {
    const { data: fila } = await admin.from("cotizaciones").select("share_token").eq("id", Number(id)).maybeSingle();
    destino = "publico";
    enlace = await urlPublica(fila?.share_token) || "/tarifario";
  }
  return alta.ok ? { ok: true, id: Number(id), destino, enlace } : { ok: true, id: Number(id), destino, enlace, avisoPersonas: AVISO_PERSONAS_PENDIENTES };
}

export type ComponenteEditado = { orden: number; valor: number; costoNeto?: number; proveedor?: string };

/** Edita los VALORES (y opcionalmente costos) de los componentes; crea una versión nueva con motivo. */
export async function editarCotizacionDin(cotizacionId: number, input: { revEsperada: number; motivo: string; componentes: ComponenteEditado[] }): Promise<R<{ version: number }>> {
  if (!(Number(cotizacionId) > 0)) return { ok: false, error: "Cotización inválida." };
  const rev = validarRevision(input?.revEsperada);
  if (rev == null) return { ok: false, error: "Recarga la página e inténtalo de nuevo." };
  const motivo = validarMotivo(input?.motivo);
  if (!motivo.ok) return motivo;
  const usuario = await usuarioSesion();
  if (!usuario) return { ok: false, error: "No autorizado." };
  const ctx = await contextoCotizacion();
  const admin = createAdminClient();
  const { data: cot } = await admin.from("cotizaciones").select("tenant, payload, destino, fecha_salida, fecha_regreso, paquete_din_id" as never).eq("id", cotizacionId).maybeSingle() as { data: { tenant: string; payload: { dinamico?: { resumenPax?: string } } | null; destino: string | null; fecha_salida: string | null; fecha_regreso: string | null; paquete_din_id: number | null } | null };
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  if (!cot.paquete_din_id) return { ok: false, error: "Esta cotización no pertenece a un paquete dinámico." };

  const { data: filas } = await admin.from("cotizacion_servicios").select("*").eq("cotizacion_id", cotizacionId).order("orden");
  const actuales = filas ?? [];
  const porOrden = new Map(input.componentes.map((c) => [Number(c.orden), c]));
  if (porOrden.size !== input.componentes.length || input.componentes.some((c) => !actuales.some((f) => f.orden === Number(c.orden)))) {
    return { ok: false, error: "Los componentes enviados no corresponden a la cotización." };
  }
  // El rol sin acceso financiero (venta) puede cambiar valores al cliente pero no costos: se conservan los guardados.
  const puedeCostos = (ROLES_PRODUCTO as readonly string[]).includes(usuario.rol);
  const nuevos = actuales.map((f) => {
    const c = porOrden.get(f.orden);
    const costo = c && puedeCostos && c.costoNeto != null ? Number(c.costoNeto) : Number(f.costo_neto);
    const prov = c && puedeCostos && c.proveedor != null ? c.proveedor.trim() : (f.proveedor ?? "");
    return {
      tipo_servicio: f.tipo_servicio, plataforma: f.plataforma, nombre_servicio: f.nombre_servicio, proveedor: prov || null, costo_neto: costo,
      modo: "mk", pct_markup: Number(f.pct_markup) || 0, ta: 0, valor: c ? Number(c.valor) : Number(f.valor),
      componente: (f as { componente?: string | null }).componente ?? null, exige_costo: (f as { exige_costo?: boolean }).exige_costo === true,
    };
  });
  if (nuevos.some((n) => !Number.isFinite(n.costo_neto) || n.costo_neto < 0)) return { ok: false, error: "Un costo no puede ser negativo." };
  const r = reliquidarComponentes({ componentes: nuevos, destino: cot.destino ?? "", fechaIda: cot.fecha_salida ?? "", fechaRegreso: cot.fecha_regreso ?? "", resumenPax: cot.payload?.dinamico?.resumenPax ?? "" });
  if ("error" in r) return { ok: false, error: r.error };

  const { data, error } = await admin.rpc("editar_cotizacion_din", {
    p_usuario_id: usuario.id, p_cotizacion_id: cotizacionId, p_rev_esperada: rev, p_motivo: motivo.motivo,
    p_servicios: nuevos as unknown as Json, p_cambios: { precio_venta: r.total, items: r.items } as unknown as Json,
  });
  if (error || data == null) return { ok: false, error: mensajeDin(error?.message, "No se pudo editar la cotización.") };
  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, version: Number(data) };
}

/** Registra el costo real y el proveedor de cada componente (obligatorio en solo PVP antes de convertir). */
export async function registrarCostosCotizacionDin(cotizacionId: number, costos: { orden: number; costoNeto: number; proveedor: string }[]): Promise<R<{ pendientes: string[] }>> {
  if (!(Number(cotizacionId) > 0)) return { ok: false, error: "Cotización inválida." };
  const usuario = await usuarioSesion();
  if (!usuario) return { ok: false, error: "No autorizado." };
  if (!(ROLES_PRODUCTO as readonly string[]).includes(usuario.rol)) return { ok: false, error: "No tienes permiso para registrar costos." };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("registrar_costos_cotizacion_din", {
    p_usuario_id: usuario.id, p_cotizacion_id: cotizacionId,
    p_costos: costos.map((c) => ({ orden: c.orden, costo_neto: c.costoNeto, proveedor: c.proveedor })) as unknown as Json,
  });
  if (error) return { ok: false, error: mensajeDin(error.message, "No se pudieron registrar los costos.") };
  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  return { ok: true, pendientes: (data ?? []) as string[] };
}

export async function marcarVersionMostrada(cotizacionId: number, version: number): Promise<R> {
  const usuario = await usuarioSesion();
  if (!usuario) return { ok: false, error: "No autorizado." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("marcar_version_mostrada", { p_usuario_id: usuario.id, p_cotizacion_id: cotizacionId, p_version: version });
  if (error) return { ok: false, error: mensajeDin(error.message) };
  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  return { ok: true };
}
