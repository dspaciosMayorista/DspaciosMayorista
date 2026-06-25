"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoneda } from "@/lib/utils";
import { liquidarFacturacion } from "@/lib/contabilidad/facturacion";
import { guardarFacturacion, quitarFacturacion } from "./actions";

export type FactRow = {
  numero_contrato: string;
  cliente: string | null;
  destino: string | null;
  mes: string;
  precio_venta: number;
  moneda: string;
  estado: string;
  cfg: { irt: number; ingresoPropio: number; llevaIva: boolean; observacion: string } | null;
};

type Filtro = "sin_configurar" | "configurados" | "todos";

export function FacturacionClient({ rows, ivaPct }: { rows: FactRow[]; ivaPct: number }) {
  const [filtro, setFiltro] = useState<Filtro>("sin_configurar");
  const [q, setQ] = useState("");

  const visibles = useMemo(() => {
    return rows.filter((r) => {
      if (filtro === "sin_configurar" && r.cfg) return false;
      if (filtro === "configurados" && !r.cfg) return false;
      if (q.trim()) {
        const t = `${r.numero_contrato} ${r.cliente ?? ""} ${r.destino ?? ""}`.toLowerCase();
        if (!t.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filtro, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {(["sin_configurar", "configurados", "todos"] as Filtro[]).map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={filtro === f ? { backgroundColor: "white", color: "var(--brand-primary)", boxShadow: "0 1px 2px rgba(0,0,0,.06)" } : { color: "#6b7280" }}>
              {f === "sin_configurar" ? "Sin configurar" : f === "configurados" ? "Configurados" : "Todos"}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato, cliente o destino…" className="w-72" />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">PVP</th>
              <th className="px-4 py-3 text-right">IRT</th>
              <th className="px-4 py-3 text-right">Ingreso propio</th>
              <th className="px-4 py-3 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin contratos en este filtro.</td></tr>
            ) : (
              visibles.map((r) => <Fila key={r.numero_contrato} row={r} ivaPct={ivaPct} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fila({ row, ivaPct }: { row: FactRow; ivaPct: number }) {
  const [abierto, setAbierto] = useState(false);
  const liq = row.cfg ? liquidarFacturacion({ irt: row.cfg.irt, ingreso_propio: row.cfg.ingresoPropio, lleva_iva: row.cfg.llevaIva }, ivaPct) : null;
  const fmt = (n: number) => formatMoneda(n, row.moneda);

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-2.5">
          <button onClick={() => setAbierto((v) => !v)} className="mr-1 text-gray-400 hover:text-gray-700">{abierto ? "▾" : "▸"}</button>
          <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="font-mono font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
            {row.numero_contrato}
          </Link>
        </td>
        <td className="px-4 py-2.5 text-gray-700">{row.cliente ?? "—"}</td>
        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.precio_venta)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{liq ? fmt(liq.irt) : "—"}</td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{liq ? fmt(liq.ingresoPropio) : "—"}</td>
        <td className="px-4 py-2.5 text-center">
          {row.cfg ? (
            <span className="rounded-full bg-[#66B596]/15 px-2 py-0.5 text-xs font-medium text-[#3f7d63]">Configurado</span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Por defecto</span>
          )}
        </td>
      </tr>
      {abierto && (
        <tr className="border-b border-gray-100 bg-gray-50/60">
          <td colSpan={6} className="px-4 py-4">
            <Editor row={row} ivaPct={ivaPct} />
          </td>
        </tr>
      )}
    </>
  );
}

function Editor({ row, ivaPct }: { row: FactRow; ivaPct: number }) {
  const [irt, setIrt] = useState(String(row.cfg?.irt ?? 0));
  const [ingreso, setIngreso] = useState(String(row.cfg?.ingresoPropio ?? row.precio_venta));
  const [llevaIva, setLlevaIva] = useState(row.cfg?.llevaIva ?? true);
  const [obs, setObs] = useState(row.cfg?.observacion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fmt = (n: number) => formatMoneda(n, row.moneda);

  const liq = liquidarFacturacion({ irt: Number(irt) || 0, ingreso_propio: Number(ingreso) || 0, lleva_iva: llevaIva }, ivaPct);
  const descuadre = Math.abs(liq.total - row.precio_venta) > 0.5;

  function guardar() {
    setError(null);
    start(async () => {
      const r = await guardarFacturacion({
        numeroContrato: row.numero_contrato,
        irt: Number(irt) || 0,
        ingresoPropio: Number(ingreso) || 0,
        llevaIva,
        observacion: obs,
      });
      if (!r.ok) setError(r.error);
    });
  }
  function quitar() {
    start(async () => { await quitarFacturacion(row.numero_contrato); });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Configuración</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">IRT (para terceros)</label>
            <Input type="number" min={0} value={irt} onChange={(e) => setIrt(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Ingreso propio</label>
            <Input type="number" min={0} value={ingreso} onChange={(e) => setIngreso(e.target.value)} />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={llevaIva} onChange={(e) => setLlevaIva(e.target.checked)} className="rounded" />
          El ingreso propio lleva IVA incluido ({(ivaPct * 100).toFixed(0)}%)
        </label>
        <button type="button" onClick={() => { setIrt("0"); setIngreso(String(row.precio_venta)); }}
          className="text-xs font-medium text-[#1D7C9A] hover:underline">
          Todo como ingreso propio (= PVP)
        </button>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Observación</label>
          <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Nota tributaria (opcional)" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          {row.cfg && (
            <button type="button" onClick={quitar} disabled={pending} className="text-xs font-medium text-red-500 hover:underline disabled:opacity-50">
              Quitar (volver al por defecto)
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Liquidación</p>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-gray-50"><td className="py-1.5 text-gray-500">IRT (no provisiona)</td><td className="py-1.5 text-right tabular-nums">{fmt(liq.irt)}</td></tr>
            <tr className="border-b border-gray-50"><td className="py-1.5 text-gray-500">Ingreso propio</td><td className="py-1.5 text-right tabular-nums">{fmt(liq.ingresoPropio)}</td></tr>
            <tr className="border-b border-gray-50"><td className="py-1.5 text-gray-500">› Base gravable</td><td className="py-1.5 text-right tabular-nums text-gray-600">{fmt(liq.baseGravable)}</td></tr>
            <tr className="border-b border-gray-50"><td className="py-1.5 text-gray-500">› IVA generado</td><td className="py-1.5 text-right tabular-nums text-gray-600">{fmt(liq.ivaGenerado)}</td></tr>
            <tr className="font-semibold"><td className="py-1.5">Total facturado</td><td className="py-1.5 text-right tabular-nums" style={{ color: descuadre ? "#C0392B" : "var(--brand-primary)" }}>{fmt(liq.total)}</td></tr>
          </tbody>
        </table>
        {descuadre && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
            IRT + Ingreso propio ({fmt(liq.total)}) no cuadra con el PVP del contrato ({fmt(row.precio_venta)}).
          </p>
        )}
        <p className="text-[11px] text-gray-400">Las provisiones de rentabilidad se calculan sobre el ingreso propio.</p>
      </div>
    </div>
  );
}
