"use client";

// Modal de un paquete DINÁMICO dentro de "Paquetes" (Vista Booking). Visual propia: no hay cupos ni "vuelo"
// que elegir — se elige la FECHA de salida y se ven los precios por categoría/alimentación y acomodación.
// "Cotizar" lleva a la ruta de siempre (`reservar/nuevo`, módulo dinámico), que es la que genera la cotización.
// La lógica (agrupar, "desde", enlace) vive en lib/tarifario/dinamicoBooking.ts (pura y testeada).
import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import type { EstadoDetalle } from "@/lib/tarifario/detalleCliente";
import { agruparSalidasDinamicas, desdeSalidaDinamica, reservarHrefDinamico, ACOMODACIONES_DINAMICO } from "@/lib/tarifario/dinamicoBooking";
import type { DescripcionPaqueteRaw } from "@/lib/tarifario/descripcionPaquete";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import { Categoria, EtiquetasHotel, DescripcionHotelExpandible, UbicacionHotel, SeccionesIncluye } from "./tarjetaHotelCompartida";
import type { FilaTarifario } from "./TarifarioPublic";

export type HotelDinamicoModal = {
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  foto: string | null;
  video_url: string | null;
  estrellas: number | null;
  clasificacion: string | null;
  adultsOnly: boolean;
  petFriendly: boolean;
  descripcion: string | null;
  ubicacion: string | null;
  paqueteId?: number | null;
};

const ETIQUETA_ACOM: Record<string, string> = {
  nino: "Niño 1", nino2: "Niño 2", infante: "Infante (menor de 2 años)",
};
const etiquetaAcom = (a: string) => ETIQUETA_ACOM[a] ?? ACOM_ROOM_LABEL[a as AcomRoom] ?? a;

function fmtFecha(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function DinamicoModal({
  hotel, detalle, onReintentar, descripcionPorPaquete, onClose,
}: {
  hotel: HotelDinamicoModal;
  detalle: EstadoDetalle<FilaTarifario> | null;
  onReintentar: () => void;
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>;
  onClose: () => void;
}) {
  const salidas = useMemo(() => agruparSalidasDinamicas(detalle?.estado === "ok" ? detalle.filas : []), [detalle]);
  const [elegida, setElegida] = useState<number | null>(null);
  // Derivado en cada render (no un efecto): si la elegida ya no existe, cae a la primera.
  const salida = salidas.find((s) => s.salidaId === elegida) ?? salidas[0];
  const descripcion = hotel.paqueteId != null ? descripcionPorPaquete[hotel.paqueteId] : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          {hotel.video_url ? (
            <BackgroundVideo url={hotel.video_url} overlay={0} />
          ) : hotel.foto ? (
            <Image src={hotel.foto} alt={hotel.hotelNombre} fill sizes="640px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">Sin foto</div>
          )}
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-700 shadow">
            Cerrar
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">{hotel.hotelNombre}</h2>
              <Categoria estrellas={hotel.estrellas} clasificacion={hotel.clasificacion} className="text-base" />
              <EtiquetasHotel adultsOnly={hotel.adultsOnly} petFriendly={hotel.petFriendly} />
            </div>
            <p className="text-sm text-gray-500">{hotel.destino ?? ""}</p>
            <DescripcionHotelExpandible texto={hotel.descripcion} />
          </div>

          <UbicacionHotel hotelNombre={hotel.hotelNombre} ubicacion={hotel.ubicacion} compacto />

          {detalle === null || detalle.estado === "cargando" ? (
            <p className="py-4 text-center text-sm text-gray-400">Cargando fechas…</p>
          ) : detalle.estado === "error" ? (
            <div className="py-4 text-center">
              <p className="text-sm text-red-500">{detalle.mensaje}</p>
              <button type="button" onClick={onReintentar} className="mt-2 text-xs font-medium" style={{ color: "var(--brand-accent)" }}>Reintentar</button>
            </div>
          ) : !salida ? (
            <p className="text-sm text-gray-400">Sin disponibilidad publicada.</p>
          ) : (
            <>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Elige tu fecha de salida</p>
                <div className="flex flex-wrap gap-2">
                  {salidas.map((s) => {
                    const activa = s.salidaId === salida.salidaId;
                    const desde = desdeSalidaDinamica(s);
                    return (
                      <button
                        key={s.salidaId}
                        type="button"
                        onClick={() => setElegida(s.salidaId)}
                        aria-pressed={activa}
                        className="rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                        style={activa ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" } : { borderColor: "#e5e7eb", backgroundColor: "white" }}
                      >
                        <span className="flex items-center gap-1.5 font-medium text-gray-800">
                          <CalendarClock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                          {fmtFecha(s.fechaIda)} → {fmtFecha(s.fechaRegreso)}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {s.noches ? `${s.noches} noche${s.noches === 1 ? "" : "s"}` : ""}
                          {desde != null ? `${s.noches ? " · " : ""}desde ${formatMoneda(desde, s.moneda)}` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-3 py-2 font-medium">Categoría · alimentación</th>
                      {ACOMODACIONES_DINAMICO.filter((a) => salida.combos.some((c) => c.precios[a] != null)).map((a) => (
                        <th key={a} className="px-3 py-2 text-right font-medium">{etiquetaAcom(a)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {salida.combos.map((c) => (
                      <tr key={`${c.categoria}|${c.regimen}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-800">{c.categoria} · {c.regimen}</td>
                        {ACOMODACIONES_DINAMICO.filter((a) => salida.combos.some((x) => x.precios[a] != null)).map((a) => (
                          <td key={a} className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {c.precios[a] != null ? formatMoneda(c.precios[a], salida.moneda) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400">Valores por persona. Sujetos a disponibilidad; el precio final se confirma al generar la cotización.</p>

              {hotel.paqueteId != null && (
                <Link
                  href={reservarHrefDinamico({ paqueteId: hotel.paqueteId, hotelId: hotel.hotelId, salidaId: salida.salidaId })}
                  className="inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "var(--brand-accent)" }}
                >
                  Cotizar esta salida
                </Link>
              )}

              <SeccionesIncluye descripcion={descripcion} compacto />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
