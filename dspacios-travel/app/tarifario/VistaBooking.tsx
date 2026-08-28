"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { Star, Check } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, defaultAcomConfig, textoEdadesHotel, type AcomRoom, type AcomConfig } from "@/lib/acomodaciones";
import { useCart, type HotelCartItem } from "@/lib/cart/CartContext";
import { cotizarPorFechas } from "@/app/(dashboard)/dashboard/reservar/actions";
import { type ComboCotizado, type SugerenciaFecha } from "@/lib/reservar/cotizar";
import {
  EDAD_MENOR_MAX,
  MAX_MENORES_POR_CONSULTA,
  ajustarCantidadEdades,
  parseEdadMenor,
  clasificarMenoresPorEdad,
  verificarTarifasMenoresDisponibles,
} from "@/lib/reservar/edadesMenores";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "@/lib/reservar/distribucionHabitaciones";
import { RegimenInfo, type PlanesInfo } from "./RegimenInfo";
import { BuscadorBooking } from "./BuscadorBooking";
import { BuscadorReceptivos } from "./BuscadorReceptivos";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import type { FilaTarifario, CapHotel } from "./TarifarioPublic";

const CAP_VACIA = { paxMin: null as number | null, paxMax: null as number | null, acom: [] as AcomConfig[] };

// ── Modelo de la vista dinámica: tarjetas por hotel, detalle con opciones ────
type HotelCard = {
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  foto: string | null;
  desde: number | null;
  estrellas: number | null;
  clasificacion: string | null;
  descripcion: string | null;
  ubicacion: string | null;
  video_url: string | null;
  ninoMin: number | null; ninoMax: number | null; infMin: number | null; infMax: number | null;
  adultsOnly: boolean;
  petFriendly: boolean;
  filas: FilaTarifario[];
  moneda?: string | null;
};

type Receptivo = {
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
type ReceptivoModalInfo = {
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
function Categoria({ estrellas, clasificacion, className = "" }: { estrellas: number | null; clasificacion: string | null; className?: string }) {
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

// Adults Only / Pet friendly — mismos criterios que el tarifario público (tarifas
// horizontales): informativos, sin exponer costo neto.
function EtiquetasHotel({ adultsOnly, petFriendly, className = "" }: { adultsOnly: boolean; petFriendly: boolean; className?: string }) {
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

type Opcion = {
  key: string;
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  bloqueoId: number | null;
  label: string;
  destino: string | null;
  origen: string | null;
  cupos: number | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  filas: FilaTarifario[];
};

function fmtFecha(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function calcNoches(ida: string, regreso: string): number {
  const a = new Date(`${ida}T00:00:00`).getTime();
  const b = new Date(`${regreso}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function minRoomPvp(filas: FilaTarifario[]): number | null {
  // Solo acomodaciones de adulto (sencilla/doble/triple/multiple) — nino/nino2/
  // infante quedan afuera del "desde" (si no, la tarifa de infante, casi
  // siempre la más baja de todas, terminaba mostrándose como el precio).
  const precios = filas
    .filter((f) => ACOM_ROOMS.includes(f.acomodacion as AcomRoom) && f.precio_pvp > 0)
    .map((f) => f.precio_pvp);
  return precios.length ? Math.min(...precios) : null;
}

export function VistaBooking({
  filas,
  fotosPorHotel = {},
  fotosPorServicio = {},
  cuposPorBloqueo = {},
  origenPorBloqueo = {},
  puedeReservar = false,
  ventanaPorPaquete = {},
  infoPorHotel = {},
  planesInfo = {},
  capPorHotel = {},
  soloAcom = null,
  incluidosPorPaquete = {},
  filasAddon = [],
  sub: subProp,
  onSubChange,
}: {
  filas: FilaTarifario[];
  fotosPorHotel?: Record<number, string>;
  fotosPorServicio?: Record<number, string>;
  cuposPorBloqueo?: Record<number, number>;
  origenPorBloqueo?: Record<number, string>;
  puedeReservar?: boolean;
  ventanaPorPaquete?: Record<number, { min: string | null; max: string | null }>;
  infoPorHotel?: Record<number, { estrellas: number | null; clasificacion: string | null; descripcion: string | null; ubicacion: string | null; video_url?: string | null; ninoMin?: number | null; ninoMax?: number | null; infMin?: number | null; infMax?: number | null; adultsOnly?: boolean; petFriendly?: boolean }>;
  planesInfo?: PlanesInfo;
  capPorHotel?: CapHotel;
  soloAcom?: string | null;
  // Servicios marcados "incluido" al armar el paquete (armado_servicios) — se
  // hornean en el PVP del hotel y nunca se publican como fila propia en
  // tarifario_resultado, así que llegan aparte para mostrarlos en "Incluye".
  incluidosPorPaquete?: Record<number, string[]>;
  // Add-ons (modulo="servicios") de TODOS los paquetes de hotel, sin el
  // recorte que aplica `filas` para la vitrina plana de Servicios — de acá
  // sale `addonsPorPaquete`, scoped al hotel que se está viendo.
  filasAddon?: FilaTarifario[];
  // Submódulo CONTROLADO por el padre (ronda "carga bajo demanda"): el
  // padre (`TarifarioPublic`) necesita saber qué submódulo está activo para
  // pedir la página server-side correcta (nunca el catálogo completo) — sin
  // esto, cambiar de pestaña no traería datos del módulo nuevo. Si no se
  // pasa, se comporta como antes (estado propio, sin padre que lo escuche).
  sub?: "bloqueo" | "porcion_terrestre" | "receptivos";
  onSubChange?: (sub: "bloqueo" | "porcion_terrestre" | "receptivos") => void;
}) {
  // Submódulos de la vista Booking — controlado por el padre si pasa `sub`/
  // `onSubChange` (ver arriba), si no cae al estado propio de siempre.
  const [subLocal, setSubLocal] = useState<"bloqueo" | "porcion_terrestre" | "receptivos">("bloqueo");
  const sub = subProp ?? subLocal;
  const setSub = onSubChange ?? setSubLocal;
  // Buscador de bloqueos: origen → destino → salida (vuelo).
  const [origenSel, setOrigenSel] = useState("");
  const [destinoSel, setDestinoSel] = useState("");
  const [salidaSel, setSalidaSel] = useState<number | "">("");
  // Filtros de la grilla de hoteles: pet friendly / adults only.
  const [soloPetFriendly, setSoloPetFriendly] = useState(false);
  const [soloAdultsOnly, setSoloAdultsOnly] = useState(false);

  const { add, openDrawer, addonsIntent, setAddonsIntent } = useCart();
  // Señal del carrito ("+ Agregar servicios/tours" con un hotel ya elegido):
  // salta directo a Receptivos con destino/fechas/pax ya puestos.
  useEffect(() => {
    if (addonsIntent) setSub("receptivos");
  }, [addonsIntent, setSub]);

  // Salidas (bloqueos) con cupos > 0, con su origen/destino/fechas/cupos.
  const salidasBloqueo = useMemo(() => {
    const map = new Map<number, { id: number; origen: string; destino: string; label: string; fechaIda: string | null; fechaRegreso: string | null; noches: number | null; cupos: number }>();
    for (const f of filas) {
      if (f.modulo !== "bloqueo" || f.bloqueo_id == null) continue;
      const cupos = cuposPorBloqueo[f.bloqueo_id];
      if (cupos !== undefined && cupos <= 0) continue;
      if (map.has(f.bloqueo_id)) continue;
      map.set(f.bloqueo_id, {
        id: f.bloqueo_id,
        origen: origenPorBloqueo[f.bloqueo_id] ?? "",
        destino: f.destino_nombre ?? "",
        label: f.bloqueo_label ?? "Salida",
        fechaIda: f.fecha_ida, fechaRegreso: f.fecha_regreso, noches: f.noches,
        cupos: cupos ?? 0,
      });
    }
    // De la salida más cercana a la más lejana; sin fecha, al final.
    return [...map.values()].sort((a, b) => (a.fechaIda ?? "9999-99-99").localeCompare(b.fechaIda ?? "9999-99-99"));
  }, [filas, cuposPorBloqueo, origenPorBloqueo]);

  const origenes = useMemo(() => [...new Set(salidasBloqueo.map((s) => s.origen).filter(Boolean))].sort(), [salidasBloqueo]);
  const destinosBloqueo = useMemo(
    () => [...new Set(salidasBloqueo.filter((s) => !origenSel || s.origen === origenSel).map((s) => s.destino).filter(Boolean))].sort(),
    [salidasBloqueo, origenSel]
  );
  const salidasFiltradas = useMemo(
    () => salidasBloqueo.filter((s) => (!origenSel || s.origen === origenSel) && (!destinoSel || s.destino === destinoSel)),
    [salidasBloqueo, origenSel, destinoSel]
  );

  // Tarjetas de hotel del submódulo activo (bloqueo o porción).
  const hoteles = useMemo<HotelCard[]>(() => {
    const mod = sub === "receptivos" ? null : sub;
    const conHotel = filas.filter((f) => {
      if (mod == null || f.modulo !== mod || f.hotel_id == null) return false;
      if (mod === "bloqueo" && f.bloqueo_id != null) {
        const c = cuposPorBloqueo[f.bloqueo_id];
        if (c !== undefined && c <= 0) return false; // sin cupos: no se muestra
        if (origenSel && origenPorBloqueo[f.bloqueo_id] !== origenSel) return false;
        if (destinoSel && (f.destino_nombre ?? "") !== destinoSel) return false;
        if (salidaSel !== "" && f.bloqueo_id !== salidaSel) return false;
      }
      return true;
    });
    const map = new Map<number, HotelCard>();
    for (const f of conHotel) {
      const id = f.hotel_id as number;
      let c = map.get(id);
      if (!c) {
        const info = infoPorHotel[id];
        c = {
          hotelId: id, hotelNombre: f.hotel_nombre ?? "—", destino: f.destino_nombre,
          foto: fotosPorHotel[id] ?? null, desde: null,
          estrellas: info?.estrellas ?? null, clasificacion: info?.clasificacion ?? null, descripcion: info?.descripcion ?? null,
          ubicacion: info?.ubicacion ?? null, video_url: info?.video_url ?? null,
          ninoMin: info?.ninoMin ?? null, ninoMax: info?.ninoMax ?? null, infMin: info?.infMin ?? null, infMax: info?.infMax ?? null,
          adultsOnly: info?.adultsOnly ?? false, petFriendly: info?.petFriendly ?? false,
          filas: [], moneda: f.moneda ?? "COP",
        };
        map.set(id, c);
      }
      c.filas.push(f);
    }
    let arr = [...map.values()];
    // Filtro de acomodación (de la barra superior): el hotel se muestra solo si
    // tiene tarifa para esa acomodación.
    if (soloAcom) arr = arr.filter((c) => c.filas.some((f) => f.acomodacion === soloAcom && f.precio_pvp > 0));
    if (soloPetFriendly) arr = arr.filter((c) => c.petFriendly);
    if (soloAdultsOnly) arr = arr.filter((c) => c.adultsOnly);
    for (const c of arr) c.desde = minRoomPvp(c.filas);
    return arr.sort((a, b) => a.hotelNombre.localeCompare(b.hotelNombre));
  }, [filas, fotosPorHotel, infoPorHotel, sub, cuposPorBloqueo, origenPorBloqueo, origenSel, destinoSel, salidaSel, soloAcom, soloPetFriendly, soloAdultsOnly]);

  const [abierto, setAbierto] = useState<HotelCard | null>(null);
  const [receptivoAbierto, setReceptivoAbierto] = useState<ReceptivoModalInfo | null>(null);

  // Receptivos (servicios) para su submódulo: agrupados por nombre con su
  // "desde", y luego por destino (una sección por destino) para no mezclarlos.
  const SIN_DESTINO = "Otros / todo destino";
  const receptivosPorDestino = useMemo(() => {
    const map = new Map<string, Receptivo>();
    for (const f of filas.filter((f) => f.modulo === "servicios" && f.servicio_nombre)) {
      const k = `${f.servicio_nombre}|${f.destino_nombre ?? ""}`;
      const prev = map.get(k);
      const p = f.precio_pvp ?? 0;
      if (!prev) {
        map.set(k, {
          servicioId: f.servicio_id ?? null, paqueteId: f.paquete_id ?? null, nombre: f.servicio_nombre as string, destino: f.destino_nombre,
          descripcion: f.descripcion ?? null, foto: f.servicio_id != null ? (fotosPorServicio[f.servicio_id] ?? null) : null,
          desde: p, moneda: f.moneda,
        });
      } else if (p > 0 && p < prev.desde) prev.desde = p;
    }
    const porDestino = new Map<string, Receptivo[]>();
    for (const r of map.values()) {
      const key = r.destino ?? SIN_DESTINO;
      const arr = porDestino.get(key) ?? [];
      arr.push(r);
      porDestino.set(key, arr);
    }
    for (const arr of porDestino.values()) arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return [...porDestino.entries()].sort(([a], [b]) => (a === SIN_DESTINO ? 1 : b === SIN_DESTINO ? -1 : a.localeCompare(b)));
  }, [filas, fotosPorServicio]);

  // Servicios opcionales (add-on) de CADA paquete puntual — de `filasAddon`
  // (sin el recorte que aplica `filas`/`filasVisibles` para la vitrina plana
  // de Servicios), agrupados por paquete_id en vez de por destino, para
  // ofrecer en el modal del hotel SOLO los add-on de su propio paquete (nunca
  // los de otros destinos, a diferencia de la pestaña Receptivos).
  const addonsPorPaquete = useMemo(() => {
    const map = new Map<number, Map<string, Receptivo>>();
    for (const f of filasAddon) {
      if (f.modulo !== "servicios" || !f.servicio_nombre || f.paquete_id == null) continue;
      let porNombre = map.get(f.paquete_id);
      if (!porNombre) { porNombre = new Map(); map.set(f.paquete_id, porNombre); }
      const prev = porNombre.get(f.servicio_nombre);
      const p = f.precio_pvp ?? 0;
      if (!prev) {
        porNombre.set(f.servicio_nombre, {
          servicioId: f.servicio_id ?? null, paqueteId: f.paquete_id, nombre: f.servicio_nombre, destino: f.destino_nombre,
          descripcion: f.descripcion ?? null, foto: f.servicio_id != null ? (fotosPorServicio[f.servicio_id] ?? null) : null,
          desde: p, moneda: f.moneda,
        });
      } else if (p > 0 && p < prev.desde) prev.desde = p;
    }
    const out = new Map<number, Receptivo[]>();
    for (const [pid, porNombre] of map) out.set(pid, [...porNombre.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    return out;
  }, [filasAddon, fotosPorServicio]);

  const SUBTABS = [
    { key: "bloqueo", label: "Paquetes" },
    { key: "porcion_terrestre", label: "Porción terrestre" },
    { key: "receptivos", label: "Receptivos" },
  ] as const;

  // Destinos disponibles (porción) para el filtro del mini-motor.
  const destinos = useMemo(
    () => [...new Set(filas.filter((f) => f.modulo === "porcion_terrestre" && f.destino_nombre).map((f) => f.destino_nombre as string))].sort((a, b) => a.localeCompare(b)),
    [filas]
  );
  // Destinos disponibles de RECEPTIVOS para el filtro de su mini-motor.
  const destinosServicios = useMemo(
    () => [...new Set(filas.filter((f) => f.modulo === "servicios" && f.destino_nombre).map((f) => f.destino_nombre as string))].sort((a, b) => a.localeCompare(b)),
    [filas]
  );

  return (
    <div>
      {/* Submódulos: Bloqueos · Porción terrestre · Receptivos */}
      <div className="mb-5 flex flex-wrap gap-2">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSub(t.key)}
            className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
            style={sub === t.key
              ? { backgroundColor: "var(--brand-primary)", color: "white" }
              : { backgroundColor: "white", color: "#4b5563", border: "1px solid #e5e7eb" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Buscador de BLOQUEOS: origen → destino → salida (vuelo) */}
      {sub === "bloqueo" && (
        <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Buscar vuelo + hotel (paquete)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Origen</label>
              <select value={origenSel} onChange={(e) => { setOrigenSel(e.target.value); setDestinoSel(""); setSalidaSel(""); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Todos</option>
                {origenes.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Destino</label>
              <select value={destinoSel} onChange={(e) => { setDestinoSel(e.target.value); setSalidaSel(""); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Todos</option>
                {destinosBloqueo.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Salida (vuelo)</label>
              <select value={salidaSel} onChange={(e) => setSalidaSel(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Todas las salidas</option>
                {salidasFiltradas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.origen} → {s.destino} · {fmtFecha(s.fechaIda)}–{fmtFecha(s.fechaRegreso)}{s.noches ? ` (${s.noches}N)` : ""} · {s.cupos} cupos
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">Elige el origen y el destino; las fechas salen del vuelo (no son libres). El resto (habitaciones y acomodación) se elige en cada hotel.</p>
        </div>
      )}

      {sub === "receptivos" ? (
        <>
        <BuscadorReceptivos
          destinos={destinosServicios}
          fotosPorServicio={fotosPorServicio}
          initial={addonsIntent}
          onConsumedInitial={() => setAddonsIntent(null)}
          onAgregar={(item) => { add(item); openDrawer(); }}
          onVerDetalle={(r) => setReceptivoAbierto({
            nombre: r.nombre, destino: r.destino, descripcion: r.descripcion,
            foto: fotosPorServicio[r.servicioId] ?? null, precio: r.total, moneda: r.moneda,
            notaPrecio: `total · ${r.pax} pax · ${r.noches} noche${r.noches === 1 ? "" : "s"}`,
            paqueteId: r.paqueteId ?? null,
          })}
        />
        {receptivosPorDestino.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">No hay receptivos publicados.</p>
        ) : (
          <div className="space-y-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">O explora todos los receptivos</p>
            {receptivosPorDestino.map(([destino, items]) => (
              <div key={destino}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {destino} <span className="ml-1 font-normal normal-case text-gray-400">({items.length})</span>
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setReceptivoAbierto({ nombre: r.nombre, destino: r.destino, descripcion: r.descripcion, foto: r.foto, precio: r.desde, moneda: r.moneda, notaPrecio: "desde · por persona", paqueteId: r.paqueteId })}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
                    >
                      <div className="relative aspect-[16/10] w-full bg-gray-100">
                        {r.foto ? (
                          <Image src={r.foto} alt={r.nombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col p-4">
                        <div className="font-semibold text-gray-800">{r.nombre}</div>
                        {r.descripcion?.trim() && (
                          <p className="mt-1 line-clamp-2 text-xs text-gray-400">{r.descripcion}</p>
                        )}
                        <div className="mt-3 flex items-end justify-between">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-gray-400">desde</div>
                            <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(r.desde, r.moneda)}</div>
                            <div className="text-[10px] text-gray-400">por persona</div>
                          </div>
                          <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "var(--brand-accent)" }}>
                            Ver más →
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        </>
      ) : (
      <>
      {/* Mini-motor por fechas: solo en Porción terrestre (en bloqueo manda el vuelo) */}
      {sub === "porcion_terrestre" && (
        <BuscadorBooking fotosPorHotel={fotosPorHotel} infoPorHotel={infoPorHotel} destinos={destinos} />
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {sub === "bloqueo" ? "Hoteles disponibles" : "O explora todos los alojamientos"}
          <span className="ml-2 font-normal normal-case text-gray-400">({hoteles.length})</span>
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={soloPetFriendly} onChange={(e) => setSoloPetFriendly(e.target.checked)} />
            Pet friendly
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={soloAdultsOnly} onChange={(e) => setSoloAdultsOnly(e.target.checked)} />
            Adults Only
          </label>
        </div>
      </div>
      {!hoteles.length && <p className="py-8 text-center text-sm text-gray-400">No hay alojamientos para los filtros aplicados. Prueba quitar filtros o cambiar de pestaña (Paquetes/Porción).</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hoteles.map((h) => (
          <button
            key={h.hotelId}
            type="button"
            onClick={() => setAbierto(h)}
            className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
          >
            <div className="relative aspect-[16/10] w-full bg-gray-100">
              {h.foto ? (
                <Image src={h.foto} alt={h.hotelNombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
              )}
              {/* Cupos disponibles (solo para bloqueos con datos) */}
              {(() => {
                const ids = [...new Set(h.filas.filter((f) => f.bloqueo_id != null).map((f) => f.bloqueo_id as number))];
                const vals = ids.map((id) => cuposPorBloqueo[id]).filter((c): c is number => c != null && c > 0);
                const min = vals.length ? Math.min(...vals) : null;
                return min !== null ? (
                  <span className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
                    {min} cupo{min !== 1 ? "s" : ""}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-800">{h.hotelNombre}</span>
                <Categoria estrellas={h.estrellas} clasificacion={h.clasificacion} className="text-sm" />
                <EtiquetasHotel adultsOnly={h.adultsOnly} petFriendly={h.petFriendly} />
              </div>
              <div className="mt-0.5 text-xs text-gray-500">{h.destino ?? ""}</div>
              {h.descripcion?.trim() && (
                <p className="mt-1 line-clamp-2 text-xs text-gray-400">{h.descripcion}</p>
              )}
              <div className="mt-3 flex items-end justify-between">
                {h.desde != null ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">desde</div>
                    <div className="text-xl font-extrabold tracking-tight" style={{ color: "var(--brand-primary)" }}>{formatMoneda(h.desde, h.moneda)}</div>
                    <div className="text-[10px] text-gray-400">por persona</div>
                  </div>
                ) : <span className="text-sm text-gray-400">Consultar</span>}
                <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "var(--brand-accent)" }}>
                  Ver opciones →
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      </>
      )}

      {abierto && (
        <HotelModal hotel={abierto} cuposPorBloqueo={cuposPorBloqueo} origenPorBloqueo={origenPorBloqueo} puedeReservar={puedeReservar} ventanaPorPaquete={ventanaPorPaquete} planesInfo={planesInfo} cap={capPorHotel[abierto.hotelId] ?? CAP_VACIA} incluidosPorPaquete={incluidosPorPaquete} addonsPorPaquete={addonsPorPaquete} onClose={() => setAbierto(null)} />
      )}

      {receptivoAbierto && (
        <ReceptivoModal receptivo={receptivoAbierto} onClose={() => setReceptivoAbierto(null)} />
      )}
    </div>
  );
}

// ── Modal de detalle de un receptivo (tour): solo foto + descripción + precio.
//    Sin botón de reservar directo — agregar al carrito se hace desde la
//    tarjeta del resultado (o desde el listado de add-ons del hotel), nunca
//    saltando el flujo de carrito → cotización. ────────────────────────────
function ReceptivoModal({ receptivo, onClose }: { receptivo: ReceptivoModalInfo; onClose: () => void }) {
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

// ── Modal de detalle: elige opción (salida/paquete), categoría/régimen y
//    habitaciones; calcula el precio y agrega al carrito ─────────────────────
function HotelModal({
  hotel, cuposPorBloqueo, origenPorBloqueo, puedeReservar, ventanaPorPaquete, planesInfo, cap, incluidosPorPaquete, addonsPorPaquete, onClose,
}: {
  hotel: HotelCard; cuposPorBloqueo: Record<number, number>; origenPorBloqueo: Record<number, string>; puedeReservar: boolean;
  ventanaPorPaquete: Record<number, { min: string | null; max: string | null }>; planesInfo: PlanesInfo;
  cap: { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] };
  incluidosPorPaquete: Record<number, string[]>; addonsPorPaquete: Map<number, Receptivo[]>;
  onClose: () => void;
}) {
  const { add, openDrawer } = useCart();
  const [addonAbierto, setAddonAbierto] = useState<ReceptivoModalInfo | null>(null);

  const opciones = useMemo<Opcion[]>(() => {
    const map = new Map<string, Opcion>();
    for (const f of hotel.filas) {
      // Bloqueo sin cupos → no se ofrece.
      if (f.modulo === "bloqueo" && f.bloqueo_id != null) {
        const c = cuposPorBloqueo[f.bloqueo_id];
        if (c !== undefined && c <= 0) continue;
      }
      const key = `${f.modulo}|${f.bloqueo_id ?? ""}|${f.paquete_id ?? ""}|${f.fecha_ida ?? ""}|${f.fecha_regreso ?? ""}`;
      let o = map.get(key);
      if (!o) {
        o = {
          key,
          modulo: f.modulo as "bloqueo" | "porcion_terrestre",
          paqueteId: f.paquete_id as number,
          bloqueoId: f.bloqueo_id ?? null,
          label: f.modulo === "bloqueo" ? (f.bloqueo_label ?? "Salida") : (f.paquete_nombre ?? "Paquete"),
          destino: f.destino_nombre,
          origen: f.modulo === "bloqueo" && f.bloqueo_id != null ? (origenPorBloqueo[f.bloqueo_id] ?? null) : null,
          cupos: f.modulo === "bloqueo" && f.bloqueo_id != null ? (cuposPorBloqueo[f.bloqueo_id] ?? null) : null,
          fechaIda: f.fecha_ida,
          fechaRegreso: f.fecha_regreso,
          noches: f.noches,
          filas: [],
        };
        map.set(key, o);
      }
      o.filas.push(f);
    }
    // De la salida más cercana a la más lejana; sin fecha, al final.
    return [...map.values()].sort((a, b) => (a.fechaIda ?? "9999-99-99").localeCompare(b.fechaIda ?? "9999-99-99"));
  }, [hotel, cuposPorBloqueo, origenPorBloqueo]);

  const [opKey, setOpKey] = useState(opciones[0]?.key ?? "");
  const opcion = opciones.find((o) => o.key === opKey) ?? opciones[0];

  // "Incluye": nada de esto se escribe a mano — se arma solo de lo que ya
  // está configurado en el paquete (aéreo solo si la opción es de bloqueo;
  // hospedaje siempre; servicios marcados "incluido" al armar el paquete).
  const incluye: string[] = opcion
    ? [
        ...(opcion.modulo === "bloqueo" ? ["Tiquete aéreo"] : []),
        `Hospedaje en ${hotel.hotelNombre}`,
        ...(incluidosPorPaquete[opcion.paqueteId] ?? []),
      ]
    : [];
  // Servicios opcionales (add-on) de ESTE paquete puntual — nunca los de otro
  // destino (a diferencia de irse a la pestaña Receptivos general).
  const addons: Receptivo[] = opcion ? (addonsPorPaquete.get(opcion.paqueteId) ?? []) : [];

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          {hotel.video_url ? (
            <BackgroundVideo url={hotel.video_url} overlay={0} />
          ) : hotel.foto ? (
            <Image src={hotel.foto} alt={hotel.hotelNombre} fill sizes="640px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">Sin foto</div>
          )}
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-700 shadow">
            Cerrar ✕
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
            {hotel.descripcion?.trim() && (
              <p className="mt-2 text-sm text-gray-600">{hotel.descripcion}</p>
            )}
          </div>

          {hotel.ubicacion?.trim() && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ubicación</span>
                <a href={`https://www.google.com/maps?q=${encodeURIComponent(hotel.ubicacion)}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
                  Ver en Google Maps →
                </a>
              </div>
              <iframe
                title={`Mapa ${hotel.hotelNombre}`}
                src={`https://www.google.com/maps?q=${encodeURIComponent(hotel.ubicacion)}&output=embed`}
                className="h-56 w-full rounded-lg border border-gray-200"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}

          {!opcion ? (
            <p className="text-sm text-gray-400">Sin disponibilidad publicada.</p>
          ) : (
            <>
              {/* Opciones de salida / paquete */}
              {opciones.length > 1 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Elige tu salida</p>
                  <div className="flex flex-wrap gap-2">
                    {opciones.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setOpKey(o.key)}
                        className="rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                        style={opKey === o.key
                          ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                          : { borderColor: "#e5e7eb", backgroundColor: "white" }}
                      >
                        <span className="block font-medium text-gray-800">{o.label}</span>
                        {o.origen && <span className="block text-[11px] text-gray-500">Origen: {o.origen}{o.destino ? ` → ${o.destino}` : ""}</span>}
                        <span className="block text-xs text-gray-500">
                          {o.fechaIda ? `${fmtFecha(o.fechaIda)} → ${fmtFecha(o.fechaRegreso)}` : ""}{o.noches ? ` · ${o.noches}N` : ""}
                        </span>
                        {o.cupos != null && (
                          <span className="mt-0.5 block text-[11px] font-medium" style={{ color: o.cupos > 0 ? "var(--brand-success)" : "#C0392B" }}>
                            {o.cupos} cupo{o.cupos === 1 ? "" : "s"} disponible{o.cupos === 1 ? "" : "s"}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {opcion.modulo === "bloqueo" && opcion.cupos != null && (
                <p className="text-xs text-gray-500">
                  {opcion.origen ? <>Origen <b>{opcion.origen}</b>{opcion.destino ? <> → <b>{opcion.destino}</b></> : null} · </> : null}
                  <b style={{ color: opcion.cupos > 0 ? "var(--brand-success)" : "#C0392B" }}>{opcion.cupos} cupo{opcion.cupos === 1 ? "" : "s"} disponible{opcion.cupos === 1 ? "" : "s"}</b>
                </p>
              )}

              {/* Incluye: informativo, se arma solo de lo configurado en el paquete */}
              {incluye.length > 0 && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Incluye</p>
                  <ul className="space-y-1">
                    {incluye.map((it, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-sm text-gray-700">
                        <Check size={14} style={{ color: "var(--brand-success)" }} /> {it}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Servicios opcionales (add-on) del MISMO paquete — nunca de otro destino */}
              {addons.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Servicios opcionales (add-on)</p>
                  <div className="flex flex-wrap gap-2">
                    {addons.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setAddonAbierto({ nombre: a.nombre, destino: a.destino, descripcion: a.descripcion, foto: a.foto, precio: a.desde, moneda: a.moneda, notaPrecio: "desde · por persona", paqueteId: a.paqueteId })}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition-colors hover:border-[var(--brand-accent)]"
                      >
                        <span className="block font-medium text-gray-800">{a.nombre}</span>
                        <span className="block text-xs" style={{ color: "var(--brand-primary)" }}>desde {formatMoneda(a.desde, a.moneda)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {opcion.modulo === "porcion_terrestre" ? (
                <SelectorPorFechas
                  key={opcion.key}
                  opcion={opcion}
                  hotel={hotel}
                  ventana={ventanaPorPaquete[opcion.paqueteId] ?? { min: null, max: null }}
                  planesInfo={planesInfo}
                  cap={cap}
                  onAgregar={(item) => {
                    add(item);
                    openDrawer();
                    onClose();
                  }}
                />
              ) : (
                <Selector
                  key={opcion.key}
                  opcion={opcion}
                  hotel={hotel}
                  puedeReservar={puedeReservar}
                  planesInfo={planesInfo}
                  cap={cap}
                  onAgregar={(item) => {
                    add(item);
                    openDrawer();
                    onClose();
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
    {addonAbierto && (
      <ReceptivoModal receptivo={addonAbierto} onClose={() => setAddonAbierto(null)} />
    )}
    </>
  );
}

function Selector({
  opcion, hotel, puedeReservar, planesInfo, cap, onAgregar,
}: {
  opcion: Opcion; hotel: HotelCard; puedeReservar: boolean; planesInfo: PlanesInfo;
  cap: { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] };
  onAgregar: (item: Omit<HotelCartItem, "id">) => void;
}) {
  const cats = useMemo(() => [...new Set(opcion.filas.map((f) => f.categoria).filter((x): x is string => !!x))], [opcion]);
  const [cat, setCat] = useState(cats[0] ?? "");
  // catEff/regEff: valor efectivo válido aunque el seleccionado quede obsoleto.
  const catEff = cats.includes(cat) ? cat : (cats[0] ?? "");
  const regs = useMemo(
    () => [...new Set(opcion.filas.filter((f) => f.categoria === catEff).map((f) => f.regimen).filter((x): x is string => !!x))],
    [opcion, catEff]
  );
  const [reg, setReg] = useState(regs[0] ?? "");
  const regEff = regs.includes(reg) ? reg : (regs[0] ?? "");

  // Mapa de PVP por acomodación para la (categoría, régimen) elegidas.
  const pvp = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of opcion.filas) {
      if (f.categoria === catEff && f.regimen === regEff && f.acomodacion) m[f.acomodacion] = f.precio_pvp;
    }
    return m;
  }, [opcion, catEff, regEff]);

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  const agregarItem = (habitaciones: Record<string, number>, ninos: number, ninos2: number, infantes: number, pax: number, precio: number, edadesMenores: number[]) =>
    onAgregar({
      tipo: "hotel",
      modulo: opcion.modulo, paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, bloqueoId: opcion.bloqueoId,
      hotelNombre: hotel.hotelNombre, destino: hotel.destino, fotoUrl: hotel.foto,
      categoria: catEff, regimen: regEff,
      fechaIda: opcion.fechaIda, fechaRegreso: opcion.fechaRegreso, noches: opcion.noches,
      habitaciones, ninos, ninos2, infantes, pax, precio, edadesMenores,
    });

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Categoría</label>
          <select value={catEff} onChange={(e) => setCat(e.target.value)} className={selCls}>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Alimentación</label>
          <select value={regEff} onChange={(e) => setReg(e.target.value)} className={selCls}>
            {regs.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {regEff && (
            <div className="mt-1">
              <RegimenInfo codigo={regEff} info={planesInfo[regEff.trim().toUpperCase()]} variant="link" className="text-xs" />
            </div>
          )}
        </div>
      </div>

      <EditorPax pvp={pvp} acomConfig={cap.acom} paxMin={cap.paxMin} paxMax={cap.paxMax} moneda={hotel.moneda} edadesNota={textoEdadesHotel(hotel)} edadInfanteMax={hotel.infMax} edadNinoMax={hotel.ninoMax} nota={!puedeReservar ? "El valor es una estimación con tarifas publicadas; el precio final se confirma al generar la cotización." : undefined} onAgregar={agregarItem} />
    </div>
  );
}

// Editor de habitaciones/menores + total + botón. Recibe el PVP por acomodación y
// reporta la selección (no conoce fechas ni módulo). Reutilizado por bloqueo y porción.
// La edad de cada menor se pide EXACTA (nunca fecha de nacimiento — esa se
// diligencia después, en el listado real de pasajeros del contrato) y decide
// sola, contra las reglas reales del hotel, si liquida como infante, Niño 1 o
// Niño 2 (ver lib/reservar/edadesMenores.ts) — nunca un conteo manual por tarifa.
function EditorPax({
  pvp, acomConfig = [], paxMin = null, paxMax = null, nota, edadesNota,
  edadInfanteMax, edadNinoMax, onAgregar, btnLabel = "Agregar al carrito", moneda = "COP",
}: {
  pvp: Record<string, number>;
  acomConfig?: AcomConfig[];
  paxMin?: number | null;
  paxMax?: number | null;
  nota?: string;
  edadesNota?: string | null;
  edadInfanteMax?: number | null;
  edadNinoMax?: number | null;
  onAgregar: (habitaciones: Record<string, number>, ninos: number, ninos2: number, infantes: number, pax: number, precio: number, edadesMenores: number[]) => void;
  btnLabel?: string;
  moneda?: string | null;
}) {
  const idBase = useId();
  const [habs, setHabs] = useState<Record<string, number>>({});
  const [cantidadMenores, setCantidadMenoresState] = useState(0);
  const [edadesTxt, setEdadesTxt] = useState<string[]>([]);
  const setHab = (a: AcomRoom, n: number) => setHabs((p) => ({ ...p, [a]: Math.max(0, n) }));

  // Al cambiar la cantidad: agrega campos vacíos al final o quita solo los
  // sobrantes del final — las edades ya escritas nunca se reordenan/pierden.
  function setCantidadMenores(nRaw: number) {
    setCantidadMenoresState(Math.max(0, Math.min(MAX_MENORES_POR_CONSULTA, Math.trunc(nRaw) || 0)));
    setEdadesTxt((prev) => ajustarCantidadEdades(prev, nRaw));
  }
  const setEdadAt = (i: number, v: string) => setEdadesTxt((prev) => prev.map((x, idx) => (idx === i ? v : x)));

  // Config de cada acomodación (la del hotel o el default si no está configurada).
  const cfg = (a: AcomRoom): AcomConfig => acomConfig.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);

  // Adultos (por pax_tarifa) y CAPACIDADES según las habitaciones elegidas.
  let adultosPrecio = 0;
  let adultos = 0;
  let capPax = 0;   // máx personas que admiten las habitaciones elegidas
  let capChd = 0;   // máx niños
  let capInf = 0;   // máx infantes
  for (const a of ACOM_ROOMS) {
    const rooms = habs[a] ?? 0;
    if (rooms > 0 && pvp[a] != null) {
      const c = cfg(a);
      adultos += rooms * c.pax_tarifa;
      adultosPrecio += rooms * c.pax_tarifa * pvp[a];
      capPax += rooms * c.pax_max;
      capChd += rooms * c.chd_max;
      capInf += rooms * c.inf_max;
    }
  }
  const hayHab = adultos > 0;

  // Umbrales reales del hotel (mismo default que el motor de reservas —
  // computo.ts — cuando el hotel no los configuró: 2 años infante, 10 niño).
  const infanteMax = edadInfanteMax ?? 2;
  const ninoMax = edadNinoMax ?? 10;

  const edadesParsed = edadesTxt.map(parseEdadMenor);
  const edadesValidas = edadesParsed.every((p) => p.error == null);
  const edadesFaltantes = edadesParsed.filter((p) => p.valor == null).length;
  const edades = edadesParsed.map((p) => p.valor).filter((v): v is number => v != null);

  // Clasifica primero por edad (infante/niño, contra el umbral real del
  // hotel) y luego reparte Niño 1/Niño 2 POR HABITACIÓN — cada habitación
  // admite máximo un Niño 1 y un Niño 2 (nunca un límite de 2 en toda la
  // reserva); con varias habitaciones caben más niños. Ver
  // lib/reservar/distribucionHabitaciones.ts.
  let clasifError: string | null = null;
  let ninos = 0, ninos2 = 0, infantes = 0;
  if (cantidadMenores > 0 && edadesValidas) {
    const rClas = clasificarMenoresPorEdad(edades, infanteMax, ninoMax);
    if (!rClas.ok) {
      clasifError = rClas.error;
    } else {
      const habitacionesConsultadas: HabitacionConsultada[] = [];
      for (const a of ACOM_ROOMS) {
        const rooms = habs[a] ?? 0;
        if (rooms > 0 && pvp[a] != null) {
          const c = cfg(a);
          for (let i = 0; i < rooms; i++) habitacionesConsultadas.push({ acom: a, config: c });
        }
      }
      const rDist = distribuirPorHabitaciones({
        adultosDeclarados: adultos, // ya = suma de pax_tarifa de las habitaciones elegidas
        ninos: rClas.c.ninos,
        infantes: rClas.c.infantes,
        habitaciones: habitacionesConsultadas,
      });
      if (!rDist.ok) {
        clasifError = rDist.error;
      } else {
        const totalesM = { infantes: rDist.totales.infantes, nino: rDist.totales.nino, nino2: rDist.totales.nino2 };
        const errTarifa = verificarTarifasMenoresDisponibles(totalesM, { nino: pvp["nino"] != null, nino2: pvp["nino2"] != null });
        if (errTarifa) clasifError = errTarifa;
        else ({ nino: ninos, nino2: ninos2, infantes } = totalesM);
      }
    }
  }

  let precio = adultosPrecio;
  if (ninos > 0 && pvp["nino"] != null) precio += ninos * pvp["nino"];
  if (ninos2 > 0 && pvp["nino2"] != null) precio += ninos2 * pvp["nino2"];
  const ninosTotal = ninos + ninos2;
  const pax = adultos + ninosTotal;

  // Topes efectivos (capacidad de habitaciones + límites del hotel).
  const maxPax = paxMax != null ? Math.min(capPax, paxMax) : capPax;

  const totalHab = ACOM_ROOMS.reduce((s, a) => s + (habs[a] ?? 0), 0);
  const muestraMenores = hayHab && (capChd > 0 || capInf > 0);

  const errores: string[] = [];
  if (totalHab > 8) errores.push("A partir de 9 habitaciones, contacta a un asesor.");
  if (hayHab) {
    if (ninosTotal > capChd) errores.push(`Las habitaciones elegidas admiten máximo ${capChd} niño(s).`);
    if (infantes > capInf) errores.push(`Las habitaciones elegidas admiten máximo ${capInf} infante(s).`);
    if (pax > maxPax) errores.push(`Las habitaciones elegidas admiten máximo ${maxPax} persona(s).`);
    if (paxMin != null && pax < paxMin) errores.push(`Este hotel exige un mínimo de ${paxMin} persona(s).`);
  }
  const menoresListos = cantidadMenores === 0 || (edadesValidas && !clasifError);
  const puede = adultosPrecio > 0 && errores.length === 0 && menoresListos;

  function agregar() {
    if (!puede) return;
    const habitaciones: Record<string, number> = {};
    for (const a of ACOM_ROOMS) if ((habs[a] ?? 0) > 0) habitaciones[a] = habs[a];
    onAgregar(habitaciones, ninos, ninos2, infantes, pax, precio, edades);
  }

  const inputCls = "w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm";
  const inputEdadCls = "w-14 rounded-lg border px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]";

  return (
    <>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Habitaciones</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACOM_ROOMS.map((a) => (
            <div key={a} className={`rounded-lg border p-2 ${pvp[a] == null ? "opacity-40" : ""}`}>
              <div className="text-xs font-medium text-gray-700">{ACOM_ROOM_LABEL[a]}</div>
              <div className="text-[11px] text-gray-400">{pvp[a] != null ? `${formatMoneda(pvp[a], moneda)}/pers` : "No aplica"}</div>
              <input type="number" min={0} value={habs[a] ?? 0} disabled={pvp[a] == null}
                onChange={(e) => setHab(a, Number(e.target.value))} className={`${inputCls} mt-1`} />
            </div>
          ))}
        </div>
      </div>

      {muestraMenores && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor={`${idBase}-cant`} className="text-xs font-semibold uppercase tracking-wide text-gray-400">Menores</label>
          </div>
          {edadesNota && <p className="mb-1 text-[11px] font-medium text-gray-500">{edadesNota}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`${idBase}-cant`} className="mb-1 block text-xs font-medium text-gray-600">Cantidad de menores</label>
              <input id={`${idBase}-cant`} type="number" inputMode="numeric" min={0} max={MAX_MENORES_POR_CONSULTA}
                value={cantidadMenores} disabled={!hayHab}
                onChange={(e) => setCantidadMenores(Number(e.target.value))} className={inputCls} />
            </div>
            {edadesTxt.map((v, i) => {
              const err = edadesParsed[i]?.error;
              const mostrarError = v.trim() !== "" && err;
              return (
                <div key={i}>
                  <label htmlFor={`${idBase}-edad-${i}`} className="mb-1 block text-xs font-medium text-gray-600">Edad menor {i + 1}</label>
                  <input
                    id={`${idBase}-edad-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={EDAD_MENOR_MAX}
                    value={v}
                    onChange={(e) => setEdadAt(i, e.target.value)}
                    className={`${inputEdadCls} ${mostrarError ? "border-red-400" : "border-gray-300"}`}
                    aria-invalid={mostrarError ? true : undefined}
                  />
                  {mostrarError && <p className="mt-0.5 text-[10px] text-red-600">{err}</p>}
                </div>
              );
            })}
          </div>
          {cantidadMenores > 0 && edadesValidas === false && edadesFaltantes > 0 && (
            <p className="mt-1 text-[11px] text-amber-600">Falta la edad de {edadesFaltantes} menor(es).</p>
          )}
          {clasifError && <p className="mt-1 text-[11px] text-red-600">{clasifError}</p>}
          {cantidadMenores > 0 && !clasifError && edadesValidas && (
            <p className="mt-1 text-[11px] text-gray-400">
              {[infantes > 0 ? `${infantes} infante(s)` : null, ninosTotal > 0 ? `${ninosTotal} niño(s)` : null].filter(Boolean).join(" · ") || "Todas las edades corresponden a adulto."}
            </p>
          )}
        </div>
      )}

      {errores.length > 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{errores.join(" ")}</p>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <div>
          <div className="text-xs text-gray-400">Total estimado{pax > 0 ? ` · ${pax} pax` : ""}</div>
          <div className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(precio, moneda)}</div>
        </div>
        <button type="button" onClick={agregar} disabled={!puede}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: "var(--brand-primary)" }}>
          {btnLabel}
        </button>
      </div>
      {nota && <p className="text-[11px] text-gray-400">{nota}</p>}
    </>
  );
}

// Motor por fechas (porción/dinámico): el usuario elige las fechas reales y se
// liquida la tarifa noche por noche (cotizarPorFechas, service-role, solo PVP).
function SelectorPorFechas({
  opcion, hotel, ventana, planesInfo, cap, onAgregar,
}: {
  opcion: Opcion; hotel: HotelCard; ventana: { min: string | null; max: string | null }; planesInfo: PlanesInfo;
  cap: { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] };
  onAgregar: (item: Omit<HotelCartItem, "id">) => void;
}) {
  // No se permite check-in en el pasado: el mínimo es HOY (o el inicio del rango
  // del paquete si es posterior). Si el paquete empieza antes de hoy, arranca hoy.
  const hoy = new Date().toISOString().slice(0, 10);
  const minIda = ventana.min && ventana.min > hoy ? ventana.min : hoy;
  const base = opcion.fechaIda ?? ventana.min ?? hoy;
  const idaInicial = base < minIda ? minIda : base;
  const [fIda, setFIda] = useState(idaInicial);
  const [fReg, setFReg] = useState("");
  const [combos, setCombos] = useState<ComboCotizado[] | null>(null);
  const [nochesCot, setNochesCot] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [cat, setCat] = useState("");
  const [reg, setReg] = useState("");
  // Sugerencias de fecha cuando la cotización pedida no encontró tarifa —
  // siempre REALES (validadas por el mismo motor, ver
  // lib/reservar/liquidacionHotel.ts), nunca solo derivadas de límites de
  // temporada. `viaSugerencia` habilita el aviso "Tarifa cargada para esas
  // fechas..." solo cuando el resultado vino de pulsar una sugerencia (no de
  // una cotización manual normal). `sugerenciaAplicando` identifica cuál
  // botón está en curso, para su propio estado de carga.
  const [sugerencias, setSugerencias] = useState<SugerenciaFecha[]>([]);
  const [viaSugerencia, setViaSugerencia] = useState(false);
  const [sugerenciaAplicando, setSugerenciaAplicando] = useState<string | null>(null);

  function cotizar(overrideIda?: string, overrideRegreso?: string, desdeSugerencia = false) {
    setErr("");
    const idaUsada = overrideIda ?? fIda;
    const regresoUsada = overrideRegreso ?? fReg;
    if (!idaUsada || !regresoUsada) { setErr("Indica fecha de ida y de regreso."); return; }
    start(async () => {
      const r = await cotizarPorFechas({ paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, fechaIda: idaUsada, fechaRegreso: regresoUsada });
      if (r.ok) {
        setCombos(r.combos); setNochesCot(r.noches);
        setCat(r.combos[0]?.categoria ?? ""); setReg(r.combos[0]?.regimen ?? "");
        setSugerencias([]); setViaSugerencia(desdeSugerencia);
      } else {
        setCombos(null); setErr(r.error); setSugerencias(r.sugerencias); setViaSugerencia(false);
      }
      setSugerenciaAplicando(null);
    });
  }

  // Pulsar una sugerencia: completa ida/regreso, conserva hotel (nada más
  // cambia de contexto — habitaciones/edades todavía no se han elegido en
  // este punto del flujo) y vuelve a cotizar. Nunca agrega nada al carrito.
  function aplicarSugerencia(s: SugerenciaFecha) {
    setFIda(s.fechaIda);
    setFReg(s.fechaRegreso);
    setSugerenciaAplicando(s.fechaIda);
    cotizar(s.fechaIda, s.fechaRegreso, true);
  }

  const cats = combos ? [...new Set(combos.map((c) => c.categoria))] : [];
  const catEff = cats.includes(cat) ? cat : (cats[0] ?? "");
  const regs = combos ? [...new Set(combos.filter((c) => c.categoria === catEff).map((c) => c.regimen))] : [];
  const regEff = regs.includes(reg) ? reg : (regs[0] ?? "");
  const pvp = combos?.find((c) => c.categoria === catEff && c.regimen === regEff)?.precios ?? {};

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  const dateCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  const agregarItem = (habitaciones: Record<string, number>, ninos: number, ninos2: number, infantes: number, pax: number, precio: number, edadesMenores: number[]) =>
    onAgregar({
      tipo: "hotel",
      modulo: opcion.modulo, paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, bloqueoId: null,
      hotelNombre: hotel.hotelNombre, destino: hotel.destino, fotoUrl: hotel.foto,
      categoria: catEff, regimen: regEff,
      fechaIda: fIda, fechaRegreso: fReg, noches: nochesCot ?? calcNoches(fIda, fReg),
      habitaciones, ninos, ninos2, infantes, pax, precio, edadesMenores,
    });

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Elige tus fechas</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Ida</label>
            <input type="date" value={fIda} min={minIda} max={ventana.max ?? undefined}
              onChange={(e) => {
                const nueva = e.target.value;
                setFIda(nueva);
                // Sin auto-relleno de regreso: si deja de ser posterior a la
                // nueva ida, se limpia (el usuario elige la fecha real).
                if (nueva && fReg && fReg <= nueva) setFReg("");
                setCombos(null); setSugerencias([]); setViaSugerencia(false);
              }}
              className={dateCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Regreso</label>
            <input type="date" value={fReg} min={fIda || minIda} max={ventana.max ?? undefined}
              onChange={(e) => { setFReg(e.target.value); setCombos(null); setSugerencias([]); setViaSugerencia(false); }}
              className={dateCls} />
          </div>
          <button type="button" onClick={() => cotizar()} disabled={pending || !fIda || !fReg}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-accent)" }}>
            {pending && !sugerenciaAplicando ? "Cotizando…" : "Cotizar"}
          </button>
        </div>
        {(ventana.min || ventana.max) && (
          <p className="mt-1 text-[11px] text-gray-400">Rango del paquete: {ventana.min ?? "—"} → {ventana.max ?? "—"}</p>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {!!sugerencias.length && (
          <div className="mt-2">
            <p className="text-xs font-medium text-gray-500">Fechas con tarifa para este hotel</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sugerencias.map((s) => (
                <button
                  key={s.fechaIda}
                  type="button"
                  onClick={() => aplicarSugerencia(s)}
                  disabled={pending}
                  className="rounded-full border border-gray-300 bg-transparent px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)] disabled:opacity-50"
                >
                  {pending && sugerenciaAplicando === s.fechaIda ? "Cotizando…" : s.etiqueta}
                </button>
              ))}
            </div>
          </div>
        )}
        {viaSugerencia && combos && combos.length > 0 && (
          <p className="mt-2 text-xs font-medium" style={{ color: "var(--brand-success)" }}>Tarifa cargada para esas fechas. Cupo sujeto a confirmación.</p>
        )}
      </div>

      {combos && combos.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Categoría</label>
              <select value={catEff} onChange={(e) => setCat(e.target.value)} className={selCls}>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Alimentación</label>
              <select value={regEff} onChange={(e) => setReg(e.target.value)} className={selCls}>
                {regs.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {regEff && (
                <div className="mt-1">
                  <RegimenInfo codigo={regEff} info={planesInfo[regEff.trim().toUpperCase()]} variant="link" className="text-xs" />
                </div>
              )}
            </div>
            {nochesCot != null && <div className="self-end pb-2 text-xs text-gray-400">{nochesCot} noche(s)</div>}
          </div>
          <EditorPax pvp={pvp} acomConfig={cap.acom} paxMin={cap.paxMin} paxMax={cap.paxMax} moneda={hotel.moneda} edadesNota={textoEdadesHotel(hotel)} edadInfanteMax={hotel.infMax} edadNinoMax={hotel.ninoMax} onAgregar={agregarItem} />
        </>
      )}
    </div>
  );
}
