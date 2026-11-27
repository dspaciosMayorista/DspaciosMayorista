"use server";

// Soportes de pago (#86) — apertura por el PERSONAL INTERNO. La autorización es la RLS de `contrato_soportes_pago` (migración 281): la fila se lee con
// la sesión de quien pregunta; si no es visible, no hay URL. Solo después se firma con service-role. Mismo alcance que los archivos del bucket
// `contratos` (150): superadmin; gerencia/administración/operaciones de la misma agencia; venta solo en sus propios contratos.
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { parseIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { ROLES_CONTRATO_COMPLETO } from "@/lib/roles";
import { configCorreo, transporteDeConfig } from "@/lib/solicitudProveedor/transporte";
import { enviarAvisoRechazo, urlSoportesPortal, validarMotivo, type DepsAviso, type ResultadoAviso } from "@/lib/soportes/rechazo";
import { numeroVisible } from "@/lib/tenant";

const BUCKET = "soportes-pago";

// identidad:n/a — solo lectura: firma una URL, no escribe tablas de contrato
export async function urlSoporteInterno(id: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "No tienes acceso a ese soporte." };
  const sb = await createClient(); // identidad:n/a — solo lectura
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión para continuar." };
  const { data } = await sb.from("contrato_soportes_pago").select("path").eq("id", n).maybeSingle();
  if (!data) return { ok: false, error: "No tienes acceso a ese soporte." };
  const { data: firmado, error } = await createAdminClient(/* identidad:n/a — solo lectura */).storage.from(BUCKET).createSignedUrl(data.path, 120);
  if (error || !firmado) return { ok: false, error: "No se pudo abrir el archivo." };
  return { ok: true, url: firmado.signedUrl };
}

// ── Rechazo de un soporte (S339-02, migración 345) ──────────────────────────────────────────────────────────────────────────────
// Rechazar NO registra ni aprueba un pago ni toca saldos: la función de base solo retira el soporte (motivo obligatorio) y deja el estado del aviso al aliado.
// Rol: superadmin/gerencia/administración/operaciones (la base lo vuelve a exigir, incluida la agencia del contrato). El correo es un efecto secundario: su fallo no deshace el rechazo.

export type ResultadoRechazo = { ok: true; aviso: ResultadoAviso } | { ok: false; error: string };

async function actorRechazo(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sb = await createClient(); // identidad:n/a — solo lectura
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión para continuar." };
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  if (!perfil || !(ROLES_CONTRATO_COMPLETO as readonly string[]).includes(String(perfil.rol))) return { ok: false, error: "Tu rol no puede rechazar soportes de pago." };
  return { ok: true, id: user.id };
}

function depsAviso(): DepsAviso {
  const admin = createAdminClient(); // identidad:n/a — el estado del aviso no es una escritura de contrato
  return {
    config: () => configCorreo(),
    transporte: (c) => transporteDeConfig(c),
    reclamar: async (id) => {
      const { data, error } = await admin.rpc("soporte_rechazo_aviso_reclamar", { p_id: id });
      return { data: (data as never) ?? null, error: error ? { message: error.message } : null };
    },
    cerrar: async (id, estado, n, error) => { await admin.rpc("soporte_rechazo_aviso_cerrar", { p_id: id, p_estado: estado, p_destinatarios: n, p_error: error }); },
    numeroVisible,
    url: urlSoportesPortal(),
  };
}

/** Mensajes de la base para quien rechaza (sin códigos técnicos). */
function mensajeRechazo(msg: string): string {
  if (msg.includes("SOPORTE_NO_VIGENTE")) return "Ese soporte ya cambió (otro reemplazo, retiro o rechazo se adelantó). Actualiza la página.";
  if (msg.includes("SOPORTE_ROL")) return "No tienes permiso para rechazar ese soporte.";
  if (msg.includes("SOPORTE_MOTIVO")) return "Escribe el motivo del rechazo (hasta 500 caracteres).";
  if (msg.includes("SOPORTE_IDENTIDAD")) return "Este contrato cambió desde que abriste la página. Recárgala antes de continuar.";
  if (msg.includes("SOPORTE_ARCHIVADO") || msg.includes("SOPORTE_INEXISTENTE")) return "No tienes acceso a ese soporte.";
  return "No se pudo rechazar el soporte. Inténtalo de nuevo.";
}

export async function rechazarSoporte(id: number, motivo: string, identidad: IdentidadContrato): Promise<ResultadoRechazo> {
  const a = await actorRechazo();
  if (!a.ok) return a;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "No tienes acceso a ese soporte." };
  const m = validarMotivo(motivo);
  if (!m.ok) return m;
  const sb = await createClient(); // identidad:n/a — solo lectura (la RLS decide si el soporte es visible)
  const { data: fila } = await sb.from("contrato_soportes_pago").select("numero_contrato").eq("id", n).maybeSingle();
  if (!fila) return { ok: false, error: "No tienes acceso a ese soporte." };
  const { error } = await createAdminClient(parseIdentidad(identidad)).rpc("soporte_rechazar", { p_id: n, p_actor: a.id, p_motivo: m.motivo });
  if (error) return { ok: false, error: mensajeRechazo(error.message) };
  const aviso = await enviarAvisoRechazo(n, depsAviso());
  revalidatePath(`/dashboard/contratos/${fila.numero_contrato}`);
  revalidatePath("/portal/b2b/cartera");
  return { ok: true, aviso };
}

/** Reintento (acotado a 5 intentos por la base) del aviso de un rechazo cuyo correo no salió. */
// identidad:n/a — solo reenvía un correo y actualiza el estado del aviso; no escribe ninguna tabla del contrato
export async function reintentarAvisoRechazo(id: number): Promise<ResultadoRechazo> {
  const a = await actorRechazo();
  if (!a.ok) return a;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "No tienes acceso a ese soporte." };
  const sb = await createClient(); // identidad:n/a — solo lectura
  const { data: fila } = await sb.from("contrato_soportes_pago").select("numero_contrato, motivo_retiro").eq("id", n).maybeSingle();
  if (!fila || fila.motivo_retiro !== "rechazo") return { ok: false, error: "No tienes acceso a ese soporte." };
  const aviso = await enviarAvisoRechazo(n, depsAviso());
  revalidatePath(`/dashboard/contratos/${fila.numero_contrato}`);
  return { ok: true, aviso };
}
