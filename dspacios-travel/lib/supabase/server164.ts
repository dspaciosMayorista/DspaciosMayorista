// Cliente de servidor tipado con la superficie 164 (condiciones de pago por
// componente). Espejo de `lib/supabase/server.ts` pero con `<Database164>` para
// poder leer/escribir las tablas y RPC de la migración 164 sin tocar el cliente
// base (`Database`). El resto de la app sigue usando el cliente base intacto.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database164 } from "@/types/database164";

export async function createClient164() {
  const cookieStore = await cookies();

  return createServerClient<Database164>(
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
    }
  );
}
