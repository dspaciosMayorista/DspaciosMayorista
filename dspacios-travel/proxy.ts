import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_TENANT } from "@/lib/tenant";

// Módulos NO habilitados en la agencia Minorista (deben coincidir con los ítems
// `minoristaOculto` del nav en app/(dashboard)/layout.tsx). Si la agencia activa
// es minorista y se entra a uno de estos, se redirige al dashboard.
const MINORISTA_OCULTAS = [
  "/dashboard/reservar",
  "/dashboard/cotizaciones",
  "/dashboard/vuelos",
  "/dashboard/paquetes",
  "/dashboard/producto",
  "/cms",
];

// `/auth` debe ser pública: el callback de OAuth (/auth/callback) corre ANTES de
// que exista la sesión; si el middleware lo bloquea, el login con Google falla.
// `/portal` y `/pagar` son públicas: el portal B2B muestra ingresar/registrarse
// sin sesión, y /pagar es el link de pago.
// `/sitio_web` es la web pública de marketing (route group app/sitio_web): toda pública.
const RUTAS_PUBLICAS = ["/tarifario", "/login", "/c/", "/auth", "/portal", "/pagar", "/sitio_web"];

// Roles externos (aliados B2B / cliente final): su lugar es el Portal B2B,
// NO el dashboard interno. Única excepción: /dashboard/reservar, desde donde
// los aliados generan su contrato (el tarifario los enlaza ahí).
const EXTERNOS = ["agencia", "freelance", "cliente_final"];

export async function proxy(request: NextRequest) {
  // ── SaaS: tenant por PATH. `/o/<slug>/...` (público) se reescribe a `/...`
  // poniendo el header `x-org-slug` para que las páginas resuelvan el org del
  // slug (ver lib/org.ts: orgDelRequest). No duplica rutas. `/o/<slug>` solo =
  // tarifario público de esa agencia.
  const mOrg = request.nextUrl.pathname.match(/^\/o\/([^/]+)(\/.*)?$/);
  if (mOrg) {
    const url = request.nextUrl.clone();
    url.pathname = mOrg[2] || "/tarifario";
    const headers = new Headers(request.headers);
    headers.set("x-org-slug", mOrg[1].toLowerCase());
    return NextResponse.rewrite(url, { request: { headers } });
  }

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

  // ── Bloqueo de roles externos en el dashboard interno ───────────────────
  // Los aliados B2B no deben ver módulos internos (vuelos, finanzas, etc.).
  // Solo /dashboard/reservar les sirve (generar contrato). El resto → portal.
  if (
    user &&
    pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/dashboard/reservar")
  ) {
    const { data: perfil } = await supabase
      .from("usuarios")
      .select("rol")
      .eq("id", user.id)
      .maybeSingle();
    if (perfil && EXTERNOS.includes(perfil.rol ?? "")) {
      return NextResponse.redirect(new URL("/portal/b2b", request.url));
    }
  }

  // ── Minorista: módulos ocultos → al dashboard ───────────────────────────
  // Si la agencia activa es minorista y la pantalla pertenece a un módulo no
  // habilitado (netas/producto, paquetes, vuelos, etc.), redirige al dashboard
  // (p. ej. al cambiar de agencia estando en esa pantalla).
  if (user) {
    const tenant = request.cookies.get(COOKIE_TENANT)?.value;
    if (tenant === "minorista" && MINORISTA_OCULTAS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
