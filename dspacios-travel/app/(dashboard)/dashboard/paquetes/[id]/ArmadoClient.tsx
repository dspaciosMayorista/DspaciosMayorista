"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { ConfigForm } from "../ConfigForm";
import {
  setVuelo, setTodosVuelos, setHotel, setServicio, generarTarifario,
  getTarifasHotel, setHotelFiltros, type TarifaHotelPreview,
} from "../actions";

type Opt = { id: number; nombre: string };
type Vuelo = {
  id: number; record: string | null; ruta: string | null; aerolinea: string | null;
  fecha_ida: string | null; fecha_regreso: string | null; tarifa_para_empaquetar: number; destino_id: number | null;
};
type Hotel = { id: number; nombre: string; zona: string | null; destino_id: number | null };
type Servicio = { id: number; nombre: string; precio_persona: number | null; precio_grupo: number | null; destino_id: number | null };
type SelServicio = { servicio_id: number; modo: string };
type SelVuelo = { bloqueo_id: number; aplica_mk: boolean; ta: number };
type SelHotel = { hotel_id: number; categorias: string[] | null; regimenes: string[] | null };
type Resultado = {
  id: number; modulo: string; bloqueo_label: string | null; hotel_nombre: string | null;
  servicio_nombre: string | null;
  categoria: string | null; regimen: string | null; acomodacion: string | null; noches: number | null;
  base_comisionable: number; impuesto: number; precio_pvp: number;
};

const ACOM_LBL: Record<string, string> = {
  sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño",
};

export function ArmadoClient(props: {
  paqueteId: number;
  destinos: Opt[];
  config: Parameters<typeof ConfigForm>[0]["initial"];
  tieneDestino: boolean;
  vuelosDisp: Vuelo[];
  hotelesDisp: Hotel[];
  serviciosDisp: Servicio[];
  selVuelos: SelVuelo[];
  selHoteles: SelHotel[];
  selServicios: SelServicio[];
  resultado: Resultado[];
}) {
  const router = useRouter();
  const tipo = (props.config?.tipo ?? "bloqueo") as "bloqueo" | "porcion_terrestre" | "servicios";
  const [openCfg, setOpenCfg] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const vueloSel = new Map(props.selVuelos.map((v) => [v.bloqueo_id, v]));
  const hotelSel = new Map(props.selHoteles.map((h) => [h.hotel_id, h]));
  const servSel = new Map(props.selServicios.map((s) => [s.servicio_id, s.modo]));

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
      {tipo === "bloqueo" && (
      <Section title={`Adición de vuelos (${vueloSel.size})`} open onToggle={() => {}}>
        {!props.vuelosDisp.length ? (
          <Empty>No hay ciclos aéreos del destino en el rango de viaje.</Empty>
        ) : (
          <>
            <label className="mb-1 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={vueloSel.size === props.vuelosDisp.length && props.vuelosDisp.length > 0}
                ref={(el) => {
                  if (el) el.indeterminate = vueloSel.size > 0 && vueloSel.size < props.vuelosDisp.length;
                }}
                onChange={(e) =>
                  start(async () => {
                    await setTodosVuelos(
                      props.paqueteId,
                      props.vuelosDisp.map((v) => v.id),
                      e.target.checked
                    );
                    refrescar();
                  })
                }
              />
              Seleccionar todos
            </label>
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
          </>
        )}
      </Section>

      )}

      {/* Adición de hoteles */}
      {(tipo === "bloqueo" || tipo === "porcion_terrestre") && (
      <Section title={`Adición de hoteles (${hotelSel.size})`} open onToggle={() => {}}>
        {!props.hotelesDisp.length ? (
          <Empty>No hay hoteles del destino.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {props.hotelesDisp.map((h) => (
              <HotelRow
                key={h.id}
                hotel={h}
                sel={hotelSel.get(h.id)}
                paqueteId={props.paqueteId}
                onDone={refrescar}
              />
            ))}
          </ul>
        )}
      </Section>

      )}

      {/* Adición de servicios */}
      <Section title={`Adición de servicios (${servSel.size})`} open onToggle={() => {}}>
        {!props.serviciosDisp.length ? (
          <Empty>No hay servicios del destino.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {props.serviciosDisp.map((s) => (
              <ServicioRow
                key={s.id}
                s={s}
                modo={servSel.get(s.id)}
                paqueteId={props.paqueteId}
                onDone={refrescar}
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

function HotelRow({
  hotel, sel, paqueteId, onDone,
}: {
  hotel: Hotel; sel: SelHotel | undefined; paqueteId: number; onDone: () => void;
}) {
  const [, start] = useTransition();
  const [openModal, setOpenModal] = useState(false);
  const checked = !!sel;

  const resumen = !checked
    ? null
    : sel!.categorias?.length || sel!.regimenes?.length
      ? `${sel!.categorias?.length ?? "todas las"} categorías · ${sel!.regimenes?.length ?? "todos los"} regímenes`
      : "todas las categorías y regímenes";

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) =>
            start(async () => {
              await setHotel(paqueteId, hotel.id, e.target.checked);
              onDone();
            })
          }
        />
        <div className="flex-1">
          <button
            type="button"
            onClick={() => setOpenModal(true)}
            className="text-left text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            {hotel.nombre}
          </button>
          <p className="text-xs text-gray-500">
            {hotel.zona ? `${hotel.zona} · ` : ""}
            {checked ? resumen : "clic en el nombre para ver tarifas y elegir categorías/regímenes"}
          </p>
        </div>
      </div>
      {openModal && (
        <HotelModal
          hotel={hotel}
          sel={sel}
          paqueteId={paqueteId}
          onClose={() => setOpenModal(false)}
          onDone={onDone}
        />
      )}
    </li>
  );
}

function HotelModal({
  hotel, sel, paqueteId, onClose, onDone,
}: {
  hotel: Hotel; sel: SelHotel | undefined; paqueteId: number; onClose: () => void; onDone: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<string[]>([]);
  const [regs, setRegs] = useState<string[]>([]);
  const [tarifas, setTarifas] = useState<TarifaHotelPreview[]>([]);
  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  const [selRegs, setSelRegs] = useState<Set<string>>(new Set());
  const [saving, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const r = await getTarifasHotel(hotel.id);
      setCats(r.categorias);
      setRegs(r.regimenes);
      setTarifas(r.tarifas);
      // Selección inicial: lo guardado, o todo si era "todas" (null)
      setSelCats(new Set(sel?.categorias ?? r.categorias));
      setSelRegs(new Set(sel?.regimenes ?? r.regimenes));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.id]);

  function toggle(set: Set<string>, val: string, setter: (s: Set<string>) => void) {
    const n = new Set(set);
    if (n.has(val)) n.delete(val);
    else n.add(val);
    setter(n);
  }

  function guardar() {
    // Si están todas seleccionadas → guardar como "todas" (array vacío)
    const catsArr = selCats.size === cats.length ? [] : [...selCats];
    const regsArr = selRegs.size === regs.length ? [] : [...selRegs];
    start(async () => {
      await setHotelFiltros(paqueteId, hotel.id, catsArr, regsArr);
      onDone();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{hotel.nombre}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">Cargando tarifas…</p>
        ) : !tarifas.length ? (
          <p className="py-8 text-center text-sm text-gray-400">Este hotel no tiene tarifas cargadas en Producto.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PickBox
                titulo="Categorías de habitación"
                items={cats}
                sel={selCats}
                onToggle={(v) => toggle(selCats, v, setSelCats)}
                onAll={() => setSelCats(new Set(selCats.size === cats.length ? [] : cats))}
                allChecked={selCats.size === cats.length}
              />
              <PickBox
                titulo="Regímenes de alimentación"
                items={regs}
                sel={selRegs}
                onToggle={(v) => toggle(selRegs, v, setSelRegs)}
                onAll={() => setSelRegs(new Set(selRegs.size === regs.length ? [] : regs))}
                allChecked={selRegs.size === regs.length}
              />
            </div>

            <p className="mb-1 mt-4 text-xs font-medium text-gray-500">Tarifas netas cargadas (referencia interna)</p>
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="text-gray-500">
                  <tr className="border-b border-gray-100">
                    <th className="px-2 py-1 text-left">Categoría</th>
                    <th className="px-2 py-1 text-left">Régimen</th>
                    <th className="px-2 py-1 text-left">Temp.</th>
                    <th className="px-2 py-1 text-right">Doble</th>
                    <th className="px-2 py-1 text-right">Triple</th>
                  </tr>
                </thead>
                <tbody>
                  {tarifas.map((t, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-2 py-1">{t.categoria}</td>
                      <td className="px-2 py-1">{t.regimen}</td>
                      <td className="px-2 py-1">{t.temporada}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.neto_doble ? formatCOP(t.neto_doble) : "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.neto_triple ? formatCOP(t.neto_triple) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving} style={{ backgroundColor: "var(--brand-primary)" }}>
                {saving ? "Guardando…" : "Guardar y agregar hotel"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PickBox({
  titulo, items, sel, onToggle, onAll, allChecked,
}: {
  titulo: string; items: string[]; sel: Set<string>; onToggle: (v: string) => void; onAll: () => void; allChecked: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <label className="flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-700">
        <input type="checkbox" checked={allChecked} onChange={onAll} />
        {titulo} (todas)
      </label>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {items.map((it) => (
          <li key={it}>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={sel.has(it)} onChange={() => onToggle(it)} />
              {it}
            </label>
          </li>
        ))}
        {!items.length && <li className="text-xs text-gray-400">Sin datos.</li>}
      </ul>
    </div>
  );
}

function ServicioRow({
  s, modo, paqueteId, onDone,
}: {
  s: Servicio; modo: string | undefined; paqueteId: number; onDone: () => void;
}) {
  const [, start] = useTransition();
  const checked = modo !== undefined;
  const tienePersona = s.precio_persona != null;
  const tieneGrupo = s.precio_grupo != null;

  function save(nextChecked: boolean, nextModo: "persona" | "grupo") {
    start(async () => {
      await setServicio(paqueteId, s.id, nextChecked, nextModo);
      onDone();
    });
  }

  function toggle(c: boolean) {
    const def: "persona" | "grupo" = tienePersona ? "persona" : "grupo";
    save(c, (modo as "persona" | "grupo") ?? def);
  }

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => toggle(e.target.checked)} />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">{s.nombre}</p>
          <p className="text-xs text-gray-500">
            {tienePersona ? `Persona: ${formatCOP(s.precio_persona!)}` : ""}
            {tienePersona && tieneGrupo ? " · " : ""}
            {tieneGrupo ? `Grupo: ${formatCOP(s.precio_grupo!)}` : ""}
          </p>
          {checked && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-2 text-xs">
              <span className="text-gray-500">Cobrar:</span>
              <label className="flex items-center gap-1" style={{ opacity: tienePersona ? 1 : 0.4 }}>
                <input type="radio" disabled={!tienePersona} checked={modo === "persona"} onChange={() => save(true, "persona")} />
                Por persona
              </label>
              <label className="flex items-center gap-1" style={{ opacity: tieneGrupo ? 1 : 0.4 }}>
                <input type="radio" disabled={!tieneGrupo} checked={modo === "grupo"} onChange={() => save(true, "grupo")} />
                Por grupo
              </label>
            </div>
          )}
        </div>
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

  // Servicios se muestran como lista simple (sin categoría/régimen/acomodación)
  const servicios = filas.filter((f) => f.modulo === "servicios");
  if (servicios.length && servicios.length === filas.length) {
    return (
      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-100">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500">
            <tr className="border-b border-gray-100">
              <th className="px-3 py-1.5 text-left">Servicio</th>
              <th className="px-3 py-1.5 text-right">PVP /persona</th>
            </tr>
          </thead>
          <tbody>
            {servicios.map((r) => (
              <tr key={r.id} className="border-t border-gray-50">
                <td className="px-3 py-1.5">{r.servicio_nombre ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: "var(--brand-primary)" }}>
                  {formatCOP(r.precio_pvp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
