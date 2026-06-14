import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/app/(dashboard)/LogoutButton";
import { AgentesClient, type Agente } from "./AgentesClient";

export const dynamic = "force-dynamic";

export default async function AgentesPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/portal/b2b");
  const { data: p } = await sb.from("usuarios").select("nombre, rol, agencia_id, activo").eq("id", user.id).maybeSingle();
  // Solo el titular de la agencia (rol agencia, sin agencia_id) y activo.
  if (!(p?.rol === "agencia" && !p.agencia_id && p.activo)) redirect("/portal/b2b");

  const admin = createAdminClient();
  const { data: agentes } = await admin
    .from("usuarios")
    .select("id, nombre, email, activo")
    .eq("agencia_id", user.id)
    .order("nombre");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-gradient px-6 py-6 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/portal/b2b"><Logo variant="white" height={36} priority className="h-9 w-auto" /></Link>
          <LogoutButton className="text-sm text-white/90 hover:text-white" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Link href="/portal/b2b" className="text-sm text-gray-400 hover:text-gray-700">← Mis contratos</Link>
        <h1 className="mt-2 mb-1 text-2xl font-semibold text-gray-900">Agentes de la agencia</h1>
        <p className="mb-6 text-sm text-gray-500">{p?.nombre}</p>
        <AgentesClient agentes={(agentes ?? []) as Agente[]} />
      </main>
    </div>
  );
}
