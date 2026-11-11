import { createServerClient } from "@supabase/ssr";
// `next/headers` se carga DENTRO de usuarioDeSesion (solo con MANTENIMIENTO_CLAVE): importarlo arriba arrastraba next/headers a todo módulo que usa
// admin.ts, y las pruebas que lo cargan fuera de Next dejaban de resolver (regresión detectada en test:react).
type AlmacenCookies = { getAll(): { name: string; value: string }[] };

// Excepción de VALIDACIÓN durante una ventana de mantenimiento (migración 294). Solo para los clientes de SERVIDOR (sin «server-only»: se carga desde pruebas; el
// secreto no puede llegar al navegador porque Next solo incrusta NEXT_PUBLIC_*, y pruebas/mantenimientoServidor.test.ts falla si un componente de cliente lo importa).
// Con `MANTENIMIENTO_CLAVE` (variable de servidor de Vercel, ámbito Production, NUNCA NEXT_PUBLIC_*) definida, cada petición a PostgREST/Storage lleva
// el secreto y el usuario VERIFICADO de la sesión; la base solo deja escribir si el secreto coincide con su hash Y ese usuario es un operador
// autorizado de la ventana. Sin la variable no se toca nada: el `fetch` por defecto se usa tal cual (0 solicitudes extra).
export const CABECERA_CLAVE = "x-dspacios-mantenimiento";
export const CABECERA_OPERADOR = "x-dspacios-operador";

type Fetch = typeof fetch;

/** `fetch` para un cliente de servidor, o `undefined` (usar el de siempre) si no hay ventana configurada en este despliegue. */
export function fetchMantenimiento(usuarioVerificado: () => Promise<string | null>, clave = process.env.MANTENIMIENTO_CLAVE, base: Fetch = fetch): Fetch | undefined {
  if (!clave) return undefined;
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/auth/v1/")) return base(input, init);   // Auth no lleva el secreto (y así verificar al usuario no se llama a sí mismo)
    const uid = await usuarioVerificado();
    if (!uid) return base(input, init);                         // sin usuario verificado: sin excepción (la base bloquea)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(CABECERA_CLAVE, clave);
    headers.set(CABECERA_OPERADOR, uid);
    return base(input, { ...init, headers });
  };
}

/** Recuerda el resultado por petición (clave = el almacén de cookies de la petición): una sola verificación aunque se creen varios clientes. */
export function memoPorPeticion(verificar: (almacen: object) => Promise<string | null>) {
  const memo = new WeakMap<object, Promise<string | null>>();
  return (almacen: object) => {
    let p = memo.get(almacen);
    if (!p) { p = verificar(almacen).catch(() => null); memo.set(almacen, p); }
    return p;
  };
}

const usuarioDeAlmacen = memoPorPeticion(async (almacen) => {
  const store = almacen as AlmacenCookies;
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll() { /* solo lectura: verificar no renueva sesión */ } },
  });
  const { data } = await sb.auth.getUser();   // verifica el token contra Auth (no se confía en la cookie decodificada)
  return data.user?.id ?? null;
});

/** Usuario VERIFICADO de la petición en curso, o null fuera de una petición (cron sin sesión, scripts). */
export async function usuarioDeSesion(): Promise<string | null> {
  let store: object;
  try { const { cookies } = await import("next/headers"); store = await cookies(); } catch { return null; }
  return usuarioDeAlmacen(store);
}
