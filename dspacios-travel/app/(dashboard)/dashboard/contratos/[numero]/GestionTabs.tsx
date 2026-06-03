"use client";

import { useState, useTransition } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import {
  calcComisionB2B,
  calcComisionAsesor,
  calcRentabilidad,
  FISCAL_DEFAULT,
  type Rentabilidad,
  type ParamsFiscales,
} from "@/lib/calc/finanzas";
import { AbonoForm } from "./AbonoForm";
import {
  guardarCostos,
  crearCuentaPorPagar,
  eliminarCuentaPorPagar,
  crearComisionB2B,
  eliminarComisionB2B,
  crearFactura,
  eliminarFactura,
} from "./gestion-actions";

type Abono = { id: number; valor_abono: number; forma_pago: string | null; referencia: string | null; fecha_abono: string };
type CxP = { id: number; proveedor: string | null; servicio: string | null; valor_total: number; fecha_vencimiento: string | null; aplica_retencion: boolean; pct_retencion: number };
type B2B = { id: number; aliado: string | null; precio_venta: number; pct_comision: number; recobro_total: number; pct_recobro_aliado: number; aplica_retencion: boolean; pct_retencion: number };
type Factura = { id: number; numero_factura: string | null; fecha_factura: string | null; base_gravable: number; iva_descontable: number; estado_dian: string | null };

export type GestionProps = {
  numero: string;
  precioVenta: number;
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
const card = "rounded-xl border border-gray-200 bg-white p-4 sm:p-5";

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

  const comAsesor = calcComisionAsesor({
    precioVenta: p.precioVenta, costoTotal: costoDirecto,
    comB2BPagada: comB2BTotal, pctBase: p.asesorPct, retHonorarios: fiscal.RETENCION_HONORARIOS,
  });

  const ivaGenerado = p.facturas.reduce((s, f) => s + f.base_gravable * fiscal.IVA, 0);
  const ivaDescontable = p.facturas.reduce((s, f) => s + (f.iva_descontable || 0), 0);

  const rent = calcRentabilidad({
    precioVenta: p.precioVenta, costoDirecto, comB2B: comB2BTotal,
    comAsesor: comAsesor.comisionNeta, ivaGenerado, ivaDescontable, fiscal,
  });

  return (
    <div className="mt-8">
      <Tabs defaultValue="cartera">
        <div className="mb-5 overflow-x-auto">
          <TabsList>
            <TabsTrigger value="cartera">Cartera</TabsTrigger>
            {p.verFinanzas && <TabsTrigger value="costos">Costos</TabsTrigger>}
            {p.verFinanzas && <TabsTrigger value="proveedores">Proveedores</TabsTrigger>}
            {p.verFinanzas && <TabsTrigger value="comisiones">Comisiones</TabsTrigger>}
            {p.verFinanzas && <TabsTrigger value="facturacion">Facturación</TabsTrigger>}
            {p.verFinanzas && <TabsTrigger value="rentabilidad">Rentabilidad</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="cartera">
          <CarteraTab numero={p.numero} abonos={p.abonos} totalPagado={p.totalPagado} total={p.precioVenta} formasPago={p.formasPago} />
        </TabsContent>
        {p.verFinanzas && (
          <>
            <TabsContent value="costos">
              <CostosTab numero={p.numero} costos={p.costos} costoDirecto={costoDirecto} />
            </TabsContent>
            <TabsContent value="proveedores">
              <ProveedoresTab numero={p.numero} filas={p.cuentasPorPagar} />
            </TabsContent>
            <TabsContent value="comisiones">
              <ComisionesTab numero={p.numero} precioVenta={p.precioVenta} filas={p.comisionesB2B}
                comB2BTotal={comB2BTotal} comAsesor={comAsesor} asesorNombre={p.asesorNombre} asesorPct={p.asesorPct} />
            </TabsContent>
            <TabsContent value="facturacion">
              <FacturacionTab numero={p.numero} filas={p.facturas} ivaGenerado={ivaGenerado} ivaDescontable={ivaDescontable} />
            </TabsContent>
            <TabsContent value="rentabilidad">
              <RentabilidadTab rent={rent} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

// ── COSTOS ─────────────────────────────────────────────────────────────
function CostosTab({ numero, costos, costoDirecto }: { numero: string; costos: GestionProps["costos"]; costoDirecto: number }) {
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {campos.map(([k, label]) => (
          <div key={k}>
            <label className={lbl}>{label}</label>
            <Input type="number" min={0} value={v[k] || ""} onChange={set(k)} placeholder="0" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar costos"}
        </Button>
        <span className="text-sm text-gray-500">Costo directo total: <b className="tabular-nums">{formatCOP(total)}</b></span>
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
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const totalCxP = filas.reduce((s, f) => s + f.valor_total, 0);

  function agregar() {
    if (!proveedor.trim() || !Number(valor)) return;
    setErr("");
    start(async () => {
      const r = await crearCuentaPorPagar({
        numeroContrato: numero, proveedor, tipoProveedor: tipo, servicio,
        valorTotal: Number(valor), fechaVencimiento: venc,
        aplicaRetencion: ret, pctRetencion: Number(pctRet) / 100 || 0,
      });
      if (r.ok) { setProveedor(""); setTipo(""); setServicio(""); setValor(""); setVenc(""); setRet(false); setPctRet(""); }
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
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Agregar"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Proveedor</th><th className="px-4 py-2">Servicio</th>
              <th className="px-4 py-2 text-right">Valor</th><th className="px-4 py-2">Vence</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.id} className="border-t border-gray-50">
                <td className="px-4 py-2 text-gray-700">{f.proveedor ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{f.servicio ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCOP(f.valor_total)}</td>
                <td className="px-4 py-2 text-gray-500">{f.fecha_vencimiento ?? "—"}</td>
                <td className="px-4 py-2 text-right">
                  <DeleteBtn onClick={() => eliminarCuentaPorPagar(f.id, numero)} />
                </td>
              </tr>))}</tbody>
            <tfoot><tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2" colSpan={2}>Total por pagar</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatCOP(totalCxP)}</td><td colSpan={2} />
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── COMISIONES (B2B + asesor) ──────────────────────────────────────────
function ComisionesTab({ numero, precioVenta, filas, comB2BTotal, comAsesor, asesorNombre, asesorPct }: {
  numero: string; precioVenta: number; filas: B2B[]; comB2BTotal: number;
  comAsesor: ReturnType<typeof calcComisionAsesor>; asesorNombre: string; asesorPct: number;
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
      {/* Comisión asesor (calculada) */}
      <div className={card}>
        <p className="mb-2 text-sm font-semibold text-gray-700">Comisión del asesor</p>
        <p className="mb-3 text-xs text-gray-500">{asesorNombre || "—"} · base {(asesorPct * 100).toFixed(0)}%</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Util. neta base" value={formatCOP(comAsesor.utilidadNeta)} />
          <Mini label="Comisión bruta" value={formatCOP(comAsesor.comisionBruta)} />
          <Mini label="Retención 11%" value={formatCOP(comAsesor.retencion)} />
          <Mini label="Comisión neta" value={formatCOP(comAsesor.comisionNeta)} color="var(--brand-primary)" />
        </div>
      </div>

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
function FacturacionTab({ numero, filas, ivaGenerado, ivaDescontable }: { numero: string; filas: Factura[]; ivaGenerado: number; ivaDescontable: number }) {
  const [num, setNum] = useState("");
  const [fecha, setFecha] = useState("");
  const [cliente, setCliente] = useState("");
  const [nit, setNit] = useState("");
  const [desc, setDesc] = useState("");
  const [base, setBase] = useState("");
  const [ivaDesc, setIvaDesc] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function agregar() {
    if (!Number(base)) return;
    setErr("");
    start(async () => {
      const r = await crearFactura({
        numeroContrato: numero, numeroFactura: num, fechaFactura: fecha,
        cliente, nitCliente: nit, descripcion: desc,
        baseGravable: Number(base), ivaDescontable: Number(ivaDesc) || 0,
      });
      if (r.ok) { setNum(""); setFecha(""); setCliente(""); setNit(""); setDesc(""); setBase(""); setIvaDesc(""); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Mini label="IVA generado (19%)" value={formatCOP(ivaGenerado)} />
        <Mini label="IVA descontable" value={formatCOP(ivaDescontable)} />
        <Mini label="IVA por pagar" value={formatCOP(Math.max(ivaGenerado - ivaDescontable, 0))} />
      </div>
      <div className={card}>
        <p className={lbl}>Agregar factura</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Input placeholder="N° factura" value={num} onChange={(e) => setNum(e.target.value)} />
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Input placeholder="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          <Input placeholder="NIT/CC cliente" value={nit} onChange={(e) => setNit(e.target.value)} />
          <Input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Input type="number" placeholder="Base gravable" value={base} onChange={(e) => setBase(e.target.value)} />
          <Input type="number" placeholder="IVA descontable" value={ivaDesc} onChange={(e) => setIvaDesc(e.target.value)} />
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
              <th className="px-4 py-2">N° Factura</th><th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2 text-right">Base</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.id} className="border-t border-gray-50">
                <td className="px-4 py-2 text-gray-700">{f.numero_factura ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{f.fecha_factura ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCOP(f.base_gravable)}</td>
                <td className="px-4 py-2 text-gray-500">{f.estado_dian ?? "—"}</td>
                <td className="px-4 py-2 text-right"><DeleteBtn onClick={() => eliminarFactura(f.id, numero)} /></td>
              </tr>))}</tbody>
          </table>
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
