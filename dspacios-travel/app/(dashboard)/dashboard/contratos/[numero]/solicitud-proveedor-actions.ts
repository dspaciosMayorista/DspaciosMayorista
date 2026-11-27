"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MENSAJE_IDENTIDAD, parseIdentidad, uidDeclarado, type IdentidadContrato } from "@/lib/contrato/identidad";
import { revalidatePath } from "next/cache";
import { limpiarMensajeAdicional, validarDestinatarios } from "@/lib/solicitudProveedor/nucleo";
import { configCorreo, transporteDeConfig } from "@/lib/solicitudProveedor/transporte";
import { armarSolicitud, type SeleccionSolicitud } from "@/lib/solicitudProveedor/cargar";
import type { EleccionCodigo } from "@/lib/solicitudProveedor/codigos";
import { enviarSolicitud, registrarDecision, reintentarEnvio } from "@/lib/solicitudProveedor/servicio";
import type { Json } from "@/types/database";

// #103 — enviar la SOLICITUD de servicio a un proveedor (correo estructurado armado con los datos de la reserva, NO el voucher del cliente) y seguir su respuesta. Autoriza el CÓDIGO (la RLS de las tablas
// nuevas es de solo lectura): rol interno con acceso a producto/operación; los datos se releen aquí con la sesión de la persona (la RLS decide). Las escrituras usan service_role y SOLO desde aquí / el webhook.
// IDENTIDAD (284): la pantalla manda la identidad del contrato que ABRIÓ; el cliente de servicio la declara en cada escritura (la llave de servicio NO exime de la guarda) y la solicitud la guarda como su propia
// vida del contrato. Nunca se sustituye por la identidad actual del número: una pantalla vieja sobre un número reutilizado se rechaza, no se redirige.
const ROLES = ["superadmin", "gerencia", "administracion", "operaciones"] as const;
type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };
export type CandidataCodigo = { codigoId: number; nombre: string; codigoCargado: boolean; codigo: string | null };
export type VistaPrevia =
  | { ok: true; asunto: string; html: string; texto: string; candidatas: CandidataCodigo[]; hotelId: number | null; hotelesSugeridos: { id: number; nombre: string }[]; exigeEleccion: boolean }
  | { ok: false; error: string; candidatas?: CandidataCodigo[]; hotelesSugeridos?: { id: number; nombre: string }[]; exigeEleccion?: boolean };

async function actor(identidad: IdentidadContrato): Promise<{ ok: false; error: string } | { ok: true; sb: Awaited<ReturnType<typeof createClient>>; user: { id: string } }> {
  const sb = await createClient(parseIdentidad(identidad));
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión de nuevo." };
  const { data: rol } = await sb.rpc("mi_rol");
  if (!rol || !(ROLES as readonly string[]).includes(rol)) return { ok: false, error: "No tienes permiso para enviar solicitudes a proveedores." };
  return { ok: true, sb, user };
}

/** The selection comes from the browser: it is validated here (shape and size) and checked against the database inside `armarSolicitud`. `null`/`undefined` = everything of the supplier. A malformed one is an error, never «everything». */
function leerSeleccion(x: unknown): { ok: true; v: SeleccionSolicitud | null } | { ok: false; error: string } {
  if (x == null) return { ok: true, v: null };
  const o = x as { estanciaIds?: unknown; servicios?: unknown };
  if (!Array.isArray(o.estanciaIds) || o.estanciaIds.length > 50 || !o.estanciaIds.every((n) => Number.isInteger(n) && n > 0) || typeof o.servicios !== "boolean") return { ok: false, error: "La selección de estancias no es válida. Recarga la página." };
  return { ok: true, v: { estanciaIds: o.estanciaIds as number[], servicios: o.servicios } };
}

const mostrarCandidatas = (c: { codigoId: number; nombre: string; codigo: string | null }[]): CandidataCodigo[] => c.map((x) => ({ codigoId: x.codigoId, nombre: x.nombre, codigoCargado: !!x.codigo, codigo: x.codigo }));

export async function previsualizarSolicitudProveedor(numero: string, proveedor: string, identidad: IdentidadContrato, hotelId: number | null, eleccion: EleccionCodigo, seleccion: SeleccionSolicitud | null = null, mensaje: string | null = null): Promise<VistaPrevia> {
  const a = await actor(identidad);
  if (!a.ok) return { ok: false, error: a.error };
  const sel = leerSeleccion(seleccion);
  if (!sel.ok) return { ok: false, error: sel.error };
  const msj = limpiarMensajeAdicional(mensaje);   // validated on the server: the browser limit is only a convenience
  if (!msj.ok) return { ok: false, error: msj.error };
  const r = await armarSolicitud(a.sb, numero, proveedor, hotelId, eleccion, sel.v, msj.v);
  // The sender must choose when the stay falls in a coded promotion: that is reported with the (still code-less) preview data so the screen can show the options.
  if (!r.ok) return { ok: false, error: r.error, candidatas: mostrarCandidatas(r.candidatas ?? []), hotelesSugeridos: r.hotelesSugeridos, exigeEleccion: (r.candidatas ?? []).length > 0 };
  return { ok: true, asunto: r.correo.asunto, html: r.correo.html, texto: r.correo.texto, candidatas: mostrarCandidatas(r.candidatas), hotelId: r.hotelId, hotelesSugeridos: r.hotelesSugeridos, exigeEleccion: (r.candidatas ?? []).length > 0 };
}

export async function enviarSolicitudProveedor(numero: string, proveedor: string, destinatariosTexto: string, identidad: IdentidadContrato, hotelId: number | null, eleccion: EleccionCodigo, reenviar = false, seleccion: SeleccionSolicitud | null = null, mensaje: string | null = null): Promise<Resultado> {
  const cfg = configCorreo();
  if (!cfg.ok) return { ok: false, error: cfg.error };
  const d = validarDestinatarios(destinatariosTexto);
  if (!d.ok) return { ok: false, error: d.error };
  const ident = parseIdentidad(identidad);
  const uid = uidDeclarado(ident, numero);
  if (!uid) return { ok: false, error: MENSAJE_IDENTIDAD };
  const a = await actor(ident);
  if (!a.ok) return { ok: false, error: a.error };
  // The outgoing message is rebuilt HERE from the database with the person's own session: nothing the browser previewed is trusted, and the code rules are enforced again.
  const sel = leerSeleccion(seleccion);
  if (!sel.ok) return { ok: false, error: sel.error };
  const msj = limpiarMensajeAdicional(mensaje);
  if (!msj.ok) return { ok: false, error: msj.error };
  const armado = await armarSolicitud(a.sb, numero, proveedor, hotelId, eleccion, sel.v, msj.v);
  if (!armado.ok) return { ok: false, error: armado.error };
  const r = await enviarSolicitud(
    { admin: createAdminClient(ident), transporte: transporteDeConfig(cfg.config), config: cfg.config },
    {
      tipo: "solicitud", numero, contratoUid: uid, tenant: armado.cargada.tenant, proveedor, contenido: { datos: armado.datos, hotelId: armado.hotelId, sinPromocion: armado.sinPromocion, ...(sel.v ? { seleccion: sel.v } : {}) } as unknown as Json,
      destinatarios: d.destinatarios, correo: { asunto: armado.correo.asunto, html: armado.correo.html, texto: armado.correo.texto },
      hotelId: armado.hotelId, codigo: armado.codigo, sinPromocion: armado.sinPromocion, creadoPor: a.user.id, reenviar,
    },
  );
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, mensaje: r.yaEnviada ? "Esta solicitud ya había sido enviada a esos correos; no se envió de nuevo." : "Solicitud enviada. Verás aquí cuando el proveedor la reciba y responda." };
}

/** RETRY of an existing request BY ID: re-sends its frozen message (original recipients, content and code) — never a rebuild from the current contract or the current form. Bounded by the provider's idempotency window. */
export async function reintentarEnvioSolicitudProveedor(numero: string, solicitudId: number, identidad: IdentidadContrato): Promise<Resultado> {
  const cfg = configCorreo();
  if (!cfg.ok) return { ok: false, error: cfg.error };
  const ident = parseIdentidad(identidad);
  if (!uidDeclarado(ident, numero)) return { ok: false, error: MENSAJE_IDENTIDAD };
  const a = await actor(ident);
  if (!a.ok) return { ok: false, error: a.error };
  const { data: s } = await a.sb.from("solicitudes_proveedor").select("id, tipo").eq("id", solicitudId).eq("numero_contrato", numero).maybeSingle();
  if (!s || s.tipo !== "solicitud") return { ok: false, error: "No se encontró la solicitud." };
  const r = await reintentarEnvio({ admin: createAdminClient(ident), transporte: transporteDeConfig(cfg.config), config: cfg.config }, solicitudId);
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, mensaje: r.yaEnviada ? "Esta solicitud ya había sido enviada; no se envió de nuevo." : "Solicitud reenviada (el mensaje original)." };
}

export async function registrarDecisionProveedor(numero: string, solicitudId: number, resultado: "confirmacion" | "rechazo", identidad: IdentidadContrato): Promise<Resultado> {
  const ident = parseIdentidad(identidad);
  if (!uidDeclarado(ident, numero)) return { ok: false, error: MENSAJE_IDENTIDAD };
  const a = await actor(ident);
  if (!a.ok) return { ok: false, error: a.error };
  // La solicitud debe ser visible para este usuario (RLS de lectura: rol + agencia) y pertenecer a este contrato antes de escribir con service_role.
  const { data: s } = await a.sb.from("solicitudes_proveedor").select("id").eq("id", solicitudId).eq("numero_contrato", numero).maybeSingle();
  if (!s) return { ok: false, error: "No se encontró la solicitud." };
  const r = await registrarDecision(createAdminClient(ident), solicitudId, resultado, a.user.id);
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, mensaje: r.estado === "confirmada" ? "Registrado: el proveedor confirmó el servicio." : "Registrado: el proveedor rechazó el servicio." };
}

// Solo los avisos de las solicitudes de ESTE contrato (visibles para quien llama): leer un contrato nunca descarta los avisos de otro. La RLS de avisos ya limita a los del propio usuario.
export async function marcarAvisosLeidos(numero: string, identidad: IdentidadContrato): Promise<Resultado> {
  const sb = await createClient(parseIdentidad(identidad));
  const { data: solicitudes, error: errSol } = await sb.from("solicitudes_proveedor").select("id").eq("numero_contrato", numero);
  if (errSol) return { ok: false, error: "No se pudieron marcar como leídos." };
  const ids = (solicitudes ?? []).map((s) => s.id);
  if (ids.length) {
    const { error } = await sb.from("solicitud_proveedor_avisos").update({ leido_en: new Date().toISOString() }).is("leido_en", null).in("solicitud_id", ids);
    if (error) return { ok: false, error: "No se pudieron marcar como leídos." };
  }
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, mensaje: "Avisos marcados como leídos." };
}
