// «Clientes de contratos» del CRM (#68, migración 221) — helper SIN React ni Next.
//
// UNA FILA POR CONTRATO: la unidad es el contrato, nunca una persona. Este módulo NO agrupa clientes por
// documento, nombre, correo ni teléfono (`ventas` no guarda el tipo documental), no lee `crm_contactos` y no
// decide permisos: la AUTORIDAD (actor, rol, tenant, «venta solo propios» y la guarda de homónimos) vive en las
// dos funciones SQL de la 221. Lo de aquí es presentación y defensa en profundidad:
//   · normaliza lo que escribe el usuario antes de enviarlo (la base vuelve a validarlo);
//   · envuelve las RPC con el cliente de SESIÓN y devuelve errores genéricos (nunca el texto de la base);
//   · proyecta cada fila con una LISTA BLANCA de columnas, así que aunque una versión futura de la función
//     devolviera más (precio, dirección, firma, share_token…), la página no las recibe.
// El tenant ACTIVO de la interfaz (cookie del servidor) solo decide qué agencia mira el superadmin; para los demás
// roles ni siquiera se envía: la base usa el tenant de su propia fila.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { numeroVisible } from "@/lib/tenant";

export const ROLES_CLIENTES_CONTRATOS = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;
export type RolClientesContratos = (typeof ROLES_CLIENTES_CONTRATOS)[number];

export const TAM_PAGINA = 50;
export const MIN_BUSQUEDA = 3;
export const MAX_BUSQUEDA = 100;
export const MAX_NUMERO = 60;
/** Cookie httpOnly de la búsqueda en curso: así el texto buscado (nombres, documentos) no viaja en la URL ni en los logs. */
export const COOKIE_BUSQUEDA = "cc68_q";
export const RUTA_LISTA = "/crm/clientes-contratos";

/** Las 14 columnas del contrato que devuelven las funciones (y ninguna más). */
export const COLUMNAS_CONTRATO = [
  "numero_contrato", "fecha_venta", "cliente", "cliente_documento", "cliente_email", "cliente_telefono",
  "destino", "fecha_salida", "fecha_regreso", "estado", "tipo_asesor", "agencia_nombre", "freelance_nombre", "tenant",
] as const;

export type ContratoCliente = {
  numero_contrato: string;
  fecha_venta: string | null;
  cliente: string;
  cliente_documento: string | null;
  cliente_email: string | null;
  cliente_telefono: string | null;
  destino: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  estado: string | null;
  tipo_asesor: string | null;
  agencia_nombre: string | null;
  freelance_nombre: string | null;
  tenant: string;
};

const CONTROL = /[\u0000-\u001f\u007f]/g;
const tieneControl = (s: string) => /[\u0000-\u001f\u007f]/.test(s);
const largo = (s: string) => Array.from(s).length;

export function esRolClientesContratos(rol: unknown): rol is RolClientesContratos {
  return typeof rol === "string" && (ROLES_CLIENTES_CONTRATOS as readonly string[]).includes(rol);
}

/**
 * Qué agencia envía la página como `p_tenant`. SOLO el superadmin elige: es un filtro, no una restricción. Para
 * gerencia, administración, operaciones y venta se envía null y la base usa el tenant de su propia fila; la cookie
 * de agencia activa no es autoridad (una llamada REST ni siquiera pasa por ella).
 */
export function tenantParaRpc(rol: unknown, tenantActivo: string): string | null {
  return rol === "superadmin" ? tenantActivo : null;
}

export type BusquedaNormalizada = { ok: true; q: string | null } | { ok: false; motivo: "corta" | "larga" | "invalida" };

/** Texto de búsqueda: recorta, quita caracteres de control y exige 3 a 100 caracteres. Vacío = sin filtro. */
export function normalizarBusqueda(raw: unknown): BusquedaNormalizada {
  if (raw === undefined || raw === null) return { ok: true, q: null };
  if (typeof raw !== "string") return { ok: false, motivo: "invalida" };
  const q = raw.replace(CONTROL, " ").trim();
  if (q === "") return { ok: true, q: null };
  const n = largo(q);
  if (n < MIN_BUSQUEDA) return { ok: false, motivo: "corta" };
  if (n > MAX_BUSQUEDA) return { ok: false, motivo: "larga" };
  return { ok: true, q };
}

export function mensajeBusqueda(motivo: "corta" | "larga" | "invalida"): string {
  if (motivo === "corta") return `Escribe al menos ${MIN_BUSQUEDA} caracteres para buscar.`;
  if (motivo === "larga") return `La búsqueda admite hasta ${MAX_BUSQUEDA} caracteres.`;
  return "La búsqueda no es válida.";
}

/** Cursor de paginación = número de contrato de la última fila de la página anterior. Cualquier otra cosa = primera página. */
export function normalizarCursor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "" || largo(s) > MAX_NUMERO || tieneControl(s)) return null;
  return s;
}

/** Número de contrato de la URL de la ficha (puede venir con %XX). null = no es consultable. */
export function normalizarNumeroContrato(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { return null; }
  s = s.trim();
  if (s === "" || largo(s) > MAX_NUMERO || tieneControl(s)) return null;
  return s;
}

function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Proyección con lista blanca: descarta cualquier columna que no sea una de las 14 del contrato. */
export function proyectarContrato(x: unknown): ContratoCliente | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const numero = texto(r.numero_contrato);
  const tenant = texto(r.tenant);
  if (!numero || !tenant) return null;
  return {
    numero_contrato: numero,
    fecha_venta: texto(r.fecha_venta),
    cliente: texto(r.cliente) ?? "",
    cliente_documento: texto(r.cliente_documento),
    cliente_email: texto(r.cliente_email),
    cliente_telefono: texto(r.cliente_telefono),
    destino: texto(r.destino),
    fecha_salida: texto(r.fecha_salida),
    fecha_regreso: texto(r.fecha_regreso),
    estado: texto(r.estado),
    tipo_asesor: texto(r.tipo_asesor),
    agencia_nombre: texto(r.agencia_nombre),
    freelance_nombre: texto(r.freelance_nombre),
    tenant,
  };
}

export type ResultadoLista = { ok: true; filas: ContratoCliente[]; hayMas: boolean } | { ok: false; error: string };
export type ResultadoFicha = { ok: true; contrato: ContratoCliente | null } | { ok: false; error: string };

const ERROR_LISTA = "No se pudo consultar los contratos. Intenta de nuevo.";
const ERROR_FICHA = "No se pudo consultar el contrato. Intenta de nuevo.";

/** Lista paginada (cursor). Una página como máximo; `hayMas` dice si hay otra. */
export async function listarClientesContratos(
  sb: SupabaseClient<Database>,
  p: { tenant: string | null; q: string | null; cursor: string | null }
): Promise<ResultadoLista> {
  try {
    const { data, error } = await sb.rpc("crm_contratos_clientes_buscar", {
      p_tenant: p.tenant,
      p_busqueda: p.q,
      p_cursor: p.cursor,
      p_tam: TAM_PAGINA,
    });
    if (error) return { ok: false, error: ERROR_LISTA };
    const crudas: unknown[] = Array.isArray(data) ? data : [];
    const filas = crudas.map(proyectarContrato).filter((f): f is ContratoCliente => f !== null).slice(0, TAM_PAGINA);
    const hayMas = crudas.some((f) => typeof f === "object" && f !== null && (f as { hay_mas?: unknown }).hay_mas === true);
    return { ok: true, filas, hayMas };
  } catch {
    return { ok: false, error: ERROR_LISTA };
  }
}

/** Ficha de UN contrato. `contrato: null` significa «vacío»: ajeno, de otro tenant, inexistente o sin permiso (indistinguibles). */
export async function obtenerFichaContrato(sb: SupabaseClient<Database>, numero: string): Promise<ResultadoFicha> {
  try {
    const { data, error } = await sb.rpc("crm_contrato_cliente_ficha", { p_numero_contrato: numero });
    if (error) return { ok: false, error: ERROR_FICHA };
    const crudas: unknown[] = Array.isArray(data) ? data : [];
    const c = crudas.length ? proyectarContrato(crudas[0]) : null;
    return { ok: true, contrato: c };
  } catch {
    return { ok: false, error: ERROR_FICHA };
  }
}

/** Rol del usuario con sesión y activo (solo para ocultar el módulo; la base vuelve a decidir). null = sin acceso. */
export async function rolDelActor(sb: SupabaseClient<Database>): Promise<string | null> {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
    if (!perfil || perfil.activo !== true) return null;
    return typeof perfil.rol === "string" ? perfil.rol : null;
  } catch {
    return null;
  }
}

// ── Presentación ─────────────────────────────────────────────────────────────

export const rutaFicha = (numero: string) => `${RUTA_LISTA}/${encodeURIComponent(numero)}`;
export const rutaContrato = (numero: string) => `/dashboard/contratos/${encodeURIComponent(numero)}`;
/** El número que ve el usuario (sin el prefijo MIN- del minorista). */
export const numeroParaMostrar = (numero: string) => numeroVisible(numero);

export type ClaseEstado = "pendiente" | "confirmado" | "activo" | "cancelado" | "otro";
export function claseEstado(estado: string | null): ClaseEstado {
  switch ((estado ?? "").trim().toLowerCase()) {
    case "pendiente": return "pendiente";
    case "confirmado": return "confirmado";
    case "activo": return "activo";
    case "cancelado": case "cancelada": case "anulado": case "anulada": return "cancelado";
    default: return "otro";
  }
}

/** Canal de venta del contrato (informativo; no es la identidad del cliente). */
export function etiquetaCanal(c: Pick<ContratoCliente, "tipo_asesor" | "agencia_nombre" | "freelance_nombre">): string {
  switch ((c.tipo_asesor ?? "").trim().toLowerCase()) {
    case "interno": return "Interno";
    case "agencia": return c.agencia_nombre?.trim() ? `Agencia: ${c.agencia_nombre.trim()}` : "Agencia";
    case "freelance": return c.freelance_nombre?.trim() ? `Freelance: ${c.freelance_nombre.trim()}` : "Freelance";
    default: return "—";
  }
}
