"use client";

// #102 — Vista tabla, resultados del buscador EXTERNO (fechas + habitaciones + adultos + menores con edad).
//
// Pinta lo que devolvió `buscarHoteles` (el MISMO motor de Vista Booking, una sola llamada para todo el destino):
// nunca consulta ni calcula un hotel por su cuenta. Dos secciones separadas, cada una con su base de precio:
//   1) La ESTADÍA elegida (N noches, fechas exactas): tarifa de adulto, de cada menor y total de la reserva.
//   2) UNA noche adicional (la noche del día de regreso): total(N+1) − total(N) con los mismos datos; si esa noche
//      no tiene tarifa o cambia la composición, se dice por qué — nunca un promedio ni un valor universal.
//      O4: es un valor de REFERENCIA. Nunca se suma a un total anterior ni se reserva: el total real sale de repetir la búsqueda con el regreso
//      extendido (misma composición y filtros) y recalcular la estadía COMPLETA en el servidor.
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { EtiquetaDescuentoHotel } from "@/components/cotizacion/EtiquetaDescuentoHotel";
import { EtiquetaPromocionHotel } from "@/components/cotizacion/EtiquetaPromocionHotel";
import { CargosMenoresUnidad } from "./CargosMenoresUnidad";
import { DesgloseUnidad } from "./DesgloseUnidad";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { ACOM_ROOM_LABEL } from "@/lib/acomodaciones";
import { formatMoneda } from "@/lib/utils";
import type { LineaDesglose } from "@/lib/reservar/asignacionHabitacionesBusqueda";
import type { BusquedaResultado, ComboBusqueda } from "@/lib/reservar/cotizar";
import type { AlojamientoUnidadDisponible, EstadoBusquedaPorcion } from "./BuscadorBooking";
import { etiquetaLinea, NotaNinoGratis } from "./desgloseTarifas";

function fmtFecha(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

/** Líneas de adulto, de menores y de servicios por grupo de un desglose (puro). */
export function separarDesglose(desglose?: LineaDesglose[]): { adultos: LineaDesglose[]; menores: LineaDesglose[]; otros: LineaDesglose[] } {
  const l = desglose ?? [];
  return {
    adultos: l.filter((x) => x.clase === "adulto"),
    menores: l.filter((x) => x.clase === "infante" || x.clase === "nino" || x.clase === "nino2"),
    otros: l.filter((x) => x.clase === "servicio_grupo"),
  };
}

function LineasPorPersona({ lineas, moneda, vacio = "—" }: { lineas: LineaDesglose[]; moneda: string; vacio?: string }) {
  if (!lineas.length) return <span className="text-slate-300">{vacio}</span>;
  return (
    <ul className="space-y-0.5">
      {lineas.map((l, i) => (
        <li key={i}>
          <div className="flex items-baseline justify-end gap-x-2 whitespace-nowrap sm:justify-between">
            <span className="text-[11px] text-slate-500">{etiquetaLinea(l)}</span>
            <span className="tabular-nums font-medium" style={{ color: "var(--brand-primary)" }}>{formatMoneda(l.tarifa, moneda)}</span>
          </div>
          <NotaNinoGratis l={l} moneda={moneda} className="sm:text-right" conPasajero={false} />
        </li>
      ))}
    </ul>
  );
}

type OpcionUnidad = AlojamientoUnidadDisponible["opciones"][number];
type FilaUnidad = { o: OpcionUnidad; clave: string; primera: boolean };

/** Noches entre dos fechas ISO (UTC, sin corrimientos por zona horaria). */
export function nochesEntreISO(ida: string, regreso: string): number {
  return Math.round((Date.parse(`${regreso}T00:00:00Z`) - Date.parse(`${ida}T00:00:00Z`)) / 86_400_000);
}

/**
 * Habitaciones y viajeros que el servidor CONFIRMÓ para un alojamiento por unidad (puro). Es el reparto de la consulta (el que pasó capacidad y edades del hotel),
 * no una tarifa por persona: un hotel por unidad cobra por habitación y nunca se reparte el total entre personas.
 */
export function textoOcupacionUnidad(o: Pick<OpcionUnidad, "ocupacion">): string {
  const porAcom = new Map<string, number>();
  let adultos = 0, menores = 0;
  const edades: number[] = [];
  for (const h of o.ocupacion) {
    porAcom.set(h.acom, (porAcom.get(h.acom) ?? 0) + 1);
    adultos += h.adultos; menores += h.edadesMenores.length; edades.push(...h.edadesMenores);
  }
  const habs = [...porAcom].map(([a, n]) => `${n} hab ${ACOM_ROOM_LABEL[a as keyof typeof ACOM_ROOM_LABEL] ?? a}`).join(" + ");
  const men = menores ? ` + ${menores} menor${menores === 1 ? "" : "es"} (${edades.sort((x, y) => x - y).join(", ")} años)` : "";
  return `${habs} · ${adultos} adulto${adultos === 1 ? "" : "s"}${men}`;
}

type Fila = { r: BusquedaResultado; c: ComboBusqueda; clave: string; primera: boolean };

/** Suma un día a una fecha ISO (yyyy-mm-dd) en UTC: sin corrimientos por zona horaria. */
export function sumarUnDiaISO(fechaISO: string): string {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Pedido de extender el regreso: misma ida, regreso + 1 día (la noche adicional se vuelve parte de la estadía y se recalcula COMPLETA). */
export type ExtensionRegreso = { fechaIda: string; fechaRegreso: string; noches: number };

export function TablaResultadosBusqueda({
  estado, q = "", fCat = "", fReg = "", puedeReservar = false, hotelExtras, onExtenderRegreso, extendiendo = false,
}: {
  estado: EstadoBusquedaPorcion;
  /** O4: extiende el regreso 1 noche y repite la búsqueda COMPLETA (mismos viajeros y filtros). Ausente = sin botón. */
  onExtenderRegreso?: (e: ExtensionRegreso) => void;
  /** Hay una búsqueda en curso: el botón queda deshabilitado (una sola solicitud por clic). */
  extendiendo?: boolean;
  /** Mismos filtros generales de la Vista tabla (hotel / categoría / alimentación) aplicados sobre los resultados. */
  q?: string; fCat?: string; fReg?: string;
  puedeReservar?: boolean;
  /** Badges del hotel (categoría, Adults Only, mascotas, edades) que arma `TarifarioPublic`. */
  hotelExtras?: (hotelId: number) => ReactNode;
}) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const filas = useMemo<Fila[]>(() => {
    const out: Fila[] = [];
    for (const r of estado.resultados) {
      const hay = `${r.hotelNombre ?? ""} ${r.paqueteNombre ?? ""}`.toLowerCase();
      if (q.trim() && !hay.includes(q.trim().toLowerCase())) continue;
      const combos = r.combos.filter((c) => (!fCat || c.categoria === fCat) && (!fReg || c.regimen === fReg));
      combos.forEach((c, i) => out.push({ r, c, clave: `${r.hotelId}-${r.paqueteId}-${c.categoria}-${c.regimen}`, primera: i === 0 }));
    }
    return out;
  }, [estado.resultados, q, fCat, fReg]);

  const unidadFilas = useMemo<FilaUnidad[]>(() => {
    const out: FilaUnidad[] = [];
    for (const u of estado.unidad) {
      const ops = u.opciones.filter((o) => (!q.trim() || `${o.hotelNombre} ${o.paqueteNombre}`.toLowerCase().includes(q.trim().toLowerCase())) && (!fCat || o.categoria === fCat) && (!fReg || o.alimentacion === fReg));
      ops.forEach((o, i) => out.push({ o, clave: `u-${o.hotelId}-${o.paqueteId}-${o.categoria}-${o.alimentacion}`, primera: i === 0 }));
    }
    return out;
  }, [estado.unidad, q, fCat, fReg]);

  const noches = estado.resultados[0]?.noches ?? nochesEntreISO(estado.fechaIda, estado.fechaRegreso);
  const monedaDe = (r: BusquedaResultado) => r.moneda || "COP";
  const ocup = estado.ocupacion;
  const menoresTxt = ocup.edadesMenores.length
    ? `${ocup.edadesMenores.length} menor${ocup.edadesMenores.length === 1 ? "" : "es"} (${[...ocup.edadesMenores].sort((a, b) => a - b).join(", ")} años)`
    : "sin menores";

  // Con 3+ categorías/alimentaciones por hotel se muestran las más baratas y el resto se despliega (mismo criterio que la matriz).
  const claveHotel = (f: Fila) => `${f.r.hotelId}-${f.r.paqueteId}`;
  const porHotel = useMemo(() => {
    const m = new Map<string, Fila[]>();
    for (const f of filas) { const a = m.get(claveHotel(f)) ?? []; a.push(f); m.set(claveHotel(f), a); }
    return m;
  }, [filas]);
  const visibles = filas.filter((f) => abiertos.has(claveHotel(f)) || (porHotel.get(claveHotel(f))?.indexOf(f) ?? 0) < 2);
  const ocultasDe = (f: Fila) => Math.max(0, (porHotel.get(claveHotel(f))?.length ?? 0) - 2);
  const alternar = (k: string) => setAbiertos((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  if (!estado.resultados.length && !estado.unidad.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500" data-testid="tabla-sin-resultados">
        {estado.diagnostico ?? "No hay hoteles con tarifa para esas fechas y esa ocupación."}
      </div>
    );
  }
  if (!filas.length && !unidadFilas.length) return <p className="py-8 text-center text-sm text-gray-400">Ningún resultado coincide con los filtros aplicados.</p>;

  const encabezado = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400";
  const celda = "px-3 py-2.5 align-top";

  const hotelCelda = (f: Fila) => (
    <td className={`${celda} min-w-0`} data-label="">
      <span className={f.primera ? "font-semibold text-slate-800" : "font-medium text-slate-600"}>{f.r.hotelNombre}</span>
      {f.primera && hotelExtras?.(f.r.hotelId)}
      {f.r.paqueteNombre && <span className="block text-[11px] font-normal text-slate-400">{f.r.paqueteNombre}</span>}
      {puedeReservar && f.primera && (
        <Link href={`/dashboard/reservar/nuevo?paquete=${f.r.paqueteId}&hotel=${f.r.hotelId}&modulo=porcion_terrestre`} className="mt-0.5 block text-xs font-normal" style={{ color: "var(--brand-accent)" }}>
          Reservar →
        </Link>
      )}
    </td>
  );

  const verMas = (f: Fila, colSpan: number) => {
    const o = ocultasDe(f);
    const k = claveHotel(f);
    const ultima = (porHotel.get(k) ?? [])[(abiertos.has(k) ? (porHotel.get(k)?.length ?? 1) : 2) - 1] === f;
    if (!o || !ultima) return null;
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 pb-2 pt-0.5">
          <button type="button" onClick={() => alternar(k)} className="text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
            {abiertos.has(k) ? "Ver menos" : `Ver ${o} opción${o > 1 ? "es" : ""} más de ${f.r.hotelNombre} →`}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6" data-testid="tabla-resultados-busqueda">
      <p className="text-xs text-slate-500">
        Ocupación evaluada: <b className="text-slate-700">{ocup.numHabitaciones} habitación{ocup.numHabitaciones === 1 ? "" : "es"}</b>, <b className="text-slate-700">{ocup.adultos} adulto{ocup.adultos === 1 ? "" : "s"}</b> y {menoresTxt}. Cada hotel reparte las habitaciones y clasifica las edades con su propia configuración.
      </p>

      {/* ── 1) Estadía elegida ─────────────────────────────────────────── */}
      {filas.length > 0 && (<>
      <section aria-labelledby="sec-estadia">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3 id="sec-estadia" className="text-sm font-bold text-slate-800">Estadía de {noches} noche{noches === 1 ? "" : "s"}</h3>
          <span className="text-xs text-slate-500">{fmtFecha(estado.fechaIda)} → {fmtFecha(estado.fechaRegreso)}</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Tarifa por persona para toda la estadía</span>
        </div>
        <ResponsiveTableShell minWidth={860} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] table-fixed text-sm">
            <colgroup><col className="w-[22%]" /><col className="w-[12%]" /><col className="w-[9%]" /><col className="w-[17%]" /><col className="w-[22%]" /><col className="w-[18%]" /></colgroup>
            <thead className="bg-gray-50">
              <tr><th className={encabezado}>Hotel</th><th className={encabezado}>Categoría</th><th className={encabezado}>Alimentación</th><th className={`${encabezado} text-right`}>Adulto</th><th className={`${encabezado} text-right`}>Menores</th><th className={`${encabezado} text-right`}>Total de la reserva</th></tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const d = separarDesglose(f.c.desglose);
                const mon = monedaDe(f.r);
                return (
                  <Fragment key={f.clave}>
                    <tr className={`border-t ${f.primera ? "border-gray-200" : "border-gray-100"}`}>
                      {hotelCelda(f)}
                      <td className={`${celda} text-slate-600`} data-label="Categoría">{f.c.categoria}</td>
                      <td className={`${celda} text-slate-600`} data-label="Alimentación">{f.c.regimen}</td>
                      <td className={celda} data-label="Adulto"><LineasPorPersona lineas={d.adultos} moneda={mon} /></td>
                      <td className={celda} data-label="Menores"><LineasPorPersona lineas={d.menores} moneda={mon} vacio="Sin menores" /></td>
                      <td className={`${celda} text-right tabular-nums`} data-label="Total de la reserva">
                        <div>
                        <span className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(f.c.total, mon)}</span>
                        <span className="block text-[10px] text-slate-400">{f.c.resumenHabitaciones ? `${f.c.resumenHabitaciones} · ` : ""}{f.c.pax} pax</span>
                        {!!f.c.edadesComoAdulto?.length && (
                          <span className="block text-[10px] text-amber-700">{f.c.edadesComoAdulto.join(", ")} años: tarifa de adulto en este hotel</span>
                        )}
                        {(f.c.descuento?.etiqueta || f.c.promocion?.etiqueta) && (
                          <span className="mt-1 flex flex-wrap justify-end gap-1" data-testid="etiquetas-oferta">
                            <EtiquetaDescuentoHotel descuento={f.c.descuento} />
                            <EtiquetaPromocionHotel promocion={f.c.promocion} />
                          </span>
                        )}
                        </div>
                      </td>
                    </tr>
                    {verMas(f, 6)}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </ResponsiveTableShell>
      </section>

      </>)}

      {/* ── Alojamientos por unidad: precio de la HABITACIÓN, no por persona ──────────── */}
      {unidadFilas.length > 0 && (
        <section aria-labelledby="sec-unidad" data-testid="tabla-unidad">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h3 id="sec-unidad" className="text-sm font-bold text-slate-800">Alojamientos por unidad · estadía de {noches} noche{noches === 1 ? "" : "s"}</h3>
            <span className="text-xs text-slate-500">{fmtFecha(estado.fechaIda)} → {fmtFecha(estado.fechaRegreso)}</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Precio por habitación, no por persona</span>
          </div>
          <p className="mb-2 text-xs text-slate-500" data-testid="unidad-aviso">
            Estos hoteles cobran por unidad (habitación), así que no hay tarifa de adulto para repartir: se muestra el total de la reserva y las habitaciones que el hotel confirmó con su capacidad y sus edades. Si viaja un menor se aclara debajo de la habitación su edad y si va incluido, tiene un cargo propio (por noche o por toda la estadía, ya incluido en el total) o paga como adulto.
            No se calcula una noche adicional para ellos; para extender la estadía cambia la fecha de regreso y busca de nuevo.
          </p>
          <ResponsiveTableShell minWidth={860} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[860px] table-fixed text-sm">
              <colgroup><col className="w-[24%]" /><col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[32%]" /><col className="w-[18%]" /></colgroup>
              <thead className="bg-gray-50">
                <tr><th className={encabezado}>Hotel</th><th className={encabezado}>Categoría</th><th className={encabezado}>Alimentación</th><th className={encabezado}>Habitaciones y viajeros</th><th className={`${encabezado} text-right`}>Total de la reserva</th></tr>
              </thead>
              <tbody>
                {unidadFilas.filter((f) => abiertos.has(`u-${f.o.hotelId}`) || unidadFilas.filter((x) => x.o.hotelId === f.o.hotelId).indexOf(f) < 2).map((f) => {
                  const delHotel = unidadFilas.filter((x) => x.o.hotelId === f.o.hotelId);
                  const k = `u-${f.o.hotelId}`;
                  const abierto = abiertos.has(k);
                  const ultima = delHotel[(abierto ? delHotel.length : 2) - 1] === f;
                  const ocultas = Math.max(0, delHotel.length - 2);
                  return (
                    <Fragment key={f.clave}>
                      <tr className={`border-t ${f.primera ? "border-gray-200" : "border-gray-100"}`}>
                        <td className={`${celda} min-w-0`} data-label="">
                          <span className={f.primera ? "font-semibold text-slate-800" : "font-medium text-slate-600"}>{f.o.hotelNombre}</span>
                          {f.primera && hotelExtras?.(f.o.hotelId)}
                          {f.o.paqueteNombre && <span className="block text-[11px] font-normal text-slate-400">{f.o.paqueteNombre}</span>}
                        </td>
                        <td className={`${celda} text-slate-600`} data-label="Categoría">{f.o.categoria}</td>
                        <td className={`${celda} text-slate-600`} data-label="Alimentación">{f.o.alimentacion}</td>
                        <td className={`${celda} text-xs text-slate-600`} data-label="Habitaciones y viajeros">{textoOcupacionUnidad(f.o)}<CargosMenoresUnidad menores={f.o.menores} moneda={f.o.moneda} /><DesgloseUnidad precioVenta={f.o.precioVenta} moneda={f.o.moneda} ocupacion={f.o.ocupacion} menores={f.o.menores} /></td>
                        <td className={`${celda} text-right tabular-nums`} data-label="Total de la reserva">
                          <div>
                            <span className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(f.o.precioVenta, f.o.moneda || "COP")}</span>
                            <span className="block text-[10px] text-slate-400">{f.o.paxTotal} pax · por unidad</span>
                          </div>
                        </td>
                      </tr>
                      {ocultas > 0 && ultima && (
                        <tr>
                          <td colSpan={5} className="px-3 pb-2 pt-0.5">
                            <button type="button" onClick={() => alternar(k)} className="text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
                              {abierto ? "Ver menos" : `Ver ${ocultas} opción${ocultas > 1 ? "es" : ""} más de ${f.o.hotelNombre} →`}
                            </button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </ResponsiveTableShell>
        </section>
      )}

      {filas.length > 0 && (<>
      {/* ── 2) Una noche adicional ─────────────────────────────────────── */}
      <section aria-labelledby="sec-noche">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3 id="sec-noche" className="text-sm font-bold text-slate-800">Una noche adicional</h3>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800" data-testid="noche-referencial">Valor referencial</span>
          <span className="text-xs text-slate-500">noche del {fmtFecha(estado.fechaRegreso)} (estadía de {noches + 1} noches)</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Valor de ESA noche, por persona</span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" data-testid="noche-aviso-referencia">
          <p className="min-w-0 flex-1 basis-80">
            <b>Es solo una referencia:</b> no se suma al total de la estadía ni se reserva con este valor. El total final se obtiene recalculando la estadía <b>completa</b> de {noches + 1} noches,
            porque las fechas, la disponibilidad y las promociones pueden cambiarlo.
          </p>
          {onExtenderRegreso && (
            <button
              type="button"
              disabled={extendiendo}
              onClick={() => onExtenderRegreso({ fechaIda: estado.fechaIda, fechaRegreso: sumarUnDiaISO(estado.fechaRegreso), noches: noches + 1 })}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--brand-primary)" }}
              data-testid="extender-regreso"
            >
              <CalendarPlus size={14} aria-hidden="true" />
              Extender el regreso a {fmtFecha(sumarUnDiaISO(estado.fechaRegreso))} y recalcular la estadía completa
            </button>
          )}
        </div>
        <ResponsiveTableShell minWidth={860} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] table-fixed text-sm">
            <colgroup><col className="w-[22%]" /><col className="w-[12%]" /><col className="w-[9%]" /><col className="w-[17%]" /><col className="w-[22%]" /><col className="w-[18%]" /></colgroup>
            <thead className="bg-gray-50">
              <tr><th className={encabezado}>Hotel</th><th className={encabezado}>Categoría</th><th className={encabezado}>Alimentación</th><th className={`${encabezado} text-right`}>Adulto</th><th className={`${encabezado} text-right`}>Menores</th><th className={`${encabezado} text-right`}>Total de la noche</th></tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const n = f.c.nocheAdicional;
                const mon = monedaDe(f.r);
                const d = n?.estado === "ok" ? separarDesglose(n.desglose) : null;
                return (
                  <Fragment key={f.clave}>
                    <tr className={`border-t ${f.primera ? "border-gray-200" : "border-gray-100"}`}>
                      {hotelCelda(f)}
                      <td className={`${celda} text-slate-600`} data-label="Categoría">{f.c.categoria}</td>
                      <td className={`${celda} text-slate-600`} data-label="Alimentación">{f.c.regimen}</td>
                      {n?.estado === "ok" ? (
                        <>
                          <td className={celda} data-label="Adulto">{d ? <LineasPorPersona lineas={d.adultos} moneda={mon} /> : <span className="text-slate-300">—</span>}</td>
                          <td className={celda} data-label="Menores">{d ? <LineasPorPersona lineas={d.menores} moneda={mon} vacio="Sin menores" /> : <span className="text-slate-300">—</span>}</td>
                          <td className={`${celda} text-right tabular-nums`} data-label="Total de la noche">
                            <div>
                            <span className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(n.total, mon)}</span>
                            <span className="block text-[10px] text-slate-400">1 noche · {f.c.pax} pax</span>
                            </div>
                          </td>
                        </>
                      ) : (
                        <td className={`${celda} text-xs text-amber-700`} colSpan={3} data-label="Noche adicional">{n?.motivo ?? "No se calculó el valor de la noche adicional."}</td>
                      )}
                    </tr>
                    {verMas(f, 6)}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </ResponsiveTableShell>
      </section>
      </>)}
      {filas.length > 0 && <p className="text-[11px] text-slate-400">
        Referencia: la noche adicional es la diferencia entre la estadía de {noches + 1} noches y la de {noches}, con la temporada, el grupo de días y las promociones de esa noche. No es un promedio ni una tarifa por noche garantizada: al reservar, el servidor recalcula la estadía completa que pidas.
      </p>}
    </div>
  );
}
