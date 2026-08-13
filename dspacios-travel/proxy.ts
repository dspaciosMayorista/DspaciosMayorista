import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_TENANT } from "@/lib/tenant";
import { LECTURA_MODULO, moduloDeRuta } from "@/lib/constants";

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

  // Perfil del usuario con sesión: se lee UNA sola vez y sirve para los dos
  // controles de abajo (activo y rol externo). Se salta en /login y /auth para
  // no consultar de más ni hacer bucle con el redirect de usuario inactivo.
  let perfil: { rol: string | null; activo: boolean } | null = null;
  if (user && !pathname.startsWith("/login") && !pathname.startsWith("/auth")) {
    const { data } = await supabase
      .from("usuarios")
      .select("rol, activo")
      .eq("id", user.id)
      .maybeSingle();
    perfil = data;
  }

  // ── Usuario desactivado: fuera de toda la app ───────────────────────────
  // `usuarios.activo` era decorativo: el JWT sigue vivo hasta que expira, así
  // que desmarcar "activo" no echaba a nadie. El candado de verdad está en la
  // RLS (migración 140: `mi_rol()` no devuelve rol si el usuario no está
  // activo); esto es la parte de cara al usuario, para que caiga en el login
  // con un aviso en vez de quedar viendo pantallas vacías. Cubre TODAS las
  // rutas, incluido /portal, que es pública para poder mostrar el ingreso.
  // Solo bloquea cuando se leyó el perfil y dice `activo = false`: si la fila
  // no existe o no se pudo leer, no se cambia el comportamiento de antes (no
  // dejar por fuera a alguien por un problema de datos).
  if (perfil && perfil.activo === false) {
    return NextResponse.redirect(new URL("/login?inactivo=1", request.url));
  }

  // ── Bloqueo de roles externos en el dashboard interno ───────────────────
  // Los aliados B2B no deben ver módulos internos (vuelos, finanzas, etc.).
  // Solo /dashboard/reservar les sirve (generar contrato). El resto → portal.
  if (
    perfil &&
    pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/dashboard/reservar") &&
    EXTERNOS.includes(perfil.rol ?? "")
  ) {
    return NextResponse.redirect(new URL("/portal/b2b", request.url));
  }

  // ── Módulos no permitidos para el rol → al dashboard ────────────────────
  // Ocultar el ítem del menú no impide escribir la dirección a mano, y este es
  // el único punto que cubre TODAS las sub-rutas de un módulo de una vez (ej.
  // /dashboard/producto/hoteles/12/tarifas) sin tener que poner un guardia en
  // cada página.
  //
  // No es la única defensa ni la principal: las tablas de costos, nómina y
  // contabilidad ya excluyen a `venta` por RLS, así que aunque entrara vería
  // pantallas vacías. Esto evita esa confusión y cierra el paso antes.
  if (perfil && pathname.startsWith("/dashboard")) {
    const modulo = moduloDeRuta(pathname);
    const permitidos = modulo ? LECTURA_MODULO[modulo] : null;
    if (permitidos && !permitidos.includes((perfil.rol ?? "") as never)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
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
