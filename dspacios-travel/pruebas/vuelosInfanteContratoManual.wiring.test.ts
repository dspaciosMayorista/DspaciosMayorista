// Cableado de la corrección: ambas superficies de vuelos (detalle del
// bloqueo y listado general de pasajeros) deben incluir los contratos
// resueltos desde `contrato_manual` al buscar infantes — no solo
// `sillas.numero_contrato` — y deben seguir sin escribir nada en `sillas`
// (contrato_manual no se modifica ni se convierte ningún dato existente).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

describe("vuelos/[id]/page.tsx — infantes de contratos asociados por contrato_manual", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");

  test("importa el resolver compartido (no reimplementa la lógica de ambigüedad inline)", () => {
    assert.match(
      src,
      /import \{ resolverReferenciasManualesDesdeDB \} from "@\/lib\/vuelos\/contratoManual";/,
      "no importa resolverReferenciasManualesDesdeDB desde el módulo compartido"
    );
  });

  test("resuelve las referencias manuales de TODAS las sillas del bloqueo (no solo unas pocas)", () => {
    assert.match(
      src,
      /resolverReferenciasManualesDesdeDB\(\s*sb,\s*\[\.\.\.contratoManualPorSilla\.values\(\)\]\s*\)/,
      "no pasa todos los valores de contratoManualPorSilla al resolver"
    );
  });

  test("contratosDelBloqueo (usado para buscar infantes) incluye tanto numero_contrato como los resueltos de contrato_manual", () => {
    const inicio = src.indexOf("const contratosDelBloqueo");
    const bloque = src.slice(inicio, inicio + 400);
    assert.match(bloque, /s\.numero_contrato/, "sigue construyéndose desde numero_contrato (no debe perder el camino orgánico)");
    assert.match(bloque, /referenciaManualPorContrato\.values\(\)/, "no incluye los numero_contrato resueltos desde contrato_manual — el bug no queda corregido");
  });

  test("NO escribe/actualiza sillas.contrato_manual en ningún punto de este archivo (solo lectura)", () => {
    assert.doesNotMatch(
      src,
      /\.update\(\s*\{[^}]*contrato_manual/,
      "este archivo no debe escribir contrato_manual — la tarea es solo de lectura/visualización"
    );
  });

  test("REQUERIDO: cada infante aparece a lo sumo una vez (contratosDelBloqueo deduplicado con Set) y sin ocupar silla (tabla propia, sin sillaId)", () => {
    const inicio = src.indexOf("const contratosDelBloqueo");
    const bloque = src.slice(inicio, inicio + 200);
    assert.match(bloque, /new Set\(/, "contratosDelBloqueo debe deduplicarse — sin eso, un contrato con varias sillas pediría el mismo numero_contrato repetido (aunque .in() lo tolera, la intención de deduplicar debe quedar explícita)");
    assert.doesNotMatch(
      declaracionTipoInfantesBloqueo(src),
      /sillaId/,
      "el tipo de infantesBloqueo no debe tener sillaId — un infante nunca ocupa silla"
    );
  });
});

function declaracionTipoInfantesBloqueo(src: string): string {
  const inicio = src.indexOf("let infantesBloqueo:");
  const fin = src.indexOf("=", inicio);
  return src.slice(inicio, fin);
}

describe("vuelos/pasajeros/page.tsx — infantes de contratos asociados por contrato_manual", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx");

  test("importa el resolver compartido y el normalizador — MISMO módulo que vuelos/[id]/page.tsx, no una reimplementación paralela", () => {
    assert.match(
      src,
      /import \{ normalizarReferenciaManual, resolverReferenciasManualesDesdeDB \} from "@\/lib\/vuelos\/contratoManual";/,
      "no importa desde el módulo compartido lib/vuelos/contratoManual"
    );
  });

  test("consulta contrato_manual de las sillas (antes esta página no lo leía en absoluto)", () => {
    assert.match(
      src,
      /\.from\("sillas"\)\.select\("id, contrato_manual"\)/,
      "no consulta contrato_manual — sin este dato no hay nada que resolver"
    );
  });

  test("la búsqueda de infantes usa el contrato EFECTIVO (resuelto), no el numero_contrato crudo de la silla", () => {
    const inicio = src.indexOf("const contratosConSilla");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(
      bloque,
      /contratoEfectivoPorSilla\.get\(f\.sillaId\)/,
      "contratosConSilla sigue derivándose de f.contrato (el numero_contrato crudo) en vez del contrato efectivo — el infante de un contrato_manual resuelto seguiría sin aparecer"
    );
  });

  test("el emparejamiento infante↔silla-base también usa el contrato efectivo (si no, el infante nunca hereda vuelo/hotel/asesor cuando el adulto está en una silla manual)", () => {
    const inicio = src.indexOf("for (const inf of infantes");
    const bloque = src.slice(inicio, inicio + 400);
    assert.match(
      bloque,
      /contratoEfectivoPorSilla\.get\(f\.sillaId\)\s*===\s*inf\.numero_contrato/,
      "el 'find' de la silla base sigue comparando f.contrato === inf.numero_contrato — con una silla manual resuelta, f.contrato queda vacío y el infante NUNCA encuentra su base"
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

  test("REQUERIDO: el infante nunca ocupa silla (sillaId: null) y aparece a lo sumo una vez por infante (un push por fila de contrato_pasajeros, no por silla)", () => {
    const inicio = src.indexOf("filasInfantes.push");
    const bloque = src.slice(inicio, inicio + 700);
    assert.match(bloque, /sillaId:\s*null/, "el infante debe seguir sin ocupar silla");
    // La única fuente de la iteración que produce cada `filasInfantes.push`
    // es `for (const inf of infantes ?? [])` — una fila de
    // `contrato_pasajeros` por infante real, nunca una por silla del
    // contrato (que sí podría repetirse si varios adultos comparten
    // contrato). El `.find()` de la línea anterior toma la PRIMERA silla que
    // coincida y nunca vuelve a iterar sobre las demás para el MISMO
    // infante, así que un contrato con 3 sillas de adultos + 1 infante real
    // solo genera 1 fila de infante, no 3.
    const inicioLoop = src.indexOf("for (const inf of infantes");
    assert.ok(inicioLoop > -1 && inicioLoop < inicio, "el push de infantes debe estar dentro del for (const inf of infantes ?? [])");
  });
});

describe("Sin cambios de comportamiento fuera de alcance", () => {
  test("ninguna de las dos páginas antepone 'MIN-' a ciegas por su cuenta (toda la resolución vive en lib/vuelos/contratoManual.ts)", () => {
    for (const ruta of [
      "app/(dashboard)/dashboard/vuelos/[id]/page.tsx",
      "app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx",
    ]) {
      const src = leer(ruta);
      assert.doesNotMatch(
        src,
        /["'`]MIN-["'`]\s*\+/,
        `${ruta} concatena el prefijo MIN- directamente — la resolución (con su chequeo de ambigüedad) debe vivir SOLO en el módulo compartido`
      );
    }
  });

});
