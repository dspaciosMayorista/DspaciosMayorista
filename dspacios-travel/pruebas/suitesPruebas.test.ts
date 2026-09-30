// Guarda de la configuración de suites (package.json):
//   - test:unit corre `pruebas/**/*.test.ts` con aliasLoader (sin JSX/TSX).
//   - test:react corre una lista EXPLÍCITA de pruebas de interacción con
//     reactLoader (esbuild + TSX). Convención: esas pruebas se llaman
//     `*.react.ts`, así el glob de test:unit nunca las recoge sin su loader
//     (ya pasó: dos pruebas de interacción llamadas `*.test.ts` fallaban
//     siempre en test:unit con ERR_UNKNOWN_FILE_EXTENSION ".tsx").
// Y ninguna prueba React puede quedar fuera de toda suite sin avisar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = (JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
const listados = (script: string): string[] => [...(scripts[script]?.match(/pruebas\/[\w.]+\.ts/g) ?? [])];

test("test:unit sigue siendo el glob pruebas/**/*.test.ts con aliasLoader", () => {
  assert.match(scripts["test:unit"], /--experimental-loader \.\/pruebas\/support\/aliasLoader\.mjs "pruebas\/\*\*\/\*\.test\.ts"/);
});

test("test:react corre con reactLoader y NO lista ningún *.test.ts (lo recogería también test:unit sin su loader)", () => {
  assert.match(scripts["test:react"], /--experimental-loader \.\/pruebas\/support\/reactLoader\.mjs --test /);
  assert.deepEqual(listados("test:react").filter((f) => f.endsWith(".test.ts")), []);
});

test("cada archivo listado en test:react / test:calendar existe (un renombre no puede dejar una prueba fuera en silencio)", () => {
  for (const f of [...listados("test:react"), ...listados("test:calendar")]) {
    assert.ok(existsSync(join(raiz, f)), `${f} está listado pero no existe`);
  }
});

test("cada pruebas/*.react.ts está en test:react o test:calendar", () => {
  const enSuites = new Set([...listados("test:react"), ...listados("test:calendar")]);
  const react = readdirSync(join(raiz, "pruebas")).filter((f) => f.endsWith(".react.ts")).map((f) => `pruebas/${f}`);
  assert.ok(react.length > 0);
  assert.deepEqual(react.filter((f) => !enSuites.has(f)), []);
});

test("las dos pruebas de interacción renombradas siguen corriendo en test:react", () => {
  for (const f of ["pruebas/resultadoInteraccion.react.ts", "pruebas/buscadorBookingDestinoInteraccion.react.ts"]) {
    assert.ok(listados("test:react").includes(f), `${f} no está en test:react`);
  }
});
