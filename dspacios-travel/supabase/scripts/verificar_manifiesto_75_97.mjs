// Verifica un árbol contra docs/tecnico/entrega-75-97-manifiesto.md (SHA-256 del contenido en LF). Solo lee.
// Uso (desde la raíz del repositorio, la carpeta que contiene dspacios-travel/):
//   node dspacios-travel/supabase/scripts/verificar_manifiesto_75_97.mjs rama75     → tras confirmar #75 e incorporar origin/main
//   node dspacios-travel/supabase/scripts/verificar_manifiesto_75_97.mjs rama97     → árbol de #97 antes de integrar (sus archivos originales)
//   node dspacios-travel/supabase/scripts/verificar_manifiesto_75_97.mjs integrado  → rama #97 integrada (y main tras las dos fusiones)
// Sale con código 1 si algún archivo no coincide o falta. Con `integrado` también lista archivos cambiados respecto de origin/main que NO están en el
// manifiesto (fuera de docs/): no deberían existir.
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const col = { rama75: 2, rama97: 3, integrado: 4 }[process.argv[2]];
if (!col) { console.error("indica rama75, rama97 o integrado"); process.exit(2); }
// 2.º argumento opcional: ruta del manifiesto (la rama #97 original no lo trae hasta incorporar #75).
const MAN = process.argv[3] ?? "dspacios-travel/docs/tecnico/entrega-75-97-manifiesto.md";
if (!fs.existsSync(MAN)) { console.error(`no encuentro ${MAN}: ejecuta desde la raíz del repositorio`); process.exit(2); }
const filas = fs.readFileSync(MAN, "utf8").split("\n").filter((l) => l.startsWith("| `"))
  .map((l) => l.split("|").map((c) => c.trim().replace(/^`|`$/g, "")));
let ok = 0, malos = [];
for (const c of filas) {
  // columnas de la fila: '', archivo, origen, rama75, rama97, integrado
  const archivo = "dspacios-travel/" + c[1];
  const h = [null, null, c[3], c[4], c[5]][col];
  if (!h || h === "—") continue;
  const real = fs.existsSync(archivo) ? crypto.createHash("sha256").update(fs.readFileSync(archivo, "utf8").replace(/\r\n/g, "\n")).digest("hex") : "(no existe)";
  if (real === h) ok++; else malos.push(`${c[1]}: esperado ${h.slice(0, 12)}… · real ${real.slice(0, 12)}…`);
}
let extra = [];
if (process.argv[2] === "integrado") {
  const enManifiesto = new Set(filas.map((c) => "dspacios-travel/" + c[1]));
  const cambiados = [...execFileSync("git", ["diff", "--name-only", "origin/main"]).toString().split("\n"),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"]).toString().split("\n")].filter(Boolean);
  extra = [...new Set(cambiados)].filter((f) => f.startsWith("dspacios-travel/") && !f.startsWith("dspacios-travel/docs/") && !enManifiesto.has(f));
}
console.log(`${process.argv[2]}: ${ok} coinciden · ${malos.length} no coinciden${process.argv[2] === "integrado" ? ` · ${extra.length} cambiados fuera del manifiesto` : ""}`);
for (const m of malos) console.log("  ✗ " + m);
for (const e of extra) console.log("  + fuera del manifiesto: " + e);
process.exit(malos.length || extra.length ? 1 : 0);
