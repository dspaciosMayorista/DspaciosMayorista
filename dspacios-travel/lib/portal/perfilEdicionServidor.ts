/**
 * #25 — Edición de «Mi perfil» (servidor). La sesión es la ÚNICA fuente de identidad: usuario → `usuarios` → `aliado_id`.
 * Nada del formulario decide quién edita ni qué ficha: solo se leen las llaves permitidas de la entrada.
 *
 * Escribe con service-role tras autorizar (la RLS no deja escribir `aliados` a un aliado). El cambio y su auditoría con actor
 * se confirman JUNTOS en la base: RPC `guardar_perfil_portal` (migración 283), una sola transacción con bloqueo de fila y
 * comparación de los valores que el usuario vio. No hay restauración manual: si algo falla, la base revierte todo.
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import {
  permisosPerfil, cambiosFicha, cambioNombreUsuario, normalizarNombre, MSG_LEGACY,
  type EntradaFicha, type EntradaUsuario, type FichaEdicion, type PermisosPerfil, type UsuarioEdicion,
} from "@/lib/portal/perfilEdicion";

// Sintaxis de método (bivariante): acepta el cliente tipado de Supabase, cuyo `rpc` solo conoce los nombres del esquema generado.
export type AdminPerfil = { from(tabla: string): any; rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export type SesionPerfil = { id: string; email: string | null };
export type RespuestaPerfil = { ok: true; cambios: string[] } | { ok: false; error: string };

const NO_AUTORIZADO = "No tienes permiso para editar este perfil.";
const ERROR_GENERAL = "No se pudo guardar. Intenta de nuevo.";

export type ContextoEdicion = { usuario: (UsuarioEdicion & { email: string | null }) | null; ficha: FichaEdicion | null; permisos: PermisosPerfil; lecturaOk: boolean };

export async function cargarContextoEdicion(admin: AdminPerfil, userId: string): Promise<ContextoEdicion> {
  const vacio = (lecturaOk: boolean): ContextoEdicion => ({ usuario: null, ficha: null, permisos: permisosPerfil(null, true), lecturaOk });
  const { data: u, error } = await admin.from("usuarios")
    .select("id, email, rol, activo, agencia_id, aliado_id, acceso_legacy_nombre, nombre").eq("id", userId).maybeSingle();
  if (error) return vacio(false);
  if (!u) return vacio(true);
  const usuario = u as UsuarioEdicion & { email: string | null };
  let compartida = true; // fail-closed
  let ficha: FichaEdicion | null = null;
  if (usuario.aliado_id != null) {
    const c = await admin.from("usuarios").select("id", { count: "exact", head: true })
      .eq("aliado_id", usuario.aliado_id).neq("id", userId).in("rol", ["agencia", "freelance"]).is("agencia_id", null).eq("activo", true);
    if (!c.error && typeof c.count === "number") compartida = c.count > 0;
    const f = await admin.from("aliados").select("id, nombre, contacto, telefono, email, direccion").eq("id", usuario.aliado_id).maybeSingle();
    if (f.error) return { usuario, ficha: null, permisos: permisosPerfil(usuario, true), lecturaOk: false };
    ficha = (f.data as FichaEdicion | null) ?? null;
  } else compartida = false;
  return { usuario, ficha, permisos: permisosPerfil(usuario, compartida), lecturaOk: true };
}

type Nombres = { usuarios: { id: string; nombre: string | null }[]; aliados: { id: number; nombre: string | null }[] };

async function leerNombres(admin: AdminPerfil): Promise<Nombres | null> {
  const u = await leerTodoConConteo<{ id: string; nombre: string | null }>((d, h) =>
    admin.from("usuarios").select("id, nombre", { count: "exact" }).in("rol", ["agencia", "freelance"]).order("id", { ascending: true }).range(d, h) as PromiseLike<PaginaConConteo<{ id: string; nombre: string | null }>>, PAGINA_FILAS);
  const a = await leerTodoConConteo<{ id: number; nombre: string | null }>((d, h) =>
    admin.from("aliados").select("id, nombre", { count: "exact" }).order("id", { ascending: true }).range(d, h) as PromiseLike<PaginaConConteo<{ id: number; nombre: string | null }>>, PAGINA_FILAS);
  if (!u.completa || !a.completa) return null;
  return { usuarios: u.filas, aliados: a.filas };
}

const MSG_DUPLICADO = "Ya existe un aliado registrado con ese nombre. Si es tu empresa, contacta a tu asesor para verificarlo.";

/** Un nombre ya usado por OTRO usuario aliado o por otra ficha (suplantación). Se excluye lo propio. */
async function nombreEnUso(admin: AdminPerfil, nombre: string, propios: { usuarioId: string; aliadoId: number | null }): Promise<"si" | "no" | "error"> {
  const n = await leerNombres(admin);
  if (!n) return "error";
  const k = normalizarNombre(nombre);
  const dupU = n.usuarios.some((x) => x.id !== propios.usuarioId && normalizarNombre(x.nombre) === k);
  const dupA = n.aliados.some((x) => x.id !== propios.aliadoId && normalizarNombre(x.nombre) === k);
  return dupU || dupA ? "si" : "no";
}

const MSG_CONFLICTO = "Tus datos cambiaron mientras editabas. Recarga la página e inténtalo de nuevo.";

/** Una sola llamada atómica. Los códigos de rechazo vienen de la base (que vuelve a verificar la autorización). */
async function guardarAtomico(
  admin: AdminPerfil, sesion: SesionPerfil, seccion: "usuario" | "ficha", cambios: Record<string, unknown>, esperado: Record<string, unknown>,
): Promise<RespuestaPerfil> {
  const r = await admin.rpc("guardar_perfil_portal", {
    p_actor_id: sesion.id, p_actor_email: sesion.email, p_seccion: seccion, p_cambios: cambios, p_esperado: esperado,
  });
  const d = r.data as { ok?: boolean; codigo?: string; cambios?: string[] } | null;
  if (r.error || !d || typeof d !== "object") return { ok: false, error: ERROR_GENERAL };
  if (d.ok === true) return { ok: true, cambios: Array.isArray(d.cambios) ? d.cambios : [] };
  switch (d.codigo) {
    case "conflicto": return { ok: false, error: MSG_CONFLICTO };
    case "nombre_legacy": return { ok: false, error: MSG_LEGACY };
    case "agente": return { ok: false, error: "La ficha de la agencia solo la edita su titular." };
    case "ficha_compartida": return { ok: false, error: "Tu ficha la comparte otra cuenta. Contacta a tu asesor para cambiarla." };
    case "sin_ficha": return { ok: false, error: "Tu cuenta aún no está enlazada a una ficha. Contacta a tu asesor." };
    case "no_autorizado": return { ok: false, error: NO_AUTORIZADO };
    default: return { ok: false, error: ERROR_GENERAL };
  }
}

export async function guardarPerfilServidor(admin: AdminPerfil, sesion: SesionPerfil | null, entrada: EntradaUsuario | EntradaFicha): Promise<RespuestaPerfil> {
  if (!sesion?.id) return { ok: false, error: NO_AUTORIZADO };
  const seccion = (entrada as { seccion?: unknown } | null)?.seccion;
  if (seccion !== "usuario" && seccion !== "ficha") return { ok: false, error: ERROR_GENERAL };

  const ctx = await cargarContextoEdicion(admin, sesion.id);
  if (!ctx.lecturaOk) return { ok: false, error: ERROR_GENERAL };
  const { usuario, ficha, permisos } = ctx;
  if (!usuario || !permisos.valido) return { ok: false, error: NO_AUTORIZADO };
  
  if (seccion === "usuario") {
    if (!permisos.puedeNombreUsuario) return { ok: false, error: permisos.motivoNombreUsuario ?? NO_AUTORIZADO };
    const c = cambioNombreUsuario(entrada as EntradaUsuario);
    if (!c.ok) return c;
    if (!c.valor) return { ok: true, cambios: [] };
    const uso = await nombreEnUso(admin, c.valor.nombre, { usuarioId: usuario.id, aliadoId: usuario.aliado_id });
    if (uso === "error") return { ok: false, error: ERROR_GENERAL };
    if (uso === "si") return { ok: false, error: MSG_DUPLICADO };
    // `esperado` = lo que la persona vio al abrir el formulario; la base lo compara dentro del bloqueo.
    return guardarAtomico(admin, sesion, "usuario", { nombre: c.valor.nombre }, { nombre: c.valor.esperado });
  }

  if (!permisos.puedeFicha || !ficha) return { ok: false, error: permisos.motivoFicha ?? NO_AUTORIZADO };
  const c = cambiosFicha(entrada as EntradaFicha, permisos);
  if (!c.ok) return c;
  const { cambios, esperado } = c.valor;
  if (!Object.keys(cambios).length) return { ok: true, cambios: [] };
  if (typeof cambios.nombre === "string") {
    const uso = await nombreEnUso(admin, cambios.nombre, { usuarioId: usuario.id, aliadoId: ficha.id });
    if (uso === "error") return { ok: false, error: ERROR_GENERAL };
    if (uso === "si") return { ok: false, error: MSG_DUPLICADO };
  }
  // La ficha sale de la sesión dentro de la base (`usuarios.aliado_id`). `esperado` son los ORIGINALES del formulario: solo se comparan,
  // nunca autorizan ni eligen la ficha.
  return guardarAtomico(admin, sesion, "ficha", cambios as Record<string, unknown>, esperado as Record<string, unknown>);
}
