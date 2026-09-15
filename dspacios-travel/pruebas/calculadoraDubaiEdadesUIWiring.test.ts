import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Auditoría Dubai — hallazgo #3 (UX de rangos): el operador NO debe poder
// escribir `infanteMin`/`ninoMin` (valores derivados obligatorios). No es
// ejecutable bajo `node --test` (JSX/React, sin testing-library en este
// repo) — se verifica el código FUENTE real (`CalculadoraEditor.tsx`),
// mismo criterio que el resto de "wiring tests" de UI del proyecto (ver
// pruebas/ocupacionBernaloUIWiring.test.ts).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuente = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx"), "utf8");

describe("CalculadoraEditor.tsx — infanteMin/ninoMin son SIEMPRE derivados, nunca editables", () => {
  test("importa construirReglaEdadDesdeMaximos desde el módulo compartido (no reimplementa la derivación)", () => {
    assert.match(fuente, /import \{ REGLA_EDAD_DEFAULT, construirReglaEdadDesdeMaximos \} from "@\/lib\/calc\/reglaEdadTarifa"/);
  });

  test("setBaseEdad y setPromoEdad solo aceptan 'infanteMax' | 'ninoMax' como campo editable (nunca infanteMin/ninoMin)", () => {
    assert.match(fuente, /function setBaseEdad\(clave: string, campo: "infanteMax" \| "ninoMax", valor: string\)/);
    assert.match(fuente, /function setPromoEdad\(i: number, campo: "infanteMax" \| "ninoMax", valor: string\)/);
  });

  test("setBaseEdad y setPromoEdad SIEMPRE construyen la regla vía construirReglaEdadDesdeMaximos (nunca un spread parcial ...actual, [campo]: valor)", () => {
    const posSetBaseEdad = fuente.indexOf("function setBaseEdad(");
    const posSetPromoEdad = fuente.indexOf("function setPromoEdad(");
    assert.notEqual(posSetBaseEdad, -1);
    assert.notEqual(posSetPromoEdad, -1);
    const cuerpoBase = fuente.slice(posSetBaseEdad, posSetPromoEdad);
    const cuerpoPromo = fuente.slice(posSetPromoEdad, posSetPromoEdad + 700);
    for (const cuerpo of [cuerpoBase, cuerpoPromo]) {
      assert.match(cuerpo, /construirReglaEdadDesdeMaximos\(/);
      assert.doesNotMatch(cuerpo, /\{ \.\.\.actual, \[campo\]: /, "no debe quedar el patrón viejo que escribía cualquier campo, incluidos los mínimos");
    }
  });

  test("no existe ningún input editable ligado a 'infanteMin' o 'ninoMin' (ni onChange ni value={edad.infanteMin}/{edad.ninoMin})", () => {
    assert.doesNotMatch(fuente, /"infanteMin"/, "ningún llamador debe pasar el campo 'infanteMin' como editable");
    assert.doesNotMatch(fuente, /"ninoMin"/, "ningún llamador debe pasar el campo 'ninoMin' como editable");
    assert.doesNotMatch(fuente, /value=\{edad\.infanteMin\}/);
    assert.doesNotMatch(fuente, /value=\{edad\.ninoMin\}/);
  });

  test("los inputs de 'Infante desde' están fijos en 0 y deshabilitados (bases y promociones)", () => {
    const ocurrenciasLabel = fuente.match(/Infante desde<\/label><Input type="number" value=\{0\} disabled/g) ?? [];
    assert.equal(ocurrenciasLabel.length, 2, "debe haber exactamente 2 inputs 'Infante desde' fijos en 0 y disabled (uno en bases, otro en promociones)");
  });

  test("los inputs de 'Niño desde' se derivan como infanteMax+1 y están deshabilitados (bases y promociones)", () => {
    const ocurrencias = fuente.match(/Niño desde<\/label><Input type="number" value=\{edad\.infanteMax \+ 1\} disabled/g) ?? [];
    assert.equal(ocurrencias.length, 2, "debe haber exactamente 2 inputs 'Niño desde' derivados de infanteMax+1 y disabled (uno en bases, otro en promociones)");
  });

  test("los inputs de 'Infante hasta' y 'Niño hasta' SÍ quedan editables, ligados a setBaseEdad/setPromoEdad con 'infanteMax'/'ninoMax'", () => {
    assert.match(fuente, /Infante hasta<\/label><Input type="number" value=\{edad\.infanteMax\} onChange=\{\(e\) => setBaseEdad\(clave, "infanteMax", e\.target\.value\)\}/);
    assert.match(fuente, /Niño hasta<\/label><Input type="number" value=\{edad\.ninoMax\} onChange=\{\(e\) => setBaseEdad\(clave, "ninoMax", e\.target\.value\)\}/);
    assert.match(fuente, /Infante hasta<\/label><Input type="number" value=\{edad\.infanteMax\} onChange=\{\(e\) => setPromoEdad\(i, "infanteMax", e\.target\.value\)\}/);
    assert.match(fuente, /Niño hasta<\/label><Input type="number" value=\{edad\.ninoMax\} onChange=\{\(e\) => setPromoEdad\(i, "ninoMax", e\.target\.value\)\}/);
  });
});

describe("CalculadoraEditor.tsx — bases y promociones persisten los 4 valores completos en DubaiParams", () => {
  test("basesList (fuente de params.bases) reusa basesExtra tal cual, sin filtrar edadesPropias — el objeto completo de 4 valores llega a DubaiParams", () => {
    const posBasesList = fuente.indexOf("const basesList = useMemo<DubaiBase[]>(");
    assert.notEqual(posBasesList, -1);
    const cuerpo = fuente.slice(posBasesList, posBasesList + 600);
    assert.match(cuerpo, /\.\.\.\(basesExtra\[clave\] \?\? \{\}\)/, "basesList debe expandir basesExtra[clave] completo (incluye edadesPropias con los 4 valores)");
  });

  test("params.bases = basesList directamente (sin remapear/perder campos) y params.promos = promos directamente", () => {
    const posParams = fuente.indexOf("const params = useMemo<DubaiParams>(");
    assert.notEqual(posParams, -1);
    const cuerpo = fuente.slice(posParams, posParams + 700);
    assert.match(cuerpo, /bases:\s*basesList,/);
    assert.match(cuerpo, /promos,/);
  });

  test("editarPromo (usado por 'usarEdadesPropias' checkbox) conserva el resto del objeto promo con spread — nunca descarta edadesPropias ya cargado", () => {
    const posEditarPromo = fuente.indexOf("function editarPromo(");
    assert.notEqual(posEditarPromo, -1);
    const cuerpo = fuente.slice(posEditarPromo, posEditarPromo + 200);
    assert.match(cuerpo, /\{ \.\.\.p, \.\.\.patch \}/);
  });
});

describe("CalculadoraEditor.tsx — compatibilidad histórica al cargar bases/promociones ya guardadas", () => {
  test("basesExtraInicial/promos iniciales se cargan tal cual desde `inicial` (edadesPropias incluido), sin descartar registros previos", () => {
    assert.match(fuente, /usarEdadesPropias: b\.usarEdadesPropias, edadesPropias: b\.edadesPropias,/);
    assert.match(fuente, /const \[promos, setPromos\] = useState<DubaiPromo\[\]>\(inicial\?\.promos \?\? \[\]\);/);
  });

  test("la visualización de 'Infante desde'/'Niño desde' se deriva SIEMPRE de `edad.infanteMax` en render (nunca de edad.infanteMin/edad.ninoMin ya guardados) — así un registro histórico con mínimos inconsistentes se muestra igual de correcto que uno nuevo", () => {
    // Ya cubierto por los matches de arriba (value={0} / value={edad.infanteMax + 1}),
    // pero se deja expreso: ninguna ruta de render lee edad.infanteMin/edad.ninoMin.
    assert.doesNotMatch(fuente, /\{edad\.infanteMin\}/);
    assert.doesNotMatch(fuente, /\{edad\.ninoMin\}/);
  });
});
