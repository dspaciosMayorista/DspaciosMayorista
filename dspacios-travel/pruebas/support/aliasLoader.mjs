// Loader ESM de SOLO PRUEBAS: resuelve el alias "@/*" (definido en
// tsconfig.json como "@/*": ["./*"], usado por TODO el código de producción
// bajo `lib/`, `app/`, `components/`) a una ruta de archivo real bajo la raíz
// del repo — Next.js/tsc lo resuelven en build, pero un `node --test` plano
// no tiene ningún loader de paths (ver la nota ya existente en
// lib/tarifario/vigencia.ts sobre por qué esos módulos usan imports
// relativos). Este loader existe para poder ejecutar con ejecución REAL los
// orquestadores que SÍ usan `@/` (lib/reservar/computo.ts, lib/reservar/
// cotizar.ts, lib/reservar/liquidacionHotel.ts, etc.) sin tocar ni un solo
// import de producción — nada de esto se carga fuera de `node --test`.
//
// Uso: node --experimental-strip-types --experimental-test-module-mocks
//      --experimental-loader ./pruebas/support/aliasLoader.mjs --test ...
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url)); // .../pruebas/support
const RAIZ = join(AQUI, "..", ".."); // raíz del repo (dos niveles arriba)

const EXTENSIONES = [".ts", ".tsx", ".mts", ""];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const base = join(RAIZ, rel);
    for (const ext of EXTENSIONES) {
      const candidato = base + ext;
      if (ext === "" ? existsSync(candidato) : existsSync(candidato)) {
        return { url: pathToFileURL(candidato).href, shortCircuit: true };
      }
    }
    // Ningún candidato existe — deja que el resolver por defecto falle con
    // su propio error (más informativo que inventar uno genérico acá).
  }
  return nextResolve(specifier, context);
}
