#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// CLI delgado del guard de espejo (R1, Commit 7). Recibe por argv el nombre
// de la función, su firma exacta (identity args), el conteo con esa firma
// exacta, el conteo con cualquier firma y la ruta de la migración 164; lee
// `prosrc` por STDIN (nunca por un campo separado por `|` de `psql -A`, que
// se rompería si el cuerpo contiene `||`). Delega TODA la decisión a
// `verificarEspejo` (misma lógica que pruebas/espejo164.test.ts).
//
// Uso: printf '%s' "$PROSRC" | node verificar_espejo_cli.mjs <nombre> <args> <cnt> <cntCualquierFirma> <rutaMigracion>
// Exit 0 = OK. Exit 1 = FAIL (divergencia o cualquiera de los 6 modos de falla).
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { verificarEspejo } from "./espejo164.mjs";

const [, , nombre, args, cntStr, cntCualquierFirmaStr, rutaMigracion] = process.argv;

if (!nombre || !rutaMigracion) {
  console.error("uso: verificar_espejo_cli.mjs <nombre> <args> <cnt> <cntCualquierFirma> <rutaMigracion> (prosrc por stdin)");
  process.exit(2);
}

let migSrc;
try {
  migSrc = readFileSync(rutaMigracion, "utf8");
} catch (e) {
  console.error(`  FAIL ${nombre}: no se pudo leer la migración en ${rutaMigracion}: ${e.message}`);
  process.exit(2);
}

const prosrc = readFileSync(0, "utf8");

const r = verificarEspejo({
  nombre,
  args,
  cnt: Number(cntStr),
  cntCualquierFirma: Number(cntCualquierFirmaStr),
  prosrc,
  migSrc,
});

if (r.ok) {
  console.log(`  OK   ${r.motivo}`);
  process.exit(0);
} else {
  console.error(`  FAIL ${r.motivo}`);
  process.exit(1);
}
