"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { corregirDatosAliado } from "./actions";

type Ficha = { id: number; nombre: string; nit: string | null; tipo_documento: string | null; telefono: string | null; email: string | null };

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

// #25 (ADL-039) — Corrección de nombre, teléfono, correo y documento (superadmin y gerencia; el servidor lo vuelve a verificar).
// `base` = lo que se vio al abrir; tras guardar pasa a ser lo guardado, así una segunda corrección no choca con la primera.
export function CorreccionAliado({ a }: { a: Ficha }) {
  const [base, setBase] = useState(a);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(a.nombre);
  const [telefono, setTelefono] = useState(a.telefono ?? "");
  const [email, setEmail] = useState(a.email ?? "");
  const [tipoDoc, setTipoDoc] = useState(a.tipo_documento ?? "NIT");
  const [nit, setNit] = useState(a.nit ?? "");
  const [confirma, setConfirma] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();

  const toca = nombre !== base.nombre || nit !== (base.nit ?? "") || tipoDoc !== (base.tipo_documento ?? "NIT");

  function guardar() {
    setMsg(null);
    start(async () => {
      const r = await corregirDatosAliado(a.id, {
        nombre, telefono, email, nit, confirmaImpacto: confirma,
        // Un documento sin tipo guardado se muestra como NIT; solo se envía si la persona lo cambió (no se inventa un cambio null → NIT).
        tipoDocumento: tipoDoc === (base.tipo_documento ?? "NIT") ? undefined : tipoDoc,
        esperado: { nombre: base.nombre, telefono: base.telefono, email: base.email, tipo_documento: base.tipo_documento, nit: base.nit },
      });
      if (!r.ok) { setMsg({ ok: false, texto: r.error }); return; }
      if (r.cambios.length === 0) { setMsg({ ok: true, texto: "No hay cambios que guardar." }); return; }
      setBase({ ...base, nombre, telefono: telefono.trim() || null, email: email.trim() || null, tipo_documento: tipoDoc, nit });
      setConfirma(false);
      setMsg({ ok: true, texto: `Corregido: ${r.cambios.join(", ")}.` });
    });
  }

  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <div className="flex items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Corregir datos de la ficha</p>
        <button type="button" onClick={() => setAbierto((o) => !o)} aria-expanded={abierto} className="text-xs font-medium text-[#1D7C9A] hover:underline">
          {abierto ? "Ocultar" : "Corregir"}
        </button>
      </div>
      {abierto && (
        <div className="mt-2">
          <p className="mb-2 text-xs text-gray-500">
            Solo superadmin y gerencia. Cada corrección queda en el historial con quién y cuándo. El cambio aplica a los documentos que se emitan desde ahora;
            las cotizaciones NETO ya congeladas con el nombre o documento anterior deberán rehacerse para convertirse.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div><label className={lbl} htmlFor={`cor-nombre-${a.id}`}>Nombre</label><Input id={`cor-nombre-${a.id}`} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
            <div><label className={lbl} htmlFor={`cor-tel-${a.id}`}>Teléfono</label><Input id={`cor-tel-${a.id}`} value={telefono} onChange={(e) => setTelefono(e.target.value)} /></div>
            <div><label className={lbl} htmlFor={`cor-mail-${a.id}`}>Correo</label><Input id={`cor-mail-${a.id}`} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div>
              <label className={lbl} htmlFor={`cor-tdoc-${a.id}`}>Tipo de documento</label>
              <select id={`cor-tdoc-${a.id}`} value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} className={sel}>
                <option value="NIT">NIT</option>
                <option value="CC">Cédula</option>
              </select>
            </div>
            <div><label className={lbl} htmlFor={`cor-nit-${a.id}`}>Número de documento</label><Input id={`cor-nit-${a.id}`} value={nit} onChange={(e) => setNit(e.target.value)} /></div>
          </div>
          {toca && (
            <label className="mt-2 flex items-start gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={confirma} onChange={(e) => setConfirma(e.target.checked)} className="mt-0.5" />
              <span>Entiendo que el nuevo nombre o documento aparecerá en los documentos nuevos del aliado.</span>
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={guardar} disabled={pending} className="h-9" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar corrección"}</Button>
            {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`} role={msg.ok ? "status" : "alert"}>{msg.texto}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
