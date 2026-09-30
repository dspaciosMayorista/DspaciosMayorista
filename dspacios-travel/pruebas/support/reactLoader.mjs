// Loader ESM SOLO para la prueba de interacción React
// (pruebas/resultadoInteraccion.react.ts) — NO se usa en el resto de la
// batería (`aliasLoader.mjs` sigue siendo el loader de siempre para las
// pruebas puras/de wiring, sin tocarlo).
//
// Por qué existe: `--experimental-strip-types` (el flag nativo de Node que
// usa el resto del repo) solo ERRADICA tipos de archivos `.ts` — nunca
// transforma JSX, así que no puede cargar un componente React real como
// `app/tarifario/BuscadorBooking.tsx` (`.tsx`, con JSX de verdad). Este
// loader resuelve el alias "@/*" (igual que aliasLoader.mjs) Y transforma
// CUALQUIER `.ts`/`.tsx` con esbuild (nueva dependencia de desarrollo, ver
// package.json) antes de dárselo a Node — así la prueba monta el componente
// de PRODUCCIÓN tal cual está escrito, sin una copia/reimplementación aparte
// para test.
//
// Uso: node --experimental-test-module-mocks
//      --experimental-loader ./pruebas/support/reactLoader.mjs --test ...
// (sin --experimental-strip-types: esbuild ya cubre ese trabajo para todo lo
// que pasa por este loader).
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { transform } from "esbuild";

const AQUI = dirname(fileURLToPath(import.meta.url)); // .../pruebas/support
const RAIZ = join(AQUI, "..", ".."); // raíz de dspacios-travel/

const EXTENSIONES = [".tsx", ".ts", ".mts", ""];

// "next/image" no se puede resolver fuera del bundler de Next (su
// package.json usa condiciones de "exports" que solo Webpack/Turbopack
// entienden) — se redirige a un stub trivial. Nunca se instancia de verdad
// en la prueba (los fixtures usan `foto: null`), solo debe poder importarse.
const STUB_NEXT_IMAGE = pathToFileURL(join(AQUI, "stubs", "nextImageStub.mjs")).href;
// "next/link" — mismo problema, mismo criterio (ver el comentario del stub).
const STUB_NEXT_LINK = pathToFileURL(join(AQUI, "stubs", "nextLinkStub.mjs")).href;
// `BuscadorBooking.tsx` importa dos Server Actions reales ("use server") que
// nunca ejecuta `Resultado` (son del formulario de búsqueda) pero que sí se
// EVALÚAN al cargar el módulo — y ambas terminan importando `next/headers`
// (contexto de request de Next, no resoluble fuera de un servidor real). Se
// redirigen a stubs que lanzan si alguna vez se llegaran a invocar de
// verdad, para no silenciar en falso un uso real inesperado.
const STUB_RESERVAR_ACTIONS = pathToFileURL(join(AQUI, "stubs", "reservarActionsStub.mjs")).href;
const STUB_BUSQUEDA_UNIDAD_ACTIONS = pathToFileURL(join(AQUI, "stubs", "busquedaUnidadActionsStub.mjs")).href;
// `PasajerosContratoClient.tsx` (migración 188, CRM) importa su Server
// Action real "./actions" (relativa, dentro de su propia carpeta) — "use
// server" que termina en "next/headers". Se redirige solo cuando el import
// parte de ESE archivo (mismo patrón que busquedaUnidadActions arriba).
const STUB_PASAJEROS_CONTRATO_ACTIONS = pathToFileURL(join(AQUI, "stubs", "pasajerosContratoActionsStub.mjs")).href;
// `EliminarDestinoBtn.tsx` (tarifario) importa su Server Action real "./actions"
// (termina en "next/headers") — se redirige solo cuando el import parte de ESE
// archivo (mismo patrón que pasajerosContratoActions arriba).
const STUB_ELIMINAR_DESTINO_ACTIONS = pathToFileURL(join(AQUI, "stubs", "eliminarDestinoActionsStub.mjs")).href;
// Server Actions de pagos / proveedores / difusión, importadas por su alias
// "@/..." — mismas razones que las anteriores (terminan en "next/headers").
const STUB_PAGOS_ACTIONS = pathToFileURL(join(AQUI, "stubs", "pagosActionsStub.mjs")).href;
const STUB_PROVEEDORES_ACTIONS = pathToFileURL(join(AQUI, "stubs", "proveedoresActionsStub.mjs")).href;
const STUB_DIFUSION_ACTIONS = pathToFileURL(join(AQUI, "stubs", "difusionActionsStub.mjs")).href;
// `DateInput.tsx` arrastra "react-day-picker" (no instalado en el entorno de
// pruebas) — se reemplaza por un <input> controlado en los componentes que lo
// montan pero no lo prueban (DifusionClient, PagosList). Sin esto, esos
// archivos ni siquiera cargan.
const STUB_DATE_INPUT = pathToFileURL(join(AQUI, "stubs", "dateInputStub.mjs")).href;
// `DifusionClient.tsx` usa useRouter de "next/navigation"; fuera del servidor
// de Next no hay contexto. Se sustituye por un router falso.
const STUB_NEXT_NAVIGATION = pathToFileURL(join(AQUI, "stubs", "nextNavigationStub.mjs")).href;
// `BuscarPasajeroDocumento.tsx` (migración 187) importa la Server Action
// real "@/lib/reservar/buscarPasajero" — mismo problema que las de arriba
// (termina en "next/headers"). Mismo criterio de stub configurable.
const STUB_BUSCAR_PASAJERO = pathToFileURL(join(AQUI, "stubs", "buscarPasajeroStub.mjs")).href;
// Dependencias externas de la Server Action REAL `dashboard/pagos/actions.ts`
// (pruebas/asignarProveedorAction.react.ts): el supabase server (next/headers),
// "next/cache" y `@/lib/contabilidad/asientos` (server-only + cliente admin).
// Se redirigen SOLO cuando el import parte de ESE archivo; la action se ejecuta
// de verdad contra un cliente simulado configurado en la prueba.
// Producto → Destinos: la Server Action real de la lista de receptivos
// (`./actions` desde DestinosLista.tsx) -> stub configurable.
const STUB_DESTINOS_ACTIONS = pathToFileURL(join(AQUI, "stubs", "destinosActionsStub.mjs")).href;
// Vuelos → detalle del bloqueo: `EditarBloqueoForm.tsx` importa la Server
// Action real "../actions" (termina en "next/headers") -> stub configurable.
const STUB_VUELOS_ACTIONS = pathToFileURL(join(AQUI, "stubs", "vuelosActionsStub.mjs")).href;
const STUB_SUPABASE_SERVER = pathToFileURL(join(AQUI, "stubs", "supabaseServerStub.mjs")).href;
const STUB_NEXT_CACHE = pathToFileURL(join(AQUI, "stubs", "nextCacheStub.mjs")).href;
const STUB_ASIENTOS = pathToFileURL(join(AQUI, "stubs", "asientosStub.mjs")).href;
const STUB_ASEGURAR_CXP = pathToFileURL(join(AQUI, "stubs", "asegurarCxpStub.mjs")).href;
// Módulos CSS ("*.module.css", o cualquier ".css") — ver cssModuleStub.mjs.
// Se revisa ANTES que la resolución genérica de "@/*" de abajo: esa
// resolución probaría el candidato "tal cual" (extensión "") y encontraría
// el archivo .css REAL en disco, delegando a `nextLoad` un archivo que no es
// JS válido.
const STUB_CSS = pathToFileURL(join(AQUI, "stubs", "cssModuleStub.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: STUB_CSS, shortCircuit: true };
  }
  if (specifier === "next/image") {
    return { url: STUB_NEXT_IMAGE, shortCircuit: true };
  }
  if (specifier === "next/link") {
    return { url: STUB_NEXT_LINK, shortCircuit: true };
  }
  if (specifier === "@/app/(dashboard)/dashboard/reservar/actions") {
    return { url: STUB_RESERVAR_ACTIONS, shortCircuit: true };
  }
  if (specifier === "@/lib/reservar/buscarPasajero") {
    return { url: STUB_BUSCAR_PASAJERO, shortCircuit: true };
  }
  if (specifier === "./busquedaUnidadActions" && context.parentURL?.endsWith("BuscadorBooking.tsx")) {
    return { url: STUB_BUSQUEDA_UNIDAD_ACTIONS, shortCircuit: true };
  }
  if (specifier === "./actions" && context.parentURL?.endsWith("PasajerosContratoClient.tsx")) {
    return { url: STUB_PASAJEROS_CONTRATO_ACTIONS, shortCircuit: true };
  }
  // Página Producto → Destinos (pruebas/destinosPageReceptivos.react.ts): los
  // dos botones de la cabecera importan Server Actions reales del tarifario
  // ("use server" -> next/headers); se sirven desde el mismo stub de destinos.
  if (
    (specifier === "./actions" && context.parentURL?.endsWith("NuevoDestinoDialog.tsx")) ||
    (specifier === "../../tarifario/actions" && context.parentURL?.endsWith("CargarDestinosSugeridos.tsx"))
  ) {
    return { url: STUB_ELIMINAR_DESTINO_ACTIONS, shortCircuit: true };
  }
  if (specifier === "./actions" && context.parentURL?.endsWith("/producto/destinos/DestinosLista.tsx")) {
    return { url: STUB_DESTINOS_ACTIONS, shortCircuit: true };
  }
  if (specifier === "./actions" && context.parentURL?.endsWith("EliminarDestinoBtn.tsx")) {
    return { url: STUB_ELIMINAR_DESTINO_ACTIONS, shortCircuit: true };
  }
  if (specifier === "./actions" && context.parentURL?.endsWith("ProveedoresClient.tsx")) {
    return { url: STUB_PROVEEDORES_ACTIONS, shortCircuit: true };
  }
  if (specifier === "./actions" && context.parentURL?.endsWith("DifusionClient.tsx")) {
    return { url: STUB_DIFUSION_ACTIONS, shortCircuit: true };
  }
  if (specifier === "./actions" && context.parentURL?.endsWith("PagosList.tsx")) {
    return { url: STUB_PAGOS_ACTIONS, shortCircuit: true };
  }
  if (specifier === "../actions" && context.parentURL?.endsWith("/EditarBloqueoForm.tsx")) {
    return { url: STUB_VUELOS_ACTIONS, shortCircuit: true };
  }
  if (
    specifier === "@/components/ui/DateInput" &&
    (context.parentURL?.endsWith("DifusionClient.tsx") ||
      context.parentURL?.endsWith("PagosList.tsx") ||
      context.parentURL?.endsWith("EditarBloqueoForm.tsx"))
  ) {
    return { url: STUB_DATE_INPUT, shortCircuit: true };
  }
  if (
    specifier === "next/navigation" &&
    (context.parentURL?.endsWith("DifusionClient.tsx") || context.parentURL?.endsWith("EditarBloqueoForm.tsx"))
  ) {
    return { url: STUB_NEXT_NAVIGATION, shortCircuit: true };
  }
  if (specifier === "@/lib/supabase/server" &&
      (context.parentURL?.endsWith("dashboard/pagos/actions.ts") ||
       context.parentURL?.endsWith("dashboard/producto/proveedores/actions.ts") ||
       context.parentURL?.endsWith("/voucher-actions.ts") ||
       context.parentURL?.endsWith("/gestion-actions.ts") ||
       // Página Producto → Destinos y el predicado real de roles que usa.
       context.parentURL?.endsWith("/producto/destinos/page.tsx") ||
       // La Server Action de la lista de receptivos (pruebas/destinosReceptivosAction.react.ts).
       context.parentURL?.endsWith("/producto/destinos/actions.ts") ||
       // eliminarDestino/usoDestino reales (pruebas/eliminarDestinoAction.react.ts).
       context.parentURL?.endsWith("/dashboard/tarifario/actions.ts") ||
       context.parentURL?.endsWith("/lib/roles.ts"))) {
    return { url: STUB_SUPABASE_SERVER, shortCircuit: true };
  }
  if (specifier === "next/cache" &&
      (context.parentURL?.endsWith("dashboard/pagos/actions.ts") ||
       context.parentURL?.endsWith("dashboard/producto/proveedores/actions.ts") ||
       context.parentURL?.endsWith("/voucher-actions.ts") ||
       context.parentURL?.endsWith("/gestion-actions.ts") ||
       context.parentURL?.endsWith("/dashboard/tarifario/actions.ts"))) {
    return { url: STUB_NEXT_CACHE, shortCircuit: true };
  }
  if (specifier === "@/lib/contabilidad/asientos" &&
      (context.parentURL?.endsWith("dashboard/pagos/actions.ts") || context.parentURL?.endsWith("/gestion-actions.ts"))) {
    return { url: STUB_ASIENTOS, shortCircuit: true };
  }
  // completarProveedores: la función real escribe con service-role; el stub
  // registra si se invocó (las pruebas negativas exigen que NO).
  if (specifier === "@/lib/reservar/asegurarCuentasPorPagar" && context.parentURL?.endsWith("/gestion-actions.ts")) {
    return { url: STUB_ASEGURAR_CXP, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const base = join(RAIZ, rel);
    for (const ext of EXTENSIONES) {
      const candidato = base + ext;
      if (existsSync(candidato)) return { url: pathToFileURL(candidato).href, shortCircuit: true };
    }
  }
  // Imports RELATIVOS sin extensión ("./tarjetaHotelCompartida",
  // "./EtiquetaOferta", etc.) — TypeScript/Next los resuelven probando
  // extensiones; el resolver ESM nativo de Node no lo hace. Se prueba junto
  // al archivo que importa (`context.parentURL`) antes de rendirse a
  // `nextResolve` (que fallaría igual, pero con un error menos útil).
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const dirPadre = dirname(fileURLToPath(context.parentURL));
    const base = join(dirPadre, specifier);
    for (const ext of EXTENSIONES) {
      const candidato = base + ext;
      if (existsSync(candidato)) return { url: pathToFileURL(candidato).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && (url.endsWith(".tsx") || url.endsWith(".ts"))) {
    const ruta = fileURLToPath(url);
    const fuente = readFileSync(ruta, "utf8");
    const resultado = await transform(fuente, {
      loader: url.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: "node22",
      sourcefile: ruta,
      jsx: "automatic",
    });
    return { format: "module", source: resultado.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
