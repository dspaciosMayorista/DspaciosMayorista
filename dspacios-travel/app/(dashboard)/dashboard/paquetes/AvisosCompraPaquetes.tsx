import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { etiquetaDias, type AvisoCompra } from "@/lib/paquetes/vencimientoCompra";

// #13 — Panel de vigencias de compra que terminan pronto. Componente de servidor (sin JS de cliente, sin sondeo): se calcula una vez por carga de la página.
// Cada fila enlaza a la pantalla donde se corrige ESA vigencia (configuración del paquete, salidas dinámicas, empaquetado o paquete total).
const VISIBLES = 6;

function Fila({ a }: { a: AvisoCompra }) {
  const urgente = a.dias <= 1;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm" data-testid="aviso-compra">
      <div className="min-w-0 flex-1">
        <Link href={a.ruta} className="break-words font-medium text-gray-900 underline-offset-2 hover:underline">{a.nombre}</Link>
        <p className="break-words text-xs text-gray-500">{a.detalle}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${urgente ? "bg-red-50 text-red-700" : "bg-amber-100 text-amber-800"}`}>{etiquetaDias(a.dias)}</span>
    </li>
  );
}

export function AvisosCompraPaquetes({ avisos, dias, truncado, error }: { avisos: AvisoCompra[]; dias: number; truncado: boolean; error: boolean }) {
  if (error) {
    return (
      <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="avisos-compra-error">
        No se pudieron leer las vigencias de compra por vencer. Los demás datos del listado no se ven afectados.
      </div>
    );
  }
  if (!avisos.length && truncado) {
    return (
      <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="avisos-compra-incompleto">
        La revisión de vigencias de compra quedó incompleta (se alcanzó el límite de lectura): no se puede afirmar que no haya vigencias por vencer en los próximos {dias} {dias === 1 ? "día" : "días"}. Revisa los paquetes directamente.
      </div>
    );
  }
  if (!avisos.length) return null;
  const primeros = avisos.slice(0, VISIBLES);
  const resto = avisos.slice(VISIBLES);
  return (
    <section aria-label="Vigencias de compra por vencer" className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60" data-testid="avisos-compra">
      <div className="flex items-start gap-2 px-3 pt-3 text-sm text-amber-900">
        <CalendarClock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          <b>{avisos.length === 1 ? "1 vigencia de compra termina" : `${avisos.length} vigencias de compra terminan`}</b> en los próximos {dias} {dias === 1 ? "día" : "días"} (fecha de Bogotá).
          Revisa o actualiza la vigencia para no dejar de vender.
        </p>
      </div>
      <ul className="mt-2 divide-y divide-amber-100 border-t border-amber-100">
        {primeros.map((a) => <Fila key={a.clave} a={a} />)}
      </ul>
      {resto.length > 0 && (
        <details className="border-t border-amber-100">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-amber-900">Ver {resto.length} más</summary>
          <ul className="divide-y divide-amber-100 border-t border-amber-100">{resto.map((a) => <Fila key={a.clave} a={a} />)}</ul>
        </details>
      )}
      {truncado && <p className="border-t border-amber-100 px-3 py-2 text-xs text-amber-800">Hay más vigencias de las listadas; el panel muestra las primeras por fecha.</p>}
    </section>
  );
}
