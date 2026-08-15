import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recalcularNetosPorTarifa } from "../lib/calc/programaPrecio.ts";

// ───────────────────────────────────────────────────────────────────────────
// § "El proveedor da tarifa comisionable" (Salidas y precios, migración 151)
//
// `recalcularNetosPorTarifa` es lo que dispara el recálculo en pantalla
// cuando cambia la REGLA (modo/valor/% comisión) en vez de una tarifa
// puntual — antes de esto, cambiar la regla no volvía a calcular los netos
// ya escritos, así que quedaban con la regla vieja hasta que alguien
// retipeara cada tarifa a mano.
// ───────────────────────────────────────────────────────────────────────────

const REGLA = { modo: "pct" as const, valor: 3, pctComision: 10 };

test("recalcula cada acomodación con su propia tarifa, sin mezclar valores", () => {
  const r = recalcularNetosPorTarifa(
    { sencilla: 120, doble: 110, triple: 100, multiple: 90 },
    REGLA
  );
  // base = tarifa*(1-3%); comision = base*10%; neto = tarifa - comision.
  // sencilla: base=116.4, com=11.64, neto=108.36
  assert.equal(r.sencilla, 108.36);
  // doble: base=106.7, com=10.67, neto=99.33
  assert.equal(r.doble, 99.33);
  // triple: base=97, com=9.7, neto=90.3
  assert.equal(r.triple, 90.3);
  // multiple: base=87.3, com=8.73, neto=81.27
  assert.equal(r.multiple, 81.27);
  // Las cuatro difieren entre sí: si alguna quedara igual a otra por un cruce
  // de valores, esta comprobación fallaría (con estos números de entrada las
  // cuatro tarifas producen cuatro netos distintos).
  const vals = [r.sencilla, r.doble, r.triple, r.multiple];
  assert.equal(new Set(vals).size, 4, "dos acomodaciones comparten neto: posible mezcla de valores");
});

test("una acomodación sin tarifa del proveedor no se toca (queda null, no 0)", () => {
  const r = recalcularNetosPorTarifa(
    { sencilla: 120, doble: null, triple: null, multiple: null },
    REGLA
  );
  assert.equal(r.sencilla, 108.36);
  assert.equal(r.doble, null);
  assert.equal(r.triple, null);
  assert.equal(r.multiple, null);
});

test("tarifa inválida (vacía, cero, negativa) no produce neto", () => {
  const r = recalcularNetosPorTarifa(
    { sencilla: 0, doble: -5, triple: NaN, multiple: null },
    REGLA
  );
  assert.equal(r.sencilla, null);
  assert.equal(r.doble, null);
  assert.equal(r.triple, null);
  assert.equal(r.multiple, null);
});

test("modo 'ninguno' no resta nada de la base; modo 'impuesto' resta un monto fijo", () => {
  const ninguno = recalcularNetosPorTarifa(
    { sencilla: 100, doble: null, triple: null, multiple: null },
    { modo: "ninguno", valor: 999, pctComision: 10 }
  );
  // base = tarifa (999 se ignora en modo 'ninguno'); com = 100*10% = 10; neto = 90.
  assert.equal(ninguno.sencilla, 90);

  const impuesto = recalcularNetosPorTarifa(
    { sencilla: 100, doble: null, triple: null, multiple: null },
    { modo: "impuesto", valor: 20, pctComision: 10 }
  );
  // base = 100-20 = 80; com = 80*10% = 8; neto = 92.
  assert.equal(impuesto.sencilla, 92);
});

// ───────────────────────────────────────────────────────────────────────────
// GUARDA DE WIRING — sin mirar el código fuente no hay forma de comprobar
// desde un test unitario que `guardarSalidas` sea ATÓMICO (eso exige una BD
// real; ver supabase/scripts/pruebas y la verificación local documentada en
// el mensaje del PR). Esto solo comprueba que la acción sigue pasando por el
// RPC atómico y no volvió al patrón DELETE + INSERT suelto que motivó la
// migración 151.
// ───────────────────────────────────────────────────────────────────────────
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const actionsSrc = readFileSync(
  join(raiz, "app/(dashboard)/dashboard/producto/programas/actions.ts"),
  "utf8"
);
const guardarSalidasSrc = actionsSrc.slice(actionsSrc.indexOf("export async function guardarSalidas"));

test("guardarSalidas guarda por el RPC atómico, no por delete+insert suelto", () => {
  assert.match(
    guardarSalidasSrc,
    /\.rpc\(\s*"guardar_programa_salidas"/,
    "guardarSalidas dejó de llamar al RPC atómico"
  );
  assert.doesNotMatch(
    guardarSalidasSrc.slice(0, guardarSalidasSrc.indexOf(".rpc(")),
    /\.from\(\s*"programa_salidas"\s*\)\s*\.delete\(/,
    "volvió un DELETE suelto antes del RPC: reabre la ventana sin atomicidad que corrigió la 151"
  );
});

test("guardarSalidas manda tanto la regla como las tarifas del proveedor al RPC", () => {
  assert.match(guardarSalidasSrc, /p_regla:\s*\{/, "no arma p_regla para el RPC");
  assert.match(guardarSalidasSrc, /activa:\s*!!regla\.activa/, "no manda si la regla está activa");
  assert.match(guardarSalidasSrc, /tarifa_sencilla:\s*num\(s\.tarifaSencilla\)/, "no manda tarifa_sencilla al RPC");
  assert.match(guardarSalidasSrc, /tarifa_doble:\s*num\(s\.tarifaDoble\)/, "no manda tarifa_doble al RPC");
  assert.match(guardarSalidasSrc, /tarifa_triple:\s*num\(s\.tarifaTriple\)/, "no manda tarifa_triple al RPC");
  assert.match(guardarSalidasSrc, /tarifa_multiple:\s*num\(s\.tarifaMultiple\)/, "no manda tarifa_multiple al RPC");
});
