"use server";

// Soportes de pago del aliado (#86). Subir un soporte NO registra ni aprueba un pago: solo guarda evidencia.
// En CADA operación: sesión de aliado activo → el contrato (leído de la base, nunca del navegador) debe ser PROPIO → validación del contenido real →
// función de base (límite, tenant y sustitución los impone la base). Los archivos anteriores no se borran jamás.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { aliadoActual, contratosPropios, contarAbonos, contarVigentes, confirmarRuta, soporteVigenteConHash, sucesorDe, BUCKET_SOPORTES } from "@/lib/soportes/servidor";
import { cabeUnoNuevo, maxBytesSoporte, nombreSeguro, rutaSoporte, validarArchivo } from "@/lib/soportes/archivo";
import { mensajeDeBase, subirYVincular, type Validado } from "@/lib/soportes/operaciones";

export type ResultadoSoporte = { ok: true } | { ok: false; error: string };
const SIN_ACCESO = { ok: false, error: "No tienes acceso a ese contrato." } as const;
const RUTA = "/portal/b2b/cartera";

type Fila = { numero_contrato: string; vigente: boolean; path: string; sha256: string };
/** Un soporte ARCHIVADO pertenecía a un contrato que ya no existe (su número pudo reutilizarse): para cualquier aliado es como si no existiera. */

/** Lee el soporte por id y comprueba que su contrato sea PROPIO del aliado de la sesión. Nunca confía en el contrato que mande el navegador. */
async function soporteDelAliado(id: unknown): Promise<{ ok: true; fila: Fila; actor: string } | { ok: false; error: string }> {
  const ctx = await aliadoActual();
  if (!ctx) return { ok: false, error: "Inicia sesión para continuar." };
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return SIN_ACCESO;
  const { data } = await createAdminClient().from("contrato_soportes_pago").select("numero_contrato, vigente, path, sha256, archivado_en").eq("id", n).maybeSingle();
  if (!data || data.archivado_en) return SIN_ACCESO;
  const propios = await contratosPropios(ctx);
  if (!propios.has(data.numero_contrato)) return SIN_ACCESO;
  return { ok: true, fila: data as Fila, actor: ctx.userId };
}

async function leerArchivo(fd: FormData): Promise<{ ok: true; archivo: Validado; bytes: Uint8Array; nombre: string } | { ok: false; error: string }> {
  const f = fd.get("archivo");
  if (!(f instanceof File)) return { ok: false, error: "Elige un archivo." };
  const max = maxBytesSoporte(process.env.SOPORTES_MAX_BYTES);
  if (f.size > max) return { ok: false, error: "El archivo supera el máximo permitido." }; // antes de leerlo a memoria
  const bytes = new Uint8Array(await f.arrayBuffer());
  const v = validarArchivo(bytes, max); // tamaño y tipo REALES; hash de ESTOS mismos bytes
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, archivo: v, bytes, nombre: nombreSeguro(f.name) };
}

function depsStorage() {
  const bucket = createAdminClient().storage.from(BUCKET_SOPORTES);
  return {
    subir: (path: string, bytes: Uint8Array, mime: string) => bucket.upload(path, bytes, { contentType: mime, upsert: false }),
    borrar: (path: string) => bucket.remove([path]),
    confirmar: confirmarRuta,
    alertarHuerfano: (path: string, motivo: string) => console.error(`[soportes] objeto sin vínculo que no se pudo limpiar: ${path} (${motivo})`),
    alertarConciliacion: (path: string, motivo: string) => console.error(`[soportes] CONCILIAR: objeto conservado sin vínculo confirmado: ${path} (${motivo})`),
  };
}

export async function subirSoporte(fd: FormData): Promise<ResultadoSoporte> {
  const ctx = await aliadoActual();
  if (!ctx) return { ok: false, error: "Inicia sesión para continuar." };
  const numero = String(fd.get("numero") ?? "");
  const propios = await contratosPropios(ctx);
  if (!numero || !propios.has(numero)) return SIN_ACCESO;

  const l = await leerArchivo(fd);
  if (!l.ok) return l;

  // Reintento tras una respuesta perdida: el mismo contenido ya vigente en este contrato no se sube ni se avisa dos veces.
  if ((await soporteVigenteConHash(numero, l.archivo.sha256)) === true) { revalidatePath(RUTA); return { ok: true }; }

  // Aviso temprano (no autoritativo): evita subir un archivo que la base rechazaría. La base decide.
  const [abonos, vigentes] = await Promise.all([contarAbonos(numero), contarVigentes(numero)]);
  if (abonos !== null && vigentes !== null && !cabeUnoNuevo(vigentes, abonos)) return { ok: false, error: mensajeDeBase({ message: "SOPORTE_LIMITE" }) };

  const admin = createAdminClient();
  const path = rutaSoporte(numero, randomUUID(), l.archivo.ext);
  const r = await subirYVincular(
    {
      ...depsStorage(),
      registrar: async (p) => admin.rpc("soporte_registrar", { p_numero: numero, p_actor: ctx.userId, p_path: p, p_nombre: l.nombre, p_mime: l.archivo.mime, p_size: l.archivo.size, p_sha: l.archivo.sha256 }),
    },
    { path, archivo: l.archivo, bytes: l.bytes }
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(RUTA);
  return { ok: true };
}

export async function reemplazarSoporte(fd: FormData): Promise<ResultadoSoporte> {
  const s = await soporteDelAliado(fd.get("id"));
  if (!s.ok) return s;
  const l = await leerArchivo(fd);
  if (!l.ok) return l;
  const id = Number(fd.get("id"));
  if (s.fila.vigente) {
    // Mismo contenido que el soporte SELECCIONADO: no hay nada que cambiar. Si coincide con OTRO soporte del contrato NO se omite: el reemplazo pedido se ejecuta.
    if (s.fila.sha256 === l.archivo.sha256) { revalidatePath(RUTA); return { ok: true }; }
  } else {
    // El seleccionado ya no está vigente. Solo es un reintento tras respuesta perdida si su SUCESOR (reemplaza_id) trae este mismo contenido;
    // un soporte retirado, o reemplazado por otro archivo, no produce un éxito falso aunque exista otro archivo idéntico en el contrato.
    const suc = await sucesorDe(id);
    if (suc.estado === "error") return { ok: false, error: "No se pudo comprobar el estado del soporte. Inténtalo de nuevo." };
    if (suc.estado === "existe" && suc.sha256 === l.archivo.sha256) { revalidatePath(RUTA); return { ok: true }; }
    return { ok: false, error: mensajeDeBase({ message: "SOPORTE_NO_VIGENTE" }) };
  }

  const admin = createAdminClient();
  const path = rutaSoporte(s.fila.numero_contrato, randomUUID(), l.archivo.ext);
  const r = await subirYVincular(
    {
      ...depsStorage(),
      registrar: async (p) => admin.rpc("soporte_reemplazar", { p_id: id, p_actor: s.actor, p_path: p, p_nombre: l.nombre, p_mime: l.archivo.mime, p_size: l.archivo.size, p_sha: l.archivo.sha256 }),
    },
    { path, archivo: l.archivo, bytes: l.bytes }
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(RUTA);
  return { ok: true };
}

export async function retirarSoporte(id: number, nota?: string): Promise<ResultadoSoporte> {
  const s = await soporteDelAliado(id);
  if (!s.ok) return s;
  const { error } = await createAdminClient().rpc("soporte_retirar", { p_id: Number(id), p_actor: s.actor, p_nota: (nota ?? "").slice(0, 500) || null });
  if (error) return { ok: false, error: mensajeDeBase(error) };
  revalidatePath(RUTA);
  return { ok: true };
}

/** URL firmada de 2 min para abrir un soporte VIGENTE de un contrato propio. */
export async function urlSoporteAliado(id: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const s = await soporteDelAliado(id);
  if (!s.ok) return s;
  if (!s.fila.vigente) return { ok: false, error: mensajeDeBase({ message: "SOPORTE_NO_VIGENTE" }) };
  const { data, error } = await createAdminClient().storage.from(BUCKET_SOPORTES).createSignedUrl(s.fila.path, 120);
  if (error || !data) return { ok: false, error: "No se pudo abrir el archivo." };
  return { ok: true, url: data.signedUrl };
}
