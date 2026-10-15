// #30 (entrega B) — comisión y escala del ASESOR INTERNO sobre el PVP
// original en contratos NETO (decisión del dueño, 2026-10-10). Depende de la
// entrega A (lib/finanzas/netoB2B.ts). Preflight real del 2026-10-11: 0
// contratos NETO en Producción, ningún mes liquidado afectado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { pvpAsesorInterno, baseAsesorInterno } from "@/lib/finanzas/liquidacionAsesor";
import { planComisionReserva } from "@/lib/reservar/comisionReserva";
import { comisionMes } from "@/lib/calc/escalas";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const PVP = 2_000_000;
const BNC = 400_000;
const PCT = 0.1;

function ventaDesdePlan(modo: "neta" | "comisionable" | null) {
  const r = planComisionReserva({ modoCompra: modo, precioVenta: PVP, impuesto: BNC, pct: PCT });
  assert.ok(r.ok);
  return {
    precio_venta: r.plan.precioFinal,
    impuesto: BNC,
    comision_b2b: r.plan.comision,
    comision_estado: r.plan.comisionEstado,
  };
}

// ── Asesor interno: comisión y escala sobre el PVP original ────────────────

test("asesor: misma venta en PVP o en NETO liquida con el mismo PVP y la misma base", () => {
  const pvp = ventaDesdePlan("comisionable");
  const neto = ventaDesdePlan("neta");
  assert.equal(pvpAsesorInterno(pvp), PVP);
  assert.equal(pvpAsesorInterno(neto), PVP);
  assert.equal(baseAsesorInterno(pvp), PVP - BNC);
  assert.equal(baseAsesorInterno(neto), PVP - BNC);
});

test("asesor: la escala por rango no baja cuando el aliado compra en NETO", () => {
  // Rango que solo se alcanza con el PVP completo: 2.000.000 entra al 3 %,
  // 1.840.000 (el total NETO) se quedaría en el 1 %.
  const rangos = [
    { pvp_desde: 0, pvp_hasta: 1_999_999, pct: 0.01 },
    { pvp_desde: 2_000_000, pvp_hasta: null, pct: 0.03 },
  ];
  const conPvp = comisionMes({ sumaPvp: pvpAsesorInterno(ventaDesdePlan("comisionable")), sumaBase: baseAsesorInterno(ventaDesdePlan("comisionable")), rangos, retHonorarios: 0 });
  const conNeto = comisionMes({ sumaPvp: pvpAsesorInterno(ventaDesdePlan("neta")), sumaBase: baseAsesorInterno(ventaDesdePlan("neta")), rangos, retHonorarios: 0 });
  assert.deepEqual(conNeto, conPvp);
  // Y con el precio guardado (lo que hacía la página antes de #30) sí bajaba.
  const antes = comisionMes({ sumaPvp: 1_840_000, sumaBase: 1_840_000 - BNC, rangos, retHonorarios: 0 });
  assert.notDeepEqual(antes, conPvp);
});

test("asesor: contratos que no son NETO liquidan exactamente con su precio_venta de siempre", () => {
  for (const v of [
    { precio_venta: 1_234_567, impuesto: 100_000, comision_b2b: 99_000, comision_estado: "pendiente" },
    { precio_venta: 500_000, impuesto: 900_000, comision_b2b: null, comision_estado: null },
    { precio_venta: null, impuesto: null, comision_b2b: null, comision_estado: null },
  ]) {
    assert.equal(pvpAsesorInterno(v), Number(v.precio_venta) || 0);
    assert.equal(baseAsesorInterno(v), Math.max(0, (Number(v.precio_venta) || 0) - (Number(v.impuesto) || 0)));
  }
});

test("liquidación: la página usa el PVP original del asesor y lee la marca NETO", () => {
  const src = leer("app/(dashboard)/dashboard/liquidacion/page.tsx");
  assert.match(src, /import \{ pvpAsesorInterno, baseAsesorInterno \} from "@\/lib\/finanzas\/liquidacionAsesor"/);
  assert.match(src, /select\("asesor_firma_nombre, precio_venta, impuesto, comision_b2b, comision_estado, estado, fecha_venta"\)/);
  assert.match(src, /const pvp = pvpAsesorInterno\(v\);/);
  assert.match(src, /const base = baseAsesorInterno\(v\);/);
  assert.doesNotMatch(src, /const pvp = Number\(v\.precio_venta\)/, "volvió a liquidar con el precio NETO");
});

test("venta directa con descuento comercial: el asesor liquida sobre el precio rebajado (no es NETO B2B)", () => {
  const directa = { precio_venta: 1_700_000, impuesto: BNC, comision_b2b: null, comision_estado: null };
  assert.equal(pvpAsesorInterno(directa), 1_700_000);
  assert.equal(baseAsesorInterno(directa), 1_300_000);
});
