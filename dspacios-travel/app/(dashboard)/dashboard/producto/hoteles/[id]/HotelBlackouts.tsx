"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { crearBlackout, eliminarBlackout } from "./blackouts-actions";

export type Blackout = { id: number; fecha_inicio: string; fecha_fin: string; total: boolean; acomodaciones: string[] | null; categorias?: string[] | null; motivo: string | null };

// Texto del cierre parcial ya guardado. Lista vacía/null = "todas", así que un
// cierre solo por categoría no debe leerse como si no cerrara nada.
function describirCierre(b: Blackout): string {
  const cats = b.categorias ?? [];
  const acoms = (b.acomodaciones ?? []).map((a) => ACOM_ROOM_LABEL[a as AcomRoom] ?? a);
  if (cats.length && acoms.length) return `${acoms.join(", ")} en ${cats.join(", ")}`;
  if (cats.length) return `Categoría${cats.length > 1 ? "s" : ""}: ${cats.join(", ")}`;
  if (acoms.length) return `${acoms.join(", ")} (todas las categorías)`;
  return "Cierre parcial";
}

export function HotelBlackouts({ hotelId, blackouts, categorias = [] }: { hotelId: number; blackouts: Blackout[]; categorias?: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ini, setIni] = useState("");
  const [fin, setFin] = useState("");
  const [total, setTotal] = useState(true);
  const [acoms, setAcoms] = useState<AcomRoom[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function toggleAcom(a: AcomRoom) { setAcoms((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a])); }
  function toggleCat(c: string) { setCats((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c])); }

  function agregar() {
    setErr("");
    start(async () => {
      const r = await crearBlackout({ hotelId, fechaInicio: ini, fechaFin: fin, total, acomodaciones: acoms, categorias: cats, motivo });
      if (r.ok) { setIni(""); setFin(""); setTotal(true); setAcoms([]); setCats([]); setMotivo(""); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Black out general <span className="font-normal text-gray-400">({blackouts.length})</span></span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500">Cierra la venta del hotel en esas noches, por encima de cualquier vigencia. Cierre total o por acomodaciones.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="mb-1 block text-xs text-gray-600">Desde (noche)</label><Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></div>
            <div><label className="mb-1 block text-xs text-gray-600">Hasta (noche)</label><Input type="date" value={fin} min={ini || undefined} onChange={(e) => setFin(e.target.value)} /></div>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-600"><input type="checkbox" checked={total} onChange={(e) => setTotal(e.target.checked)} /> Cierre total (todas las habitaciones)</label>
          </div>
          {!total && (
            <div className="space-y-3 rounded-lg bg-gray-50 p-3">
              {categorias.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-600">Categorías a cerrar</p>
                  <div className="flex flex-wrap gap-3">
                    {categorias.map((c) => (
                      <label key={c} className="flex items-center gap-1 text-sm text-gray-600">
                        <input type="checkbox" checked={cats.includes(c)} onChange={() => toggleCat(c)} /> {c}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">Ninguna marcada = todas las categorías.</p>
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">Acomodaciones a cerrar</p>
                <div className="flex flex-wrap gap-3">
                  {ACOM_ROOMS.map((a) => (
                    <label key={a} className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" checked={acoms.includes(a)} onChange={() => toggleAcom(a)} /> {ACOM_ROOM_LABEL[a]}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">Ninguna marcada = todas las acomodaciones.</p>
              </div>
              <p className="text-[11px] text-gray-500">
                {cats.length > 0 && acoms.length > 0
                  ? `Cierra ${acoms.map((a) => ACOM_ROOM_LABEL[a]).join(", ")} solo en ${cats.join(", ")}. El resto sigue a la venta.`
                  : cats.length > 0
                    ? `Cierra ${cats.join(", ")} por completo. Las demás categorías siguen a la venta.`
                    : acoms.length > 0
                      ? `Cierra ${acoms.map((a) => ACOM_ROOM_LABEL[a]).join(", ")} en todas las categorías.`
                      : "Marca al menos una categoría o una acomodación."}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1"><label className="mb-1 block text-xs text-gray-600">Motivo (opcional)</label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Sin disponibilidad / mantenimiento" /></div>
            <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Agregar cierre"}</Button>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}

          {blackouts.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {blackouts.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-gray-700">
                    {b.fecha_inicio} → {b.fecha_fin} · {b.total ? "Cierre total" : describirCierre(b)}
                    {b.motivo ? ` · ${b.motivo}` : ""}
                  </span>
                  <button type="button" onClick={() => start(() => { void eliminarBlackout(b.id, hotelId).then(() => router.refresh()); })} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
