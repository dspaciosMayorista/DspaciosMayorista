"use client";

import { useState, useTransition } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import {
  calcComisionB2B,
  calcComisionAsesorBase,
  calcRentabilidad,
  FISCAL_DEFAULT,
  type Rentabilidad,
  type ParamsFiscales,
} from "@/lib/calc/finanzas";
import { AbonoForm } from "./AbonoForm";
import {
  guardarCostos,
  crearCuentaPorPagar,
  actualizarCuentaPorPagar,
  eliminarCuentaPorPagar,
  crearComisionB2B,
  eliminarComisionB2B,
  crearFactura,
  eliminarFactura,
} from "./gestion-actions";

type Abono = { id: number; valor_abono: number; forma_pago: string | null; referencia: string | null; fecha_abono: string };
type CxP = { id: number; proveedor: string | null; servicio: string | null; valor_total: number; base_gravable: number | null; iva_proveedor: number | null; fecha_vencimiento: string | null; aplica_retencion: boolean; pct_retencion: number };
type B2B = { id: number; aliado: string | null; precio_venta: number; pct_comision: number; recobro_total: number; pct_recobro_aliado: number; aplica_retencion: boolean; pct_retencion: number };
type FacturaItem = { descripcion: string | null; valor: number; gravable: boolean };
type Factura = { id: number; numero_factura: string | null; fecha_factura: string | null; base_gravable: number; base_no_gravable: number; estado_dian: string | null; items: FacturaItem[] };

export type GestionProps = {
  numero: string;
  precioVenta: number;
  impuesto: number; // BNC (Base No Comisionable) del contrato
  clienteNombre: string;
  clienteDocumento: string;
  asesorNombre: string;
  asesorPct: number;
  fiscal?: ParamsFiscales;
  verFinanzas: boolean; // false para el rol 'venta' (asesor): oculta costos/comisiones/rentabilidad
  costos: { costo_hotel: number; costo_aereo: number; costo_receptivo: number; costo_asistencia: number; otros_costos: number };
  abonos: Abono[];
  totalPagado: number;
  cuentasPorPagar: CxP[];
  comisionesB2B: B2B[];
  facturas: Factura[];
  formasPago: string[];
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const card = "rounded-xl border border-gray-300 bg-white p-4 shadow-sm sm:p-5";

export function GestionTabs(p: GestionProps) {
  // ── Cálculos vivos ──────────────────────────────────────────────
  const costoDirecto =
    p.costos.costo_hotel + p.costos.costo_aereo + p.costos.costo_receptivo +
    p.costos.costo_asistencia + p.costos.otros_costos;

  const comB2BTotal = p.comisionesB2B.reduce(
    (s, b) => s + calcComisionB2B({
      precioVenta: b.precio_venta, pctComision: b.pct_comision,
      recobroTotal: b.recobro_total, pctRecobroAliado: b.pct_recobro_aliado,
      aplicaRetencion: b.aplica_retencion, pctRetencion: b.pct_retencion,
    }).totalPagar, 0
  );

  const fiscal = p.fiscal ?? FISCAL_DEFAULT;

  // Comisión del asesor sobre la BASE COMISIONABLE = PVP − BNC (impuesto).
  const comAsesor = calcComisionAsesorBase({
    precioVenta: p.precioVenta, impuesto: p.impuesto,
    pctBase: p.asesorPct, retHonorarios: fiscal.RETENCION_HONORARIOS,
  });

  const ivaGenerado = p.facturas.reduce((s, f) => s + f.base_gravable * fiscal.IVA, 0);
  // El IVA descontable viene de las facturas de los PROVEEDORES (cuentas por pagar).
  const ivaDescontable = p.cuentasPorPagar.reduce((s, c) => s + (c.iva_proveedor ?? 0), 0);

  const rent = calcRentabilidad({
    precioVenta: p.precioVenta, costoDirecto, comB2B: comB2BTotal,
    comAsesor: comAsesor.comisionNeta, ivaGenerado, ivaDescontable, fiscal,
  });

  return (
    <div className="mt-8">
      <Tabs defaultValue="cartera" orientation="vertical">
        <TabsList className="w-full shrink-0 sm:w-48">
          <TabsTrigger value="cartera">Cartera</TabsTrigger>
          {p.verFinanzas && <TabsTrigger value="costos">Costos</TabsTrigger>}
          {p.verFinanzas && <TabsTrigger value="proveedores">Proveedores</TabsTrigger>}
          {p.verFinanzas && <TabsTrigger value="comisiones">Comisiones</TabsTrigger>}
          {p.verFinanzas && <TabsTrigger value="facturacion">Facturación</TabsTrigger>}
          {p.verFinanzas && <TabsTrigger value="rentabilidad">Rentabilidad</TabsTrigger>}
        </TabsList>

        <div className="min-w-0 flex-1">
        <TabsContent value="cartera">
          <CarteraTab numero={p.numero} abonos={p.abonos} totalPagado={p.totalPagado} total={p.precioVenta} formasPago={p.formasPago} />
        </TabsContent>
        {p.verFinanzas && (
          <>
            <TabsContent value="costos">
              <CostosTab numero={p.numero} costos={p.costos} />
            </TabsContent>
            <TabsContent value="proveedores">
              <ProveedoresTab numero={p.numero} filas={p.cuentasPorPagar} />
            </TabsContent>
            <TabsContent value="comisiones">
              <ComisionesTab numero={p.numero} precioVenta={p.precioVenta} impuesto={p.impuesto} filas={p.comisionesB2B}
                comB2BTotal={comB2BTotal} comAsesor={comAsesor} asesorNombre={p.asesorNombre} asesorPct={p.asesorPct} fiscal={fiscal} />
            </TabsContent>
            <TabsContent value="facturacion">
              <FacturacionTab numero={p.numero} filas={p.facturas} ivaGenerado={ivaGenerado} ivaPct={fiscal.IVA}
                clienteNombre={p.clienteNombre} clienteDocumento={p.clienteDocumento} totalContrato={p.precioVenta} />
            </TabsContent>
            <TabsContent value="rentabilidad">
              <RentabilidadTab rent={rent} />
            </TabsContent>
          </>
        )}
        </div>
      </Tabs>
    </div>
  );
}

// ── COSTOS ─────────────────────────────────────────────────────────────
function CostosTab({ numero, costos }: { numero: string; costos: GestionProps["costos"] }) {
  const [v, setV] = useState(costos);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const total = v.costo_hotel + v.costo_aereo + v.costo_receptivo + v.costo_asistencia + v.otros_costos;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) || 0 });

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await guardarCostos(numero, v);
      setMsg(r.ok ? "✓ Costos guardados" : r.error);
    });
  }

  const campos: [keyof typeof v, string][] = [
    ["costo_hotel", "Costo hotel"], ["costo_aereo", "Costo aéreo"],
    ["costo_receptivo", "Costo receptivo"], ["costo_asistencia", "Costo asistencia"],
    ["otros_costos", "Otros costos"],
  ];

  return (
    <div className={card}>
      <p className="mb-4 text-sm text-gray-500">Costos netos por proveedor. Alimentan la rentabilidad.</p>
      <div className="max-w-xl space-y-3">
        {campos.map(([k, label]) => (
          <div key={k} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <label className="w-40 shrink-0 text-sm font-medium text-gray-600">{label}</label>
            <Input type="number" min={0} value={v[k] || ""} onChange={set(k)} placeholder="0" className="sm:flex-1" />
            <span className="w-32 shrink-0 text-right text-sm tabular-nums text-gray-500">{formatCOP(v[k] || 0)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="w-40 shrink-0 text-sm font-semibold text-gray-700">Costo directo total</span>
          <b className="text-sm tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(total)}</b>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar costos"}
        </Button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </div>
  );
}

// ── CARTERA (abonos) ───────────────────────────────────────────────────
function CarteraTab({ numero, abonos, totalPagado, total, formasPago }: { numero: string; abonos: Abono[]; totalPagado: number; total: number; formasPago: string[] }) {
  const saldo = Math.max(total - totalPagado, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Mini label="Total" value={formatCOP(total)} />
        <Mini label="Pagado" value={formatCOP(totalPagado)} color="var(--brand-success)" />
        <Mini label="Saldo" value={formatCOP(saldo)} />
      </div>
      <div className={card}>
        <p className={lbl}>Registrar abono</p>
        <AbonoForm numeroContrato={numero} formasPago={formasPago} />
      </div>
      {abonos.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Fecha</th><th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2">Forma</th><th className="px-4 py-2">Referencia</th>
            </tr></thead>
            <tbody>{abonos.map((a) => (
              <tr key={a.id} className="border-t border-gray-50">
                <td className="px-4 py-2 text-gray-500">{a.fecha_abono}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCOP(a.valor_abono)}</td>
                <td className="px-4 py-2 text-gray-500">{a.forma_pago ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{a.referencia ?? "—"}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── PROVEEDORES (cuentas por pagar) ────────────────────────────────────
function ProveedoresTab({ numero, filas }: { numero: string; filas: CxP[] }) {
  const [proveedor, setProveedor] = useState("");
  const [tipo, setTipo] = useState("");
  const [servicio, setServicio] = useState("");
  const [valor, setValor] = useState("");
  const [venc, setVenc] = useState("");
  const [ret, setRet] = useState(false);
  const [pctRet, setPctRet] = useState("");
  const [esFactura, setEsFactura] = useState(false); // factura de proveedor → discrimina IVA
  const [iva, setIva] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const totalCxP = filas.reduce((s, f) => s + f.valor_total, 0);
  const totalIva = filas.reduce((s, f) => s + (f.iva_proveedor ?? 0), 0);

  const valorNum = Number(valor) || 0;
  const ivaNum = esFactura ? Number(iva) || 0 : 0;
  const costoNum = Math.max(0, valorNum - ivaNum); // costo = total − IVA descontable

  function agregar() {
    if (!proveedor.trim() || !Number(valor)) return;
    setErr("");
    start(async () => {
      const r = await crearCuentaPorPagar({
        numeroContrato: numero, proveedor, tipoProveedor: tipo, servicio,
        valorTotal: valorNum, fechaVencimiento: venc,
        aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
        ivaDescontable: ivaNum,
      });
      if (r.ok) { setProveedor(""); setTipo(""); setServicio(""); setValor(""); setVenc(""); setRet(false); setPctRet(""); setEsFactura(false); setIva(""); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={lbl}>Agregar cuenta por pagar</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Input placeholder="Proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
          <Input placeholder="Tipo (hotel, aéreo…)" value={tipo} onChange={(e) => setTipo(e.target.value)} />
          <Input placeholder="Servicio" value={servicio} onChange={(e) => setServicio(e.target.value)} />
          <Input type="number" min={0} placeholder="Valor total" value={valor} onChange={(e) => setValor(e.target.value)} />
          <Input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} /> Retención
            {ret && <Input type="number" className="w-20" placeholder="%" value={pctRet} onChange={(e) => setPctRet(e.target.value)} />}
          </label>
        </div>

        {/* Factura de proveedor: discriminar costo / IVA descontable (manual) */}
        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={esFactura} onChange={(e) => setEsFactura(e.target.checked)} />
          Factura de proveedor (discriminar IVA descontable)
        </label>
        {esFactura && (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">IVA descontable</label>
              <Input type="number" min={0} placeholder="0" value={iva} onChange={(e) => setIva(e.target.value)} className="w-40" />
            </div>
            <div className="text-xs text-gray-500">
              Costo (base): <b className="text-gray-700">{formatCOP(costoNum)}</b>
              <span className="mx-2">·</span>
              IVA: <b className="text-gray-700">{formatCOP(ivaNum)}</b>
              <span className="mx-2">·</span>
              Total: <b style={{ color: "var(--brand-primary)" }}>{formatCOP(valorNum)}</b>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Agregar"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Proveedor</th><th className="px-4 py-2">Servicio</th>
              <th className="px-4 py-2 text-right">Costo</th><th className="px-4 py-2 text-right">IVA desc.</th>
              <th className="px-4 py-2 text-right">Valor</th><th className="px-4 py-2">Vence</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{filas.map((f) => <FilaCxP key={f.id} f={f} numero={numero} />)}</tbody>
            <tfoot><tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2" colSpan={3}>Total por pagar</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-500">{totalIva > 0 ? formatCOP(totalIva) : "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatCOP(totalCxP)}</td><td colSpan={2} />
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// Fila de cuenta por pagar con edición inline (para agregar el IVA a las CxP
// creadas automáticamente con el contrato, o corregir cualquier dato).
function FilaCxP({ f, numero }: { f: CxP; numero: string }) {
  const [editar, setEditar] = useState(false);
  const ivaF = f.iva_proveedor ?? 0;
  const costoF = f.base_gravable ?? (f.valor_total - ivaF);

  const [proveedor, setProveedor] = useState(f.proveedor ?? "");
  const [servicio, setServicio] = useState(f.servicio ?? "");
  const [valor, setValor] = useState(String(f.valor_total));
  const [iva, setIva] = useState(ivaF ? String(ivaF) : "");
  const [venc, setVenc] = useState(f.fecha_vencimiento ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function guardar() {
    setErr("");
    start(async () => {
      const r = await actualizarCuentaPorPagar({
        id: f.id, numeroContrato: numero, proveedor, servicio,
        valorTotal: Number(valor) || 0, fechaVencimiento: venc, ivaDescontable: Number(iva) || 0,
      });
      if (r.ok) setEditar(false); else setErr(r.error);
    });
  }

  if (editar) {
    const costoEd = Math.max(0, (Number(valor) || 0) - (Number(iva) || 0));
    return (
      <tr className="border-t border-gray-100 bg-gray-50/60">
        <td className="px-4 py-2" colSpan={7}>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="block text-[11px] text-gray-500">Proveedor</label><Input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="w-40" /></div>
            <div><label className="block text-[11px] text-gray-500">Servicio</label><Input value={servicio} onChange={(e) => setServicio(e.target.value)} className="w-44" /></div>
            <div><label className="block text-[11px] text-gray-500">Valor total</label><Input type="number" value={valor} onChange={(e) => setValor(e.target.value)} className="w-32" /></div>
            <div><label className="block text-[11px] text-gray-500">IVA descontable</label><Input type="number" value={iva} onChange={(e) => setIva(e.target.value)} className="w-32" placeholder="0" /></div>
            <div><label className="block text-[11px] text-gray-500">Vence</label><Input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} className="w-40" /></div>
            <span className="pb-2 text-xs text-gray-500">Costo: <b className="text-gray-700">{formatCOP(costoEd)}</b></span>
            <Button onClick={guardar} disabled={pending} className="h-9" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar"}</Button>
            <button type="button" onClick={() => setEditar(false)} className="pb-2 text-xs text-gray-400 hover:text-gray-700">Cancelar</button>
            {err && <span className="pb-2 text-xs text-red-600">{err}</span>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 text-gray-700">{f.proveedor ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{f.servicio ?? "—"}</td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatCOP(costoF)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-500">{ivaF > 0 ? formatCOP(ivaF) : "—"}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatCOP(f.valor_total)}</td>
      <td className="px-4 py-2 text-gray-500">{f.fecha_vencimiento ?? "—"}</td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={() => setEditar(true)} className="mr-3 text-xs font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>Editar</button>
        <DeleteBtn onClick={() => eliminarCuentaPorPagar(f.id, numero)} />
      </td>
    </tr>
  );
}

// ── COMISIONES (B2B + asesor) ──────────────────────────────────────────
function ComisionesTab({ numero, precioVenta, impuesto, filas, comB2BTotal, comAsesor, asesorNombre, asesorPct, fiscal }: {
  numero: string; precioVenta: number; impuesto: number; filas: B2B[]; comB2BTotal: number;
  comAsesor: ReturnType<typeof calcComisionAsesorBase>; asesorNombre: string; asesorPct: number; fiscal: ParamsFiscales;
}) {
  const [aliado, setAliado] = useState("");
  const [nit, setNit] = useState("");
  const [pct, setPct] = useState("");
  const [recobro, setRecobro] = useState("");
  const [pctRec, setPctRec] = useState("50");
  const [ret, setRet] = useState(false);
  const [pctRet, setPctRet] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function agregar() {
    if (!aliado.trim() || !Number(pct)) return;
    setErr("");
    start(async () => {
      const r = await crearComisionB2B({
        numeroContrato: numero, aliado, nit, precioVenta,
        pctComision: Number(pct) / 100, recobroTotal: Number(recobro) || 0,
        pctRecobroAliado: Number(pctRec) / 100 || 0.5,
        aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
      });
      if (r.ok) { setAliado(""); setNit(""); setPct(""); setRecobro(""); setPctRec("50"); setRet(false); setPctRet(""); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-4">
      {/* Comisión asesor (calculada) — vertical */}
      <Resumen
        titulo="Comisión del asesor"
        subtitulo={`${asesorNombre || "—"} · base ${(asesorPct * 100).toFixed(0)}%`}
        filas={[
          { label: "Precio de venta (PVP)", value: formatCOP(precioVenta) },
          { label: "(−) BNC / impuesto", value: impuesto > 0 ? `− ${formatCOP(impuesto)}` : "Sin BNC" },
          { label: "= Base comisionable", value: formatCOP(comAsesor.baseComisionable), strong: true },
          { label: `Comisión bruta (${(asesorPct * 100).toFixed(0)}%)`, value: formatCOP(comAsesor.comisionBruta) },
          { label: `(−) Retención (${(fiscal.RETENCION_HONORARIOS * 100).toFixed(0)}%)`, value: `− ${formatCOP(comAsesor.retencion)}` },
          { label: "= Comisión neta", value: formatCOP(comAsesor.comisionNeta), strong: true, color: "var(--brand-primary)" },
        ]}
      />

      {/* Comisiones B2B */}
      <div className={card}>
        <p className={lbl}>Agregar comisión B2B (aliado)</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Input placeholder="Aliado" value={aliado} onChange={(e) => setAliado(e.target.value)} />
          <Input placeholder="NIT" value={nit} onChange={(e) => setNit(e.target.value)} />
          <Input type="number" placeholder="% comisión" value={pct} onChange={(e) => setPct(e.target.value)} />
          <Input type="number" placeholder="Recobro total" value={recobro} onChange={(e) => setRecobro(e.target.value)} />
          <Input type="number" placeholder="% recobro aliado" value={pctRec} onChange={(e) => setPctRec(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} /> Retención
            {ret && <Input type="number" className="w-20" placeholder="%" value={pctRet} onChange={(e) => setPctRet(e.target.value)} />}
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Agregar"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Aliado</th><th className="px-4 py-2 text-right">% Com.</th>
              <th className="px-4 py-2 text-right">A pagar</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{filas.map((b) => {
              const c = calcComisionB2B({ precioVenta: b.precio_venta, pctComision: b.pct_comision, recobroTotal: b.recobro_total, pctRecobroAliado: b.pct_recobro_aliado, aplicaRetencion: b.aplica_retencion, pctRetencion: b.pct_retencion });
              return (
                <tr key={b.id} className="border-t border-gray-50">
                  <td className="px-4 py-2 text-gray-700">{b.aliado ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{(b.pct_comision * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCOP(c.totalPagar)}</td>
                  <td className="px-4 py-2 text-right"><DeleteBtn onClick={() => eliminarComisionB2B(b.id, numero)} /></td>
                </tr>);
            })}</tbody>
            <tfoot><tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2" colSpan={2}>Total comisiones B2B</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatCOP(comB2BTotal)}</td><td />
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── FACTURACIÓN ────────────────────────────────────────────────────────
type ItemForm = { descripcion: string; valor: string; gravable: boolean };
const itemVacio = (): ItemForm => ({ descripcion: "", valor: "", gravable: true });

function FacturacionTab({ numero, filas, ivaGenerado, ivaPct, clienteNombre, clienteDocumento, totalContrato }: { numero: string; filas: Factura[]; ivaGenerado: number; ivaPct: number; clienteNombre: string; clienteDocumento: string; totalContrato: number }) {
  const [num, setNum] = useState("");
  const [fecha, setFecha] = useState("");
  const [cliente, setCliente] = useState("");
  const [nit, setNit] = useState("");
  const [items, setItems] = useState<ItemForm[]>([itemVacio()]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const totalBaseGrav = filas.reduce((s, f) => s + (f.base_gravable || 0), 0);
  const totalBaseNoGrav = filas.reduce((s, f) => s + (f.base_no_gravable || 0), 0);

  // Previsualización de la factura en edición
  const prevGrav = items.filter((i) => i.gravable).reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const prevNoGrav = items.filter((i) => !i.gravable).reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const prevIva = prevGrav * ivaPct;
  const prevTotal = prevGrav + prevNoGrav + prevIva;

  const setItem = (idx: number, patch: Partial<ItemForm>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, itemVacio()]);
  const delItem = (idx: number) => setItems((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr));

  function agregar() {
    const limpios = items
      .filter((it) => (Number(it.valor) || 0) > 0)
      .map((it) => ({ descripcion: it.descripcion, valor: Number(it.valor), gravable: it.gravable }));
    if (!limpios.length) { setErr("Agrega al menos un ítem con valor."); return; }
    setErr("");
    start(async () => {
      const r = await crearFactura({
        numeroContrato: numero, numeroFactura: num, fechaFactura: fecha,
        cliente, nitCliente: nit, items: limpios,
      });
      if (r.ok) { setNum(""); setFecha(""); setCliente(""); setNit(""); setItems([itemVacio()]); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Registra las <b>facturas que le emites al cliente</b>. Cada factura puede tener varios ítems;
        los marcados <b>gravables</b> generan IVA del {(ivaPct * 100).toFixed(0)}%.
      </p>

      {/* Resumen vertical del contrato */}
      <Resumen
        titulo="Facturación del contrato"
        filas={[
          { label: "Facturas emitidas", value: String(filas.length) },
          { label: "Base gravable", value: formatCOP(totalBaseGrav) },
          { label: "Base no gravable", value: formatCOP(totalBaseNoGrav) },
          { label: `= IVA generado (${(ivaPct * 100).toFixed(0)}%)`, value: formatCOP(ivaGenerado), strong: true, color: "var(--brand-primary)" },
        ]}
      />

      {/* Nueva factura con ítems */}
      <div className={card}>
        <div className="mb-1 flex items-center justify-between">
          <p className={lbl}>Nueva factura</p>
          {(clienteNombre || clienteDocumento) && (
            <button
              type="button"
              onClick={() => { setCliente(clienteNombre || ""); setNit(clienteDocumento || ""); }}
              className="text-xs font-medium hover:underline"
              style={{ color: "var(--brand-accent)" }}
            >
              Usar datos del cliente del contrato
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Input placeholder="N° factura" value={num} onChange={(e) => setNum(e.target.value)} />
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Input placeholder="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          <Input placeholder="NIT/CC cliente" value={nit} onChange={(e) => setNit(e.target.value)} />
        </div>

        <p className="mb-2 mt-4 text-xs font-medium text-gray-600">Ítems de la factura</p>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input className="min-w-[160px] flex-1" placeholder="Descripción del ítem" value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} />
              <Input type="number" className="w-36" placeholder="Valor" value={it.valor} onChange={(e) => setItem(i, { valor: e.target.value })} />
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" checked={it.gravable} onChange={(e) => setItem(i, { gravable: e.target.checked })} />
                Gravable
              </label>
              <span className="w-24 text-right text-xs text-gray-400">
                {it.gravable && Number(it.valor) > 0 ? `IVA ${formatCOP((Number(it.valor) || 0) * ivaPct)}` : ""}
              </span>
              <button type="button" onClick={() => delItem(i)} className="text-xs text-gray-400 hover:text-red-500" disabled={items.length <= 1}>✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-2 text-xs font-medium" style={{ color: "var(--brand-accent)" }}>+ Agregar ítem</button>

        {/* Previsualización de totales de la factura */}
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <div>
            <span className="mr-3">Gravable: <b>{formatCOP(prevGrav)}</b></span>
            <span className="mr-3">No gravable: <b>{formatCOP(prevNoGrav)}</b></span>
            <span className="mr-3">IVA: <b>{formatCOP(prevIva)}</b></span>
            <span>Total factura: <b style={{ color: "var(--brand-primary)" }}>{formatCOP(prevTotal)}</b></span>
          </div>
          {prevTotal > 0 && (() => {
            const diff = prevTotal - totalContrato;
            return (
              <div className="mt-1 text-red-400/80">
                Total contrato: {formatCOP(totalContrato)}
                {Math.abs(diff) < 1
                  ? " · coincide con la factura"
                  : ` · ${diff > 0 ? "de más" : "de menos"} ${formatCOP(Math.abs(diff))}`}
              </div>
            );
          })()}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Guardar factura"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {/* Facturas emitidas */}
      {filas.length > 0 && (
        <div className="space-y-3">
          {filas.map((f) => {
            const ivaF = (f.base_gravable || 0) * ivaPct;
            const totalF = (f.base_gravable || 0) + (f.base_no_gravable || 0) + ivaF;
            return (
              <div key={f.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-gray-800">Factura {f.numero_factura ?? "—"}</span>
                    <span className="ml-2 text-xs text-gray-400">{f.fecha_factura ?? "—"} · {f.estado_dian ?? "borrador"}</span>
                  </div>
                  <DeleteBtn onClick={() => eliminarFactura(f.id, numero)} />
                </div>
                {f.items.length > 0 && (
                  <table className="w-full text-sm">
                    <tbody>
                      {f.items.map((it, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="py-1.5 text-gray-600">{it.descripcion ?? "—"}</td>
                          <td className="py-1.5 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${it.gravable ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-500"}`}>
                              {it.gravable ? "Gravable" : "No gravable"}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-gray-700">{formatCOP(it.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-xs text-gray-500">
                  <span>Gravable: {formatCOP(f.base_gravable)}</span>
                  <span>No gravable: {formatCOP(f.base_no_gravable)}</span>
                  <span>IVA: {formatCOP(ivaF)}</span>
                  <span className="font-semibold text-gray-700">Total: {formatCOP(totalF)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── RENTABILIDAD ───────────────────────────────────────────────────────
function RentabilidadTab({ rent }: { rent: Rentabilidad }) {
  const colorClase = rent.clasificacion === "Alta" ? "var(--brand-success)" : rent.clasificacion === "Media" ? "#C99A2E" : "#C0392B";
  const filas: [string, string][] = [
    ["Precio de venta", formatCOP(rent.precioVenta)],
    ["(−) Costo directo", formatCOP(rent.costoDirecto)],
    ["(−) Comisión B2B", formatCOP(rent.comB2B)],
    ["(−) Comisión asesor", formatCOP(rent.comAsesor)],
    ["= Utilidad bruta", formatCOP(rent.utilBruta)],
    ["(−) Provisión ICA (1%)", formatCOP(rent.provIca)],
    ["(−) Provisión Bomberil", formatCOP(rent.provBomberil)],
    ["(−) Provisión Fontur (2.5%)", formatCOP(rent.provFontur)],
    ["(−) Provisión Renta (3.5%)", formatCOP(rent.provRenta)],
    ["= Total provisiones", formatCOP(rent.totalProvisiones)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Utilidad neta</div>
          <div className="text-2xl font-bold">{formatCOP(rent.utilNeta)}</div>
        </div>
        <Mini label="Margen neto" value={`${(rent.margenNeto * 100).toFixed(1)}%`} />
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Clasificación</div>
          <div className="text-2xl font-bold" style={{ color: colorClase }}>{rent.clasificacion}</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <tbody>{filas.map(([k, val], i) => (
            <tr key={i} className={`border-t border-gray-50 ${k.startsWith("=") ? "font-semibold bg-gray-50" : ""}`}>
              <td className="px-4 py-2 text-gray-600">{k}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-800">{val}</td>
            </tr>))}
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-4 py-2">Utilidad neta</td>
              <td className="px-4 py-2 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(rent.utilNeta)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────
// Tarjeta de resultados en formato VERTICAL (etiqueta a la izq, valor a la der).
// Mejor para números grandes y columnas angostas.
function Resumen({ titulo, subtitulo, filas }: {
  titulo: string;
  subtitulo?: string;
  filas: { label: string; value: string; strong?: boolean; color?: string }[];
}) {
  return (
    <div className={card}>
      <p className="text-sm font-semibold text-gray-700">{titulo}</p>
      {subtitulo && <p className="mt-0.5 text-xs text-gray-500">{subtitulo}</p>}
      <div className="mt-3 divide-y divide-gray-100">
        {filas.map((f, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-2">
            <span className={`text-sm ${f.strong ? "font-semibold text-gray-700" : "text-gray-500"}`}>{f.label}</span>
            <span className={`tabular-nums ${f.strong ? "text-base font-bold" : "text-sm text-gray-800"}`} style={f.color ? { color: f.color } : undefined}>{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void | Promise<unknown> }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => { if (confirm("¿Eliminar?")) start(() => { void onClick(); }); }}
      className="text-xs text-gray-400 hover:text-red-500">
      Eliminar
    </button>
  );
}
