// Se ejecuta con npm run test:react (loader reactLoader.mjs ya stubea
// @/lib/supabase/server y @/lib/supabase/admin para lib/finanzas/comisionResolver.ts).
//
// #90-portal-comision (ciclo 2): un contrato puede tener comisiones de DOS
// aliados distintos en `aliados_b2b` (ej. el freelance titular que vendió +
// el aliado que asistió). Antes de este fix, `resolverComisionB2B` decidía el
// ACCESO al documento (cuenta de cobro / estado de cuenta) mirando solo el
// `aliado_id` de la fila MÁS RECIENTE — así que el aliado cuya fila NO fuera
// la más reciente quedaba sin ningún id que calzara y se le negaba el
// documento, aunque su propia comisión existiera en el contrato. Ahora el
// acceso se concede si CUALQUIER fila del contrato es de la ficha de quien
// mira, y la comisión mostrada sigue aislada a SU fila (`filasCobrables`,
// sin tocar).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;

const usuario = (id: string, aliadoId: number | null, extra: Fila = {}): Fila => ({
  id, nombre: id, rol: "freelance", tenant: "mayorista", activo: true,
  aliado_id: aliadoId, acceso_legacy_nombre: false, ...extra,
});

const venta = (numero: string, extra: Fila = {}): Fila => ({
  numero_contrato: numero, cliente: "Cliente X", destino: "SMR", fecha_salida: "2026-02-01", estado: "confirmado",
  precio_venta: 1_000_000, moneda: "COP", tenant: "mayorista", b2b_usuario_id: null, aliado_id: null,
  agencia_nombre: null, freelance_nombre: null, modo_compra: null, comision_b2b: null, tipo_asesor: null, ...extra,
});

const comision = (id: number, numero: string, aliadoId: number, pct: number, extra: Fila = {}): Fila => ({
  id, numero_contrato: numero, aliado: `Aliado ${aliadoId}`, tipo_aliado: "freelance", aliado_id: aliadoId,
  precio_venta: 1_000_000, base_comision: 1_000_000, base_explicita: true, comision_valor: null,
  pct_comision: pct, recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0,
  estado: null, descontada_en_precio: false, ...extra,
});

const aliadoCatalogo = (id: number, nombre: string): Fila => ({
  id, nombre, tipo_documento: "CC", nit: String(id * 100), direccion: null, telefono: null, email: null,
  banco: null, tipo_cuenta: null, numero_cuenta: null,
});

function tablasBase(): Record<string, Fila[]> {
  return {
    usuarios: [
      usuario("u-A", 7),                                   // titular, fila MÁS VIEJA en MULTI-1
      usuario("u-B", 9),                                    // asistente, fila MÁS NUEVA en MULTI-1
      usuario("u-C", 11),                                   // sin ninguna comisión en MULTI-1
      usuario("u-inactivo", 7, { activo: false }),
      usuario("u-interno", null, { rol: "venta" }),
      usuario("u-agencia", 13, { rol: "agencia" }),
    ],
    ventas: [
      // Comisión manual con DOS filas, cada una de un aliado distinto. 7 es
      // la más VIEJA (id menor); 9 la más NUEVA — el caso exacto que antes
      // del fix dejaba a 7 sin acceso a su propio documento.
      venta("MULTI-1"),
      // El MISMO aliado (7) con DOS filas propias en un contrato distinto.
      venta("DOSFILAS-1"),
      // Comisión de una agencia (persona jurídica): no debe generar cuenta
      // de cobro (la regla de hoy, sin cambios, vive en la página).
      venta("AGENCIA-1"),
    ],
    aliados_b2b: [
      comision(101, "MULTI-1", 7, 0.10),
      comision(102, "MULTI-1", 9, 0.05),
      comision(201, "DOSFILAS-1", 7, 0.08),
      comision(202, "DOSFILAS-1", 7, 0.12),
      comision(301, "AGENCIA-1", 13, 0.12, { tipo_aliado: "agencia", aliado: "Agencia 13" }),
    ],
    aliados: [aliadoCatalogo(7, "Aliado 7"), aliadoCatalogo(9, "Aliado 9"), aliadoCatalogo(13, "Agencia 13")],
  };
}

async function resolver(usuarioId: string, numero: string, id: number | null = null, tablas: Record<string, Fila[]> = tablasBase()) {
  const db = supabaseEnMemoria(tablas, {}, usuarioId);
  __setClient(db);
  __setAdmin(db);
  return resolverComisionB2B(numero, id);
}

afterEach(() => { __resetClient(); __resetAdmin(); });

test("contrato con 2 comisiones: cada aliado abre SU cuenta de cobro, nunca la del otro — sin importar cuál fila es la más reciente", async () => {
  const t = tablasBase();
  const rA = await resolver("u-A", "MULTI-1", null, t);
  const rB = await resolver("u-B", "MULTI-1", null, t);
  if (rA?.tipo !== "comision" || rB?.tipo !== "comision") throw new Error(`esperaba "comision" en los dos: ${rA?.tipo} / ${rB?.tipo}`);

  assert.equal(rA.aliado, "Aliado 7");
  assert.equal(rA.detalle.pctComision, 0.10);
  assert.equal(rA.detalle.totalPagar, 100000);
  assert.equal(rA.esDueno, true);
  assert.equal(rA.esInterno, false);

  assert.equal(rB.aliado, "Aliado 9");
  assert.equal(rB.detalle.pctComision, 0.05);
  assert.equal(rB.detalle.totalPagar, 50000);
  assert.equal(rB.esDueno, true);
  assert.equal(rB.esInterno, false);

  // Nunca se mezclan: lo que ve A no es el total ni el % de B.
  assert.notEqual(rA.detalle.totalPagar, rB.detalle.totalPagar);
  assert.notEqual(rA.detalle.pctComision, rB.detalle.pctComision);

  // El estado de cuenta de cada uno cuelga de SU fila (aliadoB2bId), no de la del otro.
  assert.equal(rA.aliadoB2bId, 101);
  assert.equal(rB.aliadoB2bId, 102);
});

test("un aliado SIN comisión en ese contrato: rechazado (ni siquiera sabe que existe)", async () => {
  assert.equal(await resolver("u-C", "MULTI-1"), null);
});

test("usuario inactivo: rechazado aunque su ficha SÍ tenga una comisión real en el contrato", async () => {
  assert.equal(await resolver("u-inactivo", "MULTI-1"), null);
});

test("rol interno distinto de agencia/freelance, sin ficha enlazada al contrato: rechazado", async () => {
  assert.equal(await resolver("u-interno", "MULTI-1"), null);
});

test("agencia (persona jurídica): el aliado SÍ es dueño de su comisión, pero queda marcada para NO generar cuenta de cobro", async () => {
  const r = await resolver("u-agencia", "AGENCIA-1");
  if (r?.tipo !== "comision") throw new Error(`esperaba "comision": ${r?.tipo}`);
  assert.equal(r.esDueno, true);
  assert.equal(r.esInterno, false);
  // La regla de hoy (sin cambios, vive en app/portal/comision/[numero]/page.tsx):
  // `tipoAsesorEfectivo === "agencia" && !esInterno` → mensaje de factura
  // electrónica, nunca el documento de cuenta de cobro.
  assert.equal(r.tipoAsesorEfectivo, "agencia");
});

test("un mismo aliado con DOS filas propias en un contrato: se le deja ELEGIR cuál ver — nunca se suman ni se rechaza de plano", async () => {
  const sinElegir = await resolver("u-A", "DOSFILAS-1");
  if (sinElegir?.tipo !== "elegir") throw new Error(`esperaba "elegir": ${sinElegir?.tipo}`);
  assert.deepEqual(sinElegir.opciones.map((o) => o.id).sort((a, b) => a - b), [201, 202]);
  assert.deepEqual(sinElegir.opciones.map((o) => o.totalPagar).sort((a, b) => a - b), [80000, 120000]);

  const conId = await resolver("u-A", "DOSFILAS-1", 201);
  if (conId?.tipo !== "comision") throw new Error(`esperaba "comision": ${conId?.tipo}`);
  assert.equal(conId.detalle.totalPagar, 80000);

  // Otro aliado sin ninguna fila en ESTE contrato no puede "adivinar" el id de una fila ajena.
  assert.equal(await resolver("u-B", "DOSFILAS-1", 201), null);
});

// ── /portal/comision/[numero]/estado-cuenta ─────────────────────────────────
// Esa página (app/portal/comision/[numero]/estado-cuenta/page.tsx) hace EXACTAMENTE
// dos cosas: 1) resolverComisionB2B (ya probado arriba) decide acceso y `aliadoB2bId`;
// 2) filtra `comision_b2b_pagos` por `eq("aliado_b2b_id", r.aliadoB2bId)` (sus líneas
// 32-38) y calcula pagado/saldo con la misma aritmética (líneas 40-47). No se puede
// importar la página en esta prueba: usa `createAdminClient()` directo (no pasa por
// el stub de comisionResolver.ts), así que replicamos aquí la MISMA consulta sobre el
// MISMO admin stubeado — el aislamiento depende enteramente de que `aliadoB2bId` sea
// la fila correcta, que es justo lo que corrige este ciclo.
type PagoFila = { id: number; fecha: string; valor: number };
async function estadoDeCuenta(usuarioId: string, numero: string, tablas: Record<string, Fila[]> = tablasBase()) {
  const db = supabaseEnMemoria(tablas, {}, usuarioId);
  __setClient(db);
  __setAdmin(db);
  const r = await resolverComisionB2B(numero, null);
  if (!r || r.tipo !== "comision" || r.aliadoB2bId == null) return null;
  const { data: pagosRaw } = (await db
    .from("comision_b2b_pagos")
    .select("id, fecha, valor")
    .eq("aliado_b2b_id", r.aliadoB2bId)
    .order("fecha", { ascending: true })
    .order("id", { ascending: true })) as { data: PagoFila[] | null; error: unknown };
  const total = r.detalle.totalPagar;
  let acum = 0;
  const pagos = ((pagosRaw ?? []) as PagoFila[]).map((p) => {
    acum += Number(p.valor ?? 0);
    return { id: p.id, fecha: p.fecha, valor: Number(p.valor ?? 0), saldoTras: Math.max(total - acum, 0) };
  });
  return { aliadoB2bId: r.aliadoB2bId, total, pagado: acum, saldo: Math.max(total - acum, 0), pagos };
}

test("estado de cuenta de la comisión: cada aliado ve SU historial de abonos y SU saldo, nunca los del otro; sin comisión en el contrato, rechazado", async () => {
  const t = tablasBase();
  t.comision_b2b_pagos = [
    { id: 1, aliado_b2b_id: 101, fecha: "2026-01-10", valor: 30000 }, // abono de A (fila 101)
    { id: 2, aliado_b2b_id: 101, fecha: "2026-01-20", valor: 20000 }, // abono de A
    { id: 3, aliado_b2b_id: 102, fecha: "2026-01-15", valor: 50000 }, // abono de B (fila 102), pagada del todo
  ];

  const ecA = await estadoDeCuenta("u-A", "MULTI-1", t);
  const ecB = await estadoDeCuenta("u-B", "MULTI-1", t);
  if (!ecA || !ecB) throw new Error(`esperaba estado de cuenta para los dos: A=${ecA} B=${ecB}`);

  assert.equal(ecA.aliadoB2bId, 101);
  assert.equal(ecA.total, 100000);
  assert.equal(ecA.pagado, 50000);
  assert.equal(ecA.saldo, 50000);
  assert.deepEqual(ecA.pagos.map((p) => p.id), [1, 2]);

  assert.equal(ecB.aliadoB2bId, 102);
  assert.equal(ecB.total, 50000);
  assert.equal(ecB.pagado, 50000);
  assert.equal(ecB.saldo, 0);
  assert.deepEqual(ecB.pagos.map((p) => p.id), [3]);

  // Nunca se mezclan: el abono de uno no aparece en el historial del otro.
  assert.ok(!ecB.pagos.some((p) => p.id === 1 || p.id === 2), "el historial de B no debe traer abonos de A");
  assert.ok(!ecA.pagos.some((p) => p.id === 3), "el historial de A no debe traer el abono de B");

  // Sin comisión en ese contrato: el estado de cuenta también se rechaza (misma vía que la cuenta de cobro).
  assert.equal(await estadoDeCuenta("u-C", "MULTI-1", t), null);
});
