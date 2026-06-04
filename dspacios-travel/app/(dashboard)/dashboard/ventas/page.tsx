import { createClient } from "@/lib/supabase/server";
import { formatCOP } from "@/lib/utils";
import { VentasTable, AnioSelect, type VentaRow } from "./VentasTable";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion", "operaciones"];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DONUT_COLORS = ["var(--brand-primary)", "var(--brand-accent)", "var(--brand-success)", "#AEF44A", "#f59e0b", "#a78bfa", "#94a3b8"];

const esAnulada = (e: string | null) => e === "anulada" || e === "anulado";
const esCOP = (m: string | null) => !m || m === "COP";

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string }>;
}) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Ventas</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (operación / administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: ventasRaw }, { data: abonos }] = await Promise.all([
    sb.from("ventas").select(
      "numero_contrato, cliente, asesor, asesor_firma_nombre, destino, tipo_paquete, fecha_venta, fecha_salida, fecha_regreso, precio_venta, estado, moneda, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos"
    ),
    sb.from("abonos").select("numero_contrato, valor_abono"),
  ]);
  const ventas = ventasRaw ?? [];

  // Años disponibles + año seleccionado
  const anios = [...new Set(ventas.map((v) => (v.fecha_venta ?? "").slice(0, 4)).filter(Boolean).map(Number))].sort((a, b) => b - a);
  if (!anios.length) anios.push(new Date().getFullYear());
  const sp = await searchParams;
  const anio = anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[0];

  // Abonos por contrato
  const abonadoPorContrato = new Map<string, number>();
  for (const a of abonos ?? []) abonadoPorContrato.set(a.numero_contrato, (abonadoPorContrato.get(a.numero_contrato) ?? 0) + (a.valor_abono ?? 0));

  // Filtrar al año (por fecha de venta) y excluir anuladas
  const delAnio = ventas.filter((v) => (v.fecha_venta ?? "").startsWith(String(anio)) && !esAnulada(v.estado));
  const cop = delAnio.filter((v) => esCOP(v.moneda)); // KPIs monetarios solo COP

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalIngresos = cop.reduce((s, v) => s + (v.precio_venta ?? 0), 0);
  const nContratos = cop.length;
  const costoDirecto = (v: typeof ventas[number]) =>
    (v.costo_hotel ?? 0) + (v.costo_aereo ?? 0) + (v.costo_receptivo ?? 0) + (v.costo_asistencia ?? 0) + (v.otros_costos ?? 0);
  const utilidad = cop.reduce((s, v) => s + ((v.precio_venta ?? 0) - costoDirecto(v)), 0);
  const margen = totalIngresos > 0 ? (utilidad / totalIngresos) * 100 : 0;
  const recaudado = cop.reduce((s, v) => s + Math.min(abonadoPorContrato.get(v.numero_contrato) ?? 0, v.precio_venta ?? 0), 0);
  const cartera = Math.max(totalIngresos - recaudado, 0);
  const recaudoPct = totalIngresos > 0 ? (recaudado / totalIngresos) * 100 : 0;
  const ticket = nContratos > 0 ? totalIngresos / nContratos : 0;

  // ── Ingresos mensuales ──────────────────────────────────────────────────────
  const porMes = Array(12).fill(0) as number[];
  for (const v of cop) {
    const m = Number((v.fecha_venta ?? "").slice(5, 7)) - 1;
    if (m >= 0 && m < 12) porMes[m] += v.precio_venta ?? 0;
  }
  const maxMes = Math.max(1, ...porMes);

  // ── Por tipo de paquete ─────────────────────────────────────────────────────
  const porTipoMap = new Map<string, number>();
  for (const v of cop) {
    const t = v.tipo_paquete || "otro";
    porTipoMap.set(t, (porTipoMap.get(t) ?? 0) + (v.precio_venta ?? 0));
  }
  const porTipo = [...porTipoMap.entries()].map(([label, value], i) => ({ label, value, color: DONUT_COLORS[i % DONUT_COLORS.length] })).sort((a, b) => b.value - a.value);
  const totalTipo = porTipo.reduce((s, t) => s + t.value, 0) || 1;

  // ── Top asesores ─────────────────────────────────────────────────────────────
  const asesorMap = new Map<string, { total: number; n: number }>();
  for (const v of cop) {
    const nombre = v.asesor_firma_nombre || v.asesor || "Sin asesor";
    const cur = asesorMap.get(nombre) ?? { total: 0, n: 0 };
    cur.total += v.precio_venta ?? 0;
    cur.n += 1;
    asesorMap.set(nombre, cur);
  }
  const topAsesores = [...asesorMap.entries()].map(([nombre, x]) => ({ nombre, ...x })).sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Filas para la lista (todas, no solo del año) ─────────────────────────────
  const rows: VentaRow[] = ventas
    .slice()
    .sort((a, b) => (b.fecha_venta ?? "").localeCompare(a.fecha_venta ?? ""))
    .map((v) => ({
      numero_contrato: v.numero_contrato,
      cliente: v.cliente,
      asesor: v.asesor_firma_nombre || v.asesor,
      destino: v.destino,
      fecha_venta: v.fecha_venta,
      fecha_salida: v.fecha_salida,
      fecha_regreso: v.fecha_regreso,
      precio_venta: v.precio_venta ?? 0,
      estado: v.estado,
      moneda: v.moneda,
    }));

  // Donut: segmentos como anillo apilado (offset acumulado precalculado)
  const R = 70, C = 2 * Math.PI * R;
  const donutSegs: { label: string; color: string; frac: number; offset: number }[] = [];
  porTipo.reduce((acc, t) => {
    const frac = t.value / totalTipo;
    donutSegs.push({ label: t.label, color: t.color, frac, offset: acc });
    return acc + frac;
  }, 0);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ventas</h1>
          <p className="mt-1 text-sm text-gray-500">Resumen del negocio y gestión de contratos.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Año:</span>
          <AnioSelect anio={anio} anios={anios} />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total ingresos" value={formatCOP(totalIngresos)} sub={`${nContratos} contratos`} color="var(--brand-primary)" />
        <Kpi label="Utilidad bruta" value={formatCOP(utilidad)} sub={`Margen ${margen.toFixed(1)}%`} color="var(--brand-success)" />
        <Kpi label="Cartera pendiente" value={formatCOP(cartera)} sub={`Recaudo ${recaudoPct.toFixed(1)}%`} color="#f59e0b" />
        <Kpi label="Ticket promedio" value={formatCOP(ticket)} sub={`${nContratos} contratos`} color="var(--brand-accent)" />
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Ingresos mensuales */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">Ingresos mensuales · {anio}</h2>
          <div className="flex h-56 items-end gap-2">
            {porMes.map((val, i) => (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div className="w-full rounded-t" style={{ height: `${(val / maxMes) * 100}%`, minHeight: val > 0 ? 4 : 0, backgroundColor: "var(--brand-primary)" }} title={formatCOP(val)} />
                <span className="text-[10px] text-gray-400">{MESES[i]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Por tipo de paquete */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">Por tipo de paquete</h2>
          {porTipo.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">Sin datos.</p>
          ) : (
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 180 180" className="h-36 w-36 -rotate-90">
                {donutSegs.map((t) => (
                  <circle key={t.label} cx="90" cy="90" r={R} fill="none" stroke={t.color} strokeWidth="22"
                    strokeDasharray={`${t.frac * C} ${C}`} strokeDashoffset={`-${t.offset * C}`} />
                ))}
              </svg>
              <ul className="space-y-1 text-xs">
                {porTipo.map((t) => (
                  <li key={t.label} className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: t.color }} />
                    <span className="capitalize text-gray-600">{t.label}</span>
                    <span className="text-gray-400">{((t.value / totalTipo) * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Top asesores */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Top asesores · {anio}</h2>
        {topAsesores.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">Sin datos.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {topAsesores.map((a, i) => (
              <li key={a.nombre} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: ["#eab308", "#94a3b8", "#b45309", "var(--brand-accent)", "var(--brand-accent)"][i] }}>{i + 1}</span>
                  <span className="font-medium text-gray-800">{a.nombre}</span>
                  <span className="text-xs text-gray-400">{a.n} contrato(s)</span>
                </div>
                <span className="font-semibold tabular-nums text-gray-700">{formatCOP(a.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Lista de ventas */}
      <h2 className="mb-3 mt-9 text-sm font-semibold uppercase tracking-wide text-gray-400">Gestión de contratos</h2>
      <VentasTable rows={rows} />

      {ventas.some((v) => !esCOP(v.moneda)) && (
        <p className="mt-3 text-xs text-gray-400">* Los indicadores monetarios suman solo ventas en COP. Las ventas en otra moneda aparecen en la lista con su divisa.</p>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums md:text-2xl" style={{ color }}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-400">{sub}</div>
    </div>
  );
}
