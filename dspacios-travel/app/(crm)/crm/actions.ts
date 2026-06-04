"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { enviarEmail, type EmailConfig } from "@/lib/crm/email";
import { renderEmailHtml } from "@/lib/crm/plantilla-email";

type CrmInsert = Database["public"]["Tables"]["crm_contactos"]["Insert"];
type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export const CATEGORIAS = ["cliente_final", "agencia", "freelance", "empresa", "pasajero"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

function normCategoria(s?: string): Categoria {
  const v = (s || "").trim().toLowerCase().replace(/\s+/g, "_");
  if ((CATEGORIAS as readonly string[]).includes(v)) return v as Categoria;
  if (v.startsWith("cliente")) return "cliente_final";
  if (v.startsWith("agenc")) return "agencia";
  if (v.startsWith("free")) return "freelance";
  if (v.startsWith("empres")) return "empresa";
  if (v.startsWith("pasaj")) return "pasajero";
  return "cliente_final";
}

const toBool = (s?: string) => /^(s[ií]|si|true|1|x)$/i.test((s || "").trim());

export type ContactoInput = {
  categoria: string;
  nombre: string;
  tipoDoc: string;
  documento: string;
  email: string;
  telefono: string;
  ciudad: string;
  pais: string;
  fechaNacimiento: string;
  genero: string;
  origen: string;
  aceptaPublicidad: boolean;
  noContactar: boolean;
  notas: string;
};

export async function crearContacto(input: ContactoInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("crm_contactos").insert({
    categoria: normCategoria(input.categoria),
    nombre: input.nombre.trim(),
    tipo_doc: oNull(input.tipoDoc),
    documento: oNull(input.documento),
    email: oNull(input.email),
    telefono: oNull(input.telefono),
    ciudad: oNull(input.ciudad),
    pais: oNull(input.pais),
    fecha_nacimiento: oNull(input.fechaNacimiento),
    genero: oNull(input.genero),
    origen: oNull(input.origen),
    acepta_publicidad: input.aceptaPublicidad,
    no_contactar: input.noContactar,
    notas: oNull(input.notas),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya existe un contacto con ese documento, teléfono o correo." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/crm");
  return { ok: true };
}

export async function eliminarContacto(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("crm_contactos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm");
  return { ok: true };
}

// Carga masiva (CSV). Deduplica por documento, teléfono y email — dentro del
// archivo Y contra lo ya guardado (índices únicos de la BD). El teléfono compara
// solo dígitos.
const digitos = (s?: string) => (s || "").replace(/[^0-9]/g, "");

export async function cargarContactosMasivo(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const errores: string[] = [];
  let insertados = 0;
  const vistosDoc = new Set<string>(), vistosEmail = new Set<string>(), vistosTel = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.nombre || "").trim();
    if (!nombre) { errores.push(`Fila ${linea}: falta nombre.`); continue; }

    const doc = (r.documento || "").trim();
    const email = (r.email || "").trim().toLowerCase();
    const tel = digitos(r.telefono);
    // Duplicado dentro del mismo archivo.
    if (doc && vistosDoc.has(doc)) { errores.push(`Fila ${linea} (${nombre}): documento repetido en el archivo.`); continue; }
    if (email && vistosEmail.has(email)) { errores.push(`Fila ${linea} (${nombre}): email repetido en el archivo.`); continue; }
    if (tel && vistosTel.has(tel)) { errores.push(`Fila ${linea} (${nombre}): teléfono repetido en el archivo.`); continue; }

    const fila: CrmInsert = {
      categoria: normCategoria(r.categoria),
      nombre,
      tipo_doc: oNull(r.tipo_doc || ""),
      documento: oNull(r.documento || ""),
      email: oNull(r.email || ""),
      telefono: oNull(r.telefono || ""),
      ciudad: oNull(r.ciudad || ""),
      pais: oNull(r.pais || ""),
      fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test((r.fecha_nacimiento || "").trim()) ? r.fecha_nacimiento.trim() : null,
      genero: oNull(r.genero || ""),
      origen: oNull(r.origen || ""),
      acepta_publicidad: toBool(r.acepta_publicidad),
      no_contactar: toBool(r.no_contactar),
      notas: oNull(r.notas || ""),
    };
    // Inserta fila por fila para detectar duplicados contra la BD (índices únicos).
    const { error } = await sb.from("crm_contactos").insert(fila);
    if (error) {
      if (error.code === "23505") errores.push(`Fila ${linea} (${nombre}): ya existe (documento/teléfono/email duplicado).`);
      else errores.push(`Fila ${linea} (${nombre}): ${error.message}`);
      continue;
    }
    if (doc) vistosDoc.add(doc); if (email) vistosEmail.add(email); if (tel) vistosTel.add(tel);
    insertados++;
  }

  revalidatePath("/crm");
  return { ok: errores.length === 0, insertados, errores };
}

// ── Configuración de email (envío de campañas) ─────────────────────────────
const ROLES_EMAIL = ["superadmin", "gerencia", "administracion"];

export type EmailConfigInput = {
  proveedor: string;
  remitenteEmail: string;
  remitenteNombre: string;
  responderA: string;
  apiKey: string;
  firmaHtml: string;
  activo: boolean;
};

export async function guardarEmailConfig(input: EmailConfigInput): Promise<Result> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_EMAIL.includes(perfil?.rol ?? "")) return { ok: false, error: "Solo administración/gerencia." };

  const { error } = await sb.from("crm_email_config").upsert({
    id: 1,
    proveedor: input.proveedor,
    remitente_email: oNull(input.remitenteEmail),
    remitente_nombre: oNull(input.remitenteNombre),
    responder_a: oNull(input.responderA),
    api_key: oNull(input.apiKey),
    firma_html: oNull(input.firmaHtml),
    activo: input.activo,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/crm/email");
  return { ok: true };
}

// Envía UN correo de prueba con la config GUARDADA para validar API key / remitente
// / dominio antes de activar campañas. No exige 'activo' (es justo para probar antes
// de encenderlo) y, al ser a un solo destino del propio equipo, ignora consentimiento
// y tope. Devuelve el error EXACTO del proveedor si algo falla (SPF/DKIM, key, etc.).
export async function enviarEmailPrueba(destino: string): Promise<Result> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_EMAIL.includes(perfil?.rol ?? "")) return { ok: false, error: "Solo administración/gerencia." };

  const dest = oNull(destino);
  if (!dest || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest)) return { ok: false, error: "Pon un correo destino válido para la prueba." };

  const { data: cfg } = await sb.from("crm_email_config").select("*").eq("id", 1).maybeSingle();
  if (!cfg) return { ok: false, error: "Guarda primero la configuración de email." };
  if (!cfg.api_key || !cfg.remitente_email) return { ok: false, error: "Falta la API key o el correo remitente. Guárdalos y vuelve a probar." };
  if (cfg.proveedor !== "brevo" && cfg.proveedor !== "resend") return { ok: false, error: "El envío automático solo soporta Brevo o Resend." };

  const html = renderEmailHtml(
    {
      mensaje:
        "Este es un correo de prueba de D'spacios Travel.\n\n" +
        "Si lo recibes, la configuración de envío (proveedor, API key y remitente) funciona correctamente.",
      remitenteNombre: cfg.remitente_nombre,
    },
    cfg.firma_html,
  );

  const r = await enviarEmail(cfg as EmailConfig, dest, "Correo de prueba · D'spacios Travel", html);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}
