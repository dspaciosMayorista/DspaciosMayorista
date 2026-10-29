import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortalShell, Titulo } from "@/components/portal/PortalShell";
import { BotonTarifario } from "@/components/portal/BotonTarifario";
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
    <PortalShell nombre={p?.nombre} rol="agencia" cta={<BotonTarifario />} activa="agentes" mostrarAgentes>
      <Titulo apoyo="Personas de tu agencia con acceso al portal">Agentes de la agencia</Titulo>
      <AgentesClient agentes={(agentes ?? []) as Agente[]} />
    </PortalShell>
  );
}
