"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda, formatFechaLarga, formatCOP } from "@/lib/utils";
import { registrarPagoProveedor, deshacerUltimoPago, asignarProveedorCuentaPorPagar, configurarFacturaProveedor } from "./actions";

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
  clasificacion: "costo" | "irt";
  base_gravable: number | null;
  iva_proveedor: number | null;
  pagos: { id: number; valor: number; fecha: string | null; trm: number | null }[];
  pagado: number;
  retenido: number;
  saldo: number;
};

type Filtro = "por_pagar" | "pagadas" | "todas";

export function PagosList({ rows, proveedores, catalogo = [], ivaPct = 0.19 }: { rows: PagoRow[]; proveedores: string[]; catalogo?: string[]; ivaPct?: number }) {
  const [filtro, setFiltro] = useState<Filtro>("por_pagar");
  const [proveedor, setProveedor] = useState("");
  const [clasif, setClasif] = useState<"todos" | "ip" | "irt" | "sin">("todos");
  const [tipo, setTipo] = useState("");
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<number | null>(null);

  // Categoría de configuración de una CxP.
  const cat = (r: PagoRow): "ip" | "irt" | "sin" => r.clasificacion === "irt" ? "irt" : (r.base_gravable != null ? "ip" : "sin");
  const tipos = useMemo(() => Array.from(new Set(rows.map((r) => r.tipo_proveedor).filter((t): t is string => !!t))).sort(), [rows]);

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === "por_pagar" && r.saldo <= 0) return false;
      if (filtro === "pagadas" && r.saldo > 0) return false;
      if (proveedor && r.proveedor !== proveedor) return false;
      if (tipo && r.tipo_proveedor !== tipo) return false;
      if (clasif !== "todos" && cat(r) !== clasif) return false;
      if (term) {
        const hay = `${r.numero_contrato} ${r.proveedor ?? ""} ${r.servicio ?? ""} ${r.tipo_proveedor ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filtro, proveedor, tipo, clasif, q]);

  const totales = useMemo(() => {
    const m = new Map<string, { total: number; pagado: number; saldo: number; ip: number; irt: number; sin: number }>();
    for (const r of visibles) {
      const t = m.get(r.moneda) ?? { total: 0, pagado: 0, saldo: 0, ip: 0, irt: 0, sin: 0 };
      t.total += r.valor_total;
      t.pagado += r.pagado;
      t.saldo += r.saldo;
      t[cat(r)] += r.valor_total;
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
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: "var(--brand-success)" }} />IP (ingreso propio): <b className="tabular-nums text-gray-700">{formatMoneda(t.ip, moneda)}</b></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: "var(--brand-accent)" }} />IRT (terceros): <b className="tabular-nums text-gray-700">{formatMoneda(t.irt, moneda)}</b></span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle bg-red-500" />Sin configurar: <b className="tabular-nums text-gray-700">{formatMoneda(t.sin, moneda)}</b></span>
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
        <select value={clasif} onChange={(e) => setClasif(e.target.value as "todos" | "ip" | "irt" | "sin")}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="todos">Toda clasificación</option>
          <option value="ip">IP (ingreso propio)</option>
          <option value="irt">IRT (terceros)</option>
          <option value="sin">Sin configurar</option>
        </select>
        {tipos.length > 0 && (
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">Todo tipo</option>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
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
                catalogo={catalogo}
                ivaPct={ivaPct}
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
  catalogo,
  ivaPct,
  abierto,
  onToggle,
}: {
  row: PagoRow;
  catalogo: string[];
  ivaPct: number;
  abierto: boolean;
  onToggle: () => void;
}) {
  const pagada = row.saldo <= 0;
  const atrasada = vencida(row.fecha_vencimiento, row.saldo);
  // Configurada = se definió IRT, o IP (costo) con su base gravable.
  const configurada = row.clasificacion === "irt" || row.base_gravable != null;
  return (
    <>
      <tr className="cursor-pointer border-b border-gray-50 hover:bg-gray-50" onClick={onToggle}>
        <td className="px-4 py-3 text-gray-800">
          <span
            className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle"
            style={{ backgroundColor: configurada ? "var(--brand-success)" : "#dc2626" }}
            title={configurada ? (row.clasificacion === "irt" ? "Configurada: IRT" : "Configurada: Ingreso propio (IP)") : "Sin configurar (IRT / IP + base gravable)"}
          />
          {row.proveedor ?? <span className="text-amber-600">Sin proveedor</span>}
          {row.tipo_proveedor && (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {row.tipo_proveedor}
            </span>
          )}
          {configurada && (
            <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: "rgba(102,181,150,0.15)", color: "#3d7a63" }}>
              {row.clasificacion === "irt" ? "IRT" : "IP"}
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
            <EstadoCuentaProveedor row={row} catalogo={catalogo} ivaPct={ivaPct} />
          </td>
        </tr>
      )}
    </>
  );
}

function EstadoCuentaProveedor({ row, catalogo, ivaPct }: { row: PagoRow; catalogo: string[]; ivaPct: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Asignar / cambiar proveedor (ancho completo) */}
      <div className="lg:col-span-2">
        <AsignarProveedor id={row.id} actual={row.proveedor} catalogo={catalogo} />
      </div>
      {/* Factura del proveedor: IRT / Costo + base gravable (ancho completo) */}
      <div className="lg:col-span-2">
        <FacturaProveedor row={row} ivaPct={ivaPct} />
      </div>
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
              {row.retenido > 0 ? (
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-gray-500">
                    Retención practicada
                    <Link href="/dashboard/contabilidad/retenciones" className="ml-2 text-xs font-medium text-[#1D7C9A] hover:underline">
                      ver detalle →
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {formatMoneda(row.retenido, row.moneda)}
                  </td>
                </tr>
              ) : row.aplica_retencion ? (
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-gray-400">
                    Retención estimada ({((row.pct_retencion ?? 0) * 100).toFixed(2)}%) — sin registrar aún
                    <Link href="/dashboard/contabilidad/retenciones" className="ml-2 text-xs font-medium text-[#1D7C9A] hover:underline">
                      registrar →
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                    {formatMoneda(row.valor_total * (row.pct_retencion ?? 0), row.moneda)}
                  </td>
                </tr>
              ) : null}
              {row.pagos.length === 0 ? (
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-gray-400" colSpan={2}>
                    Sin pagos registrados.
                  </td>
                </tr>
              ) : (
                row.pagos.map((p, i) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-500">
                      Pago {i + 1} · {formatFechaLarga(p.fecha)}
                      {row.moneda === "USD" && p.trm ? (
                        <span className="ml-2 text-xs text-gray-400">TRM {formatCOP(p.trm)} · {formatCOP(p.valor * p.trm)}</span>
                      ) : null}
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
        ) : (
          <PagoInline id={row.id} saldo={row.saldo} moneda={row.moneda} puedeDeshacer={row.pagos.length > 0} />
        )}
        {row.pagos.length > 0 && row.saldo <= 0 && <Deshacer id={row.id} />}
      </div>
    </div>
  );
}

function FacturaProveedor({ row, ivaPct }: { row: PagoRow; ivaPct: number }) {
  const [clasif, setClasif] = useState<"costo" | "irt">(row.clasificacion ?? "costo");
  const [base, setBase] = useState(String(row.base_gravable ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const esCosto = clasif === "costo";
  const baseNum = Number(base) || 0;
  const ivaCalc = esCosto ? Math.round(baseNum * ivaPct) : 0;
  const costoNeto = esCosto ? Math.max(0, row.valor_total - ivaCalc) : row.valor_total;

  function guardar() {
    setError(null); setOk(false);
    startTransition(async () => {
      const res = await configurarFacturaProveedor({ id: row.id, clasificacion: clasif, baseGravable: baseNum });
      if (!res.ok) setError(res.error); else setOk(true);
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Factura del proveedor</span>
        <span className="text-xs text-gray-400">Total obligación: <b className="text-gray-600">{formatMoneda(row.valor_total, row.moneda)}</b></span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Tratamiento</label>
          <select value={clasif} onChange={(e) => setClasif(e.target.value as "costo" | "irt")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
            <option value="costo">Ingreso propio (IP)</option>
            <option value="irt">IRT (para tercero)</option>
          </select>
        </div>
        {esCosto && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Base gravable (IVA)</label>
            <Input type="number" min={0} value={base} onChange={(e) => setBase(e.target.value)} className="w-40 text-right" placeholder="0" />
          </div>
        )}
        <Button type="button" onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        {ok && <span className="text-xs text-[#3d7a63]">Guardado ✓</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      {esCosto ? (
        <p className="mt-2 text-[11px] text-gray-500">
          IVA descontable ({(ivaPct * 100).toFixed(0)}%): <b>{formatMoneda(ivaCalc, row.moneda)}</b> ·
          Costo neto (total − IVA): <b>{formatMoneda(costoNeto, row.moneda)}</b>
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-gray-500">IRT: ingreso para tercero. No descuenta IVA ni es costo propio.</p>
      )}
    </div>
  );
}

function AsignarProveedor({ id, actual, catalogo }: { id: number; actual: string | null; catalogo: string[] }) {
  const [sel, setSel] = useState(actual ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!catalogo.length) return null;

  function guardar() {
    setError(null);
    if (!sel) { setError("Elige un proveedor."); return; }
    startTransition(async () => {
      const res = await asignarProveedorCuentaPorPagar(id, sel);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <span className="text-xs font-medium text-gray-500">
        {actual ? "Cambiar proveedor:" : "Asignar proveedor del catálogo:"}
      </span>
      <input
        list={`prov-cat-${id}`}
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        placeholder="Escribe para buscar…"
        className="min-w-[16rem] rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
      />
      <datalist id={`prov-cat-${id}`}>
        {catalogo.map((p) => <option key={p} value={p} />)}
      </datalist>
      <Button type="button" onClick={guardar} disabled={pending || sel === (actual ?? "")} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Guardando…" : "Asignar"}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
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
  const [trm, setTrm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const esUSD = (moneda ?? "COP").toUpperCase() === "USD";
  const usdEq = esUSD && Number(valor) > 0 && Number(trm) > 0 ? Number(valor) / Number(trm) : null;

  function handle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = Number(valor);
    if (!v || v <= 0) {
      setError("Ingresa un valor mayor a 0.");
      return;
    }
    if (esUSD && !(Number(trm) > 0)) {
      setError("Indica la TRM del día (cuenta en USD).");
      return;
    }
    startTransition(async () => {
      const res = await registrarPagoProveedor(id, v, fecha, esUSD ? Number(trm) : undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setValor("");
      setTrm("");
    });
  }

  return (
    <form onSubmit={handle} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{esUSD ? "Pagado (COP)" : "Valor"}</label>
          <Input
            type="number"
            min={0}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0"
            className="w-36"
          />
        </div>
        {esUSD && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">TRM del día</label>
            <Input type="number" min={0} value={trm} onChange={(e) => setTrm(e.target.value)} placeholder="4000" className="w-28" />
            <p className="mt-1 text-[11px] text-gray-400">{usdEq != null ? `abona ${formatMoneda(usdEq, "USD")}` : "COP por 1 USD"}</p>
          </div>
        )}
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
