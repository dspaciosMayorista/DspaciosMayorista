"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { enviarEmail, type EmailConfig } from "@/lib/crm/email";
import { renderEmailHtml, type EmailContenido } from "@/lib/crm/plantilla-email";

const ROLES = ["superadmin", "gerencia", "administracion"];
const CAP = 300; // tope de destinatarios por envío (evita timeouts)

export type EnvioCampanaResult =
  | { ok: true; total: number; enviados: number; fallidos: number; nota?: string }
  | { ok: false; error: string };

async function gate(sb: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  return ROLES.includes(perfil?.rol ?? "");
}

type Destinatario = { email: string; nombre: string };

// Núcleo: arma el HTML con la plantilla, envía a la lista y registra la campaña.
async function enviarA(
  sb: Awaited<ReturnType<typeof createClient>>,
  destinatarios: Destinatario[],
  asunto: string,
  contenido: Omit<EmailContenido, "remitenteNombre">,
  categoria: string | null,
  tipo: string
): Promise<EnvioCampanaResult> {
  const { data: cfg } = await sb.from("crm_email_config").select("*").eq("id", 1).maybeSingle();
  if (!cfg || !cfg.activo) return { ok: false, error: "El envío de email no está activo. Configúralo en Config email." };
  if (!cfg.api_key || !cfg.remitente_email) return { ok: false, error: "Falta la API key o el correo remitente (Config email)." };

  let nota: string | undefined;
  let lista = destinatarios;
  if (lista.length > CAP) { nota = `Se envió a los primeros ${CAP} de ${lista.length}. Repite para el resto.`; lista = lista.slice(0, CAP); }
  if (!lista.length) return { ok: false, error: "No hay destinatarios válidos (con email, que aceptan publicidad y no marcados 'no contactar')." };

  const html = renderEmailHtml({ ...contenido, remitenteNombre: cfg.remitente_nombre }, cfg.firma_html);
  let enviados = 0, fallidos = 0;

  // Envío en lotes pequeños en paralelo. Personaliza {{nombre}} por destinatario.
  const pers = (s: string, n: string) => s.replaceAll("{{nombre}}", n || "");
  for (let i = 0; i < lista.length; i += 8) {
    const lote = lista.slice(i, i + 8);
    const res = await Promise.all(lote.map((d) => enviarEmail(cfg as EmailConfig, d.email, pers(asunto, d.nombre), pers(html, d.nombre))));
    for (const r of res) { if (r.ok) enviados++; else fallidos++; }
  }

  await sb.from("crm_campanas").insert({
    asunto, cuerpo_html: html, categoria, tipo,
    total: lista.length, enviados, fallidos, estado: "enviada",
  });
  revalidatePath("/crm/campanas");
  return { ok: true, total: lista.length, enviados, fallidos, nota };
}

export type CampanaInput = {
  tipo: string;
  asunto: string;
  mensaje: string;
  imagenUrl: string;
  botonTexto: string;
  botonUrl: string;
  categoria: string;
};

export async function enviarCampana(input: CampanaInput): Promise<EnvioCampanaResult> {
  const sb = await createClient();
  if (!(await gate(sb))) return { ok: false, error: "Solo administración/gerencia." };
  if (!input.asunto.trim()) return { ok: false, error: "Pon un asunto." };
  if (!input.mensaje.trim() && !input.imagenUrl.trim()) return { ok: false, error: "Escribe un mensaje o agrega una imagen." };

  let q = sb.from("crm_contactos").select("email, nombre")
    .eq("acepta_publicidad", true).eq("no_contactar", false).not("email", "is", null);
  if (input.categoria && input.categoria !== "todos") q = q.eq("categoria", input.categoria);
  const { data } = await q;
  const dest = (data ?? []).filter((c) => c.email).map((c) => ({ email: c.email as string, nombre: c.nombre }));

  return enviarA(sb, dest, input.asunto, {
    mensaje: input.mensaje, imagenUrl: input.imagenUrl || null,
    botonTexto: input.botonTexto || null, botonUrl: input.botonUrl || null,
  }, input.categoria || "todos", (input.tipo || "campaña").trim());
}

// Felicitaciones de cumpleaños (informativo): respeta 'no contactar' pero no exige
// acepta_publicidad. `soloHoy=false` = todos los del MES.
export async function enviarFelicitacionCumple(input: { asunto: string; mensaje: string; imagenUrl: string; soloHoy: boolean }): Promise<EnvioCampanaResult> {
  const sb = await createClient();
  if (!(await gate(sb))) return { ok: false, error: "Solo administración/gerencia." };
  if (!input.asunto.trim() || !input.mensaje.trim()) return { ok: false, error: "Asunto y mensaje son obligatorios." };

  const { data } = await sb.from("crm_contactos").select("email, nombre, fecha_nacimiento")
    .eq("no_contactar", false).not("email", "is", null).not("fecha_nacimiento", "is", null);

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const [, mm, dd] = hoy.split("-");
  const dest = (data ?? []).filter((c) => {
    if (!c.email || !c.fecha_nacimiento) return false;
    const [, m, d] = c.fecha_nacimiento.split("-");
    return input.soloHoy ? (m === mm && d === dd) : (m === mm);
  }).map((c) => ({ email: c.email as string, nombre: c.nombre }));

  return enviarA(sb, dest, input.asunto, { mensaje: input.mensaje, imagenUrl: input.imagenUrl || null }, "cumpleaños", "cumpleanos");
}
