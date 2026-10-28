// #75 — Piezas de presentación compartidas por la hoja imprimible y el selector interactivo de la comparativa.
// Sin hooks ni acciones: solo pintan lo que ya trae `ResumenHotelUI` (nada de costos, proveedores ni términos NETO).
import { Check, Package, Plane, X } from "lucide-react";
import { COLOR_DOCUMENTO } from "@/lib/contrato/colorDocumento";
import { formatFechaLarga } from "@/lib/utils";
import { formatoExacto } from "@/lib/contrato/repartoTarifa";
import type { MenorOpcion, OtroServicioOpcion, TarifaVisible, TiqueteVuelo } from "@/lib/cotizacion/comparativa";

const PRIMARY = COLOR_DOCUMENTO;

/** `opcion` rotula el bloque cuando es exclusivo de una opción: si un salto de página (o la lectura en pantalla) lo separa de su tarjeta, sigue identificado. */
export function ListasIncluye({ incluye, noIncluye, opcion, columnas = 2 }: { incluye: string[]; noIncluye: string[]; opcion?: string; columnas?: 1 | 2 }) {
  const rotulo = opcion ? <span className="font-normal text-gray-400"> · Opción {opcion}</span> : null;
  return (
    <div className={"grid grid-cols-1 gap-3 " + (columnas === 2 ? "sm:grid-cols-2" : "")} data-testid="incluye-no-incluye">
      {incluye.length > 0 && (
        <div className="min-w-0 rounded-lg border border-gray-100 p-3">
          <h4 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>Incluye{rotulo}</h4>
          <ul className="space-y-1 text-xs text-gray-700">
            {incluye.map((t, i) => <li key={i} className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0" style={{ color: PRIMARY }} aria-hidden /><span className="min-w-0 break-words">{t}</span></li>)}
          </ul>
        </div>
      )}
      {noIncluye.length > 0 && (
        <div className="min-w-0 rounded-lg border border-gray-100 p-3">
          <h4 className="mb-2 text-sm font-semibold text-gray-500">No incluye{rotulo}</h4>
          <ul className="space-y-1 text-xs text-gray-600">
            {noIncluye.map((t, i) => <li key={i} className="flex gap-2"><X size={13} className="mt-0.5 shrink-0 text-gray-400" aria-hidden /><span className="min-w-0 break-words">{t}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

const TITULO_TIQUETE = (t: TiqueteVuelo) =>
  t.tramos.length > 1 ? "Vuelo de ida y regreso" : t.tramos[0]?.direccion === "regreso" ? "Vuelo de regreso" : "Vuelo de ida";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * #75 — Vuelos de UNA opción con el estilo de los vuelos de la cotización y el contrato: un bloque por TIQUETE (ida y regreso juntos), la ruta, la fecha y
 * la hora de cada tramo, los pasajeros una vez y el aviso de disponibilidad UNA sola vez por tiquete. Sin importe: su valor ya está en el total de la opción.
 */
export function VuelosOpcion({ tiquetes }: { tiquetes?: TiqueteVuelo[] }) {
  if (!tiquetes?.length) return null;
  return (
    <div className="space-y-2" data-testid="vuelos-opcion">
      {tiquetes.map((t, i) => (
        <div key={i} data-testid="tiquete" className="break-inside-avoid rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600">
          <p className="flex flex-wrap items-center gap-x-1.5 font-semibold text-gray-700">
            <Plane size={13} className="shrink-0" aria-hidden /> {TITULO_TIQUETE(t)}
            {t.pax != null && <span className="font-normal text-gray-500">· Pasajeros: {t.pax}</span>}
          </p>
          <dl className="mt-1 space-y-0.5">
            {t.tramos.map((tr, j) => (
              <div key={j} className="grid grid-cols-[4rem_1fr] gap-x-2">
                <dt className="text-gray-400">{tr.direccion === "regreso" ? "Regreso" : "Ida"}</dt>
                <dd className="min-w-0 break-words">{tr.origen} → {tr.destino}{tr.fecha ? ` · ${formatFechaLarga(tr.fecha)}` : ""}{tr.hora ? ` · salida ${tr.hora} (hora local)` : ""}</dd>
              </div>
            ))}
          </dl>
          {t.aviso && <p className="mt-1 text-[11px] text-gray-500">{capital(t.aviso)}.</p>}
        </div>
      ))}
      <p className="text-[11px] text-gray-400">El valor de los vuelos ya está incluido en el total de esta opción.</p>
    </div>
  );
}

/** Servicios adicionales de UNA opción (tours vinculados y «otros servicios» manuales). Sin importe propio: ya van en el total, una sola vez. */
export function ServiciosAdicionalesOpcion({ servicios, otros }: { servicios?: { nombre: string }[]; otros?: OtroServicioOpcion[] }) {
  if (!servicios?.length && !otros?.length) return null;
  return (
    <div className="text-xs text-gray-600" data-testid="servicios-opcion">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Servicios adicionales</p>
      <ul className="space-y-1">
        {(servicios ?? []).map((s, i) => <li key={`s${i}`} className="break-words">+ {s.nombre}</li>)}
        {(otros ?? []).map((o, i) => (
          <li key={`o${i}`} className="flex items-start gap-1.5"><Package size={12} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{o.nombre} · {o.pax} pax{o.fechaIda ? ` · ${o.fechaIda}${o.fechaRegreso ? ` → ${o.fechaRegreso}` : ""}` : ""} · incluido en el total</span></li>
        ))}
      </ul>
    </div>
  );
}

/**
 * #75 — Tarifa por persona/adulto de UNA opción, solo si cuadra con lo liquidado. Si el importe no se divide exacto entre las personas no se muestra una
 * tarifa «exacta» que multiplicada no da el total: se muestra el reparto (1 × $665.227,63 y 1 × $665.227,62), que suma exactamente.
 */
export function TarifaOpcion({ tarifa: t, respaldo, moneda, sufijo = "" }: {
  /** La calculada desde el snapshot (`tarifaVisibleOpcion`); `null` = no hay una que cuadre. */
  tarifa?: TarifaVisible | null;
  /** Solo si `tarifa` no se calculó (`undefined`, p. ej. datos armados sin el snapshot): la tarifa guardada en la opción, tal cual. */
  respaldo?: { valor: number | null; conMenores: boolean };
  moneda: string; sufijo?: string;
}) {
  const tarifa: TarifaVisible | null | undefined = t !== undefined ? t
    : respaldo?.valor != null ? { etiqueta: respaldo.conMenores ? "Tarifa por adulto" : "Tarifa por persona", cantidad: 1, total: respaldo.valor, reparto: { exacto: true, tarifa: respaldo.valor }, soloHotel: false } : null;
  if (!tarifa) return null;
  const etiqueta = `${tarifa.etiqueta}${tarifa.soloHotel ? " (alojamiento)" : ""}${sufijo}`;
  if (tarifa.reparto.exacto) {
    return (
      <div className="flex items-baseline justify-between gap-3 text-xs text-gray-500" data-testid="tarifa-opcion">
        <span className="min-w-0 text-left">{etiqueta}</span>
        <span className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums text-gray-700">{formatoExacto(tarifa.reparto.tarifa, moneda)}</span>
      </div>
    );
  }
  return (
    <div className="text-xs text-gray-500" data-testid="tarifa-opcion">
      <p className="text-left">{etiqueta} (el total no se divide en partes iguales):</p>
      {tarifa.reparto.partes.map((p, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-left">{p.cantidad} {p.cantidad === 1 ? "persona" : "personas"}</span>
          <span className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums text-gray-700">{formatoExacto(p.tarifa, moneda)} c/u</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Tarifa de los menores de UNA opción (la REAL del snapshot). Si la opción es NETO y sus líneas de menores están a PVP (`noDesglosables`), no se muestran
 * como tarifa: se explica el límite. `pvp` marca las filas cuando la pantalla está mostrando la vista previa NETO del total.
 */
export function MenoresOpcion({ menores, noDesglosables, moneda, pvp }: { menores?: MenorOpcion[]; noDesglosables?: boolean; moneda: string; pvp?: boolean }) {
  if (noDesglosables) {
    return <p data-testid="menores-no-desglosables" className="rounded-lg bg-gray-50 px-2 py-1.5 text-left text-[11px] leading-snug text-gray-500">La tarifa individual de los menores no se desglosa con seguridad en esta opción; consúltala con tu asesor.</p>;
  }
  if (!menores?.length) return null;
  return (
    <>
      {menores.map((m, i) => (
        <div key={i} data-testid="menor-opcion" className="flex items-baseline justify-between gap-3 text-xs text-gray-500">
          <span className="min-w-0 break-words text-left">{m.cantidad} × {m.descripcion}{pvp ? " (PVP original)" : ""}</span>
          <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-gray-700">{m.tarifa > 0 ? formatoExacto(m.tarifa, moneda) : "Sin costo"}</span>
        </div>
      ))}
    </>
  );
}
