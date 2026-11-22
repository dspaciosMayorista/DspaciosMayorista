import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CambiarContrasenaClient } from "./CambiarContrasenaClient";

export const metadata = { title: "Cambiar contraseña" };
export const dynamic = "force-dynamic";

// Requiere sesión (proxy.ts la exige: no es ruta pública). Sirve a TODOS los roles: el destino de "Volver" sale del rol real, nunca de un parámetro.
export default async function CambiarContrasenaPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  const externo = ["agencia", "freelance", "cliente_final"].includes(perfil?.rol ?? "");
  return <CambiarContrasenaClient volver={externo ? "/portal/b2b" : "/dashboard"} />;
}
