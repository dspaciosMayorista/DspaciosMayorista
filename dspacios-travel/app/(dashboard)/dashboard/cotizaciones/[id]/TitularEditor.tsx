"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OpcionesTipoDoc } from "@/components/personas/OpcionesTipoDoc";
import { BuscarTitular } from "@/components/personas/BuscarTitular";
import { Input } from "@/components/ui/input";
import { TIPOS_DOC_PERSONA } from "@/lib/personas/identidad";
import { actualizarTitularCotizacionManual, type TitularInput } from "../manual-actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

// Editor del titular de una cotización dinámica (antes de generar contrato).
// Para generar contrato se exigen nombre, tipo y número de doc y nacimiento.
// #42: guarda por la fachada de la 219 con la versión del puesto titular (CAS) y una clave de
// idempotencia por envío: reenviar los MISMOS datos repite la clave (no duplica la captura); datos
// distintos estrenan clave. El tipo vacío se conserva vacío (nunca un "CC" supuesto).
export function TitularEditor({ id, inicial, version }: { id: number; inicial: TitularInput; version: number }) {
  const router = useRouter();
  const [t, setT] = useState<TitularInput>(inicial);
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const envio = useRef<{ datos: string; clave: string } | null>(null);

  const set = (k: keyof TitularInput, v: string) => setT((p) => ({ ...p, [k]: v }));
  const completo = !!`${t.nombres}${t.apellidos}`.trim() && !!t.tipoDoc.trim() && !!t.numeroDoc.trim() && !!t.nacimiento.trim();

  function claveDelEnvio(): string {
    const datos = JSON.stringify(t);
    if (!envio.current || envio.current.datos !== datos) envio.current = { datos, clave: crypto.randomUUID() };
    return envio.current.clave;
  }

  function guardar() {
    setErr(""); setOk(false);
    const clave = claveDelEnvio();
    start(async () => {
      const r = await actualizarTitularCotizacionManual(id, t, { versionEsperada: version, clave });
      if (r.ok) { envio.current = null; setOk(true); setEditando(false); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Datos del titular</h2>
        {!editando && (
          <button type="button" onClick={() => { setOk(false); setEditando(true); }} className="text-xs font-medium text-[#1D7C9A] hover:underline">Editar</button>
        )}
      </div>

      {!completo && !editando && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Faltan datos del titular para generar el contrato (nombre, tipo y número de documento y fecha de nacimiento).
        </p>
      )}

      {!editando ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Dato label="Nombre" value={`${t.nombres} ${t.apellidos}`.trim()} />
          <Dato label="Tipo doc" value={t.tipoDoc} />
          <Dato label="N° documento" value={t.numeroDoc} />
          <Dato label="Nacimiento" value={t.nacimiento} />
          <Dato label="Teléfono" value={t.telefono} />
          <Dato label="Email" value={t.email} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="col-span-2 md:col-span-3">
              <label className={lbl}>Número de documento</label>
              <div className="flex gap-1">
                <Input value={t.numeroDoc} onChange={(e) => set("numeroDoc", e.target.value)} />
                <BuscarTitular numero={t.numeroDoc} actual={t} onAplicar={({ tipoDoc, ...d }) => setT((p) => ({ ...p, tipoDoc, ...d }))} />
              </div>
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={lbl}>Tipo de documento</label>
              <select value={t.tipoDoc} onChange={(e) => set("tipoDoc", e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Elige el tipo…</option>
                <OpcionesTipoDoc />
                {t.tipoDoc && !(TIPOS_DOC_PERSONA as readonly string[]).includes(t.tipoDoc) && <option value={t.tipoDoc}>{t.tipoDoc}</option>}
              </select>
            </div>
            <div><label className={lbl}>Nombres</label><Input value={t.nombres} onChange={(e) => set("nombres", e.target.value)} /></div>
            <div><label className={lbl}>Apellidos</label><Input value={t.apellidos} onChange={(e) => set("apellidos", e.target.value)} /></div>
            <div><label className={lbl}>Fecha de nacimiento</label><DateInput aria-label="Fecha de nacimiento" type="date" value={t.nacimiento} onValueChange={(dateValue) => set("nacimiento", dateValue)} /></div>
            <div><label className={lbl}>Teléfono</label><Input value={t.telefono} onChange={(e) => set("telefono", e.target.value)} /></div>
            <div className="md:col-span-2"><label className={lbl}>Email</label><Input value={t.email} onChange={(e) => set("email", e.target.value)} /></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar titular"}</Button>
            <button type="button" onClick={() => { setEditando(false); setT(inicial); setErr(""); }} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-xs text-green-600">Titular actualizado.</p>}
    </section>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{value || "—"}</div>
    </div>
  );
}
