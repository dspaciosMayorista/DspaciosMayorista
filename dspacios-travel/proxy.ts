import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `/auth` debe ser pública: el callback de OAuth (/auth/callback) corre ANTES de
// que exista la sesión; si el middleware lo bloquea, el login con Google falla.
// `/portal` y `/pagar` son públicas: el portal B2B muestra ingresar/registrarse
// sin sesión, y /pagar es el link de pago.
const RUTAS_PUBLICAS = ["/tarifario", "/login", "/c/", "/auth", "/portal", "/pagar"];

// Sitio web público de marketing (route group app/(sitio)). TODAS públicas.
// "/" se trata aparte (coincidencia exacta) para no abrir todo el dominio.
const RUTAS_SITIO = ["/paquetes", "/destinos", "/nosotros", "/testimonios", "/blog", "/cotizar"];

function esRutaSitio(pathname: string): boolean {
  if (pathname === "/") return true;
  return RUTAS_SITIO.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

// Rutas del SISTEMA (no deben servirse en el dominio público de la web).
const RUTAS_SISTEMA = ["/dashboard", "/cot", "/cotizacion", "/crm", "/contrato", "/voucher"];

function esRutaSistema(pathname: string): boolean {
  return RUTAS_SISTEMA.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

// Separación por host (subdominios). Se activa SOLO si se configuran las envs:
//   NEXT_PUBLIC_PORTAL_HOST  → dominio del sistema (ej. app.dspaciostravel.com)
//   NEXT_PUBLIC_SITIO_HOST   → dominio de la web    (ej. www.dspaciostravel.com)
// Sin envs, todo convive en un mismo dominio (modo combinado, seguro por defecto).
const PORTAL_HOST = process.env.NEXT_PUBLIC_PORTAL_HOST?.toLowerCase() || "";
const SITIO_HOST = process.env.NEXT_PUBLIC_SITIO_HOST?.toLowerCase() || "";

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
  const host = (request.headers.get("host") || "").toLowerCase();
  const enSitio = esRutaSitio(pathname);

  // ── Separación por subdominio (si está configurada) ──────────────────────
  // En el dominio del SISTEMA no se muestra la web de marketing: la raíz y las
  // rutas del sitio van al tarifario.
  if (PORTAL_HOST && host === PORTAL_HOST && enSitio) {
    return NextResponse.redirect(new URL("/tarifario", request.url));
  }
  // En el dominio de la WEB no se sirve el sistema: se manda al dominio del
  // portal (si se conoce) o, en su defecto, a la home pública.
  if (SITIO_HOST && host === SITIO_HOST && esRutaSistema(pathname)) {
    if (PORTAL_HOST) {
      return NextResponse.redirect(`https://${PORTAL_HOST}${pathname}${request.nextUrl.search}`);
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  // ── Auth: protege todo lo que no sea público ni del sitio ────────────────
  const esRutaPublica = RUTAS_PUBLICAS.some((ruta) => pathname.startsWith(ruta));

  if (!user && !esRutaPublica && !enSitio) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
