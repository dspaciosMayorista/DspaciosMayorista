"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";

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
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/crm");
  return { ok: true };
}

export async function eliminarContacto(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("crm_contactos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/crm");
  return { ok: true };
}

// Carga masiva (CSV). Deduplica por documento o email dentro del mismo lote.
export async function cargarContactosMasivo(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const errores: string[] = [];
  const filas: CrmInsert[] = [];
  const vistos = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.nombre || "").trim();
    if (!nombre) { errores.push(`Fila ${linea}: falta nombre.`); continue; }
    const clave = ((r.documento || "").trim() || (r.email || "").trim()).toLowerCase();
    if (clave && vistos.has(clave)) { errores.push(`Fila ${linea} (${nombre}): duplicado en el archivo, omitido.`); continue; }
    if (clave) vistos.add(clave);
    filas.push({
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
    });
  }

  let insertados = 0;
  if (filas.length) {
    const { error, count } = await sb.from("crm_contactos").insert(filas, { count: "exact" });
    if (error) return { ok: false, insertados: 0, errores: [...errores, error.message] };
    insertados = count ?? filas.length;
  }
  revalidatePath("/dashboard/crm");
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
  revalidatePath("/dashboard/crm/email");
  return { ok: true };
}
