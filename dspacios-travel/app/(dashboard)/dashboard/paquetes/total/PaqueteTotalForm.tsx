"use client";
// Paquete 100 % dinámico (#82): montaje. Los checks de vuelo / hotel / servicios habilitan SOLO sus pestañas.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hotel, Plane, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/DateInput";
import { ACOMS_DIN, pvpDeNeto, type AcomDin, type PrecioAcom } from "@/lib/paqueteDinamico/calculo";
import type { EntradaHotel, EntradaPaqueteTotal, EntradaServicio, EntradaVuelo } from "@/lib/paqueteDinamico/entrada";
import { guardarPaqueteTotal } from "./actions";

type Opt = { id: number; nombre: string; destino_id: number | null };
export type EmpaquetadoOpt = { id: number; aerolinea: string | null; ruta: string | null; fecha_ida: string; fecha_regreso: string | null; destino_id: number | null; tarifa_proveedor: number; fee_infante: number };

const ETQ: Record<AcomDin, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño 1", nino2: "Niño 2", infante: "Infante" };
const sel = "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const n = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[^\d.-]/g, "")));

export const ENTRADA_VACIA: EntradaPaqueteTotal = {
  nombre: "", destinoId: null, destinosExtra: [], moneda: "COP", esquema: "neta_markup", pvpModo: null, pctMkPct: 20,
  usaVuelo: false, usaHotel: true, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "",
  pvpGeneral: null, totalDeclarado: null, descripcion: "", incluye: "", noIncluye: "", vuelos: [], hoteles: [], servicios: [],
};

function GridAcom({ valor, onChange, etiqueta, solo }: { valor: PrecioAcom; onChange: (v: PrecioAcom) => void; etiqueta: string; solo?: readonly AcomDin[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(solo ?? ACOMS_DIN).map((a) => (
        <div key={a}>
          <label className={lbl}>{etiqueta} · {ETQ[a]}</label>
          <Input inputMode="numeric" aria-label={`${etiqueta} ${ETQ[a]}`} value={valor[a] == null ? "" : String(valor[a])} onChange={(e) => onChange({ ...valor, [a]: n(e.target.value) })} />
        </div>
      ))}
    </div>
  );
}

export function PaqueteTotalForm({ inicial, destinos, hoteles, servicios, empaquetados }: {
  inicial: EntradaPaqueteTotal; destinos: { id: number; nombre: string }[]; hoteles: Opt[]; servicios: Opt[]; empaquetados: EmpaquetadoOpt[];
}) {
  const router = useRouter();
  const [e, setE] = useState<EntradaPaqueteTotal>(inicial);
  const [tab, setTab] = useState<"config" | "vuelo" | "hotel" | "servicios">("config");
  const [pending, start] = useTransition();
  // El mensaje pertenece al estado del formulario en que se generó (`base`): al seguir editando deja de mostrarse.
  const [msg, setMsg] = useState<{ ok: boolean; t: string; base: EntradaPaqueteTotal } | null>(null);
  const set = (p: Partial<EntradaPaqueteTotal>) => setE((x) => ({ ...x, ...p }));
  const neta = e.esquema === "neta_markup";
  const porComp = e.esquema === "solo_pvp" && e.pvpModo === "por_componente";
  const general = e.esquema === "solo_pvp" && e.pvpModo === "general";

  const tabs = useMemo(() => [
    { k: "config" as const, t: "Configuración", i: Settings2, on: true },
    { k: "vuelo" as const, t: "Vuelo", i: Plane, on: e.usaVuelo },
    { k: "hotel" as const, t: "Hotel", i: Hotel, on: e.usaHotel },
    { k: "servicios" as const, t: "Servicios", i: Sparkles, on: e.usaServicios },
  ], [e.usaVuelo, e.usaHotel, e.usaServicios]);
  const tabActiva = tabs.find((x) => x.k === tab)?.on ? tab : "config";

  const destinosPermitidos = new Set<number | null>([e.destinoId, ...e.destinosExtra]);
  const hotelesDest = hoteles.filter((h) => e.destinoId == null || h.destino_id === e.destinoId);
  const serviciosDest = servicios.filter((s) => s.destino_id == null || destinosPermitidos.has(s.destino_id));
  const empDest = empaquetados.filter((x) => x.destino_id == null || destinosPermitidos.has(x.destino_id));

  const upd = <K extends "vuelos" | "hoteles" | "servicios">(k: K, i: number, p: Partial<EntradaPaqueteTotal[K][number]>) =>
    setE((x) => ({ ...x, [k]: (x[k] as object[]).map((r, j) => (j === i ? { ...r, ...p } : r)) }) as EntradaPaqueteTotal);
  const del = (k: "vuelos" | "hoteles" | "servicios", i: number) => setE((x) => ({ ...x, [k]: (x[k] as object[]).filter((_, j) => j !== i) }) as EntradaPaqueteTotal);

  const nuevoHotel = (h?: Opt): EntradaHotel => ({ hotelId: h?.id ?? null, nombre: h?.nombre ?? "", categoria: "", regimen: "", descripcion: "", fotoUrl: "", proveedor: "", neto: {}, pvp: {}, pvpGeneral: null });
  const nuevoVuelo = (x?: EmpaquetadoOpt): EntradaVuelo => ({
    empaquetadoId: x?.id ?? null, destinoId: x?.destino_id ?? null, aerolinea: x?.aerolinea ?? "", ruta: x?.ruta ?? "", fechaIda: x?.fecha_ida ?? "", fechaRegreso: x?.fecha_regreso ?? "",
    proveedor: x?.aerolinea ?? "", neto: x ? { adulto: x.tarifa_proveedor, nino: x.tarifa_proveedor, infante: x.fee_infante } : {}, pvp: {},
  });
  const nuevoServicio = (s?: Opt): EntradaServicio => ({ servicioId: s?.id ?? null, destinoId: s?.destino_id ?? null, nombre: s?.nombre ?? "", proveedor: "", neto: null, pvp: null });

  const guardar = () => start(async () => {
    setMsg(null);
    const r = await guardarPaqueteTotal(e);
    if (!r.ok) return setMsg({ ok: false, t: r.error, base: e });
    setMsg({ ok: true, t: r.avisos?.[0] ?? "Paquete guardado.", base: e });
    if (!e.id) router.replace(`/dashboard/paquetes/total/${r.id}`);
    else router.refresh();
  });

  const pvpPrev = (neto: number | null | undefined) => (neta && neto != null ? pvpDeNeto(neto, e.pctMkPct / 100, e.moneda) : NaN);

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((x) => (
          <button key={x.k} type="button" role="tab" aria-selected={tabActiva === x.k} disabled={!x.on} onClick={() => setTab(x.k)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${tabActiva === x.k ? "border-[var(--brand-success)] bg-[var(--brand-success-bg)] text-[var(--brand-success-dark)]" : "border-gray-200 bg-white text-gray-600"} disabled:cursor-not-allowed disabled:opacity-40`}>
            <x.i className="h-4 w-4" /> {x.t}
          </button>
        ))}
      </div>

      {tabActiva === "config" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Nombre</label><Input value={e.nombre} onChange={(x) => set({ nombre: x.target.value })} /></div>
            <div><label className={lbl}>Destino principal</label>
              <select className={sel} value={e.destinoId ?? ""} onChange={(x) => set({ destinoId: x.target.value ? Number(x.target.value) : null })}>
                <option value="">Elige…</option>{destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select></div>
            <div><label className={lbl}>Destinos adicionales (multidestino)</label>
              <select multiple className={`${sel} h-24`} value={e.destinosExtra.map(String)} onChange={(x) => set({ destinosExtra: Array.from(x.target.selectedOptions).map((o) => Number(o.value)) })}>
                {destinos.filter((d) => d.id !== e.destinoId).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">Permite escoger vuelos y servicios de otro destino.</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Moneda</label><select className={sel} value={e.moneda} onChange={(x) => set({ moneda: x.target.value as "COP" | "USD" })}><option>COP</option><option>USD</option></select></div>
              <div><label className={lbl}>Noches</label><Input inputMode="numeric" value={String(e.noches)} onChange={(x) => set({ noches: Number(x.target.value) || 0 })} /></div>
            </div>
          </div>

          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-600">Componentes del paquete</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {([["usaVuelo", "Vuelo"], ["usaHotel", "Hotel"], ["usaServicios", "Servicios"]] as const).map(([k, t]) => (
                <label key={k} className="inline-flex items-center gap-2"><input type="checkbox" checked={e[k]} onChange={(x) => set({ [k]: x.target.checked })} /> {t}</label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-600">Esquema de precios</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input type="radio" name="esq" checked={neta} onChange={() => set({ esquema: "neta_markup", pvpModo: null })} /> Netas + markup</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="esq" checked={!neta} onChange={() => set({ esquema: "solo_pvp", pvpModo: e.pvpModo ?? "por_componente" })} /> Solo PVP</label>
            </div>
            {neta && <div className="mt-3 max-w-[10rem]"><label className={lbl}>Markup (% de margen)</label><Input inputMode="decimal" value={String(e.pctMkPct)} onChange={(x) => set({ pctMkPct: Number(x.target.value.replace(",", ".")) || 0 })} /></div>}
            {!neta && (
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="modo" checked={general} onChange={() => set({ pvpModo: "general" })} /> Precio general del paquete (por acomodación)</label>
                <label className="flex items-center gap-2"><input type="radio" name="modo" checked={porComp} onChange={() => set({ pvpModo: "por_componente" })} /> PVP separado por componente</label>
                <p className="text-xs text-gray-500">En solo PVP no se inventan costos: antes de convertir la cotización en contrato se exige el costo real y el proveedor de cada componente.</p>
              </div>
            )}
          </fieldset>

          {general && (
            <div><h4 className="mb-1 text-sm font-semibold text-gray-700">Precio general por persona (toda la estadía)</h4>
              <GridAcom etiqueta="PVP" valor={e.pvpGeneral ?? {}} onChange={(v) => set({ pvpGeneral: v })} /></div>
          )}
          {porComp && (
            <div><h4 className="mb-1 text-sm font-semibold text-gray-700">Total declarado por acomodación (opcional, se contrasta con el desglose)</h4>
              <GridAcom etiqueta="Total" valor={e.totalDeclarado ?? {}} onChange={(v) => set({ totalDeclarado: v })} /></div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className={lbl}>Compra desde</label><DateInput aria-label="Compra desde" type="date" value={e.compraInicio} onValueChange={(d) => set({ compraInicio: d })} /></div>
            <div><label className={lbl}>Compra hasta</label><DateInput aria-label="Compra hasta" type="date" value={e.compraFin} onValueChange={(d) => set({ compraFin: d })} /></div>
            <div><label className={lbl}>Viaje desde</label><DateInput aria-label="Viaje desde" type="date" value={e.viajeInicio} onValueChange={(d) => set({ viajeInicio: d })} /></div>
            <div><label className={lbl}>Viaje hasta</label><DateInput aria-label="Viaje hasta" type="date" value={e.viajeFin} onValueChange={(d) => set({ viajeFin: d })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={lbl}>Descripción</label><textarea className="min-h-20 w-full rounded-md border border-gray-200 p-2 text-sm" value={e.descripcion} onChange={(x) => set({ descripcion: x.target.value })} /></div>
            <div><label className={lbl}>Incluye (uno por línea)</label><textarea className="min-h-20 w-full rounded-md border border-gray-200 p-2 text-sm" value={e.incluye} onChange={(x) => set({ incluye: x.target.value })} /></div>
            <div><label className={lbl}>No incluye</label><textarea className="min-h-20 w-full rounded-md border border-gray-200 p-2 text-sm" value={e.noIncluye} onChange={(x) => set({ noIncluye: x.target.value })} /></div>
          </div>
        </section>
      )}

      {tabActiva === "vuelo" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${sel} max-w-sm`} value="" onChange={(x) => { const em = empaquetados.find((q) => q.id === Number(x.target.value)); if (em) set({ vuelos: [...e.vuelos, nuevoVuelo(em)] }); }}>
              <option value="">Vincular vuelo de Empaquetados…</option>
              {empDest.map((q) => <option key={q.id} value={q.id}>{q.aerolinea ?? "—"} · {q.ruta ?? "—"} · {q.fecha_ida}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={() => set({ vuelos: [...e.vuelos, nuevoVuelo()] })}><Plus className="h-4 w-4" /> Vuelo manual</Button>
          </div>
          {e.vuelos.map((v, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between text-xs text-gray-500"><span>{v.empaquetadoId ? `Vinculado a Empaquetados #${v.empaquetadoId} (valores copiados; edítalos aquí)` : "Vuelo manual"}</span>
                <button type="button" aria-label="Quitar vuelo" onClick={() => del("vuelos", i)}><Trash2 className="h-4 w-4 text-red-500" /></button></div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div><label className={lbl}>Aerolínea</label><Input value={v.aerolinea} onChange={(x) => upd("vuelos", i, { aerolinea: x.target.value })} /></div>
                <div><label className={lbl}>Ruta</label><Input value={v.ruta} onChange={(x) => upd("vuelos", i, { ruta: x.target.value })} /></div>
                <div><label className={lbl}>Ida</label><DateInput aria-label="Ida" type="date" value={v.fechaIda} onValueChange={(d) => upd("vuelos", i, { fechaIda: d })} /></div>
                <div><label className={lbl}>Regreso</label><DateInput aria-label="Regreso" type="date" value={v.fechaRegreso} onValueChange={(d) => upd("vuelos", i, { fechaRegreso: d })} /></div>
                <div><label className={lbl}>Proveedor</label><Input value={v.proveedor} onChange={(x) => upd("vuelos", i, { proveedor: x.target.value })} /></div>
                <div><label className={lbl}>Destino del vuelo</label>
                  <select className={sel} value={v.destinoId ?? ""} onChange={(x) => upd("vuelos", i, { destinoId: x.target.value ? Number(x.target.value) : null })}>
                    <option value="">Destino del paquete</option>{destinos.filter((d) => destinosPermitidos.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                  </select></div>
              </div>
              {!general && (
                <div className="grid grid-cols-3 gap-2">
                  {(["adulto", "nino", "infante"] as const).map((k) => (
                    <div key={k}><label className={lbl}>{neta ? "Neto" : "PVP"} · {k}</label>
                      <Input inputMode="numeric" value={(neta ? v.neto[k] : v.pvp[k]) == null ? "" : String(neta ? v.neto[k] : v.pvp[k])}
                        onChange={(x) => upd("vuelos", i, neta ? { neto: { ...v.neto, [k]: n(x.target.value) } } : { pvp: { ...v.pvp, [k]: n(x.target.value) } })} />
                      {neta && v.neto[k] != null && <span className="text-xs text-gray-500">PVP {pvpPrev(v.neto[k])}</span>}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!e.vuelos.length && <p className="text-sm text-gray-500">Vincula un vuelo de Empaquetados o crea uno manual.</p>}
        </section>
      )}

      {tabActiva === "hotel" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${sel} max-w-sm`} value="" onChange={(x) => { const h = hoteles.find((q) => q.id === Number(x.target.value)); if (h) set({ hoteles: [...e.hoteles, nuevoHotel(h)] }); }}>
              <option value="">Usar ficha de hotel existente…</option>
              {hotelesDest.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={() => set({ hoteles: [...e.hoteles, nuevoHotel()] })}><Plus className="h-4 w-4" /> Hotel manual</Button>
          </div>
          {e.hoteles.map((h, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between text-xs text-gray-500"><span>{h.hotelId ? `Ficha existente #${h.hotelId} (sus vigencias y tarifas NO se usan; los precios se cargan aquí)` : "Hotel manual del paquete"}</span>
                <button type="button" aria-label="Quitar hotel" onClick={() => del("hoteles", i)}><Trash2 className="h-4 w-4 text-red-500" /></button></div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div><label className={lbl}>Nombre</label><Input value={h.nombre} onChange={(x) => upd("hoteles", i, { nombre: x.target.value })} /></div>
                <div><label className={lbl}>Categoría</label><Input value={h.categoria} onChange={(x) => upd("hoteles", i, { categoria: x.target.value })} /></div>
                <div><label className={lbl}>Régimen / plan</label><Input value={h.regimen} onChange={(x) => upd("hoteles", i, { regimen: x.target.value })} /></div>
                <div><label className={lbl}>Proveedor</label><Input value={h.proveedor} onChange={(x) => upd("hoteles", i, { proveedor: x.target.value })} /></div>
                <div className="sm:col-span-2"><label className={lbl}>Foto (URL; vacía = foto predeterminada)</label><Input value={h.fotoUrl} onChange={(x) => upd("hoteles", i, { fotoUrl: x.target.value })} /></div>
                <div className="sm:col-span-3"><label className={lbl}>Descripción</label><Input value={h.descripcion} onChange={(x) => upd("hoteles", i, { descripcion: x.target.value })} /></div>
              </div>
              {!general && <GridAcom etiqueta={neta ? "Neto" : "PVP"} valor={neta ? h.neto : h.pvp} onChange={(v) => upd("hoteles", i, neta ? { neto: v } : { pvp: v })} />}
              {neta && <p className="text-xs text-gray-500">PVP (con {e.pctMkPct}%): {ACOMS_DIN.map((a) => `${ETQ[a]} ${Number.isFinite(pvpPrev(h.neto[a])) ? pvpPrev(h.neto[a]) : "—"}`).join(" · ")}</p>}
              {general && <p className="text-xs text-gray-500">En precio general el precio se define en Configuración; aquí solo van los datos y la foto del hotel.</p>}
            </div>
          ))}
          {!e.hoteles.length && <p className="text-sm text-gray-500">Agrega una ficha existente o un hotel manual.</p>}
        </section>
      )}

      {tabActiva === "servicios" && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${sel} max-w-sm`} value="" onChange={(x) => { const s = servicios.find((q) => q.id === Number(x.target.value)); if (s) set({ servicios: [...e.servicios, nuevoServicio(s)] }); }}>
              <option value="">Vincular servicio existente…</option>
              {serviciosDest.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={() => set({ servicios: [...e.servicios, nuevoServicio()] })}><Plus className="h-4 w-4" /> Servicio manual</Button>
          </div>
          {e.servicios.map((s, i) => (
            <div key={i} className="grid items-end gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-5">
              <div className="sm:col-span-2"><label className={lbl}>Servicio {s.servicioId ? `(ficha #${s.servicioId})` : "(manual)"}</label><Input value={s.nombre} onChange={(x) => upd("servicios", i, { nombre: x.target.value })} /></div>
              <div><label className={lbl}>Proveedor</label><Input value={s.proveedor} onChange={(x) => upd("servicios", i, { proveedor: x.target.value })} /></div>
              {!general && <div><label className={lbl}>{neta ? "Neto" : "PVP"} por persona</label>
                <Input inputMode="numeric" value={(neta ? s.neto : s.pvp) == null ? "" : String(neta ? s.neto : s.pvp)} onChange={(x) => upd("servicios", i, neta ? { neto: n(x.target.value) } : { pvp: n(x.target.value) })} /></div>}
              <button type="button" aria-label="Quitar servicio" onClick={() => del("servicios", i)} className="justify-self-end pb-2"><Trash2 className="h-4 w-4 text-red-500" /></button>
            </div>
          ))}
          {!e.servicios.length && <p className="text-sm text-gray-500">Agrega servicios existentes o manuales. Los precios son por persona (no aplican a infantes).</p>}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar paquete"}</Button>
        {msg && msg.base === e && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.t}</p>}
      </div>
    </div>
  );
}
