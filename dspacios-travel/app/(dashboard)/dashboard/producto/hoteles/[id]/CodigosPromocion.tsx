"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { guardarCodigoPromocion, quitarCodigoPromocion } from "./codigos-actions";

export type VigenciaOpcion = { id: number; nombre: string; fechas: string };
export type CodigoFila = { vigenciaId: number; requerido: boolean; codigo: string | null; nota: string | null };

// #103 (C): qué vigencias/promociones de ESTE hotel exigen un código en la solicitud al proveedor y cuál es. Un código por vigencia (no uno permanente por hotel, no deducido del nombre).
export function CodigosPromocion({ hotelId, vigencias, codigos, puedeEditar }: { hotelId: number; vigencias: VigenciaOpcion[]; codigos: CodigoFila[]; puedeEditar: boolean }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [borrador, setBorrador] = useState<Record<number, { requerido: boolean; codigo: string; nota: string }>>(() =>
    Object.fromEntries(codigos.map((c) => [c.vigenciaId, { requerido: c.requerido, codigo: c.codigo ?? "", nota: c.nota ?? "" }])));
  const [nueva, setNueva] = useState<number | "">("");

  const guardar = (vigenciaId: number) => {
    const b = borrador[vigenciaId]; if (!b) return;
    empezar(async () => {
      const r = await guardarCodigoPromocion({ hotelId, vigenciaId, ...b });
      setMsg(r.ok ? { tipo: "ok", texto: "Código guardado." } : { tipo: "error", texto: r.error });
      if (r.ok) router.refresh();
    });
  };
  const quitar = (vigenciaId: number) => empezar(async () => {
    const r = await quitarCodigoPromocion(vigenciaId, hotelId);
    if (r.ok) setBorrador((p) => { const n = { ...p }; delete n[vigenciaId]; return n; });
    setMsg(r.ok ? { tipo: "ok", texto: "Configuración quitada." } : { tipo: "error", texto: r.error });
    if (r.ok) router.refresh();
  });

  const configuradas = vigencias.filter((v) => borrador[v.id]);
  const libres = vigencias.filter((v) => !borrador[v.id]);
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="codigos-promo-titulo" data-testid="codigos-promocion">
      <h2 id="codigos-promo-titulo" className="flex items-center gap-2 text-sm font-semibold text-gray-700"><KeyRound className="h-4 w-4" aria-hidden /> Códigos de promoción para la solicitud al proveedor</h2>
      <p className="mt-1 text-xs text-gray-500">Si el hotel exige un código para una promoción, regístralo aquí para esa vigencia. Aparecerá en la vista previa y en el correo, y la solicitud no se envía si falta. No cambia tarifas ni precios.</p>
      {configuradas.length === 0 && <p className="mt-3 text-xs text-gray-400">Ninguna vigencia de este hotel exige código todavía.</p>}
      <ul className="mt-3 space-y-3">
        {configuradas.map((v) => {
          const b = borrador[v.id];
          return (
            <li key={v.id} className="rounded-lg border border-gray-100 p-3" data-testid={`codigo-${v.id}`}>
              <p className="text-sm font-medium text-gray-800">{v.nombre} <span className="font-normal text-gray-400">· {v.fechas}</span></p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,14rem)_1fr_auto] sm:items-end">
                <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" disabled={!puedeEditar} checked={b.requerido} onChange={(e) => setBorrador((p) => ({ ...p, [v.id]: { ...b, requerido: e.target.checked } }))} /> Exige código</label>
                <div><label htmlFor={`cod-${v.id}`} className="mb-0.5 block text-[11px] text-gray-500">Código</label><input id={`cod-${v.id}`} disabled={!puedeEditar} value={b.codigo} maxLength={60} onChange={(e) => setBorrador((p) => ({ ...p, [v.id]: { ...b, codigo: e.target.value } }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 font-mono text-sm" /></div>
                <div><label htmlFor={`nota-${v.id}`} className="mb-0.5 block text-[11px] text-gray-500">Nota interna (opcional)</label><input id={`nota-${v.id}`} disabled={!puedeEditar} value={b.nota} maxLength={300} onChange={(e) => setBorrador((p) => ({ ...p, [v.id]: { ...b, nota: e.target.value } }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" /></div>
                {puedeEditar && <div className="flex gap-2"><button type="button" disabled={pendiente} onClick={() => guardar(v.id)} className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Guardar</button><button type="button" disabled={pendiente} onClick={() => quitar(v.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 disabled:opacity-40">Quitar</button></div>}
              </div>
              {b.requerido && !b.codigo.trim() && <p className="mt-1 text-[11px] text-amber-700">Exige código pero no se ha digitado: la solicitud quedará bloqueada hasta que lo registres.</p>}
            </li>
          );
        })}
      </ul>
      {puedeEditar && libres.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div><label htmlFor="cod-nueva" className="mb-0.5 block text-[11px] text-gray-500">Agregar a la vigencia</label>
            <select id="cod-nueva" value={nueva} onChange={(e) => setNueva(e.target.value ? Number(e.target.value) : "")} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">— Elige una vigencia —</option>{libres.map((v) => <option key={v.id} value={v.id}>{v.nombre} · {v.fechas}</option>)}
            </select></div>
          <button type="button" disabled={nueva === "" || pendiente} onClick={() => { if (nueva !== "") { setBorrador((p) => ({ ...p, [nueva]: { requerido: true, codigo: "", nota: "" } })); setNueva(""); } }} className="rounded-lg border border-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] disabled:opacity-40">Agregar</button>
        </div>
      )}
      {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`mt-2 text-xs ${msg.tipo === "error" ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
    </section>
  );
}
