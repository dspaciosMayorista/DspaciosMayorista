"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { calcComisionB2B } from "@/lib/calc/finanzas";
import { registrarPagoComisionB2B, deshacerUltimoPagoComisionB2B, actualizarComisionB2B } from "./actions";
import { ChevronDown, ChevronRight } from "lucide-react";

export type ComB2BRow = {
  id: number;
  numero_contrato: string;
  cliente: string | null;
  aliado: string | null;
  nit: string | null;
  tipoAliado?: string | null;
  pct_comision: number | null;
  totalComision: number;
  retencion: number;
  totalPagar: number | null;
  estado: string;
  fecha_pago: string | null;
  pagos: { id: number; fecha: string; valor: number }[];
  sinComision?: boolean;
  // Discriminación de la base comisionable (de dónde sale la comisión).
  precioVenta?: number;
  baseComision?: number;
  recobroTotal?: number;
  pctRecobroAliado?: number;
  aplicaRetencion?: boolean;
  pctRetencion?: number;
  comisionBase?: number;
  recobroAliado?: number;
};

type Filtro = "pendientes" | "pagadas" | "todas";
const esPagada = (e: string) => e === "pagada" || e === "pagado";

export function ComisionesList({ rows }: { rows: ComB2BRow[] }) {
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [q, setQ] = useState("");

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === "pendientes" && esPagada(r.estado)) return false;
      if (filtro === "pagadas" && !esPagada(r.estado)) return false;
      if (t) {
        const hay = `${r.numero_contrato} ${r.aliado ?? ""} ${r.cliente ?? ""}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [rows, filtro, q]);

  const tot = useMemo(() => {
    let total = 0, pagado = 0, pendiente = 0;
    for (const r of visibles) {
      const v = r.totalPagar ?? 0;
      const p = Math.min(r.pagos.reduce((s, x) => s + x.valor, 0), v);
      total += v;
      pagado += p;
      pendiente += Math.max(v - p, 0);
    }
    return { total, pagado, pendiente };
  }, [visibles]);

  return (
    <div>
      {/* Resumen */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tarjeta titulo="Total comisiones B2B" valor={tot.total} />
        <Tarjeta titulo="Pagado" valor={tot.pagado} tono="success" />
        <Tarjeta titulo="Pendiente por pagar" valor={tot.pendiente} tono="primary" />
      </div>

      {/* Controles */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(["pendientes", "pagadas", "todas"] as Filtro[]).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} className="rounded-md px-3 py-1.5"
              style={filtro === f ? { backgroundColor: "var(--brand-primary)", color: "white", fontWeight: 600 } : { color: "#4b5563" }}>
              {f === "pendientes" ? "Pendientes" : f === "pagadas" ? "Pagadas" : "Todas"}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato, aliado o cliente…" className="w-64 max-w-full" />
        <span className="ml-auto text-sm text-gray-500">{visibles.length} comisión(es)</span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Aliado</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">% Com.</th>
              <th className="px-4 py-3 text-right">A pagar</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No hay comisiones en este filtro.</td></tr>
            )}
            {visibles.map((r) => <Fila key={r.id} row={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fila({ row }: { row: ComB2BRow }) {
  const pagada = esPagada(row.estado);
  const parcial = row.estado === "parcial";
  const pagado = row.pagos.reduce((s, p) => s + p.valor, 0);
  const saldo = Math.max((row.totalPagar ?? 0) - pagado, 0);
  const [abierto, setAbierto] = useState(false);

  const linkContrato = (
    <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="font-mono font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
      {row.numero_contrato}
    </Link>
  );

  // Venta B2B sin comisión registrada todavía → invita a definirla en el contrato.
  if (row.sinComision) {
    return (
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-3">{linkContrato}</td>
        <td className="px-4 py-3 text-gray-700">{row.aliado ?? "—"}</td>
        <td className="px-4 py-3 text-gray-500">{row.cliente ?? "—"}</td>
        <td className="px-4 py-3 text-right text-gray-300">—</td>
        <td className="px-4 py-3 text-right text-gray-400">Por definir</td>
        <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Sin definir</span></td>
        <td className="px-4 py-3 text-right">
          <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
            Definir comisión →
          </Link>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-3">
          <button type="button" onClick={() => setAbierto((o) => !o)} className="mr-1 align-middle text-gray-400 hover:text-gray-600">
            {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {linkContrato}
        </td>
        <td className="px-4 py-3 text-gray-700">{row.aliado ?? "—"}</td>
        <td className="px-4 py-3 text-gray-500">{row.cliente ?? "—"}</td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{((row.pct_comision ?? 0) * 100).toFixed(1)}%</td>
        <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(row.totalPagar ?? 0)}</td>
        <td className="px-4 py-3">
          {pagada ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Pagada{row.fecha_pago ? ` · ${row.fecha_pago}` : ""}</span>
          ) : parcial ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Parcial · saldo {formatCOP(saldo)}</span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Pendiente</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-3">
            {row.tipoAliado !== "agencia" && (
              <Link
                href={`/portal/comision/${encodeURIComponent(row.numero_contrato)}`}
                target="_blank"
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--brand-accent)" }}
              >
                Cuenta de cobro
              </Link>
            )}
            <button type="button" onClick={() => setAbierto((o) => !o)} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
              {row.pagos.length > 0 ? `${row.pagos.length} abono(s)` : "Registrar abono"} →
            </button>
          </div>
        </td>
      </tr>
      {abierto && <FilaDetalle row={row} />}
    </>
  );
}

function DatoComision({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="tabular-nums text-gray-700">{valor}</div>
    </div>
  );
}

// Texto + inputMode (no type="number"): así se puede escribir/pegar el valor
// de una vez y seleccionar todo con un click, en vez de los spinners +/− del
// input numérico nativo (incómodos para montos grandes en pesos).
// ⚠️ Definido FUERA de FilaDetalle a propósito: un componente declarado
// dentro del cuerpo de otro se recrea (nueva identidad de función) en cada
// render del padre, y React lo trata como un tipo distinto — desmonta y
// vuelve a montar el <input>, perdiendo el foco en cada tecla.
function CampoComision({ label, value, onChange, width = "w-24" }: { label: string; value: string; onChange: (v: string) => void; width?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <Input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        onFocus={(e) => e.target.select()}
        className={`mt-0.5 h-7 ${width} text-xs`}
      />
    </div>
  );
}

// Discriminación: de dónde sale la comisión (PVP → base comisionable → % →
// comisión base + recobro − retención = a pagar), con la base comisionable
// editable (por defecto es PVP − impuesto/BNC, a veces hay que ajustarla).
function FilaDetalle({ row }: { row: ComB2BRow }) {
  const baseInicial = row.baseComision ?? row.precioVenta ?? 0;
  const recobroInicial = row.recobroTotal ?? 0;
  const pctRecobroInicial = row.pctRecobroAliado ?? 0.5;
  const pctInicial = row.pct_comision ?? 0;

  const [base, setBase] = useState(String(baseInicial));
  const [recobro, setRecobro] = useState(String(recobroInicial));
  const [pctRecobro, setPctRecobro] = useState(String(Math.round(pctRecobroInicial * 100)));
  // Cómo se ingresa la comisión: por % (default, como siempre) o por valor en
  // pesos -- mismos campos (Base comisionable, % comisión, Comisión), solo
  // cambia cuál de los dos últimos se edita y cuál queda calculado.
  const [modo, setModo] = useState<"pct" | "valor">("pct");
  const [pct, setPct] = useState(String(Math.round(pctInicial * 10000) / 100));
  const [valorComision, setValorComision] = useState(String(Math.round(baseInicial * pctInicial)));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const baseNum = Number(base) || 0;
  // % efectivo según el modo: en "pct" es lo tipeado en el campo %; en "valor"
  // se deriva del valor de comisión tipeado, dividido entre la base.
  const pctEfectivo = modo === "pct"
    ? (Number(pct) || 0) / 100
    : baseNum > 0 ? (Number(valorComision) || 0) / baseNum : 0;

  const preview = calcComisionB2B({
    precioVenta: row.precioVenta ?? 0,
    baseComisionable: baseNum,
    pctComision: pctEfectivo,
    recobroTotal: Number(recobro) || 0,
    pctRecobroAliado: (Number(pctRecobro) || 0) / 100,
    aplicaRetencion: row.aplicaRetencion ?? false,
    pctRetencion: row.pctRetencion ?? 0,
  });
  const cambio =
    baseNum !== baseInicial ||
    Math.abs(pctEfectivo - pctInicial) > 0.00005 ||
    Number(recobro) !== recobroInicial ||
    (Number(pctRecobro) || 0) / 100 !== pctRecobroInicial;

  // Cambiar de modo lleva el valor EFECTIVO actual al campo que se va a editar
  // (en vez de reaparecer con el dato viejo con el que arrancó el panel).
  function irAModoPct() {
    setPct(String(Math.round(pctEfectivo * 10000) / 100));
    setModo("pct");
  }
  function irAModoValor() {
    setValorComision(String(Math.round(baseNum * pctEfectivo)));
    setModo("valor");
  }

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarComisionB2B(row.id, {
        baseComision: baseNum,
        pctComision: pctEfectivo,
        recobroTotal: Number(recobro) || 0,
        pctRecobroAliado: (Number(pctRecobro) || 0) / 100,
      });
      if (r.ok) setMsg("Guardado ✓"); else setMsg(r.error);
    });
  }

  return (
    <tr className="border-b border-gray-100 bg-gray-50/60">
      <td colSpan={7} className="px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">De dónde sale la comisión</p>
          <div className="flex overflow-hidden rounded-lg border border-gray-300 text-[10px]">
            <button
              type="button"
              onClick={irAModoPct}
              className="px-2 py-1 font-medium"
              style={modo === "pct" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}
            >
              Ingresar por %
            </button>
            <button
              type="button"
              onClick={irAModoValor}
              className="px-2 py-1 font-medium"
              style={modo === "valor" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}
            >
              Ingresar por valor
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4 lg:grid-cols-8">
          <DatoComision label="Precio de venta (PVP)" valor={formatCOP(row.precioVenta ?? 0)} />
          <CampoComision label="Base comisionable" value={base} onChange={setBase} />
          {modo === "pct" ? (
            <CampoComision label="% comisión" value={pct} onChange={setPct} width="w-16" />
          ) : (
            <DatoComision label="% comisión" valor={`${(pctEfectivo * 100).toFixed(2)}%`} />
          )}
          {modo === "valor" ? (
            <CampoComision label="Comisión (valor)" value={valorComision} onChange={setValorComision} />
          ) : (
            <DatoComision label="Comisión (base × %)" valor={formatCOP(preview.comisionBase)} />
          )}
          <CampoComision label="Recobro total" value={recobro} onChange={setRecobro} />
          <CampoComision label="% recobro al aliado" value={pctRecobro} onChange={setPctRecobro} width="w-16" />
          <DatoComision label="+ Recobro aliado" valor={formatCOP(preview.recobroAliado)} />
          <DatoComision label="Retención" valor={row.aplicaRetencion ? `− ${formatCOP(preview.retencion)}` : "No aplica"} />
        </div>
        {modo === "valor" && baseNum <= 0 && (
          <p className="mt-1 text-[11px] text-amber-600">Define primero la base comisionable para poder calcular el %.</p>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2">
          <span className="text-xs text-gray-500">
            Comisión ({formatCOP(preview.comisionBase)}) + recobro aliado ({formatCOP(preview.recobroAliado)})
            {row.aplicaRetencion ? ` − retención (${formatCOP(preview.retencion)})` : ""} ={" "}
            <b className="text-sm" style={{ color: "var(--brand-primary)" }}>{formatCOP(preview.totalPagar)}</b>
          </span>
          <div className="flex items-center gap-2">
            {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
            {cambio && (
              <Button type="button" disabled={pending} onClick={guardar} className="h-7 px-3 text-[11px]" style={{ backgroundColor: "var(--brand-primary)" }}>
                {pending ? "Guardando…" : "Guardar cambios"}
              </Button>
            )}
          </div>
        </div>

        <PagoComisionPanel row={row} />
      </td>
    </tr>
  );
}

// Abonos/pagos parciales a la comisión (log ilimitado en comision_b2b_pagos,
// migración 131) — reemplaza el viejo "marcar pagada" todo-o-nada, para
// comisiones grandes que se pagan en varias cuotas.
function PagoComisionPanel({ row }: { row: ComB2BRow }) {
  const pagos = row.pagos;
  const pagado = pagos.reduce((s, p) => s + p.valor, 0);
  const total = row.totalPagar ?? 0;
  const saldo = Math.max(total - pagado, 0);

  const [valor, setValor] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [pendingUndo, startUndo] = useTransition();

  function registrar() {
    setErr("");
    const v = Number(valor);
    if (!v || v <= 0) { setErr("Ingresa un valor mayor a 0."); return; }
    start(async () => {
      const r = await registrarPagoComisionB2B(row.id, v, fecha);
      if (!r.ok) { setErr(r.error); return; }
      setValor("");
    });
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 border-t border-gray-200 pt-3 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Abonos registrados</p>
        {pagos.length === 0 ? (
          <p className="text-sm text-gray-400">Sin abonos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {pagos.map((p, i) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="py-1 text-gray-500">Abono {i + 1} · {p.fecha}</td>
                  <td className="py-1 text-right tabular-nums text-gray-700">{formatCOP(p.valor)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1 text-gray-600">Total pagado</td>
                <td className="py-1 text-right tabular-nums" style={{ color: "var(--brand-success)" }}>{formatCOP(pagado)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {pagos.length > 0 && (
          <button
            type="button"
            disabled={pendingUndo}
            onClick={() => startUndo(async () => void (await deshacerUltimoPagoComisionB2B(row.id)))}
            className="mt-2 text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
          >
            {pendingUndo ? "…" : "Deshacer último abono"}
          </button>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Registrar abono</p>
        {saldo <= 0 ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Esta comisión está totalmente pagada.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] text-gray-500">Valor</label>
              <Input type="number" min={0} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" className="w-32" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500">Fecha</label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-40" />
            </div>
            <Button type="button" onClick={registrar} disabled={pending} className="h-9" style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "…" : "Registrar abono"}
            </Button>
            <button type="button" onClick={() => setValor(String(saldo))} className="pb-2 text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
              Saldo total ({formatCOP(saldo)})
            </button>
          </div>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}

function Tarjeta({ titulo, valor, tono }: { titulo: string; valor: number; tono?: "primary" | "success" }) {
  const color = tono === "primary" ? "var(--brand-primary)" : tono === "success" ? "var(--brand-success)" : "#111827";
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color }}>{formatCOP(valor)}</div>
    </div>
  );
}
