"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { calcularNetoPrograma, type ModoBaseComisionable } from "@/lib/calc/programaPrecio";
import { pvpPrograma } from "@/lib/programas";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

type Fila = { etiqueta: string; tarifa: string };

export function CalculadoraProgramas() {
  // Regla común del proveedor
  const [moneda, setMoneda] = useState("USD");
  const [modo, setModo] = useState<ModoBaseComisionable>("pct");
  const [valor, setValor] = useState("3"); // % o monto del impuesto
  const [pctComision, setPctComision] = useState("10");

  // Config de montaje (opcional) para ver el PVP final
  const [verPvp, setVerPvp] = useState(false);
  const [pctMk, setPctMk] = useState("25");
  const [pctFee, setPctFee] = useState("3");
  const [asistencia, setAsistencia] = useState("0");
  const [dias, setDias] = useState("");

  const [filas, setFilas] = useState<Fila[]>([{ etiqueta: "", tarifa: "" }]);
  const upd = (i: number, k: keyof Fila, v: string) => setFilas((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const calc = (tarifaStr: string) => {
    const tarifa = Number(tarifaStr);
    if (!Number.isFinite(tarifa) || tarifa <= 0) return null;
    const res = calcularNetoPrograma({ tarifa, modo, valor: Number(valor) || 0, pctComision: Number(pctComision) || 0 });
    const pvp = verPvp
      ? pvpPrograma(res.neto, {
          pctMk: (Number(pctMk) || 0) / 100,
          pctFee: (Number(pctFee) || 0) / 100,
          asistenciaDia: Number(asistencia) || 0,
          dias: dias === "" ? null : Number(dias),
        })
      : null;
    return { ...res, pvp };
  };

  return (
    <div className="space-y-6">
      {/* Regla del proveedor */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Regla del proveedor</h2>
        <p className="mb-4 text-xs text-gray-500">
          Cómo se obtiene la base comisionable a partir de la tarifa. Luego: comisión = base × %; <b>neto = tarifa − comisión</b>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className={lbl}>Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className={sel}>
              <option value="USD">USD</option>
              <option value="COP">COP</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Base comisionable</label>
            <select value={modo} onChange={(e) => setModo(e.target.value as ModoBaseComisionable)} className={sel}>
              <option value="pct">Tarifa − %</option>
              <option value="impuesto">Tarifa − impuesto (monto)</option>
              <option value="ninguno">Tarifa (no se resta nada)</option>
            </select>
          </div>
          {modo !== "ninguno" && (
            <div>
              <label className={lbl}>{modo === "pct" ? "% a restar" : `Impuesto (${moneda})`}</label>
              <Input type="number" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={modo === "pct" ? "3" : "0"} />
            </div>
          )}
          <div>
            <label className={lbl}>% de comisión</label>
            <Input type="number" value={pctComision} onChange={(e) => setPctComision(e.target.value)} placeholder="10" />
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={verPvp} onChange={(e) => setVerPvp(e.target.checked)} />
          Ver también el PVP final (aplica MK + asistencia + fee sobre el neto)
        </label>
        {verPvp && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className={lbl}>Markup %</label><Input type="number" value={pctMk} onChange={(e) => setPctMk(e.target.value)} placeholder="25" /></div>
            <div><label className={lbl}>Fee bancario %</label><Input type="number" value={pctFee} onChange={(e) => setPctFee(e.target.value)} placeholder="3" /></div>
            <div><label className={lbl}>Asistencia/día ({moneda})</label><Input type="number" value={asistencia} onChange={(e) => setAsistencia(e.target.value)} placeholder="0" /></div>
            <div><label className={lbl}>Días</label><Input type="number" value={dias} onChange={(e) => setDias(e.target.value)} placeholder="—" /></div>
          </div>
        )}
      </section>

      {/* Tarifas → neto */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Tarifas del proveedor</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-2 py-2">Etiqueta (opcional)</th>
                <th className="px-2 py-2 text-right">Tarifa</th>
                <th className="px-2 py-2 text-right">Base comis.</th>
                <th className="px-2 py-2 text-right">Comisión</th>
                <th className="px-2 py-2 text-right">Neto (a montar)</th>
                {verPvp && <th className="px-2 py-2 text-right">PVP final</th>}
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const r = calc(f.tarifa);
                return (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-2 py-1.5">
                      <Input value={f.etiqueta} onChange={(e) => upd(i, "etiqueta", e.target.value)} placeholder="Hotel / categoría" className="w-44" />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Input type="number" value={f.tarifa} onChange={(e) => upd(i, "tarifa", e.target.value)} placeholder="0" className="w-28 text-right" />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{r ? formatMoneda(r.baseComisionable, moneda) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{r ? formatMoneda(r.comision, moneda) : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{r ? formatMoneda(r.neto, moneda) : "—"}</td>
                    {verPvp && <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: "var(--brand-success)" }}>{r?.pvp != null ? formatMoneda(r.pvp, moneda) : "—"}</td>}
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={() => setFilas((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label="Quitar">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <button type="button" onClick={() => setFilas((p) => [...p, { etiqueta: "", tarifa: "" }])} className="text-sm font-medium text-[#1D7C9A] hover:underline">
            + Agregar tarifa
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          El <b>Neto (a montar)</b> es el valor que cargas en el programa (en “Hoteles y precios” o “Salidas y precios”), donde se le aplican tu Markup + asistencia + fee.
        </p>
      </section>
    </div>
  );
}
