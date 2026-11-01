// Se ejecuta con npm run test:react (loader del arnés).
//
// #65 — Participación por comisión: solo una fila de aliados_b2b con comisión ECONÓMICA real da visibilidad.
// La definición es la del cálculo del portal (`calcularComisionFila(...).totalPagar > 0`), no una regla aparte.
//
// CORRECCIÓN: una versión anterior de esta prueba trataba la fila de Javier en MIN-00-0519 como una fila en CERO. Es falso:
// el resultado real de la auditoría muestra la fila 137 con $139.000 y un abono. Aquí se reproduce el importe positivo real.
// Los COMPONENTES exactos de esos $139.000 salen del script de auditoría; la prueba usa dos descomposiciones equivalentes
// (solo recobro / solo comisión base) y el resultado no depende de cuál sea.
//
// Esta prueba FIJA el comportamiento ACTUAL del portal (no lo cambia): una fila positiva con la ficha del aliado da
// participación, incluso cuando el beneficiario es una persona de doble rol (Javier). Qué filas son comisión B2B y cuáles
// segunda comisión interna lo decide el dueño (docs/tecnico/comisiones-aliado-vs-interna-65.md); hasta entonces no se toca.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { contratosPorParticipacion } = await import("../lib/auth/participacionComisionB2B.ts");
const { cargarConjuntoPortal } = await import("../lib/portal/b2bPortalServidor.ts");
const { calcularComisionFila } = await import("../lib/finanzas/comisionB2B.ts");
const { default: PortalVentas } = await import("../app/portal/b2b/ventas/page.tsx");
const { default: PortalCartera } = await import("../app/portal/b2b/cartera/page.tsx");
const { default: PortalDocumentos } = await import("../app/portal/b2b/documentos/page.tsx");
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
const fila = (id: number, numero: string, aliadoId: number | null, extra: Fila = {}): Fila => ({
  id, numero_contrato: numero, tenant: "minorista", aliado: `Aliado ${aliadoId}`, tipo_aliado: "freelance", aliado_id: aliadoId,
  precio_venta: 2_000_000, base_comision: 0, base_explicita: false, comision_valor: null, pct_comision: 0,
  recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false, ...extra,
});
const BASE = { base_comision: 1_000_000, base_explicita: true };
/** $139.000 por la vía del recobro (278.000 × 50 %), con base y % en cero: la fila es positiva SOLO por el recobro. */
const IMPORTE_139_RECOBRO = { recobro_total: 278_000, pct_recobro_aliado: 0.5 };
/** $139.000 por la vía de la comisión base (1.390.000 × 10 %). */
const IMPORTE_139_BASE = { base_comision: 1_390_000, base_explicita: true, pct_comision: 0.1 };

const usuario = (id: string, nombre: string, rol: string, aliadoId: number | null): Fila =>
  ({ id, nombre, rol, activo: true, tenant: "minorista", agencia_id: null, pct_comision: null, aliado_id: aliadoId, acceso_legacy_nombre: false });

/** Los tres casos reales de la auditoría + una venta de control + una fila genuinamente en cero (sintética, otro número). */
function tablas(importe0519: Fila = IMPORTE_139_RECOBRO): Record<string, Fila[]> {
  return {
    usuarios: [usuario("u-yaq", "Yaqueline", "freelance", 37), usuario("u-jav", "Javier", "freelance", 8), usuario("u-ter", "Tercero", "agencia", 9)],
    aliados: [{ id: 37, nombre: "Yaqueline", nit: "37" }, { id: 8, nombre: "JAVIER A VIEIRA P", nit: "8" }, { id: 9, nombre: "Tercero", nit: "9" }],
    ventas: [
      venta("MIN-00-0476", 9),                        // de un tercero; Javier con DOS filas (100 y 101)
      venta("MIN-00-0498", 8),                        // de Javier; fila 1 sin ficha «JAVIER VIEIRA» y fila 121 con ficha 8
      venta("MIN-00-0519", 37),                       // de Yaqueline; Javier con la fila 137 de $139.000 y un abono
      venta("MIN-X-CERO", 9),                         // SINTÉTICA: una fila genuinamente en cero
    ],
    aliados_b2b: [
      fila(100, "MIN-00-0476", 8, { aliado: "JAVIER A VIEIRA P", ...BASE, pct_comision: 0.05 }),
      fila(101, "MIN-00-0476", 8, { aliado: "JAVIER A VIEIRA P", recobro_total: 100_000, pct_recobro_aliado: 0.5 }),
      fila(1, "MIN-00-0498", null, { aliado: "JAVIER VIEIRA", ...BASE, pct_comision: 0.04 }),
      fila(121, "MIN-00-0498", 8, { aliado: "JAVIER A VIEIRA P", ...BASE, pct_comision: 0.03 }),
      fila(135, "MIN-00-0519", 37, { aliado: "Yaqueline", ...BASE, pct_comision: 0.1 }),
      fila(137, "MIN-00-0519", 8, { aliado: "JAVIER A VIEIRA P", ...importe0519 }),
      fila(900, "MIN-X-CERO", 8),                     // base 0, pct 0, valor null, sin recobro → total 0
    ],
    comision_b2b_pagos: [{ id: 1, aliado_b2b_id: 137, valor: 39_000, fecha: "2026-10-05" }],
  };
}
const ctx = (userId: string, aliadoId: number, rol: "agencia" | "freelance" = "freelance") => ({
  estado: "ok" as const, userId, email: `${userId}@t.test`, nombre: userId, rol, tenant: "minorista",
  aliadoId, accesoLegacyNombre: false, agenciaId: null, pctPerfil: null, esTitularAgencia: false,
});
const montar = (t: Record<string, Fila[]>, sesion = "u") => { __setAdmin(supabaseEnMemoria(t)); __setClient(supabaseEnMemoria(t, {}, sesion)); };
const nums = (c: { ventas: { numero_contrato: string; relacion: string }[] }, rel: string) => c.ventas.filter((v) => v.relacion === rel).map((v) => v.numero_contrato).sort();
const texto = (n: unknown): string => {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(texto).join(" ");
  return texto((n as { props?: { children?: unknown } }).props?.children);
};
const hrefs = (n: unknown, out: string[] = []): string[] => {
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) { n.forEach((h) => hrefs(h, out)); return out; }
  const p = (n as { props?: { href?: string; children?: unknown } }).props;
  if (typeof p?.href === "string") out.push(p.href);
  return hrefs(p?.children, out);
};
const pantalla = async (t: Record<string, Fila[]>, sesion: string, pagina: () => Promise<unknown>) => { montar(t, sesion); return texto(await pagina()).replace(/\s+/g, " "); };

for (const [nombre, importe] of [["solo recobro", IMPORTE_139_RECOBRO], ["solo comisión base", IMPORTE_139_BASE]] as const) {
  test(`MIN-00-0519 (fila 137 = $139.000, ${nombre}, con un abono): la fila es POSITIVA; con el código actual Javier SÍ la ve como participación`, async () => {
    const t = tablas(importe);
    assert.equal(calcularComisionFila(t.aliados_b2b.find((f) => f.id === 137) as never).totalPagar, 139_000);
    montar(t, "u-jav");
    const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
    assert.ok(nums(jav, "participacion").includes("MIN-00-0519"), "Javier la ve como participación");
    assert.ok(!nums(jav, "propio").includes("MIN-00-0519"), "pero NO como contrato propio");
    // Su importe es el SALDO de SU fila: 139.000 − 39.000 de abono (la fila de Yaqueline no se mezcla).
    const com = jav.comisiones.get("MIN-00-0519");
    assert.equal(com?.importe, 100_000);
    assert.equal(com?.estado, "parcial");
    assert.deepEqual(com?.ids, [137]);
    // Yaqueline conserva su contrato propio; la fila de Javier no le da nada más.
    montar(t, "u-yaq");
    const yaq = await cargarConjuntoPortal(ctx("u-yaq", 37) as never);
    assert.deepEqual(nums(yaq, "propio"), ["MIN-00-0519"]);
    assert.deepEqual(nums(yaq, "participacion"), []);
  });
}

test("MIN-00-0519, lo que Javier alcanza a VER en pantalla: contrato, destino, estado y su comisión; NO cliente, cartera, documentos ni cuenta de cobro", async () => {
  const t = tablas();
  montar(t, "u-jav");
  const enlaces = hrefs(await PortalVentas({ searchParams: Promise.resolve({ vista: "asistidas" }) }));
  assert.ok(!enlaces.some((h) => /0519/.test(h)), "ningún enlace (cuenta de cobro, estado de cuenta, documentos) lleva a MIN-00-0519");
  const ventas = await pantalla(t, "u-jav", () => PortalVentas({ searchParams: Promise.resolve({ vista: "asistidas" }) }));
  assert.ok(ventas.includes("0519"), "aparece en Mis ventas");
  assert.match(ventas, /Participación por comisión/);
  assert.ok(!ventas.includes("Cliente MIN-00-0519"), "sin nombre del cliente");
  assert.match(ventas, /100\.000/, "su comisión (saldo)");
  assert.match(ventas, /Abono parcial/);
  const cartera = await pantalla(t, "u-jav", () => PortalCartera({ searchParams: Promise.resolve({}) }));
  const docs = await pantalla(t, "u-jav", () => PortalDocumentos());
  for (const s of [cartera, docs]) assert.ok(!s.includes("0519") && !s.includes("0476"), "cartera y documentos solo de contratos propios");
});

test("MIN-00-0519 en el INICIO de Javier: aparece como «Solo comisión» y sin nombre de cliente", async () => {
  const { default: PortalInicio } = await import("../app/portal/b2b/page.tsx");
  const t = tablas({ ...IMPORTE_139_RECOBRO });
  const inicio = await pantalla(t, "u-jav", () => PortalInicio({ searchParams: Promise.resolve({ contratos: "asistidas" }) }));
  assert.ok(inicio.includes("0519"));
  assert.match(inicio, /Participación por comisión/);
  assert.match(inicio, /Solo comisión/);
  assert.ok(!inicio.includes("Cliente MIN-00-0519"));
});

test("los tres casos reales para Javier: 0476 y 0519 son participación (ajenos), 0498 es propio; cada fila positiva suma en SU importe", async () => {
  const t = tablas(); montar(t, "u-jav");
  const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  assert.deepEqual(nums(jav, "participacion"), ["MIN-00-0476", "MIN-00-0519"]);
  assert.deepEqual(nums(jav, "propio"), ["MIN-00-0498"]);
  // 0476: las dos filas son suyas (misma ficha) y el portal las SUMA: 50.000 + 50.000.
  assert.equal(jav.comisiones.get("MIN-00-0476")?.importe, 100_000);
  assert.deepEqual(jav.comisiones.get("MIN-00-0476")?.ids, [100, 101]);
  // 0498: la fila 121 (ficha 8) es suya; la fila 1 «JAVIER VIEIRA» no tiene ficha ni documento que la ligue → NO se suma sola por nombre.
  assert.deepEqual(jav.comisiones.get("MIN-00-0498")?.ids, [121]);
  assert.equal(jav.comisiones.get("MIN-00-0498")?.importe, 30_000);
});

test("una fila genuinamente en CERO (sintética) no da participación; las positivas con ficha sí", async () => {
  const t = tablas(); montar(t, "u-jav");
  const jav = await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  assert.ok(!jav.ventas.some((v) => v.numero_contrato === "MIN-X-CERO"));
  assert.ok(nums(jav, "participacion").length > 0);
});

test("misma definición económica que el cálculo del portal: una fila cuenta si y solo si calcularComisionFila().totalPagar > 0", async () => {
  const t = tablas();
  for (const f of t.aliados_b2b.filter((x) => x.aliado_id != null)) {
    const r = await contratosPorParticipacion(supabaseEnMemoria(t) as never, f.aliado_id as number, "numero_contrato", new Set());
    const visible = r.filas.some((x) => x.numero_contrato === f.numero_contrato);
    const hayPositivaSuya = t.aliados_b2b.some((g) => g.aliado_id === f.aliado_id && g.numero_contrato === f.numero_contrato && calcularComisionFila(g as never).totalPagar > 0);
    assert.equal(visible, hayPositivaSuya, `fila ${f.id}`);
  }
});

test("lecturas fallidas: sin comisión legible o sin ventas legibles no se muestra participación y se avisa (fail-closed)", async () => {
  for (const tabla of ["aliados_b2b", "ventas"]) {
    for (const fallo of ["error", "sin_conteo"] as const) {
      const db = supabaseEnMemoria(tablas(), { fallar: (c: { tabla: string }) => (c.tabla === tabla ? fallo : null) });
      assert.deepEqual(await contratosPorParticipacion(db as never, 8, "numero_contrato", new Set()), { filas: [], completa: false }, `${tabla}/${fallo}`);
    }
  }
});

test("no modifica filas, importes ni abonos: las tablas quedan idénticas tras leer", async () => {
  const t = tablas(); const antes = JSON.parse(JSON.stringify(t));
  montar(t, "u-jav");
  await cargarConjuntoPortal(ctx("u-jav", 8) as never);
  await contratosPorParticipacion(supabaseEnMemoria(t) as never, 8, "numero_contrato, aliado_id", new Set());
  assert.deepEqual(t, antes);
});

test("cada aliado conserva SOLO su acceso: la participación de otro no se filtra y Yaqueline/Tercero no ven las filas de Javier", async () => {
  const t = tablas();
  montar(t, "u-yaq");
  assert.deepEqual(nums(await cargarConjuntoPortal(ctx("u-yaq", 37) as never), "participacion"), [], "Yaqueline: sin participaciones");
  montar(t, "u-ter");
  const ter = await cargarConjuntoPortal(ctx("u-ter", 9, "agencia") as never);
  assert.deepEqual(nums(ter, "propio"), ["MIN-00-0476", "MIN-X-CERO"]);
  assert.deepEqual(nums(ter, "participacion"), [], "el tercero no cobra comisión en ninguno de los tres casos");
  assert.equal(ter.comisiones.get("MIN-00-0476")?.importe ?? null, null, "no ve el importe de las filas de Javier");
});
