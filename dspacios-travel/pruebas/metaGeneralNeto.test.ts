import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ventasMesPorMoneda, ventasMesPorMonedaDesdeAgregado } from "../lib/dashboard/metricas.ts";
import { pvpAsesorInterno, baseAsesorInterno } from "../lib/finanzas/liquidacionAsesor.ts";
import { desgloseNetoB2B } from "../lib/finanzas/netoB2B.ts";

// ─────────────────────────────────────────────────────────────────────────
// #30 · Decisión del dueño (2026-10-12): en B2B NETO
//   · la META GENERAL de ventas de la agencia suma el TOTAL EXIGIBLE (lo que
//     se le cobra al aliado: PVP − su comisión descontada);
//   · la comisión y la meta/escala del ASESOR interno siguen sobre el PVP
//     ORIGINAL.
// No hace falta una fórmula nueva: en NETO `ventas.precio_venta` YA es el
// total exigible (lo deja así `aplicar_neto_contrato_manual`, migración 206,
// y la reserva NETO de #38), y la meta general suma `precio_venta`
// (`fn_dashboard_ventas_mes`, migración 186). El asesor lo reconstruye con
// `pvpAsesorInterno` (total exigible + descuento). Esta prueba fija las dos
// cosas para que un cambio en cualquiera de los lados no las mezcle. Sin
// recálculo de históricos: todo se calcula al leer.
// Ejecución contra PostgreSQL real: pruebas/contratoManualNeto206.pg.ts (M1/M2).
// ─────────────────────────────────────────────────────────────────────────

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (rel: string) => readFileSync(join(AQUI, "..", rel), "utf8");

// PVP 2.000.000, BNC 400.000, aliado al 10 % → comisión 160.000, total NETO 1.840.000.
const NETO = { estado: "activo", moneda: "COP", fecha_venta: "2026-10-12", precio_venta: 1_840_000, impuesto: 400_000, comision_b2b: 160_000, comision_estado: "descontada" } as const;
const PVP = { estado: "activo", moneda: "COP", fecha_venta: "2026-10-03", precio_venta: 3_000_000, impuesto: 0, comision_b2b: null, comision_estado: null } as const;
// Reserva B2B comisionable (#38): la comisión NO está descontada, el precio es el PVP.
const COMISIONABLE = { estado: "confirmado", moneda: "COP", fecha_venta: "2026-10-20", precio_venta: 1_000_000, impuesto: 0, comision_b2b: 100_000, comision_estado: "pendiente" } as const;

describe("meta general = total exigible NETO", () => {
  test("ventas del mes: el NETO suma lo que se cobra, no el PVP original", () => {
    const total = ventasMesPorMoneda([NETO, PVP, COMISIONABLE], "2026-10");
    assert.deepEqual(total, { COP: 1_840_000 + 3_000_000 + 1_000_000 });
    assert.notEqual(total.COP, desgloseNetoB2B(NETO)!.pvpOriginal + 3_000_000 + 1_000_000);
  });

  test("el agregado en base da lo mismo que el oráculo por filas", () => {
    assert.deepEqual(ventasMesPorMonedaDesdeAgregado([{ moneda: "COP", total: 1_840_000 + 3_000_000 + 1_000_000 }]),
      ventasMesPorMoneda([NETO, PVP, COMISIONABLE], "2026-10"));
  });

  test("fn_dashboard_ventas_mes (186) suma precio_venta y el Dashboard la consume tal cual", () => {
    const sql186 = leer("supabase/migrations/20260601000186_dashboard_agregados.sql");
    const fn = sql186.slice(sql186.indexOf("create or replace function public.fn_dashboard_ventas_mes"));
    assert.match(fn.slice(0, fn.indexOf("$$;")), /coalesce\(sum\(precio_venta\), 0\) as total/);
    assert.match(leer("app/(dashboard)/dashboard/page.tsx"), /rpc\("fn_dashboard_ventas_mes"/);
  });

  test("la 206 deja precio_venta = PVP − comisión (total exigible) al aplicar NETO", () => {
    const sql206 = leer("supabase/migrations/20260601000206_contrato_manual_neto.sql");
    assert.match(sql206, /set precio_venta\s+= v_bruto - v_com,/);
    assert.match(sql206, /comision_estado = 'descontada'/);
  });
});

describe("meta y comisión del asesor = PVP original", () => {
  test("NETO: el asesor liquida (rango y base) sobre el PVP original", () => {
    assert.equal(pvpAsesorInterno(NETO), 2_000_000);
    assert.equal(baseAsesorInterno(NETO), 1_600_000);
  });

  test("fuera de NETO: el precio guardado de siempre (sin tocar #38 comisionable ni PVP)", () => {
    assert.equal(pvpAsesorInterno(PVP), 3_000_000);
    assert.equal(pvpAsesorInterno(COMISIONABLE), 1_000_000);
    assert.equal(baseAsesorInterno(PVP), 3_000_000);
  });

  test("la página de liquidación usa el PVP del asesor, no precio_venta crudo", () => {
    const pagina = leer("app/(dashboard)/dashboard/liquidacion/page.tsx");
    assert.match(pagina, /const pvp = pvpAsesorInterno\(v\);/);
    assert.match(pagina, /const base = baseAsesorInterno\(v\);/);
    assert.doesNotMatch(pagina, /const pvp = Number\(v\.precio_venta\)/);
  });
});
