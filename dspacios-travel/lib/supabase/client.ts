import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { cabecerasIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";

/**
 * Cliente de navegador. `createBrowserClient` es un SINGLETON salvo `isSingleton:false`: con una identidad (#75) se crea SIEMPRE una instancia propia
 * para que la cabecera de una pantalla no se comparta con otra abierta en la misma pestaña.
 */
export function createClient(identidad?: IdentidadContrato) {
  const headers = cabecerasIdentidad(identidad);
  if (Object.keys(headers).length === 0) {
    return createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { isSingleton: false, global: { headers } }
  );
}
