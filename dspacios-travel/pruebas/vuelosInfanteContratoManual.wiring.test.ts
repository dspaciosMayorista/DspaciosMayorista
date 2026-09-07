// Cableado de la corrección: ambas superficies de vuelos (detalle del
// bloqueo y listado general de pasajeros) deben resolver infantes de
// contratos asociados por `contrato_manual` (no solo `sillas.numero_contrato`)
// usando el punto de entrada AUTORIZADO `resolverManifiestoAutorizado` (que
// autoriza con el cliente de sesión y solo entonces usa un cliente admin
// para las lecturas cross-tenant) — nunca el helper vulnerable
// `resolverReferenciasManualesDesdeDB` (eliminado tras la revisión del PR
// #289), ni una reimplementación inline, ni una consulta directa a
// `contrato_pasajeros`/`ventas` con el cliente de sesión. Ambas páginas deben
// seguir sin escribir nada en `sillas` (contrato_manual no se modifica).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_BLOQUEO = "app/(dashboard)/dashboard/vuelos/[id]/page.tsx";
const RUTA_PASAJEROS = "app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx";

describe("vuelos/[id]/page.tsx — infantes de contratos asociados por contrato_manual, resueltos de forma autorizada", () => {
  const src = leer(RUTA_BLOQUEO);

  test("importa resolverManifiestoAutorizado (no la variante vulnerable ni una reimplementación inline)", () => {
    assert.match(
      src,
      /import \{ resolverManifiestoAutorizado \} from "@\/lib\/vuelos\/contratoManual";/,
      "no importa resolverManifiestoAutorizado desde el módulo compartido"
    );
    assert.doesNotMatch(
      src,
      /resolverReferenciasManualesDesdeDB/,
      "no debe seguir usando el helper vulnerable eliminado (RLS del cliente de sesión)"
    );
  });

  test("pasa los contratos ORGÁNICOS de todas las sillas del bloqueo (no solo unas pocas) al resolver autorizado", () => {
    const inicio = src.indexOf("const contratosOrganicosDelBloqueo");
    assert.ok(inicio > -1, "no define contratosOrganicosDelBloqueo");
    const bloque = src.slice(inicio, inicio + 600);
    assert.match(bloque, /s\.numero_contrato/, "no deriva contratosOrganicosDelBloqueo de sillas.numero_contrato");
    assert.match(
      bloque,
      /resolverManifiestoAutorizado\(\s*sb,\s*contratosOrganicosDelBloqueo,\s*\[\.\.\.contratoManualPorSilla\.values\(\)\]\s*\)/,
      "no llama a resolverManifiestoAutorizado con (sb, contratosOrganicosDelBloqueo, [...contratoManualPorSilla.values()])"
    );
  });

  test("NO consulta contrato_pasajeros ni ventas directamente en este archivo — esa lectura vive en el módulo autorizado", () => {
    assert.doesNotMatch(
      src,
      /\.from\(\s*["']contrato_pasajeros["']\s*\)/,
      "este archivo no debe consultar contrato_pasajeros directamente (con el cliente de sesión) — debe delegar en resolverManifiestoAutorizado"
    );
    assert.doesNotMatch(
      src,
      /\.from\(\s*["']ventas["']\s*\)/,
      "este archivo no debe consultar ventas directamente"
    );
  });

  test("NO escribe/actualiza sillas.contrato_manual en ningún punto de este archivo (solo lectura)", () => {
    assert.doesNotMatch(
      src,
      /\.update\(\s*\{[^}]*contrato_manual/,
      "este archivo no debe escribir contrato_manual — la tarea es solo de lectura/visualización"
    );
  });

  test("REQUERIDO: contratosOrganicosDelBloqueo está deduplicado (Set) y el manifiesto (infantesBloqueo) no ocupa silla al renderizarse", () => {
    const inicio = src.indexOf("const contratosOrganicosDelBloqueo");
    const bloque = src.slice(inicio, inicio + 250);
    assert.match(bloque, /new Set\(/, "contratosOrganicosDelBloqueo debe deduplicarse");
    // El manifiesto se renderiza en una tabla propia, separada de la de
    // sillas, y nunca alimenta una operación de silla (cambiar/liberar).
    const inicioTabla = src.indexOf("infantesBloqueo.length > 0");
    assert.ok(inicioTabla > -1, "no renderiza el manifiesto de infantes en una sección propia");
    const bloqueTabla = src.slice(inicioTabla, inicioTabla + 900);
    assert.doesNotMatch(bloqueTabla, /sillaId/, "el renderizado de infantesBloqueo no debe referenciar sillaId — un infante nunca ocupa silla");
  });
});

describe("vuelos/pasajeros/page.tsx — infantes de contratos asociados por contrato_manual, resueltos de forma autorizada", () => {
  const src = leer(RUTA_PASAJEROS);

  test("importa resolverManifiestoAutorizado y normalizarReferenciaManual — MISMO módulo que vuelos/[id]/page.tsx, no una reimplementación paralela", () => {
    assert.match(
      src,
      /import \{ normalizarReferenciaManual, resolverManifiestoAutorizado \} from "@\/lib\/vuelos\/contratoManual";/,
      "no importa desde el módulo compartido lib/vuelos/contratoManual"
    );
    assert.doesNotMatch(
      src,
      /resolverReferenciasManualesDesdeDB/,
      "no debe seguir usando el helper vulnerable eliminado (RLS del cliente de sesión)"
    );
  });

  test("consulta contrato_manual de las sillas (antes esta página no lo leía en absoluto)", () => {
    assert.match(
      src,
      /\.from\("sillas"\)\.select\("id, contrato_manual"\)/,
      "no consulta contrato_manual — sin este dato no hay nada que resolver"
    );
  });

  test("pasa los contratos ORGÁNICOS de todas las sillas del listado (no solo las que tienen pasajero con nombre) al resolver autorizado", () => {
    const inicio = src.indexOf("const contratosOrganicos");
    assert.ok(inicio > -1, "no define contratosOrganicos");
    const bloque = src.slice(inicio, inicio + 600);
    assert.match(bloque, /s\.numero_contrato/, "no deriva contratosOrganicos de sillas.numero_contrato");
    assert.match(
      bloque,
      /resolverManifiestoAutorizado\(\s*sb,\s*contratosOrganicos,\s*\[\.\.\.contratoManualPorSilla\.values\(\)\]\s*\)/,
      "no llama a resolverManifiestoAutorizado con (sb, contratosOrganicos, [...contratoManualPorSilla.values()])"
    );
  });

  test("NO consulta contrato_pasajeros ni ventas directamente en este archivo — esa lectura vive en el módulo autorizado", () => {
    assert.doesNotMatch(
      src,
      /\.from\(\s*["']contrato_pasajeros["']\s*\)/,
      "este archivo no debe consultar contrato_pasajeros directamente (con el cliente de sesión) — debe delegar en resolverManifiestoAutorizado"
    );
    assert.doesNotMatch(
      src,
      /\.from\(\s*["']ventas["']\s*\)/,
      "este archivo no debe consultar ventas directamente"
    );
  });

  test("el emparejamiento infante↔silla-base usa el contrato efectivo (si no, el infante nunca hereda vuelo/hotel/asesor cuando el adulto está en una silla manual)", () => {
    const inicio = src.indexOf("for (const inf of infantes)");
    assert.ok(inicio > -1, "no itera 'for (const inf of infantes)' sobre el resultado de resolverManifiestoAutorizado");
    const bloque = src.slice(inicio, inicio + 400);
    assert.match(
      bloque,
      /contratoEfectivoPorSilla\.get\(f\.sillaId\)\s*===\s*inf\.numero_contrato/,
      "el 'find' de la silla base debe comparar contratoEfectivoPorSilla.get(f.sillaId) === inf.numero_contrato"
    );
  });

  test("el infante muestra su propio numero_contrato interno (no el de la silla, que para un contrato manual resuelto queda vacío)", () => {
    const inicio = src.indexOf("filasInfantes.push");
    const bloque = src.slice(inicio, inicio + 700);
    assert.match(bloque, /contrato:\s*inf\.numero_contrato/, "no sobreescribe 'contrato' con el numero_contrato propio del infante");
  });

  test("NO escribe/actualiza sillas.contrato_manual en ningún punto de este archivo (solo lectura)", () => {
    assert.doesNotMatch(
      src,
      /\.update\(\s*\{[^}]*contrato_manual/,
      "este archivo no debe escribir contrato_manual — la tarea es solo de lectura/visualización"
    );
  });

  test("REQUERIDO: el infante nunca ocupa silla (sillaId: null) y aparece a lo sumo una vez por infante (un push por elemento de `infantes`, no por silla)", () => {
    const inicio = src.indexOf("filasInfantes.push");
    const bloque = src.slice(inicio, inicio + 700);
    assert.match(bloque, /sillaId:\s*null/, "el infante debe seguir sin ocupar silla");
    // La única fuente de la iteración que produce cada `filasInfantes.push`
    // es `for (const inf of infantes)` — cada `inf` es una fila real de
    // `contrato_pasajeros` (ya deduplicada dentro de resolverManifiestoAutorizado
    // por numero_contrato), nunca una por silla del contrato (que sí podría
    // repetirse si varios adultos comparten contrato). El `.find()` toma la
    // PRIMERA silla que coincida y nunca vuelve a iterar sobre las demás para
    // el MISMO infante.
    const inicioLoop = src.indexOf("for (const inf of infantes)");
    assert.ok(inicioLoop > -1 && inicioLoop < inicio, "el push de infantes debe estar dentro del for (const inf of infantes)");
  });
});

describe("Sin cambios de comportamiento fuera de alcance", () => {
  test("ninguna de las dos páginas antepone 'MIN-' a ciegas por su cuenta (toda la resolución vive en lib/vuelos/contratoManual.ts)", () => {
    for (const ruta of [RUTA_BLOQUEO, RUTA_PASAJEROS]) {
      const src = leer(ruta);
      assert.doesNotMatch(
        src,
        /["'`]MIN-["'`]\s*\+/,
        `${ruta} concatena el prefijo MIN- directamente — la resolución (con su chequeo de ambigüedad) debe vivir SOLO en el módulo compartido`
      );
    }
  });

  test("ninguna de las dos páginas construye un cliente admin/service-role directamente — solo lib/vuelos/contratoManual.ts puede hacerlo", () => {
    for (const ruta of [RUTA_BLOQUEO, RUTA_PASAJEROS]) {
      const src = leer(ruta);
      assert.doesNotMatch(
        src,
        /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/,
        `${ruta} no debe referenciar el cliente admin/service-role directamente — debe delegar en resolverManifiestoAutorizado`
      );
    }
  });
});

describe("lib/vuelos/contratoManual.ts — el cliente admin es exclusivamente server-only", () => {
  const src = leer("lib/vuelos/contratoManual.ts");

  test("usa createAdminClient() (server-only, ver lib/supabase/admin.ts) y no expone la instancia fuera de resolverManifiestoAutorizado", () => {
    assert.match(src, /import \{ createAdminClient \} from "\.\.\/supabase\/admin\.ts";/, "no importa createAdminClient desde lib/supabase/admin.ts");
  });

  test("resolverManifiestoAutorizado autoriza con el cliente de SESIÓN antes de construir el cliente admin", () => {
    const inicio = src.indexOf("export async function resolverManifiestoAutorizado");
    const bloque = src.slice(inicio, inicio + 1200);
    const idxAuth = bloque.indexOf("usuarioAutorizadoParaVuelos");
    const idxAdmin = bloque.indexOf("crearClienteAdmin()");
    assert.ok(idxAuth > -1 && idxAdmin > -1 && idxAuth < idxAdmin, "debe autorizar (usuarioAutorizadoParaVuelos) ANTES de construir el cliente admin (crearClienteAdmin())");
  });

  test("usuarioAutorizadoParaVuelos reutiliza LECTURA_MODULO.vuelos (no duplica la lista de roles del módulo)", () => {
    assert.match(src, /LECTURA_MODULO\.vuelos/, "no reutiliza LECTURA_MODULO.vuelos — riesgo de que el candado quede desalineado con proxy.ts");
  });
});
