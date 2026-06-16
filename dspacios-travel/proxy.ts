import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `/auth` debe ser pública: el callback de OAuth (/auth/callback) corre ANTES de
// que exista la sesión; si el middleware lo bloquea, el login con Google falla.
// `/portal` y `/pagar` son públicas: el portal B2B muestra ingresar/registrarse
// sin sesión, y /pagar es el link de pago.
// `/sitio_web` es la web pública de marketing (route group app/sitio_web): toda pública.
const RUTAS_PUBLICAS = ["/tarifario", "/login", "/c/", "/auth", "/portal", "/pagar", "/sitio_web"];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // ── Auth: protege todo lo que no sea público ────────────────────────────
  // "/" lo maneja app/page.tsx (redirige a /tarifario); debe ser alcanzable sin
  // sesión. /cms y /dashboard/* exigen sesión.
  const esRutaPublica =
    pathname === "/" || RUTAS_PUBLICAS.some((ruta) => pathname.startsWith(ruta));

  if (!user && !esRutaPublica) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
