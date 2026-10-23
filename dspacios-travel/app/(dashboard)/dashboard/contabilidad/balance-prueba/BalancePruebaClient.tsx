"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { formatCOP } from "@/lib/utils";
import { rangoMes, textoCsv, montoCsv } from "@/lib/contabilidad/libroDiario";
import type { FilaBalance } from "@/lib/contabilidad/balancePrueba";

const NIVELES = [
  { valor: 0, etiqueta: "Todos los niveles" },
  { valor: 1, etiqueta: "Clase" },
  { valor: 2, etiqueta: "Grupo" },
  { valor: 3, etiqueta: "Cuenta" },
  { valor: 4, etiqueta: "Subcuenta" },
];
const lbl = "mb-1 block text-[11px] font-medium text-gray-500";
const importe = "whitespace-nowrap px-3 py-1.5 text-right tabular-nums";

export function BalancePruebaClient({ filas, totales, lineasSinCuenta, errorCarga, desde, hasta, hoy }: {
  filas: FilaBalance[];
  totales: { debitos: number; creditos: number; cuadra: boolean };
  lineasSinCuenta: number;
  errorCarga: string | null;
  desde: string;
  hasta: string;
  hoy: string;
}) {
  const router = useRouter();
  const [rango, setRango] = useState({ desde, hasta });
  const [nivel, setNivel] = useState(0);
  const [soloConMovimiento, setSoloConMovimiento] = useState(true);
  const [buscar, setBuscar] = useState("");

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return filas.filter((f) =>
      (!nivel || f.nivel <= nivel)
      && (!soloConMovimiento || f.tieneMovimiento)
      && (!q || f.codigo.startsWith(q) || f.nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)));
  }, [filas, nivel, soloConMovimiento, buscar]);

  const irA = (r: { desde: string; hasta: string }) => router.push(`?desde=${r.desde}&hasta=${r.hasta}`);
  function exportar() {
    const lineas = [
      "sep=;",
      ["Código", "Cuenta", "Nivel", "Naturaleza", "Saldo inicial", "Débitos", "Créditos", "Saldo final"].join(";"),
      ...visibles.map((f) => [textoCsv(f.codigo), textoCsv(f.nombre), String(f.nivel), f.naturaleza === "credito" ? "Crédito" : "Débito",
        montoCsv(f.saldoInicial), montoCsv(f.debitos), montoCsv(f.creditos), montoCsv(f.saldoFinal)].join(";")),
    ];
    const url = URL.createObjectURL(new Blob(["﻿" + lineas.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-prueba_${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <section aria-label="Periodo y filtros" className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={lbl}>Desde</label><DateInput aria-label="Desde" type="date" value={rango.desde} onValueChange={(v) => setRango((r) => ({ ...r, desde: v }))} className="w-40" /></div>
          <div><label className={lbl}>Hasta</label><DateInput aria-label="Hasta" type="date" value={rango.hasta} onValueChange={(v) => setRango((r) => ({ ...r, hasta: v }))} className="w-40" /></div>
          <Button variant="outline" disabled={!rango.desde || !rango.hasta} onClick={() => irA(rango)}>Ver periodo</Button>
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" onClick={() => irA(rangoMes(hoy))}>Este mes</Button>
            <Button variant="outline" onClick={() => irA(rangoMes(desde, -1))}>Mes anterior</Button>
            <Button variant="outline" onClick={() => irA({ desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy })}>Año a la fecha</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={lbl} htmlFor="bp-nivel">Nivel</label>
            <select id="bp-nivel" value={nivel} onChange={(e) => setNivel(Number(e.target.value))} className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm">
              {NIVELES.map((n) => <option key={n.valor} value={n.valor}>{n.etiqueta}</option>)}
            </select>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className={lbl} htmlFor="bp-buscar">Buscar cuenta</label>
            <Input id="bp-buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Código o nombre" />
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={soloConMovimiento} onChange={(e) => setSoloConMovimiento(e.target.checked)} />
            Solo cuentas con saldo o movimiento
          </label>
        </div>
      </section>

      {errorCarga && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">No se pudo leer el libro completo: {errorCarga}. El balance no es confiable hasta resolverlo.</p>}
      {lineasSinCuenta > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={15} aria-hidden /> {lineasSinCuenta} línea(s) apuntan a una cuenta que no está en el PUC de esta agencia: suman en los totales pero no en ninguna fila.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
        <span>Débitos del periodo: <b className="tabular-nums text-gray-800">{formatCOP(totales.debitos)}</b></span>
        <span>Créditos del periodo: <b className="tabular-nums text-gray-800">{formatCOP(totales.creditos)}</b></span>
        {totales.cuadra
          ? <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 size={15} aria-hidden /> Cuadra</span>
          : <span className="inline-flex items-center gap-1 font-medium text-red-600"><AlertTriangle size={15} aria-hidden /> Descuadre de {formatCOP(Math.abs(totales.debitos - totales.creditos))}</span>}
        <Button variant="outline" className="ml-auto" disabled={!visibles.length} onClick={exportar}>
          <Download size={15} className="mr-1 inline" aria-hidden /> Exportar CSV
        </Button>
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">
          {filas.length === 0 ? "El PUC de esta agencia está vacío." : "No hay cuentas con movimiento en este periodo para los filtros elegidos."}
        </p>
      ) : (
        <ResponsiveTableShell minWidth={760} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Cuenta</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Saldo inicial</th>
              <th className="px-3 py-2 text-right">Débitos</th>
              <th className="px-3 py-2 text-right">Créditos</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Saldo final</th>
            </tr></thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} className={`border-t border-gray-100 ${f.nivel <= 2 ? "bg-gray-50/60 font-semibold" : ""}`}>
                  <td className="px-3 py-1.5" data-label="Cuenta">
                    <span style={{ paddingLeft: `${Math.max(0, f.nivel - 1) * 12}px` }} className="inline-block">
                      <span className="font-mono text-[11px] text-gray-500">{f.codigo}</span>{" "}
                      <span className="text-gray-800">{f.nombre}</span>
                    </span>
                  </td>
                  <td className={importe} data-label="Saldo inicial">{formatCOP(f.saldoInicial)}</td>
                  <td className={importe} data-label="Débitos">{f.debitos ? formatCOP(f.debitos) : "—"}</td>
                  <td className={importe} data-label="Créditos">{f.creditos ? formatCOP(f.creditos) : "—"}</td>
                  <td className={`${importe} ${f.saldoFinal < 0 ? "text-amber-700" : ""}`} data-label="Saldo final"
                    title={f.saldoFinal < 0 ? "Saldo contrario a la naturaleza de la cuenta" : undefined}>
                    {formatCOP(f.saldoFinal)}
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
