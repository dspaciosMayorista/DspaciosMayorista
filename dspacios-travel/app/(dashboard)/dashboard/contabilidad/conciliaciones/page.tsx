import { createClient } from "@/lib/supabase/server";
import { ConciliacionesClient, type ExtractoItem, type SistemaItem, type Cruce } from "./ConciliacionesClient";

export const dynamic = "force-dynamic";
const ROLES = ["superadmin", "gerencia", "administracion"];

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

  const [{ data: extracto }, { data: concs }, { data: concSis }, { data: abonos }, { data: cxp }, { data: movs }] = await Promise.all([
    sb.from("conciliacion_extracto").select("*").order("fecha"),
    sb.from("conciliacion").select("*").order("created_at", { ascending: false }),
    sb.from("conciliacion_sistema").select("*"),
    sb.from("abonos").select("id, numero_contrato, fecha_abono, valor_abono, monto_cop"),
    sb.from("cuentas_por_pagar").select("id, proveedor, numero_contrato, abono1, fecha_abono1, trm1, abono2, fecha_abono2, trm2, abono3, fecha_abono3, trm3"),
    sb.from("contabilidad_movimientos").select("id, fecha, tipo, concepto, valor"),
  ]);

  const usados = new Set((concSis ?? []).map((s) => s.ref as string));

  // Ítems del sistema (no conciliados): abonos de cartera, pagos a proveedores, movimientos.
  const sistema: SistemaItem[] = [];
  for (const a of abonos ?? []) {
    const ref = `abono:${a.id}`;
    if (usados.has(ref)) continue;
    const cop = Number(a.monto_cop) || Number(a.valor_abono) || 0;
    if (cop <= 0) continue;
    sistema.push({ ref, tipo: "Abono cartera", descripcion: `Abono ${a.numero_contrato}`, fecha: (a.fecha_abono as string) ?? null, valor: cop });
  }
  for (const c of cxp ?? []) {
    for (const n of [1, 2, 3] as const) {
      const val = Number((c as Record<string, unknown>)[`abono${n}`]) || 0;
      if (val <= 0) continue;
      const ref = `pago:${c.id}:${n}`;
      if (usados.has(ref)) continue;
      const trm = Number((c as Record<string, unknown>)[`trm${n}`]) || 1;
      const fecha = ((c as Record<string, unknown>)[`fecha_abono${n}`] as string) ?? null;
      sistema.push({ ref, tipo: "Pago proveedor", descripcion: `Pago ${c.proveedor ?? c.numero_contrato}`, fecha, valor: val * trm });
    }
  }
  for (const m of movs ?? []) {
    const ref = `movimiento:${m.id}`;
    if (usados.has(ref)) continue;
    sistema.push({ ref, tipo: (m.tipo as string) === "ingreso" ? "Ingreso" : "Egreso", descripcion: m.concepto, fecha: (m.fecha as string) ?? null, valor: Number(m.valor) || 0 });
  }

  const extractoPend: ExtractoItem[] = (extracto ?? []).filter((e) => e.conciliacion_id == null).map((e) => ({
    id: e.id, fecha: e.fecha, descripcion: e.descripcion ?? "", valor: Number(e.valor) || 0, periodo: e.periodo,
  }));

  // Cruces realizados (para la sección de conciliados).
  const sisPorConc = new Map<number, SistemaItem[]>();
  for (const s of concSis ?? []) {
    const k = s.conciliacion_id as number;
    if (!sisPorConc.has(k)) sisPorConc.set(k, []);
    sisPorConc.get(k)!.push({ ref: s.ref, tipo: "", descripcion: s.descripcion ?? "", fecha: (s.fecha as string) ?? null, valor: Number(s.valor) || 0 });
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
