"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { fechaNegocio } from "@/lib/fechaNegocio";
import {
  baseParaEditor,
  calcularComisionFila,
  prepararEdicionComision,
  type EdicionComisionInput,
  type FilaComisionB2B,
} from "@/lib/finanzas/comisionB2B";
import { registrarPagoComisionB2B, deshacerUltimoPagoComisionB2B, actualizarComisionB2B } from "./actions";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";

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
  // pendiente | parcial | pagada | descontada | revision_neto | sin_definir
  estado: string;
  fecha_pago: string | null;
  pagos: { id: number; fecha: string; valor: number }[];
  sinComision?: boolean;
  // La agencia ya descontó la comisión del precio (modo neta): no es saldo por
  // pagar, no admite abonos ni cuenta de cobro.
  descontada?: boolean;
  // Otra fila B2B de un contrato vendido NETO: la comisión B2B del aliado ya se
  // descontó del precio; no admite abonos nuevos ni es saldo por pagar. Sus
  // abonos históricos se conservan y se muestran (revisión manual).
  enNeto?: boolean;
  // Fila tal como está guardada (para el editor "De dónde sale la comisión").
  fila?: FilaComisionB2B;
  precioVenta?: number;
  comisionBase?: number;
  recobroAliado?: number;
  aplicaRetencion?: boolean;
};

type Filtro = "pendientes" | "pagadas" | "todas";
// "Pagadas" agrupa lo que ya no es saldo: pagadas y descontadas en el precio.
const esLiquidada = (e: string) => e === "pagada" || e === "pagado" || e === "descontada";

export function ComisionesList({ rows }: { rows: ComB2BRow[] }) {
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [q, setQ] = useState("");

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === "pendientes" && esLiquidada(r.estado)) return false;
      if (filtro === "pagadas" && !esLiquidada(r.estado)) return false;
      if (t) {
        const hay = `${r.numero_contrato} ${r.aliado ?? ""} ${r.cliente ?? ""}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [rows, filtro, q]);

  const tot = useMemo(() => {
    let total = 0, pagado = 0, pendiente = 0, descontado = 0, enRevision = 0, nRevision = 0;
    for (const r of visibles) {
      const v = r.totalPagar ?? 0;
      // Segunda fila B2B de un contrato NETO: aparte (no es saldo por pagar).
      if (r.estado === "revision_neto") { enRevision += v; nRevision += 1; continue; }
      // Solo las descontadas SIN abonos salen de los totales: las NETO anteriores
      // a la 131 tienen su abono sintético y se suman como siempre (no se
      // reinterpretan).
      if (r.estado === "descontada") { descontado += v; continue; }
      const p = Math.min(r.pagos.reduce((s, x) => s + x.valor, 0), v);
      total += v;
      pagado += p;
      pendiente += Math.max(v - p, 0);
    }
    return { total, pagado, pendiente, descontado, enRevision, nRevision };
  }, [visibles]);

  return (
    <div>
      {/* Resumen */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tarjeta titulo="Total comisiones B2B" valor={tot.total} />
        <Tarjeta titulo="Pagado" valor={tot.pagado} tono="success" />
        <Tarjeta titulo="Pendiente por pagar" valor={tot.pendiente} tono="primary" />
      </div>
      {tot.descontado > 0 && (
        <p className="-mt-3 mb-4 text-xs text-gray-500">
          Además, {formatCOP(tot.descontado)} en comisiones descontadas del precio de venta (modo neta): no son saldo por pagar.
        </p>
      )}
      {tot.nRevision > 0 && (
        <p className="-mt-3 mb-4 text-xs text-amber-700">
          {tot.nRevision} comisión(es) B2B adicional(es) en contratos vendidos en modo neta ({formatCOP(tot.enRevision)}): la comisión B2B ya se descontó del precio, no admiten abonos y quedan en revisión manual. Sus abonos anteriores se conservan.
        </p>
      )}

      {/* Controles */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(["pendientes", "pagadas", "todas"] as Filtro[]).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} className="rounded-md px-3 py-1.5"
              style={filtro === f ? { backgroundColor: "var(--brand-primary)", color: "white", fontWeight: 600 } : { color: "#4b5563" }}>
              {f === "pendientes" ? "Pendientes" : f === "pagadas" ? "Pagadas / descontadas" : "Todas"}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato, aliado o cliente…" className="w-64 max-w-full" />
        <span className="ml-auto text-sm text-gray-500">{visibles.length} comisión(es)</span>
      </div>

      {/* Tabla */}
      <ResponsiveTableShell minWidth={820} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Aliado</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">% Com.</th>
              <th className="px-4 py-3 text-right">A pagar</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No hay comisiones en este filtro.</td></tr>
            )}
            {visibles.map((r) => <Fila key={r.id} row={r} />)}
          </tbody>
        </table>
      </ResponsiveTableShell>
    </div>
  );
}

function BadgeDescontada() {
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Descontada en el precio</span>;
}

function Fila({ row }: { row: ComB2BRow }) {
  const pagada = row.estado === "pagada" || row.estado === "pagado";
  const parcial = row.estado === "parcial";
  const pagado = row.pagos.reduce((s, p) => s + p.valor, 0);
  const saldo = Math.max((row.totalPagar ?? 0) - pagado, 0);
  const [abierto, setAbierto] = useState(false);

  const linkContrato = (
    <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="font-mono font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>
      {row.numero_contrato}
    </Link>
  );

  // Venta B2B sin comisión registrada todavía.
  if (row.sinComision) {
    return (
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-3" data-label="Contrato">{linkContrato}</td>
        <td className="px-4 py-3 text-gray-700" data-label="Aliado">{row.aliado ?? "—"}</td>
        <td className="px-4 py-3 text-gray-500" data-label="Cliente">{row.cliente ?? "—"}</td>
        <td className="px-4 py-3 text-right text-gray-300" data-label="% Com.">—</td>
        {row.descontada ? (
          // NETO sin fila de comisión (p. ej. la reserva la hizo la propia
          // agencia): ya se descontó del precio, no hay nada que definir ni pagar.
          <>
            <td className="px-4 py-3 text-right tabular-nums text-gray-400" data-label="A pagar">{formatCOP(row.totalPagar ?? 0)}</td>
            <td className="px-4 py-3" data-label="Estado"><BadgeDescontada /></td>
            <td className="px-4 py-3 text-right text-xs text-gray-400" data-label="Acciones">Sin saldo por pagar</td>
          </>
        ) : (
          <>
            <td className="px-4 py-3 text-right text-gray-400" data-label="A pagar">Por definir</td>
            <td className="px-4 py-3" data-label="Estado"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Sin definir</span></td>
            <td className="px-4 py-3 text-right" data-label="Acciones">
              <Link href={`/dashboard/contratos/${encodeURIComponent(row.numero_contrato)}`} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
                Definir comisión →
              </Link>
            </td>
          </>
        )}
      </tr>
    );
  }

  const idParam = `?id=${row.id}`;
  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="px-4 py-3" data-label="Contrato">
          <button type="button" onClick={() => setAbierto((o) => !o)} className="mr-1 align-middle text-gray-400 hover:text-gray-600">
            {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {linkContrato}
        </td>
        <td className="px-4 py-3 text-gray-700" data-label="Aliado">{row.aliado ?? "—"}</td>
        <td className="px-4 py-3 text-gray-500" data-label="Cliente">{row.cliente ?? "—"}</td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-600" data-label="% Com.">{((row.pct_comision ?? 0) * 100).toFixed(1)}%</td>
        <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: row.descontada ? "#9ca3af" : "var(--brand-primary)" }} data-label="A pagar">{formatCOP(row.totalPagar ?? 0)}</td>
        <td className="px-4 py-3" data-label="Estado">
          {row.estado === "descontada" ? (
            <BadgeDescontada />
          ) : row.estado === "revision_neto" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">NETO · revisión manual</span>
          ) : pagada ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Pagada{row.fecha_pago ? ` · ${row.fecha_pago}` : ""}</span>
          ) : parcial ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Parcial · saldo {formatCOP(saldo)}</span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Pendiente</span>
          )}
        </td>
        <td className="px-4 py-3 text-right" data-label="Acciones">
          <div className="flex items-center justify-end gap-3">
            {/* Una comisión descontada en el precio no tiene cuenta de cobro ni estado de cuenta. */}
            {!row.descontada && !row.enNeto && row.tipoAliado !== "agencia" && (
              <Link
                href={`/portal/comision/${encodeURIComponent(row.numero_contrato)}${idParam}`}
                target="_blank"
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--brand-accent)" }}
              >
                Cuenta de cobro
              </Link>
            )}
            {!row.descontada && !row.enNeto && (
              <Link
                href={`/portal/comision/${encodeURIComponent(row.numero_contrato)}/estado-cuenta${idParam}`}
                target="_blank"
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--brand-accent)" }}
              >
                Estado de cuenta
              </Link>
            )}
            <button type="button" onClick={() => setAbierto((o) => !o)} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>
              {row.descontada || row.enNeto ? "Ver detalle" : row.pagos.length > 0 ? `${row.pagos.length} abono(s)` : "Registrar abono"} →
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
// `decimal`: para porcentajes (admite 9,23 / 9.23); los pesos van enteros.
function CampoComision({ label, value, onChange, width = "w-24", decimal = false, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; width?: string; decimal?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <Input
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value.replace(decimal ? /[^\d.,]/g : /[^\d]/g, ""))}
        onFocus={(e) => e.target.select()}
        className={`mt-0.5 h-7 ${width} text-xs`}
      />
    </div>
  );
}

// Casilla vacía = null (ausente); "0" = cero legítimo.
const leer = (v: string, decimal = false): number | null => {
  const t = v.trim();
  if (t === "") return null;
  return decimal ? Number(t.replace(",", ".")) : Number(t);
};
const pctTexto = (f: number) => String(Math.round(f * 10000) / 100);

// Discriminación: de dónde sale la comisión (PVP → base comisionable → % o
// valor → comisión base + recobro − retención = a pagar). Las reglas de la
// edición viven en prepararEdicionComision (lib/finanzas/comisionB2B.ts).
function FilaDetalle({ row }: { row: ComB2BRow }) {
  const fila = row.fila;
  if (fila) return <EditorComision row={row} fila={fila} />;
  return (
    <tr className="border-b border-gray-100 bg-gray-50/60">
      <td colSpan={7} className="px-4 py-3"><PagoComisionPanel row={row} /></td>
    </tr>
  );
}

function EditorComision({ row, fila }: { row: ComB2BRow; fila: FilaComisionB2B }) {
  return (
    <tr className="border-b border-gray-100 bg-gray-50/60">
      <td colSpan={7} className="px-4 py-3">
        <EditorCamposComision id={row.id} fila={fila} conAbonos={row.pagos.length > 0} descontada={!!row.descontada} aplicaRetencion={!!row.aplicaRetencion} />
        <PagoComisionPanel row={row} />
      </td>
    </tr>
  );
}

/**
 * Editor "De dónde sale la comisión" (base, % o valor exacto, recobro). Lo usan
 * Comisiones y la pestaña del contrato (ahí también el asesor `venta` en SU
 * contrato). `conAbonos`/`descontada` solo avisan: quien decide es el servidor
 * y, al final, el trigger de la 205.
 */
export function EditorCamposComision({ id, fila, conAbonos, descontada, aplicaRetencion }: {
  id: number; fila: FilaComisionB2B; conAbonos: boolean; descontada: boolean; aplicaRetencion: boolean;
}) {
  const actual = calcularComisionFila(fila);
  const [base, setBase] = useState(baseParaEditor(fila));
  const [modo, setModo] = useState<"pct" | "valor">(fila.comision_valor != null ? "valor" : "pct");
  const [pct, setPct] = useState(pctTexto(Number(fila.pct_comision) || 0));
  const [valorComision, setValorComision] = useState(String(Math.round(actual.comisionBase)));
  const [recobro, setRecobro] = useState(String(Number(fila.recobro_total) || 0));
  const [pctRecobro, setPctRecobro] = useState(pctTexto(fila.pct_recobro_aliado == null ? 0.5 : Number(fila.pct_recobro_aliado)));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const entrada: EdicionComisionInput = {
    base: leer(base),
    modo,
    pct: (() => { const p = leer(pct, true); return p == null ? null : p / 100; })(),
    valor: leer(valorComision),
    recobroTotal: leer(recobro),
    pctRecobroAliado: (() => { const p = leer(pctRecobro, true); return p == null ? null : p / 100; })(),
  };
  const prep = prepararEdicionComision(fila, entrada);
  const preview = prep.ok ? calcularComisionFila({ ...fila, ...prep.cambios }) : actual;
  const cambio = prep.ok && (
    prep.cambios.base_comision !== undefined ||
    Math.abs(prep.cambios.pct_comision - (Number(fila.pct_comision) || 0)) > 0.00005 ||
    (prep.cambios.comision_valor ?? null) !== (fila.comision_valor == null ? null : Number(fila.comision_valor)) ||
    prep.cambios.recobro_total !== (Number(fila.recobro_total) || 0) ||
    (prep.cambios.pct_recobro_aliado !== undefined &&
      Math.abs(prep.cambios.pct_recobro_aliado - (fila.pct_recobro_aliado == null ? 0.5 : Number(fila.pct_recobro_aliado))) > 0.00005)
  );
  const totalCambia = Math.abs(preview.totalPagar - actual.totalPagar) >= 0.005;
  const bloqueadoTotal = (conAbonos || descontada) && totalCambia;

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarComisionB2B(id, entrada);
      setMsg(r.ok ? "Guardado" : r.error);
    });
  }

  // Al cambiar de modo se lleva el valor EFECTIVO actual al campo que se va a editar.
  function irAModoPct() {
    if (prep.ok) setPct(pctTexto(prep.cambios.pct_comision));
    setModo("pct");
  }
  function irAModoValor() {
    setValorComision(String(Math.round(preview.comisionBase)));
    setModo("valor");
  }

  return (
    <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">De dónde sale la comisión</p>
          <div className="flex overflow-hidden rounded-lg border border-gray-300 text-[10px]">
            <button type="button" onClick={irAModoPct} className="px-2 py-1 font-medium"
              style={modo === "pct" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}>
              Ingresar por %
            </button>
            <button type="button" onClick={irAModoValor} className="px-2 py-1 font-medium"
              style={modo === "valor" ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}>
              Ingresar por valor
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4 lg:grid-cols-8">
          <DatoComision label="Precio de venta (PVP)" valor={formatCOP(Number(fila.precio_venta) || 0)} />
          <CampoComision label="Base comisionable" value={base} onChange={setBase} placeholder="Sin base (usa el PVP)" width="w-28" />
          {modo === "pct" ? (
            <CampoComision label="% comisión" value={pct} onChange={setPct} width="w-16" decimal />
          ) : (
            <DatoComision label="% comisión (informativo)" valor={prep.ok ? `${(prep.cambios.pct_comision * 100).toFixed(2)}%` : "—"} />
          )}
          {modo === "valor" ? (
            <CampoComision label="Comisión (valor)" value={valorComision} onChange={setValorComision} />
          ) : (
            <DatoComision label="Comisión (base × %)" valor={formatCOP(preview.comisionBase)} />
          )}
          <CampoComision label="Recobro total" value={recobro} onChange={setRecobro} />
          <CampoComision label="% recobro al aliado" value={pctRecobro} onChange={setPctRecobro} width="w-16" decimal />
          <DatoComision label="+ Recobro aliado" valor={formatCOP(preview.recobroAliado)} />
          <DatoComision label="Retención" valor={aplicaRetencion ? `− ${formatCOP(preview.retencion)}` : "No aplica"} />
        </div>
        {!prep.ok && <p className="mt-1 text-[11px] text-amber-600">{prep.error}</p>}
        {bloqueadoTotal && (
          <p className="mt-1 text-[11px] text-amber-600">
            {descontada
              ? "Esta comisión se descontó del precio de venta: su total no se puede cambiar."
              : "Esta comisión ya tiene abonos: el cambio alteraría su total. Deshaz los abonos primero."}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2">
          <span className="text-xs text-gray-500">
            Comisión ({formatCOP(preview.comisionBase)}) + recobro aliado ({formatCOP(preview.recobroAliado)})
            {aplicaRetencion ? ` − retención (${formatCOP(preview.retencion)})` : ""} ={" "}
            <b className="text-sm" style={{ color: "var(--brand-primary)" }}>{formatCOP(preview.totalPagar)}</b>
          </span>
          <div className="flex items-center gap-2">
            {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
            {cambio && !bloqueadoTotal && (
              <Button type="button" disabled={pending} onClick={guardar} className="h-7 px-3 text-[11px]" style={{ backgroundColor: "var(--brand-primary)" }}>
                {pending ? "Guardando…" : "Guardar cambios"}
              </Button>
            )}
          </div>
        </div>
    </div>
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
  const [fecha, setFecha] = useState(() => fechaNegocio());
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

  function deshacer() {
    setErr("");
    startUndo(async () => {
      const r = await deshacerUltimoPagoComisionB2B(row.id);
      if (!r.ok) setErr(r.error);
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
            onClick={deshacer}
            className="mt-2 text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
          >
            {pendingUndo ? "…" : "Deshacer último abono"}
          </button>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Registrar abono</p>
        {row.descontada ? (
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            La agencia descontó esta comisión del precio de venta (modo neta): no es saldo por pagar y no admite abonos.
          </p>
        ) : row.enNeto ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Este contrato se vendió en modo neta: la comisión B2B del aliado ya se descontó del precio, así que esta fila no admite abonos. Queda para revisión manual; sus abonos anteriores se conservan.
          </p>
        ) : saldo <= 0 ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Esta comisión está totalmente pagada.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] text-gray-500">Valor</label>
              <Input type="number" min={0} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" className="w-32" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500">Fecha</label>
              <DateInput aria-label="Fecha" type="date" value={fecha} onValueChange={(dateValue) => setFecha(dateValue)} className="w-40" />
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
