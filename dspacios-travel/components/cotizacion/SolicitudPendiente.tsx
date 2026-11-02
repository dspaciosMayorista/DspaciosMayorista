import type { ReactNode } from "react";
import { BedDouble, CalendarDays, Clock, Package, Plane } from "lucide-react";
import { TEXTO_BAJO_SOLICITUD } from "@/lib/reservar/solicitudHotel";
import type { ServicioSolicitud, VueloSolicitud } from "@/lib/reservar/solicitudResumen";

// #120 · Resumen del viaje de una solicitud pendiente de tarifa. SOLO datos guardados en la solicitud; NUNCA muestra importes (ni total, ni parciales, ni costos o proveedor),
// ni afirma disponibilidad. Lo que la solicitud no trae no se rellena: la sección o el dato simplemente no aparece.
export type DatosSolicitudHotel = {
  hotelNombre?: string | null; paqueteNombre?: string | null; destino?: string | null; categoria?: string | null; regimen?: string | null;
  habitaciones?: Partial<Record<"sencilla" | "doble" | "triple" | "multiple", number>> | null; menores?: number | null; adultos?: number | null; notas?: string | null;
  fechaIda?: string | null; fechaRegreso?: string | null;
  modulo?: "bloqueo" | "porcion_terrestre" | null; edadesMenores?: number[] | null; vuelo?: VueloSolicitud | null; servicios?: ServicioSolicitud[] | null;
};

const ROTULO: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fecha = (iso?: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ""); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1] ?? ""} ${m[1]}` : null; };
const noches = (a?: string | null, b?: string | null) => { if (!a || !b) return null; const n = Math.round((Date.parse(b) - Date.parse(a)) / 86400000); return Number.isFinite(n) && n > 0 ? n : null; };

function Seccion({ icono, titulo, children, testid }: { icono: ReactNode; titulo: string; children: ReactNode; testid: string }) {
  return (
    <section className="border-t border-gray-100 py-4 first:border-t-0" data-testid={testid}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-primary)]">{icono}{titulo}</h2>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  );
}
const Dato = ({ k, children, ancho }: { k: string; children: ReactNode; ancho?: boolean }) => (
  <div className={ancho ? "sm:col-span-2" : undefined}><dt className="text-xs text-gray-500">{k}</dt><dd className="break-words font-medium text-gray-900">{children}</dd></div>
);

function Tramo({ titulo, vuelo, ida }: { titulo: string; vuelo: VueloSolicitud; ida: boolean }) {
  const f = fecha(ida ? vuelo.fechaIda : vuelo.fechaRegreso);
  const numero = ida ? vuelo.vueloIda : vuelo.vueloRegreso;
  const salida = ida ? vuelo.salidaIda : vuelo.salidaRegreso;
  const llegada = ida ? vuelo.llegadaIda : vuelo.llegadaRegreso;
  if (!f && !numero && !salida && !llegada) return null;
  return (
    <Dato k={titulo}>
      {[f, numero && `vuelo ${numero}`, salida && `sale ${salida}`, llegada && `llega ${llegada}`].filter(Boolean).join(" · ")}
    </Dato>
  );
}

export function SolicitudPendiente({ codigo, datos }: { codigo: string; datos: DatosSolicitudHotel | null }) {
  const ida = fecha(datos?.fechaIda), regreso = fecha(datos?.fechaRegreso);
  const n = noches(datos?.fechaIda, datos?.fechaRegreso);
  const habitaciones = Object.entries(datos?.habitaciones ?? {}).filter(([, c]) => (c ?? 0) > 0).map(([a, c]) => `${c} ${ROTULO[a] ?? a}`);
  const sinSeleccion = datos?.categoria === "A confirmar" && datos?.regimen === "A confirmar";
  const edades = (datos?.edadesMenores ?? []).filter((e) => Number.isInteger(e));
  const vuelo = datos?.vuelo ?? null;
  const servicios = datos?.servicios ?? [];
  const esBloqueo = datos?.modulo === "bloqueo";
  const esPorcion = datos?.modulo === "porcion_terrestre";
  const hayOtros = esBloqueo || esPorcion || servicios.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10" data-testid="solicitud-pendiente">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Resumen de tu solicitud · {codigo}</p>
        <h1 className="mt-1 break-words text-xl font-semibold text-[var(--brand-primary)]">{datos?.hotelNombre ?? "Hotel"}</h1>

        <Seccion icono={<Clock className="h-4 w-4" aria-hidden="true" />} titulo="Estado y siguiente paso" testid="sol-estado">
          <div className="sm:col-span-2">
            <p className="inline-block rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{TEXTO_BAJO_SOLICITUD}</p>
            <p className="mt-2 text-sm text-gray-600">Un asesor revisará la tarifa y la disponibilidad del hotel y te enviará la cotización completa del paquete. Hasta entonces la solicitud no tiene precio y no puede reservarse ni pagarse.</p>
          </div>
        </Seccion>

        {(datos?.paqueteNombre || datos?.destino) && (
          <Seccion icono={<Package className="h-4 w-4" aria-hidden="true" />} titulo="Paquete y destino" testid="sol-paquete">
            {datos?.paqueteNombre && <Dato k="Paquete">{datos.paqueteNombre}</Dato>}
            {datos?.destino && <Dato k="Destino">{datos.destino}</Dato>}
            {esBloqueo && <Dato k="Modalidad">Paquete con vuelo</Dato>}
            {esPorcion && <Dato k="Modalidad">Porción terrestre (sin vuelo)</Dato>}
          </Seccion>
        )}

        <Seccion icono={<BedDouble className="h-4 w-4" aria-hidden="true" />} titulo="Hotel, habitación y alimentación" testid="sol-hotel">
          <Dato k="Hotel">{datos?.hotelNombre ?? "Hotel"}</Dato>
          {habitaciones.length > 0 && <Dato k="Habitaciones">{habitaciones.join(", ")}</Dato>}
          {datos?.categoria && datos.categoria !== "A confirmar" && <Dato k="Tipo de habitación">{datos.categoria}</Dato>}
          {datos?.regimen && datos.regimen !== "A confirmar" && <Dato k="Plan de alimentación">{datos.regimen}</Dato>}
          {sinSeleccion && <Dato k="Habitación y alimentación" ancho>Por confirmar con el asesor</Dato>}
        </Seccion>

        {(ida || regreso || datos?.adultos != null || !!datos?.menores) && (
          <Seccion icono={<CalendarDays className="h-4 w-4" aria-hidden="true" />} titulo="Fechas y viajeros" testid="sol-fechas">
            {ida && regreso && <Dato k="Fechas" ancho>{ida} al {regreso}{n ? ` · ${n} ${n === 1 ? "noche" : "noches"}` : ""}</Dato>}
            {datos?.adultos != null && <Dato k="Adultos">{datos.adultos}</Dato>}
            {!!datos?.menores && <Dato k="Menores">{datos.menores}{edades.length ? ` (edades: ${edades.join(", ")})` : ""}</Dato>}
          </Seccion>
        )}

        {hayOtros && (
          <Seccion icono={<Plane className="h-4 w-4" aria-hidden="true" />} titulo="Otros componentes del paquete" testid="sol-componentes">
            {esBloqueo && vuelo && (
              <>
                {(vuelo.aerolinea || vuelo.ruta) && <Dato k="Vuelo" ancho>{[vuelo.aerolinea, vuelo.ruta].filter(Boolean).join(" · ")}</Dato>}
                <Tramo titulo="Ida" vuelo={vuelo} ida />
                <Tramo titulo="Regreso" vuelo={vuelo} ida={false} />
              </>
            )}
            {esBloqueo && !vuelo && <Dato k="Vuelo" ancho>El detalle del vuelo no quedó registrado en esta solicitud.</Dato>}
            {esPorcion && <Dato k="Vuelo" ancho>Este paquete no incluye vuelo.</Dato>}
            {servicios.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-gray-500">Servicios del paquete (se confirman al valorar la solicitud)</dt>
                <dd><ul className="mt-1 list-disc space-y-0.5 pl-5 font-medium text-gray-900">{servicios.map((s) => <li key={s.nombre} className="break-words">{s.nombre}</li>)}</ul></dd>
              </div>
            )}
          </Seccion>
        )}

        {datos?.notas && <p className="border-t border-gray-100 pt-3 text-sm text-gray-600" data-testid="sol-notas">Notas: {datos.notas}</p>}
      </div>
    </div>
  );
}
