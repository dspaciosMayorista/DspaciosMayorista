"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { contextoCotizacion, autorizaTenant } from "@/lib/cotizacion/acceso";
import { ROLES_CONTRATO_COMPLETO } from "@/lib/roles";
import { hoyBogota, resolverVigenciaCotizacion } from "@/lib/cotizacion/vigencia";
import type { Json } from "@/types/database";
import {
  construirComparativaManual, mensajeErrorComparativa, validarClaveIdempotencia, type EntradaComparativaManual,
} from "@/lib/cotizacion/comparativa";
import {
  construirCotizacionManual, reliquidarServicios, reliquidarRecobroNinos,
  type CotizacionManualInput, type ServicioManual, type RecobroNinosInput,
} from "@/lib/cotizacion/liquidacionManual";
import { mensajeEdicion39, validarMotivo, validarRevision } from "@/lib/cotizacion/edicionServiciosManual";

// Los tipos viven en lib/cotizacion/liquidacionManual.ts (la fórmula única de
// creación y edición); se re-exportan para no romper a quien ya los importa.
export type { CotizacionManualInput, ServicioManual, RecobroNinosInput };

/**
 * Titular e incluye escriben `payload`/`detalle` completos a partir de lo que
 * leyeron. Si mientras tanto alguien editó servicios o recobro, la frontera de
 * la 217 rechaza esa escritura (llevaría datos económicos viejos): se pide
 * recargar en vez de pisar la edición.
 */
function errorDatoNoEconomico(msg: string): string {
  return /FRONTERA_39/.test(String(msg ?? ""))
    ? "La cotización cambió mientras la editabas; recarga la página y vuelve a intentarlo."
    : mensajeEdicion39(msg, msg);
}

/** Usuario de la sesión (id real) o null. */
async function usuarioSesion(): Promise<{ id: string } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user ? { id: user.id } : null;
}

export async function crearCotizacionManual(
  input: CotizacionManualInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (!`${input.cliente?.nombres ?? ""}${input.cliente?.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del cliente es obligatorio." };
  const vigenciaRes = resolverVigenciaCotizacion({
    hoy: hoyBogota(),
    fechaSalida: input.fechaIda || null,
    vigenciaSolicitada: input.vigenciaHasta,
    diasPorDefecto: 3,
  });
  // La liquidación (servicios, recobro, niños, documento) es la fórmula única de
  // lib/cotizacion/liquidacionManual.ts; la RPC vuelve a exigir que el total cuadre.
  const armado = construirCotizacionManual(input, { vigencia: vigenciaRes.ok ? vigenciaRes.vigencia : "" });
  if (!armado.ok) return armado;
  if (!vigenciaRes.ok) return { ok: false, error: vigenciaRes.error };

  // Acción INTERNA (clasificación explícita, ver revisión de PR #267): único
  // caller es `CotizacionManualForm.tsx` bajo `/dashboard/cotizaciones/nueva`
  // (ruta protegida por `proxy.ts`), pero al ser una Server Action exportada
  // es igual de alcanzable directo por red — así que exige sesión aquí
  // también. `getTenant()` a secas cae en silencio a "mayorista" sin sesión
  // (ver lib/tenant.server.ts); `contextoCotizacion()` falla cerrado si no
  // hay perfil o `activo !== true`, y solo entonces resuelve el tenant real.
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { ok: false, error: "No autorizado." };
  const tenantCotizacion = ctx.tenant;
  const usuario = await usuarioSesion();
  if (!usuario) return { ok: false, error: "No autorizado." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "No se pudo crear la cotización por un problema de configuración del servidor." };
  }

  // #39: la cabecera y los servicios se crean en UNA transacción por la RPC
  // SECURITY DEFINER, que estampa el autor estable (`creado_por_id`): la API ya
  // no escribe esa columna (211) ni, tras la 217, los servicios.
  const admin = createAdminClient();
  const { data: id, error } = await admin.rpc("crear_cotizacion_manual", {
    p_usuario_id: usuario.id,
    p_tenant: tenantCotizacion,
    p_cabecera: armado.cabecera as unknown as Json,
    p_servicios: armado.servicios as unknown as Json,
  });
  if (error || id == null) return { ok: false, error: mensajeEdicion39(error?.message, "No se pudo crear la cotización.") };

  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, id: Number(id) };
}

// ── Editar los servicios de una cotización dinámica (#39 fase 1) ────────────
// Modificar, quitar o agregar servicios de una manual simple ABIERTA que nunca
// tuvo pago (no madre ni hija de la 211, vigente). Recalcula total y documento
// conservando niños y recobro, con motivo obligatorio e historial. La RPC
// bloquea la fila y vuelve a comprobar TODO (incluida la revisión esperada).
export type EditarServiciosInput = { revEsperada: number; motivo: string; servicios: ServicioManual[] };

export async function editarServiciosCotizacionManual(
  cotizacionId: number,
  input: EditarServiciosInput
): Promise<{ ok: true; rev: number } | { ok: false; error: string }> {
  if (!(Number(cotizacionId) > 0)) return { ok: false, error: "Cotización inválida." };
  const rev = validarRevision(input?.revEsperada);
  if (rev == null) return { ok: false, error: "Recarga la página e inténtalo de nuevo." };
  const motivo = validarMotivo(input?.motivo);
  if (!motivo.ok) return motivo;

  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("payload, estado, tipo, tenant, pax, destino, fecha_salida, fecha_regreso")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  if (cot.tipo !== "manual" || cot.estado !== "abierta")
    return { ok: false, error: "Solo se puede editar una cotización dinámica abierta." };

  const r = reliquidarServicios(cot, Array.isArray(input?.servicios) ? input.servicios : []);
  if (!r.ok) return r;

  const usuario = await usuarioSesion();
  if (!usuario) return { ok: false, error: "No autorizado." };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("editar_servicios_cotizacion_manual", {
    p_usuario_id: usuario.id,
    p_cotizacion_id: cotizacionId,
    p_rev_esperada: rev,
    p_motivo: motivo.motivo,
    p_servicios: r.servicios as unknown as Json,
    p_cambios: r.cambios as unknown as Json,
  });
  if (error || data == null) return { ok: false, error: mensajeEdicion39(error?.message) };

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, rev: Number(data) };
}

// ── Editar los datos del titular de una cotización dinámica ─────────────────
// Permite completar/corregir el titular (incl. fecha de nacimiento) antes de
// generar el contrato. Solo en estado 'abierta'.
export type TitularInput = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; nacimiento: string; telefono: string; email: string };

export async function actualizarTitularCotizacionManual(
  cotizacionId: number,
  titular: TitularInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("payload, detalle, estado, tipo, tenant")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  if (cot.tipo !== "manual" || cot.estado !== "abierta")
    return { ok: false, error: "Solo se puede editar el titular de una cotización dinámica abierta." };
  if (!`${titular.nombres ?? ""}${titular.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del titular es obligatorio." };

  const nombre = `${titular.nombres ?? ""} ${titular.apellidos ?? ""}`.trim();
  const payload = { ...((cot.payload ?? {}) as Record<string, unknown>) };
  payload.cliente = {
    nombres: (titular.nombres || "").trim(),
    apellidos: (titular.apellidos || "").trim(),
    tipoDoc: (titular.tipoDoc || "CC").trim(),
    numeroDoc: (titular.numeroDoc || "").trim(),
    nacimiento: (titular.nacimiento || "").trim(),
    telefono: (titular.telefono || "").trim(),
    email: (titular.email || "").trim(),
  };
  const detalle = { ...((cot.detalle ?? {}) as Record<string, unknown>) };
  const ventaSnap = { ...((detalle.venta ?? {}) as Record<string, unknown>), cliente: nombre };
  detalle.venta = ventaSnap;

  // Solo si sigue abierta (#39): otra pestaña pudo convertirla o descartarla.
  // El titular no es un dato económico: la frontera de la 217 lo deja pasar.
  const { data: filas, error } = await sb
    .from("cotizaciones")
    .update({
      payload: JSON.parse(JSON.stringify(payload)),
      detalle: JSON.parse(JSON.stringify(detalle)),
      cliente: nombre,
      cliente_documento: (titular.numeroDoc || "").trim() || null,
    })
    .eq("id", cotizacionId)
    .eq("estado", "abierta")
    .select("id");
  if (error) return { ok: false, error: errorDatoNoEconomico(error.message) };
  if (!filas?.length) return { ok: false, error: "La cotización ya no está abierta; recarga la página." };

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  return { ok: true };
}

// ── Editar "Incluye / No incluye" de una cotización dinámica ───────────────
export async function actualizarIncluyeCotizacionManual(
  cotizacionId: number,
  incluye: string,
  noIncluye: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("detalle, payload, estado, tipo, tenant")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  if (cot.tipo !== "manual" || cot.estado !== "abierta")
    return { ok: false, error: "Solo se puede editar una cotización dinámica abierta." };

  const detalle = { ...((cot.detalle ?? {}) as Record<string, unknown>), incluye: (incluye || "").trim(), noIncluye: (noIncluye || "").trim() };
  const payload = { ...((cot.payload ?? {}) as Record<string, unknown>), incluye: (incluye || "").trim(), noIncluye: (noIncluye || "").trim() };

  // Solo si sigue abierta (#39). Incluye/no incluye no es económico: la frontera lo deja pasar.
  const { data: filas, error } = await sb
    .from("cotizaciones")
    .update({ detalle: JSON.parse(JSON.stringify(detalle)), payload: JSON.parse(JSON.stringify(payload)) })
    .eq("id", cotizacionId)
    .eq("estado", "abierta")
    .select("id");
  if (error) return { ok: false, error: errorDatoNoEconomico(error.message) };
  if (!filas?.length) return { ok: false, error: "La cotización ya no está abierta; recarga la página." };

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  return { ok: true };
}

// ── Editar niños y recobro de una cotización dinámica ──────────────────────
// Permite ajustar la cantidad/tarifa de niños y el recobro (oculto al cliente)
// después de creada la cotización. Recalcula la tarifa de adulto (que esconde
// el recobro), el subtotal de niños y el total.
// #39 (C5, decisión 1 del dueño): misma elegibilidad que editar servicios —
// nunca tras un pago previo (aunque se anule), ni en congeladas ni en hijas de
// una comparativa; `venta` solo en las propias. Motivo obligatorio e historial.
export async function actualizarRecobroNinosCotizacionManual(
  cotizacionId: number,
  input: RecobroNinosInput,
  control: { revEsperada: number; motivo: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("payload, estado, tipo, pax, destino, fecha_salida, fecha_regreso, tenant")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
  if (cot.tipo !== "manual" || cot.estado !== "abierta")
    return { ok: false, error: "Solo se puede editar una cotización dinámica abierta." };
  const rev = validarRevision(control?.revEsperada);
  if (rev == null) return { ok: false, error: "Recarga la página e inténtalo de nuevo." };
  const motivo = validarMotivo(control?.motivo);
  if (!motivo.ok) return motivo;

  // Subtotal de servicios ya liquidados (columna valor); no se re-liquida. La
  // RPC lo vuelve a sumar con la fila bloqueada y rechaza si no cuadra.
  const { data: servs } = await sb.from("cotizacion_servicios").select("valor").eq("cotizacion_id", cotizacionId);
  const totalServicios = (servs ?? []).reduce((a, s) => a + (Number(s.valor) || 0), 0);
  const r = reliquidarRecobroNinos(cot, totalServicios, input);

  const usuario = await usuarioSesion();
  if (!usuario) return { ok: false, error: "No autorizado." };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("actualizar_recobro_ninos_manual", {
    p_usuario_id: usuario.id,
    p_cotizacion_id: cotizacionId,
    p_rev_esperada: rev,
    p_motivo: motivo.motivo,
    p_cambios: r.cambios as unknown as Json,
  });
  if (error || data == null) return { ok: false, error: mensajeEdicion39(error?.message) };

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  return { ok: true };
}

// La misma lista que `_autorizado_pago_previo` en la migración 164 (Commit 5):
// la conversión a contrato es una operación de dinero — solo roles que firman
// contrato completo.
const ROLES_CONVERSION = new Set<string>(ROLES_CONTRATO_COMPLETO as string[]);

/** Sesión de un rol autorizado y activo (o null si no autorizado). */
async function sesionConversionAutorizada(): Promise<{ userId: string; rol: string } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb
    .from("usuarios")
    .select("rol, activo")
    .eq("id", user.id)
    .maybeSingle();
  // El RPC vuelve a validar rol + activo de forma autoritativa; este cheque solo
  // da un mensaje amable antes de delegar (defensa en profundidad, no la frontera).
  if (!perfil || !perfil.rol || perfil.activo === false) return null;
  if (!ROLES_CONVERSION.has(perfil.rol)) return null;
  return { userId: user.id, rol: perfil.rol };
}

/**
 * Mensajes de error "seguros" para el navegador: nunca fugan detalles internos
 * de PostgreSQL. Los `raise exception` de la migración 164 son frases en español
 * limpias y pasan tal cual; solo se enmascara lo que parezca error crudo de la BD.
 */
function mensajeSeguro(msg: string): string {
  const m = String(msg ?? "").trim();
  if (!m) return "No se pudo convertir la cotización a contrato. Inténtalo de nuevo.";
  if (/(duplicate key|violates (foreign key|not-null|check) constraint|constraint "|relation "|pg_|sqlstate|serialization failure|contradice la política|new row violates)/i.test(m)) {
    return "No se pudo convertir por un conflicto de datos. Reintenta; si persiste, revisa que los pagos previos y las condiciones estén correctos.";
  }
  return m;
}

// ── Convertir cotización dinámica (manual) a contrato ────────────────────────
// Commit 5: la conversión es ATÓMICA en la BD. El RPC `convertir_cotizacion_a_contrato`
// (migración 164, INVOKER solo service_role) valida rol/activo/tenant/estado/
// congelado/mínimo, genera el número con la función real del tenant, crea la venta
// y sus hijas (items, pasajero, aliados_b2b), copia las condiciones congeladas a
// `contrato_condiciones`, transfiere cada pago previo a abono, reclasifica
// 280510→280505, crea la CxP de proveedor + sus asientos de costo/proveedor, enlaza
// `ventas.cotizacion_id` y marca la cotización 'convertida' — o revierte TODO en un
// solo rollback. Idempotente: un replay o una conversión concurrente devuelve la
// misma venta sin duplicar nada ni consumir otro consecutivo de la numeración.
// Esta Server Action solo autentica al actor (rol autorizado + activo) y delega;
// no hay secuencias REST parciales ni builders duplicados (una sola ruta).
// #39: la ÚNICA puerta es el wrapper `convertir_cotizacion_manual_controlada`
// (migración 216): bloquea la cotización, emite la autorización de SU
// transacción y llama la RPC 198 SIN cambios, que sigue corriendo como
// service_role. Tras la 217, la 198 llamada directo ya no puede escribir.
export async function convertirCotizacionManualAContrato(
  cotizacionId: number
): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  if (!(Number(cotizacionId) > 0)) return { ok: false, error: "Cotización inválida." };
  const sesion = await sesionConversionAutorizada();
  if (!sesion) {
    return { ok: false, error: "No autorizado: convertir a contrato requiere superadmin, administración, gerencia u operaciones." };
  }

  const admin = createAdminClient();
  // #35: la madre comparativa no se convierte (el RPC y los triggers también lo impiden).
  const { data: madre } = await admin.from("cotizaciones").select("modo").eq("id", cotizacionId).maybeSingle();
  if (madre?.modo === "comparativa") return { ok: false, error: "Una comparativa no se convierte en contrato: elige una opción primero." };
  const rpc = await admin.rpc("convertir_cotizacion_manual_controlada", {
    p_cotizacion_id: cotizacionId,
    p_usuario_id: sesion.userId,
  });
  if (rpc.error) return { ok: false, error: mensajeSeguro(rpc.error.message) };

  const numero = String(rpc.data ?? "").trim();
  if (!numero || numero.toUpperCase().startsWith("ERROR")) {
    return { ok: false, error: numero || "No se pudo convertir la cotización a contrato." };
  }

  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/flujo-caja");

  return { ok: true, numero };
}


// ═════════════════════════════════════════════════════════════════════════
// #35 · COTIZACIÓN COMPARATIVA (manual / dinámica)
//
// Escoger UN hotel entre hasta tres del mismo viaje. Los vuelos (uno o varios
// tramos) y servicios son COMUNES y se cuentan UNA sola vez en el total de cada
// hotel; nunca se suman las alternativas entre sí. La MADRE no se cobra, no se
// convierte y es económicamente inmutable; al elegir se crea una HIJA que es
// una cotización dinámica común con solo lo común y la opción elegida.
// ═════════════════════════════════════════════════════════════════════════

/** Crea la comparativa manual de forma ATÓMICA (cabecera + servicios + opciones + sello) por RPC. */
export async function crearComparativaManual(
  input: EntradaComparativaManual
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  // Acción INTERNA: exige sesión y perfil activo (falla cerrado). El tenant sale
  // del perfil/cookie validada, nunca del navegador; para no superadmin la base
  // lo vuelve a fijar con el de su perfil.
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { ok: false, error: "No autorizado." };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autorizado." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "No se pudo crear la comparativa por un problema de configuración del servidor." };
  }
  const admin = createAdminClient();

  // El aliado SIEMPRE sale del catálogo (por id): su nombre pisa el texto libre.
  let entrada: EntradaComparativaManual = { ...input, tenant: ctx.tenant };
  if (input.aliadoId != null) {
    const { data: aliado } = await admin.from("aliados").select("id, nombre").eq("id", input.aliadoId).maybeSingle();
    if (!aliado) return { ok: false, error: "El aliado elegido no existe." };
    entrada = {
      ...entrada,
      agenciaNombre: input.tipoAsesor === "agencia" ? aliado.nombre : "",
      freelanceNombre: input.tipoAsesor === "freelance" ? aliado.nombre : "",
    };
  }
  const r = construirComparativaManual(entrada, { creadoPorEmail: user.email ?? null });
  if (!r.ok) return r;

  const { data: id, error } = await admin.rpc("crear_cotizacion_comparativa", {
    p_usuario_id: user.id,
    p_cabecera: r.datos.cabecera as unknown as Json,
    p_servicios: r.datos.servicios as unknown as Json,
    p_opciones: r.datos.opciones as unknown as Json,
    p_aliado_id: r.datos.aliadoId,
  });
  if (error || id == null) return { ok: false, error: mensajeErrorComparativa(error?.message) };

  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, id };
}

/**
 * Confirma o rechaza una solicitud de un cliente/aliado (comparativas que no
 * continúan por checkout). La identidad es la de la SESIÓN (auth.uid() dentro de
 * la RPC): no se pasa ningún usuario. Confirmar crea la hija; no concede permisos
 * de conversión.
 */
export async function resolverSolicitudComparativa(
  solicitudId: number,
  decision: "confirmar" | "rechazar",
  motivo: string,
  clave: string
): Promise<{ ok: true; hijaId: number | null } | { ok: false; error: string }> {
  if (!Number.isInteger(solicitudId) || solicitudId <= 0) return { ok: false, error: "Solicitud inválida." };
  if (decision !== "confirmar" && decision !== "rechazar") return { ok: false, error: "Decisión inválida." };
  const claveOk = validarClaveIdempotencia(clave);
  if (!claveOk) return { ok: false, error: "Falta la clave de la operación. Recarga la página e inténtalo de nuevo." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("resolver_solicitud_comparativa", {
    p_solicitud: solicitudId,
    p_decision: decision,
    p_motivo: (motivo || "").trim().slice(0, 300) || null,
    p_clave: decision === "confirmar" ? claveOk : null,
  });
  if (error) return { ok: false, error: mensajeErrorComparativa(error.message) };
  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, hijaId: data ?? null };
}
