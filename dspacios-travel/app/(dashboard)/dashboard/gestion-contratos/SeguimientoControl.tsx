"use client";

// #106 · Control del ACUSE MANUAL de un voucher o una factura. Solo registra que el personal reporta que la entrega/envío ocurrió (actor, hora, canal y nota
// quedan en la bitácora y en la auditoría). NO envía nada, NO emite, NO toca pagos ni asientos: el texto de ayuda lo dice siempre que el panel está abierto.
import { useState, useTransition } from "react";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { registrarSeguimiento, type TipoSeguimiento } from "./actions";
import { CANALES, ETIQUETA_CANAL, type Canal } from "@/lib/gestionContratos/canales";

type Props = {
  numero: string;
  uid: string;
  tipo: TipoSeguimiento;
  puedeMarcar: boolean;
  puedeRetirar: boolean;
};

const TEXTOS: Record<TipoSeguimiento, { marcar: string; retirar: string; canal: string }> = {
  voucher_entregado: { marcar: "Registrar entrega", retirar: "Retirar acuse de entrega", canal: "¿Por qué canal se entregó?" },
  factura_enviada: { marcar: "Registrar envío", retirar: "Retirar acuse de envío", canal: "¿Por qué canal se envió?" },
};

const campo = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm";

export function SeguimientoControl({ numero, uid, tipo, puedeMarcar, puedeRetirar }: Props) {
  const [abierto, setAbierto] = useState<"marcar" | "retirar" | null>(null);
  const [canal, setCanal] = useState<Canal | "">("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const t = TEXTOS[tipo];
  if (!puedeMarcar && !puedeRetirar) return null;

  function cerrar() { setAbierto(null); setError(null); setCanal(""); setNota(""); }

  function enviar(accion: "marcar" | "desmarcar") {
    if (pendiente) return; // un solo envío a la vez (doble clic)
    if (accion === "marcar" && !canal) { setError("Elige el canal."); return; }
    setError(null);
    iniciar(async () => {
      const r = await registrarSeguimiento({ numero, uid, tipo, accion, canal: accion === "marcar" ? canal : undefined, nota });
      if (r.ok) cerrar(); else setError(r.error);
    });
  }

  if (!abierto) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {puedeMarcar && <button type="button" onClick={() => setAbierto("marcar")} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"><Check size={12} aria-hidden /> {t.marcar}</button>}
        {puedeRetirar && <button type="button" onClick={() => setAbierto("retirar")} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"><Undo2 size={12} aria-hidden /> {t.retirar}</button>}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2" aria-busy={pendiente}>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        Acuse manual: queda registrado quién lo reporta y cuándo. No envía nada ni genera pagos, asientos o facturas, y no prueba la entrega.
      </p>
      {abierto === "marcar" && (
        <label className="mb-2 block text-xs font-medium text-gray-600">
          {t.canal}
          <select value={canal} onChange={(e) => setCanal(e.target.value as Canal | "")} className={`${campo} mt-1`} disabled={pendiente}>
            <option value="">Elige…</option>
            {CANALES.map((c) => <option key={c} value={c}>{ETIQUETA_CANAL[c]}</option>)}
          </select>
        </label>
      )}
      <label className="mb-2 block text-xs font-medium text-gray-600">
        Nota (opcional)
        <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} className={`${campo} mt-1`} disabled={pendiente} />
      </label>
      {error && <p role="alert" className="mb-2 text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => enviar(abierto === "marcar" ? "marcar" : "desmarcar")} disabled={pendiente}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand-primary)" }}>
          {pendiente ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Check size={12} aria-hidden />}
          {abierto === "marcar" ? "Guardar acuse" : "Retirar acuse"}
        </button>
        <button type="button" onClick={cerrar} disabled={pendiente} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-600 hover:text-gray-900"><X size={12} aria-hidden /> Cancelar</button>
      </div>
    </div>
  );
}
