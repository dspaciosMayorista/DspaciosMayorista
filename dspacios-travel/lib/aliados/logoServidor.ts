/**
 * #32 (ADL-039) — Logo del aliado (servidor). Todo con service-role DESPUÉS de autorizar en quien llama; el archivo vive en el bucket PRIVADO
 * `aliado-logos` y solo sale por rutas que autorizan primero. El aliado de una cotización sale de lo que la cotización guardó, nunca de la URL.
 * Subir/retirar pasa por RPC (migración 319), que vuelve a verificar al actor y serializa por aliado.
 */
import { createHash } from "node:crypto";
import { aliadoIdDeCotizacion, BUCKET_LOGOS, cabecerasLogoPrivado, rutaLogo, validarLogo, type LogoAliadoDoc, type MimeLogo } from "@/lib/aliados/logo";

// Sintaxis de método (bivariante): acepta el cliente tipado de Supabase.
export type AdminLogo = {
  from(tabla: string): any;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): any };
};

export type RespuestaLogo = { ok: true; sinCambio: boolean } | { ok: false; error: string };

const ERROR_GENERAL = "No se pudo guardar el logo. Intenta de nuevo.";
const NO_AUTORIZADO = "No tienes permiso para cambiar el logo de este aliado.";

function mensaje(codigo: unknown): string {
  return codigo === "no_autorizado" ? NO_AUTORIZADO : codigo === "sin_aliado" ? "El aliado no existe." : ERROR_GENERAL;
}

/** Valida el CONTENIDO real, sube (direccionado por contenido) y registra la fila vigente. Quien llama ya autorizó al actor para ESE aliado. */
export async function guardarLogo(admin: AdminLogo, a: { actorId: string; aliadoId: number; bytes: Uint8Array }): Promise<RespuestaLogo> {
  const v = validarLogo(a.bytes);
  if (!v.ok) return v;
  const sha = createHash("sha256").update(a.bytes).digest("hex");
  const path = rutaLogo(a.aliadoId, sha, v.ext);
  const sube = await admin.storage.from(BUCKET_LOGOS).upload(path, a.bytes, { contentType: v.mime, upsert: false });
  // El mismo contenido ya subido antes (ruta idéntica) no es un error: el archivo es el mismo.
  if (sube?.error && !/already exists|duplicate/i.test(String((sube.error as { message?: string }).message ?? ""))) return { ok: false, error: ERROR_GENERAL };
  const r = await admin.rpc("registrar_logo_aliado", { p_actor: a.actorId, p_aliado: a.aliadoId, p_path: path, p_mime: v.mime, p_size: v.size, p_sha: sha });
  const d = r.data as { ok?: boolean; codigo?: string; sin_cambio?: boolean } | null;
  if (r.error || !d || typeof d !== "object") return { ok: false, error: ERROR_GENERAL };
  return d.ok === true ? { ok: true, sinCambio: d.sin_cambio === true } : { ok: false, error: mensaje(d.codigo) };
}

export async function retirarLogo(admin: AdminLogo, a: { actorId: string; aliadoId: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await admin.rpc("retirar_logo_aliado", { p_actor: a.actorId, p_aliado: a.aliadoId });
  const d = r.data as { ok?: boolean; codigo?: string } | null;
  if (r.error || !d || typeof d !== "object") return { ok: false, error: ERROR_GENERAL };
  return d.ok === true ? { ok: true } : { ok: false, error: mensaje(d.codigo) };
}

type FilaLogo = { id: number; path: string; mime: string; aliados: { nombre: string | null } | { nombre: string | null }[] | null };

/** Logo vigente del aliado (`null` = no tiene) o `"error"` si no se pudo leer (no se confunde con «sin logo»). */
export async function logoVigente(admin: AdminLogo, aliadoId: number): Promise<{ id: number; path: string; mime: string; nombre: string } | null | "error"> {
  const { data, error } = await admin.from("aliado_logos").select("id, path, mime, aliados(nombre)").eq("aliado_id", aliadoId).eq("vigente", true).maybeSingle();
  if (error) return "error";
  const f = data as FilaLogo | null;
  if (!f) return null;
  const al = Array.isArray(f.aliados) ? f.aliados[0] : f.aliados;
  return { id: f.id, path: f.path, mime: f.mime, nombre: (al?.nombre ?? "").trim() || "Aliado" };
}

export type CotizacionLogo = { id: number; aliado_id?: unknown; b2b_aliado?: unknown };

/** Columnas que hay que leer de `cotizaciones` para resolver el aliado dueño (ver `aliadoIdDeCotizacion`). */
export const COLUMNAS_ALIADO_COTIZACION = "id, aliado_id, b2b_aliado:payload->b2bAsistido->>aliado_id";

export async function aliadoDeCotizacion(admin: AdminLogo, c: CotizacionLogo): Promise<number | null> {
  const directo = aliadoIdDeCotizacion(c);
  if (directo) return directo;
  const { data } = await admin.from("comision_plan").select("aliado_id").eq("cotizacion_id", c.id).order("version", { ascending: false }).limit(1).maybeSingle();
  return aliadoIdDeCotizacion({ plan_aliado: (data as { aliado_id?: unknown } | null)?.aliado_id });
}

/** Para los documentos: `{src, nombre}` solo si la cotización es de un aliado que TIENE logo vigente; si no, `null` (el documento queda como siempre). */
export async function logoParaDocumento(admin: AdminLogo, c: CotizacionLogo, rutaBase: string): Promise<LogoAliadoDoc | null> {
  // El logo es solo presentación: si su búsqueda falla, el documento legal se emite igual, sin logo (nunca se cae la cotización por esto).
  try {
    const aliadoId = await aliadoDeCotizacion(admin, c);
    if (aliadoId == null) return null;
    const l = await logoVigente(admin, aliadoId);
    if (!l || l === "error") return null;
    return { src: `${rutaBase}/logo?v=${l.id}`, nombre: l.nombre };
  } catch (e) {
    console.error("[logo-aliado] no se pudo resolver el logo del documento; se emite sin logo", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Para la página pública: la cotización se relee POR TOKEN (consulta aparte, para no tocar la del documento) y de ELLA sale el aliado. */
export async function logoParaDocumentoPorToken(admin: AdminLogo, token: string): Promise<LogoAliadoDoc | null> {
  try {
    const { data } = await admin.from("cotizaciones").select(COLUMNAS_ALIADO_COTIZACION).eq("share_token", token).maybeSingle();
    return data ? await logoParaDocumento(admin, data as CotizacionLogo, `/cot/${token}`) : null;
  } catch (e) {
    console.error("[logo-aliado] no se pudo leer la cotización para el logo; se emite sin logo", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Respuesta HTTP con los bytes del logo vigente de un aliado, sin caché compartida. 404 si no hay. */
export async function respuestaLogoDeAliado(admin: AdminLogo, aliadoId: number | null): Promise<Response> {
  const nf = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (aliadoId == null) return nf();
  const l = await logoVigente(admin, aliadoId);
  if (!l || l === "error") return nf();
  const d = await admin.storage.from(BUCKET_LOGOS).download(l.path);
  if (d?.error || !d?.data) return nf();
  const bytes = new Uint8Array(await (d.data as Blob).arrayBuffer());
  return new Response(bytes, { status: 200, headers: cabecerasLogoPrivado(l.mime as MimeLogo) });
}

/** Respuesta del logo de una COTIZACIÓN (aliado resuelto desde la propia cotización). */
export async function respuestaLogoDeCotizacion(admin: AdminLogo, c: CotizacionLogo | null): Promise<Response> {
  if (!c) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return respuestaLogoDeAliado(admin, await aliadoDeCotizacion(admin, c));
}

/** Para la página interna `/cotizacion/[id]` (el acceso ya se autorizó en la página): la cotización se relee POR ID y de ELLA sale el aliado; así la página no toca el payload. */
export async function logoParaDocumentoPorId(admin: AdminLogo, id: number, rutaBase: string): Promise<LogoAliadoDoc | null> {
  try {
    const { data } = await admin.from("cotizaciones").select(COLUMNAS_ALIADO_COTIZACION).eq("id", id).maybeSingle();
    return data ? await logoParaDocumento(admin, data as CotizacionLogo, rutaBase) : null;
  } catch (e) {
    console.error("[logo-aliado] no se pudo leer la cotización para el logo; se emite sin logo", e instanceof Error ? e.message : e);
    return null;
  }
}
