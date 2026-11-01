import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  origenVenta, carteraDe, partirCartera, resumenInicio, documentosDe, estadoCotizacion, sumarPorMoneda, comparativaComoCotizacion, clasificarComparativas,
  type VentaPortal, type AbonoPortal,
} from "../lib/portal/b2bPortal.ts";
import { contratosPorParticipacion } from "../lib/auth/participacionComisionB2B.ts";
import { contratosDelPortalB2B, consultasPortalSupabase, COLUMNAS_DECISION, type PerfilPortal } from "../lib/auth/contratosPortalB2B.ts";
import { supabaseEnMemoria, type Fila } from "./support/memoriaSupabase.ts";

// ── Clasificación: directa / asistida, propio / participación ───────────────
const v = (n: string, extra: Partial<VentaPortal> = {}): VentaPortal => ({
  numero_contrato: n, tenant: "mayorista", relacion: "propio", precio_venta: 1000, moneda: "COP", fecha_salida: "2026-11-10", ...extra,
});

test("directa = la generó el propio aliado; todo lo demás (interno, Minorista, participación) es asistida", () => {
  assert.equal(origenVenta(v("a", { b2b_usuario_id: "u1" }), "u1"), "directa");
  assert.equal(origenVenta(v("b", { b2b_usuario_id: "otro" }), "u1"), "asistida");
  assert.equal(origenVenta(v("c", { b2b_usuario_id: null, tenant: "minorista" }), "u1"), "asistida");
  // Una participación jamás es directa, ni aunque el b2b_usuario_id coincidiera.
  assert.equal(origenVenta(v("d", { relacion: "participacion", b2b_usuario_id: "u1" }), "u1"), "asistida");
});

// ── Cartera: solo contratos propios, moneda de cobro, Con saldo / Pagos ─────
const ab = (id: number, n: string, valor: number): AbonoPortal => ({ id, numero_contrato: n, fecha_abono: "2026-10-01", valor_abono: valor, forma_pago: "Transferencia" });

test("cartera: participación queda fuera; saldo en la moneda de cobro; Con saldo y Pagos se parten bien", () => {
  const ventas = [
    v("P1", { precio_venta: 1000 }),
    v("P2", { precio_venta: 500 }),
    v("U1", { moneda: "USD", precio_venta: 100, moneda_cobro: "COP", trm_cobro: 4000, total_cobro: 400000 }),
    v("X1", { relacion: "participacion", precio_venta: 9999 }),
  ];
  const abonos = [ab(1, "P1", 400), ab(2, "P2", 500), ab(3, "X1", 50), ab(4, "U1", 100000)];
  const c = carteraDe(ventas, abonos);
  assert.deepEqual(c.map((f) => f.numero_contrato), ["P1", "P2", "U1"]);
  const u1 = c.find((f) => f.numero_contrato === "U1")!;
  assert.equal(u1.moneda, "COP");
  assert.equal(u1.saldo, 300000);
  const { conSaldo, pagos } = partirCartera(c, abonos);
  assert.deepEqual(conSaldo.map((f) => f.numero_contrato), ["P1", "U1"]);
  assert.deepEqual(pagos.map((f) => f.numero_contrato).sort(), ["P1", "P2", "U1"]);
});

test("las monedas nunca se mezclan en un total", () => {
  assert.deepEqual(sumarPorMoneda([{ moneda: "COP", monto: 5 }, { moneda: "USD", monto: 2 }, { moneda: "COP", monto: 1 }]), { COP: 6, USD: 2 });
});

// ── Inicio y pestañas cuentan los MISMOS registros ──────────────────────────
test("indicadores del inicio: salen del mismo conjunto que las pestañas", () => {
  const ventas = [v("P1", { fecha_salida: "2026-11-05" }), v("P2", { fecha_salida: "2027-03-01" }), v("X1", { relacion: "participacion", fecha_salida: "2026-11-02" })];
  const abonos = [ab(1, "P1", 400)];
  const cartera = carteraDe(ventas, abonos);
  const r = resumenInicio({
    ventas, cartera, hoy: "2026-10-28",
    cotizaciones: [
      { id: 1, estado: "enviada", vigencia_hasta: "2026-11-30", fecha_salida: "2026-12-20" },
      { id: 2, estado: "enviada", vigencia_hasta: "2026-10-01", fecha_salida: "2026-12-20" },
      { id: 3, estado: "convertida", numero_contrato: "P1" },
    ],
    comisiones: [{ moneda: "COP", monto: 50 }],
  });
  assert.equal(r.cotizacionesVigentes, 1);
  assert.equal(r.ventasPropias, 2);
  assert.equal(r.ventasParticipacion, 1);
  assert.equal(r.contratosConSaldo, 2);
  assert.deepEqual(r.saldoPorMoneda, { COP: 600 + 1000 });
  // La salida de una participación no cuenta como «tuya».
  assert.equal(r.salidasProximas, 1);
  assert.equal(estadoCotizacion({ id: 3, estado: "convertida", numero_contrato: "P1" }, "2026-10-28"), "convertida");
});

// ── Documentos: solo propios y solo lo que existe ───────────────────────────
test("documentos: participación sin fila; sin token / sin contenido / sin abonos → vacío, nunca un enlace ficticio", () => {
  const ventas = [v("P1", { share_token: "tok-p1" }), v("P2", { share_token: null }), v("X1", { relacion: "participacion", share_token: "tok-x1" })];
  const vouchers = [
    { numero_contrato: "P1", tipo: "hotel", share_token: "vt1", contenido: true },
    { numero_contrato: "P1", tipo: "traslados", share_token: null, contenido: true },
    { numero_contrato: "P1", tipo: "asistencia", share_token: "vt3", contenido: null },
    { numero_contrato: "X1", tipo: "hotel", share_token: "vt-x", contenido: true },
  ];
  const d = documentosDe(ventas, vouchers, [ab(7, "P1", 10), ab(8, "X1", 10)]);
  assert.deepEqual(d.map((x) => x.numero_contrato), ["P1", "P2"]);
  assert.equal(d[0].contratoToken, "tok-p1");
  assert.deepEqual(d[0].vouchers, [{ token: "vt1", tipo: "hotel" }]);
  assert.deepEqual(d[0].recibos.map((r) => r.id), [7]);
  assert.equal(d[1].contratoToken, null);
  assert.deepEqual(d[1].vouchers, []);
  assert.deepEqual(d[1].recibos, []);
});

// ── Participación por comisión (lectura real contra PostgREST en memoria) ───
const VENTAS: Fila[] = [
  { numero_contrato: "C1-propio", aliado_id: 7, tenant: "mayorista" },
  { numero_contrato: "C2-historico", aliado_id: null, tenant: "minorista" },
  { numero_contrato: "C3-dos-aliados", aliado_id: 9, tenant: "minorista" },
  { numero_contrato: "C4-ajeno", aliado_id: 9, tenant: "minorista" },
];
// Comisión económica real (la participación exige `calcularComisionFila(...).totalPagar > 0`).
const PAGA = { precio_venta: 1_000_000, base_comision: 1_000_000, base_explicita: true, pct_comision: 0.1 };
const COMISIONES: Fila[] = [
  { id: 1, numero_contrato: "C1-propio", aliado_id: 7, ...PAGA },
  { id: 2, numero_contrato: "C2-historico", aliado_id: 7, ...PAGA },
  { id: 3, numero_contrato: "C3-dos-aliados", aliado_id: 7, ...PAGA },
  { id: 4, numero_contrato: "C3-dos-aliados", aliado_id: 9, ...PAGA },
  { id: 5, numero_contrato: "C4-ajeno", aliado_id: 9, ...PAGA },
  { id: 6, numero_contrato: "C2-historico", aliado_id: null, ...PAGA },
];

test("participación: contratos donde cobra comisión por ficha, sin los propios, sin los de otro aliado y sin tocar ventas", async () => {
  const db = supabaseEnMemoria({ ventas: VENTAS, aliados_b2b: COMISIONES });
  const r = await contratosPorParticipacion(db as never, 7, "numero_contrato, tenant, aliado_id", new Set(["C1-propio"]));
  assert.equal(r.completa, true);
  assert.deepEqual(r.filas.map((f) => f.numero_contrato).sort(), ["C2-historico", "C3-dos-aliados"]);
  // El vínculo singular de ventas queda intacto: la comisión no lo reescribe ni lo asigna.
  assert.equal(VENTAS.find((x) => x.numero_contrato === "C2-historico")!.aliado_id, null);
  assert.equal(VENTAS.find((x) => x.numero_contrato === "C3-dos-aliados")!.aliado_id, 9);
});

test("participación: sin ficha no se busca nada, y una lectura con error es fail-closed (nada + completa:false)", async () => {
  const db = supabaseEnMemoria({ ventas: VENTAS, aliados_b2b: COMISIONES });
  assert.deepEqual(await contratosPorParticipacion(db as never, null, "numero_contrato", new Set()), { filas: [], completa: true });
  assert.equal(db.llamadas.aliados_b2b ?? 0, 0);
  const roto = supabaseEnMemoria({ ventas: VENTAS, aliados_b2b: COMISIONES }, { fallar: (c) => (c.tabla === "aliados_b2b" ? "error" : null) });
  assert.deepEqual(await contratosPorParticipacion(roto as never, 7, "numero_contrato", new Set()), { filas: [], completa: false });
  const roto2 = supabaseEnMemoria({ ventas: VENTAS, aliados_b2b: COMISIONES }, { fallar: (c) => (c.tabla === "ventas" ? "sin_conteo" : null) });
  assert.deepEqual(await contratosPorParticipacion(roto2 as never, 7, "numero_contrato", new Set()), { filas: [], completa: false });
});

// ── Cableado: lo que ninguna prueba de comportamiento vigila ────────────────
const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("inicio: Tarifario es la llamada principal (un solo enlace) y no queda «Cotizar / comprar»", () => {
  const inicio = leer("app/portal/b2b/page.tsx");
  assert.equal((inicio.match(/href="\/tarifario"/g) ?? []).length, 1);
  assert.doesNotMatch(inicio, /Cotizar \/ comprar/);
  assert.doesNotMatch(leer("components/portal/PortalShell.tsx"), /tarifario/i);
});

test("el carrusel está marcado como demostración y no inventa precios", () => {
  const c = leer("components/portal/PlanesRecomendados.tsx");
  assert.match(c, /Demostración/);
  assert.doesNotMatch(c, /\$\s?\d|COP|USD/);
});

test("los archivos nuevos no deciden pertenencia por nombre ni escriben vínculos en ventas", () => {
  for (const f of ["lib/portal/b2bPortalServidor.ts", "lib/portal/b2bPortal.ts", "lib/auth/participacionComisionB2B.ts"]) {
    const s = leer(f);
    assert.doesNotMatch(s, /agencia_nombre|freelance_nombre|ilike/, f);
    assert.doesNotMatch(s, /\.(update|upsert|insert|delete)\(/, f);
  }
  for (const f of ["ventas", "cartera", "documentos", "cotizaciones"]) {
    assert.match(leer(`app/portal/b2b/${f}/page.tsx`), /resolverContextoPortal/, f);
  }
});

test("Documentos y Cartera solo trabajan con contratos propios; la participación se filtra en la lógica pura", () => {
  const s = leer("lib/portal/b2bPortal.ts");
  assert.equal((s.match(/relacion === "propio"/g) ?? []).length >= 3, true);
});

// ── Comparativas: misma regla de estado y mismo conjunto que la pestaña ─────
test("indicador «Cotizaciones vigentes» cuenta comparativas vigentes con la MISMA regla; elegida/vencida/salida pasada no cuentan", () => {
  const base = { hija: null, estado: "abierta", fecha_salida: "2026-12-20", vigencia_hasta: "2026-11-30" };
  const comps = [
    { id: 1, ...base },                                                                           // vigente
    { id: 2, ...base, vigencia_hasta: "2026-10-01" },                                             // vencida
    { id: 3, ...base, fecha_salida: "2026-10-01" },                                               // salida pasada
    { id: 4, ...base, hija: { codigo: "COT-9", estado: "abierta", numero_contrato: null } },      // ya eligió una opción
  ].map(comparativaComoCotizacion);
  const r = resumenInicio({ ventas: [], cartera: [], cotizaciones: comps, comisiones: [], hoy: "2026-10-28" });
  assert.equal(r.cotizacionesVigentes, 1);
  assert.equal(estadoCotizacion(comps[3], "2026-10-28"), "elegida");
});

test("clasificarComparativas: solo IDs verificados; sin procedencia comprobable no se muestra ni se adivina", () => {
  const filas = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
  const meta = new Map([
    [1, { propietario_id: "yo", aliado_id: 7 }],        // la creé yo (aunque tenga mi ficha) → directa
    [2, { propietario_id: "interno", aliado_id: 7 }],   // asignada a mi ficha → asistida
    [3, { propietario_id: "interno", aliado_id: 8 }],   // de otro aliado → fuera
    [4, { propietario_id: null, aliado_id: null }],     // sin dueño verificable → fuera
  ]);                                                    // 5: sin meta → fuera
  const r = clasificarComparativas(filas, meta, "yo", 7);
  assert.deepEqual(r.directas.map((c) => c.id), [1]);
  assert.deepEqual(r.asistidas.map((c) => c.id), [2]);
  assert.equal(r.sinVerificar, 3);
  // Sin ficha enlazada, nada se atribuye a una ficha.
  assert.deepEqual(clasificarComparativas(filas, meta, "yo", null).asistidas, []);
});

// ── Contratos propios: lecturas COMPLETAS o declaradas incompletas ──────────
const PERFIL: PerfilPortal = { id: "u-yo", rol: "freelance", tenant: "mayorista", activo: true, nombre: "Yo", aliadoId: 7, accesoLegacyNombre: false };
const vta = (n: string, extra: Fila = {}): Fila => ({ numero_contrato: n, tenant: "mayorista", aliado_id: null, b2b_usuario_id: null, agencia_nombre: null, freelance_nombre: null, fecha_salida: "2026-12-01", ...extra });
async function propios(ventas: Fila[], opts = {}) {
  const db = supabaseEnMemoria({ ventas, aliados_b2b: [] }, opts);
  return contratosDelPortalB2B(PERFIL, consultasPortalSupabase(db as never, COLUMNAS_DECISION));
}

test("CONTRATOS: más de una página (tope de 1.000 filas) en cada consulta por id: se leen todos y no se avisa", async () => {
  const ventas = [
    ...Array.from({ length: 1500 }, (_, i) => vta(`U-${String(i).padStart(5, "0")}`, { b2b_usuario_id: "u-yo" })),
    ...Array.from({ length: 1300 }, (_, i) => vta(`A-${String(i).padStart(5, "0")}`, { aliado_id: 7, tenant: i % 2 ? "minorista" : "mayorista" })),
    vta("OTRO-1", { b2b_usuario_id: "u-otro" }), vta("OTRO-2", { aliado_id: 8 }),
  ];
  const r = await propios(ventas, { maxFilas: 1000 });
  assert.equal(r.contratos.length, 2800);
  assert.equal(r.incompleto, false);
  assert.ok(!r.contratos.some((c) => c.numero_contrato.startsWith("OTRO")), "nada de otro aliado ni de otro usuario");
  assert.ok(r.contratos.some((c) => c.tenant === "minorista"), "la ficha cruza tenants por id");
});

for (const [consulta, llamada] of [["porB2bUsuario", 1], ["porAliadoId", 2]] as const) {
  for (const fallo of ["error", "sin_conteo", "conteo_cambia", "vacia", "lanzar"] as const) {
    test(`CONTRATOS: ${consulta} con «${fallo}» → incompleto=true, sin filas parciales de esa lectura; la otra sigue`, async () => {
      const ventas = [vta("U-1", { b2b_usuario_id: "u-yo" }), vta("A-1", { aliado_id: 7 })];
      const r = await propios(ventas, { fallar: (c: { tabla: string; llamada: number }) => (c.tabla === "ventas" && c.llamada === llamada ? fallo : null) });
      assert.equal(r.incompleto, true);
      assert.deepEqual(r.contratos.map((c) => c.numero_contrato), consulta === "porB2bUsuario" ? ["A-1"] : ["U-1"]);
    });
  }
}

test("CONTRATOS: una fila ajena colada por una consulta que se declara completa NO se lista — accesoDocumentoContrato decide", async () => {
  const q = {
    porB2bUsuario: async () => ({ completa: true, filas: [vta("U-1", { b2b_usuario_id: "u-yo" }), vta("AJENO", { b2b_usuario_id: "u-otro" })] }),
    porAliadoId: async () => ({ completa: true, filas: [vta("A-1", { aliado_id: 7 }), vta("A-OTRO", { aliado_id: 8 })] }),
    porNombreSinIds: async () => ({ completa: true, filas: [] }),
    verificarFichas: async () => ({ completa: true, conFicha: new Set<string>() }),
  };
  const r = await contratosDelPortalB2B(PERFIL, q as never);
  assert.deepEqual(r.contratos.map((c) => c.numero_contrato).sort(), ["A-1", "U-1"]);
  assert.equal(r.incompleto, false);
});

test("CONTRATOS: una respuesta con filas de más que el conteo (fila ajena inyectada) es lectura incompleta, no se usa", async () => {
  const r = await propios([vta("U-1", { b2b_usuario_id: "u-yo" })], { fallar: (c: { tabla: string; llamada: number }) => (c.tabla === "ventas" && c.llamada === 1 ? "fila_ajena" : null) });
  assert.equal(r.incompleto, true);
  assert.deepEqual(r.contratos, []);
});

test("las cuatro vistas muestran el aviso cuando el histórico quedó incompleto", () => {
  for (const f of ["page", "ventas/page", "cartera/page", "documentos/page"]) {
    const s = leer(f === "page" ? "app/portal/b2b/page.tsx" : `app/portal/b2b/${f}.tsx`);
    assert.match(s, /conjunto\.historicoIncompleto && <AvisoHistoricoIncompleto \/>/, f);
  }
});
