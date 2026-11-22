import { RecuperarClient } from "./RecuperarClient";

export const metadata = { title: "Recuperar contraseña" };

// Pública (proxy.ts: /recuperar). `?error=enlace` lo pone /auth/callback cuando el enlace de recuperación venció o ya se usó.
export default async function RecuperarPage({ searchParams }: { searchParams: Promise<{ error?: string; desde?: string }> }) {
  const sp = await searchParams;
  return <RecuperarClient enlaceVencido={sp.error === "enlace"} desdeRegistro={sp.desde === "registro"} />;
}
