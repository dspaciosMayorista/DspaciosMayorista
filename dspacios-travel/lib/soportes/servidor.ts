// Soportes de pago (#86): autorización del aliado y lecturas con service-role. La autorización la decide el CÓDIGO (la RLS no participa con
// service-role), así que cada operación vuelve a resolver «contrato propio» con la MISMA regla que el resto del portal (ids; respaldo por nombre
// solo cuando ya lo concede). Participar en la comisión de un contrato NO es propiedad: `contratosDelPortalB2B` no la considera.
import { createAdminClient } from "@/lib/supabase/admin";
import { contratosDelPortalB2B, consultasPortalSupabase, COLUMNAS_DECISION } from "@/lib/auth/contratosPortalB2B";
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import { resolverContextoPortal, type ContextoPortal } from "@/lib/portal/b2bPortalServidor";

export const BUCKET_SOPORTES = "soportes-pago";
export type Aliado = Extract<ContextoPortal, { estado: "ok" }>;

export type SoportePortal = {
  id: number; numero_contrato: string; nombre_original: string; mime: string; size_bytes: number; subido_en: string;
};
const COLUMNAS = "id, numero_contrato, nombre_original, mime, size_bytes, subido_en";

/** Sesión de aliado ACTIVO (rol agencia/freelance) o null. */
export async function aliadoActual(): Promise<Aliado | null> {
  const ctx = await resolverContextoPortal();
  return ctx.estado === "ok" ? ctx : null;
}

/** Contratos PROPIOS del aliado (propiedad, no participación por comisión): número → contrato_uid, leído en la MISMA consulta que decide la propiedad. */
export async function contratosPropios(ctx: Aliado): Promise<Map<string, string | null>> {
  const admin = createAdminClient(); // identidad:n/a — solo lectura
  const r = await contratosDelPortalB2B(
    { id: ctx.userId, rol: ctx.rol, tenant: ctx.tenant, activo: true, nombre: ctx.nombre || null, aliadoId: ctx.aliadoId, accesoLegacyNombre: ctx.accesoLegacyNombre },
    consultasPortalSupabase(admin, `${COLUMNAS_DECISION}, contrato_uid`)
  );
  return new Map(r.contratos.map((c) => [c.numero_contrato, typeof c.contrato_uid === "string" ? c.contrato_uid : null] as const));
}

/** Soportes VIGENTES de los contratos dados. `completa` false = no se pudo leer todo (se avisa; nunca una lista parcial presentada como total). */
export async function soportesVigentes(numeros: string[]): Promise<{ filas: SoportePortal[]; completa: boolean }> {
  const admin = createAdminClient(); // identidad:n/a — solo lectura
  const filas: SoportePortal[] = [];
  for (let i = 0; i < numeros.length; i += 100) {
    const lote = numeros.slice(i, i + 100);
    const pedidos = new Set(lote);
    const r = await leerTodoConConteo<SoportePortal>(
      (d, h) => admin.from("contrato_soportes_pago").select(COLUMNAS, { count: "exact" }).in("numero_contrato", lote).eq("vigente", true).is("archivado_en", null)
        .order("id", { ascending: true }).range(d, h) as unknown as PromiseLike<PaginaConConteo<SoportePortal>>,
      PAGINA_FILAS,
      (f) => pedidos.has(String(f?.numero_contrato))
    );
    if (!r.completa) return { filas: [], completa: false };
    filas.push(...r.filas);
  }
  return { filas, completa: true };
}

/** Conteo de abonos de UN contrato (cupo informativo; el límite real lo impone la base). */
export async function contarAbonos(numero: string): Promise<number | null> {
  const { count, error } = await createAdminClient().from("abonos").select("id", { count: "exact", head: true }).eq("numero_contrato", numero); // identidad:n/a — solo lectura
  return error ? null : (count ?? 0);
}

export async function contarVigentes(numero: string): Promise<number | null> {
  const { count, error } = await createAdminClient().from("contrato_soportes_pago").select("id", { count: "exact", head: true }).eq("numero_contrato", numero).eq("vigente", true).is("archivado_en", null); // identidad:n/a — solo lectura
  return error ? null : (count ?? 0);
}

/** ¿Hay una fila con esta ruta? (la ruta es única). «incierto» si la consulta falla: nunca se asume. */
export async function confirmarRuta(path: string): Promise<"vinculado" | "ausente" | "incierto"> {
  try {
    const { data, error } = await createAdminClient().from("contrato_soportes_pago").select("id").eq("path", path).maybeSingle(); // identidad:n/a — solo lectura
    if (error) return "incierto";
    return data ? "vinculado" : "ausente";
  } catch { return "incierto"; }
}

/**
 * Idempotencia del reintento: ¿el contrato ya tiene VIGENTE un soporte con exactamente este contenido (SHA-256)?
 * Tras una respuesta perdida el aliado suele volver a subir el mismo archivo; así no se duplican soportes, objetos ni avisos.
 * Límite honesto: dos subidas idénticas SIMULTÁNEAS podrían pasar ambas esta comprobación (no hay índice único por contenido).
 */
export async function soporteVigenteConHash(numero: string, sha256: string): Promise<boolean | null> {
  const { count, error } = await createAdminClient().from("contrato_soportes_pago").select("id", { count: "exact", head: true }) // identidad:n/a — solo lectura
    .eq("numero_contrato", numero).eq("vigente", true).is("archivado_en", null).eq("sha256", sha256);
  return error ? null : (count ?? 0) > 0;
}

/**
 * Sucesor de un soporte: la fila que lo sustituyó (`reemplaza_id`). Identifica un reemplazo por su RELACIÓN con el soporte original,
 * no por un hash suelto en el contrato. `error` = no se pudo leer (no se asume nada).
 */
export async function sucesorDe(id: number): Promise<{ estado: "ninguno" } | { estado: "existe"; sha256: string } | { estado: "error" }> {
  const { data, error } = await createAdminClient().from("contrato_soportes_pago").select("sha256").eq("reemplaza_id", id).maybeSingle(); // identidad:n/a — solo lectura
  if (error) return { estado: "error" };
  return data ? { estado: "existe", sha256: data.sha256 } : { estado: "ninguno" };
}

/** Soporte rechazado SIN corrección: lo que el aliado debe corregir. Los rechazados ya corregidos viven en el historial del equipo, no aquí. */
export type SoporteRechazadoPortal = { id: number; numero_contrato: string; nombre_original: string; motivo: string; rechazado_en: string };
const TOPE_RECHAZADOS = 200;

export async function soportesRechazadosPendientes(numeros: string[]): Promise<{ filas: SoporteRechazadoPortal[]; completa: boolean }> {
  if (numeros.length === 0) return { filas: [], completa: true };
  const admin = createAdminClient(); // identidad:n/a — solo lectura
  const filas: SoporteRechazadoPortal[] = [];
  for (let i = 0; i < numeros.length; i += 100) {
    const lote = numeros.slice(i, i + 100);
    const { data, error } = await admin.from("contrato_soportes_pago").select("id, numero_contrato, nombre_original, nota_retiro, retirado_en")
      .in("numero_contrato", lote).eq("motivo_retiro", "rechazo").eq("vigente", false).is("archivado_en", null).order("id", { ascending: false }).limit(TOPE_RECHAZADOS);
    if (error || !data || data.length >= TOPE_RECHAZADOS) return { filas: [], completa: false };
    if (data.length === 0) continue;
    const { data: corr, error: e2 } = await admin.from("contrato_soportes_pago").select("corrige_id").in("corrige_id", data.map((d) => d.id)); // identidad:n/a — solo lectura
    if (e2) return { filas: [], completa: false };
    const corregidos = new Set((corr ?? []).map((c) => c.corrige_id));
    for (const d of data) if (!corregidos.has(d.id)) filas.push({ id: d.id, numero_contrato: d.numero_contrato, nombre_original: d.nombre_original, motivo: String(d.nota_retiro ?? ""), rechazado_en: String(d.retirado_en ?? "") });
  }
  return { filas, completa: true };
}

/** Corrección de un rechazo (`corrige_id`): el contenido del archivo corregido, para tratar como éxito el reintento tras una respuesta perdida. */
export async function correccionDe(id: number): Promise<{ estado: "ninguna" } | { estado: "existe"; sha256: string } | { estado: "error" }> {
  const { data, error } = await createAdminClient().from("contrato_soportes_pago").select("sha256").eq("corrige_id", id).maybeSingle(); // identidad:n/a — solo lectura
  if (error) return { estado: "error" };
  return data ? { estado: "existe", sha256: data.sha256 } : { estado: "ninguna" };
}
