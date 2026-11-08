import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { cabecerasIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";

/**
 * Cliente de servidor con la sesión del usuario. Fábrica POR LLAMADA (no se comparte entre peticiones).
 * `identidad` (#75): contratos que la pantalla abrió ({numero: uid}); viaja en la cabecera `x-contratos` y la base (migración 284)
 * rechaza la escritura si no es el contrato vigente. Sin identidad = comportamiento de siempre.
 */
export async function createClient(identidad?: IdentidadContrato) {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // En RSC sin capacidad de mutar cookies — el middleware se encarga
          }
        },
      },
      global: { headers: cabecerasIdentidad(identidad) },
    }
  );
}
