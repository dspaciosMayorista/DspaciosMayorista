// Loader COMPLEMENTARIO de pruebas/programaRutaAlojamiento.react.ts (se registra
// DESPUÉS de reactLoader.mjs, por lo que corre primero). Solo redirige, para los
// archivos de programas bajo prueba, los módulos que no existen fuera de Next
// (next/cache, next/navigation, cliente servidor de Supabase, tenant.server).
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const stub = (n) => pathToFileURL(join(AQUI, "stubs", n)).href;

const PADRES = [
  "/dashboard/producto/programas/actions.ts",
  "/tarifario/programa/[id]/page.tsx",
  "/tarifario/programa/[id]/doc/page.tsx",
  // #23 destino fijo (migración 213)
  "/dashboard/producto/destinos/listas-actions.ts",
  "/dashboard/producto/destinos/listas-fijas/page.tsx",
  "/dashboard/producto/destinos/listas-fijas/ListaDestinoProgramas.tsx",
  "/dashboard/producto/programas/page.tsx",
];
const DESTINOS = {
  "@/lib/supabase/server": stub("supabaseServerStub.mjs"),
  "next/cache": stub("nextCacheStub.mjs"),
  "next/navigation": stub("programasRutaStub.mjs"),
  "@/lib/tenant.server": stub("programasRutaStub.mjs"),
};

export async function resolve(specifier, context, nextResolve) {
  const padre = decodeURIComponent(context.parentURL ?? "");
  // TarifarioPublic y sus hijas (pruebas/programaDestinoFijo.filtro.react.ts).
  if (specifier === "./detalle-actions" && (padre.endsWith("/tarifario/TarifarioPublic.tsx") || padre.endsWith("/tarifario/VistaBooking.tsx"))) {
    return { url: stub("detalleActionsStub.mjs"), shortCircuit: true };
  }
  if (specifier === "@/app/(dashboard)/dashboard/reservar/actions" &&
      ["/tarifario/VistaBooking.tsx", "/tarifario/serviciosHotel.tsx", "/tarifario/BuscadorReceptivos.tsx", "/tarifario/BuscadorBooking.tsx"].some((x) => padre.endsWith(x))) {
    return { url: stub("reservarActionsStub.mjs"), shortCircuit: true };
  }
  if (specifier === "../listas-actions" && padre.endsWith("/listas-fijas/ListaDestinoProgramas.tsx")) {
    return { url: stub("listasActionsStub.mjs"), shortCircuit: true };
  }
  if (DESTINOS[specifier] && PADRES.some((p) => padre.endsWith(p))) {
    return { url: DESTINOS[specifier], shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
