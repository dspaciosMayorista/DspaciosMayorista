"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const ROLES = ["superadmin", "gerencia", "administracion"];
const oNull = (s?: string) => (s && s.trim() !== "" ? s.trim() : null);
const toBool = (s?: string) => /^(s[ií]|si|true|1|x)$/i.test((s || "").trim());

function tempPassword(): string {
  const base = Math.random().toString(36).slice(2, 10);
  return `Ds-${base}1`;
}

// Cargue masivo de agencias/freelance: crea el aliado (catálogo de comisiones),
// el contacto en el CRM y, si se pide, su ACCESO B2B (usuario del portal).
// Devuelve credenciales creadas en la lista de "errores" (info) para compartir.
export async function cargarAgenciasB2B(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) return { ok: false, insertados: 0, errores: ["Solo administración/gerencia."] };

  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
  const info: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.nombre || "").trim();
    if (!nombre) { info.push(`Fila ${linea}: falta nombre.`); continue; }
    const tipo = (r.tipo || "").trim().toLowerCase().startsWith("free") ? "freelance" : "agencia";
    const pct = Number((r.pct_comision || "").replace(",", ".").replace(/[^\d.]/g, "")) || 0;
    const pctRet = Number((r.pct_retencion || "").replace(",", ".").replace(/[^\d.]/g, "")) || 0;
    const aplicaRet = toBool(r.aplica_retencion) || pctRet > 0;

    // 1) Catálogo de aliados (comisiones)
    await sb.from("aliados").insert({
      nombre, tipo, nit: oNull(r.nit), contacto: oNull(r.telefono), email: oNull(r.email),
      telefono: oNull(r.telefono),
      pct_comision: pct > 0 ? pct / 100 : null,
      aplica_retencion: aplicaRet, pct_retencion: pctRet / 100,
    });

    // 2) Contacto en el CRM
    await sb.from("crm_contactos").insert({
      categoria: tipo, nombre,
      documento: oNull(r.nit), email: oNull(r.email), telefono: oNull(r.telefono),
      ciudad: oNull(r.ciudad), origen: "cargue B2B",
    });

    // 3) Acceso B2B (usuario del portal)
    const email = (r.email || "").trim();
    if (toBool(r.crear_acceso) && email) {
      if (!admin) { info.push(`Fila ${linea} (${nombre}): no se creó acceso (falta SUPABASE_SERVICE_ROLE_KEY).`); }
      else {
        const pass = tempPassword();
        const { data: created, error } = await admin.auth.admin.createUser({
          email, password: pass, email_confirm: true, user_metadata: { nombre },
        });
        if (error || !created?.user) {
          info.push(`Fila ${linea} (${nombre}): acceso no creado (${error?.message ?? "error"}).`);
        } else {
          await admin.from("usuarios").update({ rol: tipo as "agencia" | "freelance", nombre }).eq("id", created.user.id);
          info.push(`✓ Acceso ${tipo} para ${email} · contraseña temporal: ${pass}`);
        }
      }
    }
    insertados++;
  }

  revalidatePath("/dashboard/aliados");
  revalidatePath("/crm");
  // ok=true para mostrar el recuadro en verde con las credenciales/avisos.
  return { ok: true, insertados, errores: info };
}
