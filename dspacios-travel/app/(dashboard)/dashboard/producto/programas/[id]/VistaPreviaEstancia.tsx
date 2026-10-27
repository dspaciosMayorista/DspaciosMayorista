"use client";

// PR #409 — Vista previa / calculadora de SOLO LECTURA dentro del editor de Programas.
// Calcula con el catálogo que hay en pantalla (también un borrador sin guardar ni publicar) usando la acción de servidor
// `calcularVistaPreviaPrograma`, que a su vez usa el motor de la reserva. Calcular NO crea cotización, contrato, CxP ni
// publicación. Los costos (netos) solo llegan para quien edita el producto.
import { useMemo, useState, useTransition } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/DateInput";
import { formatMoneda } from "@/lib/utils";
import {
  ACOMODACIONES_ADULTO,
  ETIQUETA_ACOM,
  ETIQUETA_MODALIDAD,
  ETIQUETA_UNIDAD,
  MAX_NOCHES_ADICIONALES,
  MODALIDADES_SERVICIOS,
  claveCompatible,
  fechaLegible,
  type DiaItinerario,
} from "@/lib/programas/estanciaHotel88";
import type { VistaPrevia } from "@/lib/programas/vistaPrevia409";
import { calcularVistaPreviaPrograma } from "../actions";
import { aPayload, paraValidar, type HotelState } from "./hotelEstado";
import { FormulaPasos } from "./FormulaPasos";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const entero = (s: string) => Math.max(0, Math.trunc(Number(s) || 0));

export function VistaPreviaEstancia({
  programaId, hoteles, hotelInicial = 0, dias, moneda,
}: {
  programaId: number;
  /** Catálogo en pantalla (guardado o borrador). */
  hoteles: HotelState[];
  hotelInicial?: number;
  /** Itinerario en pantalla (borrador); si falta, el servidor lee el guardado. */
  dias?: DiaItinerario[];
  moneda: string;
}) {
  const [hotelIndex, setHotelIndex] = useState(Math.min(hotelInicial, Math.max(hoteles.length - 1, 0)));
  const [modalidad, setModalidad] = useState<string>("privado");
  const [fecha, setFecha] = useState("");
  const [habs, setHabs] = useState<Record<string, string>>({ doble: "1" });
  const [ninos, setNinos] = useState("0");
  const [infantes, setInfantes] = useState("0");
  const [noches, setNoches] = useState("0");
  const [res, setRes] = useState<VistaPrevia | null>(null);
  const [pending, start] = useTransition();

  const hotel = hoteles[hotelIndex];
  const ocup = useMemo(() => (hotel ? paraValidar(hotel) : null), [hotel]);
  const acomodaciones = ACOMODACIONES_ADULTO.filter((a) => (ocup ? claveCompatible(ocup, a) : true));
  const admiteMenores = ocup ? claveCompatible(ocup, "nino") : true;

  function calcular() {
    if (!hotel) return;
    const habitaciones: Record<string, number> = {};
    for (const a of acomodaciones) if (entero(habs[a] ?? "") > 0) habitaciones[a] = entero(habs[a]);
    start(async () => {
      setRes(
        await calcularVistaPreviaPrograma(
          programaId,
          hoteles.map(aPayload),
          { hotelIndex, modalidad, fechaEntrada: fecha, nochesAdicionales: entero(noches), habitaciones, ninos: admiteMenores ? entero(ninos) : 0, infantes: entero(infantes) },
          dias,
        ),
      );
    });
  }

  if (!hoteles.length) return <p className="text-sm text-gray-500">Agrega un hotel para poder previsualizar su precio.</p>;

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4" aria-label="Vista previa del precio">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Calculator size={16} aria-hidden="true" /> Vista previa del precio</h3>
        <p className="text-xs text-gray-500">
          Solo lectura: calcula con el catálogo que ves ahora (aunque no esté guardado ni publicado) y con las mismas reglas de la reserva.
          No crea cotización, contrato, cuenta por pagar ni publicación.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={lbl} htmlFor={`vp-hotel-${programaId}`}>Hotel</label>
          <select id={`vp-hotel-${programaId}`} className={sel} value={hotelIndex} onChange={(e) => { setHotelIndex(Number(e.target.value)); setRes(null); }}>
            {hoteles.map((h, i) => <option key={i} value={i}>{h.nombre.trim() || `Hotel ${i + 1}`}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor={`vp-mod-${programaId}`}>Servicios</label>
          <select id={`vp-mod-${programaId}`} className={sel} value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
            {MODALIDADES_SERVICIOS.map((m) => <option key={m} value={m}>{ETIQUETA_MODALIDAD[m]}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Fecha de entrada</label>
          <DateInput aria-label="Fecha de entrada" type="date" value={fecha} onValueChange={setFecha} />
        </div>
        <div>
          <label className={lbl} htmlFor={`vp-noches-${programaId}`}>Noches adicionales (0–{MAX_NOCHES_ADICIONALES})</label>
          <Input id={`vp-noches-${programaId}`} inputMode="numeric" value={noches} onChange={(e) => setNoches(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {acomodaciones.map((a) => (
          <div key={a}>
            <label className={lbl} htmlFor={`vp-${a}-${programaId}`}>Hab. {ETIQUETA_ACOM[a]}</label>
            <Input id={`vp-${a}-${programaId}`} inputMode="numeric" value={habs[a] ?? ""} onChange={(e) => setHabs((p) => ({ ...p, [a]: e.target.value }))} placeholder="0" />
          </div>
        ))}
        {admiteMenores && (
          <div>
            <label className={lbl} htmlFor={`vp-ninos-${programaId}`}>Menores</label>
            <Input id={`vp-ninos-${programaId}`} inputMode="numeric" value={ninos} onChange={(e) => setNinos(e.target.value)} />
          </div>
        )}
        <div>
          <label className={lbl} htmlFor={`vp-inf-${programaId}`}>Infantes</label>
          <Input id={`vp-inf-${programaId}`} inputMode="numeric" value={infantes} onChange={(e) => setInfantes(e.target.value)} />
        </div>
      </div>
      {!admiteMenores && <p className="text-xs text-gray-500">Este hotel no admite menores por habitación: no se pide tarifa de menor.</p>}

      <Button type="button" disabled={pending} onClick={calcular} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Calculando…" : "Calcular vista previa"}
      </Button>

      {res && !res.ok && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No se puede calcular: {res.causa}</p>
      )}

      {res?.ok && <ResultadoVistaPrevia res={res} />}
    </section>
  );
}

/** Resultado de una vista previa exitosa (separado para poder revisarlo con datos fijos). */
export function ResultadoVistaPrevia({ res }: { res: Extract<VistaPrevia, { ok: true }> }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="grid grid-cols-1 gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-2">
        <p><strong>Vigencia aplicada (precio base):</strong> {fechaLegible(res.vigenciaBase.desde)}–{fechaLegible(res.vigenciaBase.hasta)} · {ETIQUETA_MODALIDAD[res.vigenciaBase.modalidad]}</p>
        <p><strong>Markup (MK):</strong> {res.parametros.mk}% · <strong>Fee bancario:</strong> {res.parametros.fee}%</p>
        <p><strong>Asistencia:</strong> {formatMoneda(res.parametros.asistenciaDia, res.moneda)} por persona y día × {res.asistencia.dias ?? "?"} día(s) × {res.asistencia.pax} persona(s) que pagan (los infantes no pagan)</p>
        <p><strong>Redondeo:</strong> {res.parametros.redondeo}; en noches adicionales se redondea cada noche y luego se suma.</p>
      </div>

      <section aria-label="Estancia incluida">
        <h4 className="pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Estancia incluida · PVP por persona</h4>
        <ul>
          {[...res.base.lineas, ...(res.base.ninos ? [res.base.ninos] : [])].map((l) => (
            <li key={l.acomodacion} className="border-b border-gray-50 py-1.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-gray-700">{l.acomodacion === "nino" ? `${l.cantidad} menor(es)` : `${l.cantidad} hab. ${ETIQUETA_ACOM[l.acomodacion]}`}</span>
                <span className="tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatMoneda(l.pvpUnit, res.moneda)}</span>
              </div>
              {l.desglose && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-[#1D7C9A]">Ver fórmula</summary>
                  <div className="mt-1"><FormulaPasos desglose={l.desglose} moneda={res.moneda} /></div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {res.noches.length > 0 && (
        <section aria-label="Noches adicionales">
          <h4 className="pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Noches adicionales · cada noche con la tarifa de su fecha</h4>
          <ul>
            {res.noches.map((n) => (
              <li key={n.fecha} className="border-b border-gray-50 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-gray-700">
                    {fechaLegible(n.fecha)}
                    <span className="block text-[11px] text-gray-400">vigencia {fechaLegible(n.vigenciaDesde)}–{fechaLegible(n.vigenciaHasta)} · {ETIQUETA_UNIDAD[n.unidad]}</span>
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatMoneda(n.pvp, res.moneda)}</span>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-gray-600">
                  {n.lineas.map((l) => (
                    <div key={l.acomodacion}>
                      {l.acomodacion === "nino" ? (l.incluidoEnHabitacion ? `${l.cantidad} menor(es) incluidos (solo asistencia)` : `${l.cantidad} menor(es)`) : `${l.cantidad} × ${ETIQUETA_ACOM[l.acomodacion]}`}: {formatMoneda(l.pvpUnit, res.moneda)}
                      {l.desglose && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-[#1D7C9A]">Ver fórmula</summary>
                          <div className="mt-1"><FormulaPasos desglose={l.desglose} moneda={res.moneda} /></div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-gray-50 p-3"><dt className="text-xs text-gray-500">Estancia incluida</dt><dd className="tabular-nums">{formatMoneda(res.base.total, res.moneda)}</dd></div>
        <div className="rounded-lg bg-gray-50 p-3"><dt className="text-xs text-gray-500">Noches adicionales</dt><dd className="tabular-nums">{formatMoneda(res.totalNoches, res.moneda)}</dd></div>
        <div className="rounded-lg p-3 text-white" style={{ backgroundColor: "var(--brand-primary)" }}><dt className="text-xs opacity-80">Total PVP</dt><dd className="font-semibold tabular-nums">{formatMoneda(res.total, res.moneda)}</dd></div>
      </dl>

      {res.netos && (
        <div className="rounded-lg border border-dashed border-gray-300 p-3 text-xs text-gray-600" aria-label="Costos del proveedor">
          <p className="mb-1 font-medium text-gray-700">Costos del proveedor (solo personal autorizado)</p>
          <p>Neto del proveedor: {formatMoneda(res.netos.costoNeto, res.moneda)} (de ello, noches adicionales {formatMoneda(res.netos.costoNetoNoches, res.moneda)}) · Asistencia: {formatMoneda(res.netos.costoAsistencia, res.moneda)}</p>
        </div>
      )}

      {res.itinerario && (
        <div aria-label="Itinerario con noches adicionales">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Itinerario{res.itinerario.recogida ? ` · recogida el ${fechaLegible(res.itinerario.recogida)}` : ""}</p>
          <ul className="space-y-1 text-sm">
            {res.itinerario.dias.map((d, i, arr) => (
              <li key={`${d.dia}-${i}`} className="flex flex-wrap items-baseline gap-2 border-b border-gray-50 py-1">
                <span className="w-14 text-xs text-gray-400">Día {d.dia}</span>
                <span className="text-gray-700">{d.titulo || "Sin título"}</span>
                {d.libre && <span className="rounded-full bg-amber-50 px-2 text-[11px] text-amber-700">Día libre agregado</span>}
                {i === arr.length - 1 && <span className="rounded-full bg-blue-50 px-2 text-[11px] text-blue-700">Recogida</span>}
                {d.fecha && <span className="ml-auto text-xs text-gray-400">{fechaLegible(d.fecha)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
