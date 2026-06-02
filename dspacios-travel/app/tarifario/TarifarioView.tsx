"use client";

import { useState } from "react";
import { calcPreciosTarifa } from "@/lib/calc/tarifario";
import { formatCOP } from "@/lib/utils";

type TarifaPrecio = { acomodacion: string; precio: number };
type Tarifa = {
  id: number;
  noches: number;
  comisionable: boolean;
  impuesto_no_comisionable: number;
  notas: string | null;
  planes_alimentacion: { codigo: string; nombre: string } | null;
  temporadas: { nombre: string; anio: number } | null;
  tarifa_precios: TarifaPrecio[];
};
type Hotel = { id: number; nombre: string; zona: string | null; tarifas: Tarifa[] };
type Inclusion = { tipo: string; texto: string; orden: number };
type Destino = { id: number; nombre: string; codigo_iata: string | null; hoteles: Hotel[]; inclusiones: Inclusion[] };

const TEMP_COLOR: Record<string, string> = {
  ALTA: "text-red-600 bg-red-50",
  MEDIA: "text-yellow-600 bg-yellow-50",
  BAJA: "text-green-600 bg-green-50",
};

const ACOM_LABELS: Record<string, string> = {
  sencilla: "Sencilla",
  doble: "Doble",
  triple: "Triple",
  multiple: "Múltiple",
  nino: "Niño",
};

export function TarifarioView({ destinos, esAgencia }: { destinos: Destino[]; esAgencia: boolean }) {
  const [destinoActivo, setDestinoActivo] = useState(destinos[0]?.id ?? null);
  const destino = destinos.find((d) => d.id === destinoActivo);

  return (
    <div className="flex gap-6">
      {/* Sidebar de destinos */}
      <aside className="w-48 shrink-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Destinos</p>
        <nav className="space-y-1">
          {destinos.map((d) => (
            <button
              key={d.id}
              onClick={() => setDestinoActivo(d.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                d.id === destinoActivo
                  ? "bg-[#1D7C9A] text-white font-medium"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {d.nombre}
              {d.codigo_iata && (
                <span className={`ml-1 text-xs font-mono ${d.id === destinoActivo ? "opacity-70" : "text-gray-400"}`}>
                  {d.codigo_iata}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Contenido del destino */}
      <div className="flex-1 min-w-0">
        {!destino ? null : (
          <div className="space-y-6">
            {/* Hotels */}
            {destino.hoteles.length === 0 ? (
              <p className="text-gray-400 text-sm">Sin tarifas cargadas para este destino.</p>
            ) : (
              destino.hoteles.map((hotel) => (
                <HotelCard key={hotel.id} hotel={hotel} esAgencia={esAgencia} />
              ))
            )}

            {/* Incluye / No incluye */}
            {destino.inclusiones.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 mt-4">
                <h3 className="font-semibold text-gray-700 mb-4 text-sm">Condiciones del paquete</h3>
                <div className="grid grid-cols-2 gap-6">
                  {["incluye", "no_incluye"].map((tipo) => {
                    const items = destino.inclusiones.filter((i) => i.tipo === tipo).sort((a, b) => a.orden - b.orden);
                    if (!items.length) return null;
                    return (
                      <div key={tipo}>
                        <p className={`text-xs font-semibold mb-2 ${tipo === "incluye" ? "text-[#66B596]" : "text-red-500"}`}>
                          {tipo === "incluye" ? "✓ Incluye" : "✗ No incluye"}
                        </p>
                        <ul className="space-y-1">
                          {items.map((i, idx) => (
                            <li key={idx} className="text-xs text-gray-600 flex gap-1.5">
                              <span className={tipo === "incluye" ? "text-[#66B596]" : "text-red-400"}>
                                {tipo === "incluye" ? "•" : "•"}
                              </span>
                              {i.texto}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HotelCard({ hotel, esAgencia }: { hotel: Hotel; esAgencia: boolean }) {
  // Agrupar tarifas por temporada
  const tarifasPorTemporada = new Map<string, Tarifa[]>();
  hotel.tarifas.forEach((t) => {
    if (!t.temporadas) return;
    const key = `${t.temporadas.nombre} ${t.temporadas.anio}`;
    if (!tarifasPorTemporada.has(key)) tarifasPorTemporada.set(key, []);
    tarifasPorTemporada.get(key)!.push(t);
  });

  if (tarifasPorTemporada.size === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
        <h2 className="font-semibold text-gray-800">{hotel.nombre}</h2>
        {hotel.zona && <p className="text-xs text-gray-400 mt-0.5">{hotel.zona}</p>}
      </div>

      <div className="divide-y divide-gray-100">
        {[...tarifasPorTemporada.entries()].map(([tempKey, tarifas]) => {
          const temp = tarifas[0].temporadas!;
          return (
            <div key={tempKey} className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TEMP_COLOR[temp.nombre] ?? "bg-gray-100 text-gray-600"}`}>
                  {temp.nombre}
                </span>
                <span className="text-xs text-gray-400">{temp.anio}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wider">
                      <th className="text-left pb-2 pr-4 font-medium">Plan</th>
                      <th className="text-left pb-2 pr-4 font-medium">Noches</th>
                      {["sencilla", "doble", "triple", "multiple", "nino"].map((a) => (
                        <th key={a} className="text-right pb-2 px-2 font-medium">{ACOM_LABELS[a]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tarifas.map((t) => (
                      <TarifaRow key={t.id} tarifa={t} esAgencia={esAgencia} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TarifaRow({ tarifa, esAgencia }: { tarifa: Tarifa; esAgencia: boolean }) {
  const precioMap = Object.fromEntries(tarifa.tarifa_precios.map((p) => [p.acomodacion, p.precio]));

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="py-2 pr-4 font-medium text-gray-700">
        {tarifa.planes_alimentacion?.codigo ?? "—"}
        <span className="text-xs text-gray-400 ml-1 font-normal">{tarifa.planes_alimentacion?.nombre}</span>
      </td>
      <td className="py-2 pr-4 text-gray-500">{tarifa.noches}n</td>
      {["sencilla", "doble", "triple", "multiple", "nino"].map((acom) => {
        const precio = precioMap[acom];
        if (!precio) return <td key={acom} className="py-2 px-2 text-right text-gray-300 text-xs">N/A</td>;

        const calc = calcPreciosTarifa(precio, tarifa.impuesto_no_comisionable ?? 0);

        return (
          <td key={acom} className="py-2 px-2 text-right">
            <div className="font-semibold text-gray-800" style={{ color: "var(--brand-primary)" }}>
              {formatCOP(precio)}
            </div>
            {esAgencia && (
              <div className="text-xs text-[#26BBD9] mt-0.5" title="Tarifa neta agencia">
                Neta: {formatCOP(calc.tarifaNetaAgencia)}
              </div>
            )}
            {tarifa.impuesto_no_comisionable > 0 && (
              <div className="text-xs text-gray-400 mt-0.5">
                +{formatCOP(tarifa.impuesto_no_comisionable)} imp.
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}
