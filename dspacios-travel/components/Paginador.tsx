"use client";

import { Button } from "@/components/ui/button";

// Control simple de paginación (Anterior / Página X de Y / Siguiente).
// No renderiza nada si hay una sola página.
export function Paginador({ page, totalPaginas, onPage }: { page: number; totalPaginas: number; onPage: (p: number) => void }) {
  if (totalPaginas <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-1">
      <Button variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>← Anterior</Button>
      <span className="text-sm text-gray-500">Página {page + 1} de {totalPaginas}</span>
      <Button variant="outline" disabled={page >= totalPaginas - 1} onClick={() => onPage(page + 1)}>Siguiente →</Button>
    </div>
  );
}
