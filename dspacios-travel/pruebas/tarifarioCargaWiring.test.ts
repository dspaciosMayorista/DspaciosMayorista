import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Wiring de TEXTO (mismo patrón que pruebas/medicionFlujoWiring.test.ts y
// pruebas/numeracionOrdenWiring.test.ts) sobre las tres rutas del incidente
// de ~13s: /dashboard/reservar, /dashboard/tarifario y /tarifario. No
// ejecuta el código (server-only, next/headers, Supabase con sesión real) —
// verifica que la estructura de concurrencia/secuencialidad pedida está
// realmente en el código, no solo en la intención.
function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

const RESERVAR = "app/(dashboard)/dashboard/reservar/page.tsx";
const TARIFARIO_INTERNO = "app/(dashboard)/dashboard/tarifario/page.tsx";
const TARIFARIO_PUBLICO = "app/tarifario/page.tsx";

describe("/dashboard/reservar — liberarVencidas queda SECUENCIAL (bloqueante) antes del par concurrente", () => {
  const src = leer(RESERVAR);

  test("liberarVencidas() se espera con su propio await, ANTES del Promise.all", () => {
    const idxLiberar = src.indexOf("await liberarVencidas()");
    const idxPromiseAll = src.indexOf("Promise.all([");
    assert.ok(idxLiberar > -1, "no se encontró la llamada a liberarVencidas()");
    assert.ok(idxPromiseAll > -1, "no se encontró el Promise.all");
    assert.ok(idxLiberar < idxPromiseAll, "liberarVencidas debe completarse ANTES de que arranque el Promise.all — evita leer cupos antes de liberar sillas vencidas");
  });

  test("liberarVencidas se mide como su propia etapa 'liberar_vencidas', separada de 'tarifario_y_programas'", () => {
    assert.match(src, /registrarEtapa\(FLUJO, flujoId, "liberar_vencidas"/);
    assert.match(src, /registrarEtapa\(FLUJO, flujoId, "tarifario_y_programas"/);
  });

  test("cargarDatosTarifario() y getProgramasResumen() arrancan CONCURRENTEMENTE dentro de un mismo Promise.all", () => {
    const idxAll = src.indexOf("Promise.all([");
    const bloque = src.slice(idxAll, src.indexOf("]);", idxAll));
    assert.match(bloque, /cargarDatosTarifario\(sb, FLUJO, flujoId\)/);
    assert.match(bloque, /getProgramasResumen\(sb, false\)/, "interno: activos aunque no publicados — el argumento false debe preservarse");
  });

  test("puedeReservar se pasa como prop fija (permite reservar) — sin cambios respecto al comportamiento previo", () => {
    assert.match(src, /<TarifarioPublic[\s\S]*?\bpuedeReservar\b/);
  });
});

describe("/dashboard/tarifario — NO usa cargarDatosTarifario() (evita el payload/consultas extra de Vista Booking)", () => {
  const src = leer(TARIFARIO_INTERNO);

  test("no importa ni invoca cargarDatosTarifario (solo se menciona en comentarios explicando la decisión)", () => {
    assert.doesNotMatch(src, /import\s*\{[^}]*cargarDatosTarifario/, "no debe importar cargarDatosTarifario");
    assert.doesNotMatch(src, /cargarDatosTarifario\(sb/, "no debe invocar cargarDatosTarifario(sb, ...)");
  });

  test("usa el cargador liviano compartido cargarFilasTarifarioPaginado con su propio set de columnas", () => {
    assert.match(src, /import\s*\{\s*cargarFilasTarifarioPaginado\s*\}\s*from\s*"@\/lib\/tarifario\/paginacion"/);
    assert.match(src, /cargarFilasTarifarioPaginado[^(]*\(sb, COLUMNAS_LIVIANAS\)/);
  });

  test("carga_paginada + filtro_vigencia y getProgramasResumen arrancan CONCURRENTEMENTE (mismo Promise.all)", () => {
    const idxAll = src.indexOf("Promise.all([");
    assert.ok(idxAll > -1, "no se encontró el Promise.all");
    const bloque = src.slice(idxAll, src.indexOf("getProgramasResumen(sb, false),", idxAll) + "getProgramasResumen(sb, false),".length);
    assert.match(bloque, /cargarFilasTarifarioPaginado/);
    assert.match(bloque, /filtrarTarifarioVencidas/);
    assert.match(bloque, /getProgramasResumen\(sb, false\)/, "interno: activos aunque no publicados");
  });

  test("no pasa la prop puedeReservar a TarifarioPublic — depende del default false del componente (no permite reservar)", () => {
    const idxJsx = src.indexOf("<TarifarioPublic");
    const bloqueJsx = src.slice(idxJsx, src.indexOf("/>", idxJsx));
    assert.doesNotMatch(bloqueJsx, /puedeReservar/);
  });

  test("reutiliza filtrarTarifarioVencidas de lib/tarifario/vigencia (compartido, no reimplementado)", () => {
    assert.match(src, /import\s*\{\s*filtrarTarifarioVencidas\s*\}\s*from\s*"@\/lib\/tarifario\/vigencia"/);
  });
});

describe("/tarifario (público) — sesión SECUENCIAL antes del Promise.all; autorización y puedeReservar sin cambios", () => {
  const src = leer(TARIFARIO_PUBLICO);

  test("mantiene export const revalidate = 120 (caché ISR pre-existente, sin cambios)", () => {
    assert.match(src, /export const revalidate = 120/);
  });

  test("documenta que revalidate=120 hoy NO tiene efecto — auth.getUser() sin condición fuerza render dinámico (verificado con `ƒ` en el build)", () => {
    assert.match(src, /fuerza el\s*\n\/\/ renderizado dinámico por-request/);
    const idxAuth = src.indexOf("sb.auth.getUser()");
    const idxIf = src.indexOf("if (");
    assert.ok(idxAuth > -1 && idxAuth < idxIf, "auth.getUser() debe seguir siendo incondicional — si se moviera detrás de un if, la nota dejaría de ser cierta");
  });

  test("auth.getUser() y la consulta de perfil ocurren ANTES del Promise.all de datos", () => {
    const idxAuth = src.indexOf("sb.auth.getUser()");
    const idxPromiseAll = src.indexOf("Promise.all([");
    assert.ok(idxAuth > -1 && idxPromiseAll > -1);
    assert.ok(idxAuth < idxPromiseAll, "la sesión debe resolverse antes de arrancar las cargas concurrentes");
  });

  test("los arrays de roles de esAgencia/puedeReservar quedan EXACTAMENTE iguales a como estaban", () => {
    assert.match(
      src,
      /\["agencia", "freelance", "superadmin", "operaciones", "gerencia", "administracion"\]\.includes\(perfil\.rol\)/
    );
    assert.match(
      src,
      /\["superadmin", "operaciones", "gerencia", "administracion", "venta", "agencia", "freelance"\]\.includes\(perfil\.rol\)/
    );
  });

  test("cargarDatosTarifario, getProgramasResumen(sb, true) y config_sitio arrancan CONCURRENTEMENTE en el mismo Promise.all", () => {
    const idxAll = src.indexOf("Promise.all([");
    const bloque = src.slice(idxAll, src.indexOf("]);", idxAll));
    assert.match(bloque, /cargarDatosTarifario\(sb, FLUJO, flujoId\)/);
    assert.match(bloque, /getProgramasResumen\(sb, true\)/, "público: SOLO publicados — el argumento true debe preservarse");
    assert.match(bloque, /config_sitio/);
  });

  test("puedeReservar/esAgencia se calculan solo a partir de la sesión, nunca dentro del Promise.all concurrente", () => {
    const idxPuedeReservar = src.indexOf("puedeReservar =");
    const idxAll = src.indexOf("Promise.all([");
    assert.ok(idxPuedeReservar > -1 && idxPuedeReservar < idxAll, "puedeReservar debe calcularse antes del Promise.all, a partir solo de la sesión");
  });

  test("pasa puedeReservar (variable calculada de la sesión) como prop a TarifarioPublic, tal como antes", () => {
    assert.match(src, /<TarifarioPublic[\s\S]*?puedeReservar=\{puedeReservar\}/);
  });
});

describe("Ninguna de las tres rutas paraleliza una ESCRITURA junto a una LECTURA independiente", () => {
  test("/dashboard/reservar: liberarVencidas (escribe sillas/ventas) nunca aparece dentro de un Promise.all", () => {
    const src = leer(RESERVAR);
    for (const m of src.matchAll(/Promise\.all\(\[([\s\S]*?)\]\)/g)) {
      assert.doesNotMatch(m[1], /liberarVencidas/, "liberarVencidas no debe estar dentro de ningún Promise.all");
    }
  });
});

describe("iniciarCronometro() — ninguna de las tres páginas llama performance.now()/Math.round() directo (regla react-hooks/purity del linter de React Compiler)", () => {
  for (const [nombre, ruta] of [
    ["/tarifario (público)", TARIFARIO_PUBLICO],
    ["/dashboard/tarifario", TARIFARIO_INTERNO],
    ["/dashboard/reservar", RESERVAR],
  ] as const) {
    test(`${nombre}: usa iniciarCronometro() en vez de performance.now()/Math.round() directo en el cuerpo del Server Component`, () => {
      const src = leer(ruta);
      assert.doesNotMatch(src, /performance\.now\(\)/, `${ruta} no debe llamar performance.now() directo (usar iniciarCronometro())`);
      assert.doesNotMatch(src, /Math\.round\(/, `${ruta} no debe llamar Math.round() directo (ya lo hace iniciarCronometro())`);
      assert.match(src, /iniciarCronometro/, `${ruta} debe importar/usar iniciarCronometro()`);
    });
  }
});

describe("loading.tsx — las dos rutas internas tienen su loading state (route segment nuevo, sin convención previa en el repo)", () => {
  test("app/(dashboard)/dashboard/reservar/loading.tsx existe y exporta un default", () => {
    const src = leer("app/(dashboard)/dashboard/reservar/loading.tsx");
    assert.match(src, /export default function/);
  });

  test("app/(dashboard)/dashboard/tarifario/loading.tsx existe y exporta un default", () => {
    const src = leer("app/(dashboard)/dashboard/tarifario/loading.tsx");
    assert.match(src, /export default function/);
  });
});
