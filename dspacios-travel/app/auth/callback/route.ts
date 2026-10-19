import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { destinoLocalSeguro } from "@/lib/auth/destinoSeguro";

// Intercambia el código de OAuth (Google) por una sesión y redirige.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` llega en la URL: solo se acepta una ruta del mismo origen.
  const next = destinoLocalSeguro(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
