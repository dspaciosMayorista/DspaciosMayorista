import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA LA DIVERGENCIA — props no serializables de Server a Client
// Component (React/Next: "Functions cannot be passed directly to Client
// Components unless you explicitly expose it by marking it with 'use
// server'.").
//
// Este error real tumbó en producción TODA la ficha de contrato
// (`/dashboard/contratos/[numero]`, para CUALQUIER contrato, no solo uno):
// `page.tsx` (Server Component) le pasaba a `CondicionesContratoPanel`
// (`"use client"`) un prop `overrideForm` que era una función render-prop.
// React/Next serializa TODOS los props al cruzar el límite Server → Client, y
// una función (que no sea una Server Action) no es serializable — la
// excepción se lanza en CADA render de ese árbol, sin importar si el camino
// que la dispara se ejercita o no en tiempo de ejecución. `npm run build` NO
// lo detecta (es un error de runtime, no de compilación).
//
// Esta guarda escanea el CÓDIGO FUENTE (no ejecuta React) de todo archivo
// `.tsx`/`.jsx` bajo `app/` y `components/` que NO sea un Client Component
// (sin `"use client"` en la primera línea — o sea, un Server Component por
// default de Next.js) y falla si encuentra, en un atributo JSX:
//   1) una función flecha literal:            prop={(x) => ...} / prop={() => ...}
//   2) una expresión de función:              prop={function ...}
//   3) new Date/Map/Set construido inline:    prop={new Date(...)}
//   4) un objeto literal con una flecha adentro: prop={{ algo: () => ... }}
//
// Deliberadamente NO intenta detectar referencias a funciones por NOMBRE
// (ej. `prop={miFuncion}`) ni componentes pasados por referencia (ej.
// `icon={FileSignature}`) — ambos son legítimos con demasiada frecuencia en
// este repo (arrays/objetos de datos con nombres que parecen función, o un
// componente ícono pasado entre dos Server Components sin cruzar ningún
// límite) para poder distinguirlos sin analizar tipos; una regla así
// produciría falsos positivos constantes y terminaría ignorada. Esos dos
// casos se revisaron a mano en la auditoría que agregó esta guarda (sep-2026)
// y no hay ninguno hoy — si aparece uno nuevo, revisar manualmente si el
// archivo que arma el JSX es realmente un Server Component y si el
// componente que lo recibe es realmente un Client Component.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

const DIRS_ESCANEADAS = ["app", "components"];
const EXCLUIR_DIRS = new Set(["node_modules", ".next", "sitio-web"]);

function listarArchivos(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    if (EXCLUIR_DIRS.has(entrada)) continue;
    const ruta = join(dir, entrada);
    const st = statSync(ruta);
    if (st.isDirectory()) {
      out.push(...listarArchivos(ruta));
    } else if (/\.(tsx|jsx)$/.test(entrada)) {
      out.push(ruta);
    }
  }
  return out;
}

const PATRONES: { nombre: string; regex: RegExp }[] = [
  { nombre: "función flecha literal como prop", regex: /=\{\s*\([a-zA-Z_][a-zA-Z0-9_]*\)\s*=>|=\{\s*\(\)\s*=>/ },
  { nombre: "expresión `function` como prop", regex: /=\{\s*function\b/ },
  { nombre: "new Date/Map/Set(...) construido inline como prop", regex: /=\{\s*new (Date|Map|Set)\(/ },
  { nombre: "objeto literal con una flecha adentro como prop", regex: /=\{\{[^}]*=>/ },
];

function esClientComponent(src: string): boolean {
  // La directiva debe ser la primera sentencia real del módulo (comentarios y
  // líneas en blanco antes no cuentan para Next, pero un JSDoc de bloque
  // tampoco desactiva la regla — por eso se busca en TODO el encabezado, no
  // solo en la línea 1 literal).
  const encabezado = src.slice(0, 500);
  return /^\s*["']use client["'];?\s*$/m.test(encabezado) || /\n\s*["']use client["'];?\s*\n/.test(src.slice(0, 200));
}

test("ningún Server Component (app/, components/) pasa una prop no serializable a un elemento JSX", () => {
  const archivos = DIRS_ESCANEADAS.flatMap((d) => listarArchivos(join(raiz, d)));
  const hallazgos: string[] = [];

  for (const ruta of archivos) {
    const src = readFileSync(ruta, "utf8");
    if (esClientComponent(src)) continue; // los Client Components pueden pasarse funciones entre sí libremente

    for (const { nombre, regex } of PATRONES) {
      const m = src.match(regex);
      if (m) {
        const linea = src.slice(0, m.index).split("\n").length;
        hallazgos.push(`${relative(raiz, ruta)}:${linea} — ${nombre} ("${m[0].slice(0, 60)}")`);
      }
    }
  }

  assert.deepEqual(
    hallazgos,
    [],
    `Server Component(s) pasando una prop no serializable a un Client Component:\n${hallazgos.join("\n")}\n\n` +
      `Esto revienta en producción con "Functions cannot be passed directly to Client Components..." ` +
      `en TODOS los renders de esa ruta (no solo en el caso que lo dispare), y npm run build no lo detecta. ` +
      `Ver la cabecera de este archivo para el caso real (overrideForm, sep-2026).`
  );
});

test("control negativo: la guarda SÍ detecta el patrón exacto que rompió producción", () => {
  const fuenteRota = `
export default function Pagina() {
  return (
    <Panel
      overrideForm={(linea) => (
        <Formulario id={linea.id} />
      )}
    />
  );
}
`.trim();
  assert.ok(!esClientComponent(fuenteRota), "el control negativo debe simular un Server Component");
  const coincide = PATRONES.some(({ regex }) => regex.test(fuenteRota));
  assert.ok(coincide, "la guarda no detectó el patrón real que causó el incidente de producción");
});

test("control negativo: un Client Component con la misma sintaxis NO se marca (no cruza el límite Server→Client)", () => {
  const fuenteCliente = `
"use client";
export default function Panel() {
  return <Boton onClick={(e) => console.log(e)} />;
}
`.trim();
  assert.ok(esClientComponent(fuenteCliente), "debe reconocerse como Client Component");
});
