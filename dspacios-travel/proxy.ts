import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const RUTAS_PUBLICAS = ["/tarifario", "/login", "/c/"];

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
  const esRutaPublica = RUTAS_PUBLICAS.some((ruta) =>
    pathname.startsWith(ruta)
  );

  if (!user && !esRutaPublica && pathname !== "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // La raíz "/" siempre abre el tarifario público (app/page.tsx la redirige),
  // también con sesión iniciada. Desde ahí cada quien usa "Ingresar".
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
