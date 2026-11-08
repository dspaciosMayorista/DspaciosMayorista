// #84 (bloque A) — los cambios internos aparecen al recargar; lo congelado se mantiene. FIXTURES LOCALES inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carteraDe, partirCartera, type AbonoPortal, type VentaPortal } from "../lib/portal/b2bPortal.ts";

const venta = (o: Record<string, unknown>) => ({ numero_contrato: "00-0001", relacion: "propio", tenant: "mayorista", cliente: "Cliente Prueba", destino: "CTG", fecha_salida: "2026-12-01", estado: "pendiente", moneda: "COP", precio_venta: 1_000_000, ...o }) as unknown as VentaPortal;
const abono = (id: number, v: number): AbonoPortal => ({ id, numero_contrato: "00-0001", fecha_abono: "2026-11-01", valor_abono: v, forma_pago: "transferencia" });

test("sin conversión de cobro: un ajuste interno del precio y un nuevo abono se reflejan en la siguiente lectura", () => {
  const antes = carteraDe([venta({})], [abono(1, 400_000)])[0];
  assert.deepEqual([antes.valor, antes.pagado, antes.saldo], [1_000_000, 400_000, 600_000]);
  const despues = carteraDe([venta({ precio_venta: 1_100_000, estado: "confirmado" })], [abono(1, 400_000), abono(2, 200_000)])[0];
  assert.deepEqual([despues.valor, despues.pagado, despues.saldo, despues.estado], [1_100_000, 600_000, 500_000, "confirmado"]);
});

test("acuerdo congelado (cobro en otra moneda con TRM): cambiar precio_venta de la oferta NO mueve el total acordado", () => {
  const congelado = { moneda: "USD", moneda_cobro: "COP", trm_cobro: 4000, total_cobro: 4_000_000, precio_venta: 1000 };
  const a = carteraDe([venta(congelado)], [])[0];
  const b = carteraDe([venta({ ...congelado, precio_venta: 1200 })], [])[0];
  assert.equal(a.moneda, "COP");
  assert.equal(a.valor, 4_000_000);
  assert.equal(b.valor, 4_000_000);
});

test("un contrato saldado sale de «Con saldo» y la participación por comisión nunca entra a la cartera", () => {
  const filas = carteraDe([venta({}), venta({ numero_contrato: "00-0009", relacion: "participacion" })], [abono(1, 1_000_000)]);
  assert.equal(filas.length, 1);
  const p = partirCartera(filas, [abono(1, 1_000_000)]);
  assert.equal(p.conSaldo.length, 0);
  assert.equal(p.pagos.length, 1);
});

test("todas las pantallas del portal leen en cada petición (sin caché) con service-role", () => {
  for (const p of ["ventas", "cartera", "documentos", "cotizaciones", "agentes", "perfil"]) {
    const s = readFileSync(new URL(`../app/portal/b2b/${p}/page.tsx`, import.meta.url), "utf8");
    assert.match(s, /export const dynamic = "force-dynamic"/, p);
    assert.doesNotMatch(s, /unstable_cache|use cache|revalidate\s*=/, p);
  }
});
