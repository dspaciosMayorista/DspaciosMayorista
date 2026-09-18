import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA EL SILENCIO
//
// `regenerarTarifariosDeHotel` (app/(dashboard)/dashboard/paquetes/actions.ts)
// consultaba `armado_hoteles` destructurando SOLO `data`, nunca `error`.
// Supabase-js NUNCA lanza por un error de consulta — lo devuelve como
// `{ data: null, error }` — así que un fallo técnico (RLS, red, columna
// renombrada) dejaba `pkgs` en `null` → `ids` vacío → la función retornaba
// en silencio, INDISTINGUIBLE de "este hotel no está en ningún paquete".
//
// Se intentó una prueba de EJECUCIÓN REAL (inyectando un cliente Supabase
// falso vía un parámetro `sbInyectado` agregado a la firma) pero `next/cache`
// no resuelve como módulo bajo `node --test` plano (falla igual con o sin
// `mock.module`, incluso en un `import()` aislado sin ningún mock —
// `Cannot find module '.../node_modules/next/cache'`, un problema de
// resolución de ESM/exports-map de esta versión de Next, no del mock): no es
// viable ejecutar este archivo `"use server"` de verdad en este entorno de
// pruebas. Por eso esta prueba mira el CÓDIGO FUENTE, mismo patrón que
// `documentosContrato.wiring.test.ts` — no demuestra el comportamiento en
// vivo, pero SÍ falla contra la implementación original (que no capturaba
// `error` ni lo logueaba), y detona si alguien vuelve a destructurar sin
// `error`.
//
// Corrección posterior: `sbInyectado` se retiró de la firma (decisión
// explícita del dueño — la función de producción no debe aceptar un cliente
// inyectado; el problema de `next/cache` tampoco lo hacía viable). Ahora
// `regenerarTarifariosDeHotel` vuelve a tener un solo parámetro y SIEMPRE
// construye su propio cliente con `createClient()`. Las pruebas de abajo
// incluyen una guarda para que esa firma no se vuelva a ampliar.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVO = "app/(dashboard)/dashboard/paquetes/actions.ts";
const src = readFileSync(join(raiz, ARCHIVO), "utf8");

function cuerpoDeFuncion(nombre: string): string {
  const inicio = src.indexOf(`export async function ${nombre}(`);
  assert.ok(inicio >= 0, `no se encontró "export async function ${nombre}("`);
  // Corta en la siguiente función exportada (o fin de archivo) — suficiente
  // para estas aserciones de texto, sin necesidad de un parser real.
  const siguiente = src.indexOf("\nexport async function ", inicio + 1);
  return siguiente >= 0 ? src.slice(inicio, siguiente) : src.slice(inicio);
}

test("regenerarTarifariosDeHotel captura explícitamente `error` de la consulta a armado_hoteles", () => {
  const cuerpo = cuerpoDeFuncion("regenerarTarifariosDeHotel");
  assert.match(
    cuerpo,
    /const\s*\{\s*data:\s*pkgs\s*,\s*error:\s*ePkgs\s*\}\s*=\s*await\s+sb\s*\n?\s*\.from\("armado_hoteles"\)/,
    "no destructura `error` (junto a `data`) de la consulta a armado_hoteles — el fix original destructuraba solo `data`, así que Supabase nunca lanza y un fallo técnico quedaba indistinguible de 'sin paquetes'"
  );
});

test("regenerarTarifariosDeHotel corta y loguea el error saneado con hotelId, sin lanzar (best-effort)", () => {
  const cuerpo = cuerpoDeFuncion("regenerarTarifariosDeHotel");
  assert.match(
    cuerpo,
    /if\s*\(\s*ePkgs\s*\)\s*\{\s*\n?\s*console\.error\(/,
    "no hay un `if (ePkgs) { console.error(...) }` — el error de la consulta queda silencioso"
  );
  const bloqueError = cuerpo.slice(cuerpo.indexOf("if (ePkgs)"), cuerpo.indexOf("if (ePkgs)") + 400);
  assert.match(
    bloqueError,
    /console\.error\(`[^`]*armado_hoteles[^`]*hotel_id=\$\{hotelId\}[^`]*\$\{ePkgs\.message\}[^`]*`\)/,
    "el console.error no incluye hotel_id y el mensaje saneado (ePkgs.message) del error"
  );
  assert.match(bloqueError, /return;/, "no retorna tras loguear el error — debe cortar antes de intentar regenerar con `pkgs` en null");
});

test("regenerarTarifariosDeHotel conserva Promise.allSettled (independencia entre paquetes intacta)", () => {
  const cuerpo = cuerpoDeFuncion("regenerarTarifariosDeHotel");
  assert.match(cuerpo, /Promise\.allSettled\(/, "el fix del error no debía tocar la independencia entre paquetes");
});

test("regenerarTarifariosDeHotel NO acepta un cliente Supabase inyectado — un solo parámetro, siempre createClient() propio", () => {
  const cuerpo = cuerpoDeFuncion("regenerarTarifariosDeHotel");
  assert.match(
    cuerpo,
    /export async function regenerarTarifariosDeHotel\(hotelId: number\): Promise<void>/,
    "la firma debe ser exactamente (hotelId: number) — no debe volver a ganar un segundo parámetro tipo `sbInyectado`"
  );
  assert.match(
    cuerpo,
    /const sb = await createClient\(\);/,
    "debe construir SIEMPRE su propio cliente con createClient() — nunca aceptar uno externo"
  );
  assert.doesNotMatch(cuerpo, /sbInyectado/, "no debe quedar rastro de un parámetro de cliente inyectado");
});

test("el archivo no importa SupabaseClient (tipo que solo hacía falta para el parámetro inyectado, ya retirado)", () => {
  assert.doesNotMatch(
    src,
    /import\s*(?:type\s*)?\{[^}]*SupabaseClient[^}]*\}\s*from\s*"@supabase\/supabase-js"/,
    "quedó un import de SupabaseClient sin uso tras retirar sbInyectado"
  );
});
