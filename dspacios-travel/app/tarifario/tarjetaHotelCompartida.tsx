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

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, ChevronRight, Circle, CircleCheck, Info, Star, X } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { seccionesDescripcion, type DescripcionPaqueteRaw } from "@/lib/tarifario/descripcionPaquete";
import { descripcionParaSalida, descripcionConServicios } from "@/lib/tarifario/descripcionPaquete";
import type { ServicioIncluidoRef } from "@/lib/tarifario/incluyePorSalida";
import type { SeccionDescripcion } from "@/lib/tarifario/descripcionPaquete";

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
  /** Identidad del servicio dentro del paquete — la usa la selección de la
   * tarjeta del hotel (ver `ReceptivoModal`, prop `seleccion`). */
  servicioId?: number | null;
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

// ── Descripción del hotel, expandible (corrección visual — Vercel Preview) ──
// La tarjeta completa podía crecer demasiado por una descripción larga. Se
// muestra contraída a 2 líneas (`line-clamp-2`) y solo aparece "Ver más"
// cuando el texto REALMENTE desborda esas 2 líneas — nunca por una cantidad
// arbitraria de caracteres, sino midiendo el elemento renderizado
// (`scrollHeight` vs `clientHeight`, técnica estándar para line-clamp) con
// `ResizeObserver` para recalcular si cambia el ancho disponible (la tarjeta
// puede cambiar de tamaño por el layout responsive, sin que el texto cambie).
// Estado (`expandido`/`desborda`) vive en el propio componente — cada
// instancia (cada tarjeta) es independiente por diseño de React, sin
// necesidad de una llave externa.
export function DescripcionHotelExpandible({
  texto, className = "mt-2", textClassName = "text-sm text-gray-600",
}: {
  texto: string | null | undefined;
  /** Clases del contenedor (margen respecto al bloque anterior, etc.). */
  className?: string;
  /** Clases del texto (tamaño/color) — cada llamador conserva el estilo que
   * ya tenía antes de esta corrección (el modal usa `text-sm`, las tarjetas
   * compactas de resultado usan `text-xs`). */
  textClassName?: string;
}) {
  const [expandido, setExpandido] = useState(false);
  const [desborda, setDesborda] = useState(false);
  const refTexto = useRef<HTMLParagraphElement>(null);
  const idTexto = useId();

  useEffect(() => {
    const el = refTexto.current;
    if (!el) return;
    // El `line-clamp-2` solo está aplicado mientras `expandido` es false —
    // mientras el texto está expandido no hay nada que medir (el elemento
    // nunca desborda su propio contenido); el último `desborda` conocido
    // (de cuando SÍ estaba contraído) se conserva, así el botón "Ver menos"
    // sigue disponible para volver a contraer.
    if (expandido) return;
    const medir = () => setDesborda(el.scrollHeight - el.clientHeight > 1);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [texto, expandido]);

  if (!texto?.trim()) return null;
  return (
    <div className={className}>
      <p id={idTexto} ref={refTexto} className={expandido ? textClassName : `line-clamp-2 ${textClassName}`}>
        {texto}
      </p>
      {desborda && (
        <button
          type="button"
          aria-expanded={expandido}
          aria-controls={idTexto}
          onClick={() => setExpandido((v) => !v)}
          className="mt-0.5 text-xs font-medium"
          style={{ color: "var(--brand-accent)" }}
        >
          {expandido ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
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
export function UbicacionHotel({ hotelNombre, ubicacion, compacto = false }: { hotelNombre: string; ubicacion: string | null | undefined; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const idMapa = useId();
  if (!ubicacion?.trim()) return null;
  return (
    <div>
      {compacto ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ubicación</p>
          <button type="button" aria-expanded={abierto} aria-controls={idMapa}
            aria-label={`${abierto ? "Ver menos" : "Ver más"}: ubicación`}
            onClick={() => setAbierto((v) => !v)}
            className="inline-flex min-h-9 items-center gap-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]"
            style={{ color: "var(--brand-accent)" }}>
            {abierto ? "Ver menos" : "Ver más"}
            <ChevronDown size={14} aria-hidden className={abierto ? "rotate-180" : ""} />
          </button>
        </>
      ) : <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Ubicación</p>}
      <div id={idMapa} hidden={compacto && !abierto}>
        <a href={`https://www.google.com/maps?q=${encodeURIComponent(ubicacion)}`} target="_blank" rel="noopener noreferrer" className="mb-1 inline-block text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
          Ver en Google Maps →
        </a>
        {(!compacto || abierto) && <iframe
          title={`Mapa ${hotelNombre}`}
          src={`https://www.google.com/maps?q=${encodeURIComponent(ubicacion)}&output=embed`}
          className="h-56 w-full rounded-lg border border-gray-200"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />}
      </div>
    </div>
  );
}

// Las tarjetas y los dos modales muestran solo el acceso al detalle al abrir.
const IncluyeCompactoContexto = createContext(false);

/** Envoltorio de las tarjetas: los <SeccionesIncluye> de adentro salen compactos. */
export function IncluyeCompacto({ children }: { children: ReactNode }) {
  return <IncluyeCompactoContexto.Provider value={true}>{children}</IncluyeCompactoContexto.Provider>;
}

// Al cambiar la oferta seleccionada, cada instancia se cierra de nuevo.
function SeccionesIncluyeResumen({ descripcion }: { descripcion: DescripcionPaqueteRaw | undefined | null }) {
  const secciones = seccionesDescripcion(descripcion);
  const firma = secciones.map((s) => `${s.titulo}\u0001${s.items.join("\u0002")}`).join("\u0003");
  const [expandido, setExpandido] = useState(false);
  const [firmaAnterior, setFirmaAnterior] = useState(firma);
  if (firma !== firmaAnterior) {
    setFirmaAnterior(firma);
    setExpandido(false);
  }
  const idRegion = useId();

  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Incluye/No incluye</p>
      <button type="button" aria-expanded={expandido} aria-controls={idRegion}
        aria-label={`${expandido ? "Ver menos" : "Ver más"}: incluye y no incluye`}
        onClick={() => setExpandido((v) => !v)}
        className="inline-flex min-h-9 items-center gap-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]"
        style={{ color: "var(--brand-accent)" }}>
        {expandido ? "Ver menos" : "Ver más"}
        <ChevronDown size={14} aria-hidden className={expandido ? "rotate-180" : ""} />
      </button>
      <div id={idRegion} hidden={!expandido}>
        <ListaTarjeta secciones={secciones} />
      </div>
    </div>
  );
}

// El detalle abierto conserva todas las secciones y ajusta palabras largas.
function ListaTarjeta({ secciones }: {
  secciones: readonly SeccionDescripcion[];
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      {secciones.map((s) => (
        <div key={s.titulo} className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{s.titulo}</p>
          <ul className="space-y-0.5">
            {s.items.map((it, i) => (
              <li key={i} className="flex min-w-0 items-start gap-1.5 text-xs text-gray-700">
                <IconoSeccion titulo={s.titulo} />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {it}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Incluye/No incluye/Tarifas especiales/Condiciones comerciales de UN
// paquete puntual — nunca del hotel en abstracto (la descripción pertenece a
// `armado_paquetes`, ver lib/tarifario/descripcionPaquete.ts). El llamador
// decide QUÉ `paqueteId` corresponde (el de la opción/oferta/combo elegido);
// este componente solo renderiza — mismo criterio de "sección omitida si no
// tiene contenido" en los lugares que la usan. `compacto` (opcional) fuerza la
// variante: por defecto sigue al envoltorio <IncluyeCompacto> y, sin él, es la
// vista completa de siempre.
// «Incluye» POR SALIDA: el texto manual se conserva en la base, pero se presenta sin afirmar lo que esa salida no incluye ni cobra (un servicio incluido sin tarifa vigente
// en su fecha se omite). La salida se declara con <IncluyeSalida> (salida fija elegida, o composición ya resuelta de la búsqueda en vivo); sin él (vista general del
// paquete) se retira todo servicio omitido en alguna salida. El aviso para el operador NO se muestra aquí: va al diagnóstico de la publicación.
type SalidaIncluye = { fechaIda?: string | null; incluidos?: { efectivos: readonly ServicioIncluidoRef[]; omitidos: readonly ServicioIncluidoRef[] } | null };
const IncluyeSalidaContexto = createContext<SalidaIncluye | null>(null);
export function IncluyeSalida({ fechaIda, incluidos, children }: SalidaIncluye & { children: ReactNode }) {
  return <IncluyeSalidaContexto.Provider value={{ fechaIda, incluidos }}>{children}</IncluyeSalidaContexto.Provider>;
}
function usePresentada(d: DescripcionPaqueteRaw | undefined | null): DescripcionPaqueteRaw | undefined | null {
  const s = useContext(IncluyeSalidaContexto);
  if (!d) return d;
  return s?.incluidos ? descripcionConServicios(d, s.incluidos.efectivos, s.incluidos.omitidos).descripcion : descripcionParaSalida(d, s?.fechaIda).descripcion;
}
export function SeccionesIncluye({ descripcion, compacto }: { descripcion: DescripcionPaqueteRaw | undefined | null; compacto?: boolean }) {
  const delContexto = useContext(IncluyeCompactoContexto);
  descripcion = usePresentada(descripcion);
  const secciones = seccionesDescripcion(descripcion);
  if (!secciones.length) return null;
  if (compacto ?? delContexto) return <SeccionesIncluyeResumen descripcion={descripcion} />;
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
// general ni de otro paquete que comparta el mismo hotel. Cada servicio abre
// `ReceptivoModal`, donde se SELECCIONA o deselecciona para el hotel de esta
// tarjeta (subelección: nunca se agrega solo al carrito — viaja con el hotel).
//
// Corrección visual (Vercel Preview): la lista ya NO se expande dentro de la
// tarjeta. En la grilla de Vista Booking las tarjetas comparten fila, así
// que cualquier contenido que creciera en una estiraba la fila completa y
// dejaba huecos en las vecinas. Ahora la lista es un Popover (base-ui):
// flota anclada al botón, no ocupa espacio en el flujo, maneja foco/Escape/
// clic afuera y su alto está acotado con scroll propio.
//
// `paqueteId` es la identidad del paquete AL QUE PERTENECEN `addons` — no se
// usa para filtrar (`addons` ya llega acotado por el llamador, ver
// `HotelModal`/`HotelBernaloCotizarModal`/`Resultado`/`TarjetaUnidadBusqueda`),
// solo para CERRAR la lista automáticamente si cambia (ej. el usuario elige
// otra categoría/alimentación en `TarjetaUnidadBusqueda` y esa combinación
// pertenece a otro paquete): sin este cierre, la lista podría quedar abierta
// mostrando —por una fracción de segundo, hasta que este mismo componente
// reciba el `addons` nuevo— los add-ons del paquete ANTERIOR bajo el rótulo
// del nuevo. Mismo componente para persona y unidad — nunca dos copias.
export function AddonsPaquete({ addons, onAbrir, paqueteId, seleccion = [] }: {
  addons: Receptivo[];
  onAbrir: (info: ReceptivoModalInfo) => void;
  /** Paquete al que pertenecen `addons` — cambiar este valor cierra la
   * lista si estaba abierta. `undefined`/`null` cuando el llamador no tiene
   * (todavía) un paquete elegido — nunca dispara el cierre por sí solo. */
  paqueteId?: number | null;
  /** `servicioId` de los servicios ya seleccionados para el hotel (solo para
   * marcarlos en la lista; la selección se cambia en el modal). */
  seleccion?: readonly number[];
}) {
  const [abierto, setAbierto] = useState(false);
  const idTitulo = useId();

  // Cierre automático al cambiar de paquete (regla explícita del encargo) —
  // nunca deja la lista abierta mostrando add-ons de un paquete que ya no es
  // el vigente, ni siquiera momentáneamente. Ajuste de estado DURANTE el
  // render (patrón documentado de React para "resetear estado cuando cambia
  // una prop") en vez de un `useEffect`: evita el render en cascada de
  // llamar `setState` dentro de un efecto — React aplica este cambio antes
  // de pintar, así que nunca se alcanza a mostrar un frame con la lista
  // abierta y el `addons` del paquete nuevo a la vez.
  const [paqueteIdAnterior, setPaqueteIdAnterior] = useState(paqueteId);
  if (paqueteId !== paqueteIdAnterior) {
    setPaqueteIdAnterior(paqueteId);
    setAbierto(false);
  }

  if (!addons.length) return null;
  const elegidos = addons.filter((a) => a.servicioId != null && seleccion.includes(a.servicioId)).length;
  return (
    <Popover.Root open={abierto} onOpenChange={setAbierto}>
      <Popover.Trigger
        className="inline-flex items-center gap-1 self-start rounded text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]"
        style={{ color: "var(--brand-accent)" }}
      >
        Servicios adicionales ({addons.length}){elegidos > 0 ? ` · ${elegidos} elegido${elegidos === 1 ? "" : "s"}` : ""}
        <ChevronDown size={14} aria-hidden className={abierto ? "rotate-180 transition-transform" : "transition-transform"} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[60]">
          <Popover.Popup
            aria-labelledby={idTitulo}
            className="flex max-h-[min(22rem,var(--available-height))] w-[min(20rem,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl outline-none"
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
              <Popover.Title id={idTitulo} className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Servicios adicionales
              </Popover.Title>
              <Popover.Close aria-label="Cerrar lista de servicios" className="rounded p-0.5 text-gray-400 hover:text-gray-700">
                <X size={14} aria-hidden />
              </Popover.Close>
            </div>
            <ul className="overflow-y-auto py-1">
              {addons.map((a, i) => {
                const elegido = a.servicioId != null && seleccion.includes(a.servicioId);
                return (
                  <li key={a.servicioId ?? `n-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setAbierto(false);
                        onAbrir({
                          nombre: a.nombre, destino: a.destino, descripcion: a.descripcion, foto: a.foto, precio: a.desde, moneda: a.moneda,
                          notaPrecio: "desde · por persona", paqueteId: a.paqueteId, servicioId: a.servicioId,
                        });
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-gray-800">{a.nombre}</span>
                        <span className="block text-xs" style={{ color: "var(--brand-primary)" }}>desde {formatMoneda(a.desde, a.moneda)} · por persona</span>
                        {elegido && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--brand-success)" }}>
                            <Check size={12} aria-hidden /> Seleccionado
                          </span>
                        )}
                      </span>
                      <ChevronRight size={16} aria-hidden className="shrink-0 text-gray-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Modal de detalle de un receptivo (tour): foto + descripción + precio
// "desde". Abierto desde los add-ons de la tarjeta de un hotel, recibe
// `seleccion`: el servicio se SELECCIONA o deselecciona para ese hotel — no
// se agrega al carrito desde acá; la tarjeta lo cotiza con los datos del
// hotel y lo agrega JUNTO con él. Sin `seleccion` (pestaña Receptivos) es
// solo información.
export function ReceptivoModal({ receptivo, onClose, seleccion }: {
  receptivo: ReceptivoModalInfo;
  onClose: () => void;
  seleccion?: {
    seleccionado: boolean;
    onAlternar: () => void;
    /** Si está presente, la selección no se puede cambiar y se explica por qué. */
    motivoBloqueo?: string | null;
  };
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={receptivo.nombre} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          {receptivo.foto ? (
            <Image src={receptivo.foto} alt={receptivo.nombre} fill sizes="500px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
          )}
          <button type="button" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-700 shadow">
            Cerrar <X size={14} aria-hidden />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="text-lg font-semibold text-gray-800">{receptivo.nombre}</div>
          {receptivo.destino && <div className="text-sm text-gray-500">{receptivo.destino}</div>}
          {receptivo.descripcion?.trim() && (
            <p className="whitespace-pre-line text-sm text-gray-600">{receptivo.descripcion}</p>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{receptivo.notaPrecio}</div>
            <div className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(receptivo.precio, receptivo.moneda)}</div>
          </div>
          {seleccion && (
            <section aria-label="Servicio adicional de este hotel" className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-800">Servicio adicional de este hotel</p>
              <p className="mt-0.5 text-xs text-gray-500">
                El precio «desde» es referencial. Al seleccionarlo se cotiza con las fechas y pasajeros que elegiste para el hotel,
                y entra al carrito junto con el hotel cuando lo agregues.
              </p>
              {seleccion.motivoBloqueo ? (
                <p className="mt-3 text-xs text-gray-500">{seleccion.motivoBloqueo}</p>
              ) : (
                <button type="button" aria-pressed={seleccion.seleccionado} onClick={seleccion.onAlternar}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold sm:w-auto"
                  style={seleccion.seleccionado
                    ? { border: "1px solid var(--brand-success)", color: "var(--brand-success)", backgroundColor: "white" }
                    : { backgroundColor: "var(--brand-primary)", color: "white" }}>
                  {seleccion.seleccionado ? <><CircleCheck size={16} aria-hidden /> Seleccionado · quitar</> : <><Circle size={16} aria-hidden /> Seleccionar para este hotel</>}
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
