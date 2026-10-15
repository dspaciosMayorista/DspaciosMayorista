// #30 (entrega B) — comisión y escala del ASESOR INTERNO en un contrato NETO.
//
// Decisión del dueño (2026-10-10): la comisión y la escala/meta del asesor
// interno se calculan sobre el PVP ORIGINAL, separadas de la comisión B2B. Que
// el aliado compre en NETO (paga PVP − su comisión) no le baja la comisión ni
// el rango al asesor que hizo la venta.
//
// Depende de la entrega A (`lib/finanzas/netoB2B.ts`, desglose del NETO). Fuera
// de NETO devuelve exactamente el `precio_venta` de siempre. Solo lectura: la
// liquidación se calcula al abrir la página; nada aquí se guarda.
import { desgloseNetoB2B, type VentaNetoCampos } from "@/lib/finanzas/netoB2B";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** PVP con el que liquida el asesor interno: el original en NETO, el guardado en el resto. */
export function pvpAsesorInterno(v: VentaNetoCampos): number {
  return desgloseNetoB2B(v)?.pvpOriginal ?? num(v.precio_venta);
}

/** Base comisionable del asesor interno: PVP (original en NETO) − BNC, nunca negativa. */
export function baseAsesorInterno(v: VentaNetoCampos): number {
  return Math.max(0, pvpAsesorInterno(v) - num(v.impuesto));
}
