/**
 * #25 (ADL-039) — El aliado ve el historial de cambios de SUS propios datos.
 *
 * La identidad sale SOLO del `userId` de la sesión: de ahí se resuelve `usuarios.aliado_id`. Ningún id llega del navegador, así que no hay forma de pedir el
 * historial de otra ficha. Lectura con service-role (la RLS de `auditoria` solo deja leer a superadmin/gerencia), por eso la autorización vive aquí.
 *
 * Se muestra lo que la persona puede entender de SU ficha: nunca quién del personal interno hizo el cambio (solo «desde tu portal» o «D'spacios»), nunca
 * comisión/retención/activo, y el número de cuenta bancaria solo con sus últimos cuatro dígitos (lo enmascara `lib/aliados/historial.ts`).
 */
import { lineasHistorialParaAliado, type FilaAuditoria, type LineaParaAliado } from "@/lib/aliados/historial";

// Sintaxis de método (bivariante): acepta el cliente tipado de Supabase.
export type AdminHistorial = { from(tabla: string): any };

export const CAMPOS_FICHA_VISIBLES: ReadonlySet<string> = new Set([
  "nombre", "contacto", "email", "telefono", "direccion", "tipo_documento", "nit", "banco", "tipo_cuenta", "numero_cuenta",
]);
export const CAMPOS_USUARIO_VISIBLES: ReadonlySet<string> = new Set(["nombre"]);

/** Tope por lectura (una para la ficha y otra para el usuario): sin paginación ni sondeo; solo se lee al abrir el perfil. */
export const TOPE_HISTORIAL = 100;

export type HistorialPropio = { estado: "ok"; lineas: LineaParaAliado[] } | { estado: "no_aplica" } | { estado: "error" };

const COLUMNAS = "id, creado_en, actor_email, actor_nombre, actor_rol, accion, despues, cambios";

export async function cargarHistorialPropio(admin: AdminHistorial, userId: string | null | undefined): Promise<HistorialPropio> {
  try { return await leerHistorial(admin, userId); } catch { return { estado: "error" }; } // una excepción de red no debe tumbar la página del perfil
}

async function leerHistorial(admin: AdminHistorial, userId: string | null | undefined): Promise<HistorialPropio> {
  if (!userId) return { estado: "no_aplica" };
  const u = await admin.from("usuarios").select("id, rol, activo, agencia_id, aliado_id").eq("id", userId).maybeSingle();
  if (u.error) return { estado: "error" };
  const usuario = u.data as { id: string; rol: string | null; activo: boolean | null; agencia_id: string | null; aliado_id: number | null } | null;
  // Solo cuentas de aliado activas; un agente (sub-cuenta de una agencia) no ve el historial de la ficha de su titular.
  if (!usuario || usuario.activo !== true || (usuario.rol !== "agencia" && usuario.rol !== "freelance") || usuario.agencia_id != null) return { estado: "no_aplica" };

  const leer = (tabla: string, registro: string) =>
    admin.from("auditoria").select(COLUMNAS).eq("tabla", tabla).eq("registro_id", registro)
      .order("creado_en", { ascending: false }).order("id", { ascending: false }).limit(TOPE_HISTORIAL);
  const [ficha, cuenta] = await Promise.all([
    usuario.aliado_id != null ? leer("aliados", String(usuario.aliado_id)) : Promise.resolve({ data: [], error: null }),
    leer("usuarios", usuario.id),
  ]);
  if (ficha.error || cuenta.error) return { estado: "error" };

  const lineas = [
    ...lineasHistorialParaAliado((ficha.data ?? []) as FilaAuditoria[], CAMPOS_FICHA_VISIBLES),
    // De la cuenta solo importa el cambio de nombre; el alta de la cuenta no es un dato que la persona haya editado.
    ...lineasHistorialParaAliado((cuenta.data ?? []) as FilaAuditoria[], CAMPOS_USUARIO_VISIBLES).filter((l) => l.accion === "Cambio"),
  ].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
  return { estado: "ok", lineas };
}
