import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { EmailConfigForm } from "./EmailConfigForm";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function EmailConfigPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Configuración de email</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Solo administración / gerencia.</p>
      </div>
    );
  }

  const { data } = await sb
    .from("crm_email_config")
    .select("proveedor, remitente_email, remitente_nombre, responder_a, api_key, firma_html, activo")
    .eq("id", 1)
    .maybeSingle();

  const inicial = data ?? { proveedor: "brevo", remitente_email: null, remitente_nombre: null, responder_a: null, api_key: null, firma_html: null, activo: false };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/crm" className="text-sm text-gray-400 hover:text-gray-600">← CRM</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Configuración de email</h1>
      <p className="mb-6 text-sm text-gray-500">Remitente y proveedor para las campañas del CRM.</p>
      <EmailConfigForm inicial={inicial} />
    </div>
  );
}
