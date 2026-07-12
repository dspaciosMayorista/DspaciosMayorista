"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/utils";
import { obtenerAuxiliar, type Auxiliar } from "./actions";

type CuentaOpt = { id: number; codigo: string; nombre: string };

export function LibroAuxiliarClient({ cuentas }: { cuentas: CuentaOpt[] }) {
  const [cuentaTexto, setCuentaTexto] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [datos, setDatos] = useState<Auxiliar | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const cuentaPorLabel = new Map(cuentas.map((c) => [`${c.codigo} · ${c.nombre}`, c]));

  function consultar() {
    setError(""); setDatos(null);
    const cuenta = cuentaPorLabel.get(cuentaTexto.trim());
    if (!cuenta) { setError("Elige una cuenta válida de la lista."); return; }
    start(async () => {
      const r = await obtenerAuxiliar(cuenta.id, desde || undefined, hasta || undefined);
      if (!r.ok) { setError(r.error); return; }
      setDatos(r.datos);
    });
  }

  return (
    <div className="space-y-4">
      <datalist id="cuentas-libro-auxiliar">
        {cuentas.map((c) => <option key={c.id} value={`${c.codigo} · ${c.nombre}`} />)}
      </datalist>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="w-72">
          <label className="mb-1 block text-xs font-medium text-gray-600">Cuenta</label>
          <Input list="cuentas-libro-auxiliar" value={cuentaTexto} onChange={(e) => setCuentaTexto(e.target.value)} placeholder="Busca por código o nombre…" />
        </div>
        <div><label className="mb-1 block text-xs font-medium text-gray-600">Desde</label><Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-36" /></div>
        <div><label className="mb-1 block text-xs font-medium text-gray-600">Hasta</label><Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-36" /></div>
        <Button onClick={consultar} disabled={pending || !cuentaTexto.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "…" : "Consultar"}
        </Button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {datos && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-gray-700">{datos.cuenta.codigo} · {datos.cuenta.nombre}</span>
            <span className="text-xs text-gray-400">Naturaleza: {datos.cuenta.naturaleza === "debito" ? "Débito" : "Crédito"} · Saldo inicial: {formatCOP(datos.saldoInicial)}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-gray-50 text-left text-gray-400">
                <tr>
                  <th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Asiento</th><th className="px-2 py-1">Tercero</th>
                  <th className="px-2 py-1 text-right">Débito</th><th className="px-2 py-1 text-right">Crédito</th><th className="px-2 py-1 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {datos.lineas.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Sin movimientos en este rango.</td></tr>
                ) : datos.lineas.map((l) => (
                  <tr key={l.id} className="border-t border-gray-50">
                    <td className="px-2 py-1 text-gray-500">{l.fecha}</td>
                    <td className="px-2 py-1 text-gray-700">#{l.numeroAsiento} · {l.descripcionAsiento}{l.descripcionLinea ? ` — ${l.descripcionLinea}` : ""}</td>
                    <td className="px-2 py-1 text-gray-500">{l.tercero ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.debe > 0 ? formatCOP(l.debe) : ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.haber > 0 ? formatCOP(l.haber) : ""}</td>
                    <td className="px-2 py-1 text-right font-medium tabular-nums">{formatCOP(l.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              {datos.lineas.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 font-medium text-gray-700">
                    <td className="px-2 py-1" colSpan={3}>Total del período</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCOP(datos.totalDebe)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCOP(datos.totalHaber)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCOP(datos.saldoFinal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
