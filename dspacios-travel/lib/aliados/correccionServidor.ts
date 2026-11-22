/**
 * #25 (ADL-039) — Corrección de la ficha de un aliado por personal autorizado (servidor).
 *
 * Quién: solo superadmin y gerencia (los roles que la RLS de `auditoria` deja leer, así el cambio siempre es consultable). `administracion` NO corrige.
 * Auditoría: la escritura va con la sesión de QUIEN corrige (`deps.sb`), no con service-role, así el disparador 087 registra el actor real y el antes/después.
 * Concurrencia: UN solo UPDATE condicionado a los valores que la persona vio (`esperado`): si otro (el propio aliado desde su portal, otro operador) cambió
 * el campo entretanto, no se actualiza ninguna fila y se pide recargar. Nada se restaura a mano.
 * Duplicados: nombre contra otras fichas y cuentas de aliados (salvo las enlazadas a ESTA ficha) y documento contra otras fichas. No hay restricción única en la
 * base (hay fichas históricas repetidas), así que es una verificación previa, igual que en el alta y en el portal; la carrera entre dos correcciones simultáneas
 * al mismo valor nuevo no la cubre la base.
 * Qué NO hace: no toca `ventas`, `aliados_b2b`, cotizaciones ni usuarios — el texto histórico de esos registros no se reescribe.
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import { normalizarNombre } from "@/lib/portal/perfilEdicion";
import { cambiosCorreccion, ETIQUETA_CAMPO, normalizarDocumento, type CampoCorreccion, type EntradaCorreccion } from "@/lib/aliados/correccion";

// Sintaxis de método (bivariante): acepta el cliente tipado de Supabase.
export type ClienteDatos = { from(tabla: string): any };
export type DepsCorreccion = { sb: ClienteDatos; admin: ClienteDatos };
export type ActorCorreccion = { id: string; rol: string | null; activo: boolean | null } | null;
export type RespuestaCorreccion = { ok: true; cambios: string[] } | { ok: false; error: string };

export const ROLES_CORRECCION: readonly string[] = ["superadmin", "gerencia"];
const ERROR_GENERAL = "No se pudo guardar la corrección. Intenta de nuevo.";
export const MSG_SIN_PERMISO_CORRECCION = "Solo superadmin y gerencia pueden corregir los datos de un aliado.";
export const MSG_CONFLICTO_CORRECCION = "Los datos de este aliado cambiaron mientras los corregías (o la ficha ya no existe). Recarga la página e inténtalo de nuevo.";
export const MSG_NOMBRE_DUPLICADO = "Ya existe otro aliado o cuenta con ese nombre. Verifica que no sea un duplicado.";
export const MSG_DOCUMENTO_DUPLICADO = "Ya existe otra ficha con ese número de documento. Búscala en vez de duplicarla.";

const COLUMNA: Record<CampoCorreccion, string> = { nombre: "nombre", telefono: "telefono", email: "email", tipo_documento: "tipo_documento", nit: "nit" };

type FichaLeve = { id: number; nombre: string | null; nit: string | null };
type CuentaLeve = { id: string; nombre: string | null; aliado_id: number | null };

/** Lectura COMPLETA o nada (falla cerrado): una lista truncada daría un «no hay duplicado» falso. */
async function leerFichasYCuentas(admin: ClienteDatos): Promise<{ fichas: FichaLeve[]; cuentas: CuentaLeve[] } | null> {
  const f = await leerTodoConConteo<FichaLeve>((d, h) =>
    admin.from("aliados").select("id, nombre, nit", { count: "exact" }).order("id", { ascending: true }).range(d, h) as PromiseLike<PaginaConConteo<FichaLeve>>, PAGINA_FILAS);
  const c = await leerTodoConConteo<CuentaLeve>((d, h) =>
    admin.from("usuarios").select("id, nombre, aliado_id", { count: "exact" }).in("rol", ["agencia", "freelance"]).order("id", { ascending: true }).range(d, h) as PromiseLike<PaginaConConteo<CuentaLeve>>, PAGINA_FILAS);
  if (!f.completa || !c.completa) return null;
  return { fichas: f.filas, cuentas: c.filas };
}

export async function corregirFichaAliado(deps: DepsCorreccion, actor: ActorCorreccion, id: unknown, entrada: EntradaCorreccion): Promise<RespuestaCorreccion> {
  if (!actor?.id || actor.activo !== true || !ROLES_CORRECCION.includes(String(actor.rol))) return { ok: false, error: MSG_SIN_PERMISO_CORRECCION };
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return { ok: false, error: "Aliado inválido." };

  const c = cambiosCorreccion(entrada ?? {});
  if (!c.ok) return c;
  const { cambios, esperado } = c.valor;
  const campos = Object.keys(cambios) as CampoCorreccion[];
  if (!campos.length) return { ok: true, cambios: [] };

  if ("nombre" in cambios || "nit" in cambios) {
    const lectura = await leerFichasYCuentas(deps.admin);
    if (!lectura) return { ok: false, error: ERROR_GENERAL };
    if (typeof cambios.nombre === "string") {
      const k = normalizarNombre(cambios.nombre);
      const dupFicha = lectura.fichas.some((x) => x.id !== id && normalizarNombre(x.nombre) === k);
      const dupCuenta = lectura.cuentas.some((x) => x.aliado_id !== id && normalizarNombre(x.nombre) === k);
      if (dupFicha || dupCuenta) return { ok: false, error: MSG_NOMBRE_DUPLICADO };
    }
    if (typeof cambios.nit === "string") {
      const d = normalizarDocumento(cambios.nit);
      if (lectura.fichas.some((x) => x.id !== id && normalizarDocumento(x.nit) === d)) return { ok: false, error: MSG_DOCUMENTO_DUPLICADO };
    }
  }

  const parche: Record<string, string | null> = {};
  for (const campo of campos) parche[COLUMNA[campo]] = cambios[campo] ?? null;
  let q = deps.sb.from("aliados").update(parche).eq("id", id);
  for (const campo of campos) {
    const antes = esperado[campo] ?? null;
    q = antes === null ? q.is(COLUMNA[campo], null) : q.eq(COLUMNA[campo], antes);
  }
  const r = await q.select("id");
  if (r.error) return { ok: false, error: ERROR_GENERAL };
  if (!Array.isArray(r.data) || r.data.length !== 1) return { ok: false, error: MSG_CONFLICTO_CORRECCION };
  return { ok: true, cambios: campos.map((x) => ETIQUETA_CAMPO[x]) };
}
