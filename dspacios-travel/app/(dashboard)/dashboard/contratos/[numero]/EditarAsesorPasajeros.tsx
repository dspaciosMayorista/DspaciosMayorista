"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calcularEdad } from "@/lib/utils";
import { actualizarAsesorContrato, actualizarPasajerosContrato, type PasajeroEdit } from "./editar-contrato-actions";

export type PasajeroRow = { id: number; nombre: string; tipo_id: string | null; identificacion: string | null; fecha_nacimiento: string | null; es_infante: boolean };

const TIPOS_DOC = ["CC", "TI", "CE", "PAS", "RC"];

export function EditarAsesorPasajeros({
  numero, asesores, asesorActual, puedeAsesor, pasajeros, fechaSalida,
}: {
  numero: string;
  asesores: { nombre: string; email: string | null }[];
  asesorActual: string;
  puedeAsesor: boolean;
  pasajeros: PasajeroRow[];
  fechaSalida: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asesor, setAsesor] = useState(asesorActual);
  const [msgA, setMsgA] = useState("");
  const [filas, setFilas] = useState<PasajeroEdit[]>(
    pasajeros.length
      ? pasajeros.map((p) => ({ nombre: p.nombre, tipoId: p.tipo_id ?? "CC", identificacion: p.identificacion ?? "", fechaNacimiento: p.fecha_nacimiento ?? "", esInfante: p.es_infante }))
      : [{ nombre: "", tipoId: "CC", identificacion: "", fechaNacimiento: "", esInfante: false }]
  );
  const [msgP, setMsgP] = useState("");

  const setRow = (i: number, patch: Partial<PasajeroEdit>) => setFilas((f) => f.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  function guardarAsesor() {
    setMsgA("");
    start(async () => { const r = await actualizarAsesorContrato(numero, asesor); setMsgA(r.ok ? "✓ Guardado" : r.error); if (r.ok) router.refresh(); });
  }
  function guardarPasajeros() {
    setMsgP("");
    start(async () => { const r = await actualizarPasajerosContrato(numero, filas); if (r.ok) { setMsgP("✓ Pasajeros guardados"); router.refresh(); } else setMsgP(r.error); });
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Asesor y pasajeros</h2>

      {/* Asesor interno */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="mb-1 block text-xs text-gray-500">Asesor interno</label>
          <select value={asesor} onChange={(e) => setAsesor(e.target.value)} disabled={!puedeAsesor}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100">
            <option value="">— Sin asesor —</option>
            {asesores.map((a) => <option key={a.email ?? a.nombre} value={a.nombre}>{a.nombre}</option>)}
            {asesor && !asesores.some((a) => a.nombre === asesor) && <option value={asesor}>{asesor}</option>}
          </select>
        </div>
        {puedeAsesor && <Button variant="outline" onClick={guardarAsesor} disabled={pending}>Guardar asesor</Button>}
        {msgA && <span className={msgA.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msgA}</span>}
      </div>

      {/* Pasajeros */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Pasajeros</p>
        <div className="space-y-2">
          {filas.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="w-48"><label className="text-[11px] text-gray-500">Nombre completo</label><Input value={p.nombre} onChange={(e) => setRow(i, { nombre: e.target.value })} /></div>
              <div className="w-24">
                <label className="text-[11px] text-gray-500">Tipo doc</label>
                <select value={p.tipoId} onChange={(e) => setRow(i, { tipoId: e.target.value })} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                  {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="w-28"><label className="text-[11px] text-gray-500">N° doc</label><Input value={p.identificacion} onChange={(e) => setRow(i, { identificacion: e.target.value })} /></div>
              <div className="w-44"><label className="text-[11px] text-gray-500">Nacimiento</label><Input type="date" className="w-full" value={p.fechaNacimiento} onChange={(e) => setRow(i, { fechaNacimiento: e.target.value })} /></div>
              {(() => {
                const edad = calcularEdad(p.fechaNacimiento, fechaSalida);
                if (edad == null) return <span className="pb-2 text-[11px] text-gray-300">—</span>;
                const cat = edad < 2 ? "Infante" : edad < 12 ? "Niño" : "Adulto";
                return <span className={`pb-2 text-[11px] ${edad < 2 ? "font-medium text-[var(--brand-accent)]" : "text-gray-400"}`}>{cat} · {edad}a</span>;
              })()}
              <button type="button" onClick={() => setFilas((f) => f.filter((_, n) => n !== i))} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setFilas((f) => [...f, { nombre: "", tipoId: "CC", identificacion: "", fechaNacimiento: "", esInfante: false }])} className="text-sm font-medium" style={{ color: "var(--brand-accent)" }}>+ Agregar pasajero</button>
          <Button onClick={guardarPasajeros} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar pasajeros"}</Button>
          {msgP && <span className={msgP.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msgP}</span>}
        </div>
      </div>
    </section>
  );
}
