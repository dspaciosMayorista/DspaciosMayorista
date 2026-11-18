// Owner correction batch 2026-11-18 · gap G7 — recurrence guard for the 390 px overflow of the Temporadas tab with the calculator open.
// Cause (compiled-browser finding D3): the «Tipo de calculadora» <select> carries the long option «Corporativa (tarifa por habitación + suplementos)», and without a wrapping
// row / max-width it widened the page past 390 px. jsdom has NO layout, so this is a WIRING guard only (it can only prove the two classes that removed the cause stay in the
// source); the behavior itself is proved by the compiled-browser run (humo_verif_promo_2611.mjs: «sin desborde horizontal» at 390 px for Mixta, Dubai and the stale-calculator hotel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fuente = readFileSync(new URL("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx", import.meta.url), "utf8");

test("el selector «Tipo de calculadora» vive en una fila que envuelve y el <select> no excede el ancho del contenedor (flex-wrap + max-w-full)", () => {
  const i = fuente.indexOf("<span>Tipo de calculadora:</span>");
  assert.ok(i > 0, "el selector sigue existiendo");
  const fila = fuente.slice(fuente.lastIndexOf("<div", i), i);
  assert.match(fila, /\bflex-wrap\b/, "la fila debe poder envolver en móvil");
  const select = fuente.slice(i, fuente.indexOf("</select>", i));
  assert.match(select, /<select[\s\S]*?className="[^"]*\bmax-w-full\b/, "el <select> no puede ser más ancho que la pantalla");
});
