"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { eliminarPaqueteTotal, publicarPaqueteTotal } from "./actions";

export type FilaTotal = { id: number; nombre: string; moneda: string; esquema: string; pvp_modo: string | null; activo: boolean; publicado: boolean };

export function ListadoTotales({ filas }: { filas: FilaTotal[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (!filas.length) return null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; avisos?: string[] }>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? (r.avisos?.[0] ?? null) : (r.error ?? "No se pudo completar."));
    router.refresh();
  });
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-semibold text-gray-900">Paquetes dinámicos totales</h2>
      <p className="mb-3 text-sm text-gray-500">Producto propio con vuelo, hotel y servicios cargados en el paquete. Se publican en la sección «Dinámicos» del tarifario.</p>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {filas.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div>
              <Link href={`/dashboard/paquetes/total/${f.id}`} className="font-medium text-gray-900 underline-offset-2 hover:underline">{f.nombre}</Link>
              <span className="ml-2 text-xs text-gray-500">{f.moneda} · {f.esquema === "neta_markup" ? "Netas + markup" : f.pvp_modo === "general" ? "Solo PVP · general" : "Solo PVP · por componente"}</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${f.publicado ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{f.publicado ? "Publicado" : "Sin publicar"}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => publicarPaqueteTotal(f.id, !f.publicado))}>{f.publicado ? "Retirar" : "Publicar"}</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (confirm(`¿Eliminar «${f.nombre}»?`)) run(() => eliminarPaqueteTotal(f.id)); }}>Eliminar</Button>
            </div>
          </li>
        ))}
      </ul>
      {msg && <p role="status" className="mt-2 text-sm text-red-600">{msg}</p>}
    </section>
  );
}
