"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { ConfigForm } from "../ConfigForm";
import { setVuelo, setHotel, setServicio, generarTarifario } from "../actions";

type Opt = { id: number; nombre: string };
type Vuelo = {
  id: number; record: string | null; ruta: string | null; aerolinea: string | null;
  fecha_ida: string | null; fecha_regreso: string | null; tarifa_para_empaquetar: number; destino_id: number | null;
};
type Hotel = { id: number; nombre: string; zona: string | null; destino_id: number | null };
type Servicio = { id: number; nombre: string; tarifa_neta: number; liquidacion: string; destino_id: number | null };
type SelVuelo = { bloqueo_id: number; aplica_mk: boolean; ta: number };
type Resultado = {
  id: number; modulo: string; bloqueo_label: string | null; hotel_nombre: string | null;
  categoria: string | null; regimen: string | null; acomodacion: string | null; noches: number | null;
  base_comisionable: number; impuesto: number; precio_pvp: number;
};

const ACOM_LBL: Record<string, string> = {
  sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño",
};
const LIQ_LBL: Record<string, string> = { dia: "/día", noche: "/noche", paquete: "/paquete" };

export function ArmadoClient(props: {
  paqueteId: number;
  destinos: Opt[];
  config: Parameters<typeof ConfigForm>[0]["initial"];
  tieneDestino: boolean;
  vuelosDisp: Vuelo[];
  hotelesDisp: Hotel[];
  serviciosDisp: Servicio[];
  selVuelos: SelVuelo[];
  selHoteles: number[];
  selServicios: number[];
  resultado: Resultado[];
}) {
  const router = useRouter();
  const [openCfg, setOpenCfg] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const vueloSel = new Map(props.selVuelos.map((v) => [v.bloqueo_id, v]));
  const hotelSel = new Set(props.selHoteles);
  const servSel = new Set(props.selServicios);

  function refrescar() {
    router.refresh();
  }

  function generar() {
    setMsg("");
    start(async () => {
      const r = await generarTarifario(props.paqueteId);
      if (r.ok) setMsg(`Tarifario generado: ${r.id ?? 0} tarifas publicadas.`);
      else setMsg(`Error: ${r.error}`);
      refrescar();
    });
  }

  if (!props.tieneDestino) {
    return (
      <div className="space-y-4">
        <Section title="Configuración inicial" open onToggle={() => {}}>
          <ConfigForm destinos={props.destinos} id={props.paqueteId} initial={props.config} />
        </Section>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Asigna un <b>destino</b> en la configuración para ver los vuelos, hoteles y servicios disponibles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Configuración (colapsable) */}
      <Section title="Configuración inicial" open={openCfg} onToggle={() => setOpenCfg((o) => !o)}>
        <ConfigForm destinos={props.destinos} id={props.paqueteId} initial={props.config} />
      </Section>

      {/* Adición de vuelos */}
      <Section title={`Adición de vuelos (${vueloSel.size})`} open onToggle={() => {}}>
        {!props.vuelosDisp.length ? (
          <Empty>No hay ciclos aéreos del destino en el rango de viaje.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {props.vuelosDisp.map((v) => (
              <VueloRow
                key={v.id}
                v={v}
                sel={vueloSel.get(v.id)}
                paqueteId={props.paqueteId}
                onDone={refrescar}
              />
            ))}
          </ul>
        )}
      </Section>

      {/* Adición de hoteles */}
      <Section title={`Adición de hoteles (${hotelSel.size})`} open onToggle={() => {}}>
        {!props.hotelesDisp.length ? (
          <Empty>No hay hoteles del destino.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {props.hotelesDisp.map((h) => (
              <CheckRow
                key={h.id}
                checked={hotelSel.has(h.id)}
                title={h.nombre}
                subtitle={h.zona ?? undefined}
                onChange={(checked) =>
                  start(async () => {
                    await setHotel(props.paqueteId, h.id, checked);
                    refrescar();
                  })
                }
              />
            ))}
          </ul>
        )}
      </Section>

      {/* Adición de servicios */}
      <Section title={`Adición de servicios (${servSel.size})`} open onToggle={() => {}}>
        {!props.serviciosDisp.length ? (
          <Empty>No hay servicios del destino.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {props.serviciosDisp.map((s) => (
              <CheckRow
                key={s.id}
                checked={servSel.has(s.id)}
                title={s.nombre}
                subtitle={`${formatCOP(s.tarifa_neta)} ${LIQ_LBL[s.liquidacion] ?? ""}`}
                onChange={(checked) =>
                  start(async () => {
                    await setServicio(props.paqueteId, s.id, checked);
                    refrescar();
                  })
                }
              />
            ))}
          </ul>
        )}
      </Section>

      {/* Generar + resultado */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-gray-800">Tarifario (resultado)</p>
            <p className="text-xs text-gray-500">Liquida el paquete y publica las tarifas por persona.</p>
          </div>
          <Button onClick={generar} disabled={pending} style={{ backgroundColor: "var(--brand-accent)" }}>
            {pending ? "Generando…" : "Generar / actualizar tarifario"}
          </Button>
        </div>
        {msg && <p className="mt-2 text-sm text-gray-600">{msg}</p>}

        <ResultadoTabla filas={props.resultado} />
      </div>
    </div>
  );
}

function VueloRow({
  v, sel, paqueteId, onDone,
}: {
  v: Vuelo; sel: SelVuelo | undefined; paqueteId: number; onDone: () => void;
}) {
  const [, start] = useTransition();
  const checked = !!sel;
  const [aplicaMk, setAplicaMk] = useState(sel?.aplica_mk ?? true);
  const [ta, setTa] = useState(sel ? String(sel.ta) : "");

  function save(nextChecked: boolean, nextMk = aplicaMk, nextTa = ta) {
    start(async () => {
      await setVuelo(paqueteId, v.id, nextChecked, nextMk, Number(nextTa) || 0);
      onDone();
    });
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(e) => save(e.target.checked)}
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">
            {v.record} <span className="text-gray-400">·</span> {v.ruta ?? ""}{" "}
            {v.aerolinea ? <span className="text-gray-400">· {v.aerolinea}</span> : null}
          </p>
          <p className="text-xs text-gray-500">
            {v.fecha_ida} → {v.fecha_regreso} · tiquete {formatCOP(v.tarifa_para_empaquetar)}
          </p>

          {checked && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  checked={aplicaMk}
                  onChange={() => { setAplicaMk(true); save(true, true, ta); }}
                />
                Aplicar mk del paquete
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  checked={!aplicaMk}
                  onChange={() => { setAplicaMk(false); save(true, false, ta); }}
                />
                Sumar TA
              </label>
              {!aplicaMk && (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">TA</span>
                  <Input
                    type="number"
                    min={0}
                    value={ta}
                    onChange={(e) => setTa(e.target.value)}
                    onBlur={() => save(true, false, ta)}
                    className="h-7 w-28"
                    placeholder="0"
                  />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function CheckRow({
  checked, title, subtitle, onChange,
}: {
  checked: boolean; title: string; subtitle?: string; onChange: (checked: boolean) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <p className="text-sm font-medium text-gray-800">{title}</p>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </li>
  );
}

function ResultadoTabla({ filas }: { filas: Resultado[] }) {
  if (!filas.length) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
        Aún no hay tarifas. Selecciona vuelos/hoteles y genera el tarifario.
      </p>
    );
  }
  // Agrupa por salida (bloqueo_label o porción terrestre) → hotel
  const grupos = new Map<string, Map<string, Resultado[]>>();
  for (const f of filas) {
    const g = f.bloqueo_label ?? (f.modulo === "porcion_terrestre" ? "Porción terrestre" : "—");
    const h = f.hotel_nombre ?? "—";
    if (!grupos.has(g)) grupos.set(g, new Map());
    const byHotel = grupos.get(g)!;
    if (!byHotel.has(h)) byHotel.set(h, []);
    byHotel.get(h)!.push(f);
  }

  return (
    <div className="mt-4 space-y-5">
      {[...grupos.entries()].map(([salida, byHotel]) => (
        <div key={salida}>
          <p className="mb-1 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>{salida}</p>
          {[...byHotel.entries()].map(([hotel, rows]) => (
            <div key={hotel} className="mb-3 overflow-x-auto rounded-lg border border-gray-100">
              <div className="bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700">{hotel}</div>
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500">
                  <tr className="border-t border-gray-100">
                    <th className="px-3 py-1.5 text-left">Categoría</th>
                    <th className="px-3 py-1.5 text-left">Régimen</th>
                    <th className="px-3 py-1.5 text-left">Acom.</th>
                    <th className="px-3 py-1.5 text-right">Noches</th>
                    <th className="px-3 py-1.5 text-right">Base com.</th>
                    <th className="px-3 py-1.5 text-right">Impuesto</th>
                    <th className="px-3 py-1.5 text-right">PVP /pax</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-50">
                      <td className="px-3 py-1.5">{r.categoria ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.regimen ?? "—"}</td>
                      <td className="px-3 py-1.5">{ACOM_LBL[r.acomodacion ?? ""] ?? r.acomodacion}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.noches}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatCOP(r.base_comisionable)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatCOP(r.impuesto)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: "var(--brand-primary)" }}>
                        {formatCOP(r.precio_pvp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Section({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-semibold text-gray-800">{title}</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-gray-100 p-4">{children}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-gray-400">{children}</p>;
}
