"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";

export type RentRow = {
  numero_contrato: string;
  cliente: string | null;
  asesor: string | null;
  destino: string | null;
  canal: string | null;
  mes: string; // YYYY-MM ("" si no hay fecha)
  precioVenta: number;
  ivaGenerado: number;
  ingreso: number;
  costoDirecto: number;
  ivaDescontable: number;
  costoNeto: number;
  utilBruta: number;
  comB2B: number;
  comAsesor: number;
  provIca: number;
  provBomberil: number;
  provFontur: number;
  provRenta: number;
  totalProvisiones: number;
  ivaPorPagar: number;
  utilNeta: number;
  margenNeto: number;
  clasificacion: "Alta" | "Media" | "Baja";
};

type Clase = "Todas" | "Alta" | "Media" | "Baja";

const colorClase = (c: string) =>
  c === "Alta" ? "var(--brand-success)" : c === "Media" ? "#C99A2E" : "#C0392B";

const TODOS = "__todos__";

export function RentabilidadList({ rows }: { rows: RentRow[] }) {
  const [q, setQ] = useState("");
  const [asesor, setAsesor] = useState(TODOS);
  const [destino, setDestino] = useState(TODOS);
  const [mes, setMes] = useState(TODOS);
  const [clase, setClase] = useState<Clase>("Todas");

  const asesores = useMemo(() => uniques(rows.map((r) => r.asesor)), [rows]);
  const destinos = useMemo(() => uniques(rows.map((r) => r.destino)), [rows]);
  const meses = useMemo(() => uniques(rows.map((r) => r.mes)).sort().reverse(), [rows]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (asesor !== TODOS && (r.asesor ?? "") !== asesor) return false;
      if (destino !== TODOS && (r.destino ?? "") !== destino) return false;
      if (mes !== TODOS && r.mes !== mes) return false;
      if (clase !== "Todas" && r.clasificacion !== clase) return false;
      if (t) {
        const hay = `${r.numero_contrato} ${r.cliente ?? ""} ${r.destino ?? ""}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [rows, q, asesor, destino, mes, clase]);

  const tot = useMemo(() => {
    let ingreso = 0, costo = 0, com = 0, prov = 0, iva = 0, util = 0;
    const dist = { Alta: 0, Media: 0, Baja: 0 };
    for (const r of visibles) {
      ingreso += r.ingreso;
      costo += r.costoNeto;
      com += r.comB2B + r.comAsesor;
      prov += r.totalProvisiones;
      iva += r.ivaPorPagar;
      util += r.utilNeta;
      dist[r.clasificacion]++;
    }
    return { ingreso, costo, com, prov, iva, util, margen: ingreso > 0 ? util / ingreso : 0, dist };
  }, [visibles]);

  return (
    <div>
      {/* Resumen */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta titulo="Ingreso (sin IVA)" valor={tot.ingreso} sub={`${visibles.length} contrato(s)`} />
        <Tarjeta titulo="Costo + comisiones" valor={tot.costo + tot.com} />
        <Tarjeta titulo="Utilidad neta" valor={tot.util} tono="primary" />
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-gray-400">Margen promedio</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{(tot.margen * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Reparto por clasificación */}
      <div className="mb-5 flex flex-wrap gap-2 text-xs">
        {(["Alta", "Media", "Baja"] as const).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorClase(c) }} />
            <span className="text-gray-600">{c}</span>
            <b className="tabular-nums text-gray-800">{tot.dist[c]}</b>
          </span>
        ))}
      </div>

      {/* Controles */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato, cliente o destino…" className="w-60 max-w-full" />
        <Select value={asesor} onChange={setAsesor} todos="Todos los asesores" options={asesores} />
        <Select value={destino} onChange={setDestino} todos="Todos los destinos" options={destinos} />
        <Select value={mes} onChange={setMes} todos="Todos los meses" options={meses} />
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(["Todas", "Alta", "Media", "Baja"] as Clase[]).map((c) => (
            <button key={c} type="button" onClick={() => setClase(c)} className="rounded-md px-2.5 py-1.5"
              style={clase === c ? { backgroundColor: "var(--brand-primary)", color: "white", fontWeight: 600 } : { color: "#4b5563" }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-3 py-3">Contrato</th>
              <th className="px-3 py-3">Cliente</th>
              <th className="px-3 py-3">Asesor</th>
              <th className="px-3 py-3 text-right">Ingreso</th>
              <th className="px-3 py-3 text-right">Costo</th>
              <th className="px-3 py-3 text-right">Comisiones</th>
              <th className="px-3 py-3 text-right">Provisiones</th>
              <th className="px-3 py-3 text-right">IVA x pagar</th>
              <th className="px-3 py-3 text-right">Util. neta</th>
              <th className="px-3 py-3 text-right">Margen</th>
              <th className="px-3 py-3">Clase</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400">No hay contratos en este filtro.</td></tr>
            )}
            {visibles.map((r) => <Fila key={r.numero_contrato} r={r} />)}
          </tbody>
          {visibles.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-3 py-3" colSpan={3}>Total ({visibles.length})</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCOP(tot.ingreso)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-500">{formatCOP(tot.costo)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-500">{formatCOP(tot.com)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-500">{formatCOP(tot.prov)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-500">{formatCOP(tot.iva)}</td>
                <td className="px-3 py-3 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(tot.util)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{(tot.margen * 100).toFixed(1)}%</td>
                <td className="px-3 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Fila({ r }: { r: RentRow }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-3 py-2.5">
          <button type="button" onClick={() => setAbierto((v) => !v)} className="mr-1 text-gray-400 hover:text-gray-700">{abierto ? "▾" : "▸"}</button>
          <Link href={`/dashboard/contratos/${encodeURIComponent(r.numero_contrato)}`} className="font-mono font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
            {r.numero_contrato}
          </Link>
        </td>
        <td className="px-3 py-2.5 text-gray-700">{r.cliente ?? "—"}</td>
        <td className="px-3 py-2.5 text-gray-500">{r.asesor ?? "—"}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{formatCOP(r.ingreso)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{formatCOP(r.costoNeto)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{formatCOP(r.comB2B + r.comAsesor)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{formatCOP(r.totalProvisiones)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{formatCOP(r.ivaPorPagar)}</td>
        <td className="px-3 py-2.5 text-right font-medium tabular-nums" style={{ color: r.utilNeta < 0 ? "#C0392B" : "inherit" }}>{formatCOP(r.utilNeta)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{(r.margenNeto * 100).toFixed(1)}%</td>
        <td className="px-3 py-2.5">
          <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: colorClase(r.clasificacion) }}>
            {r.clasificacion}
          </span>
        </td>
      </tr>
      {abierto && (
        <tr className="border-b border-gray-100 bg-gray-50/60">
          <td colSpan={11} className="px-3 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Desglose · {r.destino ?? "—"}{r.mes ? ` · ${r.mes}` : ""}{r.canal ? ` · ${r.canal}` : ""}
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Columna 1 — Estado de resultados (sin IVA) */}
              <Bloque titulo="Estado de resultados" filas={[
                { k: "Ingreso (PVP)", v: formatCOP(r.ingreso) },
                { k: "(−) Costo (total proveedor)", v: `− ${formatCOP(r.costoNeto)}` },
                { k: "= Utilidad bruta", v: formatCOP(r.utilBruta), total: true },
                ...(r.comB2B > 0 ? [{ k: "(−) Comisión B2B", v: `− ${formatCOP(r.comB2B)}` }] : []),
                { k: "(−) Provisión ICA", v: `− ${formatCOP(r.provIca)}` },
                { k: "(−) Provisión Bomberil", v: `− ${formatCOP(r.provBomberil)}` },
                { k: "(−) Provisión Fontur", v: `− ${formatCOP(r.provFontur)}` },
                { k: "(−) Provisión Renta", v: `− ${formatCOP(r.provRenta)}` },
                { k: "= Total provisiones", v: formatCOP(r.totalProvisiones), total: true },
                { k: "(−) IVA por pagar", v: `− ${formatCOP(r.ivaPorPagar)}` },
                { k: "= Utilidad neta", v: formatCOP(r.utilNeta), total: true, color: r.utilNeta < 0 ? "#C0392B" : "var(--brand-primary)" },
              ]} />

              {/* Columna 2 — IVA */}
              <Bloque titulo="IVA" filas={[
                { k: "IVA generado", v: formatCOP(r.ivaGenerado) },
                { k: "(−) IVA descontable", v: `− ${formatCOP(r.ivaDescontable)}` },
                { k: "= IVA por pagar", v: formatCOP(r.ivaPorPagar), total: true, color: "var(--brand-primary)" },
              ]} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Bloque({ titulo, filas }: { titulo: string; filas: { k: string; v: string; total?: boolean; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{titulo}</p>
      <table className="w-full text-sm">
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className={`${f.total ? "border-t border-gray-100 font-semibold" : ""}`}>
              <td className="py-1 text-gray-600">{f.k}</td>
              <td className="py-1 text-right tabular-nums" style={f.color ? { color: f.color } : { color: "#1f2937" }}>{f.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Select({ value, onChange, todos, options }: { value: string; onChange: (v: string) => void; todos: string; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]"
    >
      <option value={TODOS}>{todos}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function Tarjeta({ titulo, valor, sub, tono }: { titulo: string; valor: number; sub?: string; tono?: "primary" }) {
  const color = tono === "primary" ? "var(--brand-primary)" : "#111827";
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color }}>{formatCOP(valor)}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function uniques(arr: (string | null)[]): string[] {
  return Array.from(new Set(arr.filter((x): x is string => !!x && x.trim() !== ""))).sort();
}
