"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { formatCOP, formatMoneda } from "@/lib/utils";

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

export function TarifarioPublic({
  filas,
  programas = [],
  puedeReservar = false,
  cuposPorBloqueo = {},
}: {
  filas: FilaTarifario[];
  programas?: ProgramaResumen[];
  puedeReservar?: boolean;
  cuposPorBloqueo?: Record<number, number>;
}) {
  const tabs: { key: ModuloKey; label: string }[] = [
    ...MODULOS.filter((m) => filas.some((f) => f.modulo === m.key)),
    ...(programas.length ? [{ key: "programas" as const, label: "Programas" }] : []),
  ];
  const [modulo, setModulo] = useState<ModuloKey>(tabs[0]?.key ?? "bloqueo");

  return (
    <div>
      {/* Tabs de módulos */}
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setModulo(m.key)}
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

      {modulo === "bloqueo" ? (
        <PorSalida filas={filas.filter((f) => f.modulo === "bloqueo")} puedeReservar={puedeReservar} cuposPorBloqueo={cuposPorBloqueo} />
      ) : modulo === "porcion_terrestre" ? (
        <PorPaquete filas={filas.filter((f) => f.modulo === "porcion_terrestre")} puedeReservar={puedeReservar} />
      ) : modulo === "servicios" ? (
        <PorServicios filas={filas.filter((f) => f.modulo === "servicios")} puedeReservar={puedeReservar} />
      ) : (
        <PorProgramas programas={programas} />
      )}

      <p className="mt-4 text-center text-xs text-gray-400">
        Tarifas por persona por paquete, sujetas a disponibilidad. Los programas se cotizan en su moneda.
      </p>
    </div>
  );
}

// ── Módulo BLOQUEOS: elige una salida (ciclo aéreo) y ve los hoteles ───────
function PorSalida({ filas, puedeReservar, cuposPorBloqueo = {} }: { filas: FilaTarifario[]; puedeReservar: boolean; cuposPorBloqueo?: Record<number, number> }) {
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
    <div className="flex flex-col gap-4 md:flex-row">
      {/* Lista de salidas */}
      <aside className="md:w-72 md:shrink-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Salidas</p>
        <ul className="space-y-1">
          {salidas.map(({ key, f }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSel(key)}
                className="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                style={
                  sel === key
                    ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                    : { borderColor: "#e5e7eb", backgroundColor: "white" }
                }
              >
                <span className="block font-medium text-gray-800">{f.destino_nombre ?? "—"}</span>
                <span className="block text-xs text-gray-500">
                  {fmtFecha(f.fecha_ida)} → {fmtFecha(f.fecha_regreso)} · {f.noches}N
                </span>
                <span className="block text-[11px] text-gray-400">{f.bloqueo_label}</span>
                {(() => { const c = cuposDe(f); return c !== undefined ? (
                  <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: "rgba(102,181,150,0.18)", color: "var(--brand-success)" }}>
                    {c} cupo(s) disponible(s)
                  </span>
                ) : null; })()}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Tabla horizontal */}
      <div className="min-w-0 flex-1">
        {selFila && (
          <p className="mb-2 text-sm text-gray-600">
            <b style={{ color: "var(--brand-primary)" }}>{selFila.destino_nombre}</b> ·{" "}
            {fmtFecha(selFila.fecha_ida)} → {fmtFecha(selFila.fecha_regreso)} ({selFila.noches} noches)
          </p>
        )}
        <TablaHorizontal rows={rows} puedeReservar={puedeReservar} />
      </div>
    </div>
  );
}

// ── Módulo PORCIÓN TERRESTRE: elige un paquete ─────────────────────────────
function PorPaquete({ filas, puedeReservar }: { filas: FilaTarifario[]; puedeReservar: boolean }) {
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
    <div className="flex flex-col gap-4 md:flex-row">
      <aside className="md:w-72 md:shrink-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Paquetes</p>
        <ul className="space-y-1">
          {paquetes.map(({ key, f }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSel(key)}
                className="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                style={
                  sel === key
                    ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                    : { borderColor: "#e5e7eb", backgroundColor: "white" }
                }
              >
                <span className="block font-medium text-gray-800">{f.paquete_nombre}</span>
                <span className="block text-xs text-gray-500">{f.destino_nombre} · {f.noches}N</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1">
        <TablaHorizontal rows={rows} puedeReservar={puedeReservar} />
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

function TablaHorizontal({ rows, puedeReservar = false }: { rows: Pivotada[]; puedeReservar?: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!rows.length) return <p className="py-8 text-center text-sm text-gray-400">Sin tarifas para esta selección.</p>;

  // Agrupa por hotel conservando el orden
  const byHotel = new Map<string, Pivotada[]>();
  for (const r of rows) {
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
            {COLS.map(([k, label]) => (
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
                    {COLS.map(([k]) => (
                      <td key={k} className="px-3 py-2 text-right tabular-nums">
                        {r.precios[k] != null ? (
                          <span style={{ color: "var(--brand-primary)" }}>{formatCOP(r.precios[k])}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {ocultas > 0 && (
                  <tr className="border-t border-gray-50">
                    <td colSpan={3 + COLS.length} className="px-3 py-1.5">
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
function PorProgramas({ programas }: { programas: ProgramaResumen[] }) {
  if (!programas.length) {
    return <p className="py-12 text-center text-gray-400">No hay programas publicados.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {programas.map((p) => (
        <Link
          key={p.id}
          href={`/tarifario/programa/${p.id}`}
          className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-[#1D7C9A] hover:shadow-sm"
        >
          <div>
            <div className="font-semibold text-gray-800">{p.nombre}</div>
            <p className="mt-0.5 text-xs text-gray-500">
              {p.subtitulo ?? ""}
              {p.dias ? ` · ${p.dias} días / ${p.noches ?? ""} noches` : ""}
            </p>
          </div>
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
            <span className="text-xs font-medium text-[#26BBD9]">Ver programa →</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
