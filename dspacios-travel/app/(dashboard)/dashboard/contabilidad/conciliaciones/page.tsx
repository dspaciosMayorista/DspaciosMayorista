import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenant } from "@/lib/tenant.server";
import { sumarRetencionesPorCuenta } from "@/lib/finanzas/retenciones";
import { ConciliacionesClient, type ExtractoItem, type SistemaItem, type Cruce } from "./ConciliacionesClient";

export const dynamic = "force-dynamic";
const ROLES = ["superadmin", "gerencia", "administracion"];

// El proyecto de Supabase tiene un límite de filas por respuesta (Settings →
// API → "Max rows", suele ser 1000 pero puede estar configurado más bajo) —
// un solo `.select("*")` sobre una tabla con más filas que ese límite se
// trunca EN SILENCIO (sin error), y como se pide `order("fecha")` sin un
// desempate único, cada carga puede además devolver un corte distinto. Se
// pagina con `.range()` avanzando por la cantidad REAL de filas recibidas
// (nunca por el tamaño de página pedido) y solo se detiene con una página
// vacía — así siempre trae todo sin importar el límite del proyecto.
async function traerTodo<T>(sb: SupabaseClient, tabla: string, tenant: string): Promise<T[]> {
  const PAGINA = 500;
  let desde = 0;
  const todo: T[] = [];
  for (;;) {
    const { data, error } = await sb.from(tabla).select("*").eq("tenant", tenant).order("fecha").order("id").range(desde, desde + PAGINA - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    todo.push(...(data as T[]));
    desde += data.length;
  }
  return todo;
}

export default async function ConciliacionesPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Conciliaciones bancarias</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Uso contable (administración / gerencia).</p>
      </div>
    );
  }

  const tenant = await getTenant();
  type FilaExtracto = { id: number; fecha: string; descripcion: string | null; valor: number; saldo: number | null; periodo: string; conciliacion_id: number | null };
  const [extracto, { data: concs }, { data: concSis }, { data: abonos }, { data: cxp }, { data: movs }] = await Promise.all([
    traerTodo<FilaExtracto>(sb, "conciliacion_extracto", tenant),
    sb.from("conciliacion").select("*").eq("tenant", tenant).order("created_at", { ascending: false }),
    sb.from("conciliacion_sistema").select("*"),
    sb.from("abonos").select("id, numero_contrato, fecha_abono, valor_abono, monto_cop").eq("tenant", tenant),
    sb.from("cuentas_por_pagar").select("id, proveedor, tipo_proveedor, servicio, numero_contrato, valor_total, moneda, fecha_obligacion, fecha_vencimiento").eq("tenant", tenant),
    sb.from("contabilidad_movimientos").select("id, fecha, tipo, concepto, valor").eq("tenant", tenant),
  ]);

  const usados = new Set((concSis ?? []).map((s) => s.ref as string));

  // Retenciones y pagos ya practicados por cuenta (se descuentan del saldo
  // pendiente del proveedor, igual que en dashboard/pagos).
  const cxpIds = (cxp ?? []).map((c) => c.id);
  const [{ data: retenciones }, { data: pagosCxp }] = cxpIds.length
    ? await Promise.all([
        sb.from("retenciones_cxp").select("cuenta_por_pagar_id, valor").in("cuenta_por_pagar_id", cxpIds),
        sb.from("cxp_pagos").select("id, cuenta_por_pagar_id, fecha, valor, trm").in("cuenta_por_pagar_id", cxpIds),
      ])
    : [{ data: [] }, { data: [] }];
  const retenidoPorCuenta = sumarRetencionesPorCuenta(
    (retenciones ?? []).map((r) => ({ cuenta_por_pagar_id: r.cuenta_por_pagar_id as number, valor: Number(r.valor) || 0 }))
  );
  const pagosPorCuenta = new Map<number, { id: number; fecha: string; valor: number; trm: number | null }[]>();
  for (const p of pagosCxp ?? []) {
    const arr = pagosPorCuenta.get(p.cuenta_por_pagar_id) ?? [];
    arr.push({ id: p.id, fecha: p.fecha, valor: Number(p.valor) || 0, trm: p.trm });
    pagosPorCuenta.set(p.cuenta_por_pagar_id, arr);
  }

  // Ítems del sistema (no conciliados): abonos de cartera (+), pagos a
  // proveedores y movimientos de egreso (−), y saldos pendientes de
  // proveedor sugeridos (−) — para el caso de pagos hechos pero nunca
  // registrados: al cruzarlos se auto-registra el pago real (ver cruzar()).
  const sistema: SistemaItem[] = [];
  for (const a of abonos ?? []) {
    const ref = `abono:${a.id}`;
    if (usados.has(ref)) continue;
    const cop = Number(a.monto_cop) || Number(a.valor_abono) || 0;
    if (cop <= 0) continue;
    sistema.push({ ref, tipo: "Abono cartera", descripcion: `Abono ${a.numero_contrato}`, fecha: (a.fecha_abono as string) ?? null, valor: cop, numeroContrato: (a.numero_contrato as string) ?? null, categoria: "cartera" });
  }
  for (const c of cxp ?? []) {
    for (const p of pagosPorCuenta.get(c.id) ?? []) {
      if (p.valor <= 0) continue;
      const ref = `pago:${c.id}:${p.id}`;
      if (usados.has(ref)) continue;
      const trm = Number(p.trm) || 1;
      sistema.push({ ref, tipo: "Pago proveedor", descripcion: `Pago ${c.proveedor ?? c.numero_contrato}`, fecha: p.fecha, valor: -(p.valor * trm), numeroContrato: (c.numero_contrato as string) ?? null, categoria: "proveedor" });
    }
  }
  for (const m of movs ?? []) {
    const ref = `movimiento:${m.id}`;
    if (usados.has(ref)) continue;
    const esIngreso = (m.tipo as string) === "ingreso";
    const valorAbs = Math.abs(Number(m.valor) || 0);
    sistema.push({ ref, tipo: esIngreso ? "Ingreso" : "Egreso", descripcion: m.concepto, fecha: (m.fecha as string) ?? null, valor: esIngreso ? valorAbs : -valorAbs, numeroContrato: null, categoria: esIngreso ? "cartera" : "proveedor" });
  }
  // Saldos pendientes de proveedor (sugeridos, no ligados a un pago ya
  // registrado) — no se filtran por `usados`: su presencia depende del saldo
  // actual (>0), que ya baja solo al registrarse un pago real.
  for (const c of cxp ?? []) {
    const pagado = (pagosPorCuenta.get(c.id) ?? []).reduce((s, p) => s + p.valor, 0);
    const retenido = retenidoPorCuenta[c.id] ?? 0;
    const valorTotal = Number(c.valor_total) || 0;
    const saldo = Math.max(valorTotal - pagado - retenido, 0);
    if (saldo <= 0) continue;
    sistema.push({
      ref: `saldo-cxp:${c.id}`,
      tipo: "Saldo pendiente proveedor",
      descripcion: `${c.proveedor ?? c.tipo_proveedor ?? "Proveedor"}${c.servicio ? ` · ${c.servicio}` : ""} (${c.numero_contrato})`,
      fecha: (c.fecha_vencimiento as string | null) ?? (c.fecha_obligacion as string | null) ?? null,
      valor: -saldo,
      numeroContrato: (c.numero_contrato as string) ?? null,
      categoria: "proveedor",
    });
  }

  const extractoPend: ExtractoItem[] = (extracto ?? []).filter((e) => e.conciliacion_id == null).map((e) => ({
    id: e.id, fecha: e.fecha, descripcion: e.descripcion ?? "", valor: Number(e.valor) || 0, periodo: e.periodo,
  }));

  // Cruces realizados (para la sección de conciliados).
  const sisPorConc = new Map<number, SistemaItem[]>();
  for (const s of concSis ?? []) {
    const k = s.conciliacion_id as number;
    if (!sisPorConc.has(k)) sisPorConc.set(k, []);
    const valorSis = Number(s.valor) || 0;
    sisPorConc.get(k)!.push({ ref: s.ref, tipo: "", descripcion: s.descripcion ?? "", fecha: (s.fecha as string) ?? null, valor: valorSis, numeroContrato: s.numero_contrato ?? null, categoria: valorSis < 0 ? "proveedor" : "cartera" });
  }
  const extPorConc = new Map<number, ExtractoItem[]>();
  for (const e of extracto ?? []) {
    if (e.conciliacion_id == null) continue;
    const k = e.conciliacion_id as number;
    if (!extPorConc.has(k)) extPorConc.set(k, []);
    extPorConc.get(k)!.push({ id: e.id, fecha: e.fecha, descripcion: e.descripcion ?? "", valor: Number(e.valor) || 0, periodo: e.periodo });
  }
  const cruces: Cruce[] = (concs ?? []).map((c) => ({
    id: c.id, total: Number(c.total) || 0, nota: c.nota ?? "", fecha: (c.created_at as string).slice(0, 10),
    extracto: extPorConc.get(c.id) ?? [], sistema: sisPorConc.get(c.id) ?? [],
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Conciliaciones bancarias</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        Importa el extracto del banco y crúzalo manualmente contra los movimientos del sistema
        (abonos de cartera, pagos a proveedores y movimientos de pagos).
      </p>
      <ConciliacionesClient extracto={extractoPend} sistema={sistema} cruces={cruces} />
    </div>
  );
}
