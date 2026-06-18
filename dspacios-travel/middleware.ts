import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Roles externos (aliados B2B / cliente final): su lugar es el Portal B2B
// (/portal/b2b), NO el dashboard interno. La ÚNICA excepción es /dashboard/reservar,
// desde donde los aliados generan su contrato (el tarifario los enlaza ahí).
const EXTERNOS = ["agencia", "freelance", "cliente_final"];

// Matcher acotado a /dashboard/* (abajo). Para el resto de rutas este middleware
// ni se ejecuta, así que no cambia el comportamiento de auth existente.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  // Los aliados B2B sí reservan/generan contrato desde aquí.
  if (pathname.startsWith("/dashboard/reservar")) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Sin sesión: lo resuelve el layout del dashboard (redirige a /login). No lo
  // tocamos aquí para no cambiar el flujo de auth actual.
  if (!user) return response;

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();

  if (perfil && EXTERNOS.includes(perfil.rol ?? "")) {
    return NextResponse.redirect(new URL("/portal/b2b", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
