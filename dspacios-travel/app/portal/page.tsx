import { redirect } from "next/navigation";
import { resolverContextoPortal } from "@/lib/portal/b2bPortalServidor";
import { destinoPortal } from "@/lib/portal/b2bPortal";

export const dynamic = "force-dynamic";

/** Sin pantalla de elección: cada sesión va directo a su espacio. */
export default async function PortalEntrada() {
  const ctx = await resolverContextoPortal();
  redirect(destinoPortal(ctx));
}
