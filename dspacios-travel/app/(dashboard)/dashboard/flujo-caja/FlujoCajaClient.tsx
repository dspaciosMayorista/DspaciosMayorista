"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";

export type ContratoFlujo = {
  numero_contrato: string;
  fecha_salida: string | null;
  fecha_venta: string | null;
  estado: string;
  // Todos los montos llegan ya en PESOS (la conversión USD→COP se hace en el
  // servidor con la TRM promedio de cada contrato).
  precio_venta: number;
  costo_total: number;
  cobrado: number;
  pagado: number;
};

type Lente = "viaje" | "venta";
type Base = "esperado" | "caja";

type MesFila = {
  key: string; // YYYY-MM
  label: string;
  ingresos: number;
  egresosVar: number; // costos/pagos de proveedores
  fijos: number;
  egresos: number; // egresosVar + fijos
  saldoNeto: number;
  acumulado: number;
  contratos: number;
  estado: "pasado" | "actual" | "futuro";
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const n = (s: string) => Number(s) || 0;

function mesKeyDe(fecha: string | null): string | null {
  if (!fecha) return null;
  const m = /^(\d{4})-(\d{2})/.exec(fecha);
  return m ? `${m[1]}-${m[2]}` : null;
}
function labelDe(key: string): string {
  const [y, mm] = key.split("-");
  return `${MESES[Number(mm) - 1]} ${y.slice(2)}`;
}
function sumarMes(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function FlujoCajaClient({ contratos }: { contratos: ContratoFlujo[] }) {
  const [lente, setLente] = useState<Lente>("viaje");
  const [base, setBase] = useState<Base>("esperado");
  const [fijosStr, setFijosStr] = useState("0");

  const fijosMes = n(fijosStr);
  const mesActual = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const filas = useMemo<MesFila[]>(() => {
    // Agregación por mes según el lente y la base elegida. Los montos ya vienen
    // en pesos desde el servidor.
    const acc = new Map<string, { ingresos: number; egresosVar: number; contratos: number }>();
    for (const c of contratos) {
      const fecha = lente === "viaje" ? c.fecha_salida : c.fecha_venta;
      const key = mesKeyDe(fecha);
      if (!key) continue;
      const ingreso = base === "esperado" ? c.precio_venta : c.cobrado;
      const egreso = base === "esperado" ? c.costo_total : c.pagado;
      const cur = acc.get(key) ?? { ingresos: 0, egresosVar: 0, contratos: 0 };
      cur.ingresos += ingreso;
      cur.egresosVar += egreso;
      cur.contratos += 1;
      acc.set(key, cur);
    }
    if (acc.size === 0) return [];

    // Rango continuo de meses (incluye el mes actual aunque esté vacío).
    const keys = [...acc.keys(), mesActual];
    keys.sort();
    let cursor = keys[0];
    const fin = keys[keys.length - 1];
    const ordenado: string[] = [];
    while (cursor <= fin) {
      ordenado.push(cursor);
      cursor = sumarMes(cursor, 1);
      if (ordenado.length > 240) break; // guardarraíl
    }

    let acumulado = 0;
    return ordenado.map((key) => {
      const d = acc.get(key) ?? { ingresos: 0, egresosVar: 0, contratos: 0 };
      const fijos = d.contratos > 0 || key === mesActual ? fijosMes : 0;
      const egresos = d.egresosVar + fijos;
      const saldoNeto = d.ingresos - egresos;
      acumulado += saldoNeto;
      const estado: MesFila["estado"] = key < mesActual ? "pasado" : key === mesActual ? "actual" : "futuro";
      return {
        key,
        label: labelDe(key),
        ingresos: d.ingresos,
        egresosVar: d.egresosVar,
        fijos,
        egresos,
        saldoNeto,
        acumulado,
        contratos: d.contratos,
        estado,
      };
    });
  }, [contratos, lente, base, fijosMes, mesActual]);

  const totales = useMemo(() => {
    const ingresos = filas.reduce((a, f) => a + f.ingresos, 0);
    const egresos = filas.reduce((a, f) => a + f.egresos, 0);
    return { ingresos, egresos, saldo: ingresos - egresos };
  }, [filas]);

  const filaActual = filas.find((f) => f.estado === "actual");
  const filaProximo = filas.find((f) => f.key === sumarMes(mesActual, 1));
  const futuros = filas.filter((f) => f.estado === "futuro");
  const saldoFuturo = futuros.reduce((a, f) => a + f.saldoNeto, 0);

  const maxBar = Math.max(1, ...filas.map((f) => Math.max(f.ingresos, f.egresos)));

  const tab = "rounded-lg px-3 py-1.5 text-sm font-medium transition";
  const tabOn = { background: "var(--brand-primary)", color: "#fff" };

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">Imputar por</div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            <button type="button" className={tab} style={lente === "viaje" ? tabOn : {}} onClick={() => setLente("viaje")}>Por viaje (fecha de salida)</button>
            <button type="button" className={tab} style={lente === "venta" ? tabOn : {}} onClick={() => setLente("venta")}>Por venta (fecha de venta)</button>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">Base</div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            <button type="button" className={tab} style={base === "esperado" ? tabOn : {}} onClick={() => setBase("esperado")}>Esperado (devengado)</button>
            <button type="button" className={tab} style={base === "caja" ? tabOn : {}} onClick={() => setBase("caja")}>Caja (movimientos)</button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Costos fijos / mes</label>
          <Input type="number" value={fijosStr} onChange={(e) => setFijosStr(e.target.value)} className="w-36 text-right" placeholder="0" />
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-gray-400">
        Los contratos en USD ya vienen convertidos a pesos con la TRM promedio de cada contrato
        (la misma de Rentabilidad); por eso aquí no se configura TRM.
      </p>
      <p className="-mt-3 text-[11px] text-gray-400">
        {base === "esperado"
          ? "Esperado: ingreso = precio de venta del contrato; egreso = costos directos. Útil para proyectar el futuro."
          : "Caja: ingreso = abonos cobrados en cartera; egreso = pagos hechos a proveedores. Útil para el flujo real."}
        {" "}Los costos fijos se imputan a cada mes con contratos (se presumen, aunque no se hayan gastado).
      </p>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card titulo="Hoy (mes actual)" sub={filaActual ? filaActual.label : "—"} valor={filaActual?.saldoNeto ?? 0} detalle={filaActual ? `${formatCOP(filaActual.ingresos)} − ${formatCOP(filaActual.egresos)}` : ""} />
        <Card titulo="Próximo mes" sub={filaProximo ? filaProximo.label : "—"} valor={filaProximo?.saldoNeto ?? 0} detalle={filaProximo ? `${filaProximo.contratos} contrato(s)` : ""} />
        <Card titulo="Saldo proyectado (a futuro)" sub={`${futuros.length} mes(es)`} valor={saldoFuturo} detalle={`Acumulado total ${formatCOP(totales.saldo)}`} />
      </div>

      {/* Diagrama de barras */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Ingresos vs. egresos por mes</h2>
          <div className="flex items-center gap-4 text-[11px] text-gray-500">
            <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--brand-success)" }} /> Ingresos</span>
            <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" /> Egresos</span>
          </div>
        </div>
        {filas.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Sin contratos con fecha para imputar. Registra ventas con fecha de {lente === "viaje" ? "salida" : "venta"}.</p>
        ) : (
          <div className="flex items-end gap-3 overflow-x-auto pb-2" style={{ minHeight: 180 }}>
            {filas.map((f) => (
              <div key={f.key} className="flex min-w-[52px] flex-1 flex-col items-center gap-1">
                <div className="flex h-[140px] w-full items-end justify-center gap-1">
                  <div className="w-1/2 rounded-t" style={{ height: `${(f.ingresos / maxBar) * 140}px`, background: "var(--brand-success)", minHeight: f.ingresos > 0 ? 2 : 0 }} title={`Ingresos ${formatCOP(f.ingresos)}`} />
                  <div className="w-1/2 rounded-t bg-red-400" style={{ height: `${(f.egresos / maxBar) * 140}px`, minHeight: f.egresos > 0 ? 2 : 0 }} title={`Egresos ${formatCOP(f.egresos)}`} />
                </div>
                <div className={`text-center text-[10px] leading-tight ${f.estado === "actual" ? "font-bold text-[#1D7C9A]" : f.estado === "futuro" ? "text-gray-400" : "text-gray-500"}`}>
                  {f.label}
                  {f.estado === "actual" && <div className="text-[8px] uppercase">hoy</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tabla mensual */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Mes</th>
              <th className="px-3 py-2 text-center font-medium">Contratos</th>
              <th className="px-3 py-2 text-right font-medium">Ingresos</th>
              <th className="px-3 py-2 text-right font-medium">Egresos var.</th>
              <th className="px-3 py-2 text-right font-medium">Costos fijos</th>
              <th className="px-3 py-2 text-right font-medium">Saldo neto</th>
              <th className="px-3 py-2 text-right font-medium">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.key} className={`border-b border-gray-100 last:border-0 ${f.estado === "actual" ? "bg-[rgba(38,187,217,0.06)]" : f.estado === "futuro" ? "" : "bg-gray-50/40"}`}>
                <td className="px-3 py-2">
                  <span className={f.estado === "actual" ? "font-semibold text-[#1D7C9A]" : "text-gray-700"}>{f.label}</span>
                  {f.estado === "actual" && <span className="ml-1.5 rounded bg-[rgba(38,187,217,0.18)] px-1.5 py-0.5 text-[10px] font-medium text-[#1D7C9A]">hoy</span>}
                  {f.estado === "futuro" && <span className="ml-1.5 text-[10px] text-gray-400">proyectado</span>}
                </td>
                <td className="px-3 py-2 text-center text-gray-500">{f.contratos || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatCOP(f.ingresos)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatCOP(f.egresosVar)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{f.fijos > 0 ? formatCOP(f.fijos) : "—"}</td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${f.saldoNeto >= 0 ? "text-[#3d7a63]" : "text-red-600"}`}>{formatCOP(f.saldoNeto)}</td>
                <td className={`px-3 py-2 text-right font-medium tabular-nums ${f.acumulado >= 0 ? "text-gray-700" : "text-red-600"}`}>{formatCOP(f.acumulado)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="px-3 py-2 text-gray-700">Total</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums text-gray-800">{formatCOP(totales.ingresos)}</td>
              <td className="px-3 py-2" colSpan={2} />
              <td className={`px-3 py-2 text-right tabular-nums ${totales.saldo >= 0 ? "text-[#3d7a63]" : "text-red-600"}`}>{formatCOP(totales.saldo)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}

function Card({ titulo, sub, valor, detalle }: { titulo: string; sub: string; valor: number; detalle: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="text-xs text-gray-500">{sub}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valor >= 0 ? "text-[#1D7C9A]" : "text-red-600"}`}>{formatCOP(valor)}</div>
      {detalle && <div className="mt-0.5 text-[11px] text-gray-400">{detalle}</div>}
    </div>
  );
}
