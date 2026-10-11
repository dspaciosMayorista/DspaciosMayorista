// Se ejecuta con npm run test:react (loader del arnés).
//
// #38 · Listado del portal B2B (página REAL) contra una base en memoria: la
// comisión que ve el aliado sale de aliados_b2b —la misma lectura que la
// cuenta de cobro— y no de ventas.comision_b2b. Tras corregir la comisión, el
// listado y la cuenta de cobro a la que enlaza dan el mismo importe nuevo.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { default: PortalB2BPage } = await import("../app/portal/b2b/page.tsx");
const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
const { formatMoneda } = await import("../lib/utils.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); __resetAdmin(); });

const UID = "u-free";
const venta = (numero: string, extra: Fila = {}): Fila => ({
  numero_contrato: numero, tenant: "mayorista", cliente: `Cliente ${numero}`, destino: "SMR", fecha_salida: "2026-11-01",
  estado: "confirmado", precio_venta: 1_000_000, moneda: "COP", b2b_usuario_id: UID, aliado_id: 7,
  agencia_nombre: null, freelance_nombre: "Aliado Siete", tipo_asesor: "freelance",
  modo_compra: "comisionable", comision_b2b: 80_000, comision_estado: "pendiente", ...extra,
});
const comision = (id: number, numero: string, extra: Fila = {}): Fila => ({
  id, numero_contrato: numero, tenant: "mayorista", aliado: "Aliado Siete", tipo_aliado: "freelance", aliado_id: 7,
  precio_venta: 1_000_000, base_comision: 800_000, base_explicita: true, comision_valor: null, pct_comision: 0.1,
  recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente",
  descontada_en_precio: false, ...extra,
});

function tablas(pctCorregido?: number): Record<string, Fila[]> {
  return {
    usuarios: [{ id: UID, nombre: "Freelance Siete", rol: "freelance", activo: true, tenant: "mayorista", agencia_id: null,
      pct_comision: null, aliado_id: 7, acceso_legacy_nombre: false }],
    aliados: [{ id: 7, nombre: "Aliado Siete" }],
    ventas: [
      venta("DTM-0470"),                                               // fila suya (corregible) + fila de un referido
      venta("DTM-0471", { comision_b2b: 50_000 }),                     // reserva anterior SIN fila: vale ventas
      venta("DTM-0472", { comision_b2b: 60_000 }),                     // solo fila de OTRO beneficiario
      venta("DTM-0473", { modo_compra: "neta", comision_b2b: 80_000, comision_estado: "descontada", precio_venta: 920_000 }),
      venta("DTM-0474", { modo_compra: "neta", comision_b2b: 80_000, comision_estado: "descontada", precio_venta: 920_000 }), // NETO + otra fila
    ],
    aliados_b2b: [
      comision(51, "DTM-0470", pctCorregido != null ? { pct_comision: pctCorregido } : {}),
      comision(52, "DTM-0470", { aliado: "Referido Externo", aliado_id: null, pct_comision: 0.05 }),
      comision(53, "DTM-0472", { aliado: "Referido Externo", aliado_id: null }),
      comision(54, "DTM-0473", { estado: "pagada", descontada_en_precio: true }),
      comision(55, "DTM-0474", { estado: "pagada", descontada_en_precio: true }),
      comision(56, "DTM-0474", { pct_comision: 0.05 }), // segunda fila NO descontada, mismo aliado
    ],
    comision_b2b_pagos: [{ id: 1, aliado_b2b_id: 51, valor: 40_000, fecha: "2026-10-01" }],
  };
}

// Recorre el árbol que devuelve la página (sin renderizar componentes) y saca,
// por contrato, el texto de la celda de comisión y si enlaza a la cuenta de cobro.
type Celda = { texto: string; enlace: boolean };
function celdasComision(arbol: unknown): Map<string, Celda> {
  const texto = (n: unknown): string => {
    if (n == null || typeof n === "boolean") return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(texto).join(" ");
    return texto((n as { props?: { children?: unknown } }).props?.children);
  };
  const enlaces = (n: unknown, num: string): boolean => {
    if (!n || typeof n !== "object") return false;
    if (Array.isArray(n)) return n.some((h) => enlaces(h, num));
    const p = (n as { props?: { href?: string; children?: unknown } }).props;
    if (p?.href === `/portal/comision/${encodeURIComponent(num)}`) return true;
    return enlaces(p?.children, num);
  };
  const out = new Map<string, Celda>();
  const visitar = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visitar); return; }
    const el = n as { type?: unknown; key?: string | null; props?: { children?: unknown } };
    if (el.type === "tr" && el.key && /^DTM-/.test(el.key)) {
      const tds = ([] as unknown[]).concat(el.props?.children ?? []).filter((t) => (t as { type?: unknown })?.type === "td");
      const celda = tds[8];
      out.set(el.key, { texto: texto(celda).replace(/\s+/g, " ").trim(), enlace: enlaces(celda, el.key) });
      return;
    }
    visitar(el.props?.children);
  };
  visitar(arbol);
  return out;
}

async function portal(t: Record<string, Fila[]>) {
  __setClient(supabaseEnMemoria(t, {}, UID));
  __setAdmin(supabaseEnMemoria(t));
  return celdasComision(await PortalB2BPage());
}
// formatMoneda separa con espacio duro; el texto de la celda ya viene normalizado.
const cop = (n: number) => formatMoneda(n, "COP").replace(/\s+/g, " ");
const tiene = (s: string, n: number) => s.includes(cop(n));

test("PORTAL: el importe sale de aliados_b2b (solo la fila suya), no de ventas.comision_b2b", async () => {
  const c = await portal(tablas());
  assert.equal(c.size, 5, "lista los cinco contratos");
  assert.ok(tiene(c.get("DTM-0470")!.texto, 80_000), c.get("DTM-0470")!.texto);
  assert.ok(!tiene(c.get("DTM-0470")!.texto, 120_000), "no suma la del referido");
  assert.match(c.get("DTM-0470")!.texto, /Abono parcial/, "estado por sus abonos (131), no ventas.comision_estado");
  assert.equal(c.get("DTM-0470")!.enlace, true);
});

test("PORTAL: corregida la comisión, el listado y la cuenta de cobro enlazada muestran el MISMO importe nuevo", async () => {
  const t = tablas(0.125); // 800.000 × 12,5 % = 100.000 (ventas.comision_b2b sigue en 80.000)
  const c = await portal(t);
  const celda = c.get("DTM-0470")!;
  assert.ok(tiene(celda.texto, 100_000), celda.texto);
  assert.ok(!tiene(celda.texto, 80_000), "ya no muestra el importe viejo de ventas");
  assert.equal(celda.enlace, true, "sigue enlazando a la cuenta de cobro");
  const r = await resolverComisionB2B("DTM-0470");
  assert.equal(r?.tipo, "comision");
  assert.equal(r?.tipo === "comision" && r.detalle.totalPagar, 100_000, "la cuenta de cobro enlazada cobra lo mismo que muestra el listado");
  assert.equal(r?.tipo === "comision" && r.aliadoB2bId, 51);
});

test("PORTAL: sin ninguna fila (reserva anterior) vale ventas.comision_b2b, igual que la cuenta de cobro", async () => {
  const t = tablas();
  const c = await portal(t);
  assert.ok(tiene(c.get("DTM-0471")!.texto, 50_000), c.get("DTM-0471")!.texto);
  assert.equal(c.get("DTM-0471")!.enlace, true);
  const r = await resolverComisionB2B("DTM-0471");
  assert.equal(r?.tipo === "comision" && r.detalle.totalPagar, 50_000);
});

test("PORTAL: con filas que no son suyas no cae a ventas.comision_b2b; ni importe ni enlace, y la cuenta de cobro no abre", async () => {
  const t = tablas();
  const c = await portal(t);
  assert.equal(c.get("DTM-0472")!.texto, "—");
  assert.equal(c.get("DTM-0472")!.enlace, false);
  assert.equal(await resolverComisionB2B("DTM-0472"), null);
});

test("PORTAL: NETO descontada se muestra como descontada, sin cuenta de cobro", async () => {
  const c = await portal(tablas());
  assert.match(c.get("DTM-0473")!.texto, /Descontada/);
  assert.equal(c.get("DTM-0473")!.enlace, false);
});

test("PORTAL: si no se pueden leer las comisiones, no muestra importe (falla cerrado)", async () => {
  const t = tablas();
  __setClient(supabaseEnMemoria(t, {}, UID));
  __setAdmin(supabaseEnMemoria(t, { fallar: (q) => (q.tabla === "aliados_b2b" ? "error" : null) }));
  const c = celdasComision(await PortalB2BPage());
  for (const num of ["DTM-0470", "DTM-0471", "DTM-0472"]) {
    assert.equal(c.get(num)!.enlace, false, num);
    assert.doesNotMatch(c.get(num)!.texto, /\d/, `${num} sin importe`);
  }
});

test("PORTAL + DOCUMENTO: contrato NETO con una segunda fila no descontada — ni el listado ni la cuenta de cobro la cobran", async () => {
  const t = tablas();
  const c = await portal(t);
  const celda = c.get("DTM-0474")!;
  assert.match(celda.texto, /Descontada/);
  assert.ok(tiene(celda.texto, 80_000), "muestra lo descontado");
  assert.ok(!tiene(celda.texto, 40_000), "no ofrece la segunda fila (800.000 × 5 %)");
  assert.equal(celda.enlace, false, "sin enlace a cuenta de cobro");
  // La cuenta de cobro y el estado de cuenta (mismo resolvedor) coinciden: nada que cobrar.
  assert.equal(await resolverComisionB2B("DTM-0474"), null);
  assert.equal(await resolverComisionB2B("DTM-0474", 56), null, "ni pidiéndola por id");
  assert.equal(await resolverComisionB2B("DTM-0474", 55), null, "la descontada, nunca");
});
