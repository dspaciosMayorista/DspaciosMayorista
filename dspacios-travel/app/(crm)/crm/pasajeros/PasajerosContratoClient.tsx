"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { formatFechaLarga } from "@/lib/utils";
import { numeroVisible } from "@/lib/tenant";
import { buscarPasajerosContrato, type PasajeroContratoRow } from "./actions";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";

const TAM_PAGINA = 25;

const TENANT_LABEL: Record<string, string> = { mayorista: "Mayorista", minorista: "Minorista" };

// Mismo mecanismo responsive que /dashboard/contratos y el resto de tablas
// del Dashboard: un único `<table>` envuelto en `ResponsiveTableShell`, que
// mide el ancho REAL del contenedor (ResizeObserver) y apila en tarjetas
// cuando no alcanza — nunca texto truncado, nunca scroll de página, nunca
// `overflow-hidden` disimulando un desborde. Antes esto elegía tarjetas vs.
// tabla con un breakpoint `xl:` de VIEWPORT (dos JSX duplicados): con el
// sidebar (256px) visible, "Contrato de origen" (última columna) podía
// quedar recortado en silencio por el `overflow-hidden` del wrapper viejo.
// Ver el comentario largo de ContratosList.tsx.
export function PasajerosContratoClient() {
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [filas, setFilas] = useState<PasajeroContratoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Token de generación: cada cambio de `busqueda`/`pagina` dispara una
  // petición nueva y descarta cualquier respuesta anterior todavía en
  // vuelo — sin esto, escribir rápido (cada tecla dispara una búsqueda) o
  // cambiar de página antes de que la anterior resuelva puede hacer que
  // una respuesta VIEJA llegue DESPUÉS de una más nueva y pise `filas`/
  // `total`/`error` con datos que ya no corresponden a lo que hay en
  // pantalla (búsqueda/página actual). Mismo mecanismo que
  // BuscarPasajeroDocumento.tsx.
  const tokenRef = useRef(0);

  useEffect(() => {
    const miToken = ++tokenRef.current;
    startTransition(async () => {
      const r = await buscarPasajerosContrato(busqueda, pagina, TAM_PAGINA);
      // Una búsqueda/página más nueva ya invalidó esta respuesta — se
      // descarta en silencio, nunca se aplica fuera de orden.
      if (tokenRef.current !== miToken) return;
      if (!r.ok) {
        setError(r.error);
        setFilas([]);
        setTotal(0);
        return;
      }
      setError(null);
      setFilas(r.filas);
      setTotal(r.totalFilas);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, pagina]);

  const totalPaginas = Math.max(1, Math.ceil(total / TAM_PAGINA));

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <label className="mb-1 block text-[11px] font-medium text-gray-500">Buscar (nombre, documento o contrato)</label>
        <input
          className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          value={busqueda}
          onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }}
          placeholder="Ej. Pérez, 900187 o DTM-0451…"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{pending ? "Buscando…" : `${total} pasajero(s)`}</span>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-30">← Anterior</button>
            <span>Página {pagina} de {totalPaginas}</span>
            <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-30">Siguiente →</button>
          </div>
        )}
      </div>

      {!pending && !error && !filas.length ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
          Sin resultados.
        </div>
      ) : (
        <TablaPasajerosContrato filas={filas} />
      )}
    </div>
  );
}

// Extraída del contenedor de datos (que llama al Server Action) para poder
// montarla de forma aislada con filas fijas — la búsqueda/paginación
// necesita una sesión real con Supabase, la presentación de la tabla no.
export function TablaPasajerosContrato({ filas }: { filas: PasajeroContratoRow[] }) {
  return (
    <ResponsiveTableShell minWidth={860} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-3 py-2">Nombre</th>
            <th className="px-3 py-2">Documento</th>
            <th className="px-3 py-2">Nacimiento</th>
            <th className="px-3 py-2">Agencia</th>
            <th className="px-3 py-2">Contrato de origen</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => (
            <tr key={p.pasajeroId} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-3 py-2.5 break-words text-gray-800" data-label="Nombre">{p.nombre}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-gray-500" data-label="Documento">{p.tipoId ?? "—"} {p.identificacion ?? "—"}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-gray-500" data-label="Nacimiento">{p.fechaNacimiento ? formatFechaLarga(p.fechaNacimiento) : "—"}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-gray-500" data-label="Agencia">{TENANT_LABEL[p.tenant] ?? p.tenant}</td>
              <td className="px-3 py-2.5 whitespace-nowrap" data-label="Contrato de origen">
                <Link
                  href={`/dashboard/contratos/${encodeURIComponent(p.numeroContrato)}`}
                  className="font-mono text-xs font-medium text-[#1D7C9A] hover:underline"
                >
                  {numeroVisible(p.numeroContrato)} →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTableShell>
  );
}
