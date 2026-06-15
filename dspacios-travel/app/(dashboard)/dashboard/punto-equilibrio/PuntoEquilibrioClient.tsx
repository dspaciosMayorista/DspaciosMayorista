"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { SMMLV } from "@/lib/constants";
import { liquidarEmpleadoContrato, aplicaAuxilio, ARL, type ClaseRiesgo } from "@/lib/calc/nomina";

type Linea = { concepto: string; valor: string };
type EmpContrato = { nombre: string; salario: string; auxilio: boolean; riesgo: ClaseRiesgo };
type EmpServicio = { nombre: string; honorario: string };

const n = (s: string) => Number(s) || 0;
const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function PuntoEquilibrioClient({ margenAuto = 30 }: { margenAuto?: number }) {
  const [fijos, setFijos] = useState<Linea[]>([{ concepto: "Arriendo oficina", valor: "" }]);
  const [variables, setVariables] = useState<Linea[]>([{ concepto: "Comisiones / costo variable", valor: "" }]);
  const [contrato, setContrato] = useState<EmpContrato[]>([]);
  const [servicios, setServicios] = useState<EmpServicio[]>([]);
  const [margen, setMargen] = useState(String(margenAuto));
  const [usarAuto, setUsarAuto] = useState(true);
  const [declarante, setDeclarante] = useState(true);
  const [detalle, setDetalle] = useState<number | null>(null);

  const margenEf = usarAuto ? margenAuto : (n(margen) || 0);

  // Totales
  const totFijos = fijos.reduce((a, x) => a + n(x.valor), 0);
  const totVariables = variables.reduce((a, x) => a + n(x.valor), 0);
  const liqs = contrato.map((e) => liquidarEmpleadoContrato(n(e.salario), e.auxilio, e.riesgo, declarante));
  const totNomina = liqs.reduce((a, l) => a + l.costoTotalMensual, 0);
  const totServicios = servicios.reduce((a, x) => a + n(x.honorario), 0);

  const costosFijosTotales = totFijos + totNomina + totServicios; // fijos del negocio
  const costosTotales = costosFijosTotales + totVariables;
  const m = margenEf / 100;
  const peVentas = m > 0 ? Math.round(costosFijosTotales / m) : 0;

  const cell = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm";

  return (
    <div className="space-y-6">
      {/* Costos y gastos fijos */}
      <Seccion titulo="Costos y gastos fijos (mensuales)" total={totFijos}>
        {fijos.map((x, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={x.concepto} onChange={(e) => setFijos((p) => p.map((r, j) => j === i ? { ...r, concepto: e.target.value } : r))} placeholder="Concepto" className="flex-1" />
            <Input type="number" value={x.valor} onChange={(e) => setFijos((p) => p.map((r, j) => j === i ? { ...r, valor: e.target.value } : r))} placeholder="0" className="w-40 text-right" />
            <Del onClick={() => setFijos((p) => p.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Add onClick={() => setFijos((p) => [...p, { concepto: "", valor: "" }])}>+ Agregar costo fijo</Add>
      </Seccion>

      {/* Costos y gastos variables */}
      <Seccion titulo="Costos y gastos variables (mensuales)" total={totVariables}>
        {variables.map((x, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={x.concepto} onChange={(e) => setVariables((p) => p.map((r, j) => j === i ? { ...r, concepto: e.target.value } : r))} placeholder="Concepto" className="flex-1" />
            <Input type="number" value={x.valor} onChange={(e) => setVariables((p) => p.map((r, j) => j === i ? { ...r, valor: e.target.value } : r))} placeholder="0" className="w-40 text-right" />
            <Del onClick={() => setVariables((p) => p.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Add onClick={() => setVariables((p) => [...p, { concepto: "", valor: "" }])}>+ Agregar costo variable</Add>
      </Seccion>

      {/* Empleados por contrato */}
      <Seccion titulo="Empleados por contrato (liquidación 2026)" total={totNomina}>
        <p className="mb-2 text-xs text-gray-400">Incluye seguridad social, parafiscales y prestaciones sociales. El auxilio de transporte aplica a salarios ≤ 2 SMMLV.</p>
        <label className="mb-3 flex items-start gap-2 rounded-lg border border-gray-100 bg-[rgba(102,181,150,0.08)] px-3 py-2 text-xs text-gray-600">
          <input type="checkbox" checked={declarante} onChange={(ev) => setDeclarante(ev.target.checked)} className="mt-0.5" />
          <span>
            <b>Empresa declarante de renta</b> (sociedad). Aplica la <b>exoneración de aportes</b> (Art. 114-1 E.T.,
            Ley 1819/2016): no se pagan <b>Salud (8,5%)</b>, <b>SENA (2%)</b> ni <b>ICBF (3%)</b> por los empleados que
            ganen menos de <b>10 SMMLV</b> ({formatCOP(SMMLV * 10)}). Pensión, ARL y Caja siempre se pagan.
          </span>
        </label>
        {contrato.map((e, i) => {
          const l = liqs[i];
          const abierto = detalle === i;
          return (
            <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1"><label className={lbl}>Nombre / cargo</label><Input value={e.nombre} onChange={(ev) => setContrato((p) => p.map((r, j) => j === i ? { ...r, nombre: ev.target.value } : r))} /></div>
                <div><label className={lbl}>Salario base</label><Input type="number" value={e.salario} onChange={(ev) => setContrato((p) => p.map((r, j) => j === i ? { ...r, salario: ev.target.value } : r))} className="w-36 text-right" /></div>
                <div>
                  <label className={lbl}>Riesgo ARL</label>
                  <select value={e.riesgo} onChange={(ev) => setContrato((p) => p.map((r, j) => j === i ? { ...r, riesgo: ev.target.value as ClaseRiesgo } : r))} className={cell}>
                    {Object.keys(ARL).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-1 pb-2 text-xs text-gray-600">
                  <input type="checkbox" checked={e.auxilio} onChange={(ev) => setContrato((p) => p.map((r, j) => j === i ? { ...r, auxilio: ev.target.checked } : r))} /> Auxilio transporte
                </label>
                <Del onClick={() => setContrato((p) => p.filter((_, j) => j !== i))} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                <span>SS: {formatCOP(l.seguridadSocial)}</span>
                <span>Parafiscales: {formatCOP(l.parafiscales)}</span>
                <span>Prestaciones: {formatCOP(l.prestaciones)}</span>
                {l.auxilio > 0 && <span>Auxilio: {formatCOP(l.auxilio)}</span>}
                <span className="font-semibold" style={{ color: "var(--brand-primary)" }}>Costo total: {formatCOP(l.costoTotalMensual)}</span>
                {l.exonerado && <span className="rounded bg-[rgba(102,181,150,0.18)] px-1.5 py-0.5 font-medium text-[#3d7a63]">exonerado de Salud/SENA/ICBF</span>}
                {n(e.salario) > 0 && !aplicaAuxilio(n(e.salario)) && e.auxilio && <span className="text-amber-600">⚠ salario &gt; 2 SMMLV: por ley no llevaría auxilio</span>}
                <button type="button" onClick={() => setDetalle(abierto ? null : i)} className="font-medium text-[#1D7C9A] hover:underline">{abierto ? "Ocultar detalle" : "Ver detalle"}</button>
              </div>
              {abierto && (
                <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-gray-100 bg-white p-3 sm:grid-cols-3">
                  <DetalleGrupo titulo="Seguridad social" total={l.seguridadSocial}>
                    <DLinea label="Salud (8,5%)" valor={l.salud} tachado={l.exonerado} />
                    <DLinea label="Pensión (12%)" valor={l.pension} />
                    <DLinea label={`ARL (${(ARL[e.riesgo] * 100).toFixed(3)}%)`} valor={l.arl} />
                  </DetalleGrupo>
                  <DetalleGrupo titulo="Parafiscales" total={l.parafiscales}>
                    <DLinea label="SENA (2%)" valor={l.sena} tachado={l.exonerado} />
                    <DLinea label="ICBF (3%)" valor={l.icbf} tachado={l.exonerado} />
                    <DLinea label="Caja comp. (4%)" valor={l.caja} />
                  </DetalleGrupo>
                  <DetalleGrupo titulo="Prestaciones sociales" total={l.prestaciones}>
                    <DLinea label="Prima (8,33%)" valor={l.prima} />
                    <DLinea label="Cesantías (8,33%)" valor={l.cesantias} />
                    <DLinea label="Int. cesantías (1%)" valor={l.interesesCesantias} />
                    <DLinea label="Vacaciones (4,17%)" valor={l.vacaciones} />
                  </DetalleGrupo>
                </div>
              )}
            </div>
          );
        })}
        <Add onClick={() => setContrato((p) => [...p, { nombre: "", salario: "", auxilio: true, riesgo: "I" }])}>+ Agregar empleado por contrato</Add>
      </Seccion>

      {/* Empleados por prestación de servicios */}
      <Seccion titulo="Empleados por prestación de servicios" total={totServicios}>
        <p className="mb-2 text-xs text-gray-400">Honorario mensual (sin prestaciones; el contratista asume su seguridad social).</p>
        {servicios.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={e.nombre} onChange={(ev) => setServicios((p) => p.map((r, j) => j === i ? { ...r, nombre: ev.target.value } : r))} placeholder="Nombre / servicio" className="flex-1" />
            <Input type="number" value={e.honorario} onChange={(ev) => setServicios((p) => p.map((r, j) => j === i ? { ...r, honorario: ev.target.value } : r))} placeholder="Honorario mensual" className="w-40 text-right" />
            <Del onClick={() => setServicios((p) => p.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Add onClick={() => setServicios((p) => [...p, { nombre: "", honorario: "" }])}>+ Agregar prestación de servicios</Add>
      </Seccion>

      {/* Punto de equilibrio */}
      <section className="rounded-xl border-2 p-5" style={{ borderColor: "var(--brand-primary)" }}>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}>Punto de equilibrio</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Resumen label="Costos y gastos fijos (incl. nómina)" valor={costosFijosTotales} />
          <Resumen label="Costos y gastos variables" valor={totVariables} />
          <Resumen label="Costos y gastos totales" valor={costosTotales} />
          <div>
            <label className={lbl}>Margen de contribución / utilidad %</label>
            <div className="flex items-center gap-2">
              <Input type="number" value={usarAuto ? String(margenAuto) : margen} onChange={(e) => setMargen(e.target.value)} disabled={usarAuto} className="w-32 disabled:bg-gray-50 disabled:text-gray-500" />
              <span className="text-lg font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{margenEf.toFixed(1)}%</span>
            </div>
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
              <input type="checkbox" checked={usarAuto} onChange={(e) => { setUsarAuto(e.target.checked); if (!e.target.checked) setMargen(String(margenAuto)); }} />
              Automático de Rentabilidad (margen promedio ponderado: <b>{margenAuto.toFixed(1)}%</b>)
            </label>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-[rgba(29,124,154,0.06)] px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">Ventas necesarias para el punto de equilibrio (mes)</span>
          <span className="text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(peVentas)}</span>
        </div>
        <p className="mt-2 text-xs text-gray-400">Fórmula: costos y gastos fijos ÷ margen de contribución. Por encima de ese nivel de ventas, el negocio genera utilidad.</p>
      </section>
    </div>
  );
}

function Seccion({ titulo, total, children }: { titulo: string; total: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{titulo}</h2>
        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(total)}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
function Resumen({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-bold tabular-nums text-gray-800">{formatCOP(valor)}</div>
    </div>
  );
}
function DetalleGrupo({ titulo, total, children }: { titulo: string; total: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between border-b border-gray-100 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{titulo}</span>
        <span className="text-[11px] font-semibold tabular-nums text-gray-700">{formatCOP(total)}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function DLinea({ label, valor, tachado }: { label: string; valor: number; tachado?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className={tachado ? "text-gray-400 line-through" : "text-gray-500"}>{label}</span>
      <span className={`tabular-nums ${tachado ? "text-[#3d7a63]" : "text-gray-700"}`}>{tachado ? "exonerado" : formatCOP(valor)}</span>
    </div>
  );
}
function Add({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="text-sm font-medium text-[#1D7C9A] hover:underline">{children}</button>;
}
function Del({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="text-gray-400 hover:text-red-500" aria-label="Quitar">✕</button>;
}
