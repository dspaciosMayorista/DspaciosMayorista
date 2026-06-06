"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Paginador } from "@/components/Paginador";
import { EliminarHotelBtn } from "./EliminarHotelBtn";

type Item = { id: number; nombre: string; zona: string | null; destinos: { nombre: string } | null; proveedores: { nombre: string } | null };

export function HotelesLista({ hoteles }: { hoteles: Item[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 12;

  const filtrados = query.trim()
    ? hoteles.filter((h) => h.nombre.toLowerCase().includes(query.trim().toLowerCase()))
    : hoteles;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaActual = Math.min(page, totalPaginas - 1);
  const visibles = filtrados.slice(paginaActual * PAGE_SIZE, paginaActual * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Buscar por nombre…" className="max-w-xs" />
        <span className="text-xs text-gray-400">
          {filtrados.length} {filtrados.length === 1 ? "hotel" : "hoteles"}{query.trim() ? ` · filtrado de ${hoteles.length}` : ""}
        </span>
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">Sin resultados para “{query}”.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((h) => (
            <div key={h.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/dashboard/producto/hoteles/${h.id}`} className="font-semibold text-gray-900 hover:text-[#1D7C9A]">
                  {h.nombre}
                </Link>
                <EliminarHotelBtn id={h.id} nombre={h.nombre} />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {h.destinos?.nombre ?? "—"}{h.zona ? ` · ${h.zona}` : ""}
              </p>
              <p className="text-xs text-gray-400">{h.proveedores?.nombre ?? "Sin proveedor"}</p>
              <Link href={`/dashboard/producto/hoteles/${h.id}`} className="mt-2 inline-block text-xs font-medium text-[#26BBD9]">
                Gestionar tarifas →
              </Link>
            </div>
          ))}
        </div>
      )}

      <Paginador page={paginaActual} totalPaginas={totalPaginas} onPage={setPage} />
    </div>
  );
}
