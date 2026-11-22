"use client";

import { useState, useTransition } from "react";
import { FileSignature } from "lucide-react";
import { solicitarContratoCotizacion } from "@/app/portal/b2b/cotizaciones/actions";
import { textoResultado, textoSolicitud, type SolicitudContrato } from "@/lib/portal/solicitudContrato";
import { formatFechaLarga } from "@/lib/utils";

/** #78 — acción EXPLÍCITA, separada de guardar/ver la cotización. El estado mostrado viene del servidor; el mensaje tras pulsar, de la respuesta del servidor. */
export function BotonSolicitarContrato({ cotizacionId, solicitud }: { cotizacionId: number; solicitud: SolicitudContrato | null }) {
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const pedir = () => iniciar(async () => {
    setMensaje(null);
    const r = await solicitarContratoCotizacion(cotizacionId);
    setMensaje(r.ok ? { ok: true, texto: textoResultado(r) } : { ok: false, texto: r.error });
  });
  return (
    <div className="mt-1 flex flex-col items-end gap-1">
      {solicitud && <p className="max-w-[16rem] text-right text-[11px] text-gray-500">{textoSolicitud(solicitud, formatFechaLarga(solicitud.creado_en.slice(0, 10)))}</p>}
      <button type="button" onClick={pedir} disabled={pendiente} data-testid="solicitar-contrato"
        className="inline-flex items-center gap-1 rounded-lg border border-[#1D7C9A] px-2 py-1 text-xs font-semibold text-[#1D7C9A] hover:bg-[rgba(29,124,154,0.08)] disabled:opacity-50">
        <FileSignature aria-hidden size={13} /> {pendiente ? "Solicitando…" : solicitud ? "Volver a solicitar" : "Solicitar contrato"}
      </button>
      {mensaje && <p role="status" className={`max-w-[16rem] text-right text-[11px] ${mensaje.ok ? "text-[#3f7d63]" : "text-red-600"}`}>{mensaje.texto}</p>}
    </div>
  );
}
