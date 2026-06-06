"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { EliminarDestinoBtn } from "../../tarifario/EliminarDestinoBtn";

type Dest = { id: number; nombre: string; codigo_iata: string | null; pais: string | null; hoteles: unknown };

export function DestinosLista({ destinos }: { destinos: Dest[] }) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtrados = q
    ? destinos.filter((d) => d.nombre.toLowerCase().includes(q) || (d.pais ?? "").toLowerCase().includes(q))
    : destinos;

  // Agrupar por país (los sin país van al final, en "Otros").
  const grupos = new Map<string, Dest[]>();
  for (const d of filtrados) {
    const key = d.pais?.trim() || "Otros";
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(d);
  }
  const paises = [...grupos.keys()].sort((a, b) => {
    if (a === "Otros") return 1;
    if (b === "Otros") return -1;
    return a.localeCompare(b, "es");
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o país…" className="max-w-xs" />
        <span className="text-xs text-gray-400">
          {filtrados.length} {filtrados.length === 1 ? "destino" : "destinos"}{q ? ` · filtrado de ${destinos.length}` : ""}
        </span>
      </div>

      {filtrados.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">Sin resultados para “{query}”.</p>
      ) : (
        <div className="space-y-8">
          {paises.map((pais) => (
            <section key={pais}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {pais} <span className="font-normal text-gray-400">({grupos.get(pais)!.length})</span>
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grupos.get(pais)!.map((d) => (
                  <div key={d.id} className="group relative rounded-xl border border-gray-200 bg-white p-5">
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold text-gray-900">
                        {d.nombre?.toUpperCase()}
                        {d.codigo_iata && <span className="font-normal text-gray-400"> ({d.codigo_iata})</span>}
                      </h3>
                      <span className="rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-500">
                        {(d.hoteles as { count: number }[])?.[0]?.count ?? 0} hoteles
                      </span>
                    </div>
                    <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <EliminarDestinoBtn id={d.id} nombre={d.nombre} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
