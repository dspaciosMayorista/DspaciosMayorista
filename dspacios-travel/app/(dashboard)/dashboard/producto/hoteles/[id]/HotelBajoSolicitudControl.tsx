"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TEXTO_BAJO_SOLICITUD } from "@/lib/reservar/solicitudHotel";
import { setHotelBajoSolicitud } from "../actions";

/** #120: marca editable del hotel «bajo solicitud» (sin tarifa publicada). Apagada por defecto; se guarda por separado del resto de la configuración. */
export function HotelBajoSolicitudControl({ hotelId, inicial, esUnidad }: { hotelId: number; inicial: boolean; esUnidad: boolean }) {
  const router = useRouter();
  const [marcado, setMarcado] = useState(inicial);
  const [guardado, setGuardado] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  function guardar() {
    setError(null);
    start(async () => {
      const r = await setHotelBajoSolicitud(hotelId, marcado);
      if (r.ok) { setGuardado(marcado); router.refresh(); } else { setError(r.error); setMarcado(guardado); }
    });
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="hotel-bajo-solicitud">
      <label className="flex items-center gap-2 text-xs font-semibold text-amber-900">
        <input type="checkbox" checked={marcado} disabled={esUnidad || pendiente} onChange={(e) => setMarcado(e.target.checked)} />
        Se ofrece bajo solicitud — sin tarifa publicada
      </label>
      <p className="mt-1 text-xs text-amber-800">
        {esUnidad
          ? "Un hotel por unidad (Bernalo) no puede ofrecerse bajo solicitud."
          : `Con la marca encendida el hotel se puede elegir en bloqueo, empaquetados y porción terrestre sin cargar tarifas y se muestra como «${TEXTO_BAJO_SOLICITUD}»; un operador carga la neta en cada solicitud. No se puede marcar si ya tiene tarifas, ni desmarcar con solicitudes abiertas.`}
      </p>
      {marcado !== guardado && (
        <Button type="button" variant="outline" className="mt-2" disabled={pendiente} onClick={guardar}>{pendiente ? "Guardando…" : "Guardar marca"}</Button>
      )}
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}
