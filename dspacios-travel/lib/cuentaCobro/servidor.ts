/**
 * #98 — Cuenta de cobro: firma del aliado y aceptación de una versión congelada (servidor).
 * Todo con service-role DESPUÉS de autorizar en código (las tablas no tienen políticas para clientes): la sesión es la única fuente de identidad;
 * del formulario solo se lee el hash que la persona VIO (para detectar una versión desfasada), nunca quién firma ni qué ficha.
 */
import { randomUUID } from "node:crypto";
import type { ComisionResuelta } from "@/lib/finanzas/comisionResolver";
import type { ContextoEdicion } from "@/lib/portal/perfilEdicionServidor";
import { hashSnapshot, MENSAJE_NO_FIRMA, puedeFirmar, sha256Hex, validarImagenFirma, type SnapshotCuenta } from "@/lib/cuentaCobro/snapshot";

export const BUCKET_FIRMAS = "aliado-firmas";

// Sintaxis de método (bivariante): acepta el cliente tipado de Supabase aunque la tabla/RPC nuevas aún no estén en types/database.ts.
export type AdminFirmas = {
  from(tabla: string): any;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): any };
};

export type Aceptacion = { id: number; version: number; snapshot: SnapshotCuenta; snapshot_hash: string; firma_id: number; aceptada_en: string };
export type FirmaVigente = { id: number; sha256: string; creado_en: string };

const ERROR_GENERAL = "No se pudo guardar. Intenta de nuevo.";
const NO_AUTORIZADO = "No tienes permiso para firmar esta cuenta de cobro.";

/** Versiones aceptadas de ESTA comisión (acotado: una versión por cambio real del documento). `ok:false` = lectura fallida: nunca se confunde con «sin versiones». */
export async function leerAceptaciones(admin: AdminFirmas, clave: string): Promise<{ ok: true; filas: Aceptacion[] } | { ok: false }> {
  try {
    const { data, error } = await admin.from("cuenta_cobro_aceptaciones")
      .select("id, version, snapshot, snapshot_hash, firma_id, aceptada_en").eq("clave", clave).order("version", { ascending: true }).limit(200);
    if (error) return { ok: false };
    return { ok: true, filas: (data as Aceptacion[] | null) ?? [] };
  } catch { return { ok: false }; }
}

export async function firmaVigente(admin: AdminFirmas, aliadoId: number): Promise<{ ok: true; firma: FirmaVigente | null } | { ok: false }> {
  try {
    const { data, error } = await admin.from("aliado_firmas").select("id, sha256, creado_en").eq("aliado_id", aliadoId).eq("vigente", true).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, firma: (data as FirmaVigente | null) ?? null };
  } catch { return { ok: false }; }
}

/**
 * La imagen de una firma como data URI (nunca una URL pública): se lee del bucket privado solo después de que la página autorizó el documento, se exige que la
 * firma pertenezca a ESE aliado y que los bytes coincidan con el hash guardado. Cualquier fallo → null (el documento dice «imagen no disponible»).
 */
export async function firmaDataUri(admin: AdminFirmas, firmaId: number, aliadoId: number): Promise<string | null> {
  try {
    const { data: f, error } = await admin.from("aliado_firmas").select("storage_path, sha256, mime, aliado_id").eq("id", firmaId).maybeSingle();
    if (error || !f || f.aliado_id !== aliadoId) return null;
    const { data: blob, error: eDesc } = await admin.storage.from(BUCKET_FIRMAS).download(f.storage_path);
    if (eDesc || !blob) return null;
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    if (sha256Hex(bytes) !== f.sha256) return null;
    return `data:${f.mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch { return null; }
}

/** `ContextoEdicion` (sesión → usuarios → ficha) en la forma que consume `puedeFirmar`. */
export function contextoFirma(ctx: ContextoEdicion | null) {
  return ctx && ctx.lecturaOk && ctx.usuario
    ? { valido: ctx.permisos.valido, tipo: ctx.permisos.tipo, puedeFicha: ctx.permisos.puedeFicha, motivoFicha: ctx.permisos.motivoFicha, aliadoId: ctx.usuario.aliado_id }
    : null;
}

export type RespuestaFirma = { ok: true; repetida: boolean } | { ok: false; error: string };

/** Sube la imagen de firma del aliado freelance titular de su ficha. Bytes validados por sus primeros bytes; el nombre del archivo del navegador nunca se usa. */
export async function guardarFirmaServidor(
  admin: AdminFirmas, userId: string | null, ctx: ContextoEdicion | null, archivo: { bytes: Uint8Array; mime: string | null },
): Promise<RespuestaFirma> {
  if (!userId) return { ok: false, error: NO_AUTORIZADO };
  const c = contextoFirma(ctx);
  if (!c || !c.valido || c.tipo !== "freelance" || !c.puedeFicha || c.aliadoId == null) return { ok: false, error: c?.tipo === "agencia" ? MENSAJE_NO_FIRMA.agencia : (c?.motivoFicha ?? NO_AUTORIZADO) };
  const img = validarImagenFirma(archivo.bytes, archivo.mime);
  if (!img.ok) return img;
  const sha = sha256Hex(archivo.bytes);
  const path = `${c.aliadoId}/${randomUUID()}.${img.extension}`;
  const bucket = admin.storage.from(BUCKET_FIRMAS);
  try {
    const sube = await bucket.upload(path, archivo.bytes, { contentType: img.mime, upsert: false });
    if (sube.error) return { ok: false, error: ERROR_GENERAL };
    const r = await admin.rpc("registrar_firma_aliado", { p_aliado_id: c.aliadoId, p_path: path, p_sha: sha, p_mime: img.mime, p_bytes: archivo.bytes.length, p_user: userId });
    const d = r.data as { ok?: boolean; repetida?: boolean } | null;
    // Sin registro (error) o con la misma imagen ya vigente (repetida) el objeto recién subido sobra: se retira, sin dejar huérfanos.
    if (r.error || !d || d.ok !== true || d.repetida === true) { try { await bucket.remove([path]); } catch { /* huérfano inocuo: nada lo referencia */ } }
    if (r.error || !d || d.ok !== true) return { ok: false, error: ERROR_GENERAL };
    return { ok: true, repetida: d.repetida === true };
  } catch { return { ok: false, error: ERROR_GENERAL }; }
}

export type RespuestaAceptacion = { ok: true; version: number; repetida: boolean } | { ok: false; error: string; desfasada?: boolean };

/**
 * Acepta la versión VIVA recalculada en el servidor. Si el hash que la persona vio no es el de hoy (cambió la comisión, la retención o un dato del aliado),
 * se rechaza: nunca se acepta un contenido distinto al que se mostró. La versión la asigna la base bajo bloqueo; repetir el mismo contenido es idempotente.
 */
export async function aceptarCuentaServidor(
  admin: AdminFirmas,
  e: { userId: string | null; r: ComisionResuelta; ctx: ContextoEdicion | null; vivo: SnapshotCuenta | null; hashVisto: unknown; ahoraNegocio: string },
): Promise<RespuestaAceptacion> {
  if (!e.userId) return { ok: false, error: NO_AUTORIZADO };
  const p = puedeFirmar(e.r, contextoFirma(e.ctx));
  if (!p.ok) return { ok: false, error: MENSAJE_NO_FIRMA[p.motivo] };
  if (!e.vivo || !e.vivo.clave) return { ok: false, error: MENSAJE_NO_FIRMA.sin_clave };
  const hashVivo = hashSnapshot(e.vivo);
  if (typeof e.hashVisto !== "string" || e.hashVisto !== hashVivo) {
    return { ok: false, desfasada: true, error: "El documento cambió mientras lo revisabas. Recarga la página y revisa la versión nueva antes de aceptarla." };
  }
  // Se congela con la fecha de la aceptación (no la de hoy en la vista): el hash no la incluye.
  const congelado: SnapshotCuenta = { ...e.vivo, elaboracion: e.ahoraNegocio };
  try {
    const r = await admin.rpc("aceptar_cuenta_cobro", { p_clave: congelado.clave, p_aliado_id: p.aliadoId, p_snapshot: congelado, p_hash: hashVivo, p_user: e.userId });
    const d = r.data as { ok?: boolean; codigo?: string; version?: number; repetida?: boolean } | null;
    if (r.error || !d || typeof d !== "object") return { ok: false, error: ERROR_GENERAL };
    if (d.ok === true && typeof d.version === "number") return { ok: true, version: d.version, repetida: d.repetida === true };
    if (d.codigo === "sin_firma") return { ok: false, error: "Primero sube la imagen de tu firma en «Mi perfil»." };
    return { ok: false, error: ERROR_GENERAL };
  } catch { return { ok: false, error: ERROR_GENERAL }; }
}
