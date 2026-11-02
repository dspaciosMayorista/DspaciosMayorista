import { Clock } from "lucide-react";
import { TEXTO_BAJO_SOLICITUD } from "@/lib/reservar/solicitudHotel";

// #120 · Documento de una solicitud pendiente de tarifa. NUNCA muestra importes: ni total, ni parciales, ni los de otros componentes del paquete.
export type DatosSolicitudHotel = {
  hotelNombre?: string | null; paqueteNombre?: string | null; destino?: string | null; categoria?: string | null; regimen?: string | null;
  habitaciones?: Partial<Record<"sencilla" | "doble" | "triple" | "multiple", number>> | null; menores?: number | null; adultos?: number | null; notas?: string | null;
  fechaIda?: string | null; fechaRegreso?: string | null;
};

const ROTULO: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple" };

export function SolicitudPendiente({ codigo, datos }: { codigo: string; datos: DatosSolicitudHotel | null }) {
  const fechaIda = datos?.fechaIda ?? null;
  const fechaRegreso = datos?.fechaRegreso ?? null;
  const habitaciones = Object.entries(datos?.habitaciones ?? {}).filter(([, n]) => (n ?? 0) > 0).map(([a, n]) => `${n} ${ROTULO[a] ?? a}`);
  return (
    <div className="mx-auto max-w-2xl px-4 py-10" data-testid="solicitud-pendiente">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Solicitud de cotización {codigo}</p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--brand-primary)]">{datos?.hotelNombre ?? "Hotel"}</h1>
        {datos?.paqueteNombre && <p className="text-sm text-gray-500">{datos.paqueteNombre}{datos.destino ? ` · ${datos.destino}` : ""}</p>}
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          <Clock className="h-4 w-4" aria-hidden="true" /> {TEXTO_BAJO_SOLICITUD}
        </p>
        <p className="mt-2 text-sm text-gray-600">Un asesor confirmará la disponibilidad y te enviará la cotización completa del paquete. Esta solicitud todavía no tiene precio y no puede reservarse ni pagarse.</p>
        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {fechaIda && fechaRegreso && <div><dt className="text-gray-500">Fechas</dt><dd className="font-medium text-gray-900">{fechaIda} al {fechaRegreso}</dd></div>}
          {habitaciones.length > 0 && <div><dt className="text-gray-500">Habitaciones</dt><dd className="font-medium text-gray-900">{habitaciones.join(", ")}</dd></div>}
          {datos?.adultos != null && <div><dt className="text-gray-500">Adultos</dt><dd className="font-medium text-gray-900">{datos.adultos}</dd></div>}
          {!!datos?.menores && <div><dt className="text-gray-500">Menores</dt><dd className="font-medium text-gray-900">{datos.menores}</dd></div>}
          {datos?.categoria && !(datos.categoria === "A confirmar" && datos.regimen === "A confirmar") && <div><dt className="text-gray-500">Habitación / plan</dt><dd className="font-medium text-gray-900">{datos.categoria} · {datos.regimen}</dd></div>}
        </dl>
        {datos?.notas && <p className="mt-3 text-sm text-gray-600">Notas: {datos.notas}</p>}
      </div>
    </div>
  );
}
