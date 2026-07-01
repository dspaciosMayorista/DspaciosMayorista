"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { EstadoBadge } from "@/components/EstadoBadge";
import { numeroVisible } from "@/lib/tenant";

export type VentaRow = {
  numero_contrato: string;
  cliente: string;
  destino: string | null;
  fecha_salida: string | null;
  precio_venta: number;
  moneda: string | null;
  estado: string;
  created_at: string;
};

const inp = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs";

export function ContratosList({ ventas }: { ventas: VentaRow[] }) {
  const [fContrato, setFContrato] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fDestino, setFDestino] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fSalidaDesde, setFSalidaDesde] = useState("");
  const [fSalidaHasta, setFSalidaHasta] = useState("");
  const [fValorMin, setFValorMin] = useState("");
  const [fValorMax, setFValorMax] = useState("");

  const estados = useMemo(() => [...new Set(ventas.map((v) => v.estado).filter(Boolean))].sort(), [ventas]);

  const filtradas = useMemo(() => {
    const nContrato = fContrato.trim().toLowerCase();
    const nCliente = fCliente.trim().toLowerCase();
    const nDestino = fDestino.trim().toLowerCase();
    const min = fValorMin ? Number(fValorMin) : null;
    const max = fValorMax ? Number(fValorMax) : null;
    return ventas.filter((v) => {
      if (nContrato && !numeroVisible(v.numero_contrato).toLowerCase().includes(nContrato)) return false;
      if (nCliente && !(v.cliente ?? "").toLowerCase().includes(nCliente)) return false;
      if (nDestino && !(v.destino ?? "").toLowerCase().includes(nDestino)) return false;
      if (fEstado && v.estado !== fEstado) return false;
      if (fSalidaDesde && (!v.fecha_salida || v.fecha_salida < fSalidaDesde)) return false;
      if (fSalidaHasta && (!v.fecha_salida || v.fecha_salida > fSalidaHasta)) return false;
      if (min != null && v.precio_venta < min) return false;
      if (max != null && v.precio_venta > max) return false;
      return true;
    });
  }, [ventas, fContrato, fCliente, fDestino, fEstado, fSalidaDesde, fSalidaHasta, fValorMin, fValorMax]);

  const hayFiltros = fContrato || fCliente || fDestino || fEstado || fSalidaDesde || fSalidaHasta || fValorMin || fValorMax;
  function limpiar() {
    setFContrato(""); setFCliente(""); setFDestino(""); setFEstado("");
    setFSalidaDesde(""); setFSalidaHasta(""); setFValorMin(""); setFValorMax("");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {filtradas.length} de {ventas.length} contrato(s)
        </span>
        {!!hayFiltros && (
          <button onClick={limpiar} className="text-xs font-medium text-[var(--brand-accent)] hover:underline">
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2">Contrato</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Destino</th>
              <th className="px-4 py-2">Salida</th>
              <th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-4 pb-2"><input className={inp} value={fContrato} onChange={(e) => setFContrato(e.target.value)} placeholder="Buscar…" /></th>
              <th className="px-4 pb-2"><input className={inp} value={fCliente} onChange={(e) => setFCliente(e.target.value)} placeholder="Buscar…" /></th>
              <th className="px-4 pb-2"><input className={inp} value={fDestino} onChange={(e) => setFDestino(e.target.value)} placeholder="Buscar…" /></th>
              <th className="px-4 pb-2">
                <div className="flex gap-1">
                  <input type="date" className={inp} value={fSalidaDesde} onChange={(e) => setFSalidaDesde(e.target.value)} title="Desde" />
                  <input type="date" className={inp} value={fSalidaHasta} onChange={(e) => setFSalidaHasta(e.target.value)} title="Hasta" />
                </div>
              </th>
              <th className="px-4 pb-2">
                <div className="flex gap-1">
                  <input type="number" className={inp} value={fValorMin} onChange={(e) => setFValorMin(e.target.value)} placeholder="Mín" />
                  <input type="number" className={inp} value={fValorMax} onChange={(e) => setFValorMax(e.target.value)} placeholder="Máx" />
                </div>
              </th>
              <th className="px-4 pb-2">
                <select className={inp} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                  <option value="">Todos</option>
                  {estados.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {!filtradas.length ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">Sin resultados para estos filtros.</td></tr>
            ) : filtradas.map((v) => (
              <tr key={v.numero_contrato} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-medium text-gray-800">{numeroVisible(v.numero_contrato)}</td>
                <td className="px-4 py-3 text-gray-700">{v.cliente}</td>
                <td className="px-4 py-3 text-gray-500">{v.destino ?? "—"}</td>
                <td className="px-4 py-3 text-gray-500">{formatFechaLarga(v.fecha_salida)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMoneda(v.precio_venta, v.moneda)}</td>
                <td className="px-4 py-3"><EstadoBadge estado={v.estado} /></td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/dashboard/contratos/${encodeURIComponent(v.numero_contrato)}`}
                    className="text-xs font-medium text-[#1D7C9A] hover:underline"
                  >
                    Ver →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
