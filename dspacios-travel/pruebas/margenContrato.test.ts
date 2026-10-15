// #30 — margen mínimo del contrato manual (lib/contrato/margenContrato.ts).
// Decisión del dueño: PVP → (PVP − costo) / PVP ≥ 20 %; NETO →
// (total exigible − costo) / total exigible ≥ 6 %. El límite exacto cumple;
// superadmin/administración pueden aprobar uno por debajo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  evaluarMargenContrato,
  puedeAprobarMargenBajo,
  mensajeMargenInsuficiente,
  MARGEN_MINIMO_PVP,
  MARGEN_MINIMO_NETO,
} from "@/lib/contrato/margenContrato";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;

test("mínimos de la decisión: PVP 20 %, NETO 6 %", () => {
  assert.equal(MARGEN_MINIMO_PVP, 0.2);
  assert.equal(MARGEN_MINIMO_NETO, 0.06);
});

test("PVP 20 %: justo por debajo no cumple; en el límite y por encima, sí", () => {
  // costo 800.000 → PVP mínimo 1.000.000.
  const abajo = evaluarMargenContrato({ modo: "pvp", ingreso: 999_999, costos: 800_000 });
  const limite = evaluarMargenContrato({ modo: "pvp", ingreso: 1_000_000, costos: 800_000 });
  const arriba = evaluarMargenContrato({ modo: "pvp", ingreso: 1_000_001, costos: 800_000 });
  assert.equal(abajo.cumple, false);
  assert.ok(abajo.margenActual < 0.2);
  assert.equal(limite.cumple, true);
  assert.ok(Math.abs(limite.margenActual - 0.2) < 1e-12);
  assert.equal(arriba.cumple, true);
  assert.equal(Math.ceil(abajo.ingresoMinimo), 1_000_000);
});

test("NETO 6 %: justo por debajo no cumple; en el límite y por encima, sí", () => {
  // costo 940.000 → total NETO mínimo 1.000.000.
  const abajo = evaluarMargenContrato({ modo: "neto", ingreso: 999_999, costos: 940_000 });
  const limite = evaluarMargenContrato({ modo: "neto", ingreso: 1_000_000, costos: 940_000 });
  const arriba = evaluarMargenContrato({ modo: "neto", ingreso: 1_000_001, costos: 940_000 });
  assert.equal(abajo.cumple, false);
  assert.equal(limite.cumple, true);
  assert.ok(Math.abs(limite.margenActual - 0.06) < 1e-12);
  assert.equal(arriba.cumple, true);
  assert.equal(Math.ceil(abajo.ingresoMinimo), 1_000_000);
});

test("NETO con números del plan: total 1.840.000 → costo máximo 1.729.600; con PVP ese costo no pasaría", () => {
  assert.equal(evaluarMargenContrato({ modo: "neto", ingreso: 1_840_000, costos: 1_729_601 }).cumple, false);
  assert.equal(evaluarMargenContrato({ modo: "neto", ingreso: 1_840_000, costos: 1_729_600 }).cumple, true);
  assert.equal(evaluarMargenContrato({ modo: "neto", ingreso: 1_840_000, costos: 1_700_000 }).cumple, true);
  // El mismo costo contra el PVP (2.000.000) a 20 %: no cumple (13,5 %).
  assert.equal(evaluarMargenContrato({ modo: "pvp", ingreso: 2_000_000, costos: 1_729_600 }).cumple, false);
});

test("sin costos cargados no hay margen que validar; sin ingreso el margen es 0", () => {
  assert.equal(evaluarMargenContrato({ modo: "pvp", ingreso: 0, costos: 0 }).cumple, true);
  assert.equal(evaluarMargenContrato({ modo: "neto", ingreso: 500_000, costos: 0 }).cumple, true);
  const sinIngreso = evaluarMargenContrato({ modo: "neto", ingreso: 0, costos: 100 });
  assert.deepEqual([sinIngreso.cumple, sinIngreso.margenActual], [false, 0]);
});

test("aprobación excepcional: solo superadmin y administración, y solo si la piden", () => {
  assert.equal(puedeAprobarMargenBajo("superadmin", true), true);
  assert.equal(puedeAprobarMargenBajo("administracion", true), true);
  for (const rol of ["gerencia", "operaciones", "venta", "agencia", "freelance", null]) {
    assert.equal(puedeAprobarMargenBajo(rol, true), false, String(rol));
  }
  assert.equal(puedeAprobarMargenBajo("superadmin", false), false);
  assert.equal(puedeAprobarMargenBajo("administracion", undefined), false);
});

test("mensaje: dice qué se midió (PVP o total NETO), el mínimo y el margen actual", () => {
  const neto = mensajeMargenInsuficiente(evaluarMargenContrato({ modo: "neto", ingreso: 1_840_000, costos: 1_729_601 }), fmt);
  assert.match(neto, /^El total NETO \(\$1\.840\.000\) no cubre el margen mínimo del 6%\. .*el total NETO mínimo es \$1\.840\.002 \(margen actual: 6\.0%\)\.$/);
  const pvp = mensajeMargenInsuficiente(evaluarMargenContrato({ modo: "pvp", ingreso: 999_999, costos: 800_000 }), fmt);
  assert.match(pvp, /^El PVP \(\$999\.999\) no cubre el margen mínimo del 20%\. .*el PVP mínimo es \$1\.000\.000/);
});

// ── Cableado: servidor y formulario usan la misma regla ─────────────────────

test("crearContrato: PVP 20 % donde estaba; NETO 6 % con el plan validado, ambos antes de numerar", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  const c = src.slice(src.indexOf("async function crearContratoInterno"), src.indexOf("export type VentaEditInput"));
  const iNumero = c.indexOf("siguienteNumeroContrato(tenant)");
  const iPvp = c.indexOf('evaluarMargenContrato({ modo: "pvp", ingreso: precioVenta, costos: totalCostosManual })');
  const iPlan = c.indexOf("const plan = await planNetoContratoManual(sb,");
  const iNeto = c.indexOf('evaluarMargenContrato({ modo: "neto", ingreso: plan.plan.totalExigible, costos: totalCostosManual })');
  assert.ok(iPvp > 0 && iPlan > iPvp && iNeto > iPlan && iNumero > iNeto, "PVP → plan NETO → margen NETO → número");
  assert.match(c, /totalCostosManual > 0 && input\.modoCompra !== "neto"\) \{/, "en NETO no se exige el 20 % sobre el PVP");
  assert.equal((c.match(/!puedeAprobarMargenBajo\(ctx\.rol, input\.forzarMargen\)/g) ?? []).length, 2, "misma aprobación en los dos");
  assert.equal((c.match(/margenInsuficiente: true/g) ?? []).length, 2);
  assert.doesNotMatch(src, /MARKUP_MIN = /, "una sola fuente del mínimo");
});

test("formulario: aviso previo con la misma regla; en NETO usa el total del plan y espera a tenerlo", () => {
  const f = leer("app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
  assert.match(f, /const ingresoMargen = pideNeto \? planNeto\?\.totalExigible \?\? null : total;/);
  assert.match(f, /evaluarMargenContrato\(\{ modo: modoMargen, ingreso: ingresoMargen \?\? 0, costos: totalCostos \}\)/);
  const iPlan = f.indexOf("if (pideNeto && !planNeto) {");
  const iMargen = f.indexOf("if (!margenVista.cumple) {");
  assert.ok(iPlan > 0 && iMargen > iPlan, "el margen NETO se valida con el plan ya calculado");
  assert.doesNotMatch(f, /MARKUP_MIN/);
});
