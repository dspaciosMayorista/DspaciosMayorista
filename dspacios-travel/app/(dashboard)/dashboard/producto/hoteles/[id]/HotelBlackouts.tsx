"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { crearBlackout, eliminarBlackout } from "./blackouts-actions";
import { alternarVisibles, estadoVisibles } from "@/lib/paquetes/seleccionMasiva";
import { cierreNoAplicaAUnidad } from "@/lib/tarifario/cierresHotel";

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

export function HotelBlackouts({ hotelId, blackouts, categorias = [], esUnidad = false }: { hotelId: number; blackouts: Blackout[]; categorias?: string[]; esUnidad?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // La lista de la página es del servidor y se refresca DESPUÉS; la pantalla no espera ese refresco para reflejar lo que ya se confirmó: un cierre borrado sale al instante
  // (solo cuando la acción confirmó el borrado) y uno creado entra al instante. Cuando llega la lista nueva del servidor, manda ella.
  const [ocultos, setOcultos] = useState<ReadonlySet<number>>(new Set());
  const [agregados, setAgregados] = useState<readonly Blackout[]>([]);
  const [eliminando, setEliminando] = useState<ReadonlySet<number>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [estado, setEstado] = useState("");
  // Guardas SÍNCRONAS contra el doble clic (el estado de React aún no se repintó cuando entra el segundo clic).
  const enVuelo = useRef<Set<number>>(new Set());
  const guardandoRef = useRef(false);
  const [ini, setIni] = useState("");
  const [fin, setFin] = useState("");
  const [total, setTotal] = useState(true);
  const [acoms, setAcoms] = useState<AcomRoom[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState("");

  function toggleAcom(a: AcomRoom) { setAcoms((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a])); }
  function toggleCat(c: string) { setCats((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c])); }

  const visibles = [...blackouts.filter((b) => !ocultos.has(b.id)), ...agregados.filter((a) => !ocultos.has(a.id) && !blackouts.some((b) => b.id === a.id))].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));

  async function agregar() {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setErr(""); setEstado(""); setGuardando(true);
    try {
      const r = await crearBlackout({ hotelId, fechaInicio: ini, fechaFin: fin, total, acomodaciones: acoms, categorias: cats, motivo });
      if (!r.ok) { setErr(r.error); return; }
      if (r.id != null) setAgregados((p) => [...p, { id: r.id as number, fecha_inicio: ini, fecha_fin: fin, total, acomodaciones: total || !acoms.length ? null : acoms, categorias: total || !cats.length ? null : cats, motivo: motivo.trim() || null }]);
      setIni(""); setFin(""); setTotal(true); setAcoms([]); setCats([]); setMotivo("");
      if (r.aviso) setErr(r.aviso); else if (r.regeneracion === "diferida") setEstado("Cierre guardado. Los tarifarios se están actualizando en segundo plano.");
      router.refresh();
    } catch { setErr("No se pudo guardar el cierre. Intenta de nuevo."); }
    finally { guardandoRef.current = false; setGuardando(false); }
  }

  async function eliminar(b: Blackout) {
    if (enVuelo.current.has(b.id)) return;
    enVuelo.current.add(b.id);
    setErr(""); setEstado(""); setEliminando((p) => new Set(p).add(b.id));
    try {
      const r = await eliminarBlackout(b.id, hotelId);
      if (!r.ok) { setErr(r.error); return; }   // no se confirmó: la fila se queda
      setOcultos((p) => new Set(p).add(b.id));
      if (r.aviso) setErr(r.aviso); else if (r.regeneracion === "diferida") setEstado("Cierre eliminado. Los tarifarios se están actualizando en segundo plano.");
      router.refresh();
    } catch { setErr("No se pudo eliminar el cierre. Intenta de nuevo."); }
    finally { enVuelo.current.delete(b.id); setEliminando((p) => { const n = new Set(p); n.delete(b.id); return n; }); }
  }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Black out general <span className="font-normal text-gray-400">({visibles.length})</span></span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500">Cierra la venta del hotel en esas noches, por encima de cualquier vigencia. Cierre total o por acomodaciones.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="mb-1 block text-xs text-gray-600">Desde (noche)</label><DateInput aria-label="Desde (noche)" type="date" value={ini} onValueChange={(dateValue) => setIni(dateValue)} /></div>
            <div><label className="mb-1 block text-xs text-gray-600">Hasta (noche)</label><DateInput aria-label="Hasta (noche)" type="date" value={fin} min={ini || undefined} onValueChange={(dateValue) => setFin(dateValue)} /></div>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-600"><input type="checkbox" checked={total} onChange={(e) => setTotal(e.target.checked)} /> Cierre total (todas las habitaciones)</label>
          </div>
          {!total && (
            <div className="space-y-3 rounded-lg bg-gray-50 p-3">
              {categorias.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-600">Categorías a cerrar</p>
                  <MarcarTodas opciones={categorias} marcadas={cats} onChange={setCats} />
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
              {esUnidad ? (
                <p role="note" data-testid="cierre-unidad-nota" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Este hotel se tarifa por unidad: el cierre solo puede ser total o por categoría. El cierre por acomodación no se aplica a una tarifa por unidad (no hay equivalencia entre acomodación y unidad).
                </p>
              ) : (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">Acomodaciones a cerrar</p>
                <MarcarTodas opciones={ACOM_ROOMS} marcadas={acoms} onChange={setAcoms} />
                <div className="flex flex-wrap gap-3">
                  {ACOM_ROOMS.map((a) => (
                    <label key={a} className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" checked={acoms.includes(a)} onChange={() => toggleAcom(a)} /> {ACOM_ROOM_LABEL[a]}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">Ninguna marcada = todas las acomodaciones.</p>
              </div>
              )}
              <p className="text-[11px] text-gray-500">
                {cats.length > 0 && acoms.length > 0
                  ? `Cierra ${acoms.map((a) => ACOM_ROOM_LABEL[a]).join(", ")} solo en ${cats.join(", ")}. El resto sigue a la venta.`
                  : cats.length > 0
                    ? `Cierra ${cats.join(", ")} por completo. Las demás categorías siguen a la venta.`
                    : acoms.length > 0
                      ? `Cierra ${acoms.map((a) => ACOM_ROOM_LABEL[a]).join(", ")} en todas las categorías.`
                      : esUnidad ? "Marca al menos una categoría." : "Marca al menos una categoría o una acomodación."}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1"><label className="mb-1 block text-xs text-gray-600">Motivo (opcional)</label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Sin disponibilidad / mantenimiento" /></div>
            <Button onClick={agregar} disabled={guardando} style={{ backgroundColor: "var(--brand-primary)" }}>{guardando ? "Guardando…" : "Agregar cierre"}</Button>
          </div>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          {estado && <p role="status" className="text-sm text-gray-500">{estado}</p>}

          {visibles.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {visibles.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-gray-700">
                    {b.fecha_inicio} → {b.fecha_fin} · {b.total ? "Cierre total" : describirCierre(b)}
                    {b.motivo ? ` · ${b.motivo}` : ""}
                    {esUnidad && cierreNoAplicaAUnidad(b) && <span data-testid="cierre-no-aplica" className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">No aplica: tarifa por unidad</span>}
                  </span>
                  <button type="button" disabled={eliminando.has(b.id)} onClick={() => void eliminar(b)} className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50">{eliminando.has(b.id) ? "Eliminando…" : "Eliminar"}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// #50: casilla «Seleccionar todos» de una lista corta de opciones. Solo cambia la selección del formulario.
function MarcarTodas<T extends string>({ opciones, marcadas, onChange }: { opciones: readonly T[]; marcadas: readonly T[]; onChange: (v: T[]) => void }) {
  const sel = new Set(marcadas);
  const estado = estadoVisibles(sel, opciones);
  if (opciones.length < 2) return null;
  return (
    <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500">
      <input type="checkbox" checked={estado.checked} ref={(el) => { if (el) el.indeterminate = estado.indeterminate; }}
        onChange={() => { const n = alternarVisibles(sel, opciones); onChange(opciones.filter((o) => n.has(o))); }} />
      {estado.etiqueta}
    </label>
  );
}
