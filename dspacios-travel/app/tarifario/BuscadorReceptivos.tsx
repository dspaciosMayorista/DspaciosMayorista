"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { formatMoneda } from "@/lib/utils";
import { buscarReceptivos } from "@/app/(dashboard)/dashboard/reservar/actions";
import type { ResultadoServicio } from "@/lib/reservar/cotizar";
import type { TourCartItem } from "@/lib/cart/CartContext";

export type ReceptivosPrefill = { destino: string | null; fechaIda: string | null; fechaRegreso: string | null; pax: number };

// Motor de búsqueda de receptivos: destino + fechas + pax → liquida EN VIVO
// cada tour publicado (temporada de la fecha elegida, tarifa por persona o
// por grupo según el pax) — mismo criterio que el buscador de porción terrestre.
export function BuscadorReceptivos({
  destinos = [], fotosPorServicio = {}, onVerDetalle, initial = null, onConsumedInitial, onAgregar,
}: {
  destinos?: string[];
  fotosPorServicio?: Record<number, string>;
  onVerDetalle: (r: ResultadoServicio) => void;
  // Llega desde el carrito ("+ Agregar servicios/tours" con un hotel ya elegido):
  // precarga destino/fechas/pax y busca sola, para no repetir la búsqueda a mano.
  initial?: ReceptivosPrefill | null;
  onConsumedInitial?: () => void;
  onAgregar?: (item: Omit<TourCartItem, "id">) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fIda, setFIda] = useState(initial?.fechaIda ?? "");
  const [fReg, setFReg] = useState(initial?.fechaRegreso ?? "");
  const [pax, setPax] = useState(initial?.pax ? String(initial.pax) : "2");
  const [destino, setDestino] = useState(initial?.destino ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [resultados, setResultados] = useState<ResultadoServicio[] | null>(null);

  function buscar(destinoQ = destino, fIdaQ = fIda, fRegQ = fReg, paxQ = pax) {
    setErr(""); setResultados(null);
    if (!fIdaQ || !fRegQ) { setErr("Indica fecha de ida y de regreso."); return; }
    const paxNum = Number(paxQ) || 0;
    if (paxNum <= 0) { setErr("Indica cuántos pax."); return; }
    start(async () => {
      const r = await buscarReceptivos({ fechaIda: fIdaQ, fechaRegreso: fRegQ, pax: paxNum, destino: destinoQ });
      if (r.ok) setResultados(r.resultados);
      else setErr(r.error);
    });
  }

  // Solo una vez al montar: si llega precarga, busca sola y avisa que ya la usó.
  const yaConsumido = useRef(false);
  useEffect(() => {
    if (yaConsumido.current || !initial) return;
    yaConsumido.current = true;
    if (initial.fechaIda && initial.fechaRegreso) buscar(initial.destino ?? "", initial.fechaIda, initial.fechaRegreso, String(initial.pax || 2));
    onConsumedInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="mb-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Buscar receptivo</p>
        <div className="flex flex-wrap items-end gap-3">
          {destinos.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-gray-500">Destino</label>
              <select value={destino} onChange={(e) => setDestino(e.target.value)} className={sel}>
                <option value="">Todos</option>
                {destinos.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Ida</label>
            <input type="date" min={hoy} value={fIda}
              onChange={(e) => { const nueva = e.target.value; setFIda(nueva); if (fReg && fReg <= nueva) setFReg(""); }}
              className={sel} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Regreso</label>
            <input type="date" min={fIda || hoy} value={fReg} onChange={(e) => setFReg(e.target.value)} className={sel} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Pax</label>
            <input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} className={`${sel} w-20`} />
          </div>
          <button type="button" onClick={() => buscar()} disabled={pending}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Buscando…" : "Buscar receptivos"}
          </button>
          {resultados && <button type="button" onClick={() => setResultados(null)} className="text-xs text-gray-400 hover:text-gray-700">Limpiar resultados</button>}
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>

      {resultados && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-gray-500">{resultados.length} receptivo(s) disponibles para tu búsqueda</p>
          {resultados.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
              No hay receptivos disponibles para ese destino/fechas/pax.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resultados.map((r) => (
                <div
                  key={`${r.paqueteId}-${r.servicioId}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
                >
                  <button type="button" onClick={() => onVerDetalle(r)} className="flex-1 text-left">
                    <div className="relative aspect-[16/10] w-full bg-gray-100">
                      {fotosPorServicio[r.servicioId] ? (
                        <Image src={fotosPorServicio[r.servicioId]} alt={r.nombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
                      )}
                    </div>
                    <div className="p-4 pb-0">
                      <div className="font-semibold text-gray-800">{r.nombre}</div>
                      {r.destino && <div className="text-xs text-gray-500">{r.destino}</div>}
                      {r.descripcion?.trim() && (
                        <p className="mt-1 line-clamp-2 text-xs text-gray-400">{r.descripcion}</p>
                      )}
                    </div>
                  </button>
                  <div className="p-4 pt-3">
                    <div className="mb-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">total</div>
                      <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(r.total, r.moneda)}</div>
                      <div className="text-[10px] text-gray-400">{r.pax} pax</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => onVerDetalle(r)} className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                        Ver más
                      </button>
                      {onAgregar && (
                        <button
                          type="button"
                          onClick={() => onAgregar({
                            tipo: "tour",
                            paqueteId: r.paqueteId,
                            servicioId: r.servicioId,
                            nombre: r.nombre,
                            destino: r.destino,
                            fotoUrl: r.servicioId != null ? (fotosPorServicio[r.servicioId] ?? null) : null,
                            fechaIda: fIda, fechaRegreso: fReg, noches: r.noches,
                            pax: r.pax, precio: r.total, moneda: r.moneda,
                          })}
                          className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                          style={{ backgroundColor: "var(--brand-accent)" }}
                        >
                          Agregar al carrito
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
