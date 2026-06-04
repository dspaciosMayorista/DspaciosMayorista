"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { registrarPagoProveedor, deshacerUltimoPago } from "./actions";

export type PagoRow = {
  id: number;
  numero_contrato: string;
  proveedor: string | null;
  tipo_proveedor: string | null;
  servicio: string | null;
  valor_total: number;
  moneda: string;
  fecha_obligacion: string | null;
  fecha_vencimiento: string | null;
  aplica_retencion: boolean | null;
  pct_retencion: number | null;
  pagos: { n: number; valor: number; fecha: string | null }[];
  pagado: number;
  saldo: number;
};

type Filtro = "por_pagar" | "pagadas" | "todas";

export function PagosList({ rows, proveedores }: { rows: PagoRow[]; proveedores: string[] }) {
  const [filtro, setFiltro] = useState<Filtro>("por_pagar");
  const [proveedor, setProveedor] = useState("");
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<number | null>(null);

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === "por_pagar" && r.saldo <= 0) return false;
      if (filtro === "pagadas" && r.saldo > 0) return false;
      if (proveedor && r.proveedor !== proveedor) return false;
      if (term) {
        const hay = `${r.numero_contrato} ${r.proveedor ?? ""} ${r.servicio ?? ""} ${r.tipo_proveedor ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filtro, proveedor, q]);

  const totales = useMemo(() => {
    const m = new Map<string, { total: number; pagado: number; saldo: number }>();
    for (const r of visibles) {
      const t = m.get(r.moneda) ?? { total: 0, pagado: 0, saldo: 0 };
      t.total += r.valor_total;
      t.pagado += r.pagado;
      t.saldo += r.saldo;
      m.set(r.moneda, t);
    }
    return [...m.entries()];
  }, [visibles]);

  return (
    <div>
      {/* Resumen (por moneda) */}
      <div className="mb-5 space-y-3">
        {totales.map(([moneda, t]) => (
          <div key={moneda}>
            {totales.length > 1 && <div className="mb-1 text-xs font-medium text-gray-400">{moneda}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tarjeta titulo="Total obligaciones" valor={t.total} moneda={moneda} />
              <Tarjeta titulo="Pagado" valor={t.pagado} moneda={moneda} tono="success" />
              <Tarjeta titulo="Por pagar" valor={t.saldo} moneda={moneda} tono="primary" />
            </div>
          </div>
        ))}
      </div>

      {/* Controles */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(["por_pagar", "pagadas", "todas"] as Filtro[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className="rounded-md px-3 py-1.5"
              style={
                filtro === f
                  ? { backgroundColor: "var(--brand-primary)", color: "white", fontWeight: 600 }
                  : { color: "#4b5563" }
              }
            >
              {f === "por_pagar" ? "Por pagar" : f === "pagadas" ? "Pagadas" : "Todas"}
            </button>
          ))}
        </div>
        <select
          value={proveedor}
          onChange={(e) => setProveedor(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Todos los proveedores</option>
          {proveedores.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar contrato, proveedor o servicio…"
          className="w-64 max-w-full"
        />
        <span className="ml-auto text-sm text-gray-500">{visibles.length} cuenta(s)</span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Proveedor</th>
              <th className="px-4 py-3">Servicio</th>
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Vence</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-right">Pagado</th>
              <th className="px-4 py-3 text-right">Saldo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  No hay cuentas en este filtro.
                </td>
              </tr>
            )}
            {visibles.map((r) => (
              <FilaPago
                key={r.id}
                row={r}
                abierto={abierto === r.id}
                onToggle={() => setAbierto(abierto === r.id ? null : r.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function vencida(fecha: string | null, saldo: number): boolean {
  if (!fecha || saldo <= 0) return false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return new Date(`${fecha}T12:00:00`) < hoy;
}

function FilaPago({
  row,
  abierto,
  onToggle,
}: {
  row: PagoRow;
  abierto: boolean;
  onToggle: () => void;
}) {
  const pagada = row.saldo <= 0;
  const atrasada = vencida(row.fecha_vencimiento, row.saldo);
  return (
    <>
      <tr className="cursor-pointer border-b border-gray-50 hover:bg-gray-50" onClick={onToggle}>
        <td className="px-4 py-3 text-gray-800">
          {row.proveedor ?? <span className="text-amber-600">Sin proveedor</span>}
          {row.tipo_proveedor && (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {row.tipo_proveedor}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-600">{row.servicio ?? "—"}</td>
        <td className="px-4 py-3 font-mono text-gray-700">{row.numero_contrato}</td>
        <td className="px-4 py-3 text-gray-500">
          {row.fecha_vencimiento ? (
            <span style={atrasada ? { color: "#dc2626", fontWeight: 600 } : undefined}>
              {formatFechaLarga(row.fecha_vencimiento)}
              {atrasada ? " ⚠" : ""}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMoneda(row.valor_total, row.moneda)}</td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{formatMoneda(row.pagado, row.moneda)}</td>
        <td
          className="px-4 py-3 text-right font-semibold tabular-nums"
          style={{ color: pagada ? "var(--brand-success)" : "var(--brand-primary)" }}
        >
          {pagada ? "Pagado" : formatMoneda(row.saldo, row.moneda)}
        </td>
        <td className="px-4 py-3 text-right text-gray-400">{abierto ? "▾" : "▸"}</td>
      </tr>
      {abierto && (
        <tr className="bg-gray-50/60">
          <td colSpan={8} className="px-4 py-4">
            <EstadoCuentaProveedor row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function EstadoCuentaProveedor({ row }: { row: PagoRow }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Estado de cuenta */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Estado de cuenta</h3>
          <Link
            href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`}
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
          >
            Ver contrato →
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-50">
                <td className="px-3 py-2 text-gray-500">Valor de la obligación</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                  {formatMoneda(row.valor_total, row.moneda)}
                </td>
              </tr>
              {row.aplica_retencion && (
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-gray-500">
                    Retención ({((row.pct_retencion ?? 0) * 100).toFixed(2)}%)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {formatMoneda(row.valor_total * (row.pct_retencion ?? 0), row.moneda)}
                  </td>
                </tr>
              )}
              {row.pagos.length === 0 ? (
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-gray-400" colSpan={2}>
                    Sin pagos registrados.
                  </td>
                </tr>
              ) : (
                row.pagos.map((p) => (
                  <tr key={p.n} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-500">
                      Pago {p.n} · {formatFechaLarga(p.fecha)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {formatMoneda(p.valor, row.moneda)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="px-3 py-2 text-gray-600">Saldo por pagar</td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  style={{ color: "var(--brand-primary)" }}
                >
                  {formatMoneda(row.saldo, row.moneda)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Registrar pago */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Registrar pago</h3>
        {row.saldo <= 0 ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Esta cuenta está totalmente pagada.
          </p>
        ) : row.pagos.length >= 3 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <p>Ya hay 3 pagos registrados (máximo del modelo). Deshaz uno para corregir.</p>
            <div className="mt-2">
              <Deshacer id={row.id} />
            </div>
          </div>
        ) : (
          <PagoInline id={row.id} saldo={row.saldo} moneda={row.moneda} puedeDeshacer={row.pagos.length > 0} />
        )}
        {row.pagos.length > 0 && row.saldo <= 0 && <Deshacer id={row.id} />}
      </div>
    </div>
  );
}

function PagoInline({
  id,
  saldo,
  moneda,
  puedeDeshacer,
}: {
  id: number;
  saldo: number;
  moneda: string;
  puedeDeshacer: boolean;
}) {
  const [valor, setValor] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = Number(valor);
    if (!v || v <= 0) {
      setError("Ingresa un valor mayor a 0.");
      return;
    }
    startTransition(async () => {
      const res = await registrarPagoProveedor(id, v, fecha);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setValor("");
    });
  }

  return (
    <form onSubmit={handle} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Valor</label>
          <Input
            type="number"
            min={0}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0"
            className="w-36"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Fecha del pago</label>
          <Input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-44"
          />
        </div>
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Registrar pago"}
        </Button>
        <button
          type="button"
          onClick={() => setValor(String(saldo))}
          className="text-xs font-medium text-[#1D7C9A] hover:underline"
        >
          Saldo total ({formatMoneda(saldo, moneda)})
        </button>
        {puedeDeshacer && <Deshacer id={id} />}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Deshacer({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => void (await deshacerUltimoPago(id)))}
      className="text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
    >
      {pending ? "…" : "Deshacer último pago"}
    </button>
  );
}

function Tarjeta({
  titulo,
  valor,
  moneda,
  tono,
}: {
  titulo: string;
  valor: number;
  moneda: string;
  tono?: "primary" | "success";
}) {
  const color =
    tono === "primary" ? "var(--brand-primary)" : tono === "success" ? "var(--brand-success)" : "#111827";
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color }}>
        {formatMoneda(valor, moneda)}
      </div>
    </div>
  );
}
