"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { formatFechaLarga } from "@/lib/utils";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import type { PuestoCotizacionCrm } from "@/lib/personas/consulta";
import { buscarPersonasCotizacion } from "./actions";

const TAM_PAGINA = 25;

const TENANT_LABEL: Record<string, string> = { mayorista: "Mayorista", minorista: "Minorista" };
const FICHA_LABEL: Record<string, string> = { documentada: "Documentada", provisional: "Provisional", revision: "En revisión" };
const ESTADO_COT_LABEL: Record<string, string> = { abierta: "Abierta", convertida: "Convertida", descartada: "Descartada" };

function dato(p: PuestoCotizacionCrm, campo: string): string {
  return p.datos.find((d) => d.campo === campo)?.valor ?? "";
}

// Mismo patrón que "Pasajeros de contratos": búsqueda paginada con token de generación (una
// respuesta vieja nunca pisa una más nueva) y una sola tabla en ResponsiveTableShell.
export function PersonasCotizacionClient({
  enlazarCotizaciones, superadmin, tenantUsuario,
}: { enlazarCotizaciones: boolean; superadmin: boolean; tenantUsuario: string }) {
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState(1);
  const [filas, setFilas] = useState<PuestoCotizacionCrm[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const tokenRef = useRef(0);

  useEffect(() => {
    const miToken = ++tokenRef.current;
    startTransition(async () => {
      const r = await buscarPersonasCotizacion(texto, pagina, TAM_PAGINA);
      if (tokenRef.current !== miToken) return;
      if (!r.ok) { setError(r.error); setFilas([]); setTotal(0); return; }
      setError(null);
      setFilas(r.filas);
      setTotal(r.total);
    });
  }, [texto, pagina]);

  const totalPaginas = Math.max(1, Math.ceil(total / TAM_PAGINA));

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <label htmlFor="buscar-personas-cotizacion" className="mb-1 block text-[11px] font-medium text-gray-500">Buscar (nombre, documento o código de cotización)</label>
        <input
          id="buscar-personas-cotizacion"
          className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          value={texto}
          maxLength={100}
          onChange={(e) => { setTexto(e.target.value); setPagina(1); }}
          placeholder="Ej. Pérez, 900187 o COT-0451…"
        />
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{pending ? "Buscando…" : `${total} persona(s)`}</span>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-30">← Anterior</button>
            <span>Página {pagina} de {totalPaginas}</span>
            <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-30">Siguiente →</button>
          </div>
        )}
      </div>

      {!pending && !error && !filas.length ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">Sin resultados.</div>
      ) : (
        <TablaPersonasCotizacion filas={filas} enlazar={(p) => enlazarCotizaciones && (superadmin || p.cotizacion.tenant === tenantUsuario)} />
      )}
    </div>
  );
}

export function TablaPersonasCotizacion({ filas, enlazar }: { filas: PuestoCotizacionCrm[]; enlazar: (p: PuestoCotizacionCrm) => boolean }) {
  return (
    <ResponsiveTableShell minWidth={900} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-3 py-2">Nombre</th>
            <th className="px-3 py-2">Puesto</th>
            <th className="px-3 py-2">Documento</th>
            <th className="px-3 py-2">Ficha</th>
            <th className="px-3 py-2">Contacto</th>
            <th className="px-3 py-2">Cotización</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => {
            const nombre = `${dato(p, "nombres")} ${dato(p, "apellidos")}`.trim();
            const contacto = [dato(p, "telefono"), dato(p, "email")].filter(Boolean).join(" · ");
            return (
              <tr key={p.participante_ref} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-3 py-2.5 break-words text-gray-800" data-label="Nombre">{nombre || "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-500" data-label="Puesto">{p.rol === "titular" ? "Titular" : "Pasajero"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-500" data-label="Documento">
                  {p.numero_doc ? `${p.tipo_doc ?? "Sin tipo"} ${p.numero_doc}` : "—"}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-500" data-label="Ficha">{FICHA_LABEL[p.estado_ficha] ?? p.estado_ficha}</td>
                <td className="px-3 py-2.5 break-words text-gray-500" data-label="Contacto">{contacto || "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap" data-label="Cotización">
                  {enlazar(p) ? (
                    <Link href={`/dashboard/cotizaciones/${p.cotizacion.id}`} className="font-mono text-xs font-medium text-[#1D7C9A] hover:underline">
                      {p.cotizacion.codigo} →
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-gray-600">{p.cotizacion.codigo}</span>
                  )}
                  <span className="ml-2 text-[11px] text-gray-400">
                    {ESTADO_COT_LABEL[p.cotizacion.estado] ?? p.cotizacion.estado} · {formatFechaLarga(p.cotizacion.fecha.slice(0, 10))}
                    {p.cotizacion.tenant ? ` · ${TENANT_LABEL[p.cotizacion.tenant] ?? p.cotizacion.tenant}` : ""}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTableShell>
  );
}
