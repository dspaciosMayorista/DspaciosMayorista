// Se ejecuta por comando directo (sin tocar package.json):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/salidaVinculada63Contabilidad.react.ts
//
// #63 (E/F/G) · contabilidad USD/COP y recuperación, con el código REAL (asientos.ts, asegurarCuentasPorPagar, gestion-actions):
//   · el asiento de una obligación aceptada se devenga por su equivalente en COP congelado — nunca por el nominal en dólares;
//   · un error de lectura (incluido el que menciona valor_cop_63) FALLA CERRADO: no hay asiento, no se cae al nominal;
//   · asegurarCuentasPorPagar no complementa un contrato #63 con nominales: verifica y, si falta algo, pide revisión;
//   · editar/eliminar lo aceptado responde un rechazo claro (sin éxito ficticio).
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { postearAsientoCxP } = await import("../lib/contabilidad/asientos.ts");
const { asegurarCuentasPorPagar } = await import("../lib/reservar/asegurarCuentasPorPagar.ts");
const { actualizarCuentaPorPagar, eliminarCuentaPorPagar, guardarCostos } = await import("../app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts");

const NUM = "DTM-0500";
const hoy = "2030-01-01";
const importeAsiento = (bd: ReturnType<typeof usarBD>, cuentaId: number) => {
  const a = bd.filas("asientos_contables").find((x) => x.origen === "cxp" && x.referencia === `cxp:${cuentaId}`);
  if (!a) return null;
  return bd.filas("asiento_lineas").filter((l) => l.asiento_id === a.id).reduce((s, l) => s + Number(l.debe || 0), 0);
};
const post = (cuentaId: number, valorTotal: number) =>
  postearAsientoCxP({ cuentaId, numeroContrato: NUM, tipoProveedor: "hotel", proveedor: "Hotel SAS", servicio: "Hotel", valorTotal, fecha: hoy, tenant: "mayorista" });

/** Hace que la lectura de `tabla` (select…eq…maybeSingle) devuelva un error de la base. */
function conErrorDeLectura(bd: ReturnType<typeof usarBD>, tabla: string, error: { message: string; code?: string }) {
  const from0 = bd.sb.from.bind(bd.sb);
  bd.sb.from = ((t: string) => {
    const b = from0(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (t !== tabla) return b;
    b.select = () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error }), then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res) }), then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res) });
    return b;
  }) as unknown as typeof bd.sb.from;
}

const filaCxP = (extra: Fila): Fila => ({ numero_contrato: NUM, tenant: "mayorista", tipo_proveedor: "hotel", proveedor: "Hotel SAS", servicio: "Hotel", moneda: "COP", ...extra });

test("asiento de una obligación de SIEMPRE: se devenga por su valor de siempre", async () => {
  const bd = usarBD({ cuentas_por_pagar: [filaCxP({ id: 1, valor_total: 500_000 })] });
  const r = await post(1, 500_000);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(importeAsiento(bd, 1), 500_000);
});

test("asiento de una obligación ACEPTADA en USD: se devenga por el equivalente en COP congelado (USD 210 → 840.000), jamás por 210", async () => {
  const bd = usarBD({ cuentas_por_pagar: [filaCxP({ id: 2, valor_total: 210, moneda: "USD", aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: 840_000, trm_63: 4000 })] });
  const r = await post(2, 210);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(importeAsiento(bd, 2), 840_000);
});

test("FALLA CERRADO: un error de lectura —también el que menciona valor_cop_63 o es 42703— NO cae al nominal: no hay asiento", async () => {
  for (const error of [
    { message: "connection reset", code: "08006" },
    { message: 'column cuentas_por_pagar.valor_cop_63 does not exist', code: "42703" },
    { message: "permission denied for table cuentas_por_pagar", code: "42501" },
  ]) {
    const bd = usarBD({ cuentas_por_pagar: [filaCxP({ id: 3, valor_total: 210, moneda: "USD", aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: 840_000, trm_63: 4000 })] });
    conErrorDeLectura(bd, "cuentas_por_pagar", error);
    const r = await post(3, 210);
    assert.equal(r.ok, false, `${error.message}: debía fallar cerrado`);
    assert.equal(importeAsiento(bd, 3), null, `${error.message}: NO se registró ningún asiento (ni a 210 ni a 840.000)`);
    assert.equal(bd.filas("asientos_contables").length, 0);
  }
});

test("FALLA CERRADO: marca sin equivalente, equivalente sin marca, fila inexistente u otro contrato → error y sin asiento", async () => {
  const casos: Array<[string, Fila | null, number]> = [
    ["marca sin equivalente", filaCxP({ id: 4, valor_total: 210, moneda: "USD", aceptacion_63_id: 7, obligacion_63: "hotel:0" }), 4],
    ["equivalente sin marca", filaCxP({ id: 5, valor_total: 210, moneda: "USD", valor_cop_63: 840_000, trm_63: 4000 }), 5],
    ["otro contrato", filaCxP({ id: 6, numero_contrato: "DTM-0999", valor_total: 210, aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: 840_000, trm_63: 4000 }), 6],
    ["fila inexistente", null, 99],
  ];
  for (const [que, fila, id] of casos) {
    const bd = usarBD({ cuentas_por_pagar: fila ? [fila] : [] });
    const r = await post(id, 210);
    assert.equal(r.ok, false, que);
    assert.equal(importeAsiento(bd, id), null, que);
  }
});

// ── asegurarCuentasPorPagar ────────────────────────────────────────────────
const venta63 = (extra: Fila = {}): Fila => ({
  numero_contrato: NUM, tenant: "mayorista", costo_hotel: 840_000, costo_aereo: 2_080_500, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0,
  moneda: "COP", hotel: "Hotel", aerolinea: "AERO", plazo: null, fecha_salida: "2030-01-10", aceptacion_63_id: 7, ...extra,
});
const aceptacion = (): Fila => ({ id: 7, estado: "completa", numero_contrato: NUM, snapshot: { financiero: { cxp: [{ obligacion: "hotel:0" }, { obligacion: "aereo:0" }] } } });
const cxp63 = (obl: string, extra: Fila = {}): Fila => filaCxP({ aceptacion_63_id: 7, obligacion_63: obl, valor_cop_63: 1, trm_63: 4000, ...extra });

test("asegurarCuentasPorPagar en un contrato #63 COMPLETO: no crea nada (no compara 210 USD contra 840.000 COP)", async () => {
  const bd = usarBD({
    ventas: [venta63()], p63_aceptacion: [aceptacion()], proveedores: [], contrato_hoteles: [], contrato_vuelos: [],
    cuentas_por_pagar: [cxp63("hotel:0", { id: 1, valor_total: 210, moneda: "USD", valor_cop_63: 840_000 }), cxp63("aereo:0", { id: 2, tipo_proveedor: "aereo", valor_total: 2_080_500, valor_cop_63: 2_080_500 })],
  });
  const r = await asegurarCuentasPorPagar(NUM);
  assert.deepEqual(r, { ok: true, creadas: 0 });
  assert.equal(bd.filas("cuentas_por_pagar").length, 2, "ni un suplemento");
});

test("asegurarCuentasPorPagar en un contrato #63 al que le FALTA una obligación aceptada: pide revisión y NO inventa una con nominales", async () => {
  const bd = usarBD({
    ventas: [venta63()], p63_aceptacion: [aceptacion()], proveedores: [], contrato_hoteles: [], contrato_vuelos: [],
    cuentas_por_pagar: [cxp63("aereo:0", { id: 2, tipo_proveedor: "aereo", valor_total: 2_080_500, valor_cop_63: 2_080_500 })],
  });
  const r = await asegurarCuentasPorPagar(NUM);
  assert.equal(r.ok, false);
  assert.equal(r.requiereRevision, true);
  assert.equal(r.creadas, 0);
  assert.match(String(r.error), /requiere revisi[oó]n/i);
  assert.equal(bd.filas("cuentas_por_pagar").length, 1, "no se insertó nada (la hotelera con costo_hotel > 0 habría sido el complemento de siempre)");
});

test("asegurarCuentasPorPagar: un ERROR de lectura de la aceptación no se confunde con 'no es #63' ni crea nada", async () => {
  const bd = usarBD({ ventas: [venta63()], p63_aceptacion: [aceptacion()], proveedores: [], contrato_hoteles: [], contrato_vuelos: [], cuentas_por_pagar: [] });
  conErrorDeLectura(bd, "p63_aceptacion", { message: "boom" });
  const r = await asegurarCuentasPorPagar(NUM);
  assert.equal(r.ok, false);
  assert.equal(bd.filas("cuentas_por_pagar").length, 0, "sin complemento aunque el contrato tenga costos");
});

test("asegurarCuentasPorPagar en un contrato de SIEMPRE: el complemento de faltantes sigue como antes", async () => {
  const bd = usarBD({
    ventas: [venta63({ aceptacion_63_id: null, costo_hotel: 0 })], proveedores: [], contrato_hoteles: [], contrato_vuelos: [], cuentas_por_pagar: [],
  });
  const r = await asegurarCuentasPorPagar(NUM);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.creadas, 1, "se crea la CxP aérea que faltaba, como siempre");
  assert.equal(bd.filas("cuentas_por_pagar")[0]?.tipo_proveedor, "aereo");
});

// ── editar / eliminar lo aceptado ─────────────────────────────────────────
const MSG = /sus costos y obligaciones con proveedores .* salen de lo aceptado y no se editan/;

test("gestión: editar el principal, el proveedor o el servicio de una obligación ACEPTADA se rechaza con un mensaje claro; vencimiento e IVA siguen editables", async () => {
  const bd = usarBD({ cuentas_por_pagar: [cxp63("hotel:0", { id: 1, valor_total: 210, moneda: "USD", valor_cop_63: 840_000, proveedor: "Hotel SAS", servicio: "Hotel" })] });
  const base = { id: 1, numeroContrato: NUM, proveedor: "Hotel SAS", servicio: "Hotel", valorTotal: 210, fechaVencimiento: "2030-02-01" };
  for (const [que, cambio] of [["el valor", { valorTotal: 100 }], ["el proveedor", { proveedor: "Otro" }], ["el servicio", { servicio: "Otro servicio" }]] as const) {
    const r = await actualizarCuentaPorPagar({ ...base, ...cambio });
    assert.equal(r.ok, false, que);
    assert.match(String((r as { error?: string }).error), MSG, que);
  }
  assert.equal(bd.filas("cuentas_por_pagar")[0]?.valor_total, 210, "nada cambió");
  const ok = await actualizarCuentaPorPagar({ ...base, ivaDescontable: 0 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(bd.filas("cuentas_por_pagar")[0]?.fecha_vencimiento, "2030-02-01");
  assert.equal(importeAsiento(bd, 1), 840_000, "y el asiento se devenga por el equivalente COP congelado");
});

test("gestión: eliminar una obligación aceptada o editar los costos del contrato responde el rechazo de la base (p63_*), sin éxito ficticio", async () => {
  const bd = usarBD({ cuentas_por_pagar: [cxp63("hotel:0", { id: 1, valor_total: 210, moneda: "USD", valor_cop_63: 840_000 })], ventas: [venta63()] });
  const from0 = bd.sb.from.bind(bd.sb);
  const rechazo = (message: string) => ({ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message } }).then(res), eq: () => rechazo(message), select: () => rechazo(message) });
  bd.sb.from = ((t: string) => {
    const b = from0(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (t === "cuentas_por_pagar") b.delete = () => rechazo("p63_cxp_protegida: la obligación aceptada no se elimina");
    if (t === "ventas") b.update = () => rechazo("p63_protegido: los costos de un contrato de oferta COP con TRM salen de lo aceptado");
    return b;
  }) as unknown as typeof bd.sb.from;
  const del = await eliminarCuentaPorPagar(1, NUM);
  assert.equal(del.ok, false);
  assert.match(String((del as { error?: string }).error), MSG);
  const costos = await guardarCostos(NUM, { costo_hotel: 1, costo_aereo: 1, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0 });
  assert.equal(costos.ok, false);
  assert.match(String((costos as { error?: string }).error), MSG);
  assert.equal(bd.filas("cuentas_por_pagar").length, 1);
});
