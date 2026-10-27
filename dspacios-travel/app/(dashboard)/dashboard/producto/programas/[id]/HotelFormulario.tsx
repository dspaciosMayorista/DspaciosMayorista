"use client";

// PR #409 — Formulario de UN hotel (vive dentro del diálogo de edición):
//   · datos y ocupación permitida; las acomodaciones que el hotel no admite NO se piden (Triple/Múltiple con máximo 2;
//     tarifa de menor con 0 menores) y, si ya había tarifas cargadas, se muestran como conflicto — nunca se descartan en silencio;
//   · PRECIO BASE por vigencia (entrada) y modalidad de servicios;
//   · NOCHE ADICIONAL ligada a una vigencia base ya creada: se ELIGE de una lista (privados y regulares con las mismas fechas son
//     una sola opción), no se escriben fechas; solo se captura unidad de cobro y netos.
import { Plus, Trash2 } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { parseNumOrNull } from "@/lib/calc/programaPrecio";
import {
  CLAVES_TARIFA,
  ETIQUETA_ACOM,
  ETIQUETA_MODALIDAD,
  ETIQUETA_UNIDAD,
  MODALIDADES_SERVICIOS,
  UNIDADES_COBRO,
  claveCompatible,
  fechaLegible,
  opcionesVigenciaBase,
  pvpNocheUnidad,
  type ClaveTarifa,
  type UnidadCobro,
} from "@/lib/programas/estanciaHotel88";
import { precioUnitarioSalida, salidaPrecioDesdeBase, type ProgramaPrecioCabecera } from "@/lib/programas/precioReserva57";
import { aPorAcom, conflictosDe, incompatiblesDe, netosVacios, paraValidar, quitarIncompatibles, type BaseState, type HotelState, type NocheState } from "./hotelEstado";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const clave = (desde: string, hasta: string) => `${desde}|${hasta}`;

export function HotelFormulario({
  h, onChange, programa, proveedores, nombreRepetido,
}: {
  h: HotelState;
  onChange: (next: HotelState) => void;
  programa: ProgramaPrecioCabecera;
  proveedores: { id: number; nombre: string }[];
  /** Otro hotel ya usa este nombre. */
  nombreRepetido: boolean;
}) {
  const moneda = programa.moneda;
  const opt = { pctMk: programa.pct_mk, asistenciaDia: programa.asistencia_medica_dia, pctFee: programa.pct_fee_tarjeta, moneda };
  const v = paraValidar(h);
  const claves = CLAVES_TARIFA.filter((k) => claveCompatible(v, k));
  const incompatibles = incompatiblesDe(h);
  const conflictos = conflictosDe(h);
  const { opciones, conflictos: conflictosBase } = opcionesVigenciaBase(v.base);
  const usadas = new Set(h.noches.map((n) => clave(n.desde, n.hasta)));

  const set = (patch: Partial<HotelState>) => onChange({ ...h, ...patch });
  const setBase = (r: number, patch: Partial<BaseState>) => set({ base: h.base.map((b, j) => (j === r ? { ...b, ...patch } : b)) });
  const setNoche = (r: number, patch: Partial<NocheState>) => set({ noches: h.noches.map((t, j) => (j === r ? { ...t, ...patch } : t)) });

  const pvpBase = (b: BaseState, k: ClaveTarifa) =>
    precioUnitarioSalida(programa, salidaPrecioDesdeBase({ bajoSolicitud: b.bajoSolicitud, neto: aPorAcom(b.neto) }), k)?.pvp ?? null;
  const pvpNoche = (t: NocheState, k: ClaveTarifa) => {
    const n = parseNumOrNull(t.neto[k]);
    if (n == null || !(UNIDADES_COBRO as readonly string[]).includes(t.unidad)) return null;
    return pvpNocheUnidad(n, t.unidad as UnidadCobro, k, opt);
  };

  const agregarNoche = () => {
    const libre = opciones.find((o) => !usadas.has(clave(o.desde, o.hasta)));
    if (libre) set({ noches: [...h.noches, { desde: libre.desde, hasta: libre.hasta, unidad: "", neto: netosVacios() }] });
  };
  const hayLibres = opciones.some((o) => !usadas.has(clave(o.desde, o.hasta)));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={lbl} htmlFor="hotel-nombre">Hotel</label>
          <Input id="hotel-nombre" value={h.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Nombre del hotel" aria-invalid={nombreRepetido || undefined} />
          {nombreRepetido && <p className="mt-0.5 text-[11px] text-red-600">Ya hay otro hotel con este nombre: usa uno distinto.</p>}
        </div>
        <div><label className={lbl} htmlFor="hotel-zona">Zona</label><Input id="hotel-zona" value={h.zona} onChange={(e) => set({ zona: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className={lbl} htmlFor="hotel-tipo">Tipo de habitación</label><Input id="hotel-tipo" value={h.tipoHabitacion} onChange={(e) => set({ tipoHabitacion: e.target.value })} /></div>
        <div>
          <label className={lbl} htmlFor="hotel-maxpax">Máx. personas por habitación</label>
          <Input id="hotel-maxpax" inputMode="numeric" value={h.maxPax} onChange={(e) => set({ maxPax: e.target.value })} placeholder="Sin tope" />
        </div>
        <div>
          <label className={lbl} htmlFor="hotel-maxmen">Máx. menores por habitación</label>
          <Input id="hotel-maxmen" inputMode="numeric" value={h.maxMenores} onChange={(e) => set({ maxMenores: e.target.value })} placeholder="Sin tope" />
        </div>
        <div className="sm:col-span-3">
          <label className={lbl} htmlFor="hotel-prov">Proveedor del hotel (noches adicionales)</label>
          <select id="hotel-prov" className={sel} value={h.proveedorId ?? ""} onChange={(e) => set({ proveedorId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">El mismo proveedor del programa</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Acomodaciones que se cotizan: {claves.filter((k) => k !== "nino").map((k) => ETIQUETA_ACOM[k]).join(", ") || "ninguna"}
        {claves.includes("nino") ? " y tarifa de menor" : "; este hotel no admite menores, no se pide tarifa de menor"}.
      </p>

      {conflictos.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Resuelve estos conflictos para poder guardar:</p>
          <ul className="list-disc space-y-0.5 pl-5">{conflictos.map((c) => <li key={c}>{c}</li>)}</ul>
          {incompatibles.length > 0 && (
            <button type="button" onClick={() => onChange(quitarIncompatibles(h))} className="rounded border border-amber-400 bg-white px-2 py-1 font-medium hover:bg-amber-100">
              Quitar las tarifas que el hotel no admite
            </button>
          )}
        </div>
      )}

      {/* Precio base */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Precio base · neto por persona, estancia incluida</h3>
        <div className="space-y-2">
          {h.base.map((b, r) => (
            <div key={r} className="rounded-lg border border-gray-100 bg-gray-50 p-3" aria-label={`Vigencia base ${r + 1} de ${h.nombre || "hotel"}`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div><label className={lbl}>Entrada desde</label><DateInput aria-label="Entrada desde" type="date" value={b.desde} onValueChange={(x) => setBase(r, { desde: x })} /></div>
                <div><label className={lbl}>Entrada hasta</label><DateInput aria-label="Entrada hasta" type="date" value={b.hasta} onValueChange={(x) => setBase(r, { hasta: x })} /></div>
                <div>
                  <label className={lbl}>Servicios</label>
                  <select className={sel} value={b.modalidad} onChange={(e) => setBase(r, { modalidad: e.target.value })}>
                    <option value="">Elige…</option>
                    {MODALIDADES_SERVICIOS.map((m) => <option key={m} value={m}>{ETIQUETA_MODALIDAD[m]}</option>)}
                  </select>
                </div>
                <label className="mt-6 flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={b.bajoSolicitud} onChange={(e) => setBase(r, { bajoSolicitud: e.target.checked })} /> A solicitud
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {claves.map((k) => (
                  <div key={k}>
                    <label className={lbl}>{ETIQUETA_ACOM[k]}</label>
                    <Input inputMode="decimal" value={b.neto[k]} onChange={(e) => setBase(r, { neto: { ...b.neto, [k]: e.target.value } })} />
                    <div className="mt-0.5 text-[11px] text-gray-400">{pvpBase(b, k) != null ? `PVP ${formatMoneda(pvpBase(b, k)!, moneda)}` : "—"}</div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => set({ base: h.base.filter((_, j) => j !== r) })} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500">
                <Trash2 size={14} aria-hidden="true" /> Quitar vigencia
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set({ base: [...h.base, { desde: "", hasta: "", modalidad: "", bajoSolicitud: false, neto: netosVacios() }] })} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#1D7C9A] hover:underline">
          <Plus size={14} aria-hidden="true" /> Agregar vigencia de precio base
        </button>
      </div>

      {/* Noche adicional ligada a una vigencia base */}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">Noche adicional · tarifa neta ligada a una vigencia base</h3>
        <p className="mb-2 text-xs text-gray-500">
          Elige una vigencia base ya creada; no se escriben fechas. Privados y regulares con las mismas fechas son una sola opción y comparten la tarifa de noche.
          Cada noche extra usa la tarifa de la vigencia que cubre su propia fecha.
        </p>
        {conflictosBase.length > 0 && <p className="mb-2 text-xs text-amber-800">Corrige las vigencias base (arriba) para poder ligar noches adicionales.</p>}
        {opciones.length === 0 && h.noches.length === 0 && <p className="mb-2 text-xs text-gray-500">Primero carga al menos una vigencia base con fechas y modalidad.</p>}
        <div className="space-y-2">
          {h.noches.map((t, r) => {
            const k0 = clave(t.desde, t.hasta);
            const existe = opciones.some((o) => clave(o.desde, o.hasta) === k0);
            return (
              <div key={r} className="rounded-lg border border-gray-100 bg-gray-50 p-3" aria-label={`Vigencia de noche adicional ${r + 1} de ${h.nombre || "hotel"}`}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className={lbl}>Vigencia base</label>
                    <select
                      className={sel}
                      aria-label="Vigencia base de la noche"
                      value={k0 === "|" ? "" : k0}
                      onChange={(e) => { const [d, hh] = e.target.value.split("|"); setNoche(r, { desde: d ?? "", hasta: hh ?? "" }); }}
                    >
                      <option value="">Elige una vigencia base…</option>
                      {!existe && k0 !== "|" && <option value={k0}>Vigencia que ya no existe: {fechaLegible(t.desde)}–{fechaLegible(t.hasta)}</option>}
                      {opciones.map((o) => {
                        const kk = clave(o.desde, o.hasta);
                        const ocupada = usadas.has(kk) && kk !== k0;
                        return (
                          <option key={kk} value={kk} disabled={ocupada}>
                            {fechaLegible(o.desde)}–{fechaLegible(o.hasta)} · {o.modalidades.length === 2 ? "Privados y regulares" : ETIQUETA_MODALIDAD[o.modalidades[0]]}{ocupada ? " (ya tiene tarifa)" : ""}
                          </option>
                        );
                      })}
                    </select>
                    {!existe && k0 !== "|" && <p className="mt-0.5 text-[11px] text-red-600">Esta tarifa quedó sin vigencia base: elige otra o quítala.</p>}
                  </div>
                  <div>
                    <label className={lbl}>El proveedor cobra la noche</label>
                    <select className={sel} value={t.unidad} onChange={(e) => setNoche(r, { unidad: e.target.value })}>
                      <option value="">Elige la unidad de cobro…</option>
                      {UNIDADES_COBRO.map((u) => <option key={u} value={u}>{ETIQUETA_UNIDAD[u]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {claves.map((k) =>
                    k === "nino" && t.unidad === "habitacion" ? (
                      // Por habitación el menor ocupante va incluido: sin suplemento hotelero y sin tarifa de menor (solo paga su asistencia).
                      <div key={k}>
                        <label className={lbl}>Menor</label>
                        <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500">Incluido en la habitación</div>
                      </div>
                    ) : (
                      <div key={k}>
                        <label className={lbl}>{k === "nino" ? "Menor (por persona)" : ETIQUETA_ACOM[k]}</label>
                        <Input inputMode="decimal" value={t.neto[k]} onChange={(e) => setNoche(r, { neto: { ...t.neto, [k]: e.target.value } })} />
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          {pvpNoche(t, k) != null ? `PVP ${formatMoneda(pvpNoche(t, k)!, moneda)} ${k === "nino" || t.unidad === "persona" ? "por persona" : "por habitación"}` : "—"}
                        </div>
                      </div>
                    ),
                  )}
                </div>
                <button type="button" onClick={() => set({ noches: h.noches.filter((_, j) => j !== r) })} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500">
                  <Trash2 size={14} aria-hidden="true" /> Quitar tarifa de noche
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={agregarNoche}
          disabled={!hayLibres || conflictosBase.length > 0}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#1D7C9A] hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
        >
          <Plus size={14} aria-hidden="true" /> Agregar tarifa de noche adicional
        </button>
        {opciones.length > 0 && !hayLibres && <p className="mt-1 text-[11px] text-gray-400">Todas las vigencias base ya tienen su tarifa de noche.</p>}
      </div>
    </div>
  );
}
