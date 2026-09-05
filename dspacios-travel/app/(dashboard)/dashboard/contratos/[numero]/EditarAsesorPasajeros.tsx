"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calcularEdad } from "@/lib/utils";
import { actualizarAsesorContrato, actualizarPasajerosContrato, type PasajeroEdit } from "./editar-contrato-actions";
import { filasIniciales } from "@/lib/reservar/pasajerosEdicion";

export type PasajeroRow = { id: number; nombre: string; tipo_id: string | null; identificacion: string | null; fecha_nacimiento: string | null; es_infante: boolean; responsable_id?: number | null };

const TIPOS_DOC = ["CC", "TI", "CE", "PAS", "RC"];

export function EditarAsesorPasajeros({
  numero, asesores, asesorActual, puedeAsesor, pasajeros, fechaSalida, pax, titularNombre,
  puedeEditar = true,
}: {
  numero: string;
  asesores: { nombre: string; email: string | null }[];
  asesorActual: string;
  puedeAsesor: boolean;
  pasajeros: PasajeroRow[];
  fechaSalida: string | null;
  pax?: number;
  titularNombre?: string;
  puedeEditar?: boolean;
}) {
  const maxPax = pax ?? 0;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asesor, setAsesor] = useState(asesorActual);
  const [msgA, setMsgA] = useState("");

  // Inicializa filas: si hay pasajeros guardados los usa; si no, crea `pax` filas
  // vacías con el primer puesto pre-llenado con el titular.
  const [filas, setFilas] = useState<PasajeroEdit[]>(() => {
    if (pasajeros.length) {
      // `filasIniciales` traduce `responsable_id` (id real, persistido) a
      // `responsableIndex` (posición en este mismo arreglo) — sin esto, el
      // formulario cargaba SIEMPRE sin vínculo y el primer guardado, aunque
      // no tocara pasajeros, borraba en silencio el vínculo ya guardado.
      return filasIniciales(pasajeros);
    }
    const vacios: PasajeroEdit[] = Array.from({ length: Math.max(maxPax, 1) }, (_, i) => ({
      nombre: i === 0 ? (titularNombre ?? "") : "",
      tipoId: "CC",
      identificacion: "",
      fechaNacimiento: "",
      esInfante: false,
    }));
    return vacios;
  });
  const [msgP, setMsgP] = useState("");

  const setRow = (i: number, patch: Partial<PasajeroEdit>) => setFilas((f) => f.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  // Quitar una fila desplaza los índices de todas las que van después — un
  // `responsableIndex` guardado en otra fila apuntando a esa posición (o a
  // una posterior) quedaría apuntando a la persona equivocada si no se
  // corrige. Nunca se deja un vínculo potencialmente incorrecto: se limpia
  // el que apuntaba exactamente a la fila quitada, y se reindexan los demás.
  const quitarFila = (i: number) => setFilas((f) =>
    f
      .filter((_, n) => n !== i)
      .map((r) => {
        if (r.responsableIndex == null) return r;
        if (r.responsableIndex === i) return { ...r, responsableIndex: null };
        if (r.responsableIndex > i) return { ...r, responsableIndex: r.responsableIndex - 1 };
        return r;
      })
  );

  function guardarAsesor() {
    setMsgA("");
    start(async () => { const r = await actualizarAsesorContrato(numero, asesor); setMsgA(r.ok ? "✓ Guardado" : r.error); if (r.ok) router.refresh(); });
  }
  function guardarPasajeros() {
    setMsgP("");
    // Validación cliente (mismos validadores del contrato del tarifario).
    const docOk = (tipo: string, num: string) => tipo === "PAS" || /^\d+$/.test(num.trim());
    const conDato = filas.filter((p) => p.nombre.trim() || p.identificacion.trim() || p.fechaNacimiento.trim());
    if (!conDato.length) { setMsgP("Debe haber al menos un pasajero."); return; }
    for (let i = 0; i < conDato.length; i++) {
      const p = conDato[i];
      if (!p.nombre.trim()) { setMsgP(`Pasajero ${i + 1}: el nombre es obligatorio.`); return; }
      if (!p.identificacion.trim()) { setMsgP(`Pasajero ${i + 1}: el número de documento es obligatorio.`); return; }
      if (!docOk(p.tipoId, p.identificacion)) { setMsgP(`Pasajero ${i + 1}: el documento debe ser solo números (excepto Pasaporte).`); return; }
      if (!p.fechaNacimiento.trim()) { setMsgP(`Pasajero ${i + 1}: la fecha de nacimiento es obligatoria.`); return; }
      const edad = calcularEdad(p.fechaNacimiento, fechaSalida);
      if (edad != null && edad < 18 && p.tipoId === "CC") { setMsgP(`Pasajero ${i + 1}: un menor no puede tener CC (usa RC o TI).`); return; }
    }
    start(async () => { const r = await actualizarPasajerosContrato(numero, filas); if (r.ok) { setMsgP("✓ Pasajeros guardados"); router.refresh(); } else setMsgP(r.error); });
  }

  // Solo lectura (asesor consultando el contrato de un colega). No se muestra
  // el formulario en gris: los datos de pasajero —documento y fecha de
  // nacimiento— no llegan siquiera del servidor, porque `contrato_pasajeros`
  // está limitada a contratos propios desde la migración 142. Un formulario
  // vacío y bloqueado se leería como "este contrato no tiene pasajeros", que
  // es falso.
  if (!puedeEditar) {
    return (
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700">Asesor y pasajeros</h2>
        <p className="mt-2 text-sm text-gray-600">
          Asesor del contrato: <span className="font-medium text-gray-800">{asesorActual || "—"}</span>
        </p>
        <p className="mt-2 text-xs text-gray-400">
          Los datos de los pasajeros (documento y fecha de nacimiento) solo los consulta el asesor
          que gestiona el contrato.
        </p>
      </section>
    );
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
              <div className="w-48"><label className="text-[11px] text-gray-500">Nombre completo *</label><Input value={p.nombre} onChange={(e) => setRow(i, { nombre: e.target.value })} /></div>
              <div className="w-24">
                <label className="text-[11px] text-gray-500">Tipo doc *</label>
                <select value={p.tipoId} onChange={(e) => setRow(i, { tipoId: e.target.value })} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                  {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="w-28"><label className="text-[11px] text-gray-500">N° doc *</label><Input value={p.identificacion} onChange={(e) => setRow(i, { identificacion: e.target.value })} /></div>
              <div className="w-44"><label className="text-[11px] text-gray-500">Nacimiento *</label><Input type="date" className="w-full" value={p.fechaNacimiento} onChange={(e) => setRow(i, { fechaNacimiento: e.target.value })} /></div>
              {(() => {
                const edad = calcularEdad(p.fechaNacimiento, fechaSalida);
                if (edad == null) return <span className="pb-2 text-[11px] text-gray-300">—</span>;
                const esInfante = edad < 2;
                const cat = esInfante ? "Infante" : edad < 12 ? "Niño" : "Adulto";
                return (
                  <>
                    <span className={`pb-2 text-[11px] ${esInfante ? "font-medium text-[var(--brand-accent)]" : "text-gray-400"}`}>{cat} · {edad}a</span>
                    {esInfante && (
                      <div className="w-48">
                        <label className="text-[11px] text-gray-500">Adulto responsable</label>
                        <select
                          value={p.responsableIndex ?? ""}
                          onChange={(e) => setRow(i, { responsableIndex: e.target.value === "" ? null : Number(e.target.value) })}
                          className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm"
                        >
                          <option value="">— Sin vincular —</option>
                          {filas.map((otro, j) => {
                            if (j === i) return null;
                            // Servidor (trigger de la migración 167) exige mayoría de
                            // edad real (≥18), no solo "no ser infante" — un niño
                            // (CHD) tampoco puede ser responsable. Se filtra aquí
                            // igual, solo para no ofrecer una opción que el servidor
                            // va a rechazar de todos modos.
                            const edadOtro = calcularEdad(otro.fechaNacimiento, fechaSalida);
                            if (edadOtro == null || edadOtro < 18) return null;
                            return <option key={j} value={j}>{otro.nombre || `Pasajero ${j + 1}`}</option>;
                          })}
                        </select>
                      </div>
                    )}
                  </>
                );
              })()}
              <button type="button" onClick={() => quitarFila(i)} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          {(maxPax === 0 || filas.length < maxPax) && (
            <button type="button" onClick={() => setFilas((f) => [...f, { nombre: "", tipoId: "CC", identificacion: "", fechaNacimiento: "", esInfante: false }])} className="text-sm font-medium" style={{ color: "var(--brand-accent)" }}>+ Agregar pasajero</button>
          )}
          <Button onClick={guardarPasajeros} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar pasajeros"}</Button>
          {msgP && <span className={msgP.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msgP}</span>}
        </div>
      </div>
    </section>
  );
}
