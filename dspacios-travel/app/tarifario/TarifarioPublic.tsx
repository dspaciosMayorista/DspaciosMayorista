"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { formatCOP, formatMoneda } from "@/lib/utils";
import { CartDrawer } from "./CartDrawer";
import { VistaBooking } from "./VistaBooking";

export type ProgramaResumen = {
  id: number;
  nombre: string;
  subtitulo: string | null;
  dias: number | null;
  noches: number | null;
  moneda: string;
  desde_pvp: number | null;
};

export type FilaTarifario = {
  modulo: "bloqueo" | "porcion_terrestre" | "servicios";
  bloqueo_label: string | null;
  bloqueo_id?: number | null;
  paquete_id?: number;
  hotel_id?: number | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  noches: number | null;
  destino_nombre: string | null;
  paquete_nombre: string | null;
  hotel_nombre: string | null;
  servicio_nombre?: string | null;
  tipo_tarifa?: string | null;
  pax_desde?: number | null;
  pax_hasta?: number | null;
  categoria: string | null;
  regimen: string | null;
  acomodacion: string | null;
  precio_pvp: number;
};

const MODULOS: { key: FilaTarifario["modulo"]; label: string }[] = [
  { key: "bloqueo", label: "Bloqueos" },
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
  modulo: FilaTarifario["modulo"];
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
        paquete_id: f.paquete_id, hotel_id: f.hotel_id, bloqueo_id: f.bloqueo_id, modulo: f.modulo,
      };
      map.set(key, row);
    }
    if (f.acomodacion) row.precios[f.acomodacion] = f.precio_pvp;
  }
  return [...map.values()].sort(
    (a, b) => a.hotel.localeCompare(b.hotel) || a.categoria.localeCompare(b.categoria) || a.regimen.localeCompare(b.regimen)
  );
}

type ModuloKey = FilaTarifario["modulo"] | "programas";

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
  filas,
  programas = [],
  puedeReservar = false,
  cuposPorBloqueo = {},
  fotosPorHotel = {},
}: {
  filas: FilaTarifario[];
  programas?: ProgramaResumen[];
  puedeReservar?: boolean;
  cuposPorBloqueo?: Record<number, number>;
  fotosPorHotel?: Record<number, string>;
}) {
  const [vista, setVista] = useState<"tabla" | "booking">("tabla");
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("");
  const [fReg, setFReg] = useState("");
  const [fAcom, setFAcom] = useState("");

  // Opciones únicas para los selects (de toda la base, ordenadas).
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

  const tabs: { key: ModuloKey; label: string }[] = [
    ...MODULOS.filter((m) => filasFiltradas.some((f) => f.modulo === m.key)),
    ...(programas.length ? [{ key: "programas" as const, label: "Programas" }] : []),
  ];
  const [moduloSel, setModuloSel] = useState<ModuloKey>("bloqueo");
  // Si el módulo activo se queda sin resultados por el filtro, salta al primero con datos.
  const modulo = tabs.some((t) => t.key === moduloSel) ? moduloSel : (tabs[0]?.key ?? "bloqueo");

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700";

  return (
    <div>
      {/* Toggle de vista: tabla (estático) vs Booking (dinámico) */}
      <div className="mb-4 inline-flex rounded-full border border-gray-200 bg-white p-1">
        {([["tabla", "Vista tabla"], ["booking", "Vista Booking"]] as const).map(([v, label]) => (
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

      {/* Barra de filtros y buscador */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar hotel por nombre…"
          className="min-w-[180px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
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
      </div>

      {vista === "booking" ? (
        <VistaBooking filas={filasFiltradas} fotosPorHotel={fotosPorHotel} cuposPorBloqueo={cuposPorBloqueo} puedeReservar={puedeReservar} />
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

          {tabs.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">No hay resultados para los filtros aplicados.</p>
          ) : modulo === "bloqueo" ? (
            <PorSalida filas={filasFiltradas.filter((f) => f.modulo === "bloqueo")} puedeReservar={puedeReservar} cuposPorBloqueo={cuposPorBloqueo} soloAcom={fAcom || null} />
          ) : modulo === "porcion_terrestre" ? (
            <PorPaquete filas={filasFiltradas.filter((f) => f.modulo === "porcion_terrestre")} puedeReservar={puedeReservar} soloAcom={fAcom || null} />
          ) : modulo === "servicios" ? (
            <PorServicios filas={filasFiltradas.filter((f) => f.modulo === "servicios")} puedeReservar={puedeReservar} />
          ) : (
            <PorProgramas programas={programas} puedeReservar={puedeReservar} />
          )}
        </>
      )}

      <p className="mt-4 text-center text-xs text-gray-400">
        Tarifas por persona por paquete, sujetas a disponibilidad. Los programas se cotizan en su moneda.
      </p>

      <CartDrawer checkoutHabilitado />
    </div>
  );
}

// ── Módulo BLOQUEOS: elige una salida (ciclo aéreo) y ve los hoteles ───────
function PorSalida({ filas, puedeReservar, cuposPorBloqueo = {}, soloAcom = null }: { filas: FilaTarifario[]; puedeReservar: boolean; cuposPorBloqueo?: Record<number, number>; soloAcom?: string | null }) {
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
        <TablaHorizontal rows={rows} puedeReservar={puedeReservar} soloAcom={soloAcom} />
      </div>
    </div>
  );
}

// ── Módulo PORCIÓN TERRESTRE: elige un paquete ─────────────────────────────
function PorPaquete({ filas, puedeReservar, soloAcom = null }: { filas: FilaTarifario[]; puedeReservar: boolean; soloAcom?: string | null }) {
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
        <TablaHorizontal rows={rows} puedeReservar={puedeReservar} soloAcom={soloAcom} />
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
                    return esGrupo ? (
                      escalas.map((e, i) => (
                        <tr key={`${nombre}-${i}`} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 font-medium text-gray-800">{i === 0 ? nombre : ""}</td>
                          <td className="px-3 py-1.5 text-gray-500">{e.pax_desde}–{e.pax_hasta} pax</td>
                          <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                            {formatCOP(e.precio_pvp)} <span className="text-xs text-gray-400">/grupo</span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr key={nombre} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 font-medium text-gray-800">{nombre}</td>
                        <td className="px-3 py-1.5 text-gray-500">Por persona</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                          {formatCOP(srows[0].precio_pvp)} <span className="text-xs text-gray-400">/persona</span>
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
  p.set("modulo", r.modulo);
  return `/dashboard/reservar/nuevo?${p.toString()}`;
}

function TablaHorizontal({ rows, puedeReservar = false, soloAcom = null }: { rows: Pivotada[]; puedeReservar?: boolean; soloAcom?: string | null }) {
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
                      {i === 0 && puedeReservar && r.paquete_id != null && r.hotel_id != null && (
                        <Link href={reservarHref(r)} className="mt-0.5 block text-xs font-normal" style={{ color: "var(--brand-accent)" }}>
                          Reservar →
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.categoria}</td>
                    <td className="px-3 py-2 text-gray-600">{r.regimen}</td>
                    {cols.map(([k]) => {
                      // En habitaciones, 0 = no aplica (no gratis) → "—". En niños
                      // (nino/nino2) el 0 es válido (gratis) y sí se muestra.
                      const esRoom = k !== "nino" && k !== "nino2";
                      const v = r.precios[k];
                      const mostrar = v != null && (!esRoom || v > 0);
                      return (
                        <td key={k} className="px-3 py-2 text-right tabular-nums">
                          {mostrar ? (
                            <span style={{ color: "var(--brand-primary)" }}>{formatCOP(v)}</span>
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

// ── Programas (circuitos) ───────────────────────────────────────────────────
function PorProgramas({ programas, puedeReservar = false }: { programas: ProgramaResumen[]; puedeReservar?: boolean }) {
  if (!programas.length) {
    return <p className="py-12 text-center text-gray-400">No hay programas publicados.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {programas.map((p) => (
        <div
          key={p.id}
          className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-[var(--brand-primary)] hover:shadow-sm"
        >
          <Link href={`/tarifario/programa/${p.id}`} className="block">
            <div className="font-semibold text-gray-800">{p.nombre}</div>
            <p className="mt-0.5 text-xs text-gray-500">
              {p.subtitulo ?? ""}
              {p.dias ? ` · ${p.dias} días / ${p.noches ?? ""} noches` : ""}
            </p>
          </Link>
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
      ))}
    </div>
  );
}
