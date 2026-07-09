"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search, Trash2, Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import {
  buscarCuentasPorContrato,
  listarRetenciones,
  registrarRetencion,
  eliminarRetencion,
  type CuentaContrato,
  type RetencionRow,
} from "./actions";

const hoy = () => new Date().toISOString().slice(0, 10);

export function RetencionesClient({ contratos }: { contratos: string[] }) {
  const [numero, setNumero] = useState("");
  const [cuentas, setCuentas] = useState<CuentaContrato[] | null>(null);
  const [tipo, setTipo] = useState("");
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [retenciones, setRetenciones] = useState<RetencionRow[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const cuenta = cuentas?.find((c) => c.id === cuentaId) ?? null;
  const tipos = cuentas ? Array.from(new Set(cuentas.map((c) => c.tipo_proveedor || "Sin tipo"))) : [];
  const candidatas = cuentas && tipo ? cuentas.filter((c) => (c.tipo_proveedor || "Sin tipo") === tipo) : [];

  function buscar() {
    setError("");
    setCuentas(null);
    setTipo("");
    setCuentaId(null);
    setRetenciones([]);
    if (!numero.trim()) return;
    start(async () => {
      const r = await buscarCuentasPorContrato(numero);
      if (!r.ok) { setError(r.error); return; }
      setCuentas(r.cuentas);
      // Un solo tipo de proveedor en el contrato → selecciona directo.
      const tiposEncontrados = Array.from(new Set(r.cuentas.map((c) => c.tipo_proveedor || "Sin tipo")));
      if (tiposEncontrados.length === 1) elegirTipo(tiposEncontrados[0], r.cuentas);
    });
  }

  function elegirTipo(t: string, cuentasDisp = cuentas ?? []) {
    setTipo(t);
    setCuentaId(null);
    setRetenciones([]);
    const cands = cuentasDisp.filter((c) => (c.tipo_proveedor || "Sin tipo") === t);
    if (cands.length === 1) elegirCuenta(cands[0].id);
  }

  function elegirCuenta(id: number) {
    setCuentaId(id);
    start(async () => {
      const r = await listarRetenciones(id);
      if (r.ok) setRetenciones(r.retenciones);
    });
  }

  function refrescarCuenta() {
    start(async () => {
      const r = await buscarCuentasPorContrato(numero);
      if (r.ok) setCuentas(r.cuentas);
      if (cuentaId) {
        const r2 = await listarRetenciones(cuentaId);
        if (r2.ok) setRetenciones(r2.retenciones);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Buscar por contrato */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-gray-600">Número de contrato</label>
        <div className="flex flex-wrap gap-2">
          <Input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && buscar()}
            list="contratos-retenciones"
            placeholder="ej. 00-0451"
            className="w-48"
          />
          <datalist id="contratos-retenciones">
            {contratos.map((c) => <option key={c} value={c} />)}
          </datalist>
          <Button onClick={buscar} disabled={pending || !numero.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>
            <Search size={15} className="mr-1 inline" /> Buscar
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* Tipo de proveedor */}
      {cuentas && cuentas.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <label className="mb-1 block text-xs font-medium text-gray-600">Tipo de proveedor</label>
          <div className="flex flex-wrap gap-2">
            {tipos.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => elegirTipo(t)}
                className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                style={tipo === t
                  ? { backgroundColor: "var(--brand-primary)", color: "white" }
                  : { backgroundColor: "#f3f4f6", color: "#374151" }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Si hay más de una cuenta del mismo tipo, desambiguar */}
          {tipo && candidatas.length > 1 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-gray-500">Hay {candidatas.length} cuentas de este tipo — elige cuál:</p>
              {candidatas.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegirCuenta(c.id)}
                  className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  style={cuentaId === c.id ? { borderColor: "var(--brand-primary)" } : { borderColor: "#e5e7eb" }}
                >
                  <span>{c.proveedor ?? "Sin proveedor"} {c.servicio ? `· ${c.servicio}` : ""}</span>
                  <span className="tabular-nums text-gray-500">{formatMoneda(c.valor_total, c.moneda)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cuenta seleccionada: estado + registrar retención */}
      {cuenta && (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {cuenta.proveedor ?? "Sin proveedor"} {cuenta.servicio ? `· ${cuenta.servicio}` : ""}
              </p>
              <p className="text-xs text-gray-400">{numero.trim()} · {cuenta.tipo_proveedor ?? "Sin tipo"}</p>
            </div>
            <Link href={`/dashboard/contratos/${encodeURIComponent(numero.trim())}`} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
              Ver contrato →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Valor total" value={formatMoneda(cuenta.valor_total, cuenta.moneda)} />
            <Mini label="Pagado" value={formatMoneda(cuenta.pagado, cuenta.moneda)} color="var(--brand-success)" />
            <Mini label="Retenido" value={formatMoneda(cuenta.retenido, cuenta.moneda)} color="#b45309" />
            <Mini label="Saldo pendiente" value={formatMoneda(cuenta.saldo, cuenta.moneda)} />
          </div>

          {retenciones.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                    <th className="px-3 py-2">Practicada</th>
                    <th className="px-3 py-2">Declara DIAN</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {retenciones.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-600">{formatFechaLarga(r.fecha_practica)}</td>
                      <td className="px-3 py-2 text-gray-600">{r.mes_declaracion}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatMoneda(r.valor, cuenta.moneda)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => start(async () => { await eliminarRetencion(r.id); refrescarCuenta(); })}
                          className="text-gray-300 hover:text-red-500"
                          title="Eliminar retención"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <FormRetencion key={cuenta.id} cuenta={cuenta} onDone={refrescarCuenta} />
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={{ color: color ?? "#374151" }}>{value}</div>
    </div>
  );
}

// Calculadora de retención: Valor retención = % retención × Base gravable,
// donde Base gravable = Base (lo que se le va a pagar al proveedor) menos sus
// propios impuestos (IVA, IPC/otro). Todos los % y la base mínima son
// gestionables por fila — varían según el proveedor.
function FormRetencion({ cuenta, onDone }: { cuenta: CuentaContrato; onDone: () => void }) {
  const [base, setBase] = useState(String(Math.round(cuenta.saldo)));
  const [ivaPct, setIvaPct] = useState("0");
  const [ipcPct, setIpcPct] = useState("0");
  const [pctRetencion, setPctRetencion] = useState(cuenta.pctRetencionSugerido ? String(cuenta.pctRetencionSugerido * 100) : "0");
  const [baseMinima, setBaseMinima] = useState("0");
  const [fechaPractica, setFechaPractica] = useState(hoy());
  const [mesDeclaracion, setMesDeclaracion] = useState(hoy().slice(0, 7));
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const baseNum = Number(base) || 0;
  const ivaNum = Number(ivaPct) || 0;
  const ipcNum = Number(ipcPct) || 0;
  const pctNum = Number(pctRetencion) || 0;
  const minimaNum = Number(baseMinima) || 0;

  const valorIva = baseNum * (ivaNum / 100);
  const valorIpc = baseNum * (ipcNum / 100);
  const baseGravable = Math.max(0, baseNum - valorIva - valorIpc);
  const aplica = baseGravable >= minimaNum && baseGravable > 0;
  const valorRetencion = aplica ? Math.round(baseGravable * (pctNum / 100)) : 0;
  const valorAPagar = baseNum - valorRetencion;

  function guardar() {
    setError("");
    start(async () => {
      const detalle = `Base ${formatMoneda(baseNum, cuenta.moneda)} · IVA ${ivaNum}%: ${formatMoneda(valorIva, cuenta.moneda)} · IPC ${ipcNum}%: ${formatMoneda(valorIpc, cuenta.moneda)} · Base gravable ${formatMoneda(baseGravable, cuenta.moneda)} · Retención ${pctNum}%`;
      const obs = [observaciones.trim(), detalle].filter(Boolean).join(" — ");
      const r = await registrarRetencion({
        cuentaId: cuenta.id,
        valor: valorRetencion,
        fechaPractica,
        mesDeclaracion,
        observaciones: obs,
      });
      if (!r.ok) { setError(r.error); return; }
      setObservaciones("");
      onDone();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
        <Landmark size={13} /> Calculadora de retención
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Campo label={`Base (${cuenta.moneda})`}>
          <Input value={base} onChange={(e) => setBase(e.target.value)} inputMode="numeric" />
        </Campo>
        <Campo label="% IVA proveedor">
          <Input value={ivaPct} onChange={(e) => setIvaPct(e.target.value)} inputMode="decimal" />
        </Campo>
        <Campo label="% IPC / otro imp.">
          <Input value={ipcPct} onChange={(e) => setIpcPct(e.target.value)} inputMode="decimal" />
        </Campo>
        <Campo label="% Retención">
          <Input value={pctRetencion} onChange={(e) => setPctRetencion(e.target.value)} inputMode="decimal" />
        </Campo>
        <Campo label="Base mínima aplicable">
          <Input value={baseMinima} onChange={(e) => setBaseMinima(e.target.value)} inputMode="numeric" />
        </Campo>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
        <FilaCalc label="Valor base" value={formatMoneda(baseNum, cuenta.moneda)} />
        <FilaCalc label={`Valor IVA (${ivaNum}%)`} value={formatMoneda(valorIva, cuenta.moneda)} />
        <FilaCalc label={`Valor IPC / otro (${ipcNum}%)`} value={formatMoneda(valorIpc, cuenta.moneda)} />
        <FilaCalc label="Base gravable retención" value={formatMoneda(baseGravable, cuenta.moneda)} bold />
        <FilaCalc label={`Valor retención (${pctNum}%)`} value={formatMoneda(valorRetencion, cuenta.moneda)} bold color="#b45309" />
        <FilaCalc label="Valor a pagar al proveedor" value={formatMoneda(valorAPagar, cuenta.moneda)} bold color="var(--brand-success)" />
      </div>
      {!aplica && baseNum > 0 && (
        <p className="mt-1 text-xs text-amber-600">La base gravable no alcanza la base mínima — no aplica retención (valor $0).</p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Fecha en que se practicó</label>
          <Input type="date" value={fechaPractica} onChange={(e) => setFechaPractica(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Mes a declarar (DIAN)</label>
          <Input type="month" value={mesDeclaracion} onChange={(e) => setMesDeclaracion(e.target.value)} className="w-36" />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-gray-500">Observaciones (opcional)</label>
          <Input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="ej. retefuente servicios" />
        </div>
        <Button onClick={guardar} disabled={pending || valorRetencion <= 0} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Registrar"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function FilaCalc({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div className={`flex items-center justify-between border-t border-gray-100 px-3 py-1.5 first:border-t-0 ${bold ? "font-semibold" : ""}`}>
      <span className="text-gray-500">{label}</span>
      <span className="tabular-nums" style={{ color: color ?? "#374151" }}>{value}</span>
    </div>
  );
}
