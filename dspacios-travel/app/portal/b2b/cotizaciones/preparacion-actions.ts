"use server";

// O-3 — el aliado prepara su solicitud de contrato: adjunta comprobantes a la COTIZACIÓN y, si quiere, escribe pasajeros adicionales.
// Un comprobante NO es un pago: nada de aquí toca abonos, pagos previos, saldos ni el mínimo de confirmación. El aliado sale de la SESIÓN (nunca de un argumento) y las
// funciones de base de datos (325) re-verifican rol, propiedad de la cotización y estado bajo bloqueo. Los archivos nunca se borran (retirar solo deja de vigente).
// Llamadas esperadas por acción: 1 lectura de sesión/perfil + 1 RPC de verificación + (subida: 1 Storage + 1 RPC); sin sondeos ni reintentos.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolverContextoPortal } from "@/lib/portal/b2bPortalServidor";
import { maxBytesSoporte, nombreSeguro, validarArchivo } from "@/lib/soportes/archivo";
import { mensajeDeBase, subirYVincular } from "@/lib/soportes/operaciones";
import { errorPasajerosAliado, mensajeErrorPasajeros, mensajeLimiteCaptura, sinFilasVacias, type PasajeroAliado } from "@/lib/portal/preparacionContrato";
import { LIMITE_CAPTURA_ADICIONALES } from "@/lib/reservar/universoViajeros";
import { hoyBogota } from "@/lib/cotizacion/vigencia";

export type ResultadoPreparacion = { ok: true } | { ok: false; error: string };
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const BUCKET = "evidencias-cotizacion";
const RUTA = "/portal/b2b/cotizaciones";
const SIN_SESION: ResultadoPreparacion = { ok: false, error: "Inicia sesión con tu cuenta de aliado." };

const idValido = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const rpcDe = () => { const a = createAdminClient(); return (a as unknown as { rpc: Rpc }).rpc.bind(a); };

/** Adjunta UN comprobante (PDF/JPG/PNG) a una cotización PROPIA. El tipo y el tamaño se validan sobre los bytes reales; el mismo contenido vigente no se repite. */
export async function adjuntarEvidenciaCotizacion(fd: FormData): Promise<ResultadoPreparacion> {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return SIN_SESION;
  const cotizacionId = Number(fd.get("cotizacionId"));
  if (!idValido(cotizacionId)) return { ok: false, error: "No encontramos esa cotización entre las tuyas." };
  const f = fd.get("archivo");
  if (!(f instanceof File)) return { ok: false, error: "Elige un archivo." };
  const max = maxBytesSoporte(process.env.SOPORTES_MAX_BYTES);
  if (f.size > max) return { ok: false, error: "El archivo supera el máximo permitido." }; // antes de leerlo a memoria
  const bytes = new Uint8Array(await f.arrayBuffer());
  const v = validarArchivo(bytes, max);
  if (!v.ok) return { ok: false, error: v.error };

  const rpc = rpcDe();
  // Propiedad y estado ANTES de tocar Storage (la base vuelve a decidir al registrar).
  const pre = await rpc("evidencia_cotizacion_verificar", { p_cotizacion_id: cotizacionId, p_actor: ctx.userId });
  if (pre.error) return { ok: false, error: mensajeDeBase(pre.error) };
  // Reintento tras una respuesta perdida: el mismo contenido ya vigente no se sube ni se registra dos veces.
  const admin = createAdminClient();
  const dup = await (admin as unknown as { from: (t: string) => { select: (c: string, o: { count: "exact"; head: true }) => { eq: (a: string, b: unknown) => { eq: (a: string, b: unknown) => { eq: (a: string, b: unknown) => PromiseLike<{ count: number | null; error: unknown }> } } } } })
    .from("cotizacion_evidencias").select("id", { count: "exact", head: true }).eq("cotizacion_id", cotizacionId).eq("vigente", true).eq("sha256", v.sha256);
  if (dup.error) return { ok: false, error: "No pudimos comprobar el comprobante. Intenta de nuevo." };
  if ((dup.count ?? 0) > 0) { revalidatePath(RUTA); return { ok: true }; }

  const path = `${cotizacionId}/${randomUUID()}.${v.ext}`;
  const bucket = admin.storage.from(BUCKET);
  const r = await subirYVincular(
    {
      subir: (p, b, mime) => bucket.upload(p, b, { contentType: mime, upsert: false }),
      borrar: (p) => bucket.remove([p]),
      registrar: (p) => rpc("evidencia_cotizacion_registrar", { p_cotizacion_id: cotizacionId, p_actor: ctx.userId, p_path: p, p_nombre: nombreSeguro(f.name), p_mime: v.mime, p_size: v.size, p_sha: v.sha256 }),
      confirmar: async (p) => {
        try {
          const { data, error } = await (admin as unknown as { from: (t: string) => { select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } } } }).from("cotizacion_evidencias").select("id").eq("path", p).maybeSingle();
          return error ? "incierto" : data ? "vinculado" : "ausente";
        } catch { return "incierto"; }
      },
      alertarHuerfano: (p, m) => console.error(`[evidencias-cotizacion] objeto sin vínculo que no se pudo limpiar: ${p} (${m})`),
      alertarConciliacion: (p, m) => console.error(`[evidencias-cotizacion] CONCILIAR: objeto conservado sin vínculo confirmado: ${p} (${m})`),
    },
    { path, archivo: v, bytes }
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(RUTA);
  return { ok: true };
}

/** Retira un comprobante vigente propio: deja de contar y de mostrarse como vigente; el archivo y la fila se conservan. */
export async function retirarEvidenciaCotizacion(id: number): Promise<ResultadoPreparacion> {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return SIN_SESION;
  if (!idValido(id)) return { ok: false, error: "Ese comprobante ya no está vigente. Actualiza la página." };
  const { error } = await rpcDe()("evidencia_cotizacion_retirar", { p_id: id, p_actor: ctx.userId });
  if (error) return { ok: false, error: mensajeDeBase(error) };
  revalidatePath(RUTA);
  return { ok: true };
}

/** Guarda (reemplaza) la lista OPCIONAL de pasajeros adicionales; una lista vacía la borra. Solo se guarda lo escrito: nadie se inventa. */
export async function guardarPasajerosAliado(cotizacionId: number, pasajeros: PasajeroAliado[]): Promise<ResultadoPreparacion & { guardados?: number }> {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return SIN_SESION;
  if (!idValido(cotizacionId)) return { ok: false, error: "No encontramos esa cotización entre las tuyas." };
  if (!Array.isArray(pasajeros)) return { ok: false, error: "La lista de pasajeros no es válida." };
  // Mismo límite que la pantalla, la función de la base y el CHECK de la tabla (no se trunca: se dice).
  if (pasajeros.length > LIMITE_CAPTURA_ADICIONALES) return { ok: false, error: mensajeLimiteCaptura() };
  const limpios: PasajeroAliado[] = pasajeros.map((p) => ({
    nombres: String(p?.nombres ?? ""), apellidos: String(p?.apellidos ?? ""), tipoDoc: String(p?.tipoDoc ?? ""),
    numeroDoc: String(p?.numeroDoc ?? ""), fechaNacimiento: String(p?.fechaNacimiento ?? ""), nacionalidad: String(p?.nacionalidad ?? ""),
  }));
  const lista = sinFilasVacias(limpios);
  const e = errorPasajerosAliado(lista, hoyBogota(), 2);
  if (e) return { ok: false, error: e };
  const { data, error } = await rpcDe()("cotizacion_pasajeros_aliado_guardar", { p_cotizacion_id: cotizacionId, p_actor: ctx.userId, p_pasajeros: lista });
  if (error) return { ok: false, error: mensajeErrorPasajeros(error.code, error.message) };
  revalidatePath(RUTA);
  return { ok: true, guardados: Number((data as { guardados?: number } | null)?.guardados ?? 0) };
}
