"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { EstadoBadge } from "@/components/EstadoBadge";
import { numeroVisible } from "@/lib/tenant";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";

export type VentaRow = {
  numero_contrato: string;
  cliente: string;
  destino: string | null;
  fecha_salida: string | null;
  precio_venta: number;
  moneda: string | null;
  estado: string;
  created_at: string;
};

const inp = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs";
const lbl = "mb-1 block text-[11px] font-medium text-gray-500";

// ─────────────────────────────────────────────────────────────────────────
// Diseño responsive real (no `overflow-hidden`/`overflow-x-hidden` para
// disimular un desborde, no scroll horizontal forzado): los filtros viven
// en su propia barra ARRIBA de la lista, nunca dentro de las celdas de la
// tabla — antes cada columna cargaba su propio mini-formulario (fechas
// Desde/Hasta lado a lado, Mín/Máx lado a lado), eso era lo que empujaba a
// la tabla a un ancho forzado (`min-w-[720px]`) más grande que el espacio
// real disponible junto al sidebar.
//
// ⚠️ Antes esto elegía tarjetas vs. tabla con un breakpoint `xl:` de
// VIEWPORT (dos bloques JSX separados, uno de cada uno) — el mismo defecto
// que ya se corrigió en el resto de tablas del Dashboard (ver
// ResponsiveTable.module.css): a 1280-1366px de viewport el sidebar (256px)
// + el padding pueden dejar menos ancho real que el necesario, y con
// `overflow-hidden` (en vez de `overflow-x-auto`) el desborde no se veía
// como scroll sino como un recorte silencioso de la última columna
// ("Ver"/el enlace al contrato). Ahora usa el MISMO mecanismo que las demás
// tablas — un único `<table>` envuelto en `ResponsiveTableShell`, que mide
// el ancho REAL del contenedor (ResizeObserver) y apila en tarjetas cuando
// no alcanza — en vez de mantener dos JSX duplicados (uno de tarjetas a
// mano, otro de tabla) que podían divergir en datos/acciones entre sí.
export function ContratosList({ ventas }: { ventas: VentaRow[] }) {
  const [fContrato, setFContrato] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fDestino, setFDestino] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fSalidaDesde, setFSalidaDesde] = useState("");
  const [fSalidaHasta, setFSalidaHasta] = useState("");
  const [fValorMin, setFValorMin] = useState("");
  const [fValorMax, setFValorMax] = useState("");

  const estados = useMemo(() => [...new Set(ventas.map((v) => v.estado).filter(Boolean))].sort(), [ventas]);

  const filtradas = useMemo(() => {
    const nContrato = fContrato.trim().toLowerCase();
    const nCliente = fCliente.trim().toLowerCase();
    const nDestino = fDestino.trim().toLowerCase();
    const min = fValorMin ? Number(fValorMin) : null;
    const max = fValorMax ? Number(fValorMax) : null;
    return ventas.filter((v) => {
      if (nContrato && !numeroVisible(v.numero_contrato).toLowerCase().includes(nContrato)) return false;
      if (nCliente && !(v.cliente ?? "").toLowerCase().includes(nCliente)) return false;
      if (nDestino && !(v.destino ?? "").toLowerCase().includes(nDestino)) return false;
      if (fEstado && v.estado !== fEstado) return false;
      if (fSalidaDesde && (!v.fecha_salida || v.fecha_salida < fSalidaDesde)) return false;
      if (fSalidaHasta && (!v.fecha_salida || v.fecha_salida > fSalidaHasta)) return false;
      if (min != null && v.precio_venta < min) return false;
      if (max != null && v.precio_venta > max) return false;
      return true;
    });
  }, [ventas, fContrato, fCliente, fDestino, fEstado, fSalidaDesde, fSalidaHasta, fValorMin, fValorMax]);

  const hayFiltros = fContrato || fCliente || fDestino || fEstado || fSalidaDesde || fSalidaHasta || fValorMin || fValorMax;
  function limpiar() {
    setFContrato(""); setFCliente(""); setFDestino(""); setFEstado("");
    setFSalidaDesde(""); setFSalidaHasta(""); setFValorMin(""); setFValorMax("");
  }

  return (
    <div className="space-y-3">
      {/* Barra de filtros — envuelve con `flex-wrap`, nunca fuerza ancho.
          Cada campo tiene su propio ancho acotado (`w-28`/`w-36`, etc.) en
          vez de `w-full` dentro de una celda de tabla sin límite. */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <div className="w-28">
          <label className={lbl}>Contrato</label>
          <input className={inp} value={fContrato} onChange={(e) => setFContrato(e.target.value)} placeholder="00-0000" />
        </div>
        <div className="w-40">
          <label className={lbl}>Cliente</label>
          <input className={inp} value={fCliente} onChange={(e) => setFCliente(e.target.value)} placeholder="Buscar…" />
        </div>
        <div className="w-32">
          <label className={lbl}>Destino</label>
          <input className={inp} value={fDestino} onChange={(e) => setFDestino(e.target.value)} placeholder="Buscar…" />
        </div>
        <div className="w-36">
          <label className={lbl}>Salida desde</label>
          <DateInput aria-label="Salida desde" type="date" className={inp} value={fSalidaDesde} onValueChange={(dateValue) => setFSalidaDesde(dateValue)} />
        </div>
        <div className="w-36">
          <label className={lbl}>Salida hasta</label>
          <DateInput aria-label="Salida hasta" type="date" className={inp} value={fSalidaHasta} onValueChange={(dateValue) => setFSalidaHasta(dateValue)} />
        </div>
        <div className="w-24">
          <label className={lbl}>Valor mín.</label>
          <input type="number" className={inp} value={fValorMin} onChange={(e) => setFValorMin(e.target.value)} placeholder="Mín" />
        </div>
        <div className="w-24">
          <label className={lbl}>Valor máx.</label>
          <input type="number" className={inp} value={fValorMax} onChange={(e) => setFValorMax(e.target.value)} placeholder="Máx" />
        </div>
        <div className="w-36">
          <label className={lbl}>Estado</label>
          <select className={inp} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos</option>
            {estados.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        {!!hayFiltros && (
          <button onClick={limpiar} className="mb-0.5 text-xs font-medium text-[var(--brand-accent)] hover:underline">
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {filtradas.length} de {ventas.length} contrato(s)
        </span>
      </div>

      {!filtradas.length ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
          Sin resultados para estos filtros.
        </div>
      ) : (
        <ResponsiveTableShell minWidth={900} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2">Contrato</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Destino</th>
                <th className="px-3 py-2">Salida</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((v) => (
                <tr key={v.numero_contrato} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-mono font-medium whitespace-nowrap text-gray-800" data-label="Contrato">{numeroVisible(v.numero_contrato)}</td>
                  {/* Cliente/Destino: SIN truncar — como tabla siempre hay
                      espacio real para el texto completo (el mecanismo de
                      ResponsiveTableShell no deja llegar a este modo si no
                      alcanza); si un nombre es excepcionalmente largo, se
                      envuelve a una 2ª línea (`break-words`, sin
                      `whitespace-nowrap`) en vez de cortarse con "…", que
                      escondería el dato. */}
                  <td className="px-3 py-2.5 break-words text-gray-700" data-label="Cliente">{v.cliente}</td>
                  <td className="px-3 py-2.5 break-words text-gray-500" data-label="Destino">{v.destino ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500" data-label="Salida">{formatFechaLarga(v.fecha_salida)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-gray-700" data-label="Valor">{formatMoneda(v.precio_venta, v.moneda)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" data-label="Estado"><EstadoBadge estado={v.estado} /></td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap" data-label="Acción">
                    <Link
                      href={`/dashboard/contratos/${encodeURIComponent(v.numero_contrato)}`}
                      className="text-xs font-medium text-[#1D7C9A] hover:underline"
                    >
                      Ver contrato →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableShell>
      )}
    </div>
  );
}
