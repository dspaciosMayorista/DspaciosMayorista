"use client";

import { useState, useTransition } from "react";
import { formatCOP } from "@/lib/utils";
import { agregarDescuentoLiquidacion, eliminarDescuentoLiquidacion } from "./actions";
import { ChevronDown, ChevronRight } from "lucide-react";

export type DescuentoRow = { id: number; valor: number; descripcion: string | null; numero_contrato: string | null };

export type FilaLiquidacion = {
  id: string;
  nombre: string;
  sinEscala: boolean;
  contratos: number;
  pvp: number;
  base: number;
  pct: number;
  bruta: number;
  retencion: number;
  neta: number;
  descuentos: DescuentoRow[];
};

export function LiquidacionTable({ filas, mes }: { filas: FilaLiquidacion[]; mes: string }) {
  const tot = filas.reduce(
    (s, f) => {
      const desc = f.descuentos.reduce((a, d) => a + d.valor, 0);
      return {
        pvp: s.pvp + f.pvp,
        base: s.base + f.base,
        bruta: s.bruta + f.bruta,
        descuentos: s.descuentos + desc,
        netaFinal: s.netaFinal + Math.max(0, f.neta - desc),
      };
    },
    { pvp: 0, base: 0, bruta: 0, descuentos: 0, netaFinal: 0 }
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
            <th className="px-3 py-2">Asesor</th>
            <th className="px-3 py-2 text-center">Contratos</th>
            <th className="px-3 py-2 text-right">Σ PVP mes</th>
            <th className="px-3 py-2 text-right">Σ Base comis.</th>
            <th className="px-3 py-2 text-right">%</th>
            <th className="px-3 py-2 text-right">Comisión bruta</th>
            <th className="px-3 py-2 text-right">Retención</th>
            <th className="px-3 py-2 text-right">Descuentos</th>
            <th className="px-3 py-2 text-right">Neta a pagar</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => <FilaAsesor key={f.id} f={f} mes={mes} />)}
          {!filas.length && (
            <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">Sin ventas en el mes.</td></tr>
          )}
        </tbody>
        {filas.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Totales</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCOP(tot.pvp)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCOP(tot.base)}</td>
              <td />
              <td className="px-3 py-2 text-right tabular-nums">{formatCOP(tot.bruta)}</td>
              <td />
              <td className="px-3 py-2 text-right tabular-nums text-red-500">
                {tot.descuentos > 0 ? `− ${formatCOP(tot.descuentos)}` : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(tot.netaFinal)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function FilaAsesor({ f, mes }: { f: FilaLiquidacion; mes: string }) {
  const [abierto, setAbierto] = useState(false);
  const totalDescuentos = f.descuentos.reduce((s, d) => s + d.valor, 0);
  const netaFinal = Math.max(0, f.neta - totalDescuentos);

  return (
    <>
      <tr className="border-t border-gray-50">
        <td className="px-3 py-2 text-gray-700">
          <button type="button" onClick={() => setAbierto((o) => !o)} className="mr-1 align-middle text-gray-400 hover:text-gray-600">
            {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {f.nombre}
          {f.sinEscala && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-600">sin escala</span>}
        </td>
        <td className="px-3 py-2 text-center tabular-nums text-gray-500">{f.contratos}</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatCOP(f.pvp)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatCOP(f.base)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{f.pct}%</td>
        <td className="px-3 py-2 text-right tabular-nums">{formatCOP(f.bruta)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatCOP(f.retencion)}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {totalDescuentos > 0 ? (
            <button type="button" onClick={() => setAbierto(true)} className="text-red-500 hover:underline">
              − {formatCOP(totalDescuentos)}
            </button>
          ) : (
            <button type="button" onClick={() => setAbierto(true)} className="text-gray-300 hover:text-gray-500 hover:underline">
              Agregar →
            </button>
          )}
        </td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(netaFinal)}</td>
      </tr>
      {abierto && (
        <tr className="border-t border-gray-100 bg-gray-50/60">
          <td colSpan={9} className="px-4 py-3">
            <DescuentosPanel usuarioId={f.id} mes={mes} descuentos={f.descuentos} />
          </td>
        </tr>
      )}
    </>
  );
}

function DescuentosPanel({ usuarioId, mes, descuentos }: { usuarioId: string; mes: string; descuentos: DescuentoRow[] }) {
  const [valor, setValor] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [contrato, setContrato] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [pendingDel, startDel] = useTransition();

  function agregar() {
    setErr("");
    const v = Number(valor);
    if (!v || v <= 0) { setErr("Ingresa un valor mayor a 0."); return; }
    if (!descripcion.trim()) { setErr("Describe el motivo del descuento."); return; }
    start(async () => {
      const r = await agregarDescuentoLiquidacion({ usuarioId, mes, valor: v, descripcion, numeroContrato: contrato || undefined });
      if (!r.ok) { setErr(r.error); return; }
      setValor(""); setDescripcion(""); setContrato("");
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Descuentos del mes</p>
        {descuentos.length === 0 ? (
          <p className="text-sm text-gray-400">Sin descuentos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {descuentos.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="py-1 pr-2 text-gray-500">
                    {d.descripcion || "—"}
                    {d.numero_contrato && <span className="ml-1 text-xs text-gray-400">· {d.numero_contrato}</span>}
                  </td>
                  <td className="py-1 text-right tabular-nums text-red-500">− {formatCOP(d.valor)}</td>
                  <td className="w-6 py-1 text-right">
                    <button
                      type="button"
                      disabled={pendingDel}
                      onClick={() => startDel(async () => void (await eliminarDescuentoLiquidacion(d.id)))}
                      className="text-xs text-gray-300 hover:text-red-500 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1 text-gray-600">Total descuentos</td>
                <td className="py-1 text-right tabular-nums text-red-500" colSpan={2}>
                  − {formatCOP(descuentos.reduce((s, d) => s + d.valor, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Agregar descuento</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[11px] text-gray-500">Valor</label>
            <input
              type="number" min={0} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0"
              className="h-9 w-32 rounded-lg border border-gray-300 px-2 text-sm"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="block text-[11px] text-gray-500">Descripción</label>
            <input
              type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. descuento al cliente contrato 00-0451"
              className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500">N° contrato (opcional)</label>
            <input
              type="text" value={contrato} onChange={(e) => setContrato(e.target.value)} placeholder="00-0451"
              className="h-9 w-28 rounded-lg border border-gray-300 px-2 text-sm"
            />
          </div>
          <button
            type="button" onClick={agregar} disabled={pending}
            className="h-9 rounded-lg px-3 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            {pending ? "…" : "Agregar"}
          </button>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
