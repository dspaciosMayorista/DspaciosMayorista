"use client";

// ─────────────────────────────────────────────────────────────────────────
// Piezas de la "tarjeta completa" REUTILIZABLES entre `VistaBooking.tsx`
// (exploración: `TarjetaHotelCard`/`HotelModal`/`HotelBernaloCotizarModal`)
// y `BuscadorBooking.tsx` (resultados de "Buscar alojamiento":
// `Resultado`/`TarjetaUnidadBusqueda` en VistaBooking.tsx).
//
// Auditoría de alcance (motor externo): antes esta JSX (ubicación/mapa,
// Incluye/No incluye, add-on) vivía duplicada dentro de `HotelModal` y
// `HotelBernaloCotizarModal` — al extender la corrección a las tarjetas de
// RESULTADO (`Resultado`/`TarjetaUnidadBusqueda`), escribirla una tercera y
// cuarta vez hubiera sido exactamente la duplicación que este archivo evita.
//
// Vive en su PROPIO archivo (no en VistaBooking.tsx) a propósito:
// `BuscadorBooking.tsx` es importado POR `VistaBooking.tsx`
// (`import { BuscadorBooking, Resultado } from "./BuscadorBooking"`) — si
// estas piezas vivieran en VistaBooking.tsx, `BuscadorBooking.tsx` tendría
// que importar DE VUELTA desde ahí, un ciclo de módulos. Este archivo no
// importa de ninguno de los dos, así que ambos lo importan sin ciclo.
// ─────────────────────────────────────────────────────────────────────────

import Image from "next/image";
import { Check, Info, Star, X } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { seccionesDescripcion, type DescripcionPaqueteRaw } from "@/lib/tarifario/descripcionPaquete";

// Servicio opcional (add-on) de un paquete — mismo shape en las 4 tarjetas
// que lo consumen (exploración y resultados de búsqueda, persona y unidad).
export type Receptivo = {
  servicioId: number | null;
  paqueteId: number | null;
  nombre: string;
  destino: string | null;
  descripcion: string | null;
  foto: string | null;
  desde: number;
  moneda?: string | null;
};

// Info que necesita el modal de detalle de un receptivo, sea de la vitrina
// estática ("desde", por persona) o de un resultado ya liquidado por fechas/
// pax (total real de esa búsqueda). `paqueteId` habilita el botón Reservar →
// (deep-link al flujo de reservar servicios, que pregunta pax/fechas él solo).
export type ReceptivoModalInfo = {
  nombre: string;
  destino: string | null;
  descripcion: string | null;
  foto: string | null;
  precio: number;
  moneda?: string | null;
  notaPrecio: string;
  paqueteId: number | null;
};

// Estrellas (★) o, si no maneja, la clasificación (Boutique/Luxury…) como chip.
export function Categoria({ estrellas, clasificacion, className = "" }: { estrellas: number | null; clasificacion: string | null; className?: string }) {
  if (estrellas && estrellas > 0) {
    return (
      <span className={`inline-flex align-middle text-amber-400 ${className}`} title={`${estrellas} estrellas`}>
        {Array.from({ length: estrellas }).map((_, i) => <Star key={i} size={12} fill="currentColor" strokeWidth={0} />)}
      </span>
    );
  }
  if (clasificacion?.trim()) {
    return <span className={`rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 ${className}`}>{clasificacion}</span>;
  }
  return null;
}

// Adults Only / Pet friendly — informativos, sin exponer costo neto.
export function EtiquetasHotel({ adultsOnly, petFriendly, className = "" }: { adultsOnly: boolean; petFriendly: boolean; className?: string }) {
  if (!adultsOnly && !petFriendly) return null;
  return (
    <>
      {adultsOnly && (
        <span className={`rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ${className}`} title="Este hotel no acepta niños ni infantes">
          Adults Only
        </span>
      )}
      {petFriendly && (
        <span className={`rounded-full bg-[var(--brand-success)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-success)] ${className}`} title="Este hotel acepta mascotas">
          Pet friendly
        </span>
      )}
    </>
  );
}

// Ícono por sección de la descripción manual del paquete — nunca un emoji
// (regla de marca): check para "Incluye", tache para "No incluye", un ícono
// informativo neutro para el resto (tarifas especiales/condiciones).
function IconoSeccion({ titulo }: { titulo: string }) {
  if (titulo === "El programa incluye") return <Check size={14} className="shrink-0" style={{ color: "var(--brand-success)" }} />;
  if (titulo === "El programa no incluye") return <X size={14} className="shrink-0 text-gray-400" />;
  return <Info size={14} className="shrink-0 text-gray-400" />;
}

// Bloque de ubicación/mapa — mismo criterio en TODA la app: informativo,
// nunca expone nada de precio/disponibilidad. `null`/vacío/solo-espacios →
// no se renderiza nada (nunca un mapa sin dirección real).
export function UbicacionHotel({ hotelNombre, ubicacion }: { hotelNombre: string; ubicacion: string | null | undefined }) {
  if (!ubicacion?.trim()) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ubicación</span>
        <a href={`https://www.google.com/maps?q=${encodeURIComponent(ubicacion)}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
          Ver en Google Maps →
        </a>
      </div>
      <iframe
        title={`Mapa ${hotelNombre}`}
        src={`https://www.google.com/maps?q=${encodeURIComponent(ubicacion)}&output=embed`}
        className="h-56 w-full rounded-lg border border-gray-200"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

// Incluye/No incluye/Tarifas especiales/Condiciones comerciales de UN
// paquete puntual — nunca del hotel en abstracto (la descripción pertenece a
// `armado_paquetes`, ver lib/tarifario/descripcionPaquete.ts). El llamador
// decide QUÉ `paqueteId` corresponde (el de la opción/oferta/combo elegido);
// este componente solo renderiza — mismo criterio de "sección omitida si no
// tiene contenido" en los lugares que la usan.
export function SeccionesIncluye({ descripcion }: { descripcion: DescripcionPaqueteRaw | undefined | null }) {
  const secciones = seccionesDescripcion(descripcion);
  if (!secciones.length) return null;
  return (
    <div className="space-y-3">
      {secciones.map((s) => (
        <div key={s.titulo} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{s.titulo}</p>
          <ul className="space-y-1">
            {s.items.map((it, i) => (
              <li key={i} className="flex items-center gap-1.5 text-sm text-gray-700">
                <IconoSeccion titulo={s.titulo} />
                {it}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Servicios opcionales (add-on) de UN paquete puntual — nunca del catálogo
// general ni de otro paquete que comparta el mismo hotel. Solo vista de
// información (abre `ReceptivoModal`); agregar al carrito sigue siendo un
// paso aparte del flujo de servicios, igual en los lugares que la usan.
export function AddonsPaquete({ addons, onAbrir }: { addons: Receptivo[]; onAbrir: (info: ReceptivoModalInfo) => void }) {
  if (!addons.length) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Servicios opcionales (add-on)</p>
      <div className="flex flex-wrap gap-2">
        {addons.map((a, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onAbrir({ nombre: a.nombre, destino: a.destino, descripcion: a.descripcion, foto: a.foto, precio: a.desde, moneda: a.moneda, notaPrecio: "desde · por persona", paqueteId: a.paqueteId })}
            className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition-colors hover:border-[var(--brand-accent)]"
          >
            <span className="block font-medium text-gray-800">{a.nombre}</span>
            <span className="block text-xs" style={{ color: "var(--brand-primary)" }}>desde {formatMoneda(a.desde, a.moneda)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Modal de detalle de un receptivo (tour): solo foto + descripción + precio.
// Sin botón de reservar directo — agregar al carrito se hace desde la
// tarjeta del resultado (o desde el listado de add-ons del hotel), nunca
// saltando el flujo de carrito → cotización.
export function ReceptivoModal({ receptivo, onClose }: { receptivo: ReceptivoModalInfo; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          {receptivo.foto ? (
            <Image src={receptivo.foto} alt={receptivo.nombre} fill sizes="500px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
          )}
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-700 shadow">
            Cerrar ✕
          </button>
        </div>
        <div className="p-5">
          <div className="text-lg font-semibold text-gray-800">{receptivo.nombre}</div>
          {receptivo.destino && <div className="text-sm text-gray-500">{receptivo.destino}</div>}
          {receptivo.descripcion?.trim() && (
            <p className="mt-3 whitespace-pre-line text-sm text-gray-600">{receptivo.descripcion}</p>
          )}
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{receptivo.notaPrecio}</div>
            <div className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(receptivo.precio, receptivo.moneda)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
