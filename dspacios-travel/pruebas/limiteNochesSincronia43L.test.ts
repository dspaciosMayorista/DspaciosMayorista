import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MAX_NOCHES_VIAJE } from "../lib/reglas/duracionViaje.ts";

// ─────────────────────────────────────────────────────────────────────────
// #43/#60 entrega L (auditoría): la estadía máxima vive en DOS lugares que deben coincidir — `MAX_NOCHES_VIAJE` (TypeScript: validación,
// consultas, «desde») y `public._e5_max_noches()` (SQL: coincidencias de la 301 y CHECK de la 302). Cambiar uno no cambia el otro, así que
// esta prueba falla si difieren. Se lee la ÚLTIMA migración que define la función (si el límite cambia con una migración nueva, es esa la
// que manda) y los scripts que repiten el número a propósito (postcheck de la 301 y el diagnóstico de la entrega L, que se corre antes de
// aplicar la 301). Sin consultas en tiempo de ejecución.
// ─────────────────────────────────────────────────────────────────────────
const raiz = new URL("../", import.meta.url);
const leer = (f: string) => readFileSync(new URL(f, raiz), "utf8");

function limiteSql(): { valor: number; archivo: string } {
  const migraciones = readdirSync(new URL("supabase/migrations/", raiz)).filter((f) => f.endsWith(".sql")).sort();
  let ultimo: { valor: number; archivo: string } | null = null;
  for (const f of migraciones) {
    const m = [...leer(`supabase/migrations/${f}`).matchAll(/function public\._e5_max_noches\(\)[^$]*\$\$\s*select\s+(\d+)\s*\$\$/g)];
    if (m.length) ultimo = { valor: Number(m[m.length - 1][1]), archivo: f };
  }
  assert.ok(ultimo, "ninguna migración define public._e5_max_noches()");
  return ultimo!;
}

test("TypeScript y SQL dicen el mismo límite de noches", () => {
  const sql = limiteSql();
  assert.equal(MAX_NOCHES_VIAJE, sql.valor, `MAX_NOCHES_VIAJE = ${MAX_NOCHES_VIAJE} pero ${sql.archivo} define _e5_max_noches() = ${sql.valor}: cámbialos juntos`);
});

test("el postcheck de la 301 y el diagnóstico de la entrega L esperan ese mismo valor", () => {
  const post = leer("supabase/scripts/postcheck_301_promociones_acumulacion.sql");
  assert.match(post, new RegExp(`'${MAX_NOCHES_VIAJE}', case when max_noches = ${MAX_NOCHES_VIAJE} then 'OK'`));
  assert.match(leer("supabase/scripts/diagnostico_L_productos_mas_30_noches.sql"), new RegExp(`select ${MAX_NOCHES_VIAJE} as max_noches`));
});

test("la 302 no repite el número: su CHECK usa _e5_max_noches()", () => {
  const m302 = leer("supabase/migrations/20260601000302_desde_estadia_real.sql");
  assert.match(m302, /noches between 1 and public\._e5_max_noches\(\)/);
});

test("en TypeScript el número solo está en lib/reglas/duracionViaje.ts", () => {
  assert.match(leer("lib/reglas/duracionViaje.ts"), new RegExp(`export const MAX_NOCHES_VIAJE = ${MAX_NOCHES_VIAJE};`));
  for (const f of ["lib/reservar/edadesMenores.ts", "lib/calc/desdeEstadia.ts"]) assert.doesNotMatch(leer(f), /MAX_NOCHES\w* = \d/, f);
});
