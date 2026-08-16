"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatFechaLarga } from "@/lib/utils";
import { EliminarBloqueoBtn } from "./EliminarBloqueoBtn";
import { mesKey, mesLabel } from "@/lib/vuelos/filtros";

// Tabla de INVENTARIO: sillas y ocupación por record. El control de
// modalidad/emisión/pago vive en su propia pestaña — ver `ControlVuelosTabla`.
export type BloqueoFila = {
  id: number;
  record: string;
  aerolinea: string | null;
  ruta: string | null;
  fecha_ida: string | null;
  vuelo_ida: string | null;
  fecha_regreso: string | null;
  vuelo_regreso: string | null;
  fecha_devolucion: string | null;
  cupos_total: number;
  disp: number; plazo: number; conf: number; dev: number; nven: number;
};

export function BloqueosTabla({ filas }: { filas: BloqueoFila[] }) {
  const [fRuta, setFRuta] = useState("");
  const [fMes, setFMes] = useState("");

  const rutas = useMemo(() => [...new Set(filas.map((b) => b.ruta).filter((x): x is string => !!x))].sort(), [filas]);
  const meses = useMemo(() => [...new Set(filas.map((b) => mesKey(b.fecha_ida)).filter(Boolean))].sort(), [filas]);

  const vis = useMemo(
    () => filas.filter((b) => (!fRuta || b.ruta === fRuta) && (!fMes || mesKey(b.fecha_ida) === fMes)),
    [filas, fRuta, fMes]
  );

  // TOTAL real = sillas que pertenecen al record AHORA (todas menos las que
  // salieron a otro record en estado 'cambio', que no se cuentan en ningún
  // estado). Así el total y la ocupación quedan siempre consistentes con las
  // sillas reales, aunque el campo cupos_total guardado se haya desfasado por
  // cambios entre records.
  const totalReal = (b: BloqueoFila) => b.disp + b.plazo + b.conf + b.dev + b.nven;

  const tot = vis.reduce(
    (a, b) => ({
      disp: a.disp + b.disp, plazo: a.plazo + b.plazo, conf: a.conf + b.conf,
      dev: a.dev + b.dev, nven: a.nven + b.nven, total: a.total + totalReal(b),
    }),
    { disp: 0, plazo: 0, conf: 0, dev: 0, nven: 0, total: 0 }
  );
  const ocupProm = tot.total > 0 ? Math.round(((tot.plazo + tot.conf) / tot.total) * 100) : 0;

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div>
      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={fRuta} onChange={(e) => setFRuta(e.target.value)} className={selCls} aria-label="Filtrar por ruta">
          <option value="">Ruta: todas</option>
          {rutas.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={fMes} onChange={(e) => setFMes(e.target.value)} className={selCls} aria-label="Filtrar por mes de salida">
          <option value="">Mes: todos</option>
          {meses.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
        {(fRuta || fMes) && (
          <button
            type="button"
            onClick={() => { setFRuta(""); setFMes(""); }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{vis.length} bloque(s)</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[1020px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Record</th>
              <th className="px-3 py-2">Aerolínea</th>
              <th className="px-3 py-2">Ruta</th>
              <th className="px-3 py-2">Ida</th>
              <th className="px-3 py-2">Regreso</th>
              <th className="px-3 py-2 text-center">Disp</th>
              <th className="px-3 py-2 text-center">Plazo</th>
              <th className="px-3 py-2 text-center">Conf</th>
              <th className="px-3 py-2 text-center">Dev</th>
              <th className="px-3 py-2 text-center">N.Ven</th>
              <th className="px-3 py-2 text-center">Total</th>
              <th className="px-3 py-2 text-center">Ocup.</th>
              <th className="px-3 py-2">F. Dev.</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {vis.map((b) => {
              const total = totalReal(b);
              const ocup = total > 0 ? Math.round(((b.plazo + b.conf) / total) * 100) : 0;
              return (
                <tr key={b.id} className="border-t border-gray-50">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/vuelos/${b.id}`} className="font-mono text-sm font-semibold text-[#1D7C9A] hover:underline">{b.record}</Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{b.aerolinea ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{b.ruta ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(b.fecha_ida)}{b.vuelo_ida ? ` · ${b.vuelo_ida}` : ""}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(b.fecha_regreso)}{b.vuelo_regreso ? ` · ${b.vuelo_regreso}` : ""}</td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums" style={{ color: "var(--brand-success)" }}>{b.disp}</td>
                  <td className="px-3 py-2 text-center tabular-nums" style={{ color: "#C99A2E" }}>{b.plazo}</td>
                  <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--brand-accent)" }}>{b.conf}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-red-600">{b.dev}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-gray-400">{b.nven}</td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">{total}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-gray-500">{ocup}%</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{formatFechaLarga(b.fecha_devolucion)}</td>
                  <td className="px-3 py-2 text-right"><EliminarBloqueoBtn id={b.id} record={b.record} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="px-3 py-2" colSpan={5}>TOTAL ({vis.length} bloques)</td>
              <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--brand-success)" }}>{tot.disp}</td>
              <td className="px-3 py-2 text-center tabular-nums" style={{ color: "#C99A2E" }}>{tot.plazo}</td>
              <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--brand-accent)" }}>{tot.conf}</td>
              <td className="px-3 py-2 text-center tabular-nums text-red-600">{tot.dev}</td>
              <td className="px-3 py-2 text-center tabular-nums text-gray-400">{tot.nven}</td>
              <td className="px-3 py-2 text-center tabular-nums">{tot.total}</td>
              <td className="px-3 py-2 text-center tabular-nums text-gray-500">{ocupProm}%</td>
              <td className="px-3 py-2" colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
