import { LoadingScreen } from "@/components/LoadingScreen";

// Fallback raíz: `app/layout.tsx` no hace ningún `await` propio, así que este
// `<Suspense>` cubre la resolución de layouts hijos async ((dashboard),
// (crm), cms) sin tocar sesión/rol/tenant.
//
// Sin sesión, `proxy.ts` (middleware) redirige a /login ANTES de que exista
// árbol de React — este fallback nunca se muestra en ese caso (no es un
// defecto). Verificado con curl y Playwright.
//
// El mecanismo (Suspense de un padre cubriendo un layout hijo async que no
// redirige) se confirmó con una prueba temporal sin auth, ya revertida.
//
// PENDIENTE: validar en Preview, con sesión autenticada real, que la
// secuencia (isotipo raíz → chrome del dashboard con overlay acotado →
// contenido) no tenga parpadeo de sidebar/topbar.
export default function CargandoRaiz() {
  return <LoadingScreen />;
}
