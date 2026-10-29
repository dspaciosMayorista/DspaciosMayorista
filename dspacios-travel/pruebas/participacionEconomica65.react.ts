// Se ejecuta con npm run test:react (loader del arnés).
//
// #65 — Participación por comisión: solo una fila de aliados_b2b con comisión ECONÓMICA real da visibilidad.
// La definición es la del cálculo del portal (`calcularComisionFila(...).totalPagar > 0`), no una regla aparte.
// Caso real: MIN-00-0519 — ventas.aliado_id = 37 (Yaqueline); fila de Javier (aliado_id 8) con base 0, pct 0, valor null.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { contratosPorParticipacion } = await import("../lib/auth/participacionComisionB2B.ts");
const { cargarConjuntoPortal } = await import("../lib/portal/b2bPortalServidor.ts");
const { calcularComisionFila } = await import("../lib/finanzas/comisionB2B.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); __resetAdmin(); });

const venta = (numero: string, aliadoId: number | null, extra: Fila = {}): Fila => ({
  numero_contrato: numero, tenant: "minorista", cliente: `Cliente ${numero}`, destino: "SMR", fecha_salida: "2026-12-01",
  estado: "confirmado", precio_venta: 2_000_000, moneda: "COP", b2b_usuario_id: null, aliado_id: aliadoId,
  agencia_nombre: null, freelance_nombre: null, tipo_asesor: "freelance", modo_compra: "comisionable", comision_b2b: null, comision_estado: null, ...extra,
});
const fila = (id: number, numero: string, aliadoId: number, extra: Fila = {}): Fila => ({
  id, numero_contrato: numero, tenant: "minorista", aliado: `Aliado ${aliadoId}`, tipo_aliado: "freelance", aliado_id: aliadoId,
  precio_venta: 2_000_000, base_comision: 0, base_explicita: false, comision_valor: null, pct_comision: 0,
  recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false, ...extra,
});

const tablas = (): Record<string, Fila[]> => ({
  usuarios: [
    { id: "u-yaq", nombre: "Yaqueline", rol: "freelance", activo: true, tenant: "minorista", agencia_id: null, pct_comision: null, aliado_id: 37, acceso_legacy_nombre: false },
    { id: "u-jav", nombre: "Javier", rol: "freelance", activo: true, tenant: "minorista", agencia_id: null, pct_comision: null, aliado_id: 8, acceso_legacy_nombre: false },
  ],
  aliados: [{ id: 37, nombre: "Yaqueline", nit: "37" }, { id: 8, nombre: "Javier", nit: "8" }, { id: 9, nombre: "Tercero", nit: "9" }],
  ventas: [
    venta("MIN-00-0519", 37),                // de Yaqueline; fila de Javier en CERO
    venta("MIN-00-0600", 9),                 // de un tercero; Javier y Yaqueline cobran comisión positiva (dos aliados)
    venta("MIN-00-0601", 9),                 // de un tercero; fila de Javier con valor fijo positivo (pct 0)
    venta("MIN-00-0602", 9),                 // de un tercero; fila de Javier en cero + otra fila suya positiva
    venta("MIN-00-0603", 9),                 // de un tercero; solo recobro para el aliado
  ],
  aliados_b2b: [
    fila(1, "MIN-00-0519", 8),                                                    // Javier: base 0, pct 0, valor null
    fila(2, "MIN-00-0600", 8, { base_comision: 1_000_000, base_explicita: true, pct_comision: 0.1 }),
    fila(3, "MIN-00-0600", 37, { base_comision: 1_000_000, base_explicita: true, pct_comision: 0.05 }),
    fila(4, "MIN-00-0601", 8, { comision_valor: 120_000 }),
    fila(5, "MIN-00-0602", 8),
    fila(6, "MIN-00-0602", 8, { base_comision: 500_000, base_explicita: true, pct_comision: 0.08 }),
    fila(7, "MIN-00-0603", 8, { recobro_total: 100_000, pct_recobro_aliado: 0.5 }),
  ],
});
const ctx = (userId: string, aliadoId: number) => ({
  estado: "ok" as const, userId, email: `${userId}@t.test`, nombre: userId === "u-yaq" ? "Yaqueline" : "Javier", rol: "freelance" as const, tenant: "minorista",
  aliadoId, accesoLegacyNombre: false, agenciaId: null, pctPerfil: null, esTitularAgencia: false,
});
const montar = (t: Record<string, Fila[]>) => { __setAdmin(supabaseEnMemoria(t)); __setClient(supabaseEnMemoria(t, {}, "u")); };
const nums = (c: { ventas: { numero_contrato: string; relacion: string }[] }, rel: string) => c.ventas.filter((v) => v.relacion === rel).map((v) => v.numero_contrato).sort();

test("MIN-00-0519: Javier NO la ve como participación; Yaqueline conserva su contrato propio", async () => {
  const t = tablas(); montar(t);
  const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  assert.ok(!jav.ventas.some((v) => v.numero_contrato === "MIN-00-0519"), "ni propio ni participación");
  assert.equal(jav.comisiones.get("MIN-00-0519") ?? null, null, "sin importe de comisión en ese contrato");
  montar(t);
  const yaq = await cargarConjuntoPortal(ctx("u-yaq", 37) as never);
  const suyo = yaq.ventas.find((v) => v.numero_contrato === "MIN-00-0519");
  assert.equal(suyo?.relacion, "propio");
  assert.equal(suyo?.cliente, "Cliente MIN-00-0519");
});

test("las participaciones con comisión positiva se conservan, también con dos aliados cobrando en el mismo contrato", async () => {
  const t = tablas(); montar(t);
  const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  assert.deepEqual(nums(jav, "participacion"), ["MIN-00-0600", "MIN-00-0601", "MIN-00-0602", "MIN-00-0603"]);
  assert.deepEqual(nums(jav, "propio"), [], "participar no da propiedad");
  montar(t);
  const yaq = await cargarConjuntoPortal(ctx("u-yaq", 37) as never);
  assert.deepEqual(nums(yaq, "participacion"), ["MIN-00-0600"], "Yaqueline cobra 5 % en 0600; en el resto no hay fila suya");
  assert.deepEqual(nums(yaq, "propio"), ["MIN-00-0519"]);
});

test("misma definición económica que el cálculo del portal: una fila cuenta si y solo si calcularComisionFila().totalPagar > 0", async () => {
  const t = tablas();
  for (const f of t.aliados_b2b) {
    const r = await contratosPorParticipacion(supabaseEnMemoria(t) as never, f.aliado_id as number, "numero_contrato", new Set());
    const visible = r.filas.some((x) => x.numero_contrato === f.numero_contrato);
    const hayPositivaSuya = t.aliados_b2b.some((g) => g.aliado_id === f.aliado_id && g.numero_contrato === f.numero_contrato && calcularComisionFila(g as never).totalPagar > 0);
    assert.equal(visible, hayPositivaSuya, `fila ${f.id}`);
  }
});

test("lecturas fallidas: sin comisión legible o sin ventas legibles no se muestra participación y se avisa (fail-closed)", async () => {
  for (const tabla of ["aliados_b2b", "ventas"]) {
    for (const fallo of ["error", "sin_conteo"] as const) {
      const t = tablas();
      const db = supabaseEnMemoria(t, { fallar: (c: { tabla: string }) => (c.tabla === tabla ? fallo : null) });
      const r = await contratosPorParticipacion(db as never, 8, "numero_contrato", new Set());
      assert.deepEqual(r, { filas: [], completa: false }, `${tabla}/${fallo}`);
    }
  }
});

test("no modifica filas ni importes: las tablas quedan idénticas tras leer", async () => {
  const t = tablas(); const antes = JSON.parse(JSON.stringify(t));
  montar(t);
  await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  await contratosPorParticipacion(supabaseEnMemoria(t) as never, 8, "numero_contrato, aliado_id", new Set());
  assert.deepEqual(t, antes);
});
