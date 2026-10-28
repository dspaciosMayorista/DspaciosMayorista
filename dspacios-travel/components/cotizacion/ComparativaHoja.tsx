// #75 — Hoja imprimible de una cotización COMPARATIVA. Solo presentación (sin hooks ni acciones): la pantalla interactiva
// (`SelectorOpciones`) conserva sus controles y esta hoja es lo que se imprime / se ve en el documento.
//
// Reglas comerciales que esta hoja NO rompe:
//   · cada hotel es una alternativa con SU total; jamás se suman opciones ni hay un total global;
//   · vuelos y servicios adicionales cuelgan de la opción que los incluye y sin importe propio (ya van en el total, una sola vez);
//   · solo se muestra lo que ya trae `resumen_publico` / el snapshot público: sin costos, proveedores, comisión ni términos NETO.
import { GitCompareArrows } from "lucide-react";
import { COLOR_DOCUMENTO } from "@/lib/contrato/colorDocumento";
import { EMPRESA } from "@/lib/contrato/plantilla";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { formatFechaLarga } from "@/lib/utils";
import { formatoExacto } from "@/lib/contrato/repartoTarifa";
import { bloquesCondiciones, condicionesPorOpcion, etiquetaTotalOpcion, resumenDeAcomodacion, tiquetesDeOpcion, type GrupoHotel } from "@/lib/cotizacion/comparativa";
import type { ResumenHotelUI } from "@/lib/cotizacion/comparativaAcciones";
import { ListasIncluye, MenoresOpcion, ServiciosAdicionalesOpcion, TarifaOpcion, TarifaPaqueteOpcion, VuelosOpcion } from "@/components/cotizacion/ListasIncluye";

const PRIMARY = COLOR_DOCUMENTO;

export type MadreHoja = {
  codigo: string; cliente: string | null; destino: string | null; fecha_salida: string | null; fecha_regreso: string | null;
  pax: number | null; moneda: string | null; vigencia_hasta: string | null; created_at: string; tenant: string | null;
};
/** Identidad de la agencia dueña de la cotización, ya ACREDITADA por la ruta (`cargarAgenciaDeCotizacion`; si no se acredita, la ruta falla y no hay hoja). `null` = constantes de Mayorista. */
export type IdentidadHoja = { razon_social?: string | null; nit?: string | null; rnt?: string | null; correo?: string | null } | null;

const etiquetaAcom = (a: string) => (a === "unica" ? "" : (ACOM_ROOM_LABEL[a as AcomRoom] ?? (a === "mixta" ? "Mixta" : a)));

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2 print:py-1">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="block break-words text-sm text-gray-800">{value || "—"}</span>
    </div>
  );
}

export function ComparativaHoja({ madre, grupos, resumenes, vencida, identidad }: {
  madre: MadreHoja; grupos: GrupoHotel[]; resumenes: Record<string, ResumenHotelUI>; vencida: boolean; identidad: IdentidadHoja;
}) {
  const minorista = madre.tenant === "minorista";
  // Defensa del componente: sin dato propio, Minorista nunca hereda las constantes de Mayorista.
  const rnt = identidad?.rnt ?? (minorista ? null : EMPRESA.rnt);
  const nit = identidad?.nit ?? (minorista ? null : EMPRESA.nit);
  const razon = identidad?.razon_social ?? (minorista ? null : EMPRESA.razonSocial);
  const correo = identidad?.correo ?? (minorista ? null : EMPRESA.correo);
  const detalle = (g: GrupoHotel) => resumenes[g.opcionRef] ?? resumenes[`${g.opcionRef}/${g.acomodaciones[0]?.acomodacionRef}`] ?? {};
  // Común = idéntico en TODAS las opciones (se imprime una vez al final); si difiere, cada opción lleva el suyo.
  const { comun, porAcomodacion } = condicionesPorOpcion(grupos, resumenes);

  const tarjeta = (g: GrupoHotel) => {
    const r = detalle(g);
    const items = (r.items ?? []).filter((it) => it.descripcion !== "Tarifa por niño");
    const propios = comun ? [] : bloquesCondiciones(g, porAcomodacion);
    return (
      <article key={g.opcionRef} data-testid={`opcion-${g.opcionRef}`} className="overflow-hidden rounded-xl border border-gray-200">
        <header className="flex items-start gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 print:py-2 break-after-avoid">
          <span className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: PRIMARY }}>Opción {g.opcionRef}</span>
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-gray-900">{g.etiqueta}</h3>
            {r.plan && <p className="text-xs text-gray-500">{r.plan}</p>}
          </div>
        </header>
        <div className="grid grid-cols-1 gap-4 p-4 print:p-3 break-inside-avoid sm:grid-cols-[1fr_16rem]">
          {/* Orden: vuelos (por tiquete), el alojamiento y debajo los servicios adicionales. */}
          <div className="min-w-0 space-y-3 text-xs text-gray-600">
            <VuelosOpcion tiquetes={r.tiquetes ?? tiquetesDeOpcion(null, r.vuelos, null)} />
            {items.length > 0 && <ul className="space-y-1">{items.map((it, i) => <li key={i} className="break-words">{it.descripcion}</li>)}</ul>}
            <ServiciosAdicionalesOpcion servicios={r.servicios} otros={r.otros} />
            {r.otrosNoVerificables && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">No se puede confirmar, desde el registro de esta opción, qué servicios adicionales incluye su total. Genera la comparativa de nuevo para ver el detalle.</p>}
          </div>
          <div className="space-y-3 sm:text-right">
            {g.acomodaciones.map((a) => {
              const ra = resumenDeAcomodacion(resumenes, g.opcionRef, a.acomodacionRef);
              return (
                <div key={a.acomodacionRef} className="space-y-1">
                  {etiquetaAcom(a.acomodacionRef) && <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{etiquetaAcom(a.acomodacionRef)}</p>}
                  {ra.paquete
                    ? <TarifaPaqueteOpcion paquete={ra.paquete} moneda={a.moneda} />
                    : <>
                      <TarifaOpcion tarifa={ra.tarifa} respaldo={{ valor: a.tarifaPersona, conMenores: true }} moneda={a.moneda} />
                      <MenoresOpcion menores={ra.menores} noDesglosables={ra.menoresNoDesglosables} moneda={a.moneda} />
                    </>}
                  <div className="flex items-baseline justify-between gap-3 border-t border-gray-100 pt-1">
                    <span className="text-xs font-medium text-gray-600">{etiquetaTotalOpcion(ra)}</span>
                    <span className="shrink-0 whitespace-nowrap text-lg font-bold tabular-nums" style={{ color: PRIMARY }}>{formatoExacto(a.total, a.moneda)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {propios.map((b) => (
          <div key={b.acomodacionRef ?? "todas"} className="break-inside-avoid border-t border-gray-100 p-4 print:p-3">
            <ListasIncluye incluye={b.inc} noIncluye={b.no} opcion={b.acomodacionRef && etiquetaAcom(b.acomodacionRef) ? `${g.opcionRef} · ${etiquetaAcom(b.acomodacionRef)}` : g.opcionRef} />
          </div>
        ))}
      </article>
    );
  };

  return (
    <div className="contrato-doc mx-auto max-w-3xl bg-white text-gray-800" data-testid="comparativa-hoja">
      <header className="flex flex-col gap-3 rounded-t-xl px-5 py-5 text-white sm:flex-row sm:items-start sm:justify-between sm:gap-4 md:px-8 md:py-6 print:py-3" style={{ backgroundColor: PRIMARY }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={minorista ? "/marca/logo-minorista-white.png" : "/marca/logo-white.png"} alt={minorista ? "Marca de la agencia" : "D'spacios Travel — Mayorista de Turismo"} className="h-12 w-auto self-start print:h-10" />
        <div className="sm:text-center">
          <div className="flex items-center gap-1.5 text-base font-semibold sm:justify-center"><GitCompareArrows size={16} aria-hidden /> COTIZACIÓN COMPARATIVA</div>
          <div className="mt-1 text-xs opacity-90">Cotización #: {madre.codigo}</div>
          {madre.created_at && <div className="text-xs opacity-90">Emisión: {formatFechaLarga(madre.created_at.slice(0, 10))}</div>}
          {madre.fecha_salida && <div className="text-xs opacity-90">Viaje: {formatFechaLarga(madre.fecha_salida)}</div>}
          {madre.vigencia_hasta && <div className="text-xs opacity-90">Válida hasta: {formatFechaLarga(madre.vigencia_hasta)}</div>}
        </div>
        <div className="text-xs opacity-90 sm:text-right">
          {!minorista && <div>{EMPRESA.sitio}</div>}
          {correo && <div className="break-all">{correo}</div>}
          {rnt && <div className="mt-1">RNT {rnt}</div>}
        </div>
      </header>

      <div className={"border-b px-5 py-2 text-center text-xs font-semibold md:px-8 " + (vencida ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
        {vencida
          ? "ESTA COMPARATIVA VENCIÓ — los valores deben revalidarse con un asesor. Si la fecha de salida ya pasó, hay que generar una comparativa nueva."
          : "Cada hotel es una alternativa con su propio total: escoge UNA. Los totales no se suman. Sujeta a disponibilidad."}
      </div>

      <div className="space-y-7 px-5 py-6 text-sm md:px-8 md:py-7 print:space-y-2 print:pt-2 print:pb-0">
        <section>
          <h2 className="mb-2 text-sm font-semibold print:mb-1" style={{ color: PRIMARY }}>Resumen del viaje</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Pill label="Cliente" value={madre.cliente ?? ""} />
            <Pill label="Destino" value={madre.destino ?? ""} />
            <Pill label="Pasajeros" value={madre.pax ? String(madre.pax) : ""} />
            <Pill label="Ida" value={formatFechaLarga(madre.fecha_salida)} />
            <Pill label="Regreso" value={formatFechaLarga(madre.fecha_regreso)} />
            <Pill label="Moneda" value={madre.moneda ?? ""} />
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold" style={{ color: PRIMARY }}>Opciones para comparar</h2>
          <p className="mb-3 text-xs text-gray-500 print:mb-2">{grupos.length} {grupos.length === 1 ? "opción" : "opciones"}. Cada total corresponde únicamente a ese hotel.</p>
          <div className="space-y-4 print:space-y-3">
            {grupos.map(tarjeta)}
            <div className="space-y-4 print:space-y-3">
              {comun && (
                <section className="break-inside-avoid">
                  <h2 className="mb-2 text-sm font-semibold print:mb-1" style={{ color: PRIMARY }}>Incluye / No incluye (todas las opciones)</h2>
                  <ListasIncluye incluye={comun.inc} noIncluye={comun.no} />
                </section>
              )}
              {/* `break-before-avoid`: las condiciones nunca arrancan una hoja solas; se quedan pegadas al último bloque indivisible que las precede. */}
              <section className="break-inside-avoid break-before-avoid" data-testid="condiciones-hoja">
                <h2 className="mb-2 text-sm font-semibold print:mb-1" style={{ color: PRIMARY }}>Condiciones</h2>
                <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-gray-600">
                  <li>Los valores están sujetos a disponibilidad y se revalidan al continuar con una opción.</li>
                  <li>Elegir una opción no genera cobros ni un contrato por sí solo.</li>
                  <li>{madre.vigencia_hasta ? `Esta comparativa es válida hasta el ${formatFechaLarga(madre.vigencia_hasta)}.` : "Esta comparativa no tiene fecha de vigencia registrada."}</li>
                </ul>
              </section>
              {(razon || nit || rnt) && (
                <p className="break-before-avoid border-t border-gray-100 pt-3 text-center text-[11px] text-gray-400 print:pt-1">{[razon, nit && `NIT ${nit}`, rnt && `RNT ${rnt}`].filter(Boolean).join(" · ")}</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
