"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearAsesor, actualizarAsesor, eliminarAsesor, actualizarParametro, crearRangoEdad, eliminarRangoEdad, crearFormaPago, eliminarFormaPago } from "./actions";

type Asesor = { id: number; nombre: string; email: string | null; pct_comision_base: number; meta_mensual: number; aplica_retencion?: boolean };
type Param = { parametro: string; valor: number; descripcion: string | null };
type Rango = { id: number; denominacion: string; edad_min: number; edad_max: number };
type FormaPago = { id: number; nombre: string };

export function ConfigClient({ asesores, parametros, rangos, formasPago }: { asesores: Asesor[]; parametros: Param[]; rangos: Rango[]; formasPago: FormaPago[] }) {
  return (
    <div className="space-y-8">
      <AsesoresAdmin asesores={asesores} />
      <RangosEdadAdmin rangos={rangos} />
      <FormasPagoAdmin formasPago={formasPago} />
      <ParametrosAdmin parametros={parametros} />
    </div>
  );
}

function FormasPagoAdmin({ formasPago }: { formasPago: FormaPago[] }) {
  const [nombre, setNombre] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function agregar() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearFormaPago(nombre);
      if (r.ok) setNombre(""); else setErr(r.error);
    });
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Formas de pago</h2>
      <p className="mb-3 text-xs text-gray-400">Lista usada en los abonos (efectivo, transferencia, PSE, Nequi…).</p>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nombre</label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Transferencia, Nequi…" />
          </div>
          <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : "Agregar"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
        <ul className="mt-3 divide-y divide-gray-100">
          {formasPago.map((f) => (
            <li key={f.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-700">{f.nombre}</span>
              <button
                type="button"
                onClick={() => { if (confirm(`¿Eliminar "${f.nombre}"?`)) void eliminarFormaPago(f.id); }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Eliminar
              </button>
            </li>
          ))}
          {!formasPago.length && <li className="py-2 text-sm text-gray-400">Sin formas de pago aún.</li>}
        </ul>
      </div>
    </section>
  );
}

function RangosEdadAdmin({ rangos }: { rangos: Rango[] }) {
  const [denom, setDenom] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function agregar() {
    if (!denom.trim()) { setErr("La denominación es obligatoria."); return; }
    setErr("");
    start(async () => {
      const r = await crearRangoEdad({ denominacion: denom, edadMin: Number(min) || 0, edadMax: Number(max) || 0 });
      if (r.ok) { setDenom(""); setMin(""); setMax(""); } else setErr(r.error);
    });
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Rangos de edad</h2>
      <p className="mb-3 text-xs text-gray-400">
        Denominación + edad mín/máx (ej. Infante 0–2, Niño 2–10). Luego se seleccionan en hoteles, vuelos y servicios.
      </p>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Denominación</label>
            <Input value={denom} onChange={(e) => setDenom(e.target.value)} placeholder="Infante, Niño…" />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs font-medium text-gray-600">Edad mín.</label>
            <Input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} placeholder="0" />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs font-medium text-gray-600">Edad máx.</label>
            <Input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} placeholder="2" />
          </div>
          <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : "Agregar"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
        <ul className="mt-3 divide-y divide-gray-100">
          {rangos.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span><b>{r.denominacion}</b> <span className="text-gray-400">· {r.edad_min}–{r.edad_max} años</span></span>
              <button
                type="button"
                onClick={() => { if (confirm(`¿Eliminar "${r.denominacion}"?`)) void eliminarRangoEdad(r.id); }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Eliminar
              </button>
            </li>
          ))}
          {!rangos.length && <li className="py-2 text-sm text-gray-400">Sin rangos aún.</li>}
        </ul>
      </div>
    </section>
  );
}

function AsesoresAdmin({ asesores }: { asesores: Asesor[] }) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [pct, setPct] = useState("8");
  const [meta, setMeta] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function agregar() {
    if (!nombre.trim()) return;
    setErr("");
    start(async () => {
      const r = await crearAsesor({ nombre, email, pctComisionBase: Number(pct) / 100 || 0, metaMensual: Number(meta) || 0 });
      if (r.ok) { setNombre(""); setEmail(""); setPct("8"); setMeta(""); }
      else setErr(r.error);
    });
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Asesores y comisiones</h2>
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="number" placeholder="% comisión" value={pct} onChange={(e) => setPct(e.target.value)} />
          <Input type="number" placeholder="Meta mensual" value={meta} onChange={(e) => setMeta(e.target.value)} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Agregar asesor"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>
      {asesores.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">% comisión</th><th className="px-4 py-2">Retención</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{asesores.map((a) => <AsesorRow key={a.id} a={a} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AsesorRow({ a }: { a: Asesor }) {
  const [pct, setPct] = useState(String((a.pct_comision_base * 100).toFixed(2)));
  const [ret, setRet] = useState(a.aplica_retencion ?? true);
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 text-gray-700">{a.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{a.email ?? "—"}</td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <Input type="number" className="w-20" value={pct} onChange={(e) => setPct(e.target.value)}
            onBlur={() => start(() => { void actualizarAsesor(a.id, Number(pct) / 100 || 0, ret); })} />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </td>
      <td className="px-4 py-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={ret}
            onChange={(e) => { setRet(e.target.checked); start(() => { void actualizarAsesor(a.id, Number(pct) / 100 || 0, e.target.checked); }); }} />
          Aplica
        </label>
      </td>
      <td className="px-4 py-2 text-right">
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`¿Eliminar a ${a.nombre}?`)) start(() => { void eliminarAsesor(a.id); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}

function ParametrosAdmin({ parametros }: { parametros: Param[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Parámetros tributarios</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
            <th className="px-4 py-2">Parámetro</th><th className="px-4 py-2">Descripción</th><th className="px-4 py-2">Valor (%)</th>
          </tr></thead>
          <tbody>{parametros.map((p) => <ParamRow key={p.parametro} p={p} />)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">El valor se guarda como fracción (ej. 0.01 = 1%). Aquí se edita en %.</p>
    </section>
  );
}

function ParamRow({ p }: { p: Param }) {
  const [val, setVal] = useState(String(p.valor * 100));
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 font-medium text-gray-700">{p.parametro}</td>
      <td className="px-4 py-2 text-gray-500">{p.descripcion ?? "—"}</td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <Input type="number" className="w-24" value={val} onChange={(e) => setVal(e.target.value)} disabled={pending}
            onBlur={() => start(() => { void actualizarParametro(p.parametro, Number(val) / 100 || 0); })} />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </td>
    </tr>
  );
}
