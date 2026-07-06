"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { calcComisionB2B } from "@/lib/calc/finanzas";
import { marcarComisionB2BPagada, marcarComisionB2BPendiente, actualizarComisionB2B } from "./actions";
import { ChevronDown, ChevronRight } from "lucide-react";

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
  // Discriminación de la base comisionable (de dónde sale la comisión).
  precioVenta?: number;
  baseComision?: number;
  recobroTotal?: number;
  pctRecobroAliado?: number;
  aplicaRetencion?: boolean;
  pctRetencion?: number;
  comisionBase?: number;
  recobroAliado?: number;
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
  const [abierto, setAbierto] = useState(false);

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
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-3">
          <button type="button" onClick={() => setAbierto((o) => !o)} className="mr-1 align-middle text-gray-400 hover:text-gray-600">
            {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {linkContrato}
        </td>
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
      {abierto && <FilaDetalle row={row} />}
    </>
  );
}

// Discriminación: de dónde sale la comisión (PVP → base comisionable → % →
// comisión base + recobro − retención = a pagar), con la base comisionable
// editable (por defecto es PVP − impuesto/BNC, a veces hay que ajustarla).
function FilaDetalle({ row }: { row: ComB2BRow }) {
  const baseInicial = row.baseComision ?? row.precioVenta ?? 0;
  const recobroInicial = row.recobroTotal ?? 0;
  const pctRecobroInicial = row.pctRecobroAliado ?? 0.5;

  const [base, setBase] = useState(String(baseInicial));
  const [recobro, setRecobro] = useState(String(recobroInicial));
  const [pctRecobro, setPctRecobro] = useState(String(Math.round(pctRecobroInicial * 100)));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const preview = calcComisionB2B({
    precioVenta: row.precioVenta ?? 0,
    baseComisionable: Number(base) || 0,
    pctComision: row.pct_comision ?? 0,
    recobroTotal: Number(recobro) || 0,
    pctRecobroAliado: (Number(pctRecobro) || 0) / 100,
    aplicaRetencion: row.aplicaRetencion ?? false,
    pctRetencion: row.pctRetencion ?? 0,
  });
  const cambio =
    Number(base) !== baseInicial ||
    Number(recobro) !== recobroInicial ||
    (Number(pctRecobro) || 0) / 100 !== pctRecobroInicial;

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarComisionB2B(row.id, {
        baseComision: Number(base) || 0,
        recobroTotal: Number(recobro) || 0,
        pctRecobroAliado: (Number(pctRecobro) || 0) / 100,
      });
      if (r.ok) setMsg("Guardado ✓"); else setMsg(r.error);
    });
  }

  const Dato = ({ label, valor }: { label: string; valor: string }) => (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="tabular-nums text-gray-700">{valor}</div>
    </div>
  );
  // Texto + inputMode (no type="number"): así se puede escribir/pegar el valor
  // de una vez y seleccionar todo con un click, en vez de los spinners +/− del
  // input numérico nativo (incómodos para montos grandes en pesos).
  const Campo = ({ label, value, onChange, width = "w-24" }: { label: string; value: string; onChange: (v: string) => void; width?: string }) => (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <Input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        onFocus={(e) => e.target.select()}
        className={`mt-0.5 h-7 ${width} text-xs`}
      />
    </div>
  );

  return (
    <tr className="border-b border-gray-100 bg-gray-50/60">
      <td colSpan={7} className="px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">De dónde sale la comisión</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4 lg:grid-cols-8">
          <Dato label="Precio de venta (PVP)" valor={formatCOP(row.precioVenta ?? 0)} />
          <Campo label="Base comisionable" value={base} onChange={setBase} />
          <Dato label="% comisión" valor={`${((row.pct_comision ?? 0) * 100).toFixed(1)}%`} />
          <Dato label="Comisión (base × %)" valor={formatCOP(preview.comisionBase)} />
          <Campo label="Recobro total" value={recobro} onChange={setRecobro} />
          <Campo label="% recobro al aliado" value={pctRecobro} onChange={setPctRecobro} width="w-16" />
          <Dato label="+ Recobro aliado" valor={formatCOP(preview.recobroAliado)} />
          <Dato label="Retención" valor={row.aplicaRetencion ? `− ${formatCOP(preview.retencion)}` : "No aplica"} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2">
          <span className="text-xs text-gray-500">
            Comisión ({formatCOP(preview.comisionBase)}) + recobro aliado ({formatCOP(preview.recobroAliado)})
            {row.aplicaRetencion ? ` − retención (${formatCOP(preview.retencion)})` : ""} ={" "}
            <b className="text-sm" style={{ color: "var(--brand-primary)" }}>{formatCOP(preview.totalPagar)}</b>
          </span>
          <div className="flex items-center gap-2">
            {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
            {cambio && (
              <Button type="button" disabled={pending} onClick={guardar} className="h-7 px-3 text-[11px]" style={{ backgroundColor: "var(--brand-primary)" }}>
                {pending ? "Guardando…" : "Guardar cambios"}
              </Button>
            )}
          </div>
        </div>
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
