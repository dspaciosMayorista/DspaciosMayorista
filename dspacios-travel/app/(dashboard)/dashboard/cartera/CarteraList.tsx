"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { registrarAbonoCartera } from "./actions";

export type CarteraRow = {
  numero_contrato: string;
  cliente: string | null;
  destino: string | null;
  precio_venta: number;
  estado: string | null;
  fecha_salida: string | null;
  moneda: string;
  pagado: number;
  saldo: number;
  abonos: {
    id: number;
    fecha_abono: string;
    valor_abono: number;
    forma_pago: string | null;
    referencia: string | null;
  }[];
};

type Filtro = "con_saldo" | "pagados" | "todos";

export function CarteraList({ rows, formasPago }: { rows: CarteraRow[]; formasPago: string[] }) {
  const [filtro, setFiltro] = useState<Filtro>("con_saldo");
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === "con_saldo" && r.saldo <= 0) return false;
      if (filtro === "pagados" && r.saldo > 0) return false;
      if (term) {
        const hay = `${r.numero_contrato} ${r.cliente ?? ""} ${r.destino ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filtro, q]);

  const totales = useMemo(() => {
    const m = new Map<string, { venta: number; recaudado: number; saldo: number }>();
    for (const r of rows) {
      const t = m.get(r.moneda) ?? { venta: 0, recaudado: 0, saldo: 0 };
      t.venta += r.precio_venta;
      t.recaudado += r.pagado;
      t.saldo += r.saldo;
      m.set(r.moneda, t);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <div>
      {/* Resumen (por moneda) */}
      <div className="mb-5 space-y-3">
        {totales.map(([moneda, t]) => (
          <div key={moneda}>
            {totales.length > 1 && <div className="mb-1 text-xs font-medium text-gray-400">{moneda}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tarjeta titulo="Total vendido" valor={t.venta} moneda={moneda} />
              <Tarjeta titulo="Recaudado" valor={t.recaudado} moneda={moneda} tono="success" />
              <Tarjeta titulo="Por cobrar" valor={t.saldo} moneda={moneda} tono="primary" />
            </div>
          </div>
        ))}
      </div>

      {/* Controles */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(["con_saldo", "pagados", "todos"] as Filtro[]).map((f) => (
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
              {f === "con_saldo" ? "Con saldo" : f === "pagados" ? "Pagados" : "Todos"}
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar contrato, cliente o destino…"
          className="w-72 max-w-full"
        />
        <span className="ml-auto text-sm text-gray-500">{visibles.length} contrato(s)</span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Salida</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-right">Abonado</th>
              <th className="px-4 py-3 text-right">Saldo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  No hay contratos en este filtro.
                </td>
              </tr>
            )}
            {visibles.map((r) => (
              <FilaCartera
                key={r.numero_contrato}
                row={r}
                abierto={abierto === r.numero_contrato}
                onToggle={() =>
                  setAbierto(abierto === r.numero_contrato ? null : r.numero_contrato)
                }
                formasPago={formasPago}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaCartera({
  row,
  abierto,
  onToggle,
  formasPago,
}: {
  row: CarteraRow;
  abierto: boolean;
  onToggle: () => void;
  formasPago: string[];
}) {
  const pagadoTotal = row.saldo <= 0;
  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-50 hover:bg-gray-50"
        onClick={onToggle}
      >
        <td className="px-4 py-3 font-mono font-medium text-gray-800">{row.numero_contrato}</td>
        <td className="px-4 py-3 text-gray-700">{row.cliente ?? "—"}</td>
        <td className="px-4 py-3 text-gray-500">{formatFechaLarga(row.fecha_salida)}</td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
          {formatMoneda(row.precio_venta, row.moneda)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-600">
          {formatMoneda(row.pagado, row.moneda)}
        </td>
        <td
          className="px-4 py-3 text-right font-semibold tabular-nums"
          style={{ color: pagadoTotal ? "var(--brand-success)" : "var(--brand-primary)" }}
        >
          {pagadoTotal ? "Pagado" : formatMoneda(row.saldo, row.moneda)}
        </td>
        <td className="px-4 py-3 text-right text-gray-400">{abierto ? "▾" : "▸"}</td>
      </tr>
      {abierto && (
        <tr className="bg-gray-50/60">
          <td colSpan={7} className="px-4 py-4">
            <EstadoCuenta row={row} formasPago={formasPago} />
          </td>
        </tr>
      )}
    </>
  );
}

function EstadoCuenta({ row, formasPago }: { row: CarteraRow; formasPago: string[] }) {
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
        {row.abonos.length === 0 ? (
          <p className="text-sm text-gray-400">Sin abonos registrados.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Forma</th>
                  <th className="px-3 py-2">Referencia</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {row.abonos.map((a) => (
                  <tr key={a.id} className="border-t border-gray-50">
                    <td className="px-3 py-2 text-gray-600">{formatFechaLarga(a.fecha_abono)}</td>
                    <td className="px-3 py-2 text-gray-600">{a.forma_pago ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{a.referencia ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {formatMoneda(a.valor_abono, row.moneda)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2 text-gray-600" colSpan={3}>
                    Saldo por cobrar
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                    {formatMoneda(row.saldo, row.moneda)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Registrar abono */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Registrar abono</h3>
        {row.saldo <= 0 ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Este contrato está totalmente pagado.
          </p>
        ) : (
          <AbonoInline numeroContrato={row.numero_contrato} formasPago={formasPago} saldo={row.saldo} moneda={row.moneda} />
        )}
      </div>
    </div>
  );
}

function AbonoInline({
  numeroContrato,
  formasPago,
  saldo,
  moneda,
}: {
  numeroContrato: string;
  formasPago: string[];
  saldo: number;
  moneda: string;
}) {
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("");
  const [ref, setRef] = useState("");
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
      const res = await registrarAbonoCartera(numeroContrato, v, forma, ref);
      if (!res.ok) {
        setError(res.error ?? "No se pudo registrar el abono.");
        return;
      }
      setValor("");
      setForma("");
      setRef("");
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
          <label className="mb-1 block text-xs font-medium text-gray-600">Forma de pago</label>
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value)}
            className="w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Selecciona…</option>
            {formasPago.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Referencia</label>
          <Input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Comprobante / nota"
            className="w-44"
          />
        </div>
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Registrar abono"}
        </Button>
        <button
          type="button"
          onClick={() => setValor(String(saldo))}
          className="text-xs font-medium text-[#1D7C9A] hover:underline"
        >
          Saldo total ({formatMoneda(saldo, moneda)})
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
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
