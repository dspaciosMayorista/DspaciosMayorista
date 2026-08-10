"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { formatMoneda } from "@/lib/utils";
import { buscarReceptivos } from "@/app/(dashboard)/dashboard/reservar/actions";
import type { ResultadoServicio } from "@/lib/reservar/cotizar";

// Motor de búsqueda de receptivos: destino + fechas + pax → liquida EN VIVO
// cada tour publicado (temporada de la fecha elegida, tarifa por persona o
// por grupo según el pax) — mismo criterio que el buscador de porción terrestre.
export function BuscadorReceptivos({
  destinos = [], fotosPorServicio = {}, onVerDetalle,
}: {
  destinos?: string[];
  fotosPorServicio?: Record<number, string>;
  onVerDetalle: (r: ResultadoServicio) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fIda, setFIda] = useState("");
  const [fReg, setFReg] = useState("");
  const [pax, setPax] = useState("2");
  const [destino, setDestino] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [resultados, setResultados] = useState<ResultadoServicio[] | null>(null);

  function buscar() {
    setErr(""); setResultados(null);
    if (!fIda || !fReg) { setErr("Indica fecha de ida y de regreso."); return; }
    const paxNum = Number(pax) || 0;
    if (paxNum <= 0) { setErr("Indica cuántos pax."); return; }
    start(async () => {
      const r = await buscarReceptivos({ fechaIda: fIda, fechaRegreso: fReg, pax: paxNum, destino });
      if (r.ok) setResultados(r.resultados);
      else setErr(r.error);
    });
  }

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
          <button type="button" onClick={buscar} disabled={pending}
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
                <button
                  key={`${r.paqueteId}-${r.servicioId}`}
                  type="button"
                  onClick={() => onVerDetalle(r)}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
                >
                  <div className="relative aspect-[16/10] w-full bg-gray-100">
                    {fotosPorServicio[r.servicioId] ? (
                      <Image src={fotosPorServicio[r.servicioId]} alt={r.nombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="font-semibold text-gray-800">{r.nombre}</div>
                    {r.destino && <div className="text-xs text-gray-500">{r.destino}</div>}
                    {r.descripcion?.trim() && (
                      <p className="mt-1 line-clamp-2 text-xs text-gray-400">{r.descripcion}</p>
                    )}
                    <div className="mt-3 flex items-end justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">total</div>
                        <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(r.total, r.moneda)}</div>
                        <div className="text-[10px] text-gray-400">{r.pax} pax</div>
                      </div>
                      <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "var(--brand-accent)" }}>
                        Ver más →
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
