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

// Suites React que EJECUTA la entrada canónica (`npm test` → test:react:all): test:calendar, test:react y toda `test:react:*` (el límite de ~8 191 caracteres de la
// línea de comandos en Windows obliga a repartir los archivos en varios scripts; repartir NO puede sacar una prueba de la ejecución canónica).
const suitesReact = Object.keys(scripts).filter((k) => k === "test:calendar" || k === "test:react" || (k.startsWith("test:react:") && k !== "test:react:all"));

// Pruebas React que corren en un WORKFLOW de CI propio de su entrega (con el reactLoader), no en package.json: se leen de los .yml y se cuentan como ejecutadas SOLO si el comando del workflow las lista junto al reactLoader.
const workflowsDir = join(raiz, "..", ".github", "workflows");
const enWorkflows = new Set<string>();
if (existsSync(workflowsDir)) {
  for (const w of readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"))) {
    const texto = readFileSync(join(workflowsDir, w), "utf8").replace(/\r\n/g, "\n");
    for (const m of texto.matchAll(/reactLoader\.mjs[\s\S]*?(?=\n\s*\n|\n\s{0,12}-\s|$)/g)) for (const f of m[0].matchAll(/pruebas\/[\w.]+\.react\.ts/g)) enWorkflows.add(f[0]);
  }
}

test("cada archivo listado en cualquier suite React / test:calendar existe (un renombre no puede dejar una prueba fuera en silencio)", () => {
  for (const s of suitesReact) for (const f of listados(s)) {
    assert.ok(existsSync(join(raiz, f)), `${f} está listado en ${s} pero no existe`);
  }
});

test("cada pruebas/*.react.ts se ejecuta: está en test:react, test:calendar, test:react:* o en el workflow de CI de su entrega (que la lista con el reactLoader)", () => {
  const enSuites = new Set([...suitesReact.flatMap((s) => listados(s)), ...enWorkflows]);
  const react = readdirSync(join(raiz, "pruebas")).filter((f) => f.endsWith(".react.ts")).map((f) => `pruebas/${f}`);
  assert.ok(react.length > 0);
  // test:react:rev2 lista por patrón (`pruebas/**/*.rev2.react.ts`): un archivo con ese sufijo cuenta como ejecutado solo mientras el patrón siga en el script.
  const porPatronRev2 = (f: string) => f.endsWith(".rev2.react.ts") && (scripts["test:react:rev2"] ?? "").includes("pruebas/**/*.rev2.react.ts");
  assert.deepEqual(react.filter((f) => !enSuites.has(f) && !porPatronRev2(f)), []);
});

test("la entrada canónica `test` corre la suite unitaria y test:react:all, y test:react:all corre CADA suite React (nada queda fuera de la ejecución)", () => {
  assert.match(scripts["test"], /npm run test:unit/);
  assert.match(scripts["test"], /npm run test:react:all/);
  for (const s of suitesReact) assert.ok(scripts["test:react:all"].includes(`npm run ${s}`), `test:react:all no ejecuta ${s}`);
  assert.deepEqual([...scripts["test:react:all"].matchAll(/npm run ([\w:]+)/g)].map((m) => m[1]).filter((s) => !suitesReact.includes(s)), [], "test:react:all llama un script que no es una suite React");
});

test("todas las suites React usan el loader de React (sin él una prueba .tsx no corre)", () => {
  for (const s of suitesReact) assert.match(scripts[s], /--experimental-loader \.\/pruebas\/support\/reactLoader\.mjs --test /, `${s} sin reactLoader`);
});

test("las dos pruebas de interacción renombradas siguen corriendo en test:react", () => {
  for (const f of ["pruebas/resultadoInteraccion.react.ts", "pruebas/buscadorBookingDestinoInteraccion.react.ts"]) {
    assert.ok(listados("test:react").includes(f), `${f} no está en test:react`);
  }
});

test("lo que se cuenta como ejecutado por un workflow existe (un renombre no puede dejar una prueba fuera en silencio)", () => {
  for (const f of enWorkflows) assert.ok(existsSync(join(raiz, f)), `${f} está en un workflow y no existe`);
});
