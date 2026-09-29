import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// D1 cuenta y D2 lista los vouchers con contacto interno. Para que D2 muestre
// TODOS y SOLO los que D1 cuenta, las dos consultas deben usar exactamente el
// mismo recorrido del JSON y el mismo criterio de coincidencia. La semántica se
// probó contra PostgreSQL local (incluido un contacto en un objeto anidado);
// esto vigila que una edición futura no las vuelva a separar.

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(raiz, "supabase/scripts/diagnostico_191_vouchers_contacto_interno.sql"), "utf8")
  .replace(/\r\n/g, "\n");

function bloqueWith(consulta: "D1" | "D2"): string {
  const ini = sql.indexOf(`-- ${consulta}.`);
  assert.ok(ini >= 0, `no se encontró ${consulta}`);
  const w = sql.indexOf("with recursive", ini);
  const finWith = sql.indexOf("\nselect", w);
  assert.ok(w > ini && finWith > w, `${consulta} no tiene bloque WITH`);
  return sql.slice(w, finWith);
}

test("D1 y D2 comparten el mismo bloque WITH, carácter por carácter", () => {
  assert.equal(bloqueWith("D1"), bloqueWith("D2"));
});

test("el recorrido baja por objetos y arreglos a cualquier profundidad", () => {
  const w = bloqueWith("D1");
  assert.match(w, /nodos\(voucher_id, ruta, valor\) as \(/);
  assert.match(w, /from nodos n/, "recursivo sobre sí mismo");
  assert.match(w, /jsonb_each\(case when jsonb_typeof\(n\.valor\) = 'object'/);
  assert.match(w, /jsonb_array_elements\(case when jsonb_typeof\(n\.valor\) = 'array'/);
});

test("D1 y D2 cuentan/listan desde el mismo conjunto (por_voucher)", () => {
  const d1 = sql.slice(sql.indexOf("-- D1."), sql.indexOf("-- D2."));
  const d2 = sql.slice(sql.indexOf("-- D2."));
  assert.match(d1.slice(d1.indexOf("\nselect")), /count\(distinct voucher_id\) from por_voucher\) as vouchers_con_contacto_interno/);
  assert.match(d2.slice(d2.indexOf("\nselect")), /from por_voucher\s+order by/);
});

test("las columnas de salida no exponen texto del voucher ni el contacto", () => {
  const d2 = sql.slice(sql.indexOf("-- D2."));
  const salida = d2.slice(d2.lastIndexOf("\nselect"));
  assert.doesNotMatch(salida, /\b(texto|contacto|contacto_digitos|publico_digitos|contenido|valor)\b(?!_)/);
});
