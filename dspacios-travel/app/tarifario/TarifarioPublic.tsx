"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Star, Plane, Bus } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { VistaBooking } from "./VistaBooking";
import { RegimenInfo, type PlanesInfo } from "./RegimenInfo";
import { BriefFlyerButton } from "./BriefFlyerButton";
import { textoEdadesHotel, type AcomConfig } from "@/lib/acomodaciones";
import { buscarPaginaTarifarioAccion } from "./tarifario-actions";
import { type ModuloTarifario } from "@/lib/tarifario/consulta";
import {
  type Enriquecimiento, fusionarEnriquecimiento, moduloDeSub, subDeModulo, pageSizeDe,
} from "@/lib/tarifario/vistaClienteHelpers";

export type CapHotel = Record<number, { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] }>;

export type ProgramaResumen = {
  id: number;
  nombre: string;
  subtitulo: string | null;
  dias: number | null;
  noches: number | null;
  moneda: string;
  desde_pvp: number | null;
  tipo_transporte: "ninguno" | "aereo" | "terrestre";
  portada_url: string | null;
  ciudades: string[];
};

export type FilaTarifario = {
  modulo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
  bloqueo_label: string | null;
  bloqueo_id?: number | null;
  empaquetado_id?: number | null;
  salida_id?: number | null;
  paquete_id?: number;
  hotel_id?: number | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  noches: number | null;
  destino_nombre: string | null;
  paquete_nombre: string | null;
  hotel_nombre: string | null;
  servicio_id?: number | null;
  servicio_nombre?: string | null;
  tipo_tarifa?: string | null;
  pax_desde?: number | null;
  pax_hasta?: number | null;
  categoria: string | null;
  regimen: string | null;
  acomodacion: string | null;
  precio_pvp: number;
  descripcion?: string | null;
  recargo_individual?: number | null;
  moneda?: string | null;
};

const MODULOS: { key: FilaTarifario["modulo"]; label: string }[] = [
  { key: "bloqueo", label: "Paquetes" },
  { key: "dinamico", label: "Salidas dinámicas" },
  { key: "porcion_terrestre", label: "Porción terrestre" },
  { key: "servicios", label: "Servicios" },
];

const COLS: [string, string][] = [
  ["sencilla", "Sencilla"],
  ["doble", "Doble"],
  ["triple", "Triple"],
  ["multiple", "Múltiple"],
  ["nino", "Chd1"],
  ["nino2", "Chd2"],
];

function fmtFecha(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

type Pivotada = {
  hotel: string;
  categoria: string;
  regimen: string;
  precios: Record<string, number>;
  paquete_id?: number;
  hotel_id?: number | null;
  bloqueo_id?: number | null;
  empaquetado_id?: number | null;
  salida_id?: number | null;
  modulo: FilaTarifario["modulo"];
  destino?: string | null;
  noches?: number | null;
  moneda?: string | null;
};

function pivotar(filas: FilaTarifario[]): Pivotada[] {
  const map = new Map<string, Pivotada>();
  for (const f of filas) {
    const hotel = f.hotel_nombre ?? "—";
    const categoria = f.categoria ?? "—";
    const regimen = f.regimen ?? "—";
    const key = `${hotel}|||${categoria}|||${regimen}`;
    let row = map.get(key);
    if (!row) {
      row = {
        hotel, categoria, regimen, precios: {},
        paquete_id: f.paquete_id, hotel_id: f.hotel_id, bloqueo_id: f.bloqueo_id, empaquetado_id: f.empaquetado_id, salida_id: f.salida_id, modulo: f.modulo,
        destino: f.destino_nombre, noches: f.noches, moneda: f.moneda ?? "COP",
      };
      map.set(key, row);
    }
    if (f.acomodacion) row.precios[f.acomodacion] = f.precio_pvp;
  }
  return [...map.values()].sort(
    (a, b) => a.hotel.localeCompare(b.hotel) || a.categoria.localeCompare(b.categoria) || a.regimen.localeCompare(b.regimen)
  );
}

export type ModuloKey = FilaTarifario["modulo"] | "programas";

export type InfoHotel = Record<number, { estrellas: number | null; clasificacion: string | null; descripcion: string | null; ubicacion: string | null; ninoMin?: number | null; ninoMax?: number | null; infMin?: number | null; infMax?: number | null; infanteCargo?: boolean; infanteNota?: string | null; ninoNota?: string | null; adultsOnly?: boolean; petFriendly?: boolean; petCargo?: boolean; petCostoDesc?: string | null; petNota?: string | null }>;

// Texto de rango de edad de niño/infante (helper centralizado en lib).
// Tolera `info` undefined (hoteles sin config) devolviendo null.
const rangoEdades = (info?: Parameters<typeof textoEdadesHotel>[0]): string | null =>
  info ? textoEdadesHotel(info) : null;

// Notas especiales de niño/infante (ej. "comparte cama con los padres", cargo
// obligatorio de alimentación) — informativo, el valor exacto se ve al reservar.
// La tarifa/nota de infante vive en la tarifa neta (como niño 1/niño 2); si el
// hotel puso una nota ahí, esa ya suele explicar el cargo (ej. "solo paga
// seguro hotelero"), así que el aviso genérico solo se agrega si no hay nota.
function notasNinoInfante(info?: InfoHotel[number]): string | null {
  if (!info) return null;
  const partes: string[] = [];
  if (info.infanteNota?.trim()) partes.push(info.infanteNota.trim());
  else if (info.infanteCargo) partes.push("Infantes: aplica cargo adicional, se confirma al reservar.");
  if (info.ninoNota?.trim()) partes.push(info.ninoNota.trim());
  if (info.petFriendly) partes.push(`Acepta mascotas${info.petCargo ? " (aplica cargo adicional, se confirma al reservar)" : " (sin costo)"}${info.petCostoDesc ? ` — ${info.petCostoDesc}` : ""}.`);
  if (info.petNota?.trim()) partes.push(info.petNota.trim());
  return partes.length ? partes.join(" ") : null;
}

// Estrellas (★) o clasificación (Boutique/Luxury…) al lado del nombre del hotel.
function CategoriaInline({ info }: { info?: { estrellas: number | null; clasificacion: string | null } }) {
  if (!info) return null;
  if (info.estrellas && info.estrellas > 0)
    return (
      <span className="ml-1 inline-flex align-middle text-amber-400" title={`${info.estrellas} estrellas`}>
        {Array.from({ length: info.estrellas }).map((_, i) => <Star key={i} size={12} fill="currentColor" strokeWidth={0} />)}
      </span>
    );
  if (info.clasificacion?.trim())
    return <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{info.clasificacion}</span>;
  return null;
}

// Aviso "Adults Only" — hotel que no acepta niños ni infantes.
function AdultsOnlyBadge({ info }: { info?: { adultsOnly?: boolean } }) {
  if (!info?.adultsOnly) return null;
  return (
    <span className="ml-1 rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white" title="Este hotel no acepta niños ni infantes">
      Adults Only
    </span>
  );
}

// Aviso "Pet friendly" — hotel que acepta mascotas.
function PetFriendlyBadge({ info }: { info?: { petFriendly?: boolean } }) {
  if (!info?.petFriendly) return null;
  return (
    <span className="ml-1 rounded-full bg-[var(--brand-success)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-success)]" title="Este hotel acepta mascotas">
      Pet friendly
    </span>
  );
}

// Acomodaciones para el filtro (mismas claves que COLS).
const ACOM_OPCIONES = COLS;

function coincideFiltro(f: FilaTarifario, q: string, fCat: string, fReg: string): boolean {
  if (q) {
    const hay = `${f.hotel_nombre ?? ""} ${f.paquete_nombre ?? ""} ${f.servicio_nombre ?? ""}`.toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  if (fCat && (f.categoria ?? "") !== fCat) return false;
  if (fReg && (f.regimen ?? "") !== fReg) return false;
  return true;
}

export function TarifarioPublic({
  filasIniciales,
  totalInicial = 0,
  // `false` = todavía no se hizo NINGUNA búsqueda (uso en /dashboard/reservar:
  // la carga inicial no debe traer tarifario — el usuario elige criterios y
  // pulsa "Buscar"). `true` = ya se cargó una primera página server-side
  // (uso en /tarifario y /dashboard/reservar tras la primera búsqueda) y el
  // resto de la exploración es progresiva ("Cargar más"/cambiar filtros).
  cargaInicial = true,
  programas = [],
  puedeReservar = false,
  cuposPorBloqueo = {},
  origenPorBloqueo = {},
  fotosPorHotel = {},
  fotosPorServicio = {},
  ventanaPorPaquete = {},
  infoPorHotel = {},
  planesInfo = {},
  capPorHotel = {},
  incluidosPorPaquete = {},
  filasAddon = [],
}: {
  filasIniciales: FilaTarifario[];
  totalInicial?: number;
  cargaInicial?: boolean;
  programas?: ProgramaResumen[];
  puedeReservar?: boolean;
  cuposPorBloqueo?: Record<number, number>;
  origenPorBloqueo?: Record<number, string>;
  fotosPorHotel?: Record<number, string>;
  fotosPorServicio?: Record<number, string>;
  ventanaPorPaquete?: Record<number, { min: string | null; max: string | null }>;
  infoPorHotel?: InfoHotel;
  planesInfo?: PlanesInfo;
  capPorHotel?: CapHotel;
  incluidosPorPaquete?: Record<number, string[]>;
  // Add-ons de paquetes de hotel (bloqueo/porción), SIN el recorte que oculta
  // esas filas de la vitrina plana de Servicios — solo para ofrecerlos scoped
  // dentro del modal de su propio hotel en Vista Booking (ver VistaBooking.tsx).
  filasAddon?: FilaTarifario[];
}) {
  const [vista, setVista] = useState<"tabla" | "booking" | "programas">("booking");
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("");
  const [fReg, setFReg] = useState("");
  const [fAcom, setFAcom] = useState("");
  const [moduloSel, setModuloSel] = useState<ModuloKey>("bloqueo");

  // ── Carga progresiva del catálogo (ronda "carga bajo demanda", medición
  // real: la versión anterior descargaba TODO el catálogo — 17.197 filas,
  // ~11,1 MB — de una sola vez; Next ni siquiera pudo cachear ese bloque
  // ("items over 2MB can not be cached"), así que cada visita repetía el
  // trabajo completo). Ahora `filas`/`enr` arrancan con lo que trajo el
  // servidor para la PRIMERA página (chica, o vacía en /dashboard/reservar)
  // y crecen bajo demanda: cambiar de filtro/módulo REEMPLAZA (nueva
  // búsqueda, pagina 1), "Cargar más" AGREGA (misma búsqueda, página
  // siguiente). `buscarPaginaTarifarioAccion` (Server Action) valida los
  // filtros como `unknown` antes de tocar la base — nunca se manda una
  // consulta sin acotar.
  const [filas, setFilas] = useState(filasIniciales);
  const [enr, setEnr] = useState<Enriquecimiento>({
    cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, planesInfo, capPorHotel, ventanaPorPaquete, incluidosPorPaquete, filasAddon,
  });
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(totalInicial);
  const [haBuscado, setHaBuscado] = useState(cargaInicial);
  const [errorCarga, setErrorCarga] = useState("");
  const [pending, startTransicion] = useTransition();
  const montadoRef = useRef(false);

  // `moduloSel` solo toma valores de MODULOS (bloqueo/dinamico/porcion_terrestre/
  // servicios) — coincide exactamente con ModuloTarifario, nunca "programas"
  // (esa es una pestaña de `vista`, un estado aparte).
  const moduloActivo: ModuloTarifario = moduloSel as ModuloTarifario;

  async function ejecutarBusqueda(paginaPedida: number, modo: "reemplazar" | "agregar") {
    setErrorCarga("");
    const res = await buscarPaginaTarifarioAccion({
      texto: q, categoria: fCat, regimen: fReg, modulo: moduloActivo,
      page: paginaPedida, pageSize: pageSizeDe(moduloActivo),
    });
    if (!res.ok) {
      setErrorCarga(res.error);
      return;
    }
    const nuevoEnr: Enriquecimiento = {
      cuposPorBloqueo: res.datos.cuposPorBloqueo, origenPorBloqueo: res.datos.origenPorBloqueo,
      fotosPorHotel: res.datos.fotosPorHotel, fotosPorServicio: res.datos.fotosPorServicio,
      infoPorHotel: res.datos.infoPorHotel, planesInfo: res.datos.planesInfo, capPorHotel: res.datos.capPorHotel,
      ventanaPorPaquete: res.datos.ventanaPorPaquete, incluidosPorPaquete: res.datos.incluidosPorPaquete,
      filasAddon: res.datos.filasAddon,
    };
    if (modo === "reemplazar") {
      setFilas(res.datos.filasVisibles);
      setEnr(nuevoEnr);
    } else {
      setFilas((prev) => [...prev, ...res.datos.filasVisibles]);
      setEnr((prev) => fusionarEnriquecimiento(prev, nuevoEnr));
    }
    setPagina(res.page);
    setTotal(res.total);
    setHaBuscado(true);
  }

  function buscar() {
    startTransicion(() => { void ejecutarBusqueda(1, "reemplazar"); });
  }
  function cargarMas() {
    startTransicion(() => { void ejecutarBusqueda(pagina + 1, "agregar"); });
  }

  // Búsqueda EN VIVO (debounced) solo cuando ya hubo una carga inicial
  // server-side (/tarifario, o /dashboard/reservar tras el primer "Buscar").
  // En /dashboard/reservar, ANTES de la primera búsqueda, cambiar estos
  // campos no dispara ninguna consulta — el usuario pulsa "Buscar" a propósito.
  useEffect(() => {
    if (!montadoRef.current) { montadoRef.current = true; return; }
    if (!haBuscado) return;
    const t = setTimeout(() => buscar(), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fCat, fReg, moduloActivo]);

  // Opciones únicas para los selects — de lo YA CARGADO (progresivo, no del
  // catálogo completo: si el valor buscado todavía no cargó, no aparece en
  // el desplegable hasta que una página lo traiga).
  const cats = useMemo(
    () => [...new Set(filas.map((f) => f.categoria).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [filas]
  );
  const regs = useMemo(
    () => [...new Set(filas.map((f) => f.regimen).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [filas]
  );

  const filasFiltradas = useMemo(
    () => filas.filter((f) => coincideFiltro(f, q.trim(), fCat, fReg)),
    [filas, q, fCat, fReg]
  );
  const hayFiltro = !!(q.trim() || fCat || fReg || fAcom);

  const tabs: { key: ModuloKey; label: string }[] = MODULOS;
  const modulo = moduloSel;
  const hayMas = filas.length < total;
  // /dashboard/reservar antes de la primera búsqueda: no se muestra ningún
  // listado (ni "sin resultados", que afirmaría algo falso) — solo el CTA.
  const mostrarCta = !haBuscado && vista !== "programas";

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700";

  return (
    <div className="relative">
      {/* Card flotante que solapa el borde inferior del header */}
      <div className="-mt-10 mb-6 relative z-10 px-0">
        <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-[0_6px_32px_rgba(0,0,0,0.12)]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Toggle de vista: tabla (estático, solo usuarios registrados) · Booking (dinámico) · Programas (circuitos) */}
            <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-1">
              {([...(puedeReservar ? [["tabla", "Vista tabla"] as const] : []), ["booking", "Vista Booking"], ...(programas.length ? [["programas", "Programas"] as const] : [])] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVista(v)}
                  className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                  style={vista === v ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#4b5563" }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Filtros inline (solo para hoteles: tabla/booking) */}
            {vista !== "programas" && (
              <>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar hotel por nombre…"
                  className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <select value={fCat} onChange={(e) => setFCat(e.target.value)} className={selCls} aria-label="Categoría de habitación">
                  <option value="">Categoría: todas</option>
                  {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={fReg} onChange={(e) => setFReg(e.target.value)} className={selCls} aria-label="Alimentación / régimen">
                  <option value="">Alimentación: todas</option>
                  {regs.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={fAcom} onChange={(e) => setFAcom(e.target.value)} className={selCls} aria-label="Acomodación">
                  <option value="">Acomodación: todas</option>
                  {ACOM_OPCIONES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                {hayFiltro && (
                  <button
                    type="button"
                    onClick={() => { setQ(""); setFCat(""); setFReg(""); setFAcom(""); }}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800"
                  >
                    Limpiar
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {errorCarga && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorCarga}</p>
      )}

      {vista === "programas" ? (
        <PorProgramas programas={programas} puedeReservar={puedeReservar} />
      ) : mostrarCta ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
          <p className="text-sm text-gray-500">Elige un destino/salida arriba y pulsa <b>Buscar</b> para ver hoteles y tarifas.</p>
          <button
            type="button"
            onClick={buscar}
            disabled={pending}
            className="mt-4 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            {pending ? "Buscando…" : "Buscar tarifas"}
          </button>
        </div>
      ) : vista === "booking" ? (
        <VistaBooking
          filas={filasFiltradas}
          fotosPorHotel={enr.fotosPorHotel} fotosPorServicio={enr.fotosPorServicio}
          cuposPorBloqueo={enr.cuposPorBloqueo} origenPorBloqueo={enr.origenPorBloqueo}
          puedeReservar={puedeReservar}
          ventanaPorPaquete={enr.ventanaPorPaquete} infoPorHotel={enr.infoPorHotel}
          planesInfo={enr.planesInfo} capPorHotel={enr.capPorHotel} soloAcom={fAcom || null}
          incluidosPorPaquete={enr.incluidosPorPaquete} filasAddon={enr.filasAddon}
          sub={subDeModulo(moduloSel)} onSubChange={(s) => setModuloSel(moduloDeSub(s))}
        />
      ) : (
        <>
          {/* Tabs de módulos */}
          <div className="mb-5 flex flex-wrap gap-2">
            {tabs.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setModuloSel(m.key)}
                className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                style={
                  modulo === m.key
                    ? { backgroundColor: "var(--brand-primary)", color: "white" }
                    : { backgroundColor: "white", color: "#4b5563", border: "1px solid #e5e7eb" }
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          {filasFiltradas.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">
              {pending ? "Buscando…" : "No hay resultados para los filtros aplicados."}
            </p>
          ) : modulo === "bloqueo" ? (
            <PorSalida filas={filasFiltradas.filter((f) => f.modulo === "bloqueo")} puedeReservar={puedeReservar} cuposPorBloqueo={enr.cuposPorBloqueo} soloAcom={fAcom || null} infoPorHotel={enr.infoPorHotel} planesInfo={enr.planesInfo} />
          ) : modulo === "dinamico" ? (
            <PorSalida filas={filasFiltradas.filter((f) => f.modulo === "dinamico")} puedeReservar={puedeReservar} soloAcom={fAcom || null} infoPorHotel={enr.infoPorHotel} planesInfo={enr.planesInfo} />
          ) : modulo === "porcion_terrestre" ? (
            <PorPaquete filas={filasFiltradas.filter((f) => f.modulo === "porcion_terrestre")} puedeReservar={puedeReservar} soloAcom={fAcom || null} infoPorHotel={enr.infoPorHotel} planesInfo={enr.planesInfo} />
          ) : (
            <PorServicios filas={filasFiltradas.filter((f) => f.modulo === "servicios")} puedeReservar={puedeReservar} />
          )}
        </>
      )}

      {!mostrarCta && vista !== "programas" && hayMas && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={cargarMas}
            disabled={pending}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {pending ? "Cargando…" : `Cargar más (${filas.length} de ${total.toLocaleString("es-CO")})`}
          </button>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-gray-400">
        Tarifas por persona por paquete, sujetas a disponibilidad. Los programas se cotizan en su moneda.
      </p>
    </div>
  );
}

// ── Módulo BLOQUEOS: elige una salida (ciclo aéreo) y ve los hoteles ───────
function PorSalida({ filas, puedeReservar, cuposPorBloqueo = {}, soloAcom = null, infoPorHotel = {}, planesInfo = {} }: { filas: FilaTarifario[]; puedeReservar: boolean; cuposPorBloqueo?: Record<number, number>; soloAcom?: string | null; infoPorHotel?: InfoHotel; planesInfo?: PlanesInfo }) {
  // Cupos de una salida (un bloqueo). undefined = desconocido (no ocultar).
  const cuposDe = (f: FilaTarifario): number | undefined =>
    f.bloqueo_id != null ? cuposPorBloqueo[f.bloqueo_id] : undefined;
  // Oculta salidas sin cupos disponibles (obs 4): solo si se conoce y es 0.
  const filasConCupo = useMemo(
    () => filas.filter((f) => { const c = cuposDe(f); return c === undefined || c > 0; }),
    [filas] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const salidas = useMemo(() => {
    const map = new Map<string, FilaTarifario>();
    for (const f of filasConCupo) {
      const key = `${f.destino_nombre}|||${f.bloqueo_label}|||${f.fecha_ida}`;
      if (!map.has(key)) map.set(key, f);
    }
    return [...map.entries()].map(([key, f]) => ({ key, f }));
  }, [filasConCupo]);

  const [sel, setSel] = useState(salidas[0]?.key ?? "");
  const selFila = salidas.find((s) => s.key === sel)?.f;
  const rows = useMemo(
    () =>
      pivotar(
        filasConCupo.filter((f) => `${f.destino_nombre}|||${f.bloqueo_label}|||${f.fecha_ida}` === sel)
      ),
    [filasConCupo, sel]
  );

  return (
    <div className="space-y-4">
      {/* Lista de salidas (horizontal) */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Salidas</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {salidas.map(({ key, f }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSel(key)}
              className="shrink-0 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              style={
                sel === key
                  ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                  : { borderColor: "#e5e7eb", backgroundColor: "white" }
              }
            >
              <span className="block whitespace-nowrap font-medium text-gray-800">{f.destino_nombre ?? "—"}</span>
              <span className="block whitespace-nowrap text-xs text-gray-500">
                {fmtFecha(f.fecha_ida)} → {fmtFecha(f.fecha_regreso)} · {f.noches}N
              </span>
              <span className="block whitespace-nowrap text-[11px] text-gray-400">{f.bloqueo_label}</span>
              {(() => { const c = cuposDe(f); return c !== undefined ? (
                <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: "rgba(102,181,150,0.18)", color: "var(--brand-success)" }}>
                  {c} cupo(s) disponible(s)
                </span>
              ) : null; })()}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla horizontal */}
      <div className="min-w-0">
        {selFila && (
          <p className="mb-2 text-sm text-gray-600">
            <b style={{ color: "var(--brand-primary)" }}>{selFila.destino_nombre}</b> ·{" "}
            {fmtFecha(selFila.fecha_ida)} → {fmtFecha(selFila.fecha_regreso)} ({selFila.noches} noches)
          </p>
        )}
        <TablaHorizontal rows={rows} puedeReservar={puedeReservar} soloAcom={soloAcom} infoPorHotel={infoPorHotel} planesInfo={planesInfo} />
      </div>
    </div>
  );
}

// ── Módulo PORCIÓN TERRESTRE: elige un paquete ─────────────────────────────
function PorPaquete({ filas, puedeReservar, soloAcom = null, infoPorHotel = {}, planesInfo = {} }: { filas: FilaTarifario[]; puedeReservar: boolean; soloAcom?: string | null; infoPorHotel?: InfoHotel; planesInfo?: PlanesInfo }) {
  const paquetes = useMemo(() => {
    const map = new Map<string, FilaTarifario>();
    for (const f of filas) {
      const key = `${f.paquete_nombre}`;
      if (!map.has(key)) map.set(key, f);
    }
    return [...map.entries()].map(([key, f]) => ({ key, f }));
  }, [filas]);

  const [sel, setSel] = useState(paquetes[0]?.key ?? "");
  const rows = useMemo(() => pivotar(filas.filter((f) => `${f.paquete_nombre}` === sel)), [filas, sel]);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Paquetes</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {paquetes.map(({ key, f }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSel(key)}
              className="shrink-0 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              style={
                sel === key
                  ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                  : { borderColor: "#e5e7eb", backgroundColor: "white" }
              }
            >
              <span className="block whitespace-nowrap font-medium text-gray-800">{f.paquete_nombre}</span>
              <span className="block whitespace-nowrap text-xs text-gray-500">{f.destino_nombre} · {f.noches}N</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <TablaHorizontal rows={rows} puedeReservar={puedeReservar} soloAcom={soloAcom} infoPorHotel={infoPorHotel} planesInfo={planesInfo} />
      </div>
    </div>
  );
}

// ── Módulo SERVICIOS ───────────────────────────────────────────────────────
function PorServicios({ filas, puedeReservar = false }: { filas: FilaTarifario[]; puedeReservar?: boolean }) {
  if (!filas.length) return <p className="py-12 text-center text-sm text-gray-400">No hay servicios publicados.</p>;
  // Agrupa por paquete → servicio
  const porPaquete = new Map<number, FilaTarifario[]>();
  for (const f of filas) {
    const k = f.paquete_id ?? -1;
    const arr = porPaquete.get(k) ?? [];
    arr.push(f);
    porPaquete.set(k, arr);
  }
  return (
    <div className="space-y-5">
      {[...porPaquete.entries()].map(([pid, rows]) => {
        const servicios = new Map<string, FilaTarifario[]>();
        for (const f of rows) {
          const arr = servicios.get(f.servicio_nombre ?? "—") ?? [];
          arr.push(f);
          servicios.set(f.servicio_nombre ?? "—", arr);
        }
        const f0 = rows[0];
        return (
          <div key={pid}>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>{f0.paquete_nombre ?? "Servicios"}</p>
              {puedeReservar && pid > 0 && (
                <Link href={`/dashboard/reservar/nuevo?paquete=${pid}&modulo=servicios`} className="text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
                  Reservar →
                </Link>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <tbody>
                  {[...servicios.entries()].map(([nombre, srows]) => {
                    const esGrupo = (srows[0].tipo_tarifa ?? "persona") === "grupo";
                    const escalas = [...srows].sort((a, b) => (a.pax_desde ?? 0) - (b.pax_desde ?? 0));
                    const descripcion = srows[0].descripcion?.trim() || "";
                    const recargo = Math.max(Number(srows[0].recargo_individual) || 0, 0);
                    return esGrupo ? (
                      escalas.map((e, i) => (
                        <tr key={`${nombre}-${i}`} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 font-medium text-gray-800">
                            {i === 0 ? nombre : ""}
                            {i === 0 && descripcion && <div className="text-xs font-normal text-gray-500">{descripcion}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-gray-500">{e.pax_desde}–{e.pax_hasta} pax</td>
                          <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                            {formatMoneda(e.precio_pvp, e.moneda)} <span className="text-xs text-gray-400">/grupo</span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr key={nombre} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 font-medium text-gray-800">
                          {nombre}
                          {descripcion && <div className="text-xs font-normal text-gray-500">{descripcion}</div>}
                          {recargo > 0 && <div className="text-xs font-normal text-amber-600">+{formatMoneda(recargo, srows[0].moneda)} si viaja 1 pax (recargo individual)</div>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">Por persona</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                          {formatMoneda(srows[0].precio_pvp, srows[0].moneda)} <span className="text-xs text-gray-400">/persona</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reservarHref(r: Pivotada): string {
  const p = new URLSearchParams();
  if (r.paquete_id != null) p.set("paquete", String(r.paquete_id));
  if (r.hotel_id != null) p.set("hotel", String(r.hotel_id));
  if (r.bloqueo_id != null) p.set("bloqueo", String(r.bloqueo_id));
  if (r.empaquetado_id != null) p.set("empaquetado", String(r.empaquetado_id));
  if (r.salida_id != null) p.set("salida", String(r.salida_id));
  p.set("modulo", r.modulo);
  return `/dashboard/reservar/nuevo?${p.toString()}`;
}

function TablaHorizontal({ rows, puedeReservar = false, soloAcom = null, infoPorHotel = {}, planesInfo = {} }: { rows: Pivotada[]; puedeReservar?: boolean; soloAcom?: string | null; infoPorHotel?: InfoHotel; planesInfo?: PlanesInfo }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filtro de acomodación: restringe las columnas a esa acomodación y deja solo
  // las filas (hotel/categoría/régimen) que tienen tarifa en ella.
  const cols = soloAcom ? COLS.filter(([k]) => k === soloAcom) : COLS;
  const rowsVisibles = soloAcom ? rows.filter((r) => r.precios[soloAcom] != null) : rows;

  if (!rowsVisibles.length) return <p className="py-8 text-center text-sm text-gray-400">Sin tarifas para esta selección.</p>;

  // Agrupa por hotel conservando el orden
  const byHotel = new Map<string, Pivotada[]>();
  for (const r of rowsVisibles) {
    const arr = byHotel.get(r.hotel) ?? [];
    arr.push(r);
    byHotel.set(r.hotel, arr);
  }

  function toggle(hotel: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(hotel)) n.delete(hotel);
      else n.add(hotel);
      return n;
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-3 py-2">Hotel</th>
            <th className="px-3 py-2">Categoría</th>
            <th className="px-3 py-2">R.A.</th>
            {cols.map(([k, label]) => (
              <th key={k} className="px-3 py-2 text-right">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...byHotel.entries()].map(([hotel, hrows]) => {
            const isOpen = expanded.has(hotel);
            const visibles = isOpen ? hrows : hrows.slice(0, 1);
            const ocultas = hrows.length - 1;
            return (
              <Fragment key={hotel}>
                {visibles.map((r, i) => (
                  <tr key={`${hotel}-${i}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {i === 0 ? r.hotel : ""}
                      {i === 0 && r.hotel_id != null && <CategoriaInline info={infoPorHotel[r.hotel_id]} />}
                      {i === 0 && r.hotel_id != null && <AdultsOnlyBadge info={infoPorHotel[r.hotel_id]} />}
                      {i === 0 && r.hotel_id != null && <PetFriendlyBadge info={infoPorHotel[r.hotel_id]} />}
                      {i === 0 && r.hotel_id != null && rangoEdades(infoPorHotel[r.hotel_id]) && (
                        <span className="mt-0.5 block text-[11px] font-normal text-gray-400">{rangoEdades(infoPorHotel[r.hotel_id])}</span>
                      )}
                      {i === 0 && r.hotel_id != null && notasNinoInfante(infoPorHotel[r.hotel_id]) && (
                        <span className="mt-0.5 block text-[11px] font-normal text-amber-600">{notasNinoInfante(infoPorHotel[r.hotel_id])}</span>
                      )}
                      {i === 0 && puedeReservar && r.paquete_id != null && r.hotel_id != null && (
                        <Link href={reservarHref(r)} className="mt-0.5 block text-xs font-normal" style={{ color: "var(--brand-accent)" }}>
                          Reservar →
                        </Link>
                      )}
                      {i === 0 && puedeReservar && (
                        <BriefFlyerButton
                          className="mt-0.5 block"
                          datos={{
                            destino: r.destino, hotel: r.hotel, categoria: r.categoria, regimen: r.regimen,
                            noches: r.noches, precios: r.precios,
                            edadNino: r.hotel_id != null ? rangoEdades(infoPorHotel[r.hotel_id]) : null,
                          }}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.categoria}</td>
                    <td className="px-3 py-2 text-gray-600">
                      <RegimenInfo codigo={r.regimen} info={planesInfo[(r.regimen ?? "").trim().toUpperCase()]} />
                    </td>
                    {cols.map(([k]) => {
                      // En habitaciones, 0 = no aplica (no gratis) → "—". En niños
                      // (nino/nino2) e infante el 0 es válido (gratis) y sí se muestra.
                      const esRoom = k !== "nino" && k !== "nino2" && k !== "infante";
                      const v = r.precios[k];
                      const mostrar = v != null && (!esRoom || v > 0);
                      return (
                        <td key={k} className="px-3 py-2 text-right tabular-nums">
                          {mostrar ? (
                            <span style={{ color: "var(--brand-primary)" }}>{formatMoneda(v, r.moneda)}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {ocultas > 0 && (
                  <tr>
                    <td colSpan={3 + cols.length} className="px-3 pb-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => toggle(hotel)}
                        className="text-xs font-medium"
                        style={{ color: "var(--brand-accent)" }}
                      >
                        {isOpen ? "Ver menos" : `Ver ${ocultas} opción${ocultas > 1 ? "es" : ""} más de ${hotel} →`}
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Programas (circuitos) — vista de cards flotantes con filtro de destino ────
function PorProgramas({ programas, puedeReservar = false }: { programas: ProgramaResumen[]; puedeReservar?: boolean }) {
  const [destino, setDestino] = useState("");
  const [transporte, setTransporte] = useState<"" | "aereo" | "terrestre" | "ninguno">("");

  // Destinos únicos (ciudades de todos los programas) para el filtro.
  const destinos = useMemo(() => {
    const set = new Set<string>();
    for (const p of programas) for (const c of p.ciudades) if (c) set.add(c.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [programas]);

  const filtrados = useMemo(
    () =>
      programas.filter((p) => {
        if (destino && !p.ciudades.some((c) => c.toLowerCase() === destino.toLowerCase())) return false;
        if (transporte && p.tipo_transporte !== transporte) return false;
        return true;
      }),
    [programas, destino, transporte]
  );

  if (!programas.length) {
    return <p className="py-12 text-center text-gray-400">No hay programas publicados.</p>;
  }

  return (
    <div>
      {/* Barra de filtros */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Destino</label>
          <select
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los destinos</option>
            {destinos.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Traslado</label>
          <div className="flex flex-wrap gap-1">
            {([["", "Todos", null], ["aereo", "Con aéreo", Plane], ["terrestre", "Salida terrestre", Bus], ["ninguno", "Porción terrestre", null]] as const).map(([v, l, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setTransporte(v)}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all"
                style={
                  transporte === v
                    ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" }
                    : { borderColor: "#e5e7eb", color: "#6b7280" }
                }
              >
                {Icon && <Icon size={12} />}{l}
              </button>
            ))}
          </div>
        </div>
        <span className="ml-auto self-center text-xs text-gray-400">{filtrados.length} programa(s)</span>
      </div>

      {filtrados.length === 0 ? (
        <p className="py-12 text-center text-gray-400">No hay programas para ese filtro.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((p) => (
            <div
              key={p.id}
              className="flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--brand-primary)] hover:shadow-lg"
            >
          <Link href={`/tarifario/programa/${p.id}`} className="block">
            {p.portada_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.portada_url} alt={p.nombre} className="h-40 w-full object-cover" />
            ) : (
              // Portada por defecto: degradado de marca con el nombre del programa.
              <div className="bg-brand-gradient flex h-40 w-full items-end p-4">
                <span className="text-sm font-semibold leading-tight text-white drop-shadow">{p.nombre}</span>
              </div>
            )}
            <div className="p-5 pb-0">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-gray-800">{p.nombre}</div>
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={
                    p.tipo_transporte === "aereo"
                      ? { backgroundColor: "rgba(29,124,154,0.12)", color: "var(--brand-primary)" }
                      : p.tipo_transporte === "terrestre"
                        ? { backgroundColor: "rgba(102,181,150,0.15)", color: "var(--brand-success)" }
                        : { backgroundColor: "#f3f4f6", color: "#6b7280" }
                  }
                >
                  {p.tipo_transporte === "aereo" ? (
                    <><Plane size={11} /> Con aéreo</>
                  ) : p.tipo_transporte === "terrestre" ? (
                    <><Bus size={11} /> Salida terrestre</>
                  ) : (
                    "Porción terrestre"
                  )}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {p.subtitulo ?? ""}
                {p.dias ? ` · ${p.dias} días / ${p.noches ?? ""} noches` : ""}
              </p>
            </div>
          </Link>
          <div className="px-5 pb-5 pt-0">
          <div className="mt-3 flex items-end justify-between">
            {p.desde_pvp != null ? (
              <div>
                <div className="text-xs text-gray-400">desde</div>
                <div className="text-lg font-semibold" style={{ color: "var(--brand-primary)" }}>
                  {formatMoneda(p.desde_pvp, p.moneda)}
                </div>
                <div className="text-[10px] text-gray-400">por persona</div>
              </div>
            ) : (
              <span className="text-sm text-gray-400">Consultar</span>
            )}
            <div className="flex items-center gap-3">
              <Link href={`/tarifario/programa/${p.id}`} className="text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
                Ver
              </Link>
              {puedeReservar && (
                <Link
                  href={`/dashboard/reservar/programa/${p.id}`}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: "var(--brand-primary)" }}
                >
                  Reservar →
                </Link>
              )}
            </div>
          </div>
          </div>
        </div>
          ))}
        </div>
      )}
    </div>
  );
}
