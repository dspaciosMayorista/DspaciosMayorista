// Registra programasRutaLoader.mjs DESPUÉS de reactLoader.mjs (lo que se registra al final se
// ejecuta primero), sin tocar la forma `--experimental-loader ./pruebas/support/reactLoader.mjs --test`
// que vigila pruebas/suitesPruebas.test.ts. Uso: `node --import ./pruebas/support/registrarProgramasRuta.mjs ...`.
import { register } from "node:module";
register("./programasRutaLoader.mjs", import.meta.url);
