"use client";

// #88 — Captura del catálogo de un programa terrestre por hotel y vigencia:
//   · hoteles (zona, tipo de habitación, ocupación permitida, proveedor propio opcional);
//   · PRECIO BASE: neto por persona para toda la estancia incluida, por vigencia (fecha de
//     ENTRADA) y modalidad de servicios (privados / regulares);
//   · TARIFA DE NOCHE ADICIONAL: neta, por vigencia y acomodación, con la unidad de cobro del
//     proveedor (persona | habitación) que se elige de forma expresa (no hay valor por defecto).
// Cada neto muestra al lado el PVP que verá el cliente, calculado con las MISMAS funciones puras
// de la ficha y de la reserva (precioReserva57 / estanciaHotel88).
import { DateInput } from "@/components/ui/DateInput";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { guardarHoteles, type HotelVigenciaInput } from "../actions";
import { parseNumOrNull } from "@/lib/calc/programaPrecio";
import {
  CLAVES_TARIFA,
  ETIQUETA_ACOM,
  ETIQUETA_MODALIDAD,
  ETIQUETA_UNIDAD,
  MODALIDADES_SERVICIOS,
  UNIDADES_COBRO,
  pvpNocheUnidad,
  vacioPorAcom,
  type ClaveTarifa,
  type PorAcom,
  type UnidadCobro,
} from "@/lib/programas/estanciaHotel88";
import { precioUnitarioSalida, salidaPrecioDesdeBase, type ProgramaPrecioCabecera } from "@/lib/programas/precioReserva57";
import type { CatalogoHoteles88 } from "@/lib/programas/estanciaHotelDatos88";

type Netos = Record<ClaveTarifa, string>;
type BaseState = { desde: string; hasta: string; modalidad: string; bajoSolicitud: boolean; neto: Netos };
type NocheState = { desde: string; hasta: string; unidad: string; neto: Netos };
type HotelState = {
  id: number | null;
  nombre: string;
  zona: string;
  tipoHabitacion: string;
  maxPax: string;
  maxMenores: string;
  proveedorId: number | null;
  base: BaseState[];
  noches: NocheState[];
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const netosVacios = (): Netos => ({ sencilla: "", doble: "", triple: "", multiple: "", nino: "" });
const texto = (v: number | null | undefined) => (v == null ? "" : String(v));
const aTexto = (n: PorAcom): Netos => ({
  sencilla: texto(n.sencilla), doble: texto(n.doble), triple: texto(n.triple), multiple: texto(n.multiple), nino: texto(n.nino),
});
const aPorAcom = (n: Netos): PorAcom => {
  const o = vacioPorAcom();
  for (const k of CLAVES_TARIFA) o[k] = parseNumOrNull(n[k]);
  return o;
};

function desdeCatalogo(c: CatalogoHoteles88): HotelState[] {
  return c.hoteles.map((h) => ({
    id: h.id,
    nombre: h.nombre,
    zona: h.zona ?? "",
    tipoHabitacion: h.tipoHabitacion ?? "",
    maxPax: texto(h.maxPaxHabitacion),
    maxMenores: texto(h.maxMenoresHabitacion),
    proveedorId: h.proveedorId,
    base: c.base.filter((b) => b.hotelId === h.id).map((b) => ({ desde: b.desde, hasta: b.hasta, modalidad: b.modalidad, bajoSolicitud: b.bajoSolicitud, neto: aTexto(b.neto) })),
    noches: c.noches.filter((t) => t.hotelId === h.id).map((t) => ({ desde: t.desde, hasta: t.hasta, unidad: t.unidad, neto: aTexto(t.neto) })),
  }));
}

const hotelNuevo = (): HotelState => ({ id: null, nombre: "", zona: "", tipoHabitacion: "", maxPax: "", maxMenores: "", proveedorId: null, base: [], noches: [] });

export function HotelesVigenciaEditor({
  programaId,
  programa,
  proveedores,
  catalogo,
}: {
  programaId: number;
  programa: ProgramaPrecioCabecera;
  proveedores: { id: number; nombre: string }[];
  catalogo: CatalogoHoteles88;
}) {
  const router = useRouter();
  const [hoteles, setHoteles] = useState<HotelState[]>(() => desdeCatalogo(catalogo));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const moneda = programa.moneda;

  const opt = useMemo(
    () => ({ pctMk: programa.pct_mk, asistenciaDia: programa.asistencia_medica_dia, pctFee: programa.pct_fee_tarjeta, moneda }),
    [programa.pct_mk, programa.asistencia_medica_dia, programa.pct_fee_tarjeta, moneda],
  );

  const setHotel = (i: number, patch: Partial<HotelState>) => setHoteles((p) => p.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const setBase = (i: number, r: number, patch: Partial<BaseState>) =>
    setHotel(i, { base: hoteles[i].base.map((b, j) => (j === r ? { ...b, ...patch } : b)) });
  const setNoche = (i: number, r: number, patch: Partial<NocheState>) =>
    setHotel(i, { noches: hoteles[i].noches.map((t, j) => (j === r ? { ...t, ...patch } : t)) });

  function guardar() {
    setError(null);
    setOk(false);
    start(async () => {
      const payload: HotelVigenciaInput[] = hoteles.map((h) => ({
        id: h.id, nombre: h.nombre, zona: h.zona, tipoHabitacion: h.tipoHabitacion,
        maxPaxHabitacion: h.maxPax, maxMenoresHabitacion: h.maxMenores, proveedorId: h.proveedorId,
        base: h.base.map((b) => ({ desde: b.desde, hasta: b.hasta, modalidad: b.modalidad, bajoSolicitud: b.bajoSolicitud, neto: b.neto })),
        noches: h.noches.map((t) => ({ desde: t.desde, hasta: t.hasta, unidad: t.unidad, neto: t.neto })),
      }));
      const r = await guardarHoteles(programaId, payload);
      if (r.ok) {
        setOk(true);
        router.refresh();
      } else setError(r.error);
    });
  }

  const pvpBase = (b: BaseState, k: ClaveTarifa) =>
    precioUnitarioSalida(programa, salidaPrecioDesdeBase({ bajoSolicitud: b.bajoSolicitud, neto: aPorAcom(b.neto) }), k)?.pvp ?? null;
  const pvpNoche = (t: NocheState, k: ClaveTarifa) => {
    const n = parseNumOrNull(t.neto[k]);
    if (n == null || !(UNIDADES_COBRO as readonly string[]).includes(t.unidad)) return null;
    return pvpNocheUnidad(n, t.unidad as UnidadCobro, k, opt);
  };

  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
        Cada hotel tiene su <strong>precio base</strong> (neto por persona para toda la estancia incluida del programa, por vigencia de la
        fecha de <em>entrada</em> y servicios privados o regulares) y su <strong>tarifa de noche adicional</strong> (por la vigencia de la fecha
        de cada noche). Elige siempre si el proveedor cobra la noche por persona o por habitación. Si la noche se cobra por habitación, los menores
        ocupantes van incluidos (sin suplemento hotelero; solo pagan su asistencia). Si se cobra por persona, cada menor exige su tarifa adicional:
        déjala vacía si el proveedor no la tiene (la reserva con menores no se podrá cotizar) o pon 0 si es gratis.
        El PVP se calcula con las reglas vigentes del programa ({moneda}).
      </p>

      {hoteles.map((h, i) => (
        <section key={h.id ?? `nuevo-${i}`} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4" aria-label={`Hotel ${h.nombre || i + 1}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className={lbl}>Hotel</label>
                <Input value={h.nombre} onChange={(e) => setHotel(i, { nombre: e.target.value })} placeholder="Nombre del hotel" />
              </div>
              <div>
                <label className={lbl}>Zona</label>
                <Input value={h.zona} onChange={(e) => setHotel(i, { zona: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>Tipo de habitación</label>
                <Input value={h.tipoHabitacion} onChange={(e) => setHotel(i, { tipoHabitacion: e.target.value })} />
              </div>
              <div>
                <label className={lbl}>Máx. personas por habitación</label>
                <Input inputMode="numeric" value={h.maxPax} onChange={(e) => setHotel(i, { maxPax: e.target.value })} placeholder="Sin tope" />
              </div>
              <div>
                <label className={lbl}>Máx. menores por habitación</label>
                <Input inputMode="numeric" value={h.maxMenores} onChange={(e) => setHotel(i, { maxMenores: e.target.value })} placeholder="Sin tope" />
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>Proveedor del hotel (noches adicionales)</label>
                <select
                  className={sel}
                  value={h.proveedorId ?? ""}
                  onChange={(e) => setHotel(i, { proveedorId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">El mismo proveedor del programa</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHoteles((p) => p.filter((_, j) => j !== i))}
              className="mt-5 text-gray-400 hover:text-red-500"
              aria-label={`Quitar el hotel ${h.nombre || i + 1}`}
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Precio base */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Precio base · neto por persona, estancia incluida</h3>
            <div className="space-y-2">
              {h.base.map((b, r) => (
                <div key={r} className="rounded-lg border border-gray-100 bg-gray-50 p-3" aria-label={`Vigencia base ${r + 1} de ${h.nombre || "hotel"}`}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div><label className={lbl}>Entrada desde</label><DateInput aria-label="Entrada desde" type="date" value={b.desde} onValueChange={(v) => setBase(i, r, { desde: v })} /></div>
                    <div><label className={lbl}>Entrada hasta</label><DateInput aria-label="Entrada hasta" type="date" value={b.hasta} onValueChange={(v) => setBase(i, r, { hasta: v })} /></div>
                    <div>
                      <label className={lbl}>Servicios</label>
                      <select className={sel} value={b.modalidad} onChange={(e) => setBase(i, r, { modalidad: e.target.value })}>
                        <option value="">Elige…</option>
                        {MODALIDADES_SERVICIOS.map((m) => <option key={m} value={m}>{ETIQUETA_MODALIDAD[m]}</option>)}
                      </select>
                    </div>
                    <label className="mt-6 flex items-center gap-2 text-xs text-gray-600">
                      <input type="checkbox" checked={b.bajoSolicitud} onChange={(e) => setBase(i, r, { bajoSolicitud: e.target.checked })} /> A solicitud
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {CLAVES_TARIFA.map((k) => (
                      <div key={k}>
                        <label className={lbl}>{ETIQUETA_ACOM[k]}</label>
                        <Input inputMode="decimal" value={b.neto[k]} onChange={(e) => setBase(i, r, { neto: { ...b.neto, [k]: e.target.value } })} />
                        <div className="mt-0.5 text-[11px] text-gray-400">{pvpBase(b, k) != null ? `PVP ${formatMoneda(pvpBase(b, k)!, moneda)}` : "—"}</div>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setHotel(i, { base: h.base.filter((_, j) => j !== r) })} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500">
                    <Trash2 size={14} aria-hidden="true" /> Quitar vigencia
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setHotel(i, { base: [...h.base, { desde: "", hasta: "", modalidad: "", bajoSolicitud: false, neto: netosVacios() }] })}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#1D7C9A] hover:underline"
            >
              <Plus size={14} aria-hidden="true" /> Agregar vigencia de precio base
            </button>
          </div>

          {/* Noche adicional */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Noche adicional · tarifa neta por vigencia de la noche</h3>
            <div className="space-y-2">
              {h.noches.map((t, r) => (
                <div key={r} className="rounded-lg border border-gray-100 bg-gray-50 p-3" aria-label={`Vigencia de noche adicional ${r + 1} de ${h.nombre || "hotel"}`}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div><label className={lbl}>Noche desde</label><DateInput aria-label="Noche desde" type="date" value={t.desde} onValueChange={(v) => setNoche(i, r, { desde: v })} /></div>
                    <div><label className={lbl}>Noche hasta</label><DateInput aria-label="Noche hasta" type="date" value={t.hasta} onValueChange={(v) => setNoche(i, r, { hasta: v })} /></div>
                    <div className="sm:col-span-2">
                      <label className={lbl}>El proveedor cobra la noche</label>
                      <select className={sel} value={t.unidad} onChange={(e) => setNoche(i, r, { unidad: e.target.value })}>
                        <option value="">Elige la unidad de cobro…</option>
                        {UNIDADES_COBRO.map((u) => <option key={u} value={u}>{ETIQUETA_UNIDAD[u]}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {CLAVES_TARIFA.map((k) =>
                      k === "nino" && t.unidad === "habitacion" ? (
                        // Por habitación el menor ocupante va incluido: sin suplemento hotelero y sin tarifa de menor (solo paga su asistencia).
                        <div key={k}>
                          <label className={lbl}>Menor</label>
                          <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500">Incluido en la habitación</div>
                        </div>
                      ) : (
                        <div key={k}>
                          <label className={lbl}>{k === "nino" ? "Menor (por persona)" : ETIQUETA_ACOM[k]}</label>
                          <Input inputMode="decimal" value={t.neto[k]} onChange={(e) => setNoche(i, r, { neto: { ...t.neto, [k]: e.target.value } })} />
                          <div className="mt-0.5 text-[11px] text-gray-400">
                            {pvpNoche(t, k) != null ? `PVP ${formatMoneda(pvpNoche(t, k)!, moneda)} ${k === "nino" || t.unidad === "persona" ? "por persona" : "por habitación"}` : "—"}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  <button type="button" onClick={() => setHotel(i, { noches: h.noches.filter((_, j) => j !== r) })} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500">
                    <Trash2 size={14} aria-hidden="true" /> Quitar vigencia
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setHotel(i, { noches: [...h.noches, { desde: "", hasta: "", unidad: "", neto: netosVacios() }] })}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#1D7C9A] hover:underline"
            >
              <Plus size={14} aria-hidden="true" /> Agregar vigencia de noche adicional
            </button>
          </div>
        </section>
      ))}

      <button type="button" onClick={() => setHoteles((p) => [...p, hotelNuevo()])} className="inline-flex items-center gap-1 text-sm font-medium text-[#1D7C9A] hover:underline">
        <Plus size={14} aria-hidden="true" /> Agregar hotel
      </button>

      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={guardar} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        {ok && <span className="text-sm text-green-600">Guardado</span>}
        {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
