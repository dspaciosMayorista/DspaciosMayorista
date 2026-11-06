"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validarReglaDescuento } from "@/lib/hoteles/reglasDescuento";
import { guardarReglaDescuento, alternarReglaDescuento, eliminarReglaDescuento } from "./reglas-descuento-actions";

export type ReglaFila = { id: number; tipo: "ebb" | "long_stay"; umbral: number; pct: number; activa: boolean };

const TITULO = { ebb: "EBB (reserva anticipada)", long_stay: "Long Stay (estancia larga)" } as const;
const CAMPO = { ebb: "Días mínimos antes del check-in", long_stay: "Noches mínimas" } as const;
const resumen = (r: ReglaFila) => (r.tipo === "ebb" ? `${r.umbral} días o más antes del check-in` : `${r.umbral} noches o más`);

// errorCarga: la consulta falló (distinto de "sin reglas"): no se afirma que no hay reglas ni se deja administrar a ciegas.
export function HotelPromociones({ hotelId, reglas, errorCarga = false }: { hotelId: number; reglas: ReglaFila[]; errorCarga?: boolean }) {
  const router = useRouter();
  const [editId, setEditId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<"ebb" | "long_stay">("ebb");
  const [umbral, setUmbral] = useState("");
  const [pct, setPct] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function limpiar() { setEditId(null); setUmbral(""); setPct(""); setErr(""); }
  function correr(f: () => Promise<{ ok: true } | { ok: false; error: string }>, despues?: () => void) {
    setErr("");
    start(async () => { const r = await f(); if (r.ok) { despues?.(); router.refresh(); } else setErr(r.error); });
  }
  function guardar() {
    const v = validarReglaDescuento({ tipo, umbral, pct });
    if (!v.ok) { setErr(v.error); return; }
    correr(() => guardarReglaDescuento({ hotelId, id: editId ?? undefined, tipo, umbral, pct }), limpiar);
  }
  function editar(r: ReglaFila) { setEditId(r.id); setTipo(r.tipo); setUmbral(String(r.umbral)); setPct(String(r.pct)); setErr(""); }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4" aria-label="Promociones">
      <h2 className="text-sm font-semibold text-gray-700">Promociones</h2>
      <p className="mb-3 mt-1 text-xs text-gray-500">
        Descuento sobre la neta del hotel, antes del markup. Si se cumplen varias, aplica solo la de mayor porcentaje (nunca se suman). No cambia las netas ni las temporadas.
      </p>

      {errorCarga ? (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          No se pudieron cargar las promociones de este hotel. La administración de reglas está deshabilitada para no editar a ciegas.
          <button type="button" onClick={() => router.refresh()} className="ml-2 font-medium underline">Reintentar</button>
        </div>
      ) : (["ebb", "long_stay"] as const).map((t) => {
        const filas = reglas.filter((r) => r.tipo === t).sort((a, b) => a.umbral - b.umbral);
        return (
          <div key={t} className="mb-3">
            <p className="mb-1 text-xs font-medium text-gray-600">{TITULO[t]}</p>
            {filas.length === 0 ? <p className="text-xs text-gray-400">Sin reglas.</p> : (
              <ul className="divide-y divide-gray-100">
                {filas.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className={r.activa ? "text-gray-700" : "text-gray-400"}>
                      {resumen(r)} → <b>{r.pct} %</b>{!r.activa && <span className="ml-2 text-xs">(inactiva)</span>}
                    </span>
                    <span className="flex gap-3 text-xs">
                      <button type="button" disabled={pending} onClick={() => correr(() => alternarReglaDescuento(r.id, hotelId, !r.activa))} className="text-gray-500 hover:text-gray-800">{r.activa ? "Desactivar" : "Activar"}</button>
                      <button type="button" disabled={pending} onClick={() => editar(r)} className="text-gray-500 hover:text-gray-800">Editar</button>
                      <button type="button" disabled={pending} onClick={() => { if (window.confirm("¿Eliminar esta promoción?")) correr(() => eliminarReglaDescuento(r.id, hotelId), () => { if (editId === r.id) limpiar(); }); }} className="text-gray-400 hover:text-red-500">Eliminar</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <fieldset disabled={errorCarga} className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3 disabled:opacity-50">
        <div>
          <label className="mb-1 block text-xs text-gray-600">Tipo</label>
          <select aria-label="Tipo de promoción" value={tipo} onChange={(e) => setTipo(e.target.value as "ebb" | "long_stay")} disabled={editId != null} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm">
            <option value="ebb">EBB</option>
            <option value="long_stay">Long Stay</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600">{CAMPO[tipo]}</label>
          <Input aria-label={CAMPO[tipo]} inputMode="numeric" className="w-28" value={umbral} onChange={(e) => setUmbral(e.target.value)} placeholder={tipo === "ebb" ? "30" : "4"} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600">Porcentaje de descuento</label>
          <Input aria-label="Porcentaje de descuento" inputMode="decimal" className="w-24" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="18" />
        </div>
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : editId != null ? "Guardar cambios" : "Agregar promoción"}</Button>
        {editId != null && <button type="button" onClick={limpiar} className="pb-2 text-xs text-gray-500">Cancelar</button>}
      </fieldset>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
    </section>
  );
}
