import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calcularNetoPrograma,
  calcularNetoProgramaConModalidad,
  recalcularNetosPorTarifa,
  resolverValorReglaAcomodacion,
} from "../lib/calc/programaPrecio.ts";

test("opcion apagada conserva exactamente el impuesto general", () => {
  assert.equal(resolverValorReglaAcomodacion({
    modo: "impuesto", valorGeneral: 100_000, impuestoPorAcomodacion: false, impuestoAcomodacion: 20_000,
  }), 100_000);
});

test("la opcion solo altera el modo impuesto", () => {
  assert.equal(resolverValorReglaAcomodacion({
    modo: "pct", valorGeneral: 8, impuestoPorAcomodacion: true, impuestoAcomodacion: 40_000,
  }), 8);
});

test("impuesto requerido ausente o invalido falla cerrado", () => {
  assert.equal(resolverValorReglaAcomodacion({
    modo: "impuesto", valorGeneral: 100_000, impuestoPorAcomodacion: true, impuestoAcomodacion: null,
  }), null);
  assert.equal(resolverValorReglaAcomodacion({
    modo: "impuesto", valorGeneral: 100_000, impuestoPorAcomodacion: true, impuestoAcomodacion: -1,
  }), null);
});

test("cada acomodacion usa su impuesto y nunca el de otra", () => {
  const resultado = recalcularNetosPorTarifa(
    { sencilla: 1_000_000, doble: 1_000_000, triple: 1_000_000, multiple: 1_000_000 },
    { modo: "impuesto", valor: 999_999, pctComision: 10 },
    {
      impuestoPorAcomodacion: true,
      impuestos: { sencilla: 100_000, doble: 80_000, triple: 60_000, multiple: 40_000 },
    }
  );
  assert.deepEqual(resultado, {
    sencilla: 910_000,
    doble: 908_000,
    triple: 906_000,
    multiple: 904_000,
  });
});

test("una tarifa sin su impuesto queda sin neto, no usa cero ni el impuesto general", () => {
  const resultado = recalcularNetosPorTarifa(
    { sencilla: 1_000_000, doble: null, triple: null, multiple: null },
    { modo: "impuesto", valor: 100_000, pctComision: 10 },
    { impuestoPorAcomodacion: true, impuestos: { sencilla: null, doble: null, triple: null, multiple: null } }
  );
  assert.equal(resultado.sencilla, null);
});

test("modalidad historica y nueva reciben el mismo impuesto puntual pero conservan sus formulas", () => {
  const valor = resolverValorReglaAcomodacion({
    modo: "impuesto", valorGeneral: 100_000, impuestoPorAcomodacion: true, impuestoAcomodacion: 80_000,
  });
  assert.equal(valor, 80_000);
  const input = { tarifa: 1_000_000, modo: "impuesto" as const, valor: valor!, pctComision: 10 };
  const base = calcularNetoPrograma(input);
  const historica = calcularNetoProgramaConModalidad(input, "historica");
  const nueva = calcularNetoProgramaConModalidad(input, "base_neta_impuestos_al_final");
  assert.equal(base.neto, 908_000);
  assert.equal(historica.netoParaMarkup, 908_000);
  assert.equal(nueva.netoParaMarkup, 828_000);
  assert.equal(nueva.montoSinMarkup, 80_000);
});

test("wiring: editor, frontera publica, resumen y detalle transportan los cuatro impuestos", () => {
  const root = process.cwd();
  const editor = readFileSync(join(root, "app/(dashboard)/dashboard/producto/programas/[id]/ProgramaEditor.tsx"), "utf8");
  const actions = readFileSync(join(root, "app/(dashboard)/dashboard/producto/programas/actions.ts"), "utf8");
  const programas = readFileSync(join(root, "lib/programas.ts"), "utf8");
  for (const campo of ["Sencilla", "Doble", "Triple", "Multiple"]) {
    assert.match(editor, new RegExp(`impuesto${campo}`));
    assert.match(actions, new RegExp(`impuesto_${campo.toLowerCase()}`));
    assert.match(programas, new RegExp(`impuesto_${campo.toLowerCase()}`));
  }
  assert.match(actions, /typeof impuestoPorAcomodacionRaw !== "boolean"/);
  assert.match(programas, /regla_comisionable_impuesto_por_acomodacion/);
});

test("migracion 163 mantiene firma, lock, ACL y compatibilidad de payload", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260601000163_programa_impuesto_por_acomodacion.sql"), "utf8");
  assert.match(sql, /guardar_programa_salidas\s*\(\s*p_programa_id bigint,\s*p_regla jsonb,\s*p_salidas jsonb/s);
  assert.match(sql, /where id = p_programa_id\s+for update/s);
  assert.match(sql, /if p_regla \? 'impuestoPorAcomodacion'/);
  assert.match(sql, /v_programa\.regla_comisionable_impuesto_por_acomodacion/);
  assert.match(sql, /revoke all on function public\.guardar_programa_salidas\(bigint, jsonb, jsonb\) from anon/);
  assert.match(sql, /grant execute on function public\.guardar_programa_salidas\(bigint, jsonb, jsonb\) to authenticated/);
});
