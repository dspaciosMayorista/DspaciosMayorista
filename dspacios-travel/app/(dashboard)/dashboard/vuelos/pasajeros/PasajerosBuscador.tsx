"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatFechaLarga } from "@/lib/utils";

export type PasajeroFila = {
  sillaId: number;
  numeroSilla: number | null;
  estado: string;
  nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string;
  contrato: string; asesor: string; agencia: string; hotel: string; acomodacion: string;
  bloqueoId: number | null;
  record: string; ruta: string; fechaIda: string | null; vueloIda: string;
  fechaRegreso: string | null; vueloRegreso: string;
};

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const mesKey = (f: string | null) => (f ? f.slice(0, 7) : "");
const mesLabel = (k: string) => { const [y, m] = k.split("-"); return `${MESES[Number(m) - 1] ?? m} ${y}`; };

const ESTADO_LABEL: Record<string, string> = {
  disponible: "Disponible", en_plazo: "En plazo", confirmada: "Confirmada",
  devuelta: "Devuelta", no_vendida: "No vendida", cambio: "Cambio", cambio_entrante: "Cambio entrante",
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function PasajerosBuscador({ filas }: { filas: PasajeroFila[] }) {
  const [q, setQ] = useState("");
  const [fMes, setFMes] = useState("");

  const meses = useMemo(() => [...new Set(filas.map((p) => mesKey(p.fechaIda)).filter(Boolean))].sort(), [filas]);

  const vis = useMemo(() => {
    const term = norm(q.trim());
    return filas
      .filter((p) => !fMes || mesKey(p.fechaIda) === fMes)
      .filter((p) => {
        if (!term) return true;
        const hay = norm(`${p.nombres} ${p.apellidos} ${p.numeroDoc} ${p.contrato}`);
        return hay.includes(term);
      })
      .sort((a, b) => (a.fechaIda ?? "").localeCompare(b.fechaIda ?? "") || a.apellidos.localeCompare(b.apellidos));
  }, [filas, q, fMes]);

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, apellido, documento o contrato…"
          className="min-w-[260px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <select value={fMes} onChange={(e) => setFMes(e.target.value)} className={selCls} aria-label="Filtrar por mes de viaje">
          <option value="">Mes de viaje: todos</option>
          {meses.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
        {(q || fMes) && (
          <button type="button" onClick={() => { setQ(""); setFMes(""); }} className="text-xs font-medium text-gray-500 hover:text-gray-800">Limpiar</button>
        )}
        <span className="ml-auto text-xs text-gray-400">{vis.length} pasajero(s)</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Pasajero</th>
              <th className="px-3 py-2">Documento</th>
              <th className="px-3 py-2">Contrato</th>
              <th className="px-3 py-2">Record</th>
              <th className="px-3 py-2">Ruta</th>
              <th className="px-3 py-2">Ida</th>
              <th className="px-3 py-2">Regreso</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Hotel</th>
              <th className="px-3 py-2">Asesor</th>
            </tr>
          </thead>
          <tbody>
            {vis.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">Sin pasajeros para esta búsqueda.</td></tr>
            ) : vis.map((p) => (
              <tr key={p.sillaId} className="border-t border-gray-50">
                <td className="px-3 py-2 font-medium text-gray-800">{`${p.nombres} ${p.apellidos}`.trim()}</td>
                <td className="px-3 py-2 text-gray-600">{p.tipoDoc} {p.numeroDoc}</td>
                <td className="px-3 py-2 text-gray-600">{p.contrato || "—"}</td>
                <td className="px-3 py-2">
                  {p.bloqueoId
                    ? <Link href={`/dashboard/vuelos/${p.bloqueoId}`} className="font-mono font-semibold text-[#1D7C9A] hover:underline">{p.record}</Link>
                    : <span className="font-mono">{p.record}</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">{p.ruta || "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(p.fechaIda)}{p.vueloIda ? ` · ${p.vueloIda}` : ""}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(p.fechaRegreso)}{p.vueloRegreso ? ` · ${p.vueloRegreso}` : ""}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{ESTADO_LABEL[p.estado] ?? p.estado}</td>
                <td className="px-3 py-2 text-gray-600">{p.hotel || "—"}</td>
                <td className="px-3 py-2 text-gray-600">{p.asesor || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
