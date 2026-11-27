"use client";

import { useEffect, useRef, useState } from "react";
import { UserCheck } from "lucide-react";
import { ETIQUETA_CANDIDATO, PCT_REFERIDO, formatPct, type CandidatoReferido, type DecisionReferido } from "@/lib/referidos/reglas";

// #76 — Código de referido escrito en el registro público: es un CANDIDATO. Aquí se muestra lo que la base resuelve HOY contra la regla guardada (referidor y %), y quien PUEDE decidir (superadmin/gerencia)
// elige qué hacer. Quien solo consulta (administración) ve la información sin controles. El navegador nunca decide la tarifa: «confirmar» manda lo que la persona VIO y la base lo compara con lo guardado.
type Modo = "confirmar" | "otro" | "descartar" | "despues";
type Opcion = { id: number; nombre: string };

export function DecisionCandidato({ candidato: c, referidores, gestiona, onChange, disabled }: {
  candidato: CandidatoReferido; referidores: Opcion[]; gestiona: boolean; onChange?: (d: DecisionReferido | null) => void; disabled?: boolean;
}) {
  const valido = c.referidor_id !== null && c.pct !== null;
  const [modo, setModo] = useState<Modo>(valido ? "confirmar" : "despues");
  const [otro, setOtro] = useState("");
  const [pctOtro, setPctOtro] = useState<string>(String(PCT_REFERIDO[0]));

  // Referencia estable: el padre puede pasar una función nueva en cada render sin provocar un ciclo.
  const aviso = useRef(onChange);
  useEffect(() => { aviso.current = onChange; });   // declarado ANTES del efecto de abajo: en cada commit se actualiza primero
  useEffect(() => {
    const onChange = aviso.current;
    if (!onChange) return;
    if (modo === "confirmar" && valido) onChange({ decision: "confirmar_codigo", referidorId: c.referidor_id as number, pct: c.pct === 0.02 ? 0.02 : 0.01 });
    else if (modo === "otro" && Number(otro) > 0) onChange({ decision: "asignar_otro", referidorId: Number(otro), pct: Number(pctOtro) === 0.02 ? 0.02 : 0.01 });
    else if (modo === "descartar") onChange({ decision: "descartar" });
    else onChange(null);
  }, [modo, otro, pctOtro, valido, c.referidor_id, c.pct]);

  const decidido = c.referido_estado !== "candidato";
  return (
    <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3" data-testid={`candidato-${c.solicitud_id}`}>
      <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-700">
        <UserCheck size={14} aria-hidden /> Código de referido escrito en el registro:
        <span className="rounded bg-white px-2 py-0.5 font-mono text-gray-900">{c.codigo}</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-500">{ETIQUETA_CANDIDATO[c.referido_estado]}</span>
      </p>
      <p className="mt-1 text-[11px] text-gray-600">
        {valido
          ? <>Corresponde a <strong>{c.referidor_nombre}</strong> al <strong>{formatPct(c.pct as number)}</strong> de la base comisionable de las compras futuras del aliado. Es un candidato: no se asigna hasta que superadmin o gerencia lo confirmen.</>
          : <>Ese código no corresponde hoy a un referidor activo de esta agencia. No se asignó nada.</>}
        {c.vigente_referidor && <> El aliado ya tiene como referidor vigente a <strong>{c.vigente_referidor}</strong>{c.vigente_pct !== null ? ` (${formatPct(c.vigente_pct)})` : ""}: confirmar lo reemplaza solo para compras futuras.</>}
      </p>

      {decidido ? null : gestiona ? (
        <fieldset className="mt-2 space-y-1.5" disabled={disabled}>
          <legend className="sr-only">Qué hacer con el código de referido</legend>
          {valido && (
            <label className="flex items-start gap-2 text-xs text-gray-700">
              <input type="radio" name={`ref-${c.solicitud_id}`} checked={modo === "confirmar"} onChange={() => setModo("confirmar")} className="mt-0.5" />
              <span>Confirmar: {c.referidor_nombre} · {formatPct(c.pct as number)}</span>
            </label>
          )}
          <label className="flex items-start gap-2 text-xs text-gray-700">
            <input type="radio" name={`ref-${c.solicitud_id}`} checked={modo === "otro"} onChange={() => setModo("otro")} className="mt-0.5" />
            <span>Asignar otro referidor o porcentaje</span>
          </label>
          {modo === "otro" && (
            <div className="ml-6 flex flex-wrap gap-2">
              <select aria-label="Referidor" value={otro} onChange={(e) => setOtro(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
                <option value="">Elige un referidor…</option>
                {referidores.map((r) => <option key={r.id} value={String(r.id)}>{r.nombre}</option>)}
              </select>
              <select aria-label="Porcentaje" value={pctOtro} onChange={(e) => setPctOtro(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
                {PCT_REFERIDO.map((p) => <option key={p} value={String(p)}>{formatPct(p)}</option>)}
              </select>
            </div>
          )}
          <label className="flex items-start gap-2 text-xs text-gray-700">
            <input type="radio" name={`ref-${c.solicitud_id}`} checked={modo === "descartar"} onChange={() => setModo("descartar")} className="mt-0.5" />
            <span>No asignar (descartar el código)</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-gray-700">
            <input type="radio" name={`ref-${c.solicitud_id}`} checked={modo === "despues"} onChange={() => setModo("despues")} className="mt-0.5" />
            <span>Decidir después (queda por confirmar en CRM → Referidos)</span>
          </label>
        </fieldset>
      ) : (
        <p className="mt-2 text-[11px] text-gray-500">Solo superadmin o gerencia confirman el referido y el porcentaje. Puedes aprobar el registro: el código queda por confirmar en CRM → Referidos.</p>
      )}
    </div>
  );
}
