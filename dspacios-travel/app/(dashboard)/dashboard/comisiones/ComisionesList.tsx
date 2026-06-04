"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { marcarComisionB2BPagada, marcarComisionB2BPendiente } from "./actions";

export type ComB2BRow = {
  id: number;
  numero_contrato: string;
  cliente: string | null;
  aliado: string | null;
  nit: string | null;
  pct_comision: number | null;
  totalComision: number;
  retencion: number;
  totalPagar: number | null;
  estado: string;
  fecha_pago: string | null;
  sinComision?: boolean;
};

type Filtro = "pendientes" | "pagadas" | "todas";
const esPagada = (e: string) => e === "pagada" || e === "pagado";

export function ComisionesList({ rows }: { rows: ComB2BRow[] }) {
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [q, setQ] = useState("");

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === "pendientes" && esPagada(r.estado)) return false;
      if (filtro === "pagadas" && !esPagada(r.estado)) return false;
      if (t) {
        const hay = `${r.numero_contrato} ${r.aliado ?? ""} ${r.cliente ?? ""}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [rows, filtro, q]);

  const tot = useMemo(() => {
    let total = 0, pagado = 0, pendiente = 0;
    for (const r of visibles) {
      const v = r.totalPagar ?? 0;
      total += v;
      if (esPagada(r.estado)) pagado += v; else pendiente += v;
    }
    return { total, pagado, pendiente };
  }, [visibles]);

  return (
    <div>
      {/* Resumen */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tarjeta titulo="Total comisiones B2B" valor={tot.total} />
        <Tarjeta titulo="Pagado" valor={tot.pagado} tono="success" />
        <Tarjeta titulo="Pendiente por pagar" valor={tot.pendiente} tono="primary" />
      </div>

      {/* Controles */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(["pendientes", "pagadas", "todas"] as Filtro[]).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} className="rounded-md px-3 py-1.5"
              style={filtro === f ? { backgroundColor: "var(--brand-primary)", color: "white", fontWeight: 600 } : { color: "#4b5563" }}>
              {f === "pendientes" ? "Pendientes" : f === "pagadas" ? "Pagadas" : "Todas"}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato, aliado o cliente…" className="w-64 max-w-full" />
        <span className="ml-auto text-sm text-gray-500">{visibles.length} comisión(es)</span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Aliado</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">% Com.</th>
              <th className="px-4 py-3 text-right">A pagar</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No hay comisiones en este filtro.</td></tr>
            )}
            {visibles.map((r) => <Fila key={r.id} row={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fila({ row }: { row: ComB2BRow }) {
  const pagada = esPagada(row.estado);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [pending, start] = useTransition();

  const linkContrato = (
    <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="font-mono font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
      {row.numero_contrato}
    </Link>
  );

  // Venta B2B sin comisión registrada todavía → invita a definirla en el contrato.
  if (row.sinComision) {
    return (
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-3">{linkContrato}</td>
        <td className="px-4 py-3 text-gray-700">{row.aliado ?? "—"}</td>
        <td className="px-4 py-3 text-gray-500">{row.cliente ?? "—"}</td>
        <td className="px-4 py-3 text-right text-gray-300">—</td>
        <td className="px-4 py-3 text-right text-gray-400">Por definir</td>
        <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Sin definir</span></td>
        <td className="px-4 py-3 text-right">
          <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
            Definir comisión →
          </Link>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50">
      <td className="px-4 py-3">{linkContrato}</td>
      <td className="px-4 py-3 text-gray-700">{row.aliado ?? "—"}</td>
      <td className="px-4 py-3 text-gray-500">{row.cliente ?? "—"}</td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-600">{((row.pct_comision ?? 0) * 100).toFixed(1)}%</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(row.totalPagar ?? 0)}</td>
      <td className="px-4 py-3">
        {pagada ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Pagada{row.fecha_pago ? ` · ${row.fecha_pago}` : ""}</span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Pendiente</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {pagada ? (
          <button type="button" disabled={pending}
            onClick={() => start(async () => void (await marcarComisionB2BPendiente(row.id)))}
            className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50">
            Deshacer
          </button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-8 w-36" />
            <Button type="button" disabled={pending}
              onClick={() => start(async () => void (await marcarComisionB2BPagada(row.id, fecha)))}
              className="h-8" style={{ backgroundColor: "var(--brand-success)" }}>
              {pending ? "…" : "Marcar pagada"}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function Tarjeta({ titulo, valor, tono }: { titulo: string; valor: number; tono?: "primary" | "success" }) {
  const color = tono === "primary" ? "var(--brand-primary)" : tono === "success" ? "var(--brand-success)" : "#111827";
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color }}>{formatCOP(valor)}</div>
    </div>
  );
}
