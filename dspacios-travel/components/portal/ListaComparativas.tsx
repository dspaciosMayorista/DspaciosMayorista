import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { comparativaComoCotizacion, estadoCotizacion } from "@/lib/portal/b2bPortal";
import type { ComparativaPortal } from "@/lib/portal/b2bPortalServidor";

const ESTADO = {
  elegida: { label: "Opción elegida", clase: "bg-[rgba(102,181,150,0.18)] text-[#3f7d63]" },
  convertida: { label: "Convertida", clase: "bg-[rgba(102,181,150,0.18)] text-[#3f7d63]" },
  salida_pasada: { label: "Salida pasada", clase: "bg-red-50 text-red-700" },
  vencida: { label: "Vencida", clase: "bg-red-50 text-red-700" },
  vigente: { label: "Vigente", clase: "bg-gray-100 text-gray-500" },
} as const;

export function ListaComparativas({ comparativas, hoy }: { comparativas: ComparativaPortal[]; hoy: string }) {
  return (
    <section aria-labelledby="comparativas" className="mt-8 first:mt-0">
      <h2 id="comparativas" className="mb-1 text-base font-semibold text-gray-900">Comparativas</h2>
      <p className="mb-3 text-xs text-gray-500">Compara hoteles y escoge uno; cada total es de ese hotel, no se suman.</p>
      <ul className="space-y-3">
        {comparativas.map((c) => {
          const e = ESTADO[estadoCotizacion(comparativaComoCotizacion(c), hoy)];
          return (
            <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-semibold text-[#1D7C9A]">{c.codigo}</span>
                  <span className="ml-2 text-sm text-gray-600">{c.destino ?? "—"}</span>
                  <span className="ml-2 text-xs text-gray-400">{c.fecha_salida ? formatFechaLarga(c.fecha_salida) : ""} · vigente hasta {c.vigencia_hasta ? formatFechaLarga(c.vigencia_hasta) : "—"}</span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${e.clase}`}>{e.label}</span>
                </div>
                <a href={`/cot/${c.share_token}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
                  {c.hija ? "Ver la comparativa" : "Ver y elegir una opción"}
                </a>
              </div>
              <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                {c.opciones.map((o) => (
                  <li key={`${o.opcion}-${o.acomodacion}`} className="rounded-lg bg-gray-50 px-3 py-1.5">
                    Opción {o.opcion} · {o.etiqueta}: <b className="tabular-nums">{formatMoneda(Number(o.total), o.moneda)}</b>
                  </li>
                ))}
              </ul>
              {c.hija && (
                <p className="mt-2 text-xs text-green-700">Opción elegida: cotización {c.hija.codigo}{c.hija.numero_contrato ? ` · contrato ${c.hija.numero_contrato}` : ""}.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
