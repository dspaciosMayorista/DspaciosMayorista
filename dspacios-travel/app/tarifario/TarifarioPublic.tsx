"use client";

import { useMemo, useState } from "react";
import { formatCOP } from "@/lib/utils";

export type FilaTarifario = {
  modulo: "bloqueo" | "porcion_terrestre" | "servicios";
  bloqueo_label: string | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  noches: number | null;
  destino_nombre: string | null;
  paquete_nombre: string | null;
  hotel_nombre: string | null;
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
      row = { hotel, categoria, regimen, precios: {} };
      map.set(key, row);
    }
    if (f.acomodacion) row.precios[f.acomodacion] = f.precio_pvp;
  }
  return [...map.values()].sort(
    (a, b) => a.hotel.localeCompare(b.hotel) || a.categoria.localeCompare(b.categoria) || a.regimen.localeCompare(b.regimen)
  );
}

export function TarifarioPublic({ filas }: { filas: FilaTarifario[] }) {
  const modulosPresentes = MODULOS.filter((m) => filas.some((f) => f.modulo === m.key));
  const [modulo, setModulo] = useState<FilaTarifario["modulo"]>(modulosPresentes[0]?.key ?? "bloqueo");

  return (
    <div>
      {/* Tabs de módulos */}
      <div className="mb-5 flex flex-wrap gap-2">
        {modulosPresentes.map((m) => (
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
        <PorSalida filas={filas.filter((f) => f.modulo === "bloqueo")} />
      ) : modulo === "porcion_terrestre" ? (
        <PorPaquete filas={filas.filter((f) => f.modulo === "porcion_terrestre")} />
      ) : (
        <p className="py-12 text-center text-sm text-gray-400">No hay servicios publicados todavía.</p>
      )}

      <p className="mt-4 text-center text-xs text-gray-400">
        Todas las tarifas son por persona por paquete, en pesos colombianos. Sujetas a disponibilidad.
      </p>
    </div>
  );
}

// ── Módulo BLOQUEOS: elige una salida (ciclo aéreo) y ve los hoteles ───────
function PorSalida({ filas }: { filas: FilaTarifario[] }) {
  const salidas = useMemo(() => {
    const map = new Map<string, FilaTarifario>();
    for (const f of filas) {
      const key = `${f.destino_nombre}|||${f.bloqueo_label}|||${f.fecha_ida}`;
      if (!map.has(key)) map.set(key, f);
    }
    return [...map.entries()].map(([key, f]) => ({ key, f }));
  }, [filas]);

  const [sel, setSel] = useState(salidas[0]?.key ?? "");
  const selFila = salidas.find((s) => s.key === sel)?.f;
  const rows = useMemo(
    () =>
      pivotar(
        filas.filter((f) => `${f.destino_nombre}|||${f.bloqueo_label}|||${f.fecha_ida}` === sel)
      ),
    [filas, sel]
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
        <TablaHorizontal rows={rows} />
      </div>
    </div>
  );
}

// ── Módulo PORCIÓN TERRESTRE: elige un paquete ─────────────────────────────
function PorPaquete({ filas }: { filas: FilaTarifario[] }) {
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
        <TablaHorizontal rows={rows} />
      </div>
    </div>
  );
}

function TablaHorizontal({ rows }: { rows: Pivotada[] }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-gray-400">Sin tarifas para esta selección.</p>;
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
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-3 py-2 font-medium text-gray-800">{r.hotel}</td>
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
        </tbody>
      </table>
    </div>
  );
}
