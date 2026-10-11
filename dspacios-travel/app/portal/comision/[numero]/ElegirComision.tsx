import Link from "next/link";
import { formatMoneda } from "@/lib/utils";
import type { ComisionesParaElegir } from "@/lib/finanzas/comisionResolver";

/** `?id=` de la URL: el id de la comisión (aliados_b2b) a mostrar. */
export function idComisionDeQuery(id: string | string[] | undefined): number | null {
  const v = Array.isArray(id) ? id[0] : id;
  if (!v || !/^\d+$/.test(v)) return null;
  return Number(v);
}

// Un contrato con varias comisiones cobrables: se elige cuál, en vez de
// mostrar en silencio solo la más reciente.
export function ElegirComision({ r, sufijo = "" }: { r: ComisionesParaElegir; sufijo?: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-lg font-semibold text-gray-800">Contrato {r.numeroContrato}: varias comisiones</h1>
      <p className="mt-1 text-sm text-gray-500">Este contrato tiene más de una comisión B2B. Elige cuál quieres ver.</p>
      <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {r.opciones.map((o) => (
          <li key={o.id}>
            <Link
              href={`/portal/comision/${encodeURIComponent(r.numeroContrato)}${sufijo}?id=${o.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
            >
              <span className="text-gray-700">{o.aliado ?? "Aliado sin nombre"}</span>
              <span className="tabular-nums font-medium" style={{ color: "var(--brand-primary)" }}>{formatMoneda(o.totalPagar, r.moneda)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
