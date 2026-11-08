import { Plane, ChevronDown } from "lucide-react";
import { formatFechaLarga } from "@/lib/utils";
import { ETIQUETA_CAMPO, type Campo, type TramoPortal } from "@/lib/portal/vuelosContrato";
import type { VuelosContrato as Datos } from "@/lib/portal/vuelosPortalServidor";

const SENTIDO = { ida: "Ida", regreso: "Regreso", suelto: "Tramo" } as const;
const CAMPOS: Campo[] = ["numeroVuelo", "fecha", "horaSalida", "horaLlegada"];

function valor(c: Campo, v: string | null) {
  if (v == null) return <span className="text-gray-400">Sin dato</span>;
  return c === "fecha" ? formatFechaLarga(v) : v;
}

function Tramo({ t }: { t: TramoPortal }) {
  const ruta = t.origen && t.destino ? `${t.origen} a ${t.destino}` : "Ruta no disponible";
  return (
    <li className="min-w-0 rounded-lg border border-gray-100 bg-white p-3" data-tramo={t.direccion}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-xs font-semibold uppercase text-gray-500">{SENTIDO[t.direccion]}</p>
        <p className="text-xs text-gray-400">{t.aerolinea ?? "Aerolínea no disponible"}</p>
      </div>
      <p className="mt-0.5 break-words text-sm font-medium text-gray-800">{ruta}</p>
      <p className="mt-2 text-[11px] font-semibold uppercase text-gray-400">Contratado</p>
      <dl className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
        {CAMPOS.map((c) => (
          <div key={c} className="min-w-0">
            <dt className="text-gray-400">{ETIQUETA_CAMPO[c]}</dt>
            <dd className="break-words text-gray-700">{valor(c, t.contratado[c])}</dd>
          </div>
        ))}
      </dl>
      {t.vinculo === "acreditado" && t.diferencias.length > 0 && (
        <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900" role="note">
          <p className="font-semibold">El último horario registrado en D&apos;spacios es distinto</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
            {t.diferencias.map((c) => (
              <div key={c} className="min-w-0"><dt className="opacity-70">{ETIQUETA_CAMPO[c]}</dt><dd className="break-words">{valor(c, t.registrado[c] ?? null)}</dd></div>
            ))}
          </dl>
          <p className="mt-1 opacity-80">Sin fecha de actualización acreditada. Es el dato de nuestra base, no el estado en tiempo real de la aerolínea; confírmalo con tu asesor.</p>
        </div>
      )}
      {t.comparacion === "completa" && (
        <p className="mt-2 text-xs text-gray-500">Coincide con el último horario registrado en D&apos;spacios (vuelo, fecha, salida y llegada).</p>
      )}
      {t.comparacion === "parcial" && (
        <p className="mt-2 text-xs text-gray-500">Coincide en lo que D&apos;spacios tiene registrado ({t.comparados.map((c) => ETIQUETA_CAMPO[c].toLowerCase()).join(", ")}). Comparación parcial: falta {t.sinDatoOperativo.map((c) => ETIQUETA_CAMPO[c].toLowerCase()).join(", ")}.</p>
      )}
      {t.comparacion === "diferente" && t.sinDatoOperativo.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">Comparación parcial: D&apos;spacios no tiene registrado {t.sinDatoOperativo.map((c) => ETIQUETA_CAMPO[c].toLowerCase()).join(", ")}.</p>
      )}
      {t.comparacion === "sin_datos" && (
        <p className="mt-2 text-xs text-gray-500">Sin datos operativos registrados en D&apos;spacios para comparar. Se muestra solo lo contratado.</p>
      )}
      {t.vinculo === "no_comprobada" && (
        <p className="mt-2 text-xs text-amber-800">No se pudo comprobar el horario registrado en D&apos;spacios en este momento. Se muestra solo lo contratado; intenta más tarde.</p>
      )}
      {t.vinculo === "sin_vinculo" && (
        <p className="mt-2 text-xs text-gray-500">Solo se muestra lo contratado: no se puede cotejar con un horario registrado. {t.motivoSinVinculo}</p>
      )}
      {t.ausentes.length > 0 && t.ausentes.length < CAMPOS.length && (
        <p className="mt-1 text-xs text-gray-400">El contrato no trae: {t.ausentes.map((c) => ETIQUETA_CAMPO[c].toLowerCase()).join(", ")}.</p>
      )}
    </li>
  );
}

/** «Ver vuelos» de un contrato propio. Server component: `<details>` nativo, sin JS ni ids del navegador. */
export function VuelosContrato({ datos }: { datos: Datos | undefined }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
        <Plane className="h-3.5 w-3.5" aria-hidden /> Ver vuelos <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2">
        {!datos || datos.incompleto ? (
          <p className="text-xs text-gray-500">No pudimos cargar los vuelos de este contrato ahora. Intenta más tarde.</p>
        ) : datos.tramos.length === 0 ? (
          <p className="text-xs text-gray-500">Este contrato no tiene vuelos registrados.</p>
        ) : (
          <>
            <ul className="grid gap-2 lg:grid-cols-2">{datos.tramos.map((t) => <Tramo key={t.clave} t={t} />)}</ul>
            <p className="mt-2 text-[11px] text-gray-400">Horarios informativos sujetos a cambios de la aerolínea.</p>
          </>
        )}
      </div>
    </details>
  );
}

/**
 * Fila adicional de Mis ventas. Escritorio: `colSpan` cubre las 8 columnas. Tarjetas (la tabla apilable convierte cada
 * `tr` en CSS grid y `colSpan` deja de aplicar): `grid-column: 1 / -1` hace que ocupe todo el ancho de la tarjeta.
 */
export function FilaVuelosContrato({ datos }: { datos: Datos | undefined }) {
  return (
    <tr style={{ borderTop: 0, paddingTop: 0 }}>
      <td colSpan={8} data-label="" className="px-3 pb-2 pt-0" style={{ gridColumn: "1 / -1" }}><VuelosContrato datos={datos} /></td>
    </tr>
  );
}
