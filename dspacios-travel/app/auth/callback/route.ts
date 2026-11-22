import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { destinoLocalSeguro, DESTINO_POR_DEFECTO } from "@/lib/auth/destinoSeguro";
import { iniciarContextoAgencia } from "@/lib/auth/contextoAgencia";
import { esSesionDeRecuperacion } from "@/lib/auth/recuperacion";

// Intercambia el código de OAuth (Google) o de recuperación de contraseña por una sesión y redirige.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` llega en la URL: solo se acepta una ruta del mismo origen.
  const next = destinoLocalSeguro(searchParams.get("next"), origin);
  // `next` es SOLO una pista de adónde mandar un error: nunca prueba que sea una recuperación (cualquiera puede escribirlo en un enlace).
  const pidioRestablecer = next === "/restablecer";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // #62 (B1): la recuperación la determina la SESIÓN canjeada (método de recuperación en su token), no el destino pedido.
      if (esSesionDeRecuperacion(data?.session?.access_token)) {
        return NextResponse.redirect(`${origin}/restablecer`);
      }
      // Sesión ordinaria (OAuth, enlace mágico…): ni siquiera con next=/restablecer entra al restablecimiento; sigue su destino normal.
      // Vincula la agencia activa a la sesión recién creada (D8/D9, migración 237).
      await iniciarContextoAgencia().catch(() => undefined);
      return NextResponse.redirect(`${origin}${pidioRestablecer ? DESTINO_POR_DEFECTO : next}`);
    }
  }
  // Enlace vencido, ya usado o abierto en otro navegador (el código PKCE vive en el navegador que lo pidió): pedir uno nuevo, sin detalles del motivo.
  if (pidioRestablecer) return NextResponse.redirect(`${origin}/recuperar?error=enlace`);
  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
