"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatMoneda } from "@/lib/utils";

export type VentaRow = {
  numero_contrato: string;
  cliente: string | null;
  asesor: string | null;
  destino: string | null;
  fecha_venta: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  precio_venta: number;
  estado: string | null;
  moneda: string | null;
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1]} ${y.slice(2)}`;
};
const ym = (d: string | null) => (d ? d.slice(0, 7) : "");

type EstadoViaje = { label: string; cls: string };
function estadoViaje(salida: string | null, regreso: string | null): EstadoViaje {
  const hoy = new Date().toISOString().slice(0, 10);
  if (!salida) return { label: "—", cls: "bg-gray-100 text-gray-500" };
  if (regreso && regreso < hoy) return { label: "Viajó", cls: "bg-green-100 text-green-700" };
  if (salida > hoy) return { label: "Próximo", cls: "bg-sky-100 text-sky-700" };
  return { label: "En viaje", cls: "bg-amber-100 text-amber-700" };
}

const estadoCls: Record<string, string> = {
  confirmado: "bg-green-100 text-green-700",
  pendiente: "bg-amber-100 text-amber-700",
  anulada: "bg-red-100 text-red-700",
  anulado: "bg-red-100 text-red-700",
};

const inp = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function AnioSelect({ anio, anios }: { anio: number; anios: number[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <select
      value={anio}
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        p.set("anio", e.target.value);
        router.push(`/dashboard/ventas?${p.toString()}`);
      }}
      className={inp}
    >
      {anios.map((a) => (
        <option key={a} value={a}>{a}</option>
      ))}
    </select>
  );
}

export function VentasTable({ rows }: { rows: VentaRow[] }) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [mesVenta, setMesVenta] = useState("");
  const [mesViaje, setMesViaje] = useState("");

  const estados = useMemo(() => [...new Set(rows.map((r) => r.estado).filter(Boolean) as string[])].sort(), [rows]);
  const mesesVenta = useMemo(() => [...new Set(rows.map((r) => ym(r.fecha_venta)).filter(Boolean))].sort().reverse(), [rows]);
  const mesesViaje = useMemo(() => [...new Set(rows.map((r) => ym(r.fecha_salida)).filter(Boolean))].sort().reverse(), [rows]);

  const filtradas = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (estado && r.estado !== estado) return false;
      if (mesVenta && ym(r.fecha_venta) !== mesVenta) return false;
      if (mesViaje && ym(r.fecha_salida) !== mesViaje) return false;
      if (needle) {
        const hay = `${r.numero_contrato} ${r.cliente ?? ""} ${r.destino ?? ""} ${r.asesor ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, estado, mesVenta, mesViaje]);

  return (
    <div>
      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar contrato, cliente, destino…"
          className={`${inp} min-w-[220px] flex-1`}
        />
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inp}>
          <option value="">Todos los estados</option>
          {estados.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={mesVenta} onChange={(e) => setMesVenta(e.target.value)} className={inp}>
          <option value="">Mes de venta</option>
          {mesesVenta.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
        <select value={mesViaje} onChange={(e) => setMesViaje(e.target.value)} className={inp}>
          <option value="">Mes de viaje</option>
          {mesesViaje.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
        <Link
          href="/dashboard/reservar"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          + Nueva venta
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Asesor</th>
              <th className="px-4 py-3">Destino</th>
              <th className="px-4 py-3">Mes viaje</th>
              <th className="px-4 py-3">Estado viaje</th>
              <th className="px-4 py-3 text-right">Precio venta</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((v) => {
              const ev = estadoViaje(v.fecha_salida, v.fecha_regreso);
              return (
                <tr key={v.numero_contrato} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium text-gray-800">{v.numero_contrato}</td>
                  <td className="px-4 py-3 text-gray-700">{v.cliente ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{v.asesor ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{v.destino ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{v.fecha_salida ? mesLabel(ym(v.fecha_salida)) : "—"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${ev.cls}`}>{ev.label}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMoneda(v.precio_venta, v.moneda ?? "COP")}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${estadoCls[v.estado ?? ""] ?? "bg-gray-100 text-gray-600"}`}>{v.estado ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/contratos/${encodeURIComponent(v.numero_contrato)}`} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>Ver →</Link>
                  </td>
                </tr>
              );
            })}
            {!filtradas.length && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">No hay ventas con estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">{filtradas.length} venta(s)</p>
    </div>
  );
}
