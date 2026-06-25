"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scale, Users, BookText, FileText, Upload, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/utils";
import { SMMLV } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { liquidarEmpleadoContrato, ARL, type ClaseRiesgo, type LiquidacionEmpleado } from "@/lib/calc/nomina";
import {
  guardarEmpleado, eliminarEmpleado, registrarContratoEmpleado, quitarContratoEmpleado, urlContratoEmpleado,
  guardarCosto, eliminarCosto,
} from "./actions";

export type EmpRow = {
  id: number; nombre: string; tipo: "empleado" | "servicios"; salario: number;
  auxilio: boolean; riesgo: string; declarante: boolean;
  contratoPath: string | null; contratoNombre: string | null;
};
export type CostoRow = { id: number; concepto: string; categoria: string; clasificacion: "fijo" | "variable"; valor: number };

const n = (s: string) => Number(s) || 0;

function liquidar(e: EmpRow): { segSocial: number; prestaciones: number; auxilio: number; costoTotal: number; det: LiquidacionEmpleado | null } {
  if (e.tipo === "servicios") {
    return { segSocial: 0, prestaciones: 0, auxilio: 0, costoTotal: e.salario, det: null };
  }
  const l = liquidarEmpleadoContrato(e.salario, e.auxilio, (e.riesgo as ClaseRiesgo) || "I", e.declarante);
  return { segSocial: l.seguridadSocial + l.parafiscales, prestaciones: l.prestaciones, auxilio: l.auxilio, costoTotal: l.costoTotalMensual, det: l };
}

const MARGEN_ERROR = 0.15; // colchón sobre el punto de equilibrio → meta del mes

export function PuntoEquilibrioClient({ empleados, costos, margenNeto, margenBruto, ventasMes = 0, contratosMes = 0 }: {
  empleados: EmpRow[]; costos: CostoRow[]; margenNeto: number; margenBruto: number; ventasMes?: number; contratosMes?: number;
}) {
  const [tab, setTab] = useState<"dashboard" | "config">("dashboard");
  const [usarAuto, setUsarAuto] = useState(true);
  const [margenManual, setMargenManual] = useState(String(Math.round(margenNeto * 10) / 10));
  const margenEf = usarAuto ? margenNeto : n(margenManual);

  const totNomina = useMemo(() => empleados.reduce((a, e) => a + liquidar(e).costoTotal, 0), [empleados]);
  const totFijos = useMemo(() => costos.filter((c) => c.clasificacion === "fijo").reduce((a, c) => a + c.valor, 0), [costos]);
  const totVariables = useMemo(() => costos.filter((c) => c.clasificacion === "variable").reduce((a, c) => a + c.valor, 0), [costos]);

  const totalCubrir = totFijos + totNomina; // fijos del negocio + nómina
  const m = margenEf / 100;
  const ventasMin = m > 0 ? Math.round(totalCubrir / m) : 0;
  const metaMes = Math.round(ventasMin * (1 + MARGEN_ERROR)); // ventas mínimas + 15%

  return (
    <div className="space-y-6">
      {/* Pestañas */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {([["dashboard", "Dashboard"], ["config", "Configuración"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={tab === k ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "dashboard" ? (
        <Dashboard ventasMin={ventasMin} metaMes={metaMes} ventasMes={ventasMes} contratosMes={contratosMes} totalCubrir={totalCubrir} margenEf={margenEf} />
      ) : (
        <Config
          empleados={empleados} costos={costos}
          totFijos={totFijos} totVariables={totVariables} totNomina={totNomina}
          totalCubrir={totalCubrir} ventasMin={ventasMin} margenEf={margenEf} margenNeto={margenNeto} margenBruto={margenBruto}
          usarAuto={usarAuto} setUsarAuto={setUsarAuto} margenManual={margenManual} setMargenManual={setMargenManual}
        />
      )}
    </div>
  );
}

// ── Pestaña DASHBOARD ─────────────────────────────────────────────────────────
function Dashboard({ ventasMin, metaMes, ventasMes, contratosMes, totalCubrir, margenEf }: {
  ventasMin: number; metaMes: number; ventasMes: number; contratosMes: number; totalCubrir: number; margenEf: number;
}) {
  const pctMeta = metaMes > 0 ? (ventasMes / metaMes) * 100 : 0;
  const pctBarra = Math.min(100, Math.max(0, pctMeta));
  const faltaMeta = Math.max(0, metaMes - ventasMes);
  const cubreEquilibrio = ventasMes >= ventasMin;
  const cubreMeta = ventasMes >= metaMes;
  const color = cubreMeta ? "var(--brand-success)" : cubreEquilibrio ? "var(--brand-accent)" : "#C0392B";

  return (
    <div className="space-y-5">
      {/* Meta del mes EN GRANDE */}
      <div className="rounded-2xl p-8 text-center text-white shadow-sm" style={{ background: "var(--brand-gradient, var(--brand-primary))", backgroundColor: "var(--brand-primary)" }}>
        <p className="text-sm font-medium uppercase tracking-wide opacity-90">Meta de ventas del mes</p>
        <p className="mt-2 text-5xl font-extrabold tabular-nums">{formatCOP(metaMes)}</p>
        <p className="mt-2 text-sm opacity-80">Ventas mínimas ({formatCOP(ventasMin)}) + 15% de margen de error · margen neto {margenEf.toFixed(1)}%.</p>
      </div>

      {/* Cómo vamos */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Ventas del mes en curso</p>
            <p className="text-2xl font-bold tabular-nums text-gray-800">{formatCOP(ventasMes)}</p>
            <p className="text-xs text-gray-400">{contratosMes} contrato(s) este mes</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-extrabold tabular-nums" style={{ color }}>{pctMeta.toFixed(0)}%</p>
            <p className="text-xs text-gray-400">de la meta</p>
          </div>
        </div>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full transition-all" style={{ width: `${pctBarra}%`, backgroundColor: color }} />
        </div>
        <p className="mt-2 text-sm font-medium" style={{ color }}>
          {cubreMeta ? "¡Meta alcanzada! El mes va con utilidad sobre el colchón."
            : cubreEquilibrio ? `Ya cubres el punto de equilibrio. Faltan ${formatCOP(faltaMeta)} para la meta.`
            : `Aún por debajo del equilibrio. Faltan ${formatCOP(Math.max(0, ventasMin - ventasMes))} para no perder y ${formatCOP(faltaMeta)} para la meta.`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card titulo="Punto de equilibrio (no perder)" valor={formatCOP(ventasMin)} />
        <Card titulo="Total a cubrir / mes" valor={formatCOP(totalCubrir)} />
        <Card titulo="Vendido este mes" valor={formatCOP(ventasMes)} />
      </div>
      <p className="text-xs text-gray-400">
        Meta = (costos fijos + nómina) ÷ margen neto, + 15%. Las ventas del mes salen de los contratos vendidos en el mes
        en curso (ingreso sin IVA, de Rentabilidad). Ajusta empleados y costos en la pestaña Configuración.
      </p>
    </div>
  );
}
function Card({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{titulo}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-gray-800">{valor}</div>
    </div>
  );
}

// ── Pestaña CONFIGURACIÓN ─────────────────────────────────────────────────────
function Config(p: {
  empleados: EmpRow[]; costos: CostoRow[];
  totFijos: number; totVariables: number; totNomina: number; totalCubrir: number; ventasMin: number;
  margenEf: number; margenNeto: number; margenBruto: number;
  usarAuto: boolean; setUsarAuto: (v: boolean) => void; margenManual: string; setMargenManual: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Cálculo del Punto de Equilibrio */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}><Scale size={16} /> Cálculo del punto de equilibrio</h2>
        <table className="w-full text-sm">
          <tbody>
            <Linea k="Costos y gastos fijos" v={formatCOP(p.totFijos)} />
            <Linea k="Nómina (costo empleadores)" v={formatCOP(p.totNomina)} />
            <Linea k="Total a cubrir" v={formatCOP(p.totalCubrir)} bold />
            <tr className="border-t border-gray-100">
              <td className="py-2 text-gray-600">÷ Margen neto</td>
              <td className="py-2 text-right">
                <span className="inline-flex items-center gap-2">
                  {!p.usarAuto && <Input type="number" value={p.margenManual} onChange={(e) => p.setMargenManual(e.target.value)} className="w-24 text-right" />}
                  <b className="tabular-nums" style={{ color: "var(--brand-primary)" }}>{p.margenEf.toFixed(1)}%</b>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-[rgba(102,181,150,0.12)] px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">Ventas mínimas para no perder</span>
          <span className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(p.ventasMin)}</span>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
          <input type="checkbox" checked={p.usarAuto} onChange={(e) => p.setUsarAuto(e.target.checked)} />
          Margen neto automático de Rentabilidad (<b>{p.margenNeto.toFixed(1)}%</b>) · margen bruto {p.margenBruto.toFixed(1)}%
        </label>
        <p className="mt-2 text-xs text-gray-400">Los costos variables ({formatCOP(p.totVariables)}) no entran aquí porque el margen neto ya descuenta el costo directo de cada venta.</p>
      </section>

      <EmpleadosSection empleados={p.empleados} totNomina={p.totNomina} />
      <CostosSection costos={p.costos} totFijos={p.totFijos} totVariables={p.totVariables} />
    </div>
  );
}
function Linea({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <tr className="border-t border-gray-100 first:border-t-0">
      <td className={`py-2 text-gray-600 ${bold ? "font-semibold" : ""}`}>{k}</td>
      <td className={`py-2 text-right tabular-nums ${bold ? "font-bold text-gray-900" : "text-gray-800"}`}>{v}</td>
    </tr>
  );
}

// ── Empleados ─────────────────────────────────────────────────────────────────
function EmpleadosSection({ empleados, totNomina }: { empleados: EmpRow[]; totNomina: number }) {
  const [editor, setEditor] = useState<EmpRow | "nuevo" | null>(null);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}><Users size={16} /> Empleados y costo de contratación</h2>
        <Button onClick={() => setEditor("nuevo")} style={{ backgroundColor: "var(--brand-primary)" }}>+ Agregar</Button>
      </div>
      {editor && <EmpleadoEditor row={editor === "nuevo" ? null : editor} onClose={() => setEditor(null)} />}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2 text-right">Salario</th><th className="px-3 py-2 text-right">Aux</th>
              <th className="px-3 py-2 text-right">Seg. social</th><th className="px-3 py-2 text-right">Prestaciones</th>
              <th className="px-3 py-2 text-right">Costo total</th><th className="px-3 py-2 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {empleados.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">Sin empleados. Agrega el primero.</td></tr>
            ) : empleados.map((e) => <EmpleadoFila key={e.id} e={e} onEdit={() => setEditor(e)} />)}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="px-3 py-2" colSpan={6}>Total nómina mensual</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCOP(totNomina)}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function EmpleadoFila({ e, onEdit }: { e: EmpRow; onEdit: () => void }) {
  const router = useRouter();
  const l = liquidar(e);
  const [pending, start] = useTransition();
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");

  async function subir(file: File) {
    setErr(""); setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "bin";
      const path = `pe-empleados/${e.id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("contratos").upload(path, file, { upsert: false });
      if (error) throw error;
      const r = await registrarContratoEmpleado(e.id, path, file.name);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : "No se pudo subir."); }
    finally { setSubiendo(false); }
  }
  async function verContrato() {
    if (!e.contratoPath) return;
    const r = await urlContratoEmpleado(e.contratoPath);
    if (r.ok) window.open(r.url, "_blank");
  }

  const [abierto, setAbierto] = useState(false);

  return (
    <>
    <tr className="border-b border-gray-50">
      <td className="px-3 py-2.5 font-medium text-gray-800">
        {l.det && (
          <button onClick={() => setAbierto((v) => !v)} className="mr-1 align-middle text-gray-400 hover:text-gray-700" title="Ver discriminado">
            {abierto ? <ChevronDown size={14} className="inline" /> : <ChevronRight size={14} className="inline" />}
          </button>
        )}
        {e.nombre}
        {err && <span className="ml-2 text-[11px] text-red-500">{err}</span>}
      </td>
      <td className="px-3 py-2.5 text-gray-500">
        {e.tipo === "servicios" ? "Prestación de servicios" : "Empleado"}
        {e.tipo === "empleado" && e.declarante && <span className="ml-1 rounded bg-[rgba(102,181,150,0.18)] px-1 text-[10px] text-[#3d7a63]">exo</span>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{formatCOP(e.salario)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{l.auxilio > 0 ? formatCOP(l.auxilio) : "—"}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{e.tipo === "empleado" ? formatCOP(l.segSocial) : "—"}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{e.tipo === "empleado" ? formatCOP(l.prestaciones) : "—"}</td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatCOP(l.costoTotal)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-center gap-2">
          {e.contratoPath ? (
            <button onClick={verContrato} title={e.contratoNombre ?? "Ver contrato"} className="inline-flex items-center gap-1 text-xs text-[#1D7C9A] hover:underline"><FileText size={14} /> Contrato</button>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-gray-500 hover:text-[#1D7C9A]" title="Cargar contrato (escaneado o digital)">
              <Upload size={14} /> {subiendo ? "Subiendo…" : "Contrato"}
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(ev) => ev.target.files?.[0] && subir(ev.target.files[0])} />
            </label>
          )}
          <button onClick={onEdit} className="text-gray-400 hover:text-gray-700" title="Editar"><Pencil size={15} /></button>
          <button disabled={pending} onClick={() => start(async () => { await eliminarEmpleado(e.id, e.contratoPath); router.refresh(); })} className="text-gray-400 hover:text-red-500" title="Eliminar"><Trash2 size={15} /></button>
        </div>
      </td>
    </tr>
    {abierto && l.det && (
      <tr className="border-b border-gray-100 bg-gray-50/60">
        <td colSpan={8} className="px-3 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <DetGrupo titulo="Seguridad social" total={l.det.seguridadSocial}>
              <DLin label="Salud (8,5%)" valor={l.det.salud} tachado={l.det.exonerado} />
              <DLin label="Pensión (12%)" valor={l.det.pension} />
              <DLin label={`ARL (${(ARL[(e.riesgo as ClaseRiesgo) || "I"] * 100).toFixed(3)}%)`} valor={l.det.arl} />
            </DetGrupo>
            <DetGrupo titulo="Parafiscales" total={l.det.parafiscales}>
              <DLin label="SENA (2%)" valor={l.det.sena} tachado={l.det.exonerado} />
              <DLin label="ICBF (3%)" valor={l.det.icbf} tachado={l.det.exonerado} />
              <DLin label="Caja comp. (4%)" valor={l.det.caja} />
            </DetGrupo>
            <DetGrupo titulo="Prestaciones sociales" total={l.det.prestaciones}>
              <DLin label="Prima (8,33%)" valor={l.det.prima} />
              <DLin label="Cesantías (8,33%)" valor={l.det.cesantias} />
              <DLin label="Int. cesantías (1%)" valor={l.det.interesesCesantias} />
              <DLin label="Vacaciones (4,17%)" valor={l.det.vacaciones} />
            </DetGrupo>
          </div>
          {l.det.exonerado && <p className="mt-2 text-[11px] text-[#3d7a63]">Empresa declarante: exonerado de Salud, SENA e ICBF (salario &lt; 10 SMMLV).</p>}
        </td>
      </tr>
    )}
    </>
  );
}

function DetGrupo({ titulo, total, children }: { titulo: string; total: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3">
      <div className="mb-1 flex items-center justify-between border-b border-gray-100 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{titulo}</span>
        <span className="text-[11px] font-semibold tabular-nums text-gray-700">{formatCOP(total)}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function DLin({ label, valor, tachado }: { label: string; valor: number; tachado?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className={tachado ? "text-gray-400 line-through" : "text-gray-500"}>{label}</span>
      <span className={`tabular-nums ${tachado ? "text-[#3d7a63]" : "text-gray-700"}`}>{tachado ? "exonerado" : formatCOP(valor)}</span>
    </div>
  );
}

function EmpleadoEditor({ row, onClose }: { row: EmpRow | null; onClose: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(row?.nombre ?? "");
  const [tipo, setTipo] = useState<"empleado" | "servicios">(row?.tipo ?? "empleado");
  const [salario, setSalario] = useState(String(row?.salario ?? ""));
  const [auxilio, setAuxilio] = useState(row?.auxilio ?? true);
  const [riesgo, setRiesgo] = useState<string>(row?.riesgo ?? "I");
  const [declarante, setDeclarante] = useState(row?.declarante ?? true);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function guardar() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await guardarEmpleado({ id: row?.id, nombre, tipo, salario: n(salario), auxilio, riesgo, declarante });
      if (r.ok) { onClose(); router.refresh(); } else setErr(r.error);
    });
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Nombre / cargo</label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "empleado" | "servicios")} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="empleado">Empleado (nómina)</option>
            <option value="servicios">Prestación de servicios</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{tipo === "servicios" ? "Honorario mensual" : "Salario base"}</label>
          <Input type="number" value={salario} onChange={(e) => setSalario(e.target.value)} className="text-right" />
        </div>
        {tipo === "empleado" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Riesgo ARL</label>
              <select value={riesgo} onChange={(e) => setRiesgo(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {Object.keys(ARL).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-4 pb-2 text-sm text-gray-600">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={auxilio} onChange={(e) => setAuxilio(e.target.checked)} /> Auxilio</label>
              <label className="flex items-center gap-1.5" title="Empresa declarante: exoneración de Salud/SENA/ICBF (<10 SMMLV)">
                <input type="checkbox" checked={declarante} onChange={(e) => setDeclarante(e.target.checked)} /> Declarante
              </label>
            </div>
          </>
        )}
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
        <button onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancelar</button>
        <span className="text-[11px] text-gray-400">Exoneración aplica a empleados &lt; 10 SMMLV ({formatCOP(SMMLV * 10)}).</span>
      </div>
    </div>
  );
}

// ── Otros costos y gastos ─────────────────────────────────────────────────────
function CostosSection({ costos, totFijos, totVariables }: { costos: CostoRow[]; totFijos: number; totVariables: number }) {
  const [editor, setEditor] = useState<CostoRow | "nuevo" | null>(null);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}><BookText size={16} /> Otros costos y gastos</h2>
        <Button onClick={() => setEditor("nuevo")} style={{ backgroundColor: "var(--brand-primary)" }}>+ Agregar</Button>
      </div>
      {editor && <CostoEditor row={editor === "nuevo" ? null : editor} onClose={() => setEditor(null)} />}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-3 py-2">Concepto</th><th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Clasificación</th><th className="px-3 py-2 text-right">Valor mensual</th>
              <th className="px-3 py-2 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {costos.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Sin costos. Agrega el primero.</td></tr>
            ) : costos.map((c) => <CostoFila key={c.id} c={c} onEdit={() => setEditor(c)} />)}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="px-3 py-2" colSpan={3}>Fijos {formatCOP(totFijos)} · Variables {formatCOP(totVariables)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCOP(totFijos + totVariables)}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
function CostoFila({ c, onEdit }: { c: CostoRow; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <tr className="border-b border-gray-50">
      <td className="px-3 py-2.5 font-medium text-gray-800">{c.concepto}</td>
      <td className="px-3 py-2.5 text-gray-500">{c.categoria || "—"}</td>
      <td className="px-3 py-2.5">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.clasificacion === "fijo" ? "bg-[rgba(102,181,150,0.15)] text-[#3d7a63]" : "bg-amber-50 text-amber-700"}`}>
          {c.clasificacion === "fijo" ? "Fijo" : "Variable"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCOP(c.valor)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-center gap-2">
          <button onClick={onEdit} className="text-gray-400 hover:text-gray-700" title="Editar"><Pencil size={15} /></button>
          <button disabled={pending} onClick={() => start(async () => { await eliminarCosto(c.id); router.refresh(); })} className="text-gray-400 hover:text-red-500" title="Eliminar"><Trash2 size={15} /></button>
        </div>
      </td>
    </tr>
  );
}
function CostoEditor({ row, onClose }: { row: CostoRow | null; onClose: () => void }) {
  const router = useRouter();
  const [concepto, setConcepto] = useState(row?.concepto ?? "");
  const [categoria, setCategoria] = useState(row?.categoria ?? "");
  const [clasificacion, setClasificacion] = useState<"fijo" | "variable">(row?.clasificacion ?? "fijo");
  const [valor, setValor] = useState(String(row?.valor ?? ""));
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  function guardar() {
    if (!concepto.trim()) { setErr("El concepto es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await guardarCosto({ id: row?.id, concepto, categoria, clasificacion, valor: n(valor) });
      if (r.ok) { onClose(); router.refresh(); } else setErr(r.error);
    });
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2"><label className="mb-1 block text-xs font-medium text-gray-600">Concepto</label><Input value={concepto} onChange={(e) => setConcepto(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs font-medium text-gray-600">Categoría</label><Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Gasto, servicio…" /></div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Clasificación</label>
          <select value={clasificacion} onChange={(e) => setClasificacion(e.target.value as "fijo" | "variable")} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="fijo">Fijo</option><option value="variable">Variable</option>
          </select>
        </div>
        <div><label className="mb-1 block text-xs font-medium text-gray-600">Valor mensual</label><Input type="number" value={valor} onChange={(e) => setValor(e.target.value)} className="text-right" /></div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
        <button onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancelar</button>
      </div>
    </div>
  );
}
