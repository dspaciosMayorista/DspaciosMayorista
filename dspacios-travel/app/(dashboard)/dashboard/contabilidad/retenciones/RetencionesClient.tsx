"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Search, Trash2, Landmark, FileBarChart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import {
  buscarCuentasPorContrato,
  listarRetenciones,
  registrarRetencion,
  eliminarRetencion,
  listarMesesDeclaracion,
  informeMensualRetenciones,
  recalcularBasesFaltantes,
  type CuentaContrato,
  type RetencionRow,
  type InformeRetencionRow,
} from "./actions";

const hoy = () => new Date().toISOString().slice(0, 10);

export function RetencionesClient({ contratos }: { contratos: string[] }) {
  const [tab, setTab] = useState<"aplicar" | "informe">("aplicar");

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("aplicar")}
          className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
          style={tab === "aplicar" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { backgroundColor: "#f3f4f6", color: "#374151" }}
        >
          Aplicar retención
        </button>
        <button
          type="button"
          onClick={() => setTab("informe")}
          className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
          style={tab === "informe" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { backgroundColor: "#f3f4f6", color: "#374151" }}
        >
          Informe mensual (DIAN)
        </button>
      </div>
      {tab === "aplicar" ? <AplicarRetencion contratos={contratos} /> : <InformeMensual />}
    </div>
  );
}

function AplicarRetencion({ contratos }: { contratos: string[] }) {
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

// Informe mensual — lo que se llena en el formulario 350 de la DIAN por mes
// de declaración: base gravable total y valor retenido total, con el detalle
// fila por fila (contrato/proveedor) que los compone. Solo reúne retenciones
// registradas DESDE que existe el campo `base_gravable` (migración 128) — las
// anteriores muestran su valor retenido pero la base sale en blanco.
function InformeMensual() {
  const [meses, setMeses] = useState<string[]>([]);
  const [mes, setMes] = useState("");
  const [filas, setFilas] = useState<InformeRetencionRow[] | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [pending, start] = useTransition();
  const [recalculando, startRecalcular] = useTransition();

  useEffect(() => {
    listarMesesDeclaracion().then((r) => {
      if (!r.ok) return;
      setMeses(r.meses);
      if (r.meses.length) cargar(r.meses[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cargar(m: string) {
    setMes(m);
    setError("");
    setFilas(null);
    if (!m) return;
    start(async () => {
      const r = await informeMensualRetenciones(m);
      if (!r.ok) { setError(r.error); return; }
      setFilas(r.filas);
    });
  }

  // Recupera la base gravable de retenciones registradas antes de la
  // migración 128 (nunca la tuvieron guardada como número) — no pide nada
  // nuevo, la deriva de lo que ya está guardado (ver derivarBaseGravable en
  // el servidor: primero del detalle en observaciones, si no del % de
  // retención configurado en la cuenta).
  function recalcular() {
    setAviso("");
    setError("");
    startRecalcular(async () => {
      const r = await recalcularBasesFaltantes();
      if (!r.ok) { setError(r.error); return; }
      setAviso(`Se recalcularon ${r.actualizadas} base(s)${r.sinDato ? ` — ${r.sinDato} no se pudieron derivar (sin % de retención en ningún lado)` : ""}.`);
      if (mes) cargar(mes);
    });
  }

  // Casi siempre todas las filas de un mismo mes son en la misma moneda —
  // pero si llegara a mezclar, se totaliza por separado para no sumar
  // pesos con dólares.
  const porMoneda = new Map<string, InformeRetencionRow[]>();
  for (const f of filas ?? []) {
    const arr = porMoneda.get(f.moneda) ?? [];
    arr.push(f);
    porMoneda.set(f.moneda, arr);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-gray-600">Mes de declaración (DIAN)</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mes}
            onChange={(e) => cargar(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">Elige un mes</option>
            {meses.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {meses.length === 0 && <p className="text-sm text-gray-400">Aún no hay retenciones registradas.</p>}
          <button
            type="button"
            onClick={recalcular}
            disabled={recalculando}
            className="ml-auto text-xs font-medium hover:underline disabled:opacity-50"
            style={{ color: "var(--brand-accent)" }}
          >
            {recalculando ? "Recalculando…" : "Recalcular bases faltantes"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {aviso && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{aviso}</p>}
      {pending && <p className="text-sm text-gray-400">Cargando…</p>}

      {filas && filas.length === 0 && !pending && (
        <p className="rounded-xl border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">
          No hay retenciones declaradas en {mes}.
        </p>
      )}

      {filas && filas.length > 0 && [...porMoneda.entries()].map(([moneda, filasMoneda]) => {
        const totalBase = filasMoneda.reduce((a, f) => a + (f.base_gravable ?? 0), 0);
        const totalValor = filasMoneda.reduce((a, f) => a + f.valor, 0);
        const sinBase = filasMoneda.some((f) => f.base_gravable == null);
        return (
          <div key={moneda} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <FileBarChart size={13} /> {moneda} — {filasMoneda.length} retención(es)
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-400">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Contrato</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2 text-right">Base gravable</th>
                  <th className="px-3 py-2 text-right">Valor retención</th>
                </tr>
              </thead>
              <tbody>
                {filasMoneda.map((f) => (
                  <tr key={f.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-600">{formatFechaLarga(f.fecha_practica)}</td>
                    <td className="px-3 py-2">
                      {f.numero_contrato ? (
                        <Link href={`/dashboard/contratos/${encodeURIComponent(f.numero_contrato)}`} className="font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
                          {f.numero_contrato}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{f.proveedor ?? "Sin proveedor"} {f.tipo_proveedor ? `· ${f.tipo_proveedor}` : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{f.base_gravable != null ? formatMoneda(f.base_gravable, moneda) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatMoneda(f.valor, moneda)}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-800">
                  <td className="px-3 py-2" colSpan={3}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoneda(totalBase, moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: "#b45309" }}>{formatMoneda(totalValor, moneda)}</td>
                </tr>
              </tbody>
            </table>
            {sinBase && (
              <p className="border-t border-gray-100 px-3 py-2 text-xs text-amber-600">
                Alguna retención de este mes es anterior a que se guardara la base gravable — su base sale en blanco y no suma al total.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Calculadora de retención: Valor retención = % retención × Base gravable,
// donde Base gravable = Base (lo que se le va a pagar al proveedor) menos sus
// propios impuestos (IVA, IPC/otro). IVA e IPC se ingresan como VALOR ya
// calculado en pesos (no como %) — el proveedor casi siempre lo trae así en
// su factura, y evita el error de escribir el valor donde se espera un %.
// Retención sigue siendo un %, y la base mínima un valor en pesos.
function FormRetencion({ cuenta, onDone }: { cuenta: CuentaContrato; onDone: () => void }) {
  const [base, setBase] = useState(String(Math.round(cuenta.saldo)));
  const [ivaValor, setIvaValor] = useState("0");
  const [ipcValor, setIpcValor] = useState("0");
  const [pctRetencion, setPctRetencion] = useState(cuenta.pctRetencionSugerido ? String(cuenta.pctRetencionSugerido * 100) : "0");
  const [baseMinima, setBaseMinima] = useState("0");
  const [fechaPractica, setFechaPractica] = useState(hoy());
  const [mesDeclaracion, setMesDeclaracion] = useState(hoy().slice(0, 7));
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const baseNum = Number(base) || 0;
  const valorIva = Number(ivaValor) || 0;
  const valorIpc = Number(ipcValor) || 0;
  const pctNum = Number(pctRetencion) || 0;
  const minimaNum = Number(baseMinima) || 0;

  const baseGravable = Math.max(0, baseNum - valorIva - valorIpc);
  const aplica = baseGravable >= minimaNum && baseGravable > 0;
  // El IVA + IPC no debería superar la base (son impuestos SOBRE ese valor,
  // no pueden ser más grandes que él) — si pasa, casi siempre es porque se
  // escribió un dato equivocado en alguno de los dos campos.
  const excedeBase = baseNum > 0 && valorIva + valorIpc > baseNum;
  const valorRetencion = aplica ? Math.round(baseGravable * (pctNum / 100)) : 0;
  const valorAPagar = baseNum - valorRetencion;

  function guardar() {
    setError("");
    start(async () => {
      const detalle = `Base ${formatMoneda(baseNum, cuenta.moneda)} · IVA: ${formatMoneda(valorIva, cuenta.moneda)} · IPC/otro: ${formatMoneda(valorIpc, cuenta.moneda)} · Base gravable ${formatMoneda(baseGravable, cuenta.moneda)} · Retención ${pctNum}%`;
      const obs = [observaciones.trim(), detalle].filter(Boolean).join(" — ");
      const r = await registrarRetencion({
        cuentaId: cuenta.id,
        valor: valorRetencion,
        baseGravable,
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
        <Campo label={`Valor IVA proveedor (${cuenta.moneda})`}>
          <Input value={ivaValor} onChange={(e) => setIvaValor(e.target.value)} inputMode="numeric" />
        </Campo>
        <Campo label={`Valor IPC / otro imp. (${cuenta.moneda})`}>
          <Input value={ipcValor} onChange={(e) => setIpcValor(e.target.value)} inputMode="numeric" />
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
        <FilaCalc label="Valor IVA proveedor" value={formatMoneda(valorIva, cuenta.moneda)} />
        <FilaCalc label="Valor IPC / otro" value={formatMoneda(valorIpc, cuenta.moneda)} />
        <FilaCalc label="Base gravable retención" value={formatMoneda(baseGravable, cuenta.moneda)} bold />
        <FilaCalc label={`Valor retención (${pctNum}%)`} value={formatMoneda(valorRetencion, cuenta.moneda)} bold color="#b45309" />
        <FilaCalc label="Valor a pagar al proveedor" value={formatMoneda(valorAPagar, cuenta.moneda)} bold color="var(--brand-success)" />
      </div>
      {excedeBase && (
        <p className="mt-1 text-xs font-medium text-red-600">
          El IVA + IPC ({formatMoneda(valorIva + valorIpc, cuenta.moneda)}) supera la base ({formatMoneda(baseNum, cuenta.moneda)}) — revisa esos valores.
        </p>
      )}
      {!excedeBase && !aplica && baseNum > 0 && (
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
