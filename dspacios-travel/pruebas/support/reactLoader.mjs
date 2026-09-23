// Loader ESM SOLO para la prueba de interacción React
// (pruebas/resultadoInteraccion.test.ts) — NO se usa en el resto de la
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
// `BuscadorBooking.tsx` importa dos Server Actions reales ("use server") que
// nunca ejecuta `Resultado` (son del formulario de búsqueda) pero que sí se
// EVALÚAN al cargar el módulo — y ambas terminan importando `next/headers`
// (contexto de request de Next, no resoluble fuera de un servidor real). Se
// redirigen a stubs que lanzan si alguna vez se llegaran a invocar de
// verdad, para no silenciar en falso un uso real inesperado.
const STUB_RESERVAR_ACTIONS = pathToFileURL(join(AQUI, "stubs", "reservarActionsStub.mjs")).href;
const STUB_BUSQUEDA_UNIDAD_ACTIONS = pathToFileURL(join(AQUI, "stubs", "busquedaUnidadActionsStub.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/image") {
    return { url: STUB_NEXT_IMAGE, shortCircuit: true };
  }
  if (specifier === "@/app/(dashboard)/dashboard/reservar/actions") {
    return { url: STUB_RESERVAR_ACTIONS, shortCircuit: true };
  }
  if (specifier === "./busquedaUnidadActions" && context.parentURL?.endsWith("BuscadorBooking.tsx")) {
    return { url: STUB_BUSQUEDA_UNIDAD_ACTIONS, shortCircuit: true };
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
