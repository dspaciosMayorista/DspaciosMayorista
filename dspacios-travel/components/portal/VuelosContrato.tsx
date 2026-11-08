import { Plane, ChevronDown } from "lucide-react";
import { formatFechaLarga } from "@/lib/utils";
import { ETIQUETA_CAMPO, type Campo, type TramoPortal } from "@/lib/portal/vuelosContrato";
import type { VuelosContrato as Datos } from "@/lib/portal/vuelosPortalServidor";

const SENTIDO = { ida: "Ida", regreso: "Regreso", suelto: "Tramo" } as const;
const ORIGEN = { bloqueo: "Bloqueo", empaquetado: "Empaquetado" } as const;
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
        <p className="text-xs font-semibold uppercase text-gray-500">
          {SENTIDO[t.direccion]}
          {t.fuente && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium normal-case text-gray-600">{ORIGEN[t.fuente]}</span>}
        </p>
        <p className="text-xs text-gray-400">{t.aerolinea ?? "Aerolínea no disponible"}</p>
      </div>
      <p className="mt-0.5 break-words text-sm font-medium text-gray-800">{ruta}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
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
      {t.comparacion === "completa" && <p className="mt-2 text-xs text-gray-500">Coincide con el horario registrado en D&apos;spacios.</p>}
      {t.comparacion === "parcial" && <p className="mt-2 text-xs text-gray-500">Coincide en lo registrado en D&apos;spacios.</p>}
      {t.vinculo === "no_comprobada" && <p className="mt-2 text-xs text-amber-800">No se pudo comprobar el horario registrado.</p>}
    </li>
  );
}

/** «Ver vuelos» de un contrato propio. Server component: `<details>` nativo, sin JS ni ids del navegador. */
export function VuelosContrato({ datos }: { datos: Datos }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
        <Plane className="h-3.5 w-3.5" aria-hidden /> Ver vuelos <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2">
        <ul className="grid gap-2 lg:grid-cols-2">{datos.tramos.map((t) => <Tramo key={t.clave} t={t} />)}</ul>
        <p className="mt-2 text-[11px] text-gray-400">Horarios informativos sujetos a cambios de la aerolínea.</p>
      </div>
    </details>
  );
}

/**
 * Fila adicional de Mis ventas. Escritorio: `colSpan` cubre las 8 columnas. Tarjetas (la tabla apilable convierte cada
 * `tr` en CSS grid y `colSpan` deja de aplicar): `grid-column: 1 / -1` hace que ocupe todo el ancho de la tarjeta.
 * Sin vuelos registrados (lectura correcta y vacía) no hay fila ni «Ver vuelos»; si la lectura falló, solo un aviso breve.
 */
export function FilaVuelosContrato({ datos }: { datos: Datos | undefined }) {
  const fallo = !datos || datos.incompleto;
  if (!fallo && datos.tramos.length === 0) return null;
  return (
    <tr style={{ borderTop: 0, paddingTop: 0 }}>
      <td colSpan={8} data-label="" className="px-3 pb-2 pt-0" style={{ gridColumn: "1 / -1" }}>
        {fallo ? <p className="text-xs text-amber-800">No se pudieron cargar los vuelos.</p> : <VuelosContrato datos={datos} />}
      </td>
    </tr>
  );
}
